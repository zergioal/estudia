import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import type { ErrorApi } from '@estudia/shared';

export class ErrorApp extends Error {
  constructor(
    public status: number,
    public codigo: string,
    mensaje: string,
    public detalles?: unknown,
  ) {
    super(mensaje);
  }
}

export const noEncontrado = (que: string) => new ErrorApp(404, 'NO_ENCONTRADO', `${que} no existe`);
export const conflicto = (mensaje: string, detalles?: unknown) =>
  new ErrorApp(409, 'CONFLICTO', mensaje, detalles);

/** Convierte issues de Zod en una lista legible: [{ ruta: "opciones", mensaje: "..." }] */
export function issuesZod(error: ZodError) {
  return error.issues.map((i) => ({ ruta: i.path.join('.'), mensaje: i.message }));
}

export const rutaNoEncontrada: RequestHandler = (req, _res, next) => {
  next(new ErrorApp(404, 'RUTA_NO_ENCONTRADA', `No existe ${req.method} ${req.originalUrl}`));
};

export const manejadorErrores: ErrorRequestHandler = (err, _req, res, _next) => {
  let status = 500;
  let cuerpo: ErrorApi = { error: { codigo: 'ERROR_INTERNO', mensaje: 'Error interno del servidor' } };

  if (err instanceof ErrorApp) {
    status = err.status;
    cuerpo = { error: { codigo: err.codigo, mensaje: err.message, detalles: err.detalles } };
  } else if (err instanceof ZodError) {
    status = 400;
    cuerpo = { error: { codigo: 'VALIDACION', mensaje: 'Datos inválidos', detalles: issuesZod(err) } };
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') {
      status = 404;
      cuerpo = { error: { codigo: 'NO_ENCONTRADO', mensaje: 'El recurso no existe' } };
    } else if (err.code === 'P2002') {
      status = 409;
      cuerpo = { error: { codigo: 'CONFLICTO', mensaje: 'Ya existe un registro con ese valor', detalles: err.meta } };
    }
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    cuerpo = { error: { codigo: 'JSON_INVALIDO', mensaje: 'El cuerpo no es JSON válido' } };
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    cuerpo = { error: { codigo: 'DEMASIADO_GRANDE', mensaje: 'El cuerpo excede el tamaño permitido' } };
  }

  if (status === 500) console.error(err);
  res.status(status).json(cuerpo);
};
