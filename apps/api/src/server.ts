import { crearApp } from './app';
import { config } from './config';
import { detenerCola, iniciarCola } from './modulos/ingesta/cola';

const puerto = config.puerto;
const servidor = crearApp().listen(puerto, async () => {
  console.log(`API EstudIA escuchando en http://localhost:${puerto}/api/v1`);
  try {
    await iniciarCola();
    console.log(`Cola de documentos lista (modo ${config.modoCola})`);
  } catch (e) {
    console.error('No se pudo iniciar la cola de documentos:', e);
  }
});

for (const senal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(senal, async () => {
    await detenerCola().catch(() => undefined);
    servidor.close(() => process.exit(0));
  });
}
