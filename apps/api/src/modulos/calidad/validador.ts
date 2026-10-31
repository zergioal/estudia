import { normalizar } from '../preguntas/servicio';

export interface PreguntaAValidar {
  tipo: string;
  enunciado: string;
  citaTextual: string;
  referencia: string;
  opciones: { texto: string; correcta: boolean; porQue: string | null }[];
}

const palabras = (t: string) => new Set(normalizar(t).match(/[\p{L}\p{N}]+/gu) ?? []);

function jaccard(a: string, b: string) {
  const x = palabras(a);
  const y = palabras(b);
  if (x.size === 0 || y.size === 0) return 0;
  let comun = 0;
  for (const p of x) if (y.has(p)) comun++;
  return comun / (x.size + y.size - comun);
}

/**
 * Reglas automáticas de calidad (sin IA). Devuelve una alerta legible por problema; vacío = pasó.
 * `textoFragmento` es el texto fuente si la pregunta está ligada a un fragmento.
 */
export function revisar(p: PreguntaAValidar, textoFragmento: string | null): string[] {
  const alertas: string[] = [];
  const correctas = p.opciones.filter((o) => o.correcta);
  const distractores = p.opciones.filter((o) => !o.correcta);
  const conOpciones = !['COMPLETAR', 'ORDENAR'].includes(p.tipo);

  if (p.enunciado.trim().length < 20) alertas.push('El enunciado es demasiado corto');

  if (textoFragmento !== null && !normalizar(textoFragmento).includes(normalizar(p.citaTextual))) {
    alertas.push('La cita textual no aparece en el fragmento fuente');
  }
  if (p.citaTextual.trim().length < 20) alertas.push('La cita textual es demasiado corta para respaldar la respuesta');
  if (!/p[áa]g/i.test(p.referencia)) alertas.push('La referencia no indica la página');

  if (conOpciones) {
    if (p.opciones.some((o) => /\b(todas|ninguna)\s+(de\s+)?(las\s+)?anteriores\b/i.test(o.texto))) {
      alertas.push('Usa "todas/ninguna de las anteriores"');
    }

    if (correctas.length === 1 && distractores.length > 0) {
      const largo = correctas[0]!.texto.trim().length;
      const promedio = distractores.reduce((s, o) => s + o.texto.trim().length, 0) / distractores.length;
      if (largo > promedio * 1.6 && largo - promedio > 25) {
        alertas.push('La correcta es mucho más larga que los distractores (se delata)');
      } else if (largo < promedio * 0.45 && promedio - largo > 25) {
        alertas.push('La correcta es mucho más corta que los distractores (se delata)');
      }
    }

    for (let i = 0; i < p.opciones.length; i++) {
      for (let j = i + 1; j < p.opciones.length; j++) {
        if (jaccard(p.opciones[i]!.texto, p.opciones[j]!.texto) >= 0.9) {
          alertas.push(`Las opciones ${i + 1} y ${j + 1} son casi iguales`);
        }
      }
    }

    const sinPorQue = p.opciones.filter((o) => !o.porQue?.trim()).length;
    if (sinPorQue > 0) alertas.push(`Falta el "porQue" en ${sinPorQue} ${sinPorQue === 1 ? 'opción' : 'opciones'}`);

    const enunciado = normalizar(p.enunciado);
    for (const c of correctas) {
      const t = normalizar(c.texto).replace(/[.;:]+$/, '');
      if (t.split(' ').length >= 4 && enunciado.includes(t)) alertas.push('El enunciado contiene la respuesta correcta');
    }
  }

  // La negación debe destacarse para que no pase inadvertida.
  if (/\b(excepto|salvo)\b/.test(p.enunciado) || /\bno (corresponde|es|se|debe|puede|forma|está|constituye)\b/.test(p.enunciado)) {
    alertas.push('Destaca la negación en mayúsculas (EXCEPTO / NO)');
  }

  return alertas;
}
