/**
 * Calidad automática del banco: embeddings, deduplicación y validador.
 * Uso desde la raíz: npm run calidad [-- --fragmentos] [--ciego] [--todas]
 *   --fragmentos  también vectoriza los fragmentos (para la búsqueda en las fuentes)
 *   --ciego       además resuelve "a ciegas" con Claude las que pasen las reglas (requiere ANTHROPIC_API_KEY)
 *   --todas       vuelve a validar también las ya validadas
 */
import { config } from '../src/config';
import { prisma } from '../src/db';
import { deduplicar, embeberPendientes, validar } from '../src/modulos/calidad/servicio';

const args = new Set(process.argv.slice(2));
const ciego = args.has('--ciego');

async function main() {
  if (ciego && !config.validadorCiegoDisponible) {
    console.warn('⚠ --ciego pedido pero no hay ANTHROPIC_API_KEY en .env: solo se aplican las reglas.');
  }
  console.log(`Embeddings (${config.modeloEmbeddings}; la primera vez descarga el modelo)…`);
  let ultimo = 0;
  const e = await embeberPendientes({
    fragmentos: args.has('--fragmentos'),
    alAvanzar: (n, total) => {
      if (n - ultimo >= 200 || n === total) {
        console.log(`  ${n}/${total}`);
        ultimo = n === total ? 0 : n;
      }
    },
  });
  console.log(`  preguntas: ${e.preguntas}, fragmentos: ${e.fragmentos}`);

  const duplicadas = await deduplicar();
  console.log(`Duplicadas (coseno ≥ ${config.umbralDuplicado}): ${duplicadas}`);

  const v = await validar({ todas: args.has('--todas'), ciego });
  console.log(`Validador: ${v.validadas} sin alertas, ${v.conAlertas} con alertas`);
  if (ciego) console.log(`A ciegas: ${v.ciegas} resueltas, ${v.ciegasFallidas} no coinciden o son ambiguas`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
