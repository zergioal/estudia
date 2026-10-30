import { z } from 'zod';
import { ROLES } from '../enums';

export const loginEntradaSchema = z.object({
  usuario: z.string().trim().min(1, 'El usuario es obligatorio'),
  password: z.string().min(1, 'La contraseña es obligatoria'),
});
export type LoginEntrada = z.infer<typeof loginEntradaSchema>;

export const usuarioPublicoSchema = z.object({
  id: z.string(),
  usuario: z.string(),
  nombre: z.string(),
  rol: z.enum(ROLES),
});
export type UsuarioPublico = z.infer<typeof usuarioPublicoSchema>;

export interface LoginRespuesta {
  token: string;
  usuario: UsuarioPublico;
}
