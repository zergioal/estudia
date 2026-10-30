import type { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { ErrorApp, conflicto, noEncontrado } from '../../errores';
import type {
  ColeccionCrear,
  ColeccionNodo,
  ContenidoCrear,
  TemaCrear,
  TemaNodo,
  coleccionEditarSchema,
  contenidoEditarSchema,
  temaEditarSchema,
} from './esquemas';

type Cliente = Prisma.TransactionClient;

// ---------- Árbol ----------

export async function arbol(): Promise<ColeccionNodo[]> {
  const [colecciones, temas, conteos] = await Promise.all([
    prisma.coleccion.findMany({
      orderBy: { nombre: 'asc' },
      include: { contenidos: { orderBy: { titulo: 'asc' } } },
    }),
    prisma.tema.findMany({ orderBy: [{ orden: 'asc' }, { nombre: 'asc' }] }),
    prisma.pregunta.groupBy({ by: ['temaId'], _count: { _all: true } }),
  ]);

  const totalPorTema = new Map(conteos.map((c) => [c.temaId, c._count._all]));
  const nodos = new Map<string, TemaNodo & { contenidoId: string }>();
  for (const t of temas) {
    nodos.set(t.id, {
      id: t.id,
      nombre: t.nombre,
      orden: t.orden,
      padreId: t.padreId,
      contenidoId: t.contenidoId,
      totalPreguntas: totalPorTema.get(t.id) ?? 0,
      hijos: [],
    });
  }
  const raicesPorContenido = new Map<string, TemaNodo[]>();
  for (const nodo of nodos.values()) {
    const padre = nodo.padreId ? nodos.get(nodo.padreId) : undefined;
    if (padre) padre.hijos.push(nodo);
    else {
      const lista = raicesPorContenido.get(nodo.contenidoId) ?? [];
      lista.push(nodo);
      raicesPorContenido.set(nodo.contenidoId, lista);
    }
  }

  return colecciones.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    descripcion: c.descripcion,
    contenidos: c.contenidos.map((ct) => ({
      id: ct.id,
      titulo: ct.titulo,
      tipoFuente: ct.tipoFuente,
      publicado: ct.publicado,
      temas: raicesPorContenido.get(ct.id) ?? [],
    })),
  }));
}

// ---------- Colección ----------

export const crearColeccion = (datos: ColeccionCrear) => prisma.coleccion.create({ data: datos });

export const editarColeccion = (id: string, datos: z.infer<typeof coleccionEditarSchema>) =>
  prisma.coleccion.update({ where: { id }, data: datos });

export async function eliminarColeccion(id: string) {
  const c = await prisma.coleccion.findUnique({
    where: { id },
    include: { _count: { select: { contenidos: true } } },
  });
  if (!c) throw noEncontrado('La colección');
  if (c._count.contenidos > 0) {
    throw conflicto('La colección tiene contenidos; muévelos o elimínalos primero');
  }
  await prisma.$transaction([
    prisma.asignacion.deleteMany({ where: { coleccionId: id } }),
    prisma.coleccion.delete({ where: { id } }),
  ]);
}

// ---------- Contenido ----------

export async function crearContenido(datos: ContenidoCrear) {
  await asegurarColeccion(datos.coleccionId);
  return prisma.contenido.create({ data: datos });
}

export async function editarContenido(id: string, datos: z.infer<typeof contenidoEditarSchema>) {
  if (datos.coleccionId) await asegurarColeccion(datos.coleccionId);
  return prisma.contenido.update({ where: { id }, data: datos });
}

export async function eliminarContenido(id: string) {
  const c = await prisma.contenido.findUnique({
    where: { id },
    include: { _count: { select: { documentos: true } } },
  });
  if (!c) throw noEncontrado('El contenido');
  const preguntas = await prisma.pregunta.count({ where: { tema: { contenidoId: id } } });
  if (preguntas > 0) throw conflicto(`El contenido tiene ${preguntas} preguntas; no se puede eliminar`);
  if (c._count.documentos > 0) throw conflicto('El contenido tiene documentos; no se puede eliminar');
  await prisma.$transaction([
    prisma.tema.updateMany({ where: { contenidoId: id }, data: { padreId: null } }),
    prisma.tema.deleteMany({ where: { contenidoId: id } }),
    prisma.contenido.delete({ where: { id } }),
  ]);
}

async function asegurarColeccion(id: string) {
  const existe = await prisma.coleccion.count({ where: { id } });
  if (!existe) throw noEncontrado('La colección');
}

// ---------- Tema ----------

export async function crearTema(datos: TemaCrear) {
  const contenido = await prisma.contenido.count({ where: { id: datos.contenidoId } });
  if (!contenido) throw noEncontrado('El contenido');
  const padreId = datos.padreId ?? null;
  if (padreId) await validarPadre(prisma, datos.contenidoId, padreId);
  const orden = datos.orden ?? (await siguienteOrden(prisma, datos.contenidoId, padreId));
  return prisma.tema.create({
    data: { contenidoId: datos.contenidoId, padreId, nombre: datos.nombre, orden },
  });
}

export async function editarTema(id: string, datos: z.infer<typeof temaEditarSchema>) {
  const tema = await prisma.tema.findUnique({ where: { id } });
  if (!tema) throw noEncontrado('El tema');
  if (datos.padreId) {
    await validarPadre(prisma, tema.contenidoId, datos.padreId);
    if (await esDescendiente(datos.padreId, id)) {
      throw new ErrorApp(400, 'JERARQUIA_INVALIDA', 'Un tema no puede moverse dentro de sí mismo');
    }
  }
  return prisma.tema.update({ where: { id }, data: datos });
}

export async function eliminarTema(id: string) {
  const tema = await prisma.tema.findUnique({
    where: { id },
    include: { _count: { select: { hijos: true, preguntas: true, fragmentos: true } } },
  });
  if (!tema) throw noEncontrado('El tema');
  const { hijos, preguntas, fragmentos } = tema._count;
  if (hijos > 0) throw conflicto('El tema tiene subtemas; elimínalos primero');
  if (preguntas > 0) throw conflicto(`El tema tiene ${preguntas} preguntas; no se puede eliminar`);
  if (fragmentos > 0) throw conflicto('El tema tiene fragmentos; no se puede eliminar');
  await prisma.tema.delete({ where: { id } });
}

async function validarPadre(db: Cliente, contenidoId: string, padreId: string) {
  const padre = await db.tema.findUnique({ where: { id: padreId }, select: { contenidoId: true } });
  if (!padre) throw noEncontrado('El tema padre');
  if (padre.contenidoId !== contenidoId) {
    throw new ErrorApp(400, 'JERARQUIA_INVALIDA', 'El tema padre pertenece a otro contenido');
  }
}

/** ¿`candidatoId` es `temaId` o uno de sus descendientes? (evita ciclos al mover) */
async function esDescendiente(candidatoId: string, temaId: string): Promise<boolean> {
  let actual: string | null = candidatoId;
  const vistos = new Set<string>();
  while (actual && !vistos.has(actual)) {
    if (actual === temaId) return true;
    vistos.add(actual);
    const t: { padreId: string | null } | null = await prisma.tema.findUnique({
      where: { id: actual },
      select: { padreId: true },
    });
    actual = t?.padreId ?? null;
  }
  return false;
}

export async function siguienteOrden(db: Cliente, contenidoId: string, padreId: string | null) {
  const max = await db.tema.aggregate({ where: { contenidoId, padreId }, _max: { orden: true } });
  return (max._max.orden ?? -1) + 1;
}
