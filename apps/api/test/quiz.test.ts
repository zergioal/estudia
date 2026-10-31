import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { diaBolivia, nuevaRacha } from '../src/modulos/quiz/servicio';
import { app, limpiarBase, lote, preguntaValida, prisma, tokenDe } from './utilidades';

let token: string;
let contenidoId: string;
const auth = (t = token) => ({ Authorization: `Bearer ${t}` });

async function importarYAprobar(enunciados: string[], extra: Record<string, unknown> = {}, aprobar = true) {
  const res = await request(app)
    .post('/api/v1/admin/preguntas/importar')
    .set(auth())
    .send(lote(enunciados.map((e) => preguntaValida(e)), extra));
  contenidoId = res.body.contenidoId;
  if (aprobar) {
    const ids = (await prisma.pregunta.findMany({ where: { enunciado: { in: enunciados } } })).map((p) => p.id);
    await prisma.pregunta.updateMany({ where: { id: { in: ids } }, data: { estado: 'APROBADA' } });
  }
  return res.body;
}

const crear = (cuerpo: object, t = token) => request(app).post('/api/v1/quizzes').set(auth(t)).send(cuerpo);
const responder = (quizId: string, preguntaId: string, opcionIds: string[], t = token) =>
  request(app).post(`/api/v1/quizzes/${quizId}/respuestas`).set(auth(t)).send({ preguntaId, opcionIds, segundos: 12 });
const correctaDe = async (preguntaId: string) =>
  (await prisma.opcion.findFirstOrThrow({ where: { preguntaId, correcta: true } })).id;
const incorrectaDe = async (preguntaId: string) =>
  (await prisma.opcion.findFirstOrThrow({ where: { preguntaId, correcta: false } })).id;

beforeEach(async () => {
  await limpiarBase();
  token = await tokenDe('ADMIN');
});
afterAll(() => prisma.$disconnect());

describe('POST /api/v1/quizzes', () => {
  it('crea un quiz solo con preguntas APROBADAS y sin revelar respuestas', async () => {
    await importarYAprobar(['¿A?', '¿B?', '¿C?']);
    await importarYAprobar(['¿Borrador?'], {}, false);

    const res = await crear({ contenidoIds: [contenidoId], cantidad: 10 });
    expect(res.status).toBe(201);
    expect(res.body.cantidad).toBe(3);
    expect(res.body.preguntas.map((p: { enunciado: string }) => p.enunciado).sort()).toEqual(['¿A?', '¿B?', '¿C?']);
    const json = JSON.stringify(res.body);
    expect(json).not.toContain('"correcta"');
    expect(json).not.toContain('porQue');
    expect(json).not.toContain('Así lo dice el artículo');
    expect(res.body.preguntas[0].opciones).toHaveLength(4);
    expect(res.body.preguntas[0].feedback).toBeNull();
  });

  it('un tema incluye sus subtemas y se puede filtrar por dificultad', async () => {
    await importarYAprobar(['¿Del capítulo?']);
    const titulo = await prisma.tema.findFirstOrThrow({ where: { nombre: 'Título I' } });
    const porTema = await crear({ temaIds: [titulo.id], cantidad: 10 });
    expect(porTema.body.cantidad).toBe(1);

    const dificil = await crear({ temaIds: [titulo.id], dificultades: ['DIFICIL'], cantidad: 10 });
    expect(dificil.status).toBe(409);
    expect(dificil.body.error.codigo).toBe('SIN_PREGUNTAS');
  });

  it('valida cantidad y filtros', async () => {
    await importarYAprobar(['¿A?']);
    expect((await crear({ contenidoIds: [contenidoId], cantidad: 15 })).status).toBe(400);
    expect((await crear({ cantidad: 10 })).status).toBe(400);
    expect((await crear({ contenidoIds: ['no-existe'], cantidad: 10 })).status).toBe(404);
  });

  it('no repite lo ya dominado mientras haya preguntas nuevas', async () => {
    const enunciados = Array.from({ length: 12 }, (_, i) => `¿Pregunta ${i + 1}?`);
    await importarYAprobar(enunciados);
    const vistas = (await prisma.pregunta.findMany({ where: { enunciado: { in: enunciados.slice(0, 2) } } })).map((p) => p.id);
    const usuario = await prisma.usuario.findFirstOrThrow();
    await prisma.estadoEstudio.createMany({ data: vistas.map((preguntaId) => ({
        usuarioId: usuario.id,
        preguntaId,
        aciertos: 3,
        intervaloDias: 10,
        proximaRevision: new Date(Date.now() + 10 * 86_400_000),
      })),
    });

    // 12 disponibles, 10 nunca vistas: un quiz de 10 no debe incluir las 2 ya dominadas.
    const res = await crear({ contenidoIds: [contenidoId], cantidad: 10 });
    expect(res.body.cantidad).toBe(10);
    expect(res.body.preguntas.some((p: { id: string }) => vistas.includes(p.id))).toBe(false);
  });

  it('el orden barajado de las opciones se mantiene al volver a consultar', async () => {
    await importarYAprobar(['¿A?']);
    const quiz = (await crear({ contenidoIds: [contenidoId], cantidad: 10 })).body;
    const otra = (await request(app).get(`/api/v1/quizzes/${quiz.id}`).set(auth())).body;
    expect(otra.preguntas[0].opciones).toEqual(quiz.preguntas[0].opciones);
  });
});

describe('POST /api/v1/quizzes/:id/respuestas', () => {
  it('acierto: feedback completo, XP por dificultad y estadísticas', async () => {
    await importarYAprobar(['¿A?', '¿B?']);
    const quiz = (await crear({ contenidoIds: [contenidoId], cantidad: 10 })).body;
    const p = quiz.preguntas[0];

    const res = await responder(quiz.id, p.id, [await correctaDe(p.id)]);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ correcta: true, xp: 20, citaTextual: 'la educación es universal' });
    expect(res.body.opciones.every((o: { porQue: string | null }) => o.porQue)).toBe(true);

    const pregunta = await prisma.pregunta.findUniqueOrThrow({ where: { id: p.id } });
    expect(pregunta).toMatchObject({ vecesRespondida: 1, vecesAcertada: 1 });
    const usuario = await prisma.usuario.findFirstOrThrow();
    expect(usuario).toMatchObject({ xpTotal: 20, rachaDias: 1 });
  });

  it('fallo: 0 XP; volver a acertarla después da el bonus ×1,5', async () => {
    await importarYAprobar(['¿A?']);
    const q1 = (await crear({ contenidoIds: [contenidoId], cantidad: 10 })).body;
    const pid = q1.preguntas[0].id;
    const fallo = await responder(q1.id, pid, [await incorrectaDe(pid)]);
    expect(fallo.body).toMatchObject({ correcta: false, xp: 0 });
    expect(fallo.body.opciones.find((o: { correcta: boolean }) => o.correcta).texto).toBe('Correcta');

    const q2 = (await crear({ contenidoIds: [contenidoId], cantidad: 10 })).body;
    const acierto = await responder(q2.id, pid, [await correctaDe(pid)]);
    expect(acierto.body.xp).toBe(30);
  });

  it('no permite responder dos veces, opciones ajenas ni varias opciones en OPCION_MULTIPLE', async () => {
    await importarYAprobar(['¿A?', '¿B?']);
    const quiz = (await crear({ contenidoIds: [contenidoId], cantidad: 10 })).body;
    const [a, b] = quiz.preguntas;

    expect((await responder(quiz.id, a.id, [await correctaDe(b.id)])).status).toBe(400);
    expect((await responder(quiz.id, a.id, [await correctaDe(a.id), await incorrectaDe(a.id)])).status).toBe(400);
    expect((await responder(quiz.id, a.id, [await correctaDe(a.id)])).status).toBe(200);
    expect((await responder(quiz.id, a.id, [await correctaDe(a.id)])).status).toBe(409);
    expect((await responder(quiz.id, 'otra', [await correctaDe(a.id)])).status).toBe(404);
  });

  it('el quiz consultado muestra el feedback solo de las respondidas', async () => {
    await importarYAprobar(['¿A?', '¿B?']);
    const quiz = (await crear({ contenidoIds: [contenidoId], cantidad: 10 })).body;
    await responder(quiz.id, quiz.preguntas[0].id, [await correctaDe(quiz.preguntas[0].id)]);
    const estado = (await request(app).get(`/api/v1/quizzes/${quiz.id}`).set(auth())).body;
    expect(estado.respondidas).toBe(1);
    expect(estado.preguntas[0].feedback.correcta).toBe(true);
    expect(estado.preguntas[1].feedback).toBeNull();
    expect(JSON.stringify(estado.preguntas[1])).not.toContain('correcta');
  });
});

describe('finalizar, resumen y panel', () => {
  it('finaliza con resumen por tema y falladas; luego no admite respuestas', async () => {
    await importarYAprobar(['¿A?', '¿B?']);
    const quiz = (await crear({ contenidoIds: [contenidoId], cantidad: 10 })).body;
    const [a, b] = quiz.preguntas;
    await responder(quiz.id, a.id, [await correctaDe(a.id)]);
    await responder(quiz.id, b.id, [await incorrectaDe(b.id)]);

    const res = await request(app).post(`/api/v1/quizzes/${quiz.id}/finalizar`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ respondidas: 2, aciertos: 1, porcentaje: 50, puntaje: 20, segundosPromedio: 12 });
    expect(res.body.porTema).toEqual([{ tema: 'Capítulo I', contenido: 'Ley 070', total: 2, aciertos: 1 }]);
    expect(res.body.falladas).toHaveLength(1);
    expect(res.body.falladas[0]).toMatchObject({ enunciado: b.enunciado, correctas: ['Correcta'] });

    expect((await responder(quiz.id, b.id, [await correctaDe(b.id)])).status).toBe(409);
  });

  it('cada usuario ve solo sus quizzes', async () => {
    await importarYAprobar(['¿A?']);
    const quiz = (await crear({ contenidoIds: [contenidoId], cantidad: 10 })).body;
    const otro = await tokenDe('ADMIN');
    expect((await request(app).get(`/api/v1/quizzes/${quiz.id}`).set(auth(otro))).status).toBe(404);
  });

  it('panel con XP, racha, respondidas hoy e intentos', async () => {
    await importarYAprobar(['¿A?']);
    const quiz = (await crear({ contenidoIds: [contenidoId], cantidad: 10 })).body;
    await responder(quiz.id, quiz.preguntas[0].id, [await correctaDe(quiz.preguntas[0].id)]);

    const res = await request(app).get('/api/v1/me/panel').set(auth());
    expect(res.body).toMatchObject({ xpTotal: 20, rachaDias: 1, respondidasHoy: 1, preguntasDisponibles: 1 });
    expect(res.body.intentos[0]).toMatchObject({ respondidas: 1, aciertos: 1, contenidos: ['Ley 070'] });
  });
});

describe('acceso de estudiantes', () => {
  it('sin asignación no ve contenidos; con asignación y contenido publicado sí', async () => {
    await importarYAprobar(['¿A?']);
    const estudiante = await tokenDe('ESTUDIANTE');
    expect((await request(app).get('/api/v1/me/estudio').set(auth(estudiante))).body).toEqual([]);
    expect((await crear({ contenidoIds: [contenidoId], cantidad: 10 }, estudiante)).status).toBe(404);

    const contenido = await prisma.contenido.update({ where: { id: contenidoId }, data: { publicado: true } });
    const usuario = await prisma.usuario.findFirstOrThrow({ where: { rol: 'ESTUDIANTE' } });
    await prisma.asignacion.create({ data: { usuarioId: usuario.id, coleccionId: contenido.coleccionId } });

    const arbol = (await request(app).get('/api/v1/me/estudio').set(auth(estudiante))).body;
    expect(arbol[0].contenidos[0]).toMatchObject({ titulo: 'Ley 070', disponibles: 1 });
    expect(arbol[0].contenidos[0].temas[0]).toMatchObject({ nombre: 'Título I', disponibles: 1 });
    expect((await crear({ contenidoIds: [contenidoId], cantidad: 10 }, estudiante)).status).toBe(201);
  });
});

describe('racha', () => {
  const dia = (iso: string) => new Date(iso);
  it('sube con días consecutivos (hora de Bolivia), se mantiene el mismo día y se reinicia si se salta un día', () => {
    expect(nuevaRacha(0, null, dia('2026-10-30T12:00:00Z'))).toBe(1);
    expect(nuevaRacha(3, dia('2026-10-30T12:00:00Z'), dia('2026-10-30T20:00:00Z'))).toBe(3);
    expect(nuevaRacha(3, dia('2026-10-29T12:00:00Z'), dia('2026-10-30T12:00:00Z'))).toBe(4);
    expect(nuevaRacha(3, dia('2026-10-27T12:00:00Z'), dia('2026-10-30T12:00:00Z'))).toBe(1);
    // 23:30 en La Paz del 29 = 03:30 UTC del 30: sigue siendo el día 29 en Bolivia.
    expect(diaBolivia(dia('2026-10-30T03:30:00Z'))).toBe('2026-10-29');
  });
});

describe('formato del examen', () => {
  it('solo entran preguntas de OPCION_MULTIPLE', async () => {
    await importarYAprobar(['¿OM?']);
    const vf = await request(app)
      .post('/api/v1/admin/preguntas/importar')
      .set(auth())
      .send(
        lote([
          preguntaValida('¿Verdadero o falso?', {
            tipo: 'VERDADERO_FALSO',
            opciones: [
              { texto: 'Verdadero', correcta: true },
              { texto: 'Falso', correcta: false },
            ],
          }),
        ]),
      );
    expect(vf.body.importadas).toBe(1);
    await prisma.pregunta.updateMany({ data: { estado: 'APROBADA' } });

    const quiz = (await crear({ contenidoIds: [contenidoId], cantidad: 10 })).body;
    expect(quiz.preguntas.map((p: { enunciado: string }) => p.enunciado)).toEqual(['¿OM?']);
  });
});
