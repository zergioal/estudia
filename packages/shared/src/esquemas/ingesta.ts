import { z } from 'zod';
import { TIPOS_FUENTE } from '../enums';

export const ESTADOS_DOCUMENTO = ['SUBIDO', 'PROCESANDO', 'EXTRAIDO', 'FRAGMENTADO', 'ERROR'] as const;
export type EstadoDocumento = (typeof ESTADOS_DOCUMENTO)[number];

export const documentoSubirSchema = z.object({
  contenidoId: z.string().trim().min(1, 'Elige un contenido'),
  /** "false" desactiva el OCR (más rápido; las páginas escaneadas quedan vacías). */
  ocr: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v !== 'false'),
});
export type DocumentoSubir = z.infer<typeof documentoSubirSchema>;

export const documentosFiltroSchema = z.object({
  contenidoId: z.string().optional(),
});

export interface DocumentoResumen {
  id: string;
  contenido: { id: string; titulo: string; clave: string | null };
  nombreArchivo: string;
  estado: EstadoDocumento;
  error: string | null;
  paginas: number | null;
  paginasOcr: number;
  modo: string | null;
  totalFragmentos: number;
  creadoEn: string;
  procesadoEn: string | null;
}

export interface FragmentoResumen {
  id: string;
  ref: string | null;
  etiqueta: string;
  tema: string | null;
  texto: string;
  palabras: number;
  paginaDesde: number;
  paginaHasta: number;
  totalPreguntas: number;
}

export interface DocumentoDetalle extends DocumentoResumen {
  fragmentos: FragmentoResumen[];
}

export interface ResultadoExportacion {
  carpeta: string;
  archivos: number;
}

/** fuentes/<carpeta>/manifiesto.json: títulos y claves de los PDFs para `npm run ingestar`. */
export const manifiestoIngestaSchema = z.object({
  coleccion: z.string().trim().min(1).optional(),
  documentos: z
    .array(
      z.object({
        archivo: z.string().trim().min(1),
        titulo: z.string().trim().min(1),
        tipoFuente: z.enum(TIPOS_FUENTE).optional(),
        clave: z
          .string()
          .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Solo minúsculas, números y guiones')
          .optional(),
        ocr: z.boolean().optional(),
      }),
    )
    .default([]),
});
export type ManifiestoIngesta = z.infer<typeof manifiestoIngestaSchema>;
