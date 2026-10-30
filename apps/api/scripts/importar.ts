/**
 * Importa uno o más lotes JSON de preguntas al banco (estado BORRADOR).
 * Uso desde la raíz: npm run importar -- importar/ejemplo.json [otro.json ...]
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/db';
import { ErrorApp } from '../src/errores';
import { importarLote } from '../src/modulos/preguntas/servicio';

async function main() {
  const archivos = process.argv.slice(2);
  if (archivos.length === 0) {
    console.error('Uso: npm run importar -- <archivo.json> [más archivos]');
    process.exit(1);
  }
  // npm ejecuta el script dentro de apps/api; INIT_CWD es la carpeta desde donde lo llamaste.
  const base = process.env.INIT_CWD ?? process.cwd();
  let huboError = false;

  for (const archivo of archivos) {
    const ruta = path.resolve(base, archivo);
    console.log(`\n▶ ${path.relative(base, ruta)}`);
    try {
      const json: unknown = JSON.parse(await readFile(ruta, 'utf8'));
      const r = await importarLote(json, 'CLAUDE_CODE');
      console.log(`  Importadas: ${r.importadas}`);
      console.log(`  Rechazadas: ${r.rechazadas.length}`);
      for (const x of r.rechazadas) console.log(`    #${x.indice}: ${x.motivo}`);
      console.log(`  Duplicadas: ${r.duplicadas.length}`);
      for (const x of r.duplicadas) console.log(`    #${x.indice}: ${x.motivo}`);
    } catch (e) {
      huboError = true;
      if (e instanceof ErrorApp) {
        console.error(`  ✖ ${e.message}`);
        if (e.detalles) console.error(JSON.stringify(e.detalles, null, 2));
      } else if (e instanceof SyntaxError) {
        console.error(`  ✖ JSON inválido: ${e.message}`);
      } else {
        console.error('  ✖', e);
      }
    }
  }
  await prisma.$disconnect();
  if (huboError) process.exit(1);
}

main();
