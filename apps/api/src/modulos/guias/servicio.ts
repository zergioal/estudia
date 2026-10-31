import type { GuiaContenido, GuiaDetalle, GuiaResumida, ParteLectura } from '@estudia/shared';
import { prisma } from '../../db';
import { noEncontrado } from '../../errores';
import type { UsuarioToken } from '../../middleware/auth';
import { TIPOS_EN_QUIZ, filtroContenidos } from '../quiz/servicio';

/** Preguntas aprobadas (que entran a un quiz) por contenido. */
async function disponiblesPorContenido(ids: string[]) {
  const filas = await prisma.pregunta.findMany({
    where: { estado: 'APROBADA', tipo: { in: TIPOS_EN_QUIZ }, tema: { contenidoId: { in: ids } } },
    select: { tema: { select: { contenidoId: true } } },
  });
  const conteo = new Map<string, number>();
  for (const f of filas) conteo.set(f.tema.contenidoId, (conteo.get(f.tema.contenidoId) ?? 0) + 1);
  return conteo;
}

const extracto = (texto: string, max = 220) => (texto.length <= max ? texto : `${texto.slice(0, max).replace(/\s+\S*$/, '')}…`);

export async function listar(u: UsuarioToken): Promise<GuiaResumida[]> {
  const contenidos = await prisma.contenido.findMany({
    where: filtroContenidos(u),
    include: { coleccion: true, guia: true },
    orderBy: { titulo: 'asc' },
  });
  const disponibles = await disponiblesPorContenido(contenidos.map((c) => c.id));
  return contenidos.map((c) => ({
    contenidoId: c.id,
    titulo: c.titulo,
    tipoFuente: c.tipoFuente,
    coleccion: c.coleccion.nombre,
    disponibles: disponibles.get(c.id) ?? 0,
    tieneGuia: c.guia !== null,
    extracto: c.guia ? extracto(c.guia.resumen) : null,
    obligatorias: c.guia ? (c.guia.obligatorio as unknown as ParteLectura[]).length : 0,
    opcionales: c.guia ? (c.guia.opcional as unknown as ParteLectura[]).length : 0,
  }));
}

export async function obtener(u: UsuarioToken, contenidoId: string): Promise<GuiaDetalle> {
  const c = await prisma.contenido.findFirst({
    where: { AND: [{ id: contenidoId }, filtroContenidos(u)] },
    include: { coleccion: true, guia: true },
  });
  if (!c) throw noEncontrado('El documento');
  if (!c.guia) throw noEncontrado('La guía de estudio de este documento');
  const disponibles = await disponiblesPorContenido([c.id]);
  return {
    contenidoId: c.id,
    titulo: c.titulo,
    tipoFuente: c.tipoFuente,
    coleccion: c.coleccion.nombre,
    disponibles: disponibles.get(c.id) ?? 0,
    resumen: c.guia.resumen,
    ideasClave: c.guia.ideasClave,
    obligatorio: c.guia.obligatorio as unknown as ParteLectura[],
    opcional: c.guia.opcional as unknown as ParteLectura[],
    consejos: c.guia.consejos,
    actualizadoEn: c.guia.actualizadoEn.toISOString(),
  };
}

/** Crea o reemplaza la guía de un contenido. */
export async function guardar(contenidoId: string, datos: GuiaContenido) {
  const c = await prisma.contenido.findUnique({ where: { id: contenidoId } });
  if (!c) throw noEncontrado('El documento');
  const campos = {
    resumen: datos.resumen,
    ideasClave: datos.ideasClave,
    obligatorio: datos.obligatorio,
    opcional: datos.opcional,
    consejos: datos.consejos,
  };
  return prisma.guiaEstudio.upsert({
    where: { contenidoId },
    create: { contenidoId, ...campos },
    update: campos,
  });
}

/** Igual que guardar, pero identificando el documento por su clave (la usa scripts/guias.ts). */
export async function guardarPorClave(clave: string, datos: GuiaContenido) {
  const c = await prisma.contenido.findUnique({ where: { clave } });
  if (!c) throw noEncontrado(`El documento con clave "${clave}"`);
  await guardar(c.id, datos);
  return c;
}
