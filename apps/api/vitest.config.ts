import { defineConfig } from 'vitest/config';

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
    },
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
