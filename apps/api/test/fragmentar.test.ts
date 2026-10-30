import { describe, expect, it } from 'vitest';
import { claveDesdeTitulo, fragmentar, lineasLimpias, reflujo } from '../src/modulos/ingesta/fragmentar';
import { limpiarOcr } from '../src/modulos/ingesta/extraer';

const encabezado = (n: number) => [`10/06/12 Norma: 999 Gaceta Oficial del Estado Plurinacional de Bolivia`, `${n}/5 www.gaceta.bo`];

/** Una ley de juguete en 5 páginas, con encabezado repetido como el de la Gaceta. */
const ley = [
  [...encabezado(1), 'LEY Nº 999', 'LEY DE 1 DE ENERO DE 2020', 'DECRETA:', 'TÍTULO I', 'DISPOSICIONES GENERALES', 'CAPÍTULO I', 'OBJETO Y ALCANCE',
    'Artículo 1. (Objeto). La presente Ley tiene por objeto regular la educa-', 'ción en todo el territorio.',
    'Artículo 2. (Alcance).', '1. Se aplica a todas las unidades educativas.', '2. Comprende el sistema fiscal y privado.'],
  [...encabezado(2), 'Esto lo dispone el Artículo 80 de la Ley de la Educación, sin perjuicio de otras normas.',
    'Artículo 3.', 'Las maestras y maestros ejercen la función docente de acuerdo al escalafón.'],
  [...encabezado(3), 'CAPÍTULO II', 'ORGANIZACIÓN', 'SECCIÓN I', 'DIRECCIONES', 'ARTÍCULO CUARTO.- (Direcciones). Las direcciones distritales dependen del Ministerio.',
    'Artículo 5. (Plazos). El plazo para la designación es de treinta días hábiles.'],
  [...encabezado(4), 'TÍTULO II', 'DISPOSICIONES FINALES', 'Artículo 6. (Vigencia). La presente Ley entra en vigencia desde su publicación.'],
  [...encabezado(5), 'DISPOSICIONES TRANSITORIAS', 'Primera. (Adecuación). En el plazo de noventa días se adecuará la normativa.',
    'Segunda. (Reglamento). El Ministerio reglamentará la presente Ley en ciento veinte días.'],
].map((lineas, i) => ({ numero: i + 1, texto: lineas.join('\n') }));

describe('fragmentar (normativa)', () => {
  const { modo, fragmentos } = fragmentar(ley, 'ley999');
  const porRef = new Map(fragmentos.map((f) => [f.ref, f]));

  it('detecta modo normativa y un fragmento por artículo y disposición', () => {
    expect(modo).toBe('NORMATIVA');
    expect(fragmentos.map((f) => f.ref)).toEqual([
      'ley999-pre',
      'ley999-art01',
      'ley999-art02',
      'ley999-art03',
      'ley999-art04',
      'ley999-art05',
      'ley999-art06',
      'ley999-dt01',
      'ley999-dt02',
    ].filter((r) => r !== 'ley999-pre' || porRef.has(r)));
  });

  it('arma la ruta de temas Título › Capítulo › Sección', () => {
    expect(porRef.get('ley999-art01')!.tema).toEqual(['Título I. Disposiciones generales', 'Capítulo I. Objeto y alcance']);
    expect(porRef.get('ley999-art04')!.tema).toEqual([
      'Título I. Disposiciones generales',
      'Capítulo II. Organización',
      'Sección I. Direcciones',
    ]);
    expect(porRef.get('ley999-art06')!.tema).toEqual(['Título II. Disposiciones finales']);
    expect(porRef.get('ley999-dt01')!.tema).toEqual(['Disposiciones transitorias']);
  });

  it('quita encabezados repetidos, une palabras cortadas y conserva incisos', () => {
    const art1 = porRef.get('ley999-art01')!;
    expect(art1.texto).toBe('Artículo 1. (Objeto). La presente Ley tiene por objeto regular la educación en todo el territorio.');
    expect(fragmentos.some((f) => f.texto.includes('Gaceta Oficial'))).toBe(false);
    // El artículo 2 continúa en la página 2.
    expect(porRef.get('ley999-art02')!.texto).toBe(
      'Artículo 2. (Alcance).\n1. Se aplica a todas las unidades educativas.\n2. Comprende el sistema fiscal y privado.\n' +
        'Esto lo dispone el Artículo 80 de la Ley de la Educación, sin perjuicio de otras normas.',
    );
  });

  it('no confunde una cita "Artículo 80 de la Ley" con un encabezado y acepta ordinales', () => {
    expect(porRef.get('ley999-art02')!.texto).toContain('Esto lo dispone el Artículo 80');
    expect(porRef.get('ley999-art04')!.etiqueta).toBe('Art. 4');
    expect(porRef.get('ley999-dt02')!.etiqueta).toBe('Disp. transitoria segunda');
  });

  it('guarda las páginas de cada fragmento', () => {
    expect(porRef.get('ley999-art02')).toMatchObject({ paginaDesde: 1, paginaHasta: 2 });
    expect(porRef.get('ley999-dt02')).toMatchObject({ paginaDesde: 5, paginaHasta: 5 });
  });

  it('divide artículos demasiado largos en partes', () => {
    const largo = Array.from({ length: 60 }, (_, i) => `Oración número ${i} con varias palabras para alargar el texto del artículo.`);
    const paginas = [
      { numero: 1, texto: ['Artículo 1. (Corto). Texto corto.', 'Artículo 2. (Largo).', ...largo, 'Artículo 3. (Fin). Fin.'].join('\n') },
    ];
    const r = fragmentar(paginas, 'x', { maxPalabras: 300, objetivoPalabras: 200 });
    const partes = r.fragmentos.filter((f) => f.ref.startsWith('x-art02'));
    expect(partes.length).toBeGreaterThan(1);
    expect(partes[0]!.ref).toBe('x-art02-1');
    expect(partes[0]!.etiqueta).toMatch(/^Art\. 2 \(1\/\d\)$/);
    expect(partes.every((p) => p.palabras <= 300)).toBe(true);
  });
});

describe('fragmentar (índice de reglamento con OCR)', () => {
  it('descarta las entradas del índice y conserva los artículos reales sin sufijos', () => {
    const paginas = [
      { numero: 1, texto: ['ÍNDICE', 'Artículo 1.- (Objeto)....0en0e ne', 'Artículo 2.- (Ámbito) ne DD', 'Artículo 3.- (Vigencia) 7'].join('\n') },
      {
        numero: 2,
        texto: [
          'Artículo 1.- (Objeto). El presente reglamento regula la implementación de maestros itinerantes en unidades multigrado.',
          'Artículo 2.- (Ámbito). Se aplica a todas las unidades educativas fiscales del área rural dispersa del país.',
          'Artículo 3.- (Vigencia). Entra en vigencia a partir de su publicación en la página oficial del Ministerio de Educación.',
        ].join('\n'),
      },
    ];
    const { fragmentos } = fragmentar(paginas, 'rm');
    expect(fragmentos.map((f) => f.ref)).toEqual(['rm-art01', 'rm-art02', 'rm-art03']);
    expect(fragmentos.every((f) => f.paginaDesde === 2)).toBe(true);
  });
});

describe('fragmentar (libro)', () => {
  it('sin artículos corta en bloques con temas por rango de páginas', () => {
    const parrafo = 'La gestión escolar requiere liderazgo pedagógico distribuido y una visión compartida. ';
    // Texto distinto en cada página (si no, se tomaría como encabezado repetido).
    const paginas = Array.from({ length: 25 }, (_, i) => ({ numero: i + 1, texto: `${'Sección '.repeat(i + 1)}. ${parrafo.repeat(12)}` }));
    const { modo, fragmentos } = fragmentar(paginas, 'libro', { objetivoPalabras: 300, maxPalabras: 500 });

    expect(modo).toBe('LIBRO');
    expect(fragmentos[0]!.ref).toBe('libro-b001');
    expect(fragmentos[0]!.tema).toEqual(['Págs. 1–20']);
    expect(fragmentos.at(-1)!.tema).toEqual(['Págs. 21–40']);
    expect(fragmentos.every((f) => f.palabras <= 500)).toBe(true);
    // Ningún bloque cruza el límite de tema.
    expect(fragmentos.every((f) => (f.paginaDesde <= 20) === (f.paginaHasta <= 20))).toBe(true);
  });
});

describe('utilidades', () => {
  it('claveDesdeTitulo', () => {
    expect(claveDesdeTitulo('Ley 070')).toBe('ley070');
    expect(claveDesdeTitulo('RM 0092/2025')).toBe('rm0092-2025');
    expect(claveDesdeTitulo('Constitución Política del Estado')).toBe('constitucion-politica');
  });

  it('reflujo une líneas cortadas y separa incisos', () => {
    expect(reflujo(['El sistema educativo', 'comprende:', 'a) Educación regular;', 'b) Educación alternativa.'])).toBe(
      'El sistema educativo comprende:\na) Educación regular;\nb) Educación alternativa.',
    );
  });

  it('lineasLimpias descarta números de página y líneas de índice', () => {
    const l = lineasLimpias([{ numero: 1, texto: 'Capítulo I. Generalidades ........ 12\n15\nTexto real.' }]);
    expect(l.map((x) => x.texto)).toEqual(['Texto real.']);
  });

  it('limpiarOcr corrige números romanos mal leídos', () => {
    expect(limpiarOcr('Que el Parágrafo | del Artículo 77\nCONSIDERANDO Ill:')).toBe('Que el Parágrafo I del Artículo 77\nCONSIDERANDO III:');
  });
});
