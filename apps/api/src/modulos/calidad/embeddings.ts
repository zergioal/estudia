import path from 'node:path';
import { config } from '../../config';

/** Dimensión de los vectores guardados en Pregunta.embedding y Fragmento.embedding. */
export const DIM_EMBEDDING = 384;

/**
 * "consulta" para textos cortos que se comparan entre sí (preguntas, búsquedas);
 * "pasaje" para los fragmentos donde se busca (convención de los modelos E5).
 */
export type TipoTexto = 'consulta' | 'pasaje';

export interface Embebedor {
  nombre: string;
  embeber(textos: string[], tipo: TipoTexto): Promise<number[][]>;
}

/**
 * Modelo local multilingüe (intfloat/multilingual-e5-small, ONNX cuantizado): corre en la PC, sin costo ni API.
 * La primera vez descarga ~120 MB a storage/modelos.
 */
function embebedorLocal(): Embebedor {
  let extractor: Promise<(t: string[], o: object) => Promise<{ tolist(): number[][] }>> | null = null;
  const cargar = () =>
    (extractor ??= import('@huggingface/transformers').then(async ({ env, pipeline }) => {
      env.cacheDir = path.join(config.dirStorage, 'modelos');
      const p = await pipeline('feature-extraction', config.modeloEmbeddings, { dtype: 'q8' });
      return p as unknown as (t: string[], o: object) => Promise<{ tolist(): number[][] }>;
    }));
  return {
    nombre: config.modeloEmbeddings,
    async embeber(textos, tipo) {
      const fn = await cargar();
      const prefijo = tipo === 'pasaje' ? 'passage: ' : 'query: ';
      const salida: number[][] = [];
      for (let i = 0; i < textos.length; i += 16) {
        const lote = textos.slice(i, i + 16).map((t) => prefijo + t);
        const r = await fn(lote, { pooling: 'mean', normalize: true });
        salida.push(...r.tolist());
      }
      return salida;
    },
  };
}

/**
 * Embebedor determinista para tests (EMBEDDINGS=prueba): bolsa de palabras con hash en 384 dimensiones.
 * Textos con las mismas palabras dan similitud 1; textos sin palabras en común, ~0.
 */
export function embebedorPrueba(): Embebedor {
  return {
    nombre: 'prueba',
    async embeber(textos) {
      return textos.map((t) => {
        const v = new Array<number>(DIM_EMBEDDING).fill(0);
        for (const palabra of t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9ñ]+/g) ?? []) {
          let h = 0;
          for (const c of palabra) h = (h * 31 + c.charCodeAt(0)) >>> 0;
          v[h % DIM_EMBEDDING]! += 1;
        }
        const norma = Math.hypot(...v) || 1;
        return v.map((x) => x / norma);
      });
    },
  };
}

let actual: Embebedor | null = null;

export function embebedor(): Embebedor {
  return (actual ??= process.env.EMBEDDINGS === 'prueba' ? embebedorPrueba() : embebedorLocal());
}

/** Literal de pgvector: '[0.1,0.2,…]'. */
export const aVector = (v: number[]) => `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : '0')).join(',')}]`;
