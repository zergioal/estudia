/**
 * Fragmentación del texto extraído.
 *
 * - NORMATIVA (leyes, decretos, RM): un fragmento por artículo o disposición, con la ruta de temas
 *   Parte/Reglamento › Título › Capítulo › Sección. Los artículos muy largos se dividen en partes.
 * - LIBRO (sin artículos): bloques de ~900 palabras cortados en fin de oración; los "Capítulo N"
 *   abren tema nuevo.
 *
 * Todo es puro (sin BD) para poder probarlo con textos de ejemplo.
 */

export interface PaginaTexto {
  numero: number;
  texto: string;
}

export interface FragmentoGenerado {
  ref: string;
  etiqueta: string;
  /** Ruta de temas, del más general al más específico. */
  tema: string[];
  texto: string;
  paginaDesde: number;
  paginaHasta: number;
  palabras: number;
  orden: number;
}

export interface ResultadoFragmentacion {
  modo: 'NORMATIVA' | 'LIBRO';
  fragmentos: FragmentoGenerado[];
}

export interface OpcionesFragmentacion {
  /** Por encima de esto un artículo se divide en partes. */
  maxPalabras?: number;
  /** Tamaño buscado para bloques de libro y partes de artículos largos. */
  objetivoPalabras?: number;
}

interface Linea {
  texto: string;
  pagina: number;
}

// ---------- Utilidades de texto ----------

const ORDINALES: Record<string, number> = {
  primero: 1, primera: 1, segundo: 2, segunda: 2, tercero: 3, tercera: 3, cuarto: 4, cuarta: 4,
  quinto: 5, quinta: 5, sexto: 6, sexta: 6, septimo: 7, septima: 7, octavo: 8, octava: 8,
  noveno: 9, novena: 9, decimo: 10, decima: 10, undecimo: 11, undecima: 11, duodecimo: 12, duodecima: 12,
};
const ORDINALES_FEMENINOS = [
  'primera', 'segunda', 'tercera', 'cuarta', 'quinta', 'sexta', 'séptima', 'octava', 'novena', 'décima', 'undécima', 'duodécima',
];
const ORDINAL_RE =
  'PRIMER[OA]|SEGUND[OA]|TERCER[OA]|CUART[OA]|QUINT[OA]|SEXT[OA]|S[EÉ]PTIM[OA]|OCTAV[OA]|NOVEN[OA]|D[EÉ]CIM[OA]|UND[EÉ]CIM[OA]|DUOD[EÉ]CIM[OA]';

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
export const contarPalabras = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
const pad = (n: number, d = 2) => String(n).padStart(d, '0');

/** "5" → 5, "Quinto" → 5, "Único" → 'unico'. */
function numeroDe(token: string): number | 'unico' | null {
  if (/^\d+$/.test(token)) return Number(token);
  const t = sinTildes(token).toLowerCase();
  if (t === 'unico' || t === 'unica') return 'unico';
  return ORDINALES[t] ?? null;
}

function esMayusculas(s: string) {
  const letras = s.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
  if (letras.length < 3) return false;
  const mayus = letras.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, '').length;
  return mayus / letras.length > 0.8;
}

/** Nombre de tema legible: en mayúsculas → oración; sin " - " (es el separador de rutas). */
function nombreLegible(s: string) {
  // Quita separadores y basura de OCR en los bordes ("! DISPOSICIONES GENERALES").
  let r = s.replace(/^[^\p{L}\d(]+|[\s.\-–:]+$/gu, '').replace(/\s+-\s+/g, ' – ');
  if (esMayusculas(r)) r = r.toLowerCase();
  if (r.length > MAX_NOMBRE_TEMA) r = `${r.slice(0, r.lastIndexOf(' ', MAX_NOMBRE_TEMA)).replace(/[,;:]$/, '')}…`;
  return r.charAt(0).toUpperCase() + r.slice(1);
}

/** Primeras 4 palabras normalizadas: para reconocer el mismo título con ruido de OCR al final. */
const inicioDe = (s: string) => sinTildes(s.toLowerCase()).split(/[^a-z0-9]+/).filter(Boolean).slice(0, 4).join(' ');

const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

// ---------- Limpieza ----------

const RE_NUM_PAGINA = /^(p[aá]g(ina)?\.?\s*)?\d{1,4}(\s*(\/|de)\s*\d{1,4})?$/i;
/** Encabezados con letras separadas: "C A P Í T U L O 1. E L M O D E L O" */
const RE_LETRAS_ESPACIADAS = /^(\S ){8,}/;
/** Línea de índice con puntos guía: "Capítulo I. Disposiciones generales ........ 12" */
const RE_LINEA_INDICE = /(\.\s?){5,}|…{2,}/;
const MAX_NOMBRE_TEMA = 90;

/** Quita encabezados/pies repetidos y números de página, y une palabras cortadas con guion. */
export function lineasLimpias(paginas: PaginaTexto[]): Linea[] {
  const porPagina = paginas.map((p) => ({
    numero: p.numero,
    lineas: p.texto.normalize('NFC').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean),
  }));

  const firma = (l: string) => sinTildes(l.toLowerCase()).replace(/\d+/g, '#').replace(/\s+/g, ' ');
  const conteo = new Map<string, number>();
  for (const p of porPagina) {
    for (const f of new Set(p.lineas.map(firma))) conteo.set(f, (conteo.get(f) ?? 0) + 1);
  }
  const umbral = porPagina.length >= 4 ? Math.max(3, Math.ceil(porPagina.length * 0.3)) : Infinity;

  const salida: Linea[] = [];
  for (const p of porPagina) {
    for (const texto of p.lineas) {
      // "Artículo 14." solo en su línea se repite en casi todas las páginas, pero no es un encabezado de página.
      if ((conteo.get(firma(texto)) ?? 0) >= umbral && !esEstructural(texto)) continue;
      if (RE_NUM_PAGINA.test(texto) || RE_LETRAS_ESPACIADAS.test(texto) || RE_LINEA_INDICE.test(texto)) continue;
      const anterior = salida[salida.length - 1];
      // "educa-" + "ción" → "educación" (también entre páginas)
      if (anterior && /[a-záéíóúñ]-$/.test(anterior.texto) && /^[a-záéíóúñ]/.test(texto)) {
        anterior.texto = anterior.texto.slice(0, -1) + texto;
        continue;
      }
      salida.push({ texto, pagina: p.numero });
    }
  }
  return salida;
}

/** Junta líneas cortadas por el ancho de página y conserva los saltos de párrafo e incisos. */
export function reflujo(lineas: string[]): string {
  const RE_INCISO = /^(\d{1,3}[.)]|[a-zñ]\)|[IVXLC]{1,6}\.|[•▪●\-–]\s)/;
  let texto = '';
  for (const l of lineas) {
    if (!texto) texto = l;
    else if (RE_INCISO.test(l) || (/[.:;!?]$/.test(texto) && /^[A-ZÁÉÍÓÚÑ¿¡"“(]/.test(l))) texto += `\n${l}`;
    else texto += ` ${l}`;
  }
  return texto;
}

// ---------- Detección de encabezados (normativa) ----------

const esEstructural = (l: string) =>
  RE_ARTICULO.test(l) || RE_NIVEL.test(l) || RE_DISPOSICION.test(l) || RE_DISPOSICIONES.test(l);

type Encabezado =
  | { tipo: 'nivel'; nivel: 0 | 1 | 2 | 3 | 4; etiqueta: string; nombre: string; esReglamento?: boolean }
  | { tipo: 'articulo'; numero: number | 'unico'; resto: string }
  | { tipo: 'disposicion'; clase: string; numero: number | 'unico' }
  | { tipo: 'disposiciones'; clase: string };

const RE_ARTICULO = new RegExp(
  `^(?:ART[IÍ]CULO|Art[ií]culo|Art\\.)\\s*(\\d{1,3}|[ÚU]NIC[OA]|${ORDINAL_RE})\\s*[°ºo]?\\s*(\\.\\s*-|\\.-|\\.|-|–|:|\\(|$)(.*)$`,
  'i',
);
const RE_NIVEL = new RegExp(
  `^(T[IÍ]TULO|CAP[IÍ]TULO|SUBSECCI[OÓ]N|SECCI[OÓ]N)\\s+([IVXLC]{1,7}|\\d{1,3}|PRELIMINAR|[ÚU]NIC[OA]|${ORDINAL_RE})\\b\\.?[\\s.\\-–:]*(.*)$`,
);
const RE_PARTE = new RegExp(`^(${ORDINAL_RE})\\s+PARTE\\b[\\s.\\-–:]*(.*)$`);
const RE_REGLAMENTO = /^REGLAMENTO\b/;
const CLASES_DISP = 'TRANSITORIA|FINAL|ADICIONAL|DEROGATORIA|ABROGATORIA';
const RE_DISPOSICIONES = new RegExp(
  `^DISPOSICI[OÓ]N(?:ES)?\\s+((?:${CLASES_DISP})(?:S|ES)?(?:\\s+Y\\s+(?:${CLASES_DISP})(?:S|ES)?)?)\\s*[.:]?\\s*$`,
);
const RE_DISPOSICION = new RegExp(
  `^DISPOSICI[OÓ]N\\s+(${CLASES_DISP})\\s+(${ORDINAL_RE}|[ÚU]NICA)\\s*[.\\-–:(]`,
  'i',
);
const RE_ITEM_DISP = new RegExp(`^(${ORDINAL_RE}|[ÚU]NICA)\\s*(\\.\\s*-|\\.-|\\.|-|–|:|\\()`, 'i');

const PREFIJO_DISP: Record<string, string> = {
  transitoria: 'dt', final: 'df', adicional: 'da', derogatoria: 'dd', abrogatoria: 'dab',
};

function claseDisp(texto: string) {
  const t = sinTildes(texto).toLowerCase();
  const partes = Object.keys(PREFIJO_DISP).filter((c) => t.includes(c));
  return partes.length > 1 ? 'derogatoria y abrogatoria' : (partes[0] ?? 'final');
}
const prefijoDisp = (clase: string) => (clase.includes(' y ') ? 'dad' : (PREFIJO_DISP[clase] ?? 'd'));

type EstiloArticulo = 'MAYUS' | 'ABREV' | 'NORMAL';
const estiloDe = (l: string): EstiloArticulo => (/^ART[IÍ]CULO/.test(l) ? 'MAYUS' : /^Art\./.test(l) ? 'ABREV' : 'NORMAL');

/**
 * Si casi todos los artículos usan un estilo ("ARTÍCULO 5." vs "Artículo 5."), los del otro estilo
 * suelen ser artículos de otra norma citados textualmente (p. ej. la Ley 348 modificando el Código Penal).
 */
function estiloDominante(lineas: Linea[]): EstiloArticulo | null {
  const conteo = new Map<EstiloArticulo, number>();
  for (const l of lineas) {
    if (detectarEncabezado(l.texto, undefined, null)?.tipo === 'articulo') {
      conteo.set(estiloDe(l.texto), (conteo.get(estiloDe(l.texto)) ?? 0) + 1);
    }
  }
  const total = [...conteo.values()].reduce((a, b) => a + b, 0);
  const [estilo, n] = [...conteo.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  return total >= 10 && n / total >= 0.75 && n < total ? estilo : null;
}

function detectarEncabezado(
  l: string,
  anterior: string | undefined,
  enDisposiciones: string | null,
  estilo: EstiloArticulo | null = null,
): Encabezado | null {
  const art = RE_ARTICULO.exec(l);
  if (art && (!estilo || estiloDe(l) === estilo)) {
    const numero = numeroDe(art[1]!);
    const sep = art[2] ?? '';
    // "Artículo 80" solo al final de línea es ambiguo con ordinales; solo se acepta con dígitos.
    if (numero !== null && (sep !== '' || typeof numero === 'number')) {
      return { tipo: 'articulo', numero, resto: art[3] ?? '' };
    }
  }
  const disp = RE_DISPOSICION.exec(l);
  if (disp) {
    const numero = numeroDe(disp[2]!);
    if (numero !== null) return { tipo: 'disposicion', clase: claseDisp(disp[1]!), numero };
  }
  const grupo = RE_DISPOSICIONES.exec(l);
  if (grupo) return { tipo: 'disposiciones', clase: claseDisp(grupo[1]!) };
  if (enDisposiciones) {
    const item = RE_ITEM_DISP.exec(l);
    const numero = item ? numeroDe(item[1]!) : null;
    if (numero !== null) return { tipo: 'disposicion', clase: enDisposiciones, numero };
  }
  const nivel = RE_NIVEL.exec(l);
  if (nivel) {
    const palabra = sinTildes(nivel[1]!).toLowerCase();
    const n = palabra === 'titulo' ? 1 : palabra === 'capitulo' ? 2 : palabra === 'seccion' ? 3 : 4;
    // La capa de texto a veces trae "111" en lugar de "III".
    const token = /^1{2,3}$/.test(nivel[2]!) ? 'I'.repeat(nivel[2]!.length) : nivel[2]!;
    const num = /^[IVXLC]+$|^\d+$/.test(token) ? token : token.toLowerCase();
    return { tipo: 'nivel', nivel: n, etiqueta: `${capitalizar(nivel[1]!)} ${num}`, nombre: nivel[3] ?? '' };
  }
  const parte = RE_PARTE.exec(l);
  if (parte) return { tipo: 'nivel', nivel: 0, etiqueta: `${capitalizar(parte[1]!)} parte`, nombre: parte[2] ?? '' };
  if (RE_REGLAMENTO.test(l) && esMayusculas(l) && (!anterior || /[.:;]$/.test(anterior) || esMayusculas(anterior))) {
    return { tipo: 'nivel', nivel: 0, etiqueta: '', nombre: l, esReglamento: true };
  }
  return null;
}

// ---------- Fragmentación ----------

interface Borrador {
  etiqueta: string;
  ref: string;
  tema: string[];
  lineas: Linea[];
  /** Texto entre un encabezado y el primer artículo. */
  suelto?: boolean;
}

export function fragmentar(
  paginas: PaginaTexto[],
  clave: string,
  opciones: OpcionesFragmentacion = {},
): ResultadoFragmentacion {
  const maxPalabras = opciones.maxPalabras ?? 1200;
  const objetivo = opciones.objetivoPalabras ?? 900;
  const lineas = lineasLimpias(paginas);

  const articulos = lineas.filter((l, i) => detectarEncabezado(l.texto, lineas[i - 1]?.texto, null)?.tipo === 'articulo');
  const modo = articulos.length >= 3 ? 'NORMATIVA' : 'LIBRO';
  const borradores =
    modo === 'NORMATIVA' ? sinEntradasDeIndice(fragmentarNormativa(lineas, clave)) : fragmentarLibro(lineas, clave, objetivo, maxPalabras);

  // Partir lo demasiado largo y asignar refs únicas.
  const usadas = new Set<string>();
  const fragmentos: FragmentoGenerado[] = [];
  for (const b of borradores) {
    const partes = modo === 'NORMATIVA' ? partir(b.lineas, objetivo, maxPalabras) : [b.lineas];
    partes.forEach((ls, i) => {
      const sufijo = partes.length > 1 ? `-${i + 1}` : '';
      let ref = `${b.ref}${sufijo}`;
      for (let k = 2; usadas.has(ref); k++) ref = `${b.ref}${sufijo}-${String.fromCharCode(96 + k)}`;
      usadas.add(ref);
      const texto = reflujo(ls.map((l) => l.texto));
      fragmentos.push({
        ref,
        etiqueta: partes.length > 1 ? `${b.etiqueta} (${i + 1}/${partes.length})` : b.etiqueta,
        tema: b.tema,
        texto,
        paginaDesde: ls[0]!.pagina,
        paginaHasta: ls[ls.length - 1]!.pagina,
        palabras: contarPalabras(texto),
        orden: fragmentos.length,
      });
    });
  }
  return { modo, fragmentos };
}

function fragmentarNormativa(lineas: Linea[], clave: string): Borrador[] {
  const borradores: Borrador[] = [];
  const ruta: (string | null)[] = [null, null, null, null, null];
  let prefijoRef = clave;
  let reglamentos = 0;
  let enDisposiciones: string | null = null;
  let actual: Borrador | null = null;
  let preambulo: Borrador | null = { etiqueta: 'Preámbulo', ref: `${clave}-pre`, tema: ['Preámbulo'], lineas: [] };
  let sueltos = 0;
  const estilo = estiloDominante(lineas);
  const textoCompleto = lineas.map((l) => l.texto).join(' ');
  const temaPorDefecto = /RESUELVE/i.test(textoCompleto) ? 'Parte resolutiva' : 'Disposiciones generales';

  const temaActual = () => {
    const t = ruta.filter((x): x is string => Boolean(x));
    return t.length ? t : [temaPorDefecto];
  };
  const cerrar = () => {
    // Un "suelto" muy corto es el resto del nombre de un título/capítulo, no contenido.
    const esResto = actual?.suelto && contarPalabras(actual.lineas.map((l) => l.texto).join(' ')) < 15;
    if (actual && actual.lineas.length && !esResto) borradores.push(actual);
    actual = null;
  };
  const cerrarPreambulo = () => {
    if (preambulo && contarPalabras(preambulo.lineas.map((l) => l.texto).join(' ')) >= 30) {
      if (/CONSIDERANDO/i.test(preambulo.lineas.map((l) => l.texto).join(' '))) {
        preambulo.etiqueta = 'Vistos y considerandos';
        preambulo.tema = ['Considerandos'];
      }
      borradores.push(preambulo);
    }
    preambulo = null;
  };

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i]!;
    const enc = detectarEncabezado(linea.texto, lineas[i - 1]?.texto, enDisposiciones, estilo);

    if (!enc) {
      if (actual) actual.lineas.push(linea);
      else if (preambulo) preambulo.lineas.push(linea);
      else {
        // Texto entre un encabezado y el primer artículo: no se descarta.
        actual = { etiqueta: temaActual().at(-1)!, ref: `${clave}-t${pad(++sueltos, 3)}`, tema: temaActual(), lineas: [linea], suelto: true };
      }
      continue;
    }

    if (enc.tipo === 'articulo' || enc.tipo === 'disposicion') {
      cerrarPreambulo();
      cerrar();
      if (enc.tipo === 'articulo') {
        const n = enc.numero === 'unico' ? 'unico' : pad(enc.numero);
        actual = {
          etiqueta: enc.numero === 'unico' ? 'Art. único' : `Art. ${enc.numero}`,
          ref: `${prefijoRef}-art${n}`,
          tema: temaActual(),
          lineas: [linea],
        };
      } else {
        const n = enc.numero === 'unico' ? 'u' : pad(enc.numero);
        const ordinal = enc.numero === 'unico' ? 'única' : (ORDINALES_FEMENINOS[enc.numero - 1] ?? String(enc.numero));
        actual = {
          etiqueta: `Disp. ${enc.clase} ${ordinal}`,
          ref: `${prefijoRef}-${prefijoDisp(enc.clase)}${n}`,
          tema: ruta[0] ? [ruta[0], nombreDisposiciones(enc.clase)] : [nombreDisposiciones(enc.clase)],
          lineas: [linea],
        };
      }
      continue;
    }

    // Encabezados estructurales: cierran el fragmento en curso y actualizan la ruta de temas.
    cerrarPreambulo();
    cerrar();
    if (enc.tipo === 'disposiciones') {
      enDisposiciones = enc.clase;
      ruta[1] = nombreDisposiciones(enc.clase);
      ruta[2] = ruta[3] = null;
      continue;
    }
    enDisposiciones = null;
    let nombre = enc.nombre;
    // El nombre suele venir en la(s) línea(s) siguiente(s), en mayúsculas.
    for (let tomadas = 0; tomadas < 2; tomadas++) {
      const sig = lineas[i + 1];
      const encSig = sig ? detectarEncabezado(sig.texto, linea.texto, null) : null;
      // "TÍTULO II" + "DISPOSICIONES FINALES": la segunda línea es el nombre del título, no un grupo.
      const nombreDeDisposiciones = encSig?.tipo === 'disposiciones' && !nombre;
      if (!sig || (encSig && !nombreDeDisposiciones) || !esMayusculas(sig.texto) || sig.texto.length > 160) break;
      if (nombre && !esMayusculas(nombre)) break;
      nombre = nombre ? `${nombre} ${sig.texto}` : sig.texto;
      i++;
    }
    const etiqueta = enc.esReglamento ? nombreLegible(nombre) : nombre ? `${enc.etiqueta}. ${nombreLegible(nombre)}` : enc.etiqueta;
    if (enc.nivel === 0) {
      // El mismo reglamento puede nombrarse varias veces (índice, artículo que lo aprueba, carátula), a veces
      // con ruido de OCR: se compara por las primeras palabras y se conserva el primer nombre.
      const anteriorNivel0 = ruta[0];
      const mismo = Boolean(enc.esReglamento && anteriorNivel0 && inicioDe(anteriorNivel0) === inicioDe(etiqueta));
      if (enc.esReglamento && !mismo) reglamentos++;
      prefijoRef = enc.esReglamento ? `${clave}-reg${reglamentos > 1 ? reglamentos : ''}` : clave;
      if (mismo) {
        for (let n = 1; n < ruta.length; n++) ruta[n] = null;
        continue;
      }
    }
    ruta[enc.nivel] = etiqueta;
    for (let n = enc.nivel + 1; n < ruta.length; n++) ruta[n] = null;
  }
  cerrarPreambulo();
  cerrar();
  return borradores;
}

const nombreDisposiciones = (clase: string) => `Disposiciones ${clase.replace('transitoria', 'transitorias').replace(/^final$/, 'finales').replace('adicional', 'adicionales').replace(/^derogatoria$/, 'derogatorias').replace(/^abrogatoria$/, 'abrogatorias')}`;

/**
 * Un índice del reglamento ("Artículo 5.- (Definiciones) ....... 3") produce artículos diminutos que luego
 * reaparecen con su texto real. Si un artículo corto tiene la misma ref que uno posterior, es del índice.
 */
function sinEntradasDeIndice(borradores: Borrador[]): Borrador[] {
  const ultimaPosicion = new Map<string, number>();
  borradores.forEach((b, i) => ultimaPosicion.set(b.ref, i));
  return borradores.filter(
    (b, i) => ultimaPosicion.get(b.ref) === i || contarPalabras(b.lineas.map((l) => l.texto).join(' ')) >= 30,
  );
}

/** Divide un artículo largo en partes de ~objetivo palabras, cortando en fin de oración. */
function partir(lineas: Linea[], objetivo: number, max: number): Linea[][] {
  const total = contarPalabras(lineas.map((l) => l.texto).join(' '));
  if (total <= max) return [lineas];
  const meta = total / Math.ceil(total / objetivo);
  const partes: Linea[][] = [];
  let actual: Linea[] = [];
  let palabras = 0;
  for (const l of lineas) {
    actual.push(l);
    palabras += contarPalabras(l.texto);
    if ((palabras >= meta && /[.;:]$/.test(l.texto)) || palabras >= max) {
      partes.push(actual);
      actual = [];
      palabras = 0;
    }
  }
  if (actual.length) {
    // Un resto muy corto se pega a la parte anterior.
    const previa = partes[partes.length - 1];
    const palabrasPrevia = previa ? contarPalabras(previa.map((l) => l.texto).join(' ')) : 0;
    if (previa && palabras < meta / 3 && palabrasPrevia + palabras <= max) previa.push(...actual);
    else partes.push(actual);
  }
  return partes;
}

/** Los libros no traen estructura fiable (ni marcadores): los temas son rangos de páginas. */
export const PAGINAS_POR_TEMA_LIBRO = 20;

function temaDeLibro(pagina: number) {
  const desde = Math.floor((pagina - 1) / PAGINAS_POR_TEMA_LIBRO) * PAGINAS_POR_TEMA_LIBRO + 1;
  return `Págs. ${desde}–${desde + PAGINAS_POR_TEMA_LIBRO - 1}`;
}

function fragmentarLibro(lineas: Linea[], clave: string, objetivo: number, max: number): Borrador[] {
  const borradores: Borrador[] = [];
  let actual: Linea[] = [];
  let palabras = 0;
  const cerrar = () => {
    if (!actual.length) return;
    const desde = actual[0]!.pagina;
    const hasta = actual[actual.length - 1]!.pagina;
    borradores.push({
      etiqueta: desde === hasta ? `Pág. ${desde}` : `Págs. ${desde}–${hasta}`,
      ref: `${clave}-b${pad(borradores.length + 1, 3)}`,
      tema: [temaDeLibro(desde)],
      lineas: actual,
    });
    actual = [];
    palabras = 0;
  };

  for (const l of lineas) {
    // Un bloque no cruza el límite entre temas.
    if (actual.length && temaDeLibro(l.pagina) !== temaDeLibro(actual[0]!.pagina)) cerrar();
    actual.push(l);
    palabras += contarPalabras(l.texto);
    if ((palabras >= objetivo && /[.!?:]$/.test(l.texto)) || palabras >= max) cerrar();
  }
  cerrar();
  return borradores;
}

// ---------- Clave del contenido ----------

/** "Ley 070" → "ley070", "RM 0092/2025" → "rm0092-2025", "LIDEI 2022 Liderazgo educativo" → "lidei2022-liderazgo". */
export function claveDesdeTitulo(titulo: string): string {
  const tokens = sinTildes(titulo).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const grupos: string[] = [];
  for (const t of tokens) {
    // Un número se pega a la palabra anterior: "ley 070" → "ley070".
    if (/^\d+$/.test(t) && grupos.length && !/\d$/.test(grupos[grupos.length - 1]!)) grupos[grupos.length - 1] += t;
    else grupos.push(t);
  }
  let clave = '';
  for (const g of grupos) {
    const siguiente = clave ? `${clave}-${g}` : g;
    if (siguiente.length > 24 && clave) break;
    clave = siguiente;
  }
  return clave || 'contenido';
}
