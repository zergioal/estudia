import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { RespuestaCiega } from '@estudia/shared';
import { config } from '../../config';

export const LETRAS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

export interface PreguntaCiega {
  enunciado: string;
  opciones: { texto: string }[];
  /** Texto de la norma o libro de donde sale la pregunta, si se conoce. */
  fuente: string | null;
}

export type ResolutorCiego = (p: PreguntaCiega) => Promise<RespuestaCiega | null>;

const formato = z.object({
  respuesta: z.enum(LETRAS),
  ambigua: z.boolean(),
  motivo: z.string(),
});

const SISTEMA = `Eres un examinador experto en normativa educativa boliviana y en gestión educativa.
Te muestran una pregunta de opción múltiple de un examen de ascenso de maestros, SIN la respuesta.
Resuélvela basándote en el texto fuente si se adjunta (manda sobre tu conocimiento general).
Marca "ambigua" en true si más de una opción puede defenderse como correcta según la fuente, si ninguna lo es,
o si el enunciado no da información suficiente para decidir. En "motivo" explica en una o dos frases en español,
citando el artículo o la parte de la fuente que decide.`;

function prompt(p: PreguntaCiega) {
  const opciones = p.opciones.map((o, i) => `${LETRAS[i]}) ${o.texto}`).join('\n');
  const fuente = p.fuente ? `<fuente>\n${p.fuente}\n</fuente>\n\n` : '';
  return `${fuente}<pregunta>\n${p.enunciado}\n\n${opciones}\n</pregunta>`;
}

let cliente: Anthropic | null = null;

/** Resuelve la pregunta con Claude sin mostrarle cuál es la correcta. null si el modelo no responde. */
const resolutorClaude: ResolutorCiego = async (p) => {
  cliente ??= new Anthropic();
  const r = await cliente.messages.parse({
    model: config.modeloValidador,
    max_tokens: 16000,
    system: SISTEMA,
    messages: [{ role: 'user', content: prompt(p) }],
    output_config: { effort: 'medium', format: zodOutputFormat(formato) },
  });
  if (r.stop_reason === 'refusal' || !r.parsed_output) return null;
  return r.parsed_output;
};

let resolutor: ResolutorCiego = resolutorClaude;

/** Para tests: reemplaza la llamada a la API. */
export function fijarResolutorCiego(fn: ResolutorCiego | null) {
  resolutor = fn ?? resolutorClaude;
}

export const resolverACiegas = (p: PreguntaCiega) => resolutor(p);
