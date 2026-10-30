/**
 * Extracción de texto por página. Usa la capa de texto del PDF y, si una página no la tiene
 * (escaneada), la renderiza y le aplica OCR en español con tesseract.js.
 */
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { createWorker, type Worker } from 'tesseract.js';
import { config } from '../../config';

export interface PaginaExtraida {
  numero: number;
  texto: string;
  ocr: boolean;
  confianza: number | null;
}

export interface OpcionesExtraccion {
  ocr?: boolean;
  /** Se llama tras cada página: útil para mostrar progreso en el CLI. */
  alProgresar?: (pagina: number, total: number, ocr: boolean) => void;
}

/** Menos caracteres visibles que esto = página sin capa de texto (carátula o escaneo). */
export const MIN_CARACTERES_TEXTO = 50;
const ESCALA_OCR = 2.5;

export async function extraerPaginas(pdf: Uint8Array, opciones: OpcionesExtraccion = {}): Promise<PaginaExtraida[]> {
  const usarOcr = opciones.ocr ?? true;
  // pdfjs se queda con el buffer: le pasamos una copia.
  const doc = await getDocument({ data: new Uint8Array(pdf), verbosity: 0, isEvalSupported: false }).promise;
  let worker: Worker | null = null;
  const paginas: PaginaExtraida[] = [];

  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const pagina = await doc.getPage(n);
      const contenido = await pagina.getTextContent();
      let texto = reconstruirLineas(contenido.items.filter((i): i is TextItem => 'str' in i));
      let ocr = false;
      let confianza: number | null = null;

      if (usarOcr && caracteresVisibles(texto) < MIN_CARACTERES_TEXTO) {
        worker ??= await createWorker('spa', 1, { cachePath: path.join(config.dirStorage, 'tessdata') });
        const vista = pagina.getViewport({ scale: ESCALA_OCR });
        const canvas = createCanvas(Math.ceil(vista.width), Math.ceil(vista.height));
        await pagina.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D,
          viewport: vista,
        }).promise;
        const { data } = await worker.recognize(canvas.toBuffer('image/png'));
        const textoOcr = limpiarOcr(data.text);
        if (caracteresVisibles(textoOcr) > caracteresVisibles(texto)) {
          texto = textoOcr;
          ocr = true;
          confianza = data.confidence;
        }
      }

      paginas.push({ numero: n, texto, ocr, confianza });
      pagina.cleanup();
      opciones.alProgresar?.(n, doc.numPages, ocr);
    }
  } finally {
    await worker?.terminate();
    await doc.destroy();
  }
  return paginas;
}

/** Une los fragmentos de texto de pdfjs en líneas, usando el salto de línea o el cambio de altura. */
export function reconstruirLineas(items: Pick<TextItem, 'str' | 'transform' | 'hasEOL'>[]): string {
  const lineas: string[] = [];
  let actual = '';
  let y: number | null = null;
  for (const it of items) {
    const yy = Math.round(it.transform[5] ?? 0);
    if (y !== null && Math.abs(yy - y) > 2 && actual) {
      lineas.push(actual);
      actual = '';
    }
    actual += it.str;
    y = yy;
    if (it.hasEOL) {
      lineas.push(actual);
      actual = '';
      y = null;
    }
  }
  if (actual) lineas.push(actual);
  return lineas
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Correcciones típicas del OCR en normas: "Parágrafo |" → "Parágrafo I", "Ill" → "III". */
export function limpiarOcr(texto: string): string {
  return texto
    .replace(/\r/g, '')
    .replace(/(?<=\s)\|(?=[\s.,:;)])/g, 'I')
    .replace(/\b(CONSIDERANDO|T[IÍ]TULO|CAP[IÍ]TULO|Par[aá]grafo)\s+(I[l|]{1,2}|[l|]{1,3})\b/g, (_m, p: string, n: string) =>
      `${p} ${n.replace(/[l|]/g, 'I')}`,
    )
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

const caracteresVisibles = (t: string) => t.replace(/\s/g, '').length;
