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
};
