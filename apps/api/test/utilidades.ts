import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { Rol } from '@estudia/shared';
import { crearApp } from '../src/app';
import { prisma } from '../src/db';

export const app = crearApp();
export { prisma };

export async function limpiarBase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE "Respuesta", "Intento", "EstadoEstudio", "Opcion", "Pregunta", "Fragmento", "Pagina",
             "Documento", "Tema", "Contenido", "Asignacion", "Coleccion", "Usuario" CASCADE
  `);
}

export async function crearUsuario(usuario: string, password: string, rol: Rol = 'ADMIN', activo = true) {
  return prisma.usuario.create({
    data: { usuario, nombre: usuario, rol, activo, passwordHash: await bcrypt.hash(password, 4) },
  });
}

/** Crea un usuario con el rol indicado y devuelve su token. */
export async function tokenDe(rol: Rol = 'ADMIN') {
  const usuario = `${rol.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`;
  await crearUsuario(usuario, 'clave-segura', rol);
  const res = await request(app).post('/api/v1/auth/login').send({ usuario, password: 'clave-segura' });
  return res.body.token as string;
}

type Opcion = { texto: string; correcta: boolean; porQue?: string };

export function preguntaValida(enunciado: string, extra: Record<string, unknown> = {}) {
  const opciones: Opcion[] = [
    { texto: 'Correcta', correcta: true, porQue: 'Así lo dice el artículo' },
    { texto: 'Distractor A', correcta: false, porQue: 'Confunde con el Art. 4' },
    { texto: 'Distractor B', correcta: false, porQue: 'Plazo cambiado' },
    { texto: 'Distractor C', correcta: false, porQue: 'Norma parecida' },
  ];
  return {
    tipo: 'OPCION_MULTIPLE',
    dificultad: 'MEDIA',
    nivelBloom: 'COMPRENDER',
    enunciado,
    opciones,
    explicacion: 'Explicación de prueba',
    citaTextual: 'la educación es universal',
    referencia: 'Ley 070, Art. 1, pág. 2',
    etiquetas: ['prueba'],
    ...extra,
  };
}

export function lote(preguntas: unknown[], extra: Record<string, unknown> = {}) {
  return { contenido: 'Ley 070', tema: 'Título I - Capítulo I', fragmentoRef: 'ley070-art01', preguntas, ...extra };
}
