import type { Prisma, TipoPregunta } from '@prisma/client';
import { prisma } from '../../db';
import { ErrorApp, conflicto, noEncontrado } from '../../errores';
import type { UsuarioToken } from '../../middleware/auth';
import { DIAS_DOMINIO, proximaRevision, siguienteEstado } from './srs';
import {
  BONUS_RECUPERADA,
  SIMULACRO,
  XP_POR_DIFICULTAD,
  bloqueDeFuente,
  type ColeccionEstudio,
  type DominioContenido,
  type ErrorCuaderno,
  type Feedback,
  type Panel,
  type PreguntaQuiz,
  type Progreso,
  type RepasoHoy,
  type QuizCrear,
  type QuizEstado,
  type RespuestaEnviar,
  type RespuestaRegistrada,
  type ResultadoSimulacro,
  type ResumenQuiz,
  type TemaEstudio,
} from './esquemas';

/**
 * Formato del examen de institucionalización: opción múltiple con 4 opciones y 1 correcta.
 * Los demás tipos pueden quedar en el banco, pero no entran a los quizzes.
 */
export const TIPOS_EN_QUIZ: TipoPregunta[] = ['OPCION_MULTIPLE'];

// ---------- Fechas (Bolivia, UTC-4 sin horario de verano) ----------

const DESFASE_BOLIVIA_MS = -4 * 60 * 60 * 1000;
export const diaBolivia = (d: Date) => new Date(d.getTime() + DESFASE_BOLIVIA_MS).toISOString().slice(0, 10);
function inicioDelDiaBolivia(d: Date) {
  return new Date(new Date(`${diaBolivia(d)}T00:00:00.000Z`).getTime() - DESFASE_BOLIVIA_MS);
}
/** Fin del día de hoy en Bolivia: todo lo que vence antes entra al repaso de hoy. */
const finDelDiaBolivia = (d: Date) => new Date(inicioDelDiaBolivia(d).getTime() + 86_400_000);
const diasEntre = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Racha que corresponde al estudiar `ahora`, dado el último día de estudio. */
export function nuevaRacha(racha: number, ultimoEstudio: Date | null, ahora: Date) {
  if (!ultimoEstudio) return 1;
  const d = diasEntre(diaBolivia(ultimoEstudio), diaBolivia(ahora));
  if (d <= 0) return Math.max(racha, 1);
  return d === 1 ? racha + 1 : 1;
}

/** La racha mostrada se corta si ayer no se estudió. */
function rachaVigente(racha: number, ultimoEstudio: Date | null, ahora = new Date()) {
  if (!ultimoEstudio) return 0;
  return diasEntre(diaBolivia(ultimoEstudio), diaBolivia(ahora)) <= 1 ? racha : 0;
}

function barajar<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// ---------- Acceso ----------

/** ADMIN y REVISOR ven todo; un ESTUDIANTE, los contenidos publicados de sus colecciones asignadas vigentes. */
export function filtroContenidos(u: UsuarioToken): Prisma.ContenidoWhereInput {
  if (u.rol !== 'ESTUDIANTE') return {};
  return {
    publicado: true,
    coleccion: { asignaciones: { some: { usuarioId: u.id, OR: [{ venceEn: null }, { venceEn: { gt: new Date() } }] } } },
  };
}

// ---------- Árbol para elegir qué estudiar ----------

export async function arbolEstudio(u: UsuarioToken): Promise<ColeccionEstudio[]> {
  const contenidos = await prisma.contenido.findMany({
    where: filtroContenidos(u),
    include: { coleccion: true, temas: { orderBy: [{ orden: 'asc' }, { nombre: 'asc' }] } },
    orderBy: { titulo: 'asc' },
  });
  const conteos = await prisma.pregunta.groupBy({
    by: ['temaId'],
    where: { estado: 'APROBADA', tipo: { in: TIPOS_EN_QUIZ }, tema: { contenidoId: { in: contenidos.map((c) => c.id) } } },
    _count: { _all: true },
  });
  const propias = new Map(conteos.map((c) => [c.temaId, c._count._all]));

  const colecciones = new Map<string, ColeccionEstudio>();
  for (const c of contenidos) {
    const nodos = new Map<string, TemaEstudio & { padreId: string | null }>();
    for (const t of c.temas) nodos.set(t.id, { id: t.id, nombre: t.nombre, disponibles: propias.get(t.id) ?? 0, hijos: [], padreId: t.padreId });
    const raices: TemaEstudio[] = [];
    for (const n of nodos.values()) {
      const padre = n.padreId ? nodos.get(n.padreId) : undefined;
      if (padre) padre.hijos.push(n);
      else raices.push(n);
    }
    // Los totales incluyen los subtemas.
    const sumar = (t: TemaEstudio): number => (t.disponibles += t.hijos.reduce((s, h) => s + sumar(h), 0));
    const limpiar = (t: TemaEstudio & { padreId?: string | null }): TemaEstudio => ({
      id: t.id,
      nombre: t.nombre,
      disponibles: t.disponibles,
      hijos: t.hijos.map(limpiar),
    });
    const disponibles = raices.reduce((s, r) => s + sumar(r), 0);
    const col = colecciones.get(c.coleccionId) ?? { id: c.coleccionId, nombre: c.coleccion.nombre, contenidos: [] };
    col.contenidos.push({ id: c.id, titulo: c.titulo, tipoFuente: c.tipoFuente, disponibles, temas: raices.map(limpiar) });
    colecciones.set(c.coleccionId, col);
  }
  return [...colecciones.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

// ---------- Selección de preguntas ----------

type EstadoCandidata = { aciertos: number; fallos: number; intervaloDias: number; proximaRevision: Date } | null;
type Candidata = { id: string; temaId: string; estado: EstadoCandidata };

const vencida = (e: EstadoCandidata, hasta: Date) => e !== null && e.aciertos + e.fallos > 0 && e.proximaRevision < hasta;
const pendienteDeError = (e: EstadoCandidata) => e !== null && e.fallos > 0 && e.intervaloDias < DIAS_DOMINIO;

/** Toma n por turnos entre grupos (temas), para no concentrarse en uno solo. */
function porTurnos<T>(items: T[], grupo: (x: T) => string, n: number): T[] {
  const colas = new Map<string, T[]>();
  for (const x of items) colas.set(grupo(x), [...(colas.get(grupo(x)) ?? []), x]);
  const lista = barajar([...colas.values()]);
  const salida: T[] = [];
  while (salida.length < n && lista.some((c) => c.length)) {
    for (const c of lista) {
      const x = c.shift();
      if (x) salida.push(x);
      if (salida.length === n) break;
    }
  }
  return salida;
}

/**
 * Práctica (docs/diseno.md, "Selección de preguntas"): 40% repaso vencido (los más atrasados primero),
 * 30% de temas débiles (dominio < 60%), 30% nuevas repartidas entre temas; lo que falte se completa al azar.
 * Repaso del día: solo vencidas. Cuaderno de errores: falladas aún no dominadas (o las indicadas).
 */
export function seleccionar<T extends Candidata>(candidatas: T[], modo: string, n: number, explicitas = false, ahora = new Date()): T[] {
  const hasta = finDelDiaBolivia(ahora);
  const masAtrasadas = (a: T, b: T) => a.estado!.proximaRevision.getTime() - b.estado!.proximaRevision.getTime();
  if (modo === 'REPASO_DIARIO') return candidatas.filter((c) => vencida(c.estado, hasta)).sort(masAtrasadas).slice(0, n);
  if (modo === 'REPASO_ERRORES') {
    const pool = explicitas ? candidatas : candidatas.filter((c) => pendienteDeError(c.estado));
    return barajar(pool)
      .sort((a, b) => (b.estado?.fallos ?? 0) - (a.estado?.fallos ?? 0))
      .slice(0, n);
  }

  const elegidas: T[] = [];
  const usadas = new Set<string>();
  const tomar = (lista: T[]) => {
    for (const c of lista) {
      if (usadas.has(c.id)) continue;
      usadas.add(c.id);
      elegidas.push(c);
    }
  };
  // Dominio por tema dentro de las candidatas.
  const porTema = new Map<string, { total: number; dominadas: number; vistas: number }>();
  for (const c of candidatas) {
    const t = porTema.get(c.temaId) ?? { total: 0, dominadas: 0, vistas: 0 };
    t.total++;
    if (c.estado && c.estado.aciertos + c.estado.fallos > 0) t.vistas++;
    if (c.estado && c.estado.intervaloDias >= DIAS_DOMINIO) t.dominadas++;
    porTema.set(c.temaId, t);
  }
  const temaDebil = (temaId: string) => {
    const t = porTema.get(temaId)!;
    return t.vistas > 0 && t.dominadas / t.total < 0.6;
  };

  const cupoVencidas = Math.round(n * 0.4);
  const cupoDebiles = Math.round(n * 0.3);
  tomar(candidatas.filter((c) => vencida(c.estado, hasta)).sort(masAtrasadas).slice(0, cupoVencidas));
  tomar(
    barajar(
      candidatas.filter(
        (c) => !usadas.has(c.id) && temaDebil(c.temaId) && c.estado !== null && c.estado.intervaloDias < DIAS_DOMINIO,
      ),
    ).slice(0, cupoDebiles),
  );
  const nuevas = candidatas.filter((c) => !usadas.has(c.id) && (c.estado === null || c.estado.aciertos + c.estado.fallos === 0));
  tomar(porTurnos(nuevas, (c) => c.temaId, n - elegidas.length));
  if (elegidas.length < n) {
    // Completar: primero lo no dominado, luego el resto, al azar.
    const resto = barajar(candidatas.filter((c) => !usadas.has(c.id)));
    resto.sort((a, b) => Number((a.estado?.intervaloDias ?? 0) >= DIAS_DOMINIO) - Number((b.estado?.intervaloDias ?? 0) >= DIAS_DOMINIO));
    tomar(resto.slice(0, n - elegidas.length));
  }
  return elegidas.slice(0, n);
}

// ---------- Crear ----------

export async function crearQuiz(u: UsuarioToken, datos: QuizCrear): Promise<QuizEstado> {
  const visibles = await prisma.contenido.findMany({ where: filtroContenidos(u), select: { id: true, titulo: true } });
  const idsVisibles = new Set(visibles.map((c) => c.id));
  if (datos.contenidoIds.some((id) => !idsVisibles.has(id))) throw noEncontrado('Alguno de los contenidos');

  // Temas: los de los contenidos elegidos + los temas elegidos con todos sus descendientes.
  const temas = await prisma.tema.findMany({
    where: { contenidoId: { in: [...idsVisibles] } },
    select: { id: true, padreId: true, contenidoId: true },
  });
  const hijosDe = new Map<string, string[]>();
  for (const t of temas) if (t.padreId) hijosDe.set(t.padreId, [...(hijosDe.get(t.padreId) ?? []), t.id]);
  const sinFiltros = datos.contenidoIds.length === 0 && datos.temaIds.length === 0;
  const idsTemas = new Set(temas.filter((t) => sinFiltros || datos.contenidoIds.includes(t.contenidoId)).map((t) => t.id));
  const existentes = new Set(temas.map((t) => t.id));
  for (const id of datos.temaIds) {
    if (!existentes.has(id)) throw noEncontrado('Alguno de los temas');
    for (const pila = [id]; pila.length; ) {
      const x = pila.pop()!;
      idsTemas.add(x);
      pila.push(...(hijosDe.get(x) ?? []));
    }
  }

  const candidatas = await prisma.pregunta.findMany({
    where: {
      estado: 'APROBADA',
      tipo: { in: TIPOS_EN_QUIZ },
      temaId: { in: [...idsTemas] },
      ...(datos.dificultades.length && { dificultad: { in: datos.dificultades } }),
      ...(datos.preguntaIds.length && { id: { in: datos.preguntaIds } }),
    },
    select: {
      id: true,
      temaId: true,
      tema: { select: { contenidoId: true } },
      opciones: { select: { id: true } },
      estados: { where: { usuarioId: u.id }, select: { aciertos: true, fallos: true, intervaloDias: true, proximaRevision: true } },
    },
  });
  if (candidatas.length === 0) {
    throw new ErrorApp(409, 'SIN_PREGUNTAS', 'No hay preguntas aprobadas para esos filtros');
  }
  const conEstado = candidatas.map((p) => ({ ...p, estado: p.estados[0] ?? null }));
  const elegidas = barajar(seleccionar(conEstado, datos.modo, datos.cantidad, datos.preguntaIds.length > 0));
  if (elegidas.length === 0) {
    throw datos.modo === 'REPASO_DIARIO'
      ? new ErrorApp(409, 'SIN_REPASO', 'No tienes repasos pendientes para hoy')
      : new ErrorApp(409, 'SIN_ERRORES', 'No tienes errores pendientes de repasar');
  }

  const titulos = visibles.filter((c) => elegidas.some((p) => p.tema.contenidoId === c.id)).map((c) => c.titulo);
  const intento = await prisma.intento.create({
    data: {
      usuarioId: u.id,
      modo: datos.modo,
      filtros: {
        contenidoIds: datos.contenidoIds,
        temaIds: datos.temaIds,
        dificultades: datos.dificultades,
        cantidadPedida: datos.cantidad,
        contenidos: titulos,
      },
      cantidad: elegidas.length,
      respuestas: {
        create: elegidas.map((p, orden) => ({
          preguntaId: p.id,
          orden,
          ordenOpciones: barajar(p.opciones.map((o) => o.id)),
          opcionesElegidas: [],
        })),
      },
    },
  });
  return obtenerQuiz(u, intento.id);
}

// ---------- Simulacro de examen ----------

const MS_SIMULACRO = SIMULACRO.minutos * 60_000;
/** Margen para respuestas que salieron justo antes del límite (latencia de red). */
const GRACIA_MS = 30_000;
const limiteDe = (i: { modo: string; iniciadoEn: Date }) =>
  i.modo === 'SIMULACRO' ? new Date(i.iniciadoEn.getTime() + MS_SIMULACRO) : null;

/**
 * Reparte n preguntas entre los documentos por turnos (round robin), para que el simulacro abarque toda
 * la bibliografía y no solo los documentos con más preguntas.
 */
function repartir<T extends { contenidoId: string }>(preguntas: T[], n: number): T[] {
  const porDoc = new Map<string, T[]>();
  for (const p of barajar(preguntas)) porDoc.set(p.contenidoId, [...(porDoc.get(p.contenidoId) ?? []), p]);
  const colas = barajar([...porDoc.values()]);
  const elegidas: T[] = [];
  while (elegidas.length < n && colas.some((c) => c.length)) {
    for (const c of colas) {
      const p = c.shift();
      if (p) elegidas.push(p);
      if (elegidas.length === n) break;
    }
  }
  return elegidas;
}

/** 100 preguntas de toda la bibliografía visible: 35% normativa y 65% técnico-pedagógico. */
export async function crearSimulacro(u: UsuarioToken): Promise<QuizEstado> {
  const candidatas = (
    await prisma.pregunta.findMany({
      where: { estado: 'APROBADA', tipo: { in: TIPOS_EN_QUIZ }, tema: { contenido: filtroContenidos(u) } },
      select: {
        id: true,
        opciones: { select: { id: true } },
        tema: { select: { contenidoId: true, contenido: { select: { titulo: true, tipoFuente: true } } } },
      },
    })
  ).map((p) => ({ ...p, contenidoId: p.tema.contenidoId, bloque: bloqueDeFuente(p.tema.contenido.tipoFuente) }));
  if (candidatas.length === 0) throw new ErrorApp(409, 'SIN_PREGUNTAS', 'No hay preguntas aprobadas para armar un simulacro');

  const total = Math.min(SIMULACRO.preguntas, candidatas.length);
  const normativa = candidatas.filter((p) => p.bloque === 'Normativa');
  const tecnico = candidatas.filter((p) => p.bloque !== 'Normativa');
  // Si un bloque no alcanza, el otro completa el total.
  let nNormativa = Math.min(normativa.length, Math.round((total * SIMULACRO.porcentajeNormativa) / 100));
  const nTecnico = Math.min(tecnico.length, total - nNormativa);
  nNormativa = Math.min(normativa.length, total - nTecnico);
  const elegidas = barajar([...repartir(normativa, nNormativa), ...repartir(tecnico, nTecnico)]);

  const intento = await prisma.intento.create({
    data: {
      usuarioId: u.id,
      modo: 'SIMULACRO',
      filtros: {
        simulacro: true,
        normativa: nNormativa,
        tecnico: nTecnico,
        contenidos: ['Simulacro de examen'],
      },
      cantidad: elegidas.length,
      respuestas: {
        create: elegidas.map((p, orden) => ({
          preguntaId: p.id,
          orden,
          ordenOpciones: barajar(p.opciones.map((o) => o.id)),
          opcionesElegidas: [],
        })),
      },
    },
  });
  return obtenerQuiz(u, intento.id);
}

/** Si el tiempo del simulacro se agotó, lo cierra (las no respondidas cuentan como error). */
async function cerrarSiVencio(i: { id: string; modo: string; iniciadoEn: Date; finalizadoEn: Date | null }) {
  const limite = limiteDe(i);
  if (!limite || i.finalizadoEn || Date.now() <= limite.getTime() + GRACIA_MS) return false;
  await prisma.intento.updateMany({ where: { id: i.id, finalizadoEn: null }, data: { finalizadoEn: limite } });
  return true;
}

// ---------- Consultar ----------

const incluirQuiz = {
  respuestas: {
    orderBy: { orden: 'asc' },
    include: {
      pregunta: {
        include: {
          opciones: true,
          tema: { select: { nombre: true, contenido: { select: { titulo: true, tipoFuente: true } } } },
        },
      },
    },
  },
} satisfies Prisma.IntentoInclude;
type IntentoCompleto = Prisma.IntentoGetPayload<{ include: typeof incluirQuiz }>;
type RespuestaCompleta = IntentoCompleto['respuestas'][number];

async function intentoPropio(u: UsuarioToken, id: string): Promise<IntentoCompleto> {
  const intento = await prisma.intento.findFirst({ where: { id, usuarioId: u.id }, include: incluirQuiz });
  if (!intento) throw noEncontrado('El quiz');
  if (await cerrarSiVencio(intento)) return intentoPropio(u, id);
  return intento;
}

/** Opciones en el orden barajado del intento (las agregadas después de crearlo van al final). */
function opcionesOrdenadas(r: RespuestaCompleta) {
  const porId = new Map(r.pregunta.opciones.map((o) => [o.id, o]));
  const ordenadas = r.ordenOpciones.map((id) => porId.get(id)).filter((o) => o !== undefined);
  const resto = r.pregunta.opciones.filter((o) => !r.ordenOpciones.includes(o.id)).sort((a, b) => a.orden - b.orden);
  return [...ordenadas, ...resto];
}

function feedbackDe(r: RespuestaCompleta, proximoRepasoDias: number | null = null): Feedback {
  return {
    proximoRepasoDias,
    correcta: r.correcta ?? false,
    xp: r.xp,
    opcionesElegidas: r.opcionesElegidas,
    opciones: opcionesOrdenadas(r).map((o) => ({ id: o.id, texto: o.texto, correcta: o.correcta, porQue: o.porQue })),
    explicacion: r.pregunta.explicacion,
    citaTextual: r.pregunta.citaTextual,
    referencia: r.pregunta.referencia,
    fragmentoRef: r.pregunta.fragmentoRef,
  };
}

function aEstado(i: IntentoCompleto): QuizEstado {
  // En el simulacro no se revela nada (ni aciertos ni XP) hasta que termina.
  const oculto = i.modo === 'SIMULACRO' && !i.finalizadoEn;
  const preguntas: PreguntaQuiz[] = i.respuestas.map((r) => ({
    id: r.preguntaId,
    orden: r.orden,
    tipo: r.pregunta.tipo,
    dificultad: r.pregunta.dificultad,
    enunciado: r.pregunta.enunciado,
    tema: r.pregunta.tema.nombre,
    contenido: r.pregunta.tema.contenido.titulo,
    // Antes de responder NUNCA viajan `correcta` ni `porQue`.
    opciones: opcionesOrdenadas(r).map((o) => ({ id: o.id, texto: o.texto })),
    respondida: r.respondidaEn !== null,
    opcionesElegidas: r.opcionesElegidas,
    feedback: r.respondidaEn && !oculto ? feedbackDe(r) : null,
  }));
  const limite = limiteDe(i);
  return {
    id: i.id,
    modo: i.modo,
    cantidad: i.cantidad,
    puntaje: oculto ? 0 : i.puntaje,
    aciertos: oculto ? 0 : i.aciertos,
    respondidas: i.respuestas.filter((r) => r.respondidaEn).length,
    iniciadoEn: i.iniciadoEn.toISOString(),
    finalizadoEn: i.finalizadoEn?.toISOString() ?? null,
    limiteEn: limite?.toISOString() ?? null,
    preguntas,
  };
}

export async function obtenerQuiz(u: UsuarioToken, id: string): Promise<QuizEstado> {
  return aEstado(await intentoPropio(u, id));
}

// ---------- Responder ----------

export async function responder(
  u: UsuarioToken,
  id: string,
  datos: RespuestaEnviar,
): Promise<Feedback | RespuestaRegistrada> {
  const intento = await intentoPropio(u, id);
  if (intento.finalizadoEn) {
    throw intento.modo === 'SIMULACRO' ? conflicto('El tiempo del simulacro terminó o ya fue finalizado') : conflicto('El quiz ya fue finalizado');
  }
  const r = intento.respuestas.find((x) => x.preguntaId === datos.preguntaId);
  if (!r) throw noEncontrado('La pregunta en este quiz');
  if (r.respondidaEn) throw conflicto('Esa pregunta ya fue respondida');

  const elegidas = [...new Set(datos.opcionIds)];
  const idsOpciones = new Set(r.pregunta.opciones.map((o) => o.id));
  if (elegidas.some((o) => !idsOpciones.has(o))) {
    throw new ErrorApp(400, 'VALIDACION', 'Alguna opción no pertenece a la pregunta');
  }
  if (r.pregunta.tipo !== 'SELECCION_MULTIPLE' && elegidas.length !== 1) {
    throw new ErrorApp(400, 'VALIDACION', 'Esta pregunta admite una sola opción');
  }
  const correctas = r.pregunta.opciones.filter((o) => o.correcta).map((o) => o.id);
  const correcta = elegidas.length === correctas.length && elegidas.every((o) => correctas.includes(o));

  const ahora = new Date();
  const [estadoPrevio, usuario] = await Promise.all([
    prisma.estadoEstudio.findUnique({ where: { usuarioId_preguntaId: { usuarioId: u.id, preguntaId: r.preguntaId } } }),
    prisma.usuario.findUniqueOrThrow({ where: { id: u.id }, select: { rachaDias: true, ultimoEstudio: true } }),
  ]);
  const nuevoSrs = siguienteEstado(estadoPrevio, correcta, datos.confianza);
  const base = XP_POR_DIFICULTAD[r.pregunta.dificultad];
  const xp = correcta ? Math.round(base * (estadoPrevio && estadoPrevio.fallos > 0 ? BONUS_RECUPERADA : 1)) : 0;

  await prisma.$transaction(async (tx) => {
    // Evita doble respuesta si llegan dos peticiones a la vez.
    const { count } = await tx.respuesta.updateMany({
      where: { id: r.id, respondidaEn: null },
      data: {
        opcionesElegidas: elegidas,
        correcta,
        xp,
        segundos: datos.segundos ?? null,
        confianza: datos.confianza ?? null,
        respondidaEn: ahora,
      },
    });
    if (count === 0) throw conflicto('Esa pregunta ya fue respondida');
    await tx.intento.update({
      where: { id },
      data: { puntaje: { increment: xp }, aciertos: { increment: correcta ? 1 : 0 } },
    });
    await tx.pregunta.update({
      where: { id: r.preguntaId },
      data: { vecesRespondida: { increment: 1 }, vecesAcertada: { increment: correcta ? 1 : 0 } },
    });
    const srs = {
      facilidad: nuevoSrs.facilidad,
      intervaloDias: nuevoSrs.intervaloDias,
      proximaRevision: proximaRevision(ahora, nuevoSrs.intervaloDias),
      ultimaRespuesta: ahora,
    };
    await tx.estadoEstudio.upsert({
      where: { usuarioId_preguntaId: { usuarioId: u.id, preguntaId: r.preguntaId } },
      create: { usuarioId: u.id, preguntaId: r.preguntaId, aciertos: correcta ? 1 : 0, fallos: correcta ? 0 : 1, ...srs },
      update: { aciertos: { increment: correcta ? 1 : 0 }, fallos: { increment: correcta ? 0 : 1 }, ...srs },
    });
    await tx.usuario.update({
      where: { id: u.id },
      data: {
        xpTotal: { increment: xp },
        rachaDias: nuevaRacha(usuario.rachaDias, usuario.ultimoEstudio, ahora),
        ultimoEstudio: ahora,
      },
    });
  });

  if (intento.modo === 'SIMULACRO') return { registrada: true, preguntaId: r.preguntaId, opcionIds: elegidas };
  return feedbackDe({ ...r, opcionesElegidas: elegidas, correcta, xp, respondidaEn: ahora }, nuevoSrs.intervaloDias);
}

// ---------- Finalizar y resumen ----------

export async function finalizar(u: UsuarioToken, id: string): Promise<ResumenQuiz> {
  const intento = await intentoPropio(u, id);
  if (!intento.finalizadoEn) await prisma.intento.update({ where: { id }, data: { finalizadoEn: new Date() } });
  return resumen(u, id);
}

export async function resumen(u: UsuarioToken, id: string): Promise<ResumenQuiz> {
  const i = await intentoPropio(u, id);
  if (i.modo === 'SIMULACRO' && !i.finalizadoEn) throw conflicto('El simulacro sigue en curso');
  const usuario = await prisma.usuario.findUniqueOrThrow({
    where: { id: u.id },
    select: { xpTotal: true, rachaDias: true, ultimoEstudio: true },
  });
  const respondidas = i.respuestas.filter((r) => r.respondidaEn);
  const esSimulacro = i.modo === 'SIMULACRO';
  const porTema = new Map<string, { tema: string; contenido: string; total: number; aciertos: number }>();
  for (const r of respondidas) {
    const clave = `${r.pregunta.tema.contenido.titulo}|${r.pregunta.tema.nombre}`;
    const t = porTema.get(clave) ?? { tema: r.pregunta.tema.nombre, contenido: r.pregunta.tema.contenido.titulo, total: 0, aciertos: 0 };
    t.total++;
    if (r.correcta) t.aciertos++;
    porTema.set(clave, t);
  }
  const conTiempo = respondidas.filter((r) => r.segundos !== null);
  const textoDe = (r: RespuestaCompleta, ids: string[]) =>
    opcionesOrdenadas(r).filter((o) => ids.includes(o.id)).map((o) => o.texto);

  return {
    id: i.id,
    cantidad: i.cantidad,
    respondidas: respondidas.length,
    aciertos: i.aciertos,
    // En el simulacro las no respondidas cuentan como error, igual que en el examen real.
    porcentaje: esSimulacro
      ? Math.round((i.aciertos / Math.max(1, i.cantidad)) * 100)
      : respondidas.length
        ? Math.round((i.aciertos / respondidas.length) * 100)
        : 0,
    puntaje: i.puntaje,
    segundosPromedio: conTiempo.length
      ? Math.round(conTiempo.reduce((s, r) => s + (r.segundos ?? 0), 0) / conTiempo.length)
      : null,
    porTema: [...porTema.values()].sort((a, b) => a.aciertos / a.total - b.aciertos / b.total),
    falladas: (esSimulacro ? i.respuestas : respondidas)
      .filter((r) => !r.correcta)
      .map((r) => ({
        preguntaId: r.preguntaId,
        enunciado: r.pregunta.enunciado,
        contenido: r.pregunta.tema.contenido.titulo,
        sinResponder: !r.respondidaEn,
        elegida: textoDe(r, r.opcionesElegidas),
        correctas: textoDe(r, r.pregunta.opciones.filter((o) => o.correcta).map((o) => o.id)),
        explicacion: r.pregunta.explicacion,
        citaTextual: r.pregunta.citaTextual,
        referencia: r.pregunta.referencia,
      })),
    xpTotal: usuario.xpTotal,
    rachaDias: rachaVigente(usuario.rachaDias, usuario.ultimoEstudio),
    simulacro: esSimulacro ? resultadoSimulacro(i) : null,
  };
}

function resultadoSimulacro(i: IntentoCompleto): ResultadoSimulacro {
  const agrupar = (clave: (r: RespuestaCompleta) => string) => {
    const m = new Map<string, { total: number; aciertos: number }>();
    for (const r of i.respuestas) {
      const g = m.get(clave(r)) ?? { total: 0, aciertos: 0 };
      g.total++;
      if (r.correcta) g.aciertos++;
      m.set(clave(r), g);
    }
    return [...m.entries()];
  };
  const nota = i.cantidad ? Math.round((i.aciertos / i.cantidad) * 100) : 0;
  const fin = i.finalizadoEn ?? new Date();
  return {
    nota,
    notaMinima: SIMULACRO.notaMinima,
    aprobado: nota >= SIMULACRO.notaMinima,
    sinResponder: i.respuestas.filter((r) => !r.respondidaEn).length,
    segundosUsados: Math.min(SIMULACRO.minutos * 60, Math.round((fin.getTime() - i.iniciadoEn.getTime()) / 1000)),
    minutosLimite: SIMULACRO.minutos,
    porBloque: agrupar((r) => bloqueDeFuente(r.pregunta.tema.contenido.tipoFuente)).map(([bloque, g]) => ({ bloque, ...g })),
    porContenido: agrupar((r) => r.pregunta.tema.contenido.titulo)
      .map(([contenido, g]) => ({ contenido, ...g }))
      .sort((a, b) => a.aciertos / a.total - b.aciertos / b.total),
  };
}

// ---------- Panel ----------

export async function panel(u: UsuarioToken): Promise<Panel> {
  const ahora = new Date();
  const [usuario, disponibles, respondidasHoy, intentos, repasoHoy, errores, dominadas] = await Promise.all([
    prisma.usuario.findUniqueOrThrow({ where: { id: u.id }, select: { nombre: true, xpTotal: true, rachaDias: true, ultimoEstudio: true } }),
    prisma.pregunta.count({ where: { estado: 'APROBADA', tipo: { in: TIPOS_EN_QUIZ }, tema: { contenido: filtroContenidos(u) } } }),
    prisma.respuesta.count({ where: { intento: { usuarioId: u.id }, respondidaEn: { gte: inicioDelDiaBolivia(ahora) } } }),
    prisma.intento.findMany({
      where: { usuarioId: u.id },
      orderBy: { iniciadoEn: 'desc' },
      take: 10,
      include: { _count: { select: { respuestas: { where: { respondidaEn: { not: null } } } } } },
    }),
    prisma.estadoEstudio.count({ where: { ...estadoVisible(u), proximaRevision: { lt: finDelDiaBolivia(ahora) } } }),
    prisma.estadoEstudio.count({ where: { ...estadoVisible(u), fallos: { gt: 0 }, intervaloDias: { lt: DIAS_DOMINIO } } }),
    prisma.estadoEstudio.count({ where: { ...estadoVisible(u), intervaloDias: { gte: DIAS_DOMINIO } } }),
  ]);
  return {
    nombre: usuario.nombre,
    xpTotal: usuario.xpTotal,
    rachaDias: rachaVigente(usuario.rachaDias, usuario.ultimoEstudio, ahora),
    preguntasDisponibles: disponibles,
    respondidasHoy,
    repasoHoy,
    errores,
    dominio: disponibles ? Math.round((dominadas / disponibles) * 100) : 0,
    intentos: intentos.map((i) => ({
      id: i.id,
      modo: i.modo,
      cantidad: i.cantidad,
      respondidas: i._count.respuestas,
      aciertos: i.modo === 'SIMULACRO' && !i.finalizadoEn ? 0 : i.aciertos,
      puntaje: i.modo === 'SIMULACRO' && !i.finalizadoEn ? 0 : i.puntaje,
      iniciadoEn: i.iniciadoEn.toISOString(),
      finalizadoEn: i.finalizadoEn?.toISOString() ?? null,
      contenidos: ((i.filtros as { contenidos?: string[] } | null)?.contenidos ?? []).slice(0, 5),
    })),
  };
}

// ---------- Repaso, cuaderno de errores y dominio ----------

/** Estados del usuario sobre preguntas que hoy podrían entrar a un quiz. */
function estadoVisible(u: UsuarioToken): Prisma.EstadoEstudioWhereInput {
  return {
    usuarioId: u.id,
    pregunta: { estado: 'APROBADA', tipo: { in: TIPOS_EN_QUIZ }, tema: { contenido: filtroContenidos(u) } },
  };
}

export async function repasoHoy(u: UsuarioToken): Promise<RepasoHoy> {
  const ahora = new Date();
  const vencidas = await prisma.estadoEstudio.findMany({
    where: { ...estadoVisible(u), proximaRevision: { lt: finDelDiaBolivia(ahora) } },
    select: { pregunta: { select: { tema: { select: { contenido: { select: { id: true, titulo: true } } } } } } },
  });
  const porContenido = new Map<string, { contenidoId: string; titulo: string; pendientes: number }>();
  for (const v of vencidas) {
    const c = v.pregunta.tema.contenido;
    const g = porContenido.get(c.id) ?? { contenidoId: c.id, titulo: c.titulo, pendientes: 0 };
    g.pendientes++;
    porContenido.set(c.id, g);
  }
  const proxima =
    vencidas.length === 0
      ? await prisma.estadoEstudio.findFirst({ where: estadoVisible(u), orderBy: { proximaRevision: 'asc' }, select: { proximaRevision: true } })
      : null;
  return {
    pendientes: vencidas.length,
    porContenido: [...porContenido.values()].sort((a, b) => b.pendientes - a.pendientes),
    proximaEn: proxima?.proximaRevision.toISOString() ?? null,
  };
}

export async function errores(u: UsuarioToken, contenidoId?: string): Promise<ErrorCuaderno[]> {
  const filas = await prisma.estadoEstudio.findMany({
    where: {
      ...estadoVisible(u),
      fallos: { gt: 0 },
      intervaloDias: { lt: DIAS_DOMINIO },
      ...(contenidoId && { pregunta: { tema: { contenidoId, contenido: filtroContenidos(u) }, estado: 'APROBADA', tipo: { in: TIPOS_EN_QUIZ } } }),
    },
    orderBy: [{ fallos: 'desc' }, { ultimaRespuesta: 'desc' }],
    include: {
      pregunta: {
        select: {
          id: true,
          enunciado: true,
          referencia: true,
          opciones: { where: { correcta: true }, select: { texto: true } },
          tema: { select: { nombre: true, contenido: { select: { id: true, titulo: true } } } },
        },
      },
    },
  });
  return filas.map((e) => ({
    preguntaId: e.pregunta.id,
    enunciado: e.pregunta.enunciado,
    contenidoId: e.pregunta.tema.contenido.id,
    contenido: e.pregunta.tema.contenido.titulo,
    tema: e.pregunta.tema.nombre,
    fallos: e.fallos,
    aciertos: e.aciertos,
    intervaloDias: e.intervaloDias,
    ultimaRespuesta: e.ultimaRespuesta?.toISOString() ?? null,
    proximaRevision: e.proximaRevision.toISOString(),
    correctas: e.pregunta.opciones.map((o) => o.texto),
    referencia: e.pregunta.referencia,
  }));
}

/** Dominio = % de preguntas del banco con intervalo ≥ 7 días (respondidas bien varias veces espaciadas). */
export async function progreso(u: UsuarioToken): Promise<Progreso> {
  const contenidos = await prisma.contenido.findMany({
    where: filtroContenidos(u),
    orderBy: { titulo: 'asc' },
    select: {
      id: true,
      titulo: true,
      tipoFuente: true,
      temas: { select: { id: true, nombre: true, padreId: true } },
    },
  });
  const preguntas = await prisma.pregunta.findMany({
    where: { estado: 'APROBADA', tipo: { in: TIPOS_EN_QUIZ }, tema: { contenidoId: { in: contenidos.map((c) => c.id) } } },
    select: {
      temaId: true,
      tema: { select: { contenidoId: true } },
      estados: { where: { usuarioId: u.id }, select: { aciertos: true, fallos: true, intervaloDias: true } },
    },
  });

  type Cuenta = { total: number; vistas: number; dominadas: number; aciertos: number; respuestas: number };
  const vacio = (): Cuenta => ({ total: 0, vistas: 0, dominadas: 0, aciertos: 0, respuestas: 0 });
  const porTema = new Map<string, Cuenta>();
  const porContenido = new Map<string, Cuenta>();
  for (const p of preguntas) {
    const e = p.estados[0];
    for (const [mapa, clave] of [
      [porTema, p.temaId],
      [porContenido, p.tema.contenidoId],
    ] as const) {
      const c = mapa.get(clave) ?? vacio();
      c.total++;
      if (e && e.aciertos + e.fallos > 0) c.vistas++;
      if (e && e.intervaloDias >= DIAS_DOMINIO) c.dominadas++;
      c.aciertos += e?.aciertos ?? 0;
      c.respuestas += (e?.aciertos ?? 0) + (e?.fallos ?? 0);
      mapa.set(clave, c);
    }
  }
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

  const lista: DominioContenido[] = contenidos
    .map((c) => {
      const k = porContenido.get(c.id) ?? vacio();
      // Temas hoja o con preguntas propias, con su ruta ("Título I › Capítulo II").
      const nombreDe = new Map(c.temas.map((t) => [t.id, t]));
      const ruta = (id: string): string => {
        const t = nombreDe.get(id)!;
        return t.padreId && nombreDe.has(t.padreId) ? `${ruta(t.padreId)} › ${t.nombre}` : t.nombre;
      };
      const temas = c.temas
        .filter((t) => porTema.has(t.id))
        .map((t) => {
          const x = porTema.get(t.id)!;
          return { temaId: t.id, nombre: ruta(t.id), total: x.total, vistas: x.vistas, dominadas: x.dominadas, dominio: pct(x.dominadas, x.total) };
        })
        .sort((a, b) => a.dominio - b.dominio || b.total - a.total);
      return {
        contenidoId: c.id,
        titulo: c.titulo,
        tipoFuente: c.tipoFuente,
        total: k.total,
        vistas: k.vistas,
        dominadas: k.dominadas,
        dominio: pct(k.dominadas, k.total),
        acierto: k.respuestas ? pct(k.aciertos, k.respuestas) : null,
        temas,
      };
    })
    .filter((c) => c.total > 0);

  const total = lista.reduce((s, c) => s + c.total, 0);
  const vistas = lista.reduce((s, c) => s + c.vistas, 0);
  const dominadas = lista.reduce((s, c) => s + c.dominadas, 0);
  return { total, vistas, dominadas, dominio: pct(dominadas, total), contenidos: lista };
}
