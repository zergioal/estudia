import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seleccionar } from '../src/modulos/quiz/servicio';
import { siguienteEstado } from '../src/modulos/quiz/srs';
import { app, limpiarBase, lote, preguntaValida, prisma, tokenDe } from './utilidades';

let token: string;
let contenidoId: string;
const auth = () => ({ Authorization: `Bearer ${token}` });
const DIA = 86_400_000;

async function banco(n: number) {
  const enunciados = Array.from({ length: n }, (_, i) => `¿Pregunta ${i}?`);
  const res = await request(app).post('/api/v1/admin/preguntas/importar').set(auth()).send(lote(enunciados.map((e) => preguntaValida(e))));
  contenidoId = res.body.contenidoId;
  await prisma.pregunta.updateMany({ data: { estado: 'APROBADA' } });
  return prisma.pregunta.findMany({ orderBy: { enunciado: 'asc' } });
}
const usuarioId = async () => (await prisma.usuario.findFirstOrThrow()).id;
const opcion = async (preguntaId: string, correcta: boolean) =>
  (await prisma.opcion.findFirstOrThrow({ where: { preguntaId, correcta } })).id;
const crear = (cuerpo: object) => request(app).post('/api/v1/quizzes').set(auth()).send(cuerpo);

beforeEach(async () => {
  await limpiarBase();
  token = await tokenDe('ADMIN');
});
afterAll(() => prisma.$disconnect());

describe('SM-2 simplificado con confianza', () => {
  it('seguro: 1 → 3 → 8 → 20 días; dudé ×1,2; adiviné y fallo vuelven a 1 día', () => {
    let e = siguienteEstado(null, true, 3);
    expect(e).toEqual({ facilidad: 2.5, intervaloDias: 1 });
    e = siguienteEstado(e, true, 3);
    expect(e.intervaloDias).toBe(3);
    e = siguienteEstado(e, true, 3);
    expect(e.intervaloDias).toBe(8);
    expect(siguienteEstado(e, true, 3).intervaloDias).toBe(20);
    expect(siguienteEstado({ facilidad: 2.5, intervaloDias: 10 }, true, 2).intervaloDias).toBe(12);
    expect(siguienteEstado({ facilidad: 2.5, intervaloDias: 10 }, true, 1)).toEqual({ facilidad: 2.5, intervaloDias: 1 });
    expect(siguienteEstado({ facilidad: 2.5, intervaloDias: 10 }, false, 3)).toEqual({ facilidad: 2.3, intervaloDias: 1 });
    expect(siguienteEstado({ facilidad: 1.35, intervaloDias: 2 }, false, null).facilidad).toBe(1.3);
  });

  it('responder actualiza el intervalo, la próxima revisión e informa el próximo repaso', async () => {
    const [p] = await banco(1);
    const quiz = (await crear({ contenidoIds: [contenidoId], cantidad: 10 })).body;
    const fb = await request(app)
      .post(`/api/v1/quizzes/${quiz.id}/respuestas`)
      .set(auth())
      .send({ preguntaId: p!.id, opcionIds: [await opcion(p!.id, true)], confianza: 3 });
    expect(fb.body.proximoRepasoDias).toBe(1);
    const estado = await prisma.estadoEstudio.findFirstOrThrow({ where: { preguntaId: p!.id } });
    expect(estado.intervaloDias).toBe(1);
    expect(estado.proximaRevision.getTime()).toBeGreaterThan(Date.now() + DIA - 60_000);
  });
});

describe('Selección para práctica (40% vencidas · 30% débiles · 30% nuevas)', () => {
  it('incluye las vencidas más atrasadas y completa con nuevas repartidas', () => {
    const ahora = new Date();
    const cand = [
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `v${i}`,
        temaId: 'A',
        estado: { aciertos: 1, fallos: 1, intervaloDias: 1, proximaRevision: new Date(ahora.getTime() - (i + 1) * DIA) },
      })),
      ...Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, temaId: i % 2 ? 'B' : 'C', estado: null })),
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `d${i}`,
        temaId: 'D',
        estado: { aciertos: 5, fallos: 0, intervaloDias: 30, proximaRevision: new Date(ahora.getTime() + 20 * DIA) },
      })),
    ];
    const elegidas = seleccionar(cand, 'PRACTICA', 10, false, ahora).map((c) => c.id);
    expect(elegidas).toHaveLength(10);
    expect(elegidas.slice(0, 4)).toEqual(['v9', 'v8', 'v7', 'v6']); // 40%: las vencidas más atrasadas
    // El tema A también es débil (dominio 0%): su 30% sale de ahí; el resto, nuevas.
    expect(elegidas.filter((id) => id.startsWith('v'))).toHaveLength(7);
    expect(elegidas.some((id) => id.startsWith('d'))).toBe(false); // lo dominado no entra si hay otras
    const nuevas = elegidas.filter((id) => id.startsWith('n'));
    expect(nuevas).toHaveLength(3);
    expect(new Set(nuevas.map((id) => cand.find((c) => c.id === id)!.temaId)).size).toBe(2); // repartidas entre B y C
  });
});

describe('Repaso del día', () => {
  it('cuenta lo vencido, arma el quiz solo con eso y avisa cuando no hay nada', async () => {
    const preguntas = await banco(5);
    const uid = await usuarioId();
    const ahora = Date.now();
    await prisma.estadoEstudio.createMany({
      data: [
        { usuarioId: uid, preguntaId: preguntas[0]!.id, aciertos: 1, fallos: 0, intervaloDias: 1, proximaRevision: new Date(ahora - 2 * DIA) },
        { usuarioId: uid, preguntaId: preguntas[1]!.id, aciertos: 0, fallos: 1, intervaloDias: 1, proximaRevision: new Date(ahora - DIA) },
        { usuarioId: uid, preguntaId: preguntas[2]!.id, aciertos: 2, fallos: 0, intervaloDias: 8, proximaRevision: new Date(ahora + 8 * DIA) },
      ],
    });
    const hoy = await request(app).get('/api/v1/me/repaso-hoy').set(auth());
    expect(hoy.body.pendientes).toBe(2);
    expect(hoy.body.porContenido[0]).toMatchObject({ titulo: 'Ley 070', pendientes: 2 });

    const quiz = await crear({ modo: 'REPASO_DIARIO', cantidad: 20 });
    expect(quiz.status).toBe(201);
    expect(quiz.body.modo).toBe('REPASO_DIARIO');
    expect(quiz.body.preguntas.map((p: { id: string }) => p.id).sort()).toEqual([preguntas[0]!.id, preguntas[1]!.id].sort());

    const panel = await request(app).get('/api/v1/me/panel').set(auth());
    expect(panel.body).toMatchObject({ repasoHoy: 2, errores: 1, dominio: 20 });

    await prisma.estadoEstudio.updateMany({ data: { proximaRevision: new Date(ahora + 3 * DIA) } });
    const vacio = await crear({ modo: 'REPASO_DIARIO', cantidad: 20 });
    expect(vacio.status).toBe(409);
    expect(vacio.body.error.codigo).toBe('SIN_REPASO');
    expect((await request(app).get('/api/v1/me/repaso-hoy').set(auth())).body.proximaEn).not.toBeNull();
  });
});

describe('Cuaderno de errores', () => {
  it('lista las falladas no dominadas, filtra por documento y arma un quiz con ellas o con las indicadas', async () => {
    const preguntas = await banco(4);
    const uid = await usuarioId();
    await prisma.estadoEstudio.createMany({
      data: [
        { usuarioId: uid, preguntaId: preguntas[0]!.id, aciertos: 0, fallos: 2, intervaloDias: 1 },
        { usuarioId: uid, preguntaId: preguntas[1]!.id, aciertos: 1, fallos: 1, intervaloDias: 3 },
        { usuarioId: uid, preguntaId: preguntas[2]!.id, aciertos: 4, fallos: 1, intervaloDias: 20 }, // ya dominada
      ],
    });
    const lista = await request(app).get('/api/v1/me/errores').set(auth());
    expect(lista.body.map((e: { preguntaId: string }) => e.preguntaId)).toEqual([preguntas[0]!.id, preguntas[1]!.id]);
    expect(lista.body[0]).toMatchObject({ fallos: 2, contenido: 'Ley 070', correctas: ['Correcta'] });
    expect((await request(app).get(`/api/v1/me/errores?contenidoId=${contenidoId}`).set(auth())).body).toHaveLength(2);
    expect((await request(app).get('/api/v1/me/errores?contenidoId=otro').set(auth())).body).toHaveLength(0);

    const quiz = await crear({ modo: 'REPASO_ERRORES', cantidad: 10 });
    expect(quiz.body.cantidad).toBe(2);
    // Repasar exactamente las falladas de un intento, aunque ya estén dominadas.
    const exactas = await crear({ modo: 'REPASO_ERRORES', preguntaIds: [preguntas[2]!.id, preguntas[3]!.id], cantidad: 10 });
    expect(exactas.body.cantidad).toBe(2);
  });

  it('una práctica sin documentos sigue siendo inválida', async () => {
    await banco(1);
    expect((await crear({ cantidad: 10 })).status).toBe(400);
  });
});

describe('Dominio por documento y tema', () => {
  it('dominio = preguntas con intervalo ≥ 7 días sobre el total; acierto histórico', async () => {
    const preguntas = await banco(4);
    const uid = await usuarioId();
    await prisma.estadoEstudio.createMany({
      data: [
        { usuarioId: uid, preguntaId: preguntas[0]!.id, aciertos: 3, fallos: 0, intervaloDias: 8 },
        { usuarioId: uid, preguntaId: preguntas[1]!.id, aciertos: 0, fallos: 1, intervaloDias: 1 },
      ],
    });
    const p = (await request(app).get('/api/v1/me/progreso').set(auth())).body;
    expect(p).toMatchObject({ total: 4, vistas: 2, dominadas: 1, dominio: 25 });
    expect(p.contenidos[0]).toMatchObject({ titulo: 'Ley 070', dominio: 25, acierto: 75 });
    expect(p.contenidos[0].temas[0]).toMatchObject({ nombre: 'Título I › Capítulo I', total: 4, dominadas: 1 });
  });
});
