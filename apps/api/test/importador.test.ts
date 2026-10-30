import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { deducirTipoFuente } from '../src/modulos/preguntas/servicio';
import { app, limpiarBase, lote, preguntaValida, prisma, tokenDe } from './utilidades';

let token: string;
const importar = (cuerpo: unknown) =>
  request(app).post('/api/v1/admin/preguntas/importar').set('Authorization', `Bearer ${token}`).send(cuerpo as object);

beforeEach(async () => {
  await limpiarBase();
  token = await tokenDe('ADMIN');
});
afterAll(() => prisma.$disconnect());

describe('POST /api/v1/admin/preguntas/importar', () => {
  it('importa preguntas válidas en BORRADOR y crea contenido, colección y ruta de temas', async () => {
    const res = await importar(lote([preguntaValida('¿Pregunta uno?'), preguntaValida('¿Pregunta dos?')]));

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ importadas: 2, rechazadas: [], duplicadas: [] });

    const contenido = await prisma.contenido.findUniqueOrThrow({ where: { titulo: 'Ley 070' }, include: { coleccion: true } });
    expect(contenido.tipoFuente).toBe('LEY');
    expect(contenido.coleccion.nombre).toBe('Sin asignar');

    const capitulo = await prisma.tema.findUniqueOrThrow({ where: { id: res.body.temaId }, include: { padre: true } });
    expect(capitulo.nombre).toBe('Capítulo I');
    expect(capitulo.padre?.nombre).toBe('Título I');
    expect(capitulo.padre?.padreId).toBeNull();

    const preguntas = await prisma.pregunta.findMany({ include: { opciones: { orderBy: { orden: 'asc' } } } });
    expect(preguntas).toHaveLength(2);
    expect(preguntas.every((p) => p.estado === 'BORRADOR' && p.origen === 'MANUAL')).toBe(true);
    expect(preguntas[0]!.fragmentoRef).toBe('ley070-art01');
    expect(preguntas[0]!.opciones.map((o) => o.texto)).toEqual(['Correcta', 'Distractor A', 'Distractor B', 'Distractor C']);
  });

  it('reutiliza contenido y temas existentes en un segundo lote', async () => {
    await importar(lote([preguntaValida('¿Uno?')]));
    await importar(lote([preguntaValida('¿Dos?')], { tema: 'Título I - Capítulo II' }));

    expect(await prisma.contenido.count()).toBe(1);
    expect(await prisma.coleccion.count()).toBe(1);
    const temas = await prisma.tema.findMany({ orderBy: { nombre: 'asc' } });
    expect(temas.map((t) => t.nombre)).toEqual(['Capítulo I', 'Capítulo II', 'Título I']);
  });

  it('rechaza por índice las preguntas inválidas sin tumbar el lote', async () => {
    const dosCorrectas = preguntaValida('¿Dos correctas?', {
      opciones: [
        { texto: 'A', correcta: true },
        { texto: 'B', correcta: true },
        { texto: 'C', correcta: false },
        { texto: 'D', correcta: false },
      ],
    });
    const tresOpciones = preguntaValida('¿Tres opciones?', {
      opciones: [
        { texto: 'A', correcta: true },
        { texto: 'B', correcta: false },
        { texto: 'C', correcta: false },
      ],
    });
    const sinCita = preguntaValida('¿Sin cita?', { citaTextual: '' });
    const tipoMalo = preguntaValida('¿Tipo malo?', { tipo: 'ENSAYO' });
    const seleccionSinCorrecta = preguntaValida('¿Selección sin correcta?', {
      tipo: 'SELECCION_MULTIPLE',
      opciones: [
        { texto: 'A', correcta: false },
        { texto: 'B', correcta: false },
        { texto: 'C', correcta: false },
      ],
    });

    const res = await importar(
      lote([preguntaValida('¿Válida?'), dosCorrectas, tresOpciones, sinCita, tipoMalo, seleccionSinCorrecta]),
    );

    expect(res.status).toBe(201);
    expect(res.body.importadas).toBe(1);
    expect(res.body.rechazadas.map((r: { indice: number }) => r.indice)).toEqual([1, 2, 3, 4, 5]);
    expect(res.body.rechazadas[0].motivo).toMatch(/exactamente 1 correcta/);
    expect(res.body.rechazadas[1].motivo).toMatch(/4 opciones/);
    expect(res.body.rechazadas[2].motivo).toMatch(/citaTextual/);
    expect(res.body.rechazadas[4].motivo).toMatch(/al menos 1 correcta/);
  });

  it('acepta SELECCION_MULTIPLE con varias correctas y VERDADERO_FALSO', async () => {
    const seleccion = preguntaValida('¿Cuáles son fines?', {
      tipo: 'SELECCION_MULTIPLE',
      opciones: [
        { texto: 'A', correcta: true },
        { texto: 'B', correcta: true },
        { texto: 'C', correcta: false },
      ],
    });
    const vf = preguntaValida('La educación es fiscal y gratuita.', {
      tipo: 'VERDADERO_FALSO',
      opciones: [
        { texto: 'Verdadero', correcta: true },
        { texto: 'Falso', correcta: false },
      ],
    });
    const res = await importar(lote([seleccion, vf]));
    expect(res.body).toMatchObject({ importadas: 2, rechazadas: [] });
  });

  it('marca como duplicadas las de igual enunciado (en el lote y contra la base)', async () => {
    await importar(lote([preguntaValida('¿Qué dice el Art. 1?')]));
    const res = await importar(
      lote([preguntaValida('¿Qué  dice el art. 1?'), preguntaValida('¿Nueva?'), preguntaValida('¿Nueva?')]),
    );

    expect(res.body.importadas).toBe(1);
    expect(res.body.duplicadas.map((d: { indice: number }) => d.indice)).toEqual([0, 2]);
    expect(await prisma.pregunta.count()).toBe(2);
  });

  it('verifica la cita textual cuando el fragmento existe', async () => {
    const contenido = await prisma.contenido.create({
      data: { titulo: 'Ley 070', tipoFuente: 'LEY', coleccion: { create: { nombre: 'Ascenso 2027' } } },
    });
    const documento = await prisma.documento.create({
      data: { contenidoId: contenido.id, nombreArchivo: 'ley070.pdf', archivoUrl: 'ley070.pdf', hash: 'abc', estado: 'FRAGMENTADO' },
    });
    await prisma.fragmento.create({
      data: {
        ref: 'ley070-art01',
        documentoId: documento.id,
        etiqueta: 'Art. 1',
        texto: 'Artículo 1. Toda persona tiene derecho a recibir educación.\nLa educación es   universal y gratuita.',
        paginaDesde: 2,
        paginaHasta: 2,
      },
    });

    const res = await importar(
      lote([preguntaValida('¿Cita presente?'), preguntaValida('¿Cita inventada?', { citaTextual: 'la educación es privada' })]),
    );

    expect(res.body.importadas).toBe(1);
    expect(res.body.rechazadas).toEqual([{ indice: 1, motivo: expect.stringMatching(/no aparece en el fragmento/) }]);
    const p = await prisma.pregunta.findFirstOrThrow();
    expect(p.fragmentoId).not.toBeNull();
  });

  it('responde 400 si el lote no cumple el contrato', async () => {
    const res = await importar({ contenido: 'Ley 070', preguntas: [] });
    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe('LOTE_INVALIDO');
    expect(await prisma.contenido.count()).toBe(0);
  });

  it('importa el archivo importar/ejemplo.json', async () => {
    const ruta = fileURLToPath(new URL('../../../importar/ejemplo.json', import.meta.url));
    const json = JSON.parse(await readFile(ruta, 'utf8'));
    const res = await importar(json);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ importadas: 5, rechazadas: [], duplicadas: [] });
  });
});

describe('deducirTipoFuente', () => {
  it.each([
    ['Ley 070', 'LEY'],
    ['D.S. 4712', 'DECRETO'],
    ['Decreto Supremo 1234', 'DECRETO'],
    ['RM 001/2026', 'RM'],
    ['Resolución Ministerial 0001', 'RM'],
    ['Currículo Base', 'GUIA'],
  ])('%s → %s', (titulo, esperado) => {
    expect(deducirTipoFuente(titulo)).toBe(esperado);
  });
});
