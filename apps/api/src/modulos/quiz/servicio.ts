import type { Prisma, TipoPregunta } from '@prisma/client';
import { prisma } from '../../db';
import { ErrorApp, conflicto, noEncontrado } from '../../errores';
import type { UsuarioToken } from '../../middleware/auth';
import {
  BONUS_RECUPERADA,
  SIMULACRO,
  XP_POR_DIFICULTAD,
  bloqueDeFuente,
  type ColeccionEstudio,
  type Feedback,
  type Panel,
  type PreguntaQuiz,
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
  const idsTemas = new Set(temas.filter((t) => datos.contenidoIds.includes(t.contenidoId)).map((t) => t.id));
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
    },
    select: { id: true, tema: { select: { contenidoId: true } }, opciones: { select: { id: true } } },
  });
  if (candidatas.length === 0) {
    throw new ErrorApp(409, 'SIN_PREGUNTAS', 'No hay preguntas aprobadas para esos filtros');
  }

  // Prioridad: nunca vistas → más falladas que acertadas → el resto; al azar dentro de cada grupo.
  const estados = await prisma.estadoEstudio.findMany({
    where: { usuarioId: u.id, preguntaId: { in: candidatas.map((c) => c.id) } },
    select: { preguntaId: true, aciertos: true, fallos: true },
  });
  const estadoDe = new Map(estados.map((e) => [e.preguntaId, e]));
  const grupo = (id: string) => {
    const e = estadoDe.get(id);
    if (!e || e.aciertos + e.fallos === 0) return 0;
    return e.fallos > e.aciertos ? 1 : 2;
  };
  const elegidas = barajar(
    barajar(candidatas)
      .sort((a, b) => grupo(a.id) - grupo(b.id))
      .slice(0, datos.cantidad),
  );

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

function feedbackDe(r: RespuestaCompleta): Feedback {
  return {
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
    await tx.estadoEstudio.upsert({
      where: { usuarioId_preguntaId: { usuarioId: u.id, preguntaId: r.preguntaId } },
      create: { usuarioId: u.id, preguntaId: r.preguntaId, aciertos: correcta ? 1 : 0, fallos: correcta ? 0 : 1, ultimaRespuesta: ahora },
      update: { aciertos: { increment: correcta ? 1 : 0 }, fallos: { increment: correcta ? 0 : 1 }, ultimaRespuesta: ahora },
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
  return feedbackDe({ ...r, opcionesElegidas: elegidas, correcta, xp, respondidaEn: ahora });
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
  const [usuario, disponibles, respondidasHoy, intentos] = await Promise.all([
    prisma.usuario.findUniqueOrThrow({ where: { id: u.id }, select: { nombre: true, xpTotal: true, rachaDias: true, ultimoEstudio: true } }),
    prisma.pregunta.count({ where: { estado: 'APROBADA', tipo: { in: TIPOS_EN_QUIZ }, tema: { contenido: filtroContenidos(u) } } }),
    prisma.respuesta.count({ where: { intento: { usuarioId: u.id }, respondidaEn: { gte: inicioDelDiaBolivia(ahora) } } }),
    prisma.intento.findMany({
      where: { usuarioId: u.id },
      orderBy: { iniciadoEn: 'desc' },
      take: 10,
      include: { _count: { select: { respuestas: { where: { respondidaEn: { not: null } } } } } },
    }),
  ]);
  return {
    nombre: usuario.nombre,
    xpTotal: usuario.xpTotal,
    rachaDias: rachaVigente(usuario.rachaDias, usuario.ultimoEstudio, ahora),
    preguntasDisponibles: disponibles,
    respondidasHoy,
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
