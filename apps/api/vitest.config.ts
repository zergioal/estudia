import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const dirTemporal = path.join(os.tmpdir(), 'estudia-tests');

const urlTest = process.env.DATABASE_URL_TEST;
if (!urlTest) throw new Error('Define DATABASE_URL_TEST en .env para correr los tests');
if (urlTest === process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL_TEST debe apuntar a una base distinta de DATABASE_URL (los tests la borran)');
}

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./test/setup-global.ts'],
    // Todos los archivos comparten la misma base de test: se corren en serie.
    fileParallelism: false,
    env: {
      DATABASE_URL: urlTest,
      JWT_SECRET: 'secreto-de-tests',
      COLA_MODO: 'inline',
      EMBEDDINGS: 'prueba',
      STORAGE_DIR: path.join(dirTemporal, 'storage'),
      FUENTES_DIR: path.join(dirTemporal, 'fuentes'),
    },
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
