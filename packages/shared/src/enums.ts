export const ROLES = ['ADMIN', 'REVISOR', 'ESTUDIANTE'] as const;
export type Rol = (typeof ROLES)[number];

export const DIFICULTADES = ['FACIL', 'MEDIA', 'DIFICIL'] as const;
export type Dificultad = (typeof DIFICULTADES)[number];

export const TIPOS_PREGUNTA = [
  'OPCION_MULTIPLE',
  'VERDADERO_FALSO',
  'SELECCION_MULTIPLE',
  'COMPLETAR',
  'ORDENAR',
  'CASO',
] as const;
export type TipoPregunta = (typeof TIPOS_PREGUNTA)[number];

export const NIVELES_BLOOM = ['RECORDAR', 'COMPRENDER', 'APLICAR', 'ANALIZAR'] as const;
export type NivelBloom = (typeof NIVELES_BLOOM)[number];

export const ESTADOS_PREGUNTA = [
  'BORRADOR',
  'VALIDADA',
  'APROBADA',
  'DESCARTADA',
  'DUPLICADA',
  'EN_REVISION',
] as const;
export type EstadoPregunta = (typeof ESTADOS_PREGUNTA)[number];

export const TIPOS_FUENTE = ['LEY', 'DECRETO', 'RM', 'LIBRO', 'GUIA'] as const;
export type TipoFuente = (typeof TIPOS_FUENTE)[number];

export const ORIGENES_PREGUNTA = ['CLAUDE_CODE', 'MCP', 'API', 'MANUAL'] as const;
export type OrigenPregunta = (typeof ORIGENES_PREGUNTA)[number];
