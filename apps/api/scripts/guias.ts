/**
 * Carga (o reemplaza) las guías de estudio desde archivos JSON.
 * Uso desde la raíz: npm run guias -- guias/            (todos los .json de la carpeta)
 *                    npm run guias -- guias/ley070.json  (uno o varios archivos)
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { guiaArchivoSchema } from '@estudia/shared';
import { prisma } from '../src/db';
import { issuesZod } from '../src/errores';
import { guardarPorClave } from '../src/modulos/guias/servicio';
import { ZodError } from 'zod';

async function archivosDe(rutas: string[]) {
  const lista: string[] = [];
  for (const r of rutas) {
    if ((await stat(r)).isDirectory()) {
      for (const f of (await readdir(r)).sort()) if (f.endsWith('.json')) lista.push(path.join(r, f));
    } else lista.push(r);
  }
  return lista;
}

async function main() {
  const argumentos = process.argv.slice(2);
  if (argumentos.length === 0) {
    console.error('Uso: npm run guias -- <carpeta o archivo.json> [más]');
    process.exit(1);
  }
  // npm ejecuta el script dentro de apps/api; INIT_CWD es la carpeta desde donde lo llamaste.
  const base = process.env.INIT_CWD ?? process.cwd();
  const archivos = await archivosDe(argumentos.map((a) => path.resolve(base, a)));
  let errores = 0;
  for (const archivo of archivos) {
    const nombre = path.relative(base, archivo);
    try {
      const datos = guiaArchivoSchema.parse(JSON.parse(await readFile(archivo, 'utf8')));
      const c = await guardarPorClave(datos.clave, datos);
      console.log(`✔ ${nombre} → ${c.titulo} (${datos.obligatorio.length} obligatorias, ${datos.opcional.length} opcionales)`);
    } catch (e) {
      errores++;
      const detalle = e instanceof ZodError ? JSON.stringify(issuesZod(e)) : (e as Error).message;
      console.error(`✖ ${nombre}: ${detalle}`);
    }
  }
  console.log(`\n${archivos.length - errores} guías cargadas, ${errores} con error.`);
  await prisma.$disconnect();
  if (errores) process.exit(1);
}

main();
