import { execSync } from 'node:child_process';

/**
 * Aplica las migraciones pendientes a la base de test (no destructivo).
 * Cada archivo de test vacía las tablas con TRUNCATE en su beforeEach.
 */
export default function setup() {
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL_TEST },
  });
}
