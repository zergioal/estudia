import { Router } from 'express';
import { requiereRol } from '../../middleware/auth';
import { aprobarLoteSchema, aprobarTodasSchema, preguntaEditarSchema, revisionFiltroSchema } from './esquemas';
import * as servicio from './servicio';

/** Montado en /api/v1/admin */
export const rutasPreguntas = Router();

rutasPreguntas.post('/preguntas/importar', requiereRol('ADMIN'), async (req, res) => {
  res.status(201).json(await servicio.importarLote(req.body, 'MANUAL'));
});

rutasPreguntas.get('/revision', requiereRol('ADMIN', 'REVISOR'), async (req, res) => {
  res.json(await servicio.listarRevision(revisionFiltroSchema.parse(req.query)));
});

rutasPreguntas.get('/preguntas/:id', requiereRol('ADMIN', 'REVISOR'), async (req, res) => {
  res.json(await servicio.obtenerPregunta(req.params.id));
});

rutasPreguntas.patch('/preguntas/:id', requiereRol('ADMIN', 'REVISOR'), async (req, res) => {
  res.json(await servicio.editarPregunta(req.params.id, preguntaEditarSchema.parse(req.body)));
});

rutasPreguntas.post('/preguntas/aprobar-lote', requiereRol('ADMIN', 'REVISOR'), async (req, res) => {
  const { ids } = aprobarLoteSchema.parse(req.body);
  res.json(await servicio.aprobarLote(ids));
});

rutasPreguntas.post('/preguntas/aprobar-todas', requiereRol('ADMIN', 'REVISOR'), async (req, res) => {
  res.json(await servicio.aprobarTodas(aprobarTodasSchema.parse(req.body ?? {})));
});
