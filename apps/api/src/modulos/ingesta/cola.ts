/**
 * Cola de procesamiento de documentos con pg-boss (misma Postgres, sin Redis).
 * Con COLA_MODO=inline (tests) el documento se procesa dentro de la petición.
 */
import { PgBoss } from 'pg-boss';
import { config } from '../../config';
import { ErrorApp } from '../../errores';
import { procesarDocumento } from './servicio';

const COLA = 'procesar-documento';
interface TrabajoDocumento {
  documentoId: string;
  ocr: boolean;
}

let boss: PgBoss | null = null;

export async function iniciarCola() {
  if (config.modoCola === 'inline' || boss) return;
  // pg no entiende el parámetro ?schema= de Prisma.
  const url = new URL(config.databaseUrl);
  url.searchParams.delete('schema');
  boss = new PgBoss({ connectionString: url.toString() });
  boss.on('error', (e) => console.error('[cola]', e));
  await boss.start();
  if (!(await boss.getQueue(COLA))) {
    await boss.createQueue(COLA, { retryLimit: 1, expireInSeconds: 3 * 60 * 60 });
  }
  await boss.work<TrabajoDocumento>(COLA, async (trabajos) => {
    for (const t of trabajos) {
      console.log(`[cola] procesando documento ${t.data.documentoId}`);
      const r = await procesarDocumento(t.data.documentoId, { ocr: t.data.ocr });
      console.log(`[cola] documento ${t.data.documentoId}: ${r.fragmentos} fragmentos (${r.modo})`);
    }
  });
}

export async function detenerCola() {
  await boss?.stop();
  boss = null;
}

export async function encolarProcesamiento(documentoId: string, ocr = true) {
  if (config.modoCola === 'inline') {
    // El error queda guardado en el documento (estado ERROR), igual que con la cola.
    await procesarDocumento(documentoId, { ocr }).catch(() => undefined);
    return;
  }
  if (!boss) throw new ErrorApp(503, 'COLA_NO_DISPONIBLE', 'La cola de trabajos no está iniciada');
  await boss.send(COLA, { documentoId, ocr } satisfies TrabajoDocumento);
}
