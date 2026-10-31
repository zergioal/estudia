import { z } from 'zod';

// ---------- Validador "a ciegas" ----------

/** Lo que devuelve la IA al resolver una pregunta sin ver la respuesta. */
export const respuestaCiegaSchema = z.object({
  /** Letra de la opción elegida (A, B, C…). */
  respuesta: z.string().trim().min(1).max(2),
  /** true si más de una opción podría defenderse como correcta o el enunciado no alcanza para decidir. */
  ambigua: z.boolean(),
  motivo: z.string().trim(),
});
export type RespuestaCiega = z.infer<typeof respuestaCiegaSchema>;

export interface ResultadoCiego extends RespuestaCiega {
  /** true si eligió la opción marcada como correcta. */
  coincide: boolean;
  modelo: string;
}

// ---------- Análisis ----------

export const analizarSchema = z.object({
  /** Además de las reglas, resolver con Claude "a ciegas" las que pasen (requiere ANTHROPIC_API_KEY). */
  ciego: z.boolean().default(false),
  /** Volver a validar también las ya validadas (por ejemplo, tras cambiar las reglas). */
  todas: z.boolean().default(false),
});
export type Analizar = z.input<typeof analizarSchema>;

export interface ResultadoAnalisis {
  embebidas: number;
  /** Preguntas en BORRADOR marcadas DUPLICADA por parecerse a otra existente. */
  duplicadas: number;
  validadas: number;
  conAlertas: number;
  /** Resueltas por el validador "a ciegas" (0 si no se pidió o no está disponible). */
  ciegas: number;
  ciegasFallidas: number;
}

export interface ResumenCalidad {
  porEstado: Record<string, number>;
  /** Pendientes (BORRADOR/VALIDADA) con alertas. */
  conAlertas: number;
  sinEmbedding: number;
  sinValidar: number;
  reportesAbiertos: number;
  ciegoDisponible: boolean;
  umbralDuplicado: number;
}

// ---------- Estadísticas ----------

export const estadisticasFiltroSchema = z.object({
  /** Respuestas mínimas para opinar sobre una pregunta. */
  minRespuestas: z.coerce.number().int().min(1).max(1000).default(5),
  contenidoId: z.string().optional(),
});
export type EstadisticasFiltro = z.infer<typeof estadisticasFiltroSchema>;

export interface OpcionEstadistica {
  id: string;
  texto: string;
  correcta: boolean;
  /** Veces que fue elegida. */
  elegida: number;
}

export interface PreguntaEstadistica {
  id: string;
  enunciado: string;
  referencia: string;
  contenido: string;
  respondidas: number;
  /** % de acierto. */
  acierto: number;
  /**
   * DIFICILISIMA: acierto < 15 % (¿respuesta errada o ambigua?). REGALADA: > 98 % (¿la correcta se delata?).
   * DISTRACTOR_ATRACTIVO: un distractor se elige más que la correcta.
   */
  problema: 'DIFICILISIMA' | 'REGALADA' | 'DISTRACTOR_ATRACTIVO';
  opciones: OpcionEstadistica[];
  reportes: number;
}

export interface EstadisticasPreguntas {
  minRespuestas: number;
  /** Aprobadas con al menos minRespuestas respuestas. */
  evaluadas: number;
  rotas: PreguntaEstadistica[];
}

// ---------- Duplicados ----------

export const similaresFiltroSchema = z.object({
  umbral: z.coerce.number().min(0.8).max(1).default(0.95),
  contenidoId: z.string().optional(),
  limite: z.coerce.number().int().min(1).max(500).default(100),
});
export type SimilaresFiltro = z.infer<typeof similaresFiltroSchema>;

export interface PreguntaBreve {
  id: string;
  enunciado: string;
  correcta: string;
  estado: string;
  referencia: string;
}

export interface ParSimilar {
  similitud: number;
  contenido: string;
  a: PreguntaBreve;
  b: PreguntaBreve;
}

// ---------- Búsqueda en las fuentes ----------

export const buscarFragmentosSchema = z.object({
  q: z.string().trim().min(3, 'Escribe al menos 3 letras').max(300),
  contenidoId: z.string().optional(),
  limite: z.coerce.number().int().min(1).max(30).default(8),
});
export type BuscarFragmentos = z.infer<typeof buscarFragmentosSchema>;

export interface FragmentoEncontrado {
  id: string;
  ref: string | null;
  etiqueta: string;
  contenido: string;
  paginaDesde: number;
  paginaHasta: number;
  similitud: number;
  extracto: string;
}

// ---------- Reportes ----------

export const MOTIVOS_REPORTE = ['RESPUESTA_ERRADA', 'AMBIGUA', 'REDACCION', 'DESACTUALIZADA', 'OTRO'] as const;
export type MotivoReporte = (typeof MOTIVOS_REPORTE)[number];
export const NOMBRE_MOTIVO: Record<MotivoReporte, string> = {
  RESPUESTA_ERRADA: 'La respuesta marcada como correcta está mal',
  AMBIGUA: 'Hay más de una respuesta correcta o es ambigua',
  REDACCION: 'Está mal redactada o tiene errores',
  DESACTUALIZADA: 'La norma cambió o está desactualizada',
  OTRO: 'Otro problema',
};

export const reporteCrearSchema = z.object({
  motivo: z.enum(MOTIVOS_REPORTE),
  comentario: z.string().trim().max(1000).optional(),
});
export type ReporteCrear = z.infer<typeof reporteCrearSchema>;

export const reportesFiltroSchema = z.object({
  resuelto: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export const reporteResolverSchema = z.object({ resuelto: z.boolean() });

export interface ReporteAdmin {
  id: string;
  motivo: MotivoReporte;
  comentario: string | null;
  resuelto: boolean;
  creadoEn: string;
  usuario: string;
  pregunta: PreguntaBreve & { contenido: string };
}
