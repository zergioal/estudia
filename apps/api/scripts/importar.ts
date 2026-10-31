/**
 * Importa uno o más lotes JSON de preguntas al banco (estado BORRADOR).
 * Uso desde la raíz: npm run importar -- importar/ejemplo.json [otro.json ...] [--sin-calidad]
 * Al terminar pasa el análisis de calidad (embeddings, duplicados, validador) salvo con --sin-calidad.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/db';
import { ErrorApp } from '../src/errores';
import { analizar } from '../src/modulos/calidad/servicio';
import { importarLote } from '../src/modulos/preguntas/servicio';

async function main() {
  const argumentos = process.argv.slice(2);
  const sinCalidad = argumentos.includes('--sin-calidad');
  const archivos = argumentos.filter((a) => !a.startsWith('--'));
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
      // Un archivo puede traer un lote o un arreglo de lotes (uno por fragmento).
      const lotes = Array.isArray(json) ? json : [json];
      const total = { importadas: 0, rechazadas: 0, duplicadas: 0 };
      for (const [n, lote] of lotes.entries()) {
        const r = await importarLote(lote, 'CLAUDE_CODE');
        const ref = (lote as { fragmentoRef?: string }).fragmentoRef ?? `lote ${n + 1}`;
        console.log(`  [${ref}] importadas ${r.importadas}, rechazadas ${r.rechazadas.length}, duplicadas ${r.duplicadas.length}`);
        for (const x of r.rechazadas) console.log(`    rechazada #${x.indice}: ${x.motivo}`);
        for (const x of r.duplicadas) console.log(`    duplicada #${x.indice}: ${x.motivo}`);
        total.importadas += r.importadas;
        total.rechazadas += r.rechazadas.length;
        total.duplicadas += r.duplicadas.length;
      }
      console.log(`  Total: ${total.importadas} importadas, ${total.rechazadas} rechazadas, ${total.duplicadas} duplicadas`);
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
  if (!sinCalidad) {
    console.log('\n▶ Calidad (embeddings, duplicados y validador)…');
    const r = await analizar();
    console.log(`  ${r.duplicadas} marcadas DUPLICADA, ${r.validadas} VALIDADA sin alertas, ${r.conAlertas} con alertas (ver bandeja)`);
  }
  await prisma.$disconnect();
  if (huboError) process.exit(1);
}

main();
