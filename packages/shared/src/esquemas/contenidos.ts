import { z } from 'zod';
import { TIPOS_FUENTE } from '../enums';

const texto = z.string().trim().min(1, 'No puede estar vacío');

export const coleccionCrearSchema = z.object({
  nombre: texto,
  descripcion: z.string().trim().optional().nullable(),
});
export const coleccionEditarSchema = coleccionCrearSchema.partial();
export type ColeccionCrear = z.infer<typeof coleccionCrearSchema>;

export const contenidoCrearSchema = z.object({
  coleccionId: texto,
  titulo: texto,
  tipoFuente: z.enum(TIPOS_FUENTE),
  publicado: z.boolean().optional(),
});
export const contenidoEditarSchema = contenidoCrearSchema.partial();
export type ContenidoCrear = z.infer<typeof contenidoCrearSchema>;

export const temaCrearSchema = z.object({
  contenidoId: texto,
  padreId: z.string().optional().nullable(),
  nombre: texto,
  orden: z.number().int().min(0).optional(),
});
export const temaEditarSchema = z.object({
  padreId: z.string().optional().nullable(),
  nombre: texto.optional(),
  orden: z.number().int().min(0).optional(),
});
export type TemaCrear = z.infer<typeof temaCrearSchema>;

export interface TemaNodo {
  id: string;
  nombre: string;
  orden: number;
  padreId: string | null;
  totalPreguntas: number;
  hijos: TemaNodo[];
}

export interface ContenidoNodo {
  id: string;
  titulo: string;
  tipoFuente: string;
  publicado: boolean;
  temas: TemaNodo[];
}

export interface ColeccionNodo {
  id: string;
  nombre: string;
  descripcion: string | null;
  contenidos: ContenidoNodo[];
}
