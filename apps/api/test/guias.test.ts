import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app, limpiarBase, lote, preguntaValida, prisma, tokenDe } from './utilidades';

let admin: string;
let contenidoId: string;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const guia = {
  resumen: 'La Ley 070 organiza el Sistema Educativo Plurinacional y fija sus bases, fines y objetivos.',
  ideasClave: ['Tres subsistemas', 'Educación descolonizadora'],
  obligatorio: [{ parte: 'Arts. 3-5', titulo: 'Bases, fines y objetivos', porQue: 'Pregunta clásica del examen' }],
  opcional: [{ parte: 'Arts. 28-30', titulo: 'Educación superior', porQue: 'Poco peso para un CEA' }],
  consejos: ['Distinguir fines de objetivos'],
};

beforeEach(async () => {
  await limpiarBase();
  admin = await tokenDe('ADMIN');
  const res = await request(app)
    .post('/api/v1/admin/preguntas/importar')
    .set(auth(admin))
    .send(lote([preguntaValida('¿Aprobada?'), preguntaValida('¿Borrador?')]));
  contenidoId = res.body.contenidoId;
  await prisma.pregunta.updateMany({ where: { enunciado: '¿Aprobada?' }, data: { estado: 'APROBADA' } });
});
afterAll(() => prisma.$disconnect());

describe('Guías de estudio', () => {
  it('el admin crea la guía y cualquiera la lee con las preguntas disponibles', async () => {
    const put = await request(app).put(`/api/v1/admin/guias/${contenidoId}`).set(auth(admin)).send(guia);
    expect(put.status).toBe(200);
    expect(put.body.obligatorio).toHaveLength(1);

    const revisor = await tokenDe('REVISOR');
    const lista = await request(app).get('/api/v1/guias').set(auth(revisor));
    expect(lista.status).toBe(200);
    expect(lista.body).toHaveLength(1);
    expect(lista.body[0]).toMatchObject({ tieneGuia: true, disponibles: 1, obligatorias: 1, opcionales: 1 });
    expect(lista.body[0].extracto).toContain('Ley 070');

    const detalle = await request(app).get(`/api/v1/guias/${contenidoId}`).set(auth(revisor));
    expect(detalle.status).toBe(200);
    expect(detalle.body).toMatchObject({ titulo: 'Ley 070', disponibles: 1, consejos: guia.consejos });
  });

  it('volver a guardar reemplaza la guía', async () => {
    await request(app).put(`/api/v1/admin/guias/${contenidoId}`).set(auth(admin)).send(guia);
    await request(app)
      .put(`/api/v1/admin/guias/${contenidoId}`)
      .set(auth(admin))
      .send({ ...guia, opcional: [] });
    expect(await prisma.guiaEstudio.count()).toBe(1);
    const detalle = await request(app).get(`/api/v1/guias/${contenidoId}`).set(auth(admin));
    expect(detalle.body.opcional).toEqual([]);
  });

  it('un documento sin guía aparece en la lista pero su detalle da 404', async () => {
    const lista = await request(app).get('/api/v1/guias').set(auth(admin));
    expect(lista.body[0]).toMatchObject({ tieneGuia: false, extracto: null });
    const detalle = await request(app).get(`/api/v1/guias/${contenidoId}`).set(auth(admin));
    expect(detalle.status).toBe(404);
  });

  it('valida la guía y solo el admin puede guardarla', async () => {
    const invalida = await request(app)
      .put(`/api/v1/admin/guias/${contenidoId}`)
      .set(auth(admin))
      .send({ ...guia, obligatorio: [] });
    expect(invalida.status).toBe(400);

    const estudiante = await tokenDe('ESTUDIANTE');
    const sinPermiso = await request(app).put(`/api/v1/admin/guias/${contenidoId}`).set(auth(estudiante)).send(guia);
    expect(sinPermiso.status).toBe(403);
  });

  it('un estudiante solo ve las guías de documentos publicados y asignados', async () => {
    await request(app).put(`/api/v1/admin/guias/${contenidoId}`).set(auth(admin)).send(guia);
    const estudiante = await tokenDe('ESTUDIANTE');
    const lista = await request(app).get('/api/v1/guias').set(auth(estudiante));
    expect(lista.body).toEqual([]);
    const detalle = await request(app).get(`/api/v1/guias/${contenidoId}`).set(auth(estudiante));
    expect(detalle.status).toBe(404);
  });
});
