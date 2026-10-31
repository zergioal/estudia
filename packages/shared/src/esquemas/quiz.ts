import { z } from 'zod';
import { DIFICULTADES, type Dificultad, type TipoPregunta } from '../enums';

export const CANTIDADES_QUIZ = [10, 20, 50, 100] as const;
/** Modos que se crean con POST /quizzes (el simulacro tiene su propio endpoint). */
export const MODOS_QUIZ = ['PRACTICA', 'REPASO_DIARIO', 'REPASO_ERRORES'] as const;
export type ModoQuiz = (typeof MODOS_QUIZ)[number];

/** XP por acierto según dificultad; ×1,5 si antes la habías fallado (docs/diseno.md). */
export const XP_POR_DIFICULTAD: Record<Dificultad, number> = { FACIL: 10, MEDIA: 20, DIFICIL: 35 };
export const BONUS_RECUPERADA = 1.5;

/**
 * Examen simulacro según el Reglamento de la Convocatoria 0001/2026 (Arts. 11, 12, 14): 100 preguntas en
 * 150 minutos, 35% Normativa General y Específica y 65% Contenidos Técnico-Pedagógicos, nota mínima 51/100.
 */
export const SIMULACRO = { preguntas: 100, minutos: 150, porcentajeNormativa: 35, notaMinima: 51 } as const;
/** Tipos de fuente que cuentan como "Normativa"; el resto (LIBRO, GUIA) es técnico-pedagógico. */
export const FUENTES_NORMATIVA = ["LEY", "DECRETO", "RM"] as const;
export const bloqueDeFuente = (tipoFuente: string) =>
  (FUENTES_NORMATIVA as readonly string[]).includes(tipoFuente) ? "Normativa" : "Técnico-pedagógico";

export const quizCrearSchema = z
  .object({
    modo: z.enum(MODOS_QUIZ).default('PRACTICA'),
    contenidoIds: z.array(z.string().min(1)).default([]),
    temaIds: z.array(z.string().min(1)).default([]),
    dificultades: z.array(z.enum(DIFICULTADES)).default([]),
    /** Solo REPASO_ERRORES: repasar exactamente estas preguntas (p. ej. las falladas de un intento). */
    preguntaIds: z.array(z.string().min(1)).max(200).default([]),
    cantidad: z
      .number()
      .int()
      .refine((n) => (CANTIDADES_QUIZ as readonly number[]).includes(n), 'La cantidad debe ser 10, 20, 50 o 100'),
  })
  // Los repasos pueden ir sin filtros (todo lo pendiente); la práctica necesita qué estudiar.
  .refine((q) => q.modo !== 'PRACTICA' || q.contenidoIds.length > 0 || q.temaIds.length > 0, {
    message: 'Elige al menos un contenido o tema',
    path: ['contenidoIds'],
  });
export type QuizCrear = z.infer<typeof quizCrearSchema>;
/** Lo que envía el cliente (los campos con default son opcionales). */
export type QuizCrearEntrada = z.input<typeof quizCrearSchema>;

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
  /** Días hasta el próximo repaso de esta pregunta (repetición espaciada). */
  proximoRepasoDias: number | null;
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
  respondida: boolean;
  /** Opciones que marcó el estudiante (en el simulacro, se ve qué marcó pero no si acertó). */
  opcionesElegidas: string[];
  /** Práctica: tras responder. Simulacro: solo cuando el examen terminó. */
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
  /** Hora límite del simulacro (null en práctica). */
  limiteEn: string | null;
  preguntas: PreguntaQuiz[];
}

/** Respuesta a una pregunta del simulacro: se registra sin revelar si fue correcta. */
export interface RespuestaRegistrada {
  registrada: true;
  preguntaId: string;
  opcionIds: string[];
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
  contenido: string;
  /** Simulacro: quedó sin responder (cuenta como error). */
  sinResponder: boolean;
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
  /** Solo en simulacros. */
  simulacro: ResultadoSimulacro | null;
}

export interface ResultadoSimulacro {
  /** Nota sobre 100 (aciertos / total de preguntas; las no respondidas cuentan como error). */
  nota: number;
  notaMinima: number;
  aprobado: boolean;
  sinResponder: number;
  segundosUsados: number;
  minutosLimite: number;
  porBloque: { bloque: string; total: number; aciertos: number }[];
  porContenido: { contenido: string; total: number; aciertos: number }[];
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
  /** Preguntas cuyo repaso vence hoy o antes. */
  repasoHoy: number;
  /** Preguntas falladas que aún no dominas. */
  errores: number;
  /** Porcentaje de preguntas dominadas (intervalo ≥ 7 días) sobre el banco disponible. */
  dominio: number;
  intentos: IntentoResumido[];
}

/** Cola de repetición espaciada. */
export interface RepasoHoy {
  pendientes: number;
  porContenido: { contenidoId: string; titulo: string; pendientes: number }[];
  /** Próximo vencimiento si hoy no queda nada. */
  proximaEn: string | null;
}

/** Una pregunta del cuaderno de errores (fallada y aún no dominada). */
export interface ErrorCuaderno {
  preguntaId: string;
  enunciado: string;
  contenidoId: string;
  contenido: string;
  tema: string;
  fallos: number;
  aciertos: number;
  intervaloDias: number;
  ultimaRespuesta: string | null;
  proximaRevision: string;
  correctas: string[];
  referencia: string;
}

export interface DominioTema {
  temaId: string;
  nombre: string;
  total: number;
  vistas: number;
  dominadas: number;
  /** % del tema dominado (0-100). */
  dominio: number;
}

export interface DominioContenido {
  contenidoId: string;
  titulo: string;
  tipoFuente: string;
  total: number;
  vistas: number;
  dominadas: number;
  dominio: number;
  /** % de aciertos histórico sobre todas tus respuestas a este documento (null si no respondiste nada). */
  acierto: number | null;
  temas: DominioTema[];
}

export interface Progreso {
  total: number;
  vistas: number;
  dominadas: number;
  dominio: number;
  contenidos: DominioContenido[];
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
