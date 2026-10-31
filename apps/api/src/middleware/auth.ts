import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { ROLES, type Rol } from '@estudia/shared';
import { config } from '../config';
import { ErrorApp } from '../errores';

export interface UsuarioToken {
  id: string;
  usuario: string;
  rol: Rol;
}

declare global {
  namespace Express {
    interface Request {
      usuario?: UsuarioToken;
    }
  }
}

export function firmarToken(u: UsuarioToken): string {
  return jwt.sign({ usuario: u.usuario, rol: u.rol }, config.jwtSecreto, {
    subject: u.id,
    expiresIn: config.jwtExpira as jwt.SignOptions['expiresIn'],
  });
}

// Params `any`, igual que requiereRol, para no imponer su tipo de params a la ruta.
export const requiereAuth: RequestHandler<any> = (req, _res, next) => {
  const cabecera = req.headers.authorization;
  if (!cabecera?.startsWith('Bearer ')) {
    return next(new ErrorApp(401, 'NO_AUTENTICADO', 'Falta el token de acceso'));
  }
  try {
    const payload = jwt.verify(cabecera.slice(7), config.jwtSecreto) as jwt.JwtPayload;
    const rol = payload.rol as Rol;
    if (!payload.sub || !ROLES.includes(rol)) throw new Error('payload inválido');
    req.usuario = { id: payload.sub, usuario: String(payload.usuario), rol };
    next();
  } catch {
    next(new ErrorApp(401, 'TOKEN_INVALIDO', 'Token inválido o vencido'));
  }
};

/** Exige autenticación y uno de los roles indicados. */
// Params `any`: así el guard no le impone su tipo de params a la ruta y `req.params.id` se infiere del path.
export function requiereRol(...roles: Rol[]): RequestHandler<any> {
  return (req, res, next) =>
    requiereAuth(req, res, (err?: unknown) => {
      if (err) return next(err);
      if (!req.usuario || !roles.includes(req.usuario.rol)) {
        return next(new ErrorApp(403, 'SIN_PERMISO', 'No tienes permiso para esta acción'));
      }
      next();
    });
}
