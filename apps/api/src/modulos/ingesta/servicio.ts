import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import { config } from '../../config';
import { prisma } from '../../db';
import { ErrorApp, conflicto, noEncontrado } from '../../errores';
import { SEPARADOR_TEMA, asegurarRutaTema } from '../contenidos/servicio';
import type { DocumentoDetalle, DocumentoResumen, EstadoDocumento } from './esquemas';
import { exportarContenido, rutasDeTemas } from './exportar';
import { extraerPaginas, type OpcionesExtraccion } from './extraer';
import { claveDesdeTitulo, fragmentar } from './fragmentar';

const DIR_DOCUMENTOS = 'documentos';

// ---------- Registro ----------

export async function registrarDocumento(datos: { contenidoId: string; archivo: Buffer; nombreArchivo: string }) {
  const contenido = await prisma.contenido.count({ where: { id: datos.contenidoId } });
  if (!contenido) throw noEncontrado('El contenido');
  if (datos.archivo.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new ErrorApp(400, 'ARCHIVO_INVALIDO', 'El archivo no es un PDF');
  }

  const hash = createHash('sha256').update(datos.archivo).digest('hex');
  const existente = await prisma.documento.findUnique({ where: { hash }, select: { id: true, contenidoId: true } });
  if (existente) throw conflicto('Ese PDF ya fue subido', { documentoId: existente.id, contenidoId: existente.contenidoId });

  const archivoUrl = `${DIR_DOCUMENTOS}/${hash}.pdf`;
  await mkdir(path.join(config.dirStorage, DIR_DOCUMENTOS), { recursive: true });
  await writeFile(path.join(config.dirStorage, archivoUrl), datos.archivo);
  return prisma.documento.create({
    data: { contenidoId: datos.contenidoId, nombreArchivo: datos.nombreArchivo, archivoUrl, hash, estado: 'SUBIDO' },
  });
}

/** Asigna (una vez) la clave del contenido: prefijo de las refs y carpeta en fuentes/. */
export async function asegurarClave(contenidoId: string): Promise<string> {
  const c = await prisma.contenido.findUnique({ where: { id: contenidoId }, select: { clave: true, titulo: true } });
  if (!c) throw noEncontrado('El contenido');
  if (c.clave) return c.clave;
  const base = claveDesdeTitulo(c.titulo);
  let clave = base;
  for (let n = 2; await prisma.contenido.count({ where: { clave } }); n++) clave = `${base}${n}`;
  await prisma.contenido.update({ where: { id: contenidoId }, data: { clave } });
  return clave;
}

// ---------- Procesamiento ----------

export async function procesarDocumento(documentoId: string, opciones: OpcionesExtraccion = {}) {
  const doc = await prisma.documento.findUnique({ where: { id: documentoId } });
  if (!doc) throw noEncontrado('El documento');
  await marcar(documentoId, 'PROCESANDO');

  try {
    const pdf = await readFile(path.join(config.dirStorage, doc.archivoUrl));
    const paginas = await extraerPaginas(pdf, opciones);
    await prisma.$transaction([
      prisma.pagina.deleteMany({ where: { documentoId } }),
      prisma.pagina.createMany({
        data: paginas.map((p) => ({ documentoId, numero: p.numero, texto: p.texto, ocr: p.ocr, confianza: p.confianza })),
      }),
      prisma.documento.update({
        where: { id: documentoId },
        data: { paginas: paginas.length, paginasOcr: paginas.filter((p) => p.ocr).length, estado: 'EXTRAIDO' },
      }),
    ]);
    const resultado = await fragmentarDocumento(documentoId);
    await exportarContenido(doc.contenidoId);
    return resultado;
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    await marcar(documentoId, 'ERROR', mensaje.slice(0, 1000));
    throw e;
  }
}

/**
 * (Re)genera los fragmentos a partir del texto ya extraído, sin repetir el OCR.
 * Las preguntas que apuntaban a fragmentos anteriores se vuelven a enlazar por `fragmentoRef`.
 */
export async function fragmentarDocumento(documentoId: string) {
  const doc = await prisma.documento.findUnique({
    where: { id: documentoId },
    include: { textos: { orderBy: { numero: 'asc' }, select: { numero: true, texto: true } } },
  });
  if (!doc) throw noEncontrado('El documento');
  if (doc.textos.length === 0) throw new ErrorApp(409, 'SIN_TEXTO', 'El documento aún no fue extraído');

  const clave = await asegurarClave(doc.contenidoId);
  const { modo, fragmentos } = fragmentar(doc.textos, clave);

  // Refs de otros documentos del mismo contenido: no se pueden repetir.
  const ajenas = new Set(
    (
      await prisma.fragmento.findMany({
        where: { documento: { contenidoId: doc.contenidoId }, documentoId: { not: documentoId } },
        select: { ref: true },
      })
    ).map((f) => f.ref),
  );
  const sufijoDoc = ajenas.size ? `-d${(await prisma.documento.count({ where: { contenidoId: doc.contenidoId, creadoEn: { lt: doc.creadoEn } } })) + 1}` : '';

  await prisma.$transaction(
    async (tx) => {
      const temasPrevios = await tx.fragmento.findMany({
        where: { documentoId, temaId: { not: null } },
        select: { temaId: true },
        distinct: ['temaId'],
      });
      await tx.pregunta.updateMany({ where: { fragmento: { documentoId } }, data: { fragmentoId: null } });
      await tx.fragmento.deleteMany({ where: { documentoId } });

      const temas = new Map<string, string | null>();
      const filas: Prisma.FragmentoCreateManyInput[] = [];
      for (const f of fragmentos) {
        const claveRuta = f.tema.join(SEPARADOR_TEMA);
        if (!temas.has(claveRuta)) temas.set(claveRuta, await asegurarRutaTema(tx, doc.contenidoId, f.tema));
        const ref = ajenas.has(f.ref) ? `${f.ref}${sufijoDoc}` : f.ref;
        filas.push({
          ref,
          documentoId,
          temaId: temas.get(claveRuta) ?? null,
          etiqueta: f.etiqueta,
          orden: f.orden,
          texto: f.texto,
          palabras: f.palabras,
          paginaDesde: f.paginaDesde,
          paginaHasta: f.paginaHasta,
        });
      }
      await tx.fragmento.createMany({ data: filas });
      await tx.$executeRaw`
        UPDATE "Pregunta" p SET "fragmentoId" = f.id
        FROM "Fragmento" f
        WHERE f."documentoId" = ${documentoId} AND p."fragmentoRef" = f.ref`;
      await podarTemas(tx, temasPrevios.map((t) => t.temaId!));
      await tx.documento.update({
        where: { id: documentoId },
        data: { estado: 'FRAGMENTADO', modo, error: null, procesadoEn: new Date() },
      });
    },
    { timeout: 120_000 },
  );
  return { modo, fragmentos: fragmentos.length };
}

/**
 * Borra los temas que usaba la fragmentación anterior y quedaron vacíos (sin fragmentos, preguntas
 * ni subtemas), subiendo por sus padres. No toca temas que nunca tuvieron fragmentos de este documento.
 */
async function podarTemas(tx: Prisma.TransactionClient, temaIds: string[]) {
  let pendientes = [...new Set(temaIds)];
  while (pendientes.length) {
    const vacios = await tx.tema.findMany({
      where: { id: { in: pendientes }, fragmentos: { none: {} }, preguntas: { none: {} }, hijos: { none: {} } },
      select: { id: true, padreId: true },
    });
    if (!vacios.length) break;
    await tx.tema.deleteMany({ where: { id: { in: vacios.map((t) => t.id) } } });
    pendientes = [...new Set(vacios.map((t) => t.padreId).filter((p): p is string => p !== null))];
  }
}

async function marcar(documentoId: string, estado: EstadoDocumento, error: string | null = null) {
  await prisma.documento.update({ where: { id: documentoId }, data: { estado, error } });
}

// ---------- Consultas ----------

const incluirResumen = {
  contenido: { select: { id: true, titulo: true, clave: true } },
  _count: { select: { fragmentos: true } },
} satisfies Prisma.DocumentoInclude;

function aResumen(d: Prisma.DocumentoGetPayload<{ include: typeof incluirResumen }>): DocumentoResumen {
  return {
    id: d.id,
    contenido: d.contenido,
    nombreArchivo: d.nombreArchivo,
    estado: d.estado as EstadoDocumento,
    error: d.error,
    paginas: d.paginas,
    paginasOcr: d.paginasOcr,
    modo: d.modo,
    totalFragmentos: d._count.fragmentos,
    creadoEn: d.creadoEn.toISOString(),
    procesadoEn: d.procesadoEn?.toISOString() ?? null,
  };
}

export async function listarDocumentos(filtro: { contenidoId?: string }): Promise<DocumentoResumen[]> {
  const docs = await prisma.documento.findMany({
    where: filtro.contenidoId ? { contenidoId: filtro.contenidoId } : {},
    include: incluirResumen,
    orderBy: { creadoEn: 'desc' },
  });
  return docs.map(aResumen);
}

export async function obtenerDocumento(id: string): Promise<DocumentoDetalle> {
  const d = await prisma.documento.findUnique({
    where: { id },
    include: {
      ...incluirResumen,
      fragmentos: { orderBy: { orden: 'asc' }, include: { _count: { select: { preguntas: true } } } },
    },
  });
  if (!d) throw noEncontrado('El documento');
  const rutas = await rutasDeTemas(d.contenidoId);
  return {
    ...aResumen(d),
    fragmentos: d.fragmentos.map((f) => ({
      id: f.id,
      ref: f.ref,
      etiqueta: f.etiqueta,
      tema: (f.temaId && rutas.get(f.temaId)) || null,
      texto: f.texto,
      palabras: f.palabras,
      paginaDesde: f.paginaDesde,
      paginaHasta: f.paginaHasta,
      totalPreguntas: f._count.preguntas,
    })),
  };
}

export async function eliminarDocumento(id: string) {
  const d = await prisma.documento.findUnique({ where: { id } });
  if (!d) throw noEncontrado('El documento');
  if (d.estado === 'PROCESANDO') throw conflicto('El documento se está procesando; espera a que termine');
  await prisma.$transaction([
    prisma.pregunta.updateMany({ where: { fragmento: { documentoId: id } }, data: { fragmentoId: null } }),
    prisma.fragmento.deleteMany({ where: { documentoId: id } }),
    prisma.documento.delete({ where: { id } }),
  ]);
  await rm(path.join(config.dirStorage, d.archivoUrl), { force: true });
}
