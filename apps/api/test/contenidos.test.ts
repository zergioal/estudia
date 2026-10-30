import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app, limpiarBase, prisma, tokenDe } from './utilidades';

let token: string;
const api = () => ({
  get: (url: string) => request(app).get(`/api/v1/admin${url}`).set('Authorization', `Bearer ${token}`),
  post: (url: string, body: object) =>
    request(app).post(`/api/v1/admin${url}`).set('Authorization', `Bearer ${token}`).send(body),
  patch: (url: string, body: object) =>
    request(app).patch(`/api/v1/admin${url}`).set('Authorization', `Bearer ${token}`).send(body),
  delete: (url: string) => request(app).delete(`/api/v1/admin${url}`).set('Authorization', `Bearer ${token}`),
});

beforeEach(async () => {
  await limpiarBase();
  token = await tokenDe('ADMIN');
});
afterAll(() => prisma.$disconnect());

async function crearBase() {
  const coleccion = (await api().post('/colecciones', { nombre: 'Ascenso 2027' })).body;
  const contenido = (await api().post('/contenidos', { coleccionId: coleccion.id, titulo: 'Ley 070', tipoFuente: 'LEY' })).body;
  return { coleccion, contenido };
}

describe('CRUD de colección, contenido y tema', () => {
  it('crea y devuelve el árbol jerárquico', async () => {
    const { contenido } = await crearBase();
    const titulo = (await api().post('/temas', { contenidoId: contenido.id, nombre: 'Título I' })).body;
    const cap1 = (await api().post('/temas', { contenidoId: contenido.id, padreId: titulo.id, nombre: 'Capítulo I' })).body;
    const cap2 = (await api().post('/temas', { contenidoId: contenido.id, padreId: titulo.id, nombre: 'Capítulo II' })).body;

    expect(cap1.orden).toBe(0);
    expect(cap2.orden).toBe(1);

    const arbol = (await api().get('/arbol')).body;
    expect(arbol).toHaveLength(1);
    expect(arbol[0].contenidos[0].titulo).toBe('Ley 070');
    const raiz = arbol[0].contenidos[0].temas;
    expect(raiz).toHaveLength(1);
    expect(raiz[0].hijos.map((h: { nombre: string }) => h.nombre)).toEqual(['Capítulo I', 'Capítulo II']);
  });

  it('edita y elimina', async () => {
    const { coleccion, contenido } = await crearBase();
    const tema = (await api().post('/temas', { contenidoId: contenido.id, nombre: 'Tema' })).body;

    expect((await api().patch(`/colecciones/${coleccion.id}`, { nombre: 'Ascenso 2028' })).body.nombre).toBe('Ascenso 2028');
    expect((await api().patch(`/contenidos/${contenido.id}`, { publicado: true })).body.publicado).toBe(true);
    expect((await api().patch(`/temas/${tema.id}`, { nombre: 'Tema renombrado' })).body.nombre).toBe('Tema renombrado');

    expect((await api().delete(`/colecciones/${coleccion.id}`)).status).toBe(409);
    expect((await api().delete(`/contenidos/${contenido.id}`)).status).toBe(204);
    expect((await api().delete(`/colecciones/${coleccion.id}`)).status).toBe(204);
    expect(await prisma.tema.count()).toBe(0);
  });

  it('impide ciclos y padres de otro contenido', async () => {
    const { coleccion, contenido } = await crearBase();
    const otro = (await api().post('/contenidos', { coleccionId: coleccion.id, titulo: 'RM 001/2026', tipoFuente: 'RM' })).body;
    const a = (await api().post('/temas', { contenidoId: contenido.id, nombre: 'A' })).body;
    const b = (await api().post('/temas', { contenidoId: contenido.id, padreId: a.id, nombre: 'B' })).body;
    const ajeno = (await api().post('/temas', { contenidoId: otro.id, nombre: 'Ajeno' })).body;

    expect((await api().patch(`/temas/${a.id}`, { padreId: b.id })).status).toBe(400);
    expect((await api().patch(`/temas/${a.id}`, { padreId: a.id })).status).toBe(400);
    expect((await api().post('/temas', { contenidoId: contenido.id, padreId: ajeno.id, nombre: 'X' })).status).toBe(400);
    expect((await api().delete(`/temas/${a.id}`)).status).toBe(409);
  });

  it('valida entradas y responde 409 si el nombre ya existe', async () => {
    expect((await api().post('/colecciones', { nombre: '' })).status).toBe(400);
    const { coleccion } = await crearBase();
    expect((await api().post('/contenidos', { coleccionId: coleccion.id, titulo: 'X', tipoFuente: 'OTRO' })).status).toBe(400);
    const repetida = await api().post('/colecciones', { nombre: 'Ascenso 2027' });
    expect(repetida.status).toBe(409);
    expect(repetida.body.error.codigo).toBe('CONFLICTO');
  });
});
