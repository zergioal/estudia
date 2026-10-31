import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { ErrorApp, conflicto, issuesZod, noEncontrado } from '../../errores';
import { SEPARADOR_TEMA, asegurarRutaTema } from '../contenidos/servicio';
import {
  loteImportacionSchema,
  opcionesSchemaPara,
  preguntaImportacionSchema,
  type AprobarTodas,
  type ItemRechazado,
  type OrigenPregunta,
  type Paginado,
  type PreguntaEditar,
  type PreguntaRevision,
  type ResultadoImportacion,
  type RevisionFiltro,
  type TipoFuente,
} from './esquemas';

/** Colección donde caen los contenidos importados que no indican colección. */
export const COLECCION_POR_DEFECTO = 'Sin asignar';

/** Normaliza para comparar: minúsculas, sin espacios repetidos, comillas tipográficas unificadas. */
export function normalizar(texto: string): string {
  return texto
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function deducirTipoFuente(titulo: string): TipoFuente {
  const t = titulo.trim().toUpperCase();
  if (/^LEY\b/.test(t)) return 'LEY';
  if (/^(D\.?\s?S\.?|DECRETO)\b/.test(t)) return 'DECRETO';
  if (/^(R\.?\s?M\.?|RESOLUCI[OÓ]N)\b/.test(t)) return 'RM';
  return 'GUIA';
}

// ---------- Importación ----------

export async function importarLote(
  entrada: unknown,
  origenPorDefecto: OrigenPregunta = 'MANUAL',
): Promise<ResultadoImportacion> {
  const lote = loteImportacionSchema.safeParse(entrada);
  if (!lote.success) {
    throw new ErrorApp(400, 'LOTE_INVALIDO', 'El lote no cumple el contrato JSON', issuesZod(lote.error));
  }
  const { coleccion, contenido, tema, fragmentoRef, preguntas } = lote.data;
  const origen = lote.data.origen ?? origenPorDefecto;

  return prisma.$transaction(
    async (tx) => {
      const fragmento = fragmentoRef
        ? await tx.fragmento.findUnique({
            where: { ref: fragmentoRef },
            select: { id: true, texto: true, temaId: true, documento: { select: { contenidoId: true } } },
          })
        : null;
      let contenidoId: string;
      let temaId: string;
      if (contenido && tema) {
        contenidoId = await obtenerOCrearContenido(tx, contenido, coleccion ?? COLECCION_POR_DEFECTO);
        temaId = await obtenerOCrearRutaTema(tx, contenidoId, tema);
      } else if (fragmento?.temaId) {
        // Lote mínimo: contenido y tema salen del fragmento.
        contenidoId = fragmento.documento.contenidoId;
        temaId = fragmento.temaId;
      } else {
        throw new ErrorApp(400, 'LOTE_INVALIDO', `El fragmento "${fragmentoRef}" no existe; indica "contenido" y "tema"`);
      }
      const textoFragmento = fragmento ? normalizar(fragmento.texto) : null;

      const existentes = await tx.pregunta.findMany({
        where: { temaId, estado: { not: 'DESCARTADA' } },
        select: { enunciado: true },
      });
      const enunciadosVistos = new Set(existentes.map((p) => normalizar(p.enunciado)));

      const rechazadas: ItemRechazado[] = [];
      const duplicadas: ItemRechazado[] = [];
      let importadas = 0;

      for (const [indice, cruda] of preguntas.entries()) {
        const r = preguntaImportacionSchema.safeParse(cruda);
        if (!r.success) {
          rechazadas.push({ indice, motivo: issuesZod(r.error).map((i) => formatearIssue(i)).join('; ') });
          continue;
        }
        const p = r.data;

        if (textoFragmento !== null && !textoFragmento.includes(normalizar(p.citaTextual))) {
          rechazadas.push({ indice, motivo: `citaTextual no aparece en el fragmento "${fragmentoRef}"` });
          continue;
        }

        const clave = normalizar(p.enunciado);
        if (enunciadosVistos.has(clave)) {
          duplicadas.push({ indice, motivo: 'Ya existe una pregunta con el mismo enunciado en este tema' });
          continue;
        }
        enunciadosVistos.add(clave);

        await tx.pregunta.create({
          data: {
            temaId,
            fragmentoId: fragmento?.id ?? null,
            fragmentoRef: fragmentoRef ?? null,
            tipo: p.tipo,
            dificultad: p.dificultad,
            nivelBloom: p.nivelBloom,
            enunciado: p.enunciado,
            explicacion: p.explicacion,
            citaTextual: p.citaTextual,
            referencia: p.referencia,
            etiquetas: p.etiquetas,
            origen,
            estado: 'BORRADOR',
            opciones: {
              create: p.opciones.map((o, orden) => ({
                texto: o.texto,
                correcta: o.correcta,
                porQue: o.porQue ?? null,
                orden,
              })),
            },
          },
        });
        importadas++;
      }

      return { importadas, rechazadas, duplicadas, contenidoId, temaId };
    },
    { timeout: 60_000 },
  );
}

function formatearIssue(i: { ruta: string; mensaje: string }) {
  return i.ruta ? `${i.ruta}: ${i.mensaje}` : i.mensaje;
}

async function obtenerOCrearContenido(tx: Prisma.TransactionClient, titulo: string, nombreColeccion: string) {
  const existente = await tx.contenido.findUnique({ where: { titulo }, select: { id: true } });
  if (existente) return existente.id;
  const coleccion = await tx.coleccion.upsert({
    where: { nombre: nombreColeccion },
    update: {},
    create: { nombre: nombreColeccion },
  });
  const creado = await tx.contenido.create({
    data: { titulo, coleccionId: coleccion.id, tipoFuente: deducirTipoFuente(titulo) },
  });
  return creado.id;
}

/** "Título I - Capítulo II" → Título I › Capítulo II, creando los niveles que falten. */
async function obtenerOCrearRutaTema(tx: Prisma.TransactionClient, contenidoId: string, ruta: string) {
  const temaId = await asegurarRutaTema(tx, contenidoId, ruta.split(SEPARADOR_TEMA));
  if (!temaId) throw new ErrorApp(400, 'LOTE_INVALIDO', 'El campo "tema" está vacío');
  return temaId;
}

// ---------- Revisión ----------

const incluirRevision = {
  tema: { select: { id: true, nombre: true, contenido: { select: { id: true, titulo: true } } } },
  opciones: { orderBy: { orden: 'asc' } },
  duplicadaDe: { select: { id: true, enunciado: true, estado: true } },
  _count: { select: { reportes: { where: { resuelto: false } } } },
} satisfies Prisma.PreguntaInclude;

type PreguntaConRelaciones = Prisma.PreguntaGetPayload<{ include: typeof incluirRevision }>;

function aRevision(p: PreguntaConRelaciones): PreguntaRevision {
  return {
    id: p.id,
    tipo: p.tipo,
    dificultad: p.dificultad,
    nivelBloom: p.nivelBloom,
    enunciado: p.enunciado,
    explicacion: p.explicacion,
    citaTextual: p.citaTextual,
    referencia: p.referencia,
    etiquetas: p.etiquetas,
    estado: p.estado,
    origen: p.origen,
    fragmentoRef: p.fragmentoRef,
    creadoEn: p.creadoEn.toISOString(),
    tema: p.tema,
    opciones: p.opciones.map(({ id, texto, correcta, porQue, orden }) => ({ id, texto, correcta, porQue, orden })),
    alertas: p.alertas,
    validada: p.validadoEn !== null,
    ciega: (p.ciega as PreguntaRevision['ciega']) ?? null,
    duplicadaDe: p.duplicadaDe ? { ...p.duplicadaDe, similitud: p.similitud } : null,
    reportesAbiertos: p._count.reportes,
  };
}

export async function listarRevision(f: RevisionFiltro): Promise<Paginado<PreguntaRevision>> {
  const where: Prisma.PreguntaWhereInput = {
    estado: f.estado,
    ...(f.temaId && { temaId: f.temaId }),
    ...(f.contenidoId && { tema: { contenidoId: f.contenidoId } }),
  };
  const [total, items] = await prisma.$transaction([
    prisma.pregunta.count({ where }),
    prisma.pregunta.findMany({
      where,
      include: incluirRevision,
      orderBy: [{ creadoEn: 'asc' }, { id: 'asc' }],
      skip: (f.pagina - 1) * f.porPagina,
      take: f.porPagina,
    }),
  ]);
  return { items: items.map(aRevision), total, pagina: f.pagina, porPagina: f.porPagina };
}

export async function obtenerPregunta(id: string): Promise<PreguntaRevision> {
  const p = await prisma.pregunta.findUnique({ where: { id }, include: incluirRevision });
  if (!p) throw noEncontrado('La pregunta');
  return aRevision(p);
}

export async function editarPregunta(id: string, datos: PreguntaEditar): Promise<PreguntaRevision> {
  const actual = await prisma.pregunta.findUnique({
    where: { id },
    select: { tipo: true, estado: true, _count: { select: { respuestas: true } } },
  });
  if (!actual) throw noEncontrado('La pregunta');

  const { opciones, ...campos } = datos;
  if (opciones) {
    const r = opcionesSchemaPara(actual.tipo).safeParse(opciones);
    if (!r.success) {
      throw new ErrorApp(400, 'VALIDACION', 'Las opciones no cumplen las reglas del tipo', issuesZod(r.error));
    }
    if (actual._count.respuestas > 0) {
      throw conflicto('La pregunta ya tiene respuestas; no se pueden reemplazar sus opciones');
    }
  }

  await prisma.$transaction(async (tx) => {
    if (opciones) {
      await tx.opcion.deleteMany({ where: { preguntaId: id } });
      await tx.opcion.createMany({
        data: opciones.map((o, orden) => ({
          preguntaId: id,
          texto: o.texto,
          correcta: o.correcta,
          porQue: o.porQue ?? null,
          orden,
        })),
      });
    }
    // Cambió lo que se valida: vuelve a pasar por embeddings y validador (y deja de estar VALIDADA).
    const cambioContenido = opciones || campos.enunciado || campos.citaTextual || campos.referencia;
    const estado = campos.estado ?? (cambioContenido && actual.estado === 'VALIDADA' ? 'BORRADOR' : undefined);
    await tx.pregunta.update({
      where: { id },
      data: {
        ...campos,
        ...(estado && { estado }),
        // Restaurar una DUPLICADA la desliga de su original.
        ...(actual.estado === 'DUPLICADA' && estado && { duplicadaDeId: null, similitud: null }),
        ...(cambioContenido && { validadoEn: null, alertas: [], ciega: Prisma.DbNull }),
      },
    });
    if (cambioContenido) await tx.$executeRaw`UPDATE "Pregunta" SET embedding = NULL WHERE id = ${id}`;
  });
  return obtenerPregunta(id);
}

/** Aprueba en bloque las preguntas indicadas que estén en BORRADOR o VALIDADA (nunca las DUPLICADA). */
export async function aprobarLote(ids: string[]) {
  const unicos = [...new Set(ids)];
  const { count } = await prisma.pregunta.updateMany({
    where: { id: { in: unicos }, estado: { in: ['BORRADOR', 'VALIDADA'] } },
    data: { estado: 'APROBADA' },
  });
  return { aprobadas: count, omitidas: unicos.length - count };
}

/** Aprueba todas las preguntas en BORRADOR o VALIDADA que cumplan el filtro de la bandeja. */
export async function aprobarTodas(filtro: AprobarTodas) {
  const { count } = await prisma.pregunta.updateMany({
    where: {
      estado: filtro.estado ?? { in: ['BORRADOR', 'VALIDADA'] },
      ...(filtro.temaId && { temaId: filtro.temaId }),
      ...(filtro.contenidoId && { tema: { contenidoId: filtro.contenidoId } }),
    },
    data: { estado: 'APROBADA' },
  });
  return { aprobadas: count };
}
