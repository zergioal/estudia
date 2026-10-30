import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app, limpiarBase, lote, preguntaValida, prisma, tokenDe } from './utilidades';

let token: string;
let ids: string[];
const auth = () => ({ Authorization: `Bearer ${token}` });

beforeEach(async () => {
  await limpiarBase();
  token = await tokenDe('ADMIN');
  await request(app)
    .post('/api/v1/admin/preguntas/importar')
    .set(auth())
    .send(lote([preguntaValida('¿P1?'), preguntaValida('¿P2?'), preguntaValida('¿P3?')]));
  ids = (await prisma.pregunta.findMany({ orderBy: { enunciado: 'asc' } })).map((p) => p.id);
});
afterAll(() => prisma.$disconnect());

describe('GET /api/v1/admin/revision', () => {
  it('lista las preguntas en BORRADOR con opciones, tema y contenido', async () => {
    const res = await request(app).get('/api/v1/admin/revision').set(auth());

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    const p = res.body.items[0];
    expect(p.opciones).toHaveLength(4);
    expect(p.opciones[0]).toHaveProperty('correcta');
    expect(p.tema).toMatchObject({ nombre: 'Capítulo I', contenido: { titulo: 'Ley 070' } });
  });

  it('pagina y filtra por estado', async () => {
    await prisma.pregunta.update({ where: { id: ids[0] }, data: { estado: 'APROBADA' } });
    const pagina = await request(app).get('/api/v1/admin/revision?porPagina=1&pagina=2').set(auth());
    expect(pagina.body).toMatchObject({ total: 2, pagina: 2, porPagina: 1 });
    expect(pagina.body.items).toHaveLength(1);

    const aprobadas = await request(app).get('/api/v1/admin/revision?estado=APROBADA').set(auth());
    expect(aprobadas.body.total).toBe(1);
  });

  it('valida el filtro', async () => {
    const res = await request(app).get('/api/v1/admin/revision?estado=INVENTADO').set(auth());
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/v1/admin/preguntas/:id', () => {
  it('aprueba una pregunta', async () => {
    const res = await request(app).patch(`/api/v1/admin/preguntas/${ids[0]}`).set(auth()).send({ estado: 'APROBADA' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('APROBADA');
  });

  it('descarta una pregunta', async () => {
    const res = await request(app).patch(`/api/v1/admin/preguntas/${ids[0]}`).set(auth()).send({ estado: 'DESCARTADA' });
    expect(res.body.estado).toBe('DESCARTADA');
  });

  it('edita enunciado y reemplaza opciones', async () => {
    const opciones = [
      { texto: 'Nueva correcta', correcta: true, porQue: 'Art. 1' },
      { texto: 'Nuevo A', correcta: false },
      { texto: 'Nuevo B', correcta: false },
      { texto: 'Nuevo C', correcta: false },
    ];
    const res = await request(app)
      .patch(`/api/v1/admin/preguntas/${ids[0]}`)
      .set(auth())
      .send({ enunciado: '¿Editada?', opciones, dificultad: 'DIFICIL' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enunciado: '¿Editada?', dificultad: 'DIFICIL', estado: 'BORRADOR' });
    expect(res.body.opciones.map((o: { texto: string }) => o.texto)).toEqual(opciones.map((o) => o.texto));
    expect(await prisma.opcion.count({ where: { preguntaId: ids[0] } })).toBe(4);
  });

  it('rechaza opciones que no cumplen las reglas del tipo', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/preguntas/${ids[0]}`)
      .set(auth())
      .send({ opciones: [{ texto: 'Sola', correcta: true }] });
    expect(res.status).toBe(400);
    expect(await prisma.opcion.count({ where: { preguntaId: ids[0] } })).toBe(4);
  });

  it('no permite asignar estados que no son de revisión', async () => {
    const res = await request(app).patch(`/api/v1/admin/preguntas/${ids[0]}`).set(auth()).send({ estado: 'DUPLICADA' });
    expect(res.status).toBe(400);
  });

  it('404 si la pregunta no existe', async () => {
    const res = await request(app).patch('/api/v1/admin/preguntas/no-existe').set(auth()).send({ estado: 'APROBADA' });
    expect(res.status).toBe(404);
    expect(res.body.error.codigo).toBe('NO_ENCONTRADO');
  });
});

describe('POST /api/v1/admin/preguntas/aprobar-lote', () => {
  it('aprueba en bloque solo las que están en BORRADOR o VALIDADA', async () => {
    await prisma.pregunta.update({ where: { id: ids[2] }, data: { estado: 'DESCARTADA' } });
    const res = await request(app).post('/api/v1/admin/preguntas/aprobar-lote').set(auth()).send({ ids });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ aprobadas: 2, omitidas: 1 });
    expect(await prisma.pregunta.count({ where: { estado: 'APROBADA' } })).toBe(2);
    expect((await prisma.pregunta.findUniqueOrThrow({ where: { id: ids[2] } })).estado).toBe('DESCARTADA');
  });

  it('valida que venga al menos un id', async () => {
    const res = await request(app).post('/api/v1/admin/preguntas/aprobar-lote').set(auth()).send({ ids: [] });
    expect(res.status).toBe(400);
  });
});
