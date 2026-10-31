import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app, limpiarBase, lote, preguntaValida, prisma, tokenDe } from './utilidades';

let token: string;
const auth = () => ({ Authorization: `Bearer ${token}` });

/** Importa y aprueba n preguntas en un documento del tipo indicado. */
async function banco(titulo: string, tipoFuente: string, n: number) {
  const enunciados = Array.from({ length: n }, (_, i) => `¿${titulo} ${i}?`);
  const res = await request(app)
    .post('/api/v1/admin/preguntas/importar')
    .set(auth())
    .send(lote(enunciados.map((e) => preguntaValida(e)), { contenido: titulo, fragmentoRef: undefined }));
  await prisma.contenido.update({ where: { id: res.body.contenidoId }, data: { tipoFuente } });
  await prisma.pregunta.updateMany({ where: { enunciado: { in: enunciados } }, data: { estado: 'APROBADA' } });
}
const crear = () => request(app).post('/api/v1/simulacros').set(auth()).send();
const correctaDe = async (preguntaId: string) =>
  (await prisma.opcion.findFirstOrThrow({ where: { preguntaId, correcta: true } })).id;

beforeEach(async () => {
  await limpiarBase();
  token = await tokenDe('ADMIN');
});
afterAll(() => prisma.$disconnect());

describe('Simulacro de examen', () => {
  it('arma 100 preguntas: 35 de normativa y 65 técnico-pedagógicas, con 150 minutos', async () => {
    await banco('Ley 070', 'LEY', 60);
    await banco('Libro de liderazgo', 'LIBRO', 80);
    const res = await crear();
    expect(res.status).toBe(201);
    expect(res.body.modo).toBe('SIMULACRO');
    expect(res.body.cantidad).toBe(100);
    const contenidos = res.body.preguntas.map((p: { contenido: string }) => p.contenido);
    expect(contenidos.filter((c: string) => c === 'Ley 070')).toHaveLength(35);
    expect(contenidos.filter((c: string) => c === 'Libro de liderazgo')).toHaveLength(65);
    const minutos = (Date.parse(res.body.limiteEn) - Date.parse(res.body.iniciadoEn)) / 60_000;
    expect(minutos).toBe(150);
    expect(JSON.stringify(res.body)).not.toContain('"correcta"');
  });

  it('si un bloque no alcanza, el otro completa; con menos de 100 en total usa todas', async () => {
    await banco('Ley 070', 'LEY', 10);
    await banco('Libro de liderazgo', 'LIBRO', 30);
    const res = await crear();
    expect(res.body.cantidad).toBe(40);
  });

  it('al responder no revela si acertó; al finalizar da nota, aprobado y errores (incluidas las no respondidas)', async () => {
    await banco('Ley 070', 'LEY', 3);
    await banco('Libro de liderazgo', 'LIBRO', 1);
    const sim = (await crear()).body;
    const [p1, p2, p3] = sim.preguntas;

    const r1 = await request(app)
      .post(`/api/v1/quizzes/${sim.id}/respuestas`)
      .set(auth())
      .send({ preguntaId: p1.id, opcionIds: [await correctaDe(p1.id)] });
    expect(r1.status).toBe(200);
    expect(r1.body).toEqual({ registrada: true, preguntaId: p1.id, opcionIds: [await correctaDe(p1.id)] });
    const incorrecta = (await prisma.opcion.findFirstOrThrow({ where: { preguntaId: p2.id, correcta: false } })).id;
    await request(app).post(`/api/v1/quizzes/${sim.id}/respuestas`).set(auth()).send({ preguntaId: p2.id, opcionIds: [incorrecta] });
    await request(app).post(`/api/v1/quizzes/${sim.id}/respuestas`).set(auth()).send({ preguntaId: p3.id, opcionIds: [await correctaDe(p3.id)] });

    // En curso: ni aciertos ni feedback, y el resumen está bloqueado.
    const enCurso = await request(app).get(`/api/v1/quizzes/${sim.id}`).set(auth());
    expect(enCurso.body).toMatchObject({ aciertos: 0, puntaje: 0, respondidas: 3 });
    expect(enCurso.body.preguntas.every((p: { feedback: unknown }) => p.feedback === null)).toBe(true);
    expect(enCurso.body.preguntas[0].respondida).toBe(true);
    expect((await request(app).get(`/api/v1/quizzes/${sim.id}/resumen`).set(auth())).status).toBe(409);

    const fin = await request(app).post(`/api/v1/quizzes/${sim.id}/finalizar`).set(auth());
    expect(fin.status).toBe(200);
    expect(fin.body.simulacro).toMatchObject({ nota: 50, aprobado: false, notaMinima: 51, sinResponder: 1, minutosLimite: 150 });
    expect(fin.body.falladas).toHaveLength(2);
    expect(fin.body.falladas.filter((f: { sinResponder: boolean }) => f.sinResponder)).toHaveLength(1);
    expect(fin.body.simulacro.porBloque.map((b: { bloque: string }) => b.bloque).sort()).toEqual(['Normativa', 'Técnico-pedagógico']);

    // Terminado: ahora sí se ve el feedback.
    const despues = await request(app).get(`/api/v1/quizzes/${sim.id}`).set(auth());
    expect(despues.body.aciertos).toBe(2);
    expect(despues.body.preguntas.find((p: { id: string }) => p.id === p1.id).feedback.correcta).toBe(true);
  });

  it('pasados los 150 minutos se cierra solo y ya no acepta respuestas', async () => {
    await banco('Ley 070', 'LEY', 2);
    const sim = (await crear()).body;
    await prisma.intento.update({ where: { id: sim.id }, data: { iniciadoEn: new Date(Date.now() - 151 * 60_000) } });

    const r = await request(app)
      .post(`/api/v1/quizzes/${sim.id}/respuestas`)
      .set(auth())
      .send({ preguntaId: sim.preguntas[0].id, opcionIds: [await correctaDe(sim.preguntas[0].id)] });
    expect(r.status).toBe(409);
    const estado = await request(app).get(`/api/v1/quizzes/${sim.id}`).set(auth());
    expect(estado.body.finalizadoEn).not.toBeNull();
    const resumen = await request(app).get(`/api/v1/quizzes/${sim.id}/resumen`).set(auth());
    expect(resumen.body.simulacro).toMatchObject({ nota: 0, sinResponder: 2 });
  });

  it('sin preguntas aprobadas responde 409', async () => {
    expect((await crear()).status).toBe(409);
  });
});
