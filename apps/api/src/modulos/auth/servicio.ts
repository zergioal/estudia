import bcrypt from 'bcryptjs';
import type { UsuarioPublico } from '@estudia/shared';
import { prisma } from '../../db';
import { ErrorApp, noEncontrado } from '../../errores';
import { firmarToken } from '../../middleware/auth';
import type { LoginEntrada, LoginRespuesta } from './esquemas';

// Hash fijo para comparar aunque el usuario no exista (tiempo de respuesta parejo).
const HASH_FALSO = bcrypt.hashSync('usuario-inexistente', 10);

export async function login({ usuario, password }: LoginEntrada): Promise<LoginRespuesta> {
  const u = await prisma.usuario.findUnique({ where: { usuario } });
  const valida = await bcrypt.compare(password, u?.passwordHash ?? HASH_FALSO);
  if (!u || !valida) {
    throw new ErrorApp(401, 'CREDENCIALES_INVALIDAS', 'Usuario o contraseña incorrectos');
  }
  if (!u.activo) {
    throw new ErrorApp(403, 'USUARIO_INACTIVO', 'La cuenta está desactivada');
  }
  const publico: UsuarioPublico = { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol };
  return { token: firmarToken(publico), usuario: publico };
}

export async function obtenerUsuario(id: string): Promise<UsuarioPublico> {
  const u = await prisma.usuario.findUnique({
    where: { id },
    select: { id: true, usuario: true, nombre: true, rol: true, activo: true },
  });
  if (!u || !u.activo) throw noEncontrado('El usuario');
  return { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol };
}
