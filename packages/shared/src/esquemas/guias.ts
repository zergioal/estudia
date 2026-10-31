import { z } from 'zod';

/** Una parte del documento que conviene leer: "Arts. 3-5" · "Bases, fines y objetivos" · por qué. */
export const parteLecturaSchema = z.object({
  parte: z.string().trim().min(1).max(120),
  titulo: z.string().trim().min(1).max(200),
  porQue: z.string().trim().min(1).max(600),
});
export type ParteLectura = z.infer<typeof parteLecturaSchema>;

/** Contenido de una guía de estudio (lo que se carga desde guias/<clave>.json o por PUT). */
export const guiaContenidoSchema = z.object({
  resumen: z.string().trim().min(20).max(4000),
  ideasClave: z.array(z.string().trim().min(1).max(400)).max(20).default([]),
  obligatorio: z.array(parteLecturaSchema).min(1).max(40),
  opcional: z.array(parteLecturaSchema).max(40).default([]),
  consejos: z.array(z.string().trim().min(1).max(400)).max(20).default([]),
});
export type GuiaContenido = z.infer<typeof guiaContenidoSchema>;

/** Archivo guias/<clave>.json: identifica el documento por su clave (prefijo de fragmentos). */
export const guiaArchivoSchema = guiaContenidoSchema.extend({
  clave: z.string().trim().min(1),
});
export type GuiaArchivo = z.infer<typeof guiaArchivoSchema>;

export interface GuiaResumida {
  contenidoId: string;
  titulo: string;
  tipoFuente: string;
  coleccion: string;
  /** Preguntas aprobadas que pueden entrar a un quiz. */
  disponibles: number;
  tieneGuia: boolean;
  /** Primeras líneas del resumen, para la tarjeta. */
  extracto: string | null;
  obligatorias: number;
  opcionales: number;
}

export interface GuiaDetalle extends GuiaContenido {
  contenidoId: string;
  titulo: string;
  tipoFuente: string;
  coleccion: string;
  disponibles: number;
  actualizadoEn: string;
}
