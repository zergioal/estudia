import { z } from 'zod';
import { DIFICULTADES, type Dificultad, type TipoPregunta } from '../enums';

export const CANTIDADES_QUIZ = [10, 20, 50, 100] as const;
export const MODOS_QUIZ = ['PRACTICA'] as const; // EXAMEN, SIMULACRO y repasos llegan en los hitos 4 y 8

/** XP por acierto según dificultad; ×1,5 si antes la habías fallado (docs/diseno.md). */
export const XP_POR_DIFICULTAD: Record<Dificultad, number> = { FACIL: 10, MEDIA: 20, DIFICIL: 35 };
export const BONUS_RECUPERADA = 1.5;

export const quizCrearSchema = z
  .object({
    modo: z.enum(MODOS_QUIZ).default('PRACTICA'),
    contenidoIds: z.array(z.string().min(1)).default([]),
    temaIds: z.array(z.string().min(1)).default([]),
    dificultades: z.array(z.enum(DIFICULTADES)).default([]),
    cantidad: z
      .number()
      .int()
      .refine((n) => (CANTIDADES_QUIZ as readonly number[]).includes(n), 'La cantidad debe ser 10, 20, 50 o 100'),
  })
  .refine((q) => q.contenidoIds.length > 0 || q.temaIds.length > 0, {
    message: 'Elige al menos un contenido o tema',
    path: ['contenidoIds'],
  });
export type QuizCrear = z.infer<typeof quizCrearSchema>;

export const respuestaEnviarSchema = z.object({
  preguntaId: z.string().min(1),
  opcionIds: z.array(z.string().min(1)).min(1, 'Elige una opción'),
  segundos: z.number().int().min(0).max(3600).optional(),
  confianza: z.number().int().min(1).max(3).optional(),
});
export type RespuestaEnviar = z.infer<typeof respuestaEnviarSchema>;

/** Opción tal como la ve el estudiante antes de responder: sin `correcta` ni `porQue`. */
export interface OpcionQuiz {
  id: string;
  texto: string;
}

export interface OpcionConFeedback extends OpcionQuiz {
  correcta: boolean;
  porQue: string | null;
}

export interface Feedback {
  correcta: boolean;
  xp: number;
  opcionesElegidas: string[];
  opciones: OpcionConFeedback[];
  explicacion: string;
  citaTextual: string;
  referencia: string;
  fragmentoRef: string | null;
}

export interface PreguntaQuiz {
  id: string;
  orden: number;
  tipo: TipoPregunta;
  dificultad: Dificultad;
  enunciado: string;
  tema: string;
  contenido: string;
  opciones: OpcionQuiz[];
  /** Solo si ya fue respondida (modo Práctica). */
  feedback: Feedback | null;
}

export interface QuizEstado {
  id: string;
  modo: string;
  cantidad: number;
  puntaje: number;
  aciertos: number;
  respondidas: number;
  iniciadoEn: string;
  finalizadoEn: string | null;
  preguntas: PreguntaQuiz[];
}

export interface ResumenTema {
  tema: string;
  contenido: string;
  total: number;
  aciertos: number;
}

export interface PreguntaFallada {
  preguntaId: string;
  enunciado: string;
  elegida: string[];
  correctas: string[];
  explicacion: string;
  citaTextual: string;
  referencia: string;
}

export interface ResumenQuiz {
  id: string;
  cantidad: number;
  respondidas: number;
  aciertos: number;
  porcentaje: number;
  puntaje: number;
  segundosPromedio: number | null;
  porTema: ResumenTema[];
  falladas: PreguntaFallada[];
  xpTotal: number;
  rachaDias: number;
}

export interface IntentoResumido {
  id: string;
  modo: string;
  cantidad: number;
  respondidas: number;
  aciertos: number;
  puntaje: number;
  iniciadoEn: string;
  finalizadoEn: string | null;
  contenidos: string[];
}

export interface Panel {
  nombre: string;
  xpTotal: number;
  rachaDias: number;
  preguntasDisponibles: number;
  respondidasHoy: number;
  intentos: IntentoResumido[];
}

/** Árbol para elegir qué estudiar, con conteo de preguntas APROBADAS. */
export interface TemaEstudio {
  id: string;
  nombre: string;
  disponibles: number;
  hijos: TemaEstudio[];
}
export interface ContenidoEstudio {
  id: string;
  titulo: string;
  tipoFuente: string;
  disponibles: number;
  temas: TemaEstudio[];
}
export interface ColeccionEstudio {
  id: string;
  nombre: string;
  contenidos: ContenidoEstudio[];
}
