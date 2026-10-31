import { Prisma } from '@prisma/client';
import type {
  Analizar,
  BuscarFragmentos,
  EstadisticasFiltro,
  EstadisticasPreguntas,
  FragmentoEncontrado,
  MotivoReporte,
  ParSimilar,
  PreguntaEstadistica,
  ReporteAdmin,
  ReporteCrear,
  ResultadoAnalisis,
  ResultadoCiego,
  ResumenCalidad,
  SimilaresFiltro,
} from '@estudia/shared';
import { config } from '../../config';
import { prisma } from '../../db';
import { ErrorApp, noEncontrado } from '../../errores';
import { LETRAS, resolverACiegas } from './ciego';
import { aVector, embebedor } from './embeddings';
import { revisar } from './validador';

/** Estados que todavía esperan revisión humana. */
const PENDIENTES = ['BORRADOR', 'VALIDADA'] as const;

/** Texto que representa a una pregunta para compararla: enunciado + respuesta correcta. */
const textoPregunta = (enunciado: string, correctas: string[]) => `${enunciado}\nRespuesta: ${correctas.join('; ')}`;

// ---------- Embeddings ----------

/** Calcula los embeddings que falten (preguntas no descartadas; fragmentos si se pide). */
export async function embeberPendientes(opciones: { fragmentos?: boolean; alAvanzar?: (n: number, total: number) => void } = {}) {
  const preguntas = await prisma.$queryRaw<{ id: string; enunciado: string }[]>`
    SELECT id, enunciado FROM "Pregunta" WHERE embedding IS NULL AND estado <> 'DESCARTADA' ORDER BY "creadoEn"`;
  const correctas = await prisma.opcion.findMany({
    where: { preguntaId: { in: preguntas.map((p) => p.id) }, correcta: true },
    select: { preguntaId: true, texto: true },
  });
  const porPregunta = new Map<string, string[]>();
  for (const o of correctas) porPregunta.set(o.preguntaId, [...(porPregunta.get(o.preguntaId) ?? []), o.texto]);

  let hechas = 0;
  for (let i = 0; i < preguntas.length; i += 64) {
    const lote = preguntas.slice(i, i + 64);
    const vectores = await embebedor().embeber(
      lote.map((p) => textoPregunta(p.enunciado, porPregunta.get(p.id) ?? [])),
      'consulta',
    );
    await guardarVectores('Pregunta', lote.map((p) => p.id), vectores);
    hechas += lote.length;
    opciones.alAvanzar?.(hechas, preguntas.length);
  }

  let fragmentos = 0;
  if (opciones.fragmentos) {
    const pendientes = await prisma.$queryRaw<{ id: string; etiqueta: string; texto: string }[]>`
      SELECT id, etiqueta, texto FROM "Fragmento" WHERE embedding IS NULL ORDER BY "documentoId", orden`;
    for (let i = 0; i < pendientes.length; i += 32) {
      const lote = pendientes.slice(i, i + 32);
      const vectores = await embebedor().embeber(lote.map((f) => `${f.etiqueta}. ${f.texto}`), 'pasaje');
      await guardarVectores('Fragmento', lote.map((f) => f.id), vectores);
      fragmentos += lote.length;
      opciones.alAvanzar?.(fragmentos, pendientes.length);
    }
  }
  return { preguntas: hechas, fragmentos };
}

async function guardarVectores(tabla: 'Pregunta' | 'Fragmento', ids: string[], vectores: number[][]) {
  if (ids.length === 0) return;
  const filas = ids.map((id, i) => Prisma.sql`(${id}, ${aVector(vectores[i]!)}::vector)`);
  await prisma.$executeRaw`
    UPDATE ${Prisma.raw(`"${tabla}"`)} AS t SET embedding = v.e
    FROM (VALUES ${Prisma.join(filas)}) AS v(id, e) WHERE t.id = v.id`;
}

/** Al editar el enunciado u opciones: hay que volver a embeber y validar. */
export async function invalidarCalidad(preguntaId: string) {
  await prisma.$executeRaw`UPDATE "Pregunta" SET embedding = NULL, "validadoEn" = NULL, ciega = NULL WHERE id = ${preguntaId}`;
}

// ---------- Deduplicación ----------

/**
 * Marca DUPLICADA cada pregunta pendiente cuyo vecino más parecido del mismo documento (aprobada, o pendiente
 * más antigua) supere el umbral de coseno. Devuelve cuántas marcó.
 */
export async function deduplicar(umbral = config.umbralDuplicado): Promise<number> {
  const pares = await prisma.$queryRaw<{ id: string; vecino: string; similitud: number }[]>`
    SELECT p.id, v.id AS vecino, v.similitud
    FROM "Pregunta" p
    JOIN "Tema" tp ON tp.id = p."temaId"
    CROSS JOIN LATERAL (
      SELECT q.id, 1 - (q.embedding <=> p.embedding) AS similitud
      FROM "Pregunta" q JOIN "Tema" tq ON tq.id = q."temaId"
      WHERE q.id <> p.id AND tq."contenidoId" = tp."contenidoId" AND q.embedding IS NOT NULL
        AND (q.estado = 'APROBADA'
             OR (q.estado IN ('BORRADOR', 'VALIDADA') AND (q."creadoEn", q.id) < (p."creadoEn", p.id)))
      ORDER BY q.embedding <=> p.embedding
      LIMIT 1
    ) v
    WHERE p.estado IN ('BORRADOR', 'VALIDADA') AND p.embedding IS NOT NULL AND v.similitud >= ${umbral}`;

  // Si A≈B y B≈C, solo se marcan las que no sean a su vez el original de otra marcada en este pase.
  const marcadas = new Set<string>();
  for (const par of pares.sort((a, b) => b.similitud - a.similitud)) {
    if (marcadas.has(par.vecino)) continue;
    marcadas.add(par.id);
    await prisma.pregunta.update({
      where: { id: par.id },
      data: { estado: 'DUPLICADA', duplicadaDeId: par.vecino, similitud: Math.round(par.similitud * 1000) / 1000 },
    });
  }
  return marcadas.size;
}

/** Pares de preguntas aprobadas muy parecidas (para revisar a mano). */
export async function similares(f: SimilaresFiltro): Promise<ParSimilar[]> {
  const filas = await prisma.$queryRaw<{ a: string; b: string; similitud: number; contenido: string }[]>`
    SELECT p.id AS a, v.id AS b, v.similitud, c.titulo AS contenido
    FROM "Pregunta" p
    JOIN "Tema" tp ON tp.id = p."temaId"
    JOIN "Contenido" c ON c.id = tp."contenidoId"
    CROSS JOIN LATERAL (
      SELECT q.id, 1 - (q.embedding <=> p.embedding) AS similitud
      FROM "Pregunta" q JOIN "Tema" tq ON tq.id = q."temaId"
      WHERE q.id > p.id AND q.estado = 'APROBADA' AND tq."contenidoId" = tp."contenidoId" AND q.embedding IS NOT NULL
      ORDER BY q.embedding <=> p.embedding
      LIMIT 1
    ) v
    WHERE p.estado = 'APROBADA' AND p.embedding IS NOT NULL AND v.similitud >= ${f.umbral}
      ${f.contenidoId ? Prisma.sql`AND tp."contenidoId" = ${f.contenidoId}` : Prisma.empty}
    ORDER BY v.similitud DESC
    LIMIT ${f.limite}`;
  const breves = await preguntasBreves(filas.flatMap((x) => [x.a, x.b]));
  return filas.map((x) => ({
    similitud: Math.round(x.similitud * 1000) / 1000,
    contenido: x.contenido,
    a: breves.get(x.a)!,
    b: breves.get(x.b)!,
  }));
}

async function preguntasBreves(ids: string[]) {
  const ps = await prisma.pregunta.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      enunciado: true,
      estado: true,
      referencia: true,
      tema: { select: { contenido: { select: { titulo: true } } } },
      opciones: { where: { correcta: true }, select: { texto: true }, orderBy: { orden: 'asc' } },
    },
  });
  return new Map(
    ps.map((p) => [
      p.id,
      {
        id: p.id,
        enunciado: p.enunciado,
        estado: p.estado,
        referencia: p.referencia,
        correcta: p.opciones.map((o) => o.texto).join('; '),
        contenido: p.tema.contenido.titulo,
      },
    ]),
  );
}

// ---------- Validación ----------

/**
 * Pasa las reglas a las preguntas sin validar (o a todas). BORRADOR sin alertas → VALIDADA;
 * VALIDADA con alertas nuevas → BORRADOR. Las aprobadas solo guardan sus alertas.
 */
export async function validar(opciones: { todas?: boolean; ciego?: boolean } = {}) {
  const ps = await prisma.pregunta.findMany({
    where: {
      estado: { notIn: ['DESCARTADA', 'DUPLICADA'] },
      ...(!opciones.todas && { validadoEn: null }),
    },
    select: {
      id: true,
      tipo: true,
      estado: true,
      enunciado: true,
      citaTextual: true,
      referencia: true,
      ciega: true,
      fragmento: { select: { texto: true } },
      opciones: { orderBy: { orden: 'asc' }, select: { texto: true, correcta: true, porQue: true } },
    },
  });

  let validadas = 0;
  let conAlertas = 0;
  let ciegas = 0;
  let ciegasFallidas = 0;
  const usarCiego = opciones.ciego && config.validadorCiegoDisponible;

  for (const p of ps) {
    const alertas = revisar(p, p.fragmento?.texto ?? null);
    let ciega = p.ciega as ResultadoCiego | null;

    // El pase a ciegas cuesta: solo para pendientes que ya pasaron las reglas y no tienen resultado.
    if (usarCiego && alertas.length === 0 && PENDIENTES.includes(p.estado as never) && !ciega && p.tipo !== 'ORDENAR') {
      const r = await resolverACiegas({ enunciado: p.enunciado, opciones: p.opciones, fuente: p.fragmento?.texto ?? null });
      if (r) {
        const indice = LETRAS.indexOf(r.respuesta.toUpperCase() as (typeof LETRAS)[number]);
        ciega = { ...r, coincide: p.opciones[indice]?.correcta === true, modelo: config.modeloValidador };
        ciegas++;
      }
    }
    if (ciega && (!ciega.coincide || ciega.ambigua)) {
      ciegasFallidas += usarCiego ? 1 : 0;
      alertas.push(
        ciega.ambigua
          ? `A ciegas, la IA la considera ambigua: ${ciega.motivo}`
          : `A ciegas, la IA eligió la opción ${ciega.respuesta}: ${ciega.motivo}`,
      );
    }

    const estado =
      p.estado === 'BORRADOR' && alertas.length === 0 ? 'VALIDADA' : p.estado === 'VALIDADA' && alertas.length > 0 ? 'BORRADOR' : p.estado;
    await prisma.pregunta.update({
      where: { id: p.id },
      data: {
        alertas,
        estado,
        validadoEn: new Date(),
        ciega: ciega ? (ciega as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });
    if (alertas.length) conAlertas++;
    else validadas++;
  }
  return { validadas, conAlertas, ciegas, ciegasFallidas };
}

/** Embeddings + deduplicación + validación: lo que corre tras cada importación. */
export async function analizar(opciones: Analizar = {}): Promise<ResultadoAnalisis> {
  const { preguntas } = await embeberPendientes();
  const duplicadas = await deduplicar();
  const v = await validar({ todas: opciones.todas, ciego: opciones.ciego });
  return { embebidas: preguntas, duplicadas, ...v };
}

export async function resumen(): Promise<ResumenCalidad> {
  const [porEstado, [cuentas], reportesAbiertos] = await Promise.all([
    prisma.pregunta.groupBy({ by: ['estado'], _count: true }),
    prisma.$queryRaw<{ alertas: bigint; sin_embedding: bigint; sin_validar: bigint }[]>`
      SELECT
        COUNT(*) FILTER (WHERE estado IN ('BORRADOR', 'VALIDADA') AND cardinality(alertas) > 0) AS alertas,
        COUNT(*) FILTER (WHERE embedding IS NULL AND estado <> 'DESCARTADA') AS sin_embedding,
        COUNT(*) FILTER (WHERE "validadoEn" IS NULL AND estado NOT IN ('DESCARTADA', 'DUPLICADA')) AS sin_validar
      FROM "Pregunta"`,
    prisma.reporte.count({ where: { resuelto: false } }),
  ]);
  return {
    porEstado: Object.fromEntries(porEstado.map((e) => [e.estado, e._count])),
    conAlertas: Number(cuentas!.alertas),
    sinEmbedding: Number(cuentas!.sin_embedding),
    sinValidar: Number(cuentas!.sin_validar),
    reportesAbiertos,
    ciegoDisponible: config.validadorCiegoDisponible,
    umbralDuplicado: config.umbralDuplicado,
  };
}

// ---------- Estadísticas de preguntas rotas ----------

export async function estadisticas(f: EstadisticasFiltro): Promise<EstadisticasPreguntas> {
  const where: Prisma.PreguntaWhereInput = {
    estado: 'APROBADA',
    vecesRespondida: { gte: f.minRespuestas },
    ...(f.contenidoId && { tema: { contenidoId: f.contenidoId } }),
  };
  const ps = await prisma.pregunta.findMany({
    where,
    select: {
      id: true,
      enunciado: true,
      referencia: true,
      vecesRespondida: true,
      vecesAcertada: true,
      tema: { select: { contenido: { select: { titulo: true } } } },
      opciones: { orderBy: { orden: 'asc' }, select: { id: true, texto: true, correcta: true } },
      _count: { select: { reportes: { where: { resuelto: false } } } },
    },
  });

  // Cuántas veces se eligió cada opción (solo respuestas contestadas).
  const elegidas = new Map<string, number>();
  if (ps.length) {
    const filas = await prisma.$queryRaw<{ opcion: string; veces: bigint }[]>`
      SELECT o AS opcion, COUNT(*) AS veces
      FROM "Respuesta" r, unnest(r."opcionesElegidas") AS o
      WHERE r."preguntaId" IN (${Prisma.join(ps.map((p) => p.id))}) AND r."respondidaEn" IS NOT NULL
      GROUP BY o`;
    for (const x of filas) elegidas.set(x.opcion, Number(x.veces));
  }

  const rotas: PreguntaEstadistica[] = [];
  for (const p of ps) {
    const acierto = Math.round((p.vecesAcertada / p.vecesRespondida) * 100);
    const opciones = p.opciones.map((o) => ({ ...o, elegida: elegidas.get(o.id) ?? 0 }));
    const correcta = Math.max(...opciones.filter((o) => o.correcta).map((o) => o.elegida), 0);
    const atractivo = opciones.some((o) => !o.correcta && o.elegida > correcta);
    const problema =
      acierto < 15 ? 'DIFICILISIMA' : acierto > 98 ? 'REGALADA' : atractivo ? 'DISTRACTOR_ATRACTIVO' : null;
    if (!problema) continue;
    rotas.push({
      id: p.id,
      enunciado: p.enunciado,
      referencia: p.referencia,
      contenido: p.tema.contenido.titulo,
      respondidas: p.vecesRespondida,
      acierto,
      problema,
      opciones,
      reportes: p._count.reportes,
    });
  }
  const orden = { DIFICILISIMA: 0, DISTRACTOR_ATRACTIVO: 1, REGALADA: 2 };
  rotas.sort((a, b) => orden[a.problema] - orden[b.problema] || a.acierto - b.acierto);
  return { minRespuestas: f.minRespuestas, evaluadas: ps.length, rotas };
}

// ---------- Búsqueda semántica en las fuentes ----------

export async function buscarFragmentos(f: BuscarFragmentos): Promise<FragmentoEncontrado[]> {
  const [hay] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM "Fragmento" WHERE embedding IS NOT NULL`;
  if (!Number(hay!.n)) {
    throw new ErrorApp(409, 'SIN_EMBEDDINGS', 'Los fragmentos aún no tienen embeddings: ejecuta "npm run calidad -- --fragmentos"');
  }
  const [vector] = await embebedor().embeber([f.q], 'consulta');
  const filas = await prisma.$queryRaw<
    { id: string; ref: string | null; etiqueta: string; contenido: string; paginaDesde: number; paginaHasta: number; similitud: number; texto: string }[]
  >`
    SELECT f.id, f.ref, f.etiqueta, c.titulo AS contenido, f."paginaDesde", f."paginaHasta",
           1 - (f.embedding <=> ${aVector(vector!)}::vector) AS similitud, f.texto
    FROM "Fragmento" f
    JOIN "Documento" d ON d.id = f."documentoId"
    JOIN "Contenido" c ON c.id = d."contenidoId"
    WHERE f.embedding IS NOT NULL ${f.contenidoId ? Prisma.sql`AND d."contenidoId" = ${f.contenidoId}` : Prisma.empty}
    ORDER BY f.embedding <=> ${aVector(vector!)}::vector
    LIMIT ${f.limite}`;
  return filas.map(({ texto, similitud, ...x }) => ({
    ...x,
    similitud: Math.round(similitud * 1000) / 1000,
    extracto: texto.length > 400 ? `${texto.slice(0, 400)}…` : texto,
  }));
}

// ---------- Reportes ----------

export async function reportar(usuarioId: string, preguntaId: string, datos: ReporteCrear) {
  const p = await prisma.pregunta.findUnique({ where: { id: preguntaId }, select: { id: true } });
  if (!p) throw noEncontrado('La pregunta');
  const r = await prisma.reporte.create({
    data: { preguntaId, usuarioId, motivo: datos.motivo, comentario: datos.comentario || null },
  });
  return { id: r.id };
}

export async function listarReportes(resuelto: boolean): Promise<ReporteAdmin[]> {
  const rs = await prisma.reporte.findMany({
    where: { resuelto },
    orderBy: { creadoEn: resuelto ? 'desc' : 'asc' },
    take: 200,
    include: { usuario: { select: { nombre: true } } },
  });
  const breves = await preguntasBreves(rs.map((r) => r.preguntaId));
  return rs.map((r) => ({
    id: r.id,
    motivo: r.motivo as MotivoReporte,
    comentario: r.comentario,
    resuelto: r.resuelto,
    creadoEn: r.creadoEn.toISOString(),
    usuario: r.usuario.nombre,
    pregunta: breves.get(r.preguntaId)!,
  }));
}

export async function resolverReporte(id: string, resuelto: boolean) {
  const r = await prisma.reporte.findUnique({ where: { id } });
  if (!r) throw noEncontrado('El reporte');
  await prisma.reporte.update({ where: { id }, data: { resuelto, resueltoEn: resuelto ? new Date() : null } });
  return { id, resuelto };
}
