import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fijarResolutorCiego } from '../src/modulos/calidad/ciego';
import { embeberPendientes } from '../src/modulos/calidad/servicio';
import { revisar } from '../src/modulos/calidad/validador';
import { app, limpiarBase, lote, preguntaValida, prisma, tokenDe } from './utilidades';

let token: string;
const auth = (t = token) => ({ Authorization: `Bearer ${t}` });

const importar = (preguntas: unknown[]) =>
  request(app).post('/api/v1/admin/preguntas/importar').set(auth()).send(lote(preguntas));
const analizar = (cuerpo: object = {}) => request(app).post('/api/v1/admin/calidad/analizar').set(auth()).send(cuerpo);
const porEnunciado = (inicio: string) => prisma.pregunta.findFirstOrThrow({ where: { enunciado: { startsWith: inicio } } });

beforeEach(async () => {
  await limpiarBase();
  token = await tokenDe('ADMIN');
});
afterEach(() => {
  fijarResolutorCiego(null);
  delete process.env.ANTHROPIC_API_KEY;
});
afterAll(() => prisma.$disconnect());

describe('Validador de reglas', () => {
  const base = {
    tipo: 'OPCION_MULTIPLE',
    enunciado: '¿Qué instancia aprueba la apertura de un CEA según la RM 0092/2025?',
    citaTextual: 'La Dirección Departamental de Educación aprueba la apertura',
    referencia: 'RM 0092/2025, Art. 7, pág. 3',
    opciones: [
      { texto: 'La Dirección Departamental', correcta: true, porQue: 'Art. 7' },
      { texto: 'La Dirección Distrital', correcta: false, porQue: 'Solo recibe' },
      { texto: 'El Ministerio de Educación', correcta: false, porQue: 'Norma' },
      { texto: 'La Junta Escolar del CEA', correcta: false, porQue: 'No es competente' },
    ],
  };

  it('una pregunta bien hecha no tiene alertas', () => {
    expect(revisar(base, 'Art. 7. La Dirección Departamental de Educación aprueba la apertura de los CEA.')).toEqual([]);
  });

  it('detecta los defectos típicos', () => {
    const mala = {
      ...base,
      enunciado: '¿Qué instancia no es competente? La Dirección Departamental de Educación',
      citaTextual: 'corta',
      referencia: 'RM 0092/2025, Art. 7',
      opciones: [
        { texto: 'La Dirección Departamental de Educación, que además coordina con el Ministerio y las Distritales', correcta: true, porQue: null },
        { texto: 'Distrital', correcta: false, porQue: 'x' },
        { texto: 'Todas las anteriores', correcta: false, porQue: 'x' },
        { texto: 'distrital.', correcta: false, porQue: 'x' },
      ],
    };
    const alertas = revisar(mala, 'Texto del artículo sin la cita');
    expect(alertas).toEqual(
      expect.arrayContaining([
        'La cita textual no aparece en el fragmento fuente',
        'La cita textual es demasiado corta para respaldar la respuesta',
        'La referencia no indica la página',
        'Usa "todas/ninguna de las anteriores"',
        'La correcta es mucho más larga que los distractores (se delata)',
        'Las opciones 2 y 4 son casi iguales',
        'Falta el "porQue" en 1 opción',
        'Destaca la negación en mayúsculas (EXCEPTO / NO)',
      ]),
    );
    const delatora = {
      ...base,
      enunciado: 'Si la Dirección Departamental de Educación aprueba la apertura, ¿quién la aprueba?',
      opciones: [{ ...base.opciones[0]!, texto: 'La Dirección Departamental de Educación' }, ...base.opciones.slice(1)],
    };
    expect(revisar(delatora, null)).toContain('El enunciado contiene la respuesta correcta');
  });
});

describe('Análisis: embeddings, duplicados y validación', () => {
  it('valida las buenas, marca duplicadas y deja con alertas las defectuosas', async () => {
    await importar([
      preguntaValida('¿Cuál es el plazo para presentar la solicitud de apertura de un CEA?'),
      preguntaValida('¿Cuál es el plazo para presentar la solicitud de apertura de un CEA?  ', { dificultad: 'DIFICIL' }),
      preguntaValida('Cuál es el plazo para presentar la solicitud de apertura de un CEA'),
      preguntaValida('¿Qué principio rige la educación boliviana según la Ley 070?', {
        opciones: [
          { texto: 'Universal', correcta: true, porQue: 'Art. 1' },
          { texto: 'Selectiva', correcta: false, porQue: 'x' },
          { texto: 'Privada', correcta: false, porQue: 'x' },
          { texto: 'Ninguna de las anteriores', correcta: false, porQue: 'x' },
        ],
      }),
    ]);
    // La segunda es idéntica a la primera tras normalizar: el importador ya la rechaza como duplicada exacta.
    expect(await prisma.pregunta.count()).toBe(3);

    const r = await analizar();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ embebidas: 3, duplicadas: 1, validadas: 1, conAlertas: 1 });

    const original = await porEnunciado('¿Cuál es el plazo');
    const parecida = await porEnunciado('Cuál es el plazo');
    expect(original.estado).toBe('VALIDADA');
    expect(parecida).toMatchObject({ estado: 'DUPLICADA', duplicadaDeId: original.id });

    const bandeja = await request(app).get('/api/v1/admin/revision?estado=DUPLICADA').set(auth());
    expect(bandeja.body.items[0].duplicadaDe).toMatchObject({ id: original.id, similitud: expect.any(Number) });
    const borradores = await request(app).get('/api/v1/admin/revision?estado=BORRADOR').set(auth());
    expect(borradores.body.items[0].alertas).toContain('Usa "todas/ninguna de las anteriores"');

    // Aprobar todas las VALIDADA no toca la que tiene alertas ni la duplicada.
    const ap = await request(app).post('/api/v1/admin/preguntas/aprobar-todas').set(auth()).send({ estado: 'VALIDADA' });
    expect(ap.body.aprobadas).toBe(1);

    // Corregir la defectuosa la saca de la validación; el siguiente análisis la valida.
    const mala = await porEnunciado('¿Qué principio');
    await request(app)
      .patch(`/api/v1/admin/preguntas/${mala.id}`)
      .set(auth())
      .send({
        opciones: [
          { texto: 'Universal', correcta: true, porQue: 'Art. 1' },
          { texto: 'Selectiva', correcta: false, porQue: 'x' },
          { texto: 'Privada', correcta: false, porQue: 'x' },
          { texto: 'Optativa', correcta: false, porQue: 'x' },
        ],
      });
    expect((await prisma.pregunta.findUniqueOrThrow({ where: { id: mala.id } })).validadoEn).toBeNull();
    expect((await analizar()).body).toMatchObject({ embebidas: 1, validadas: 1, conAlertas: 0 });
    expect((await prisma.pregunta.findUniqueOrThrow({ where: { id: mala.id } })).estado).toBe('VALIDADA');

    // Restaurar la duplicada la desliga de su original.
    await request(app).patch(`/api/v1/admin/preguntas/${parecida.id}`).set(auth()).send({ estado: 'BORRADOR' });
    expect((await prisma.pregunta.findUniqueOrThrow({ where: { id: parecida.id } })).duplicadaDeId).toBeNull();

    const resumen = await request(app).get('/api/v1/admin/calidad').set(auth());
    expect(resumen.body).toMatchObject({ porEstado: { APROBADA: 1, VALIDADA: 1, BORRADOR: 1 }, ciegoDisponible: false });
  });

  it('el pase a ciegas marca las que la IA resuelve distinto o ve ambiguas', async () => {
    process.env.ANTHROPIC_API_KEY = 'clave-de-prueba';
    const vistas: string[] = [];
    fijarResolutorCiego(async (p) => {
      vistas.push(p.enunciado);
      return p.enunciado.includes('ambigua')
        ? { respuesta: 'A', ambigua: true, motivo: 'A y B valen según el Art. 3' }
        : p.enunciado.includes('errada')
          ? { respuesta: 'C', ambigua: false, motivo: 'El Art. 5 dice otra cosa' }
          : { respuesta: 'A', ambigua: false, motivo: 'Art. 1' };
    });
    await importar([
      preguntaValida('Esta pregunta está bien hecha, ¿cuál es la correcta?'),
      preguntaValida('Esta pregunta tiene la respuesta errada, ¿cuál es?'),
      preguntaValida('Esta pregunta es ambigua según la norma, ¿cuál es?'),
    ]);
    const r = await analizar({ ciego: true });
    expect(r.body).toMatchObject({ ciegas: 3, ciegasFallidas: 2, validadas: 1, conAlertas: 2 });
    const errada = await porEnunciado('Esta pregunta tiene');
    expect(errada.estado).toBe('BORRADOR');
    expect(errada.alertas[0]).toBe('A ciegas, la IA eligió la opción C: El Art. 5 dice otra cosa');
    expect(errada.ciega).toMatchObject({ coincide: false, modelo: expect.any(String) });

    // No vuelve a gastar en las ya resueltas.
    await analizar({ ciego: true, todas: true });
    expect(vistas).toHaveLength(3);
  });

  it('lista pares de aprobadas muy parecidas', async () => {
    await importar([
      preguntaValida('¿Quién designa al director de un CEA fiscal?'),
      preguntaValida('Quién designa al director de un CEA fiscal'),
      preguntaValida('¿Cuántas horas tiene un módulo de formación técnica?'),
    ]);
    await prisma.pregunta.updateMany({ data: { estado: 'APROBADA' } });
    await analizar();
    const r = await request(app).get('/api/v1/admin/calidad/similares?umbral=0.95').set(auth());
    expect(r.body).toHaveLength(1);
    expect(r.body[0]).toMatchObject({ contenido: 'Ley 070', similitud: 1 });
    expect([r.body[0].a.enunciado, r.body[0].b.enunciado].sort()).toEqual(
      ['¿Quién designa al director de un CEA fiscal?', 'Quién designa al director de un CEA fiscal'].sort(),
    );
  });
});

describe('Estadísticas de preguntas rotas', () => {
  it('señala las dificilísimas y las regaladas con suficientes respuestas', async () => {
    await importar([
      preguntaValida('¿Pregunta que casi nadie acierta?'),
      preguntaValida('¿Pregunta que todos aciertan?'),
      preguntaValida('¿Pregunta normal?'),
      preguntaValida('¿Pregunta con pocas respuestas?'),
    ]);
    await prisma.pregunta.updateMany({ data: { estado: 'APROBADA' } });
    const set = (inicio: string, respondida: number, acertada: number) =>
      prisma.pregunta.updateMany({
        where: { enunciado: { startsWith: inicio } },
        data: { vecesRespondida: respondida, vecesAcertada: acertada },
      });
    await set('¿Pregunta que casi', 20, 2);
    await set('¿Pregunta que todos', 20, 20);
    await set('¿Pregunta normal', 20, 12);
    await set('¿Pregunta con pocas', 2, 0);

    const r = await request(app).get('/api/v1/admin/estadisticas/preguntas?minRespuestas=5').set(auth());
    expect(r.body.evaluadas).toBe(3);
    expect(r.body.rotas.map((p: { problema: string; acierto: number }) => [p.problema, p.acierto])).toEqual([
      ['DIFICILISIMA', 10],
      ['REGALADA', 100],
    ]);
    expect(r.body.rotas[0].opciones).toHaveLength(4);
  });
});

describe('Búsqueda semántica en las fuentes', () => {
  it('pide embeddings y luego encuentra el fragmento más cercano', async () => {
    const col = await prisma.coleccion.create({ data: { nombre: 'Normas' } });
    const c = await prisma.contenido.create({ data: { titulo: 'Ley 070', coleccionId: col.id, tipoFuente: 'LEY' } });
    const d = await prisma.documento.create({
      data: { contenidoId: c.id, nombreArchivo: 'ley.pdf', archivoUrl: 'x', hash: 'h1', estado: 'FRAGMENTADO' },
    });
    await prisma.fragmento.createMany({
      data: [
        { documentoId: d.id, ref: 'ley070-art01', etiqueta: 'Art. 1', texto: 'La educación es universal, gratuita y obligatoria.', paginaDesde: 1, paginaHasta: 1 },
        { documentoId: d.id, ref: 'ley070-art22', etiqueta: 'Art. 22', texto: 'Las áreas de la Educación Alternativa son la de jóvenes y adultos y la permanente.', paginaDesde: 9, paginaHasta: 9 },
      ],
    });
    const buscar = (q: string) => request(app).get(`/api/v1/admin/fragmentos/buscar?q=${encodeURIComponent(q)}`).set(auth());
    expect((await buscar('educación alternativa')).status).toBe(409);

    await embeberPendientes({ fragmentos: true });
    const r = await buscar('áreas de la educación alternativa');
    expect(r.status).toBe(200);
    expect(r.body[0]).toMatchObject({ ref: 'ley070-art22', contenido: 'Ley 070', paginaDesde: 9 });
    expect((await buscar('ab')).status).toBe(400);
  });
});

describe('Reportes de estudiantes', () => {
  it('un estudiante reporta; el admin los lista y los resuelve', async () => {
    await importar([preguntaValida('¿Pregunta reportada?')]);
    const p = await porEnunciado('¿Pregunta reportada');
    const estudiante = await tokenDe('ESTUDIANTE');

    const r = await request(app)
      .post(`/api/v1/preguntas/${p.id}/reportes`)
      .set(auth(estudiante))
      .send({ motivo: 'AMBIGUA', comentario: 'B también es correcta' });
    expect(r.status).toBe(201);
    expect((await request(app).post(`/api/v1/preguntas/${p.id}/reportes`).set(auth(estudiante)).send({ motivo: 'X' })).status).toBe(400);
    expect((await request(app).post('/api/v1/preguntas/no-existe/reportes').set(auth(estudiante)).send({ motivo: 'OTRO' })).status).toBe(404);
    expect((await request(app).get('/api/v1/admin/reportes').set(auth(estudiante))).status).toBe(403);

    const abiertos = await request(app).get('/api/v1/admin/reportes').set(auth());
    expect(abiertos.body).toHaveLength(1);
    expect(abiertos.body[0]).toMatchObject({ motivo: 'AMBIGUA', comentario: 'B también es correcta', pregunta: { id: p.id, correcta: 'Correcta' } });
    expect((await request(app).get(`/api/v1/admin/preguntas/${p.id}`).set(auth())).body.reportesAbiertos).toBe(1);

    await request(app).patch(`/api/v1/admin/reportes/${r.body.id}`).set(auth()).send({ resuelto: true });
    expect((await request(app).get('/api/v1/admin/reportes').set(auth())).body).toHaveLength(0);
    expect((await request(app).get('/api/v1/admin/reportes?resuelto=true').set(auth())).body).toHaveLength(1);
  });
});
