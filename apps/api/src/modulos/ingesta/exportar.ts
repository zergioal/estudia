/**
 * Exporta los fragmentos de un contenido a fuentes/<clave>/<ref>.md, el formato que lee Claude Code
 * para generar preguntas (ver "Generar preguntas" en CLAUDE.md).
 */
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ResultadoExportacion } from '@estudia/shared';
import { config } from '../../config';
import { prisma } from '../../db';
import { ErrorApp, noEncontrado } from '../../errores';
import { SEPARADOR_TEMA } from '../contenidos/servicio';

const INDICE = '_indice.md';
const yaml = (s: string) => JSON.stringify(s);

/** Ruta "Título I - Capítulo II" de cada tema del contenido. */
export async function rutasDeTemas(contenidoId: string): Promise<Map<string, string>> {
  const temas = await prisma.tema.findMany({ where: { contenidoId }, select: { id: true, nombre: true, padreId: true } });
  const porId = new Map(temas.map((t) => [t.id, t]));
  const rutas = new Map<string, string>();
  for (const t of temas) {
    const niveles: string[] = [];
    for (let x: typeof t | undefined = t; x && niveles.length < 10; x = x.padreId ? porId.get(x.padreId) : undefined) {
      niveles.unshift(x.nombre);
    }
    rutas.set(t.id, niveles.join(SEPARADOR_TEMA));
  }
  return rutas;
}

export async function exportarContenido(contenidoId: string, dirBase = config.dirFuentes): Promise<ResultadoExportacion> {
  const contenido = await prisma.contenido.findUnique({ where: { id: contenidoId } });
  if (!contenido) throw noEncontrado('El contenido');
  if (!contenido.clave) throw new ErrorApp(409, 'SIN_FRAGMENTOS', 'El contenido aún no tiene documentos procesados');

  const [fragmentos, rutas] = await Promise.all([
    prisma.fragmento.findMany({
      where: { documento: { contenidoId } },
      orderBy: [{ documento: { creadoEn: 'asc' } }, { orden: 'asc' }],
      include: { _count: { select: { preguntas: true } } },
    }),
    rutasDeTemas(contenidoId),
  ]);

  const carpeta = path.join(dirBase, contenido.clave);
  await mkdir(carpeta, { recursive: true });
  // Solo se borran los .md generados aquí, por si alguien dejó otros archivos en la carpeta.
  for (const f of await readdir(carpeta)) {
    if (f === INDICE || (f.startsWith(`${contenido.clave}-`) && f.endsWith('.md'))) await rm(path.join(carpeta, f));
  }

  const filas: string[] = [];
  for (const f of fragmentos) {
    if (!f.ref) continue;
    const tema = (f.temaId && rutas.get(f.temaId)) || '';
    const paginas = f.paginaDesde === f.paginaHasta ? `${f.paginaDesde}` : `${f.paginaDesde}-${f.paginaHasta}`;
    const md = [
      '---',
      `contenido: ${yaml(contenido.titulo)}`,
      `tema: ${yaml(tema)}`,
      `fragmentoRef: ${f.ref}`,
      `etiqueta: ${yaml(f.etiqueta)}`,
      `paginas: ${yaml(paginas)}`,
      `palabras: ${f.palabras}`,
      '---',
      '',
      f.texto,
      '',
    ].join('\n');
    await writeFile(path.join(carpeta, `${f.ref}.md`), md, 'utf8');
    filas.push(`| ${f.ref} | ${f.etiqueta} | ${tema.replaceAll('|', '/')} | ${paginas} | ${f.palabras} | ${f._count.preguntas} |`);
  }

  const indice = [
    `# ${contenido.titulo}`,
    '',
    `Clave: \`${contenido.clave}\` · Tipo: ${contenido.tipoFuente} · ${filas.length} fragmentos.`,
    'Páginas = número de página del PDF. Generado por EstudIA; no editar a mano (se sobrescribe).',
    '',
    '| Ref | Etiqueta | Tema | Págs. | Palabras | Preguntas |',
    '| --- | --- | --- | --- | --- | --- |',
    ...filas,
    '',
  ].join('\n');
  await writeFile(path.join(carpeta, INDICE), indice, 'utf8');

  return { carpeta: path.relative(path.dirname(dirBase), carpeta).replaceAll('\\', '/'), archivos: filas.length };
}
