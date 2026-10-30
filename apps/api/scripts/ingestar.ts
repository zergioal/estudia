/**
 * Ingesta local de PDFs: registra, extrae (con OCR), fragmenta y exporta a fuentes/<clave>/.
 *
 * Uso desde la raíz:
 *   npm run ingestar -- fuentes/examenDireccion            (carpeta, recursivo; usa manifiesto.json si existe)
 *   npm run ingestar -- "ruta/al/archivo.pdf" --coleccion "Ascenso 2027"
 * Opciones: --coleccion <nombre>  --sin-ocr  --reprocesar (repite lo ya procesado)  --solo <texto en el nombre>
 */
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { manifiestoIngestaSchema, type ManifiestoIngesta, type TipoFuente } from '@estudia/shared';
import { prisma } from '../src/db';
import { ErrorApp, issuesZod } from '../src/errores';
import { procesarDocumento, registrarDocumento } from '../src/modulos/ingesta/servicio';
import { COLECCION_POR_DEFECTO, deducirTipoFuente } from '../src/modulos/preguntas/servicio';

interface Opciones {
  rutas: string[];
  coleccion?: string;
  ocr: boolean;
  reprocesar: boolean;
  solo?: string;
}

function leerArgumentos(argv: string[]): Opciones {
  const o: Opciones = { rutas: [], ocr: true, reprocesar: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--coleccion') o.coleccion = argv[++i];
    else if (a === '--solo') o.solo = argv[++i];
    else if (a === '--sin-ocr') o.ocr = false;
    else if (a === '--reprocesar') o.reprocesar = true;
    else o.rutas.push(a);
  }
  return o;
}

const nfc = (s: string) => s.normalize('NFC').replaceAll('\\', '/');

async function listarPdfs(ruta: string): Promise<string[]> {
  if (!(await stat(ruta)).isDirectory()) return [ruta];
  const salida: string[] = [];
  for (const e of await readdir(ruta, { withFileTypes: true })) {
    const p = path.join(ruta, e.name);
    if (e.isDirectory()) salida.push(...(await listarPdfs(p)));
    else if (e.name.toLowerCase().endsWith('.pdf')) salida.push(p);
  }
  return salida.sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
}

async function leerManifiesto(carpeta: string): Promise<ManifiestoIngesta | null> {
  const ruta = path.join(carpeta, 'manifiesto.json');
  if (!existsSync(ruta)) return null;
  const r = manifiestoIngestaSchema.safeParse(JSON.parse(await readFile(ruta, 'utf8')));
  if (!r.success) throw new ErrorApp(400, 'MANIFIESTO_INVALIDO', `manifiesto.json inválido en ${carpeta}`, issuesZod(r.error));
  return r.data;
}

/** "2 Ley 070.pdf" → "Ley 070" */
const tituloDesdeArchivo = (archivo: string) =>
  path.basename(archivo, path.extname(archivo)).replace(/^\d+\s+/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();

async function obtenerContenido(datos: { titulo: string; tipoFuente: TipoFuente; clave?: string; coleccion: string }) {
  const coleccion = await prisma.coleccion.upsert({
    where: { nombre: datos.coleccion },
    update: {},
    create: { nombre: datos.coleccion },
  });
  const existente = await prisma.contenido.findUnique({ where: { titulo: datos.titulo }, include: { coleccion: true } });
  if (!existente) {
    return prisma.contenido.create({
      data: { titulo: datos.titulo, tipoFuente: datos.tipoFuente, clave: datos.clave, coleccionId: coleccion.id },
    });
  }
  // Un contenido creado por el importador ("Sin asignar") pasa a la colección real.
  const mover = existente.coleccion.nombre === COLECCION_POR_DEFECTO && datos.coleccion !== COLECCION_POR_DEFECTO;
  if (mover || (!existente.clave && datos.clave)) {
    return prisma.contenido.update({
      where: { id: existente.id },
      data: { ...(mover && { coleccionId: coleccion.id }), ...(!existente.clave && datos.clave && { clave: datos.clave }) },
    });
  }
  return existente;
}

async function main() {
  const o = leerArgumentos(process.argv.slice(2));
  if (o.rutas.length === 0) {
    console.error('Uso: npm run ingestar -- <carpeta|archivo.pdf> [--coleccion <nombre>] [--sin-ocr] [--reprocesar] [--solo <texto>]');
    process.exit(1);
  }
  const base = process.env.INIT_CWD ?? process.cwd();
  const resumen: { archivo: string; resultado: string }[] = [];

  for (const r of o.rutas) {
    const raiz = path.resolve(base, r);
    const esCarpeta = (await stat(raiz)).isDirectory();
    const carpeta = esCarpeta ? raiz : path.dirname(raiz);
    const manifiesto = await leerManifiesto(carpeta);
    const nombreColeccion = o.coleccion ?? manifiesto?.coleccion ?? (esCarpeta ? path.basename(raiz) : COLECCION_POR_DEFECTO);

    for (const archivo of await listarPdfs(raiz)) {
      const relativo = nfc(path.relative(carpeta, archivo));
      if (o.solo && !nfc(relativo).toLowerCase().includes(o.solo.normalize('NFC').toLowerCase())) continue;
      const entrada = manifiesto?.documentos.find((d) => nfc(d.archivo) === relativo);
      const titulo = entrada?.titulo ?? tituloDesdeArchivo(archivo);
      const inicio = Date.now();
      process.stdout.write(`\n▶ ${relativo}\n  → ${titulo}\n`);

      try {
        const contenido = await obtenerContenido({
          titulo,
          tipoFuente: entrada?.tipoFuente ?? deducirTipoFuente(titulo),
          clave: entrada?.clave,
          coleccion: nombreColeccion,
        });
        const pdf = await readFile(archivo);
        let documentoId: string;
        try {
          documentoId = (await registrarDocumento({ contenidoId: contenido.id, archivo: pdf, nombreArchivo: path.basename(archivo) })).id;
        } catch (e) {
          const previo = e instanceof ErrorApp && e.codigo === 'CONFLICTO' ? (e.detalles as { documentoId: string }) : null;
          if (!previo) throw e;
          const doc = await prisma.documento.findUniqueOrThrow({ where: { id: previo.documentoId } });
          if (doc.estado === 'FRAGMENTADO' && !o.reprocesar) {
            console.log('  = ya procesado (usa --reprocesar para repetir)');
            resumen.push({ archivo: relativo, resultado: 'ya procesado' });
            continue;
          }
          documentoId = doc.id;
        }

        const r = await procesarDocumento(documentoId, {
          ocr: entrada?.ocr ?? o.ocr,
          alProgresar: (n, total, ocr) => {
            if (ocr || n === total || n % 25 === 0) process.stdout.write(`  pág. ${n}/${total}${ocr ? ' (OCR)' : ''}\n`);
          },
        });
        const doc = await prisma.documento.findUniqueOrThrow({ where: { id: documentoId }, include: { contenido: true } });
        const seg = Math.round((Date.now() - inicio) / 1000);
        const texto = `${r.fragmentos} fragmentos (${r.modo}), ${doc.paginas} págs.${doc.paginasOcr ? `, ${doc.paginasOcr} con OCR` : ''}, ${seg}s → fuentes/${doc.contenido.clave}/`;
        console.log(`  ✔ ${texto}`);
        resumen.push({ archivo: relativo, resultado: texto });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ✖ ${msg}`);
        if (e instanceof ErrorApp && e.detalles) console.error(JSON.stringify(e.detalles, null, 2));
        resumen.push({ archivo: relativo, resultado: `ERROR: ${msg}` });
      }
    }
  }

  console.log('\n===== Resumen');
  for (const r of resumen) console.log(`- ${r.archivo}: ${r.resultado}`);
  await prisma.$disconnect();
  if (resumen.some((r) => r.resultado.startsWith('ERROR'))) process.exit(1);
}

main().catch(async (e) => {
  console.error(e instanceof ErrorApp ? `${e.message}\n${JSON.stringify(e.detalles, null, 2)}` : e);
  await prisma.$disconnect();
  process.exit(1);
});
