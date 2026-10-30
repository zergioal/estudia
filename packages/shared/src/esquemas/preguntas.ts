import { z } from 'zod';
import {
  DIFICULTADES,
  ESTADOS_PREGUNTA,
  NIVELES_BLOOM,
  ORIGENES_PREGUNTA,
  TIPOS_PREGUNTA,
  type TipoPregunta,
} from '../enums';

const texto = z.string().trim().min(1, 'No puede estar vacío');

export const opcionSchema = z.object({
  texto,
  correcta: z.boolean(),
  porQue: z.string().trim().optional().nullable(),
});
export type OpcionEntrada = z.infer<typeof opcionSchema>;

/**
 * Reglas de opciones por tipo de pregunta. Se usan al importar y al editar en revisión.
 * ORDENAR: el orden del arreglo es la secuencia correcta.
 * COMPLETAR: las opciones correctas son las respuestas aceptadas.
 */
export function validarOpcionesPorTipo(
  tipo: TipoPregunta,
  opciones: OpcionEntrada[],
  ctx: z.RefinementCtx,
  ruta: (string | number)[] = ['opciones'],
) {
  const correctas = opciones.filter((o) => o.correcta).length;
  const error = (message: string) => ctx.addIssue({ code: 'custom', message, path: ruta });

  const textos = opciones.map((o) => o.texto.toLowerCase());
  if (new Set(textos).size !== textos.length) error('Hay opciones con texto repetido');

  switch (tipo) {
    case 'OPCION_MULTIPLE':
      if (opciones.length !== 4) error(`OPCION_MULTIPLE requiere 4 opciones (tiene ${opciones.length})`);
      if (correctas !== 1) error(`OPCION_MULTIPLE requiere exactamente 1 correcta (tiene ${correctas})`);
      break;
    case 'VERDADERO_FALSO':
      if (opciones.length !== 2) error(`VERDADERO_FALSO requiere 2 opciones (tiene ${opciones.length})`);
      if (correctas !== 1) error(`VERDADERO_FALSO requiere exactamente 1 correcta (tiene ${correctas})`);
      break;
    case 'SELECCION_MULTIPLE':
      if (opciones.length < 3) error(`SELECCION_MULTIPLE requiere al menos 3 opciones (tiene ${opciones.length})`);
      if (correctas < 1) error('SELECCION_MULTIPLE requiere al menos 1 correcta');
      break;
    case 'CASO':
      if (opciones.length < 2) error(`CASO requiere al menos 2 opciones (tiene ${opciones.length})`);
      if (correctas !== 1) error(`CASO requiere exactamente 1 correcta (tiene ${correctas})`);
      break;
    case 'COMPLETAR':
      if (correctas < 1) error('COMPLETAR requiere al menos 1 respuesta aceptada (correcta: true)');
      break;
    case 'ORDENAR':
      if (opciones.length < 2) error(`ORDENAR requiere al menos 2 elementos (tiene ${opciones.length})`);
      break;
  }
}

/** Arreglo de opciones validado con las reglas de un tipo concreto (para editar en revisión). */
export const opcionesSchemaPara = (tipo: TipoPregunta) =>
  z
    .array(opcionSchema)
    .min(1, 'Debe tener al menos 1 opción')
    .superRefine((opciones, ctx) => validarOpcionesPorTipo(tipo, opciones, ctx, []));

const preguntaBaseSchema = z.object({
  tipo: z.enum(TIPOS_PREGUNTA),
  dificultad: z.enum(DIFICULTADES),
  nivelBloom: z.enum(NIVELES_BLOOM),
  enunciado: texto,
  opciones: z.array(opcionSchema).min(1, 'Debe tener al menos 1 opción'),
  explicacion: texto,
  citaTextual: texto,
  referencia: texto,
  etiquetas: z.array(z.string().trim().min(1)).default([]),
});

/** Una pregunta del contrato JSON de importación. */
export const preguntaImportacionSchema = preguntaBaseSchema.superRefine((p, ctx) =>
  validarOpcionesPorTipo(p.tipo, p.opciones, ctx),
);
export type PreguntaImportacion = z.infer<typeof preguntaImportacionSchema>;

/**
 * Lote de importación. Las preguntas se validan una por una en el servicio
 * (una pregunta inválida no invalida el lote), por eso aquí son `unknown`.
 */
export const loteImportacionSchema = z.object({
  coleccion: texto.optional(),
  contenido: texto,
  tema: texto,
  fragmentoRef: z.string().trim().min(1).optional().nullable(),
  origen: z.enum(ORIGENES_PREGUNTA).optional(),
  preguntas: z.array(z.unknown()).min(1, 'El lote no tiene preguntas'),
});
export type LoteImportacion = z.infer<typeof loteImportacionSchema>;

export interface ItemRechazado {
  indice: number;
  motivo: string;
}

export interface ResultadoImportacion {
  importadas: number;
  rechazadas: ItemRechazado[];
  duplicadas: ItemRechazado[];
  contenidoId: string;
  temaId: string;
}

// ---------- Revisión ----------

export const revisionFiltroSchema = z.object({
  estado: z.enum(ESTADOS_PREGUNTA).default('BORRADOR'),
  contenidoId: z.string().optional(),
  temaId: z.string().optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(200).default(20),
});
export type RevisionFiltro = z.infer<typeof revisionFiltroSchema>;

/** Estados que se pueden asignar a mano desde la bandeja. */
export const ESTADOS_REVISION = ['BORRADOR', 'APROBADA', 'DESCARTADA'] as const;

export const preguntaEditarSchema = z.object({
  estado: z.enum(ESTADOS_REVISION).optional(),
  dificultad: z.enum(DIFICULTADES).optional(),
  nivelBloom: z.enum(NIVELES_BLOOM).optional(),
  enunciado: texto.optional(),
  explicacion: texto.optional(),
  citaTextual: texto.optional(),
  referencia: texto.optional(),
  etiquetas: z.array(z.string().trim().min(1)).optional(),
  opciones: z.array(opcionSchema).min(1).optional(),
});
export type PreguntaEditar = z.infer<typeof preguntaEditarSchema>;

export const aprobarLoteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, 'Envía al menos un id').max(500),
});
export type AprobarLote = z.infer<typeof aprobarLoteSchema>;

export interface OpcionRevision {
  id: string;
  texto: string;
  correcta: boolean;
  porQue: string | null;
  orden: number;
}

export interface PreguntaRevision {
  id: string;
  tipo: TipoPregunta;
  dificultad: string;
  nivelBloom: string;
  enunciado: string;
  explicacion: string;
  citaTextual: string;
  referencia: string;
  etiquetas: string[];
  estado: string;
  origen: string;
  fragmentoRef: string | null;
  creadoEn: string;
  tema: { id: string; nombre: string; contenido: { id: string; titulo: string } };
  opciones: OpcionRevision[];
}

export interface Paginado<T> {
  items: T[];
  total: number;
  pagina: number;
  porPagina: number;
}
