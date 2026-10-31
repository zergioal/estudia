import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Raíz del monorepo (apps/api/src → ../../..). */
export const RAIZ_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre} (revisa .env)`);
  return valor;
}

const rutaDesdeRaiz = (valor: string | undefined, porDefecto: string) =>
  path.resolve(RAIZ_REPO, valor ?? porDefecto);

export const config = {
  get puerto() {
    return Number(process.env.PORT ?? 3000);
  },
  get jwtSecreto() {
    return requerida('JWT_SECRET');
  },
  get jwtExpira() {
    return process.env.JWT_EXPIRA ?? '7d';
  },
  get corsOrigen() {
    return (process.env.CORS_ORIGEN ?? 'http://localhost:5173').split(',').map((o) => o.trim());
  },
  get databaseUrl() {
    return requerida('DATABASE_URL');
  },
  /** PDFs subidos y caché de OCR. */
  get dirStorage() {
    return rutaDesdeRaiz(process.env.STORAGE_DIR, 'storage');
  },
  /** Fragmentos exportados en .md para generar preguntas con Claude Code. */
  get dirFuentes() {
    return rutaDesdeRaiz(process.env.FUENTES_DIR, 'fuentes');
  },
  /** "pgboss" (por defecto) procesa en segundo plano; "inline" procesa dentro de la petición (tests). */
  get modoCola(): 'pgboss' | 'inline' {
    return process.env.COLA_MODO === 'inline' ? 'inline' : 'pgboss';
  },
  get maxMbPdf() {
    return Number(process.env.MAX_MB_PDF ?? 100);
  },
  /** Modelo local de embeddings (Hugging Face, ONNX). Debe dar vectores de 384 dimensiones. */
  get modeloEmbeddings() {
    return process.env.MODELO_EMBEDDINGS ?? 'Xenova/multilingual-e5-small';
  },
  /** Similitud de coseno a partir de la cual una pregunta nueva se marca DUPLICADA. */
  get umbralDuplicado() {
    return Number(process.env.UMBRAL_DUPLICADO ?? 0.97);
  },
  /** Validador "a ciegas": solo si hay credenciales de la API de Claude. */
  get validadorCiegoDisponible() {
    return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  },
  get modeloValidador() {
    return process.env.MODELO_VALIDADOR ?? 'claude-opus-5-5';
  },
};
