import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app, limpiarBase, lote, preguntaValida, prisma, tokenDe } from './utilidades';
import { pdfDeTexto } from './pdf';

const dirFuentes = process.env.FUENTES_DIR!;
let token: string;
let contenidoId: string;
const auth = () => ({ Authorization: `Bearer ${token}` });

const PDF_LEY = pdfDeTexto([
  ['LEY Nº 999', 'TÍTULO I', 'DISPOSICIONES GENERALES', 'CAPÍTULO I', 'OBJETO',
    'Artículo 1. (Objeto). La presente Ley regula la educación fiscal.', 'Artículo 2. (Ámbito). Se aplica en todo el territorio nacional.'],
  ['CAPÍTULO II', 'ORGANIZACIÓN', 'Artículo 3. (Direcciones). Las direcciones distritales dependen del Ministerio.',
    'Artículo 4. (Plazo). El plazo es de treinta días hábiles.'],
]);

const subir = (archivo: Buffer, nombre = 'ley999.pdf', id = contenidoId) =>
  request(app).post('/api/v1/admin/documentos').set(auth()).field('contenidoId', id).attach('archivo', archivo, nombre);

beforeAll(() => rm(path.dirname(dirFuentes), { recursive: true, force: true }));
beforeEach(async () => {
  await limpiarBase();
  token = await tokenDe('ADMIN');
  const coleccion = await prisma.coleccion.create({ data: { nombre: 'Ascenso 2027' } });
  contenidoId = (await prisma.contenido.create({ data: { titulo: 'Ley 999', tipoFuente: 'LEY', coleccionId: coleccion.id } })).id;
});
afterAll(() => prisma.$disconnect());

describe('POST /api/v1/admin/documentos', () => {
  it('sube, extrae, fragmenta por artículos y crea los temas', async () => {
    const res = await subir(PDF_LEY);

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ estado: 'FRAGMENTADO', paginas: 2, paginasOcr: 0, modo: 'NORMATIVA', nombreArchivo: 'ley999.pdf' });
    expect(res.body.contenido.clave).toBe('ley999');
    expect(res.body.fragmentos.map((f: { ref: string }) => f.ref)).toEqual([
      'ley999-art01',
      'ley999-art02',
      'ley999-art03',
      'ley999-art04',
    ]);
    const art3 = res.body.fragmentos[2];
    expect(art3).toMatchObject({ etiqueta: 'Art. 3', paginaDesde: 2, tema: 'Título I. Disposiciones generales - Capítulo II. Organización' });
    expect(await prisma.pagina.count()).toBe(2);
  });

  it('exporta los fragmentos a fuentes/<clave>/ con encabezado e índice', async () => {
    await subir(PDF_LEY);
    const md = await readFile(path.join(dirFuentes, 'ley999', 'ley999-art01.md'), 'utf8');
    expect(md).toContain('contenido: "Ley 999"');
    expect(md).toContain('tema: "Título I. Disposiciones generales - Capítulo I. Objeto"');
    expect(md).toContain('fragmentoRef: ley999-art01');
    expect(md).toContain('Artículo 1. (Objeto). La presente Ley regula la educación fiscal.');
    const indice = await readFile(path.join(dirFuentes, 'ley999', '_indice.md'), 'utf8');
    expect(indice).toContain('| ley999-art04 | Art. 4 |');
  });

  it('rechaza el mismo PDF dos veces (409) y archivos que no son PDF (400)', async () => {
    await subir(PDF_LEY);
    const repetido = await subir(PDF_LEY);
    expect(repetido.status).toBe(409);
    expect(repetido.body.error.detalles.documentoId).toBeTruthy();

    const noPdf = await subir(Buffer.from('hola'), 'nota.txt');
    expect(noPdf.status).toBe(400);
    expect(noPdf.body.error.codigo).toBe('ARCHIVO_INVALIDO');
  });

  it('valida contenido y archivo', async () => {
    expect((await subir(PDF_LEY, 'x.pdf', 'no-existe')).status).toBe(404);
    const sinArchivo = await request(app).post('/api/v1/admin/documentos').set(auth()).field('contenidoId', contenidoId);
    expect(sinArchivo.status).toBe(400);
  });

  it('solo ADMIN', async () => {
    token = await tokenDe('REVISOR');
    expect((await subir(PDF_LEY)).status).toBe(403);
  });
});

describe('fragmentos y preguntas', () => {
  const importar = (cuerpo: object) => request(app).post('/api/v1/admin/preguntas/importar').set(auth()).send(cuerpo);
  const loteLey = (preguntas: unknown[]) =>
    lote(preguntas, { contenido: 'Ley 999', tema: 'Título I. Disposiciones generales - Capítulo I. Objeto', fragmentoRef: 'ley999-art01' });

  it('el importador enlaza al fragmento real y verifica la cita contra su texto', async () => {
    await subir(PDF_LEY);
    const res = await importar(
      loteLey([
        preguntaValida('¿Qué regula la Ley 999?', { citaTextual: 'La presente Ley regula la educación fiscal.' }),
        preguntaValida('¿Cita inventada?', { citaTextual: 'regula la educación privada' }),
      ]),
    );
    expect(res.body.importadas).toBe(1);
    expect(res.body.rechazadas[0].motivo).toMatch(/no aparece en el fragmento/);

    const p = await prisma.pregunta.findFirstOrThrow({ include: { fragmento: true } });
    expect(p.fragmento?.ref).toBe('ley999-art01');
    // Mismo tema que creó la ingesta, no uno nuevo.
    const fragmento = await prisma.fragmento.findUniqueOrThrow({ where: { ref: 'ley999-art01' } });
    expect(p.temaId).toBe(fragmento.temaId);
  });

  it('un lote con solo fragmentoRef toma contenido y tema del fragmento', async () => {
    await subir(PDF_LEY);
    const res = await importar({
      fragmentoRef: 'ley999-art03',
      preguntas: [preguntaValida('¿De quién dependen las direcciones distritales?', { citaTextual: 'dependen del Ministerio' })],
    });
    expect(res.status).toBe(201);
    expect(res.body.importadas).toBe(1);
    const fragmento = await prisma.fragmento.findUniqueOrThrow({ where: { ref: 'ley999-art03' } });
    expect(res.body).toMatchObject({ contenidoId, temaId: fragmento.temaId });

    const sinFragmento = await importar({ fragmentoRef: 'no-existe-art01', preguntas: [preguntaValida('¿X?')] });
    expect(sinFragmento.status).toBe(400);
    expect(sinFragmento.body.error.codigo).toBe('LOTE_INVALIDO');
  });

  it('re-fragmentar conserva el enlace de las preguntas por fragmentoRef', async () => {
    const doc = (await subir(PDF_LEY)).body;
    await importar(loteLey([preguntaValida('¿Qué regula?', { citaTextual: 'regula la educación fiscal' })]));

    const res = await request(app).post(`/api/v1/admin/documentos/${doc.id}/fragmentar`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.fragmentos[0]).toMatchObject({ ref: 'ley999-art01', totalPreguntas: 1 });
  });

  it('enlaza preguntas importadas antes de que existiera el fragmento', async () => {
    await importar(loteLey([preguntaValida('¿Importada antes?', { citaTextual: 'cualquier cita' })]));
    expect((await prisma.pregunta.findFirstOrThrow()).fragmentoId).toBeNull();
    await subir(PDF_LEY);
    expect((await prisma.pregunta.findFirstOrThrow()).fragmentoId).not.toBeNull();
  });

  it('eliminar el documento desenlaza las preguntas sin borrarlas', async () => {
    const doc = (await subir(PDF_LEY)).body;
    await importar(loteLey([preguntaValida('¿Qué regula?', { citaTextual: 'regula la educación fiscal' })]));

    expect((await request(app).delete(`/api/v1/admin/documentos/${doc.id}`).set(auth())).status).toBe(204);
    const p = await prisma.pregunta.findFirstOrThrow();
    expect(p.fragmentoId).toBeNull();
    expect(p.fragmentoRef).toBe('ley999-art01');
    expect(await prisma.pagina.count()).toBe(0);
  });

  it('re-fragmentar borra los temas que quedaron vacíos pero no los creados a mano', async () => {
    const manual = await prisma.tema.create({ data: { contenidoId, nombre: 'Tema creado a mano', orden: 99 } });
    const doc = (await subir(PDF_LEY)).body;
    // Simula una mejora del fragmentador: el capítulo II pasa a llamarse distinto.
    const pagina = await prisma.pagina.findFirstOrThrow({ where: { documentoId: doc.id, numero: 2 } });
    await prisma.pagina.update({ where: { id: pagina.id }, data: { texto: pagina.texto.replace('ORGANIZACIÓN', 'DIRECCIONES') } });

    await request(app).post(`/api/v1/admin/documentos/${doc.id}/fragmentar`).set(auth());
    const nombres = (await prisma.tema.findMany({ where: { contenidoId } })).map((t) => t.nombre);
    expect(nombres).toContain('Capítulo II. Direcciones');
    expect(nombres).not.toContain('Capítulo II. Organización');
    expect(nombres).toContain(manual.nombre);
  });

  it('lista documentos por contenido', async () => {
    await subir(PDF_LEY);
    const res = await request(app).get(`/api/v1/admin/documentos?contenidoId=${contenidoId}`).set(auth());
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ totalFragmentos: 4, estado: 'FRAGMENTADO' });
  });
});
