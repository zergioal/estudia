import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app, crearUsuario, limpiarBase, prisma, tokenDe } from './utilidades';

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

describe('POST /api/v1/auth/login', () => {
  it('devuelve token y usuario con credenciales correctas', async () => {
    await crearUsuario('admin', 'clave-segura');
    const res = await request(app).post('/api/v1/auth/login').send({ usuario: 'admin', password: 'clave-segura' });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.usuario).toMatchObject({ usuario: 'admin', rol: 'ADMIN' });
    expect(res.body.usuario.passwordHash).toBeUndefined();
  });

  it('rechaza contraseña incorrecta con 401', async () => {
    await crearUsuario('admin', 'clave-segura');
    const res = await request(app).post('/api/v1/auth/login').send({ usuario: 'admin', password: 'otra' });

    expect(res.status).toBe(401);
    expect(res.body.error.codigo).toBe('CREDENCIALES_INVALIDAS');
  });

  it('rechaza usuario inexistente con el mismo error', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ usuario: 'nadie', password: 'x' });
    expect(res.status).toBe(401);
    expect(res.body.error.codigo).toBe('CREDENCIALES_INVALIDAS');
  });

  it('rechaza cuenta desactivada con 403', async () => {
    await crearUsuario('inactivo', 'clave-segura', 'ESTUDIANTE', false);
    const res = await request(app).post('/api/v1/auth/login').send({ usuario: 'inactivo', password: 'clave-segura' });
    expect(res.status).toBe(403);
    expect(res.body.error.codigo).toBe('USUARIO_INACTIVO');
  });

  it('valida el cuerpo con Zod', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ usuario: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe('VALIDACION');
    expect(res.body.error.detalles.length).toBeGreaterThan(0);
  });
});

describe('autenticación y roles', () => {
  it('GET /auth/yo devuelve el usuario del token', async () => {
    const token = await tokenDe('ESTUDIANTE');
    const res = await request(app).get('/api/v1/auth/yo').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.rol).toBe('ESTUDIANTE');
  });

  it('sin token responde 401', async () => {
    const res = await request(app).get('/api/v1/admin/arbol');
    expect(res.status).toBe(401);
    expect(res.body.error.codigo).toBe('NO_AUTENTICADO');
  });

  it('token falso responde 401', async () => {
    const res = await request(app).get('/api/v1/admin/arbol').set('Authorization', 'Bearer abc.def.ghi');
    expect(res.status).toBe(401);
    expect(res.body.error.codigo).toBe('TOKEN_INVALIDO');
  });

  it('un ESTUDIANTE no entra a rutas de admin (403)', async () => {
    const token = await tokenDe('ESTUDIANTE');
    const res = await request(app).get('/api/v1/admin/arbol').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.codigo).toBe('SIN_PERMISO');
  });

  it('un REVISOR puede ver la bandeja pero no importar', async () => {
    const token = await tokenDe('REVISOR');
    const bandeja = await request(app).get('/api/v1/admin/revision').set('Authorization', `Bearer ${token}`);
    expect(bandeja.status).toBe(200);
    const importar = await request(app)
      .post('/api/v1/admin/preguntas/importar')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(importar.status).toBe(403);
  });
});
