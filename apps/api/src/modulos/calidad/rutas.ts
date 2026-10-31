import { Router } from 'express';
import { requiereAuth, requiereRol } from '../../middleware/auth';
import {
  analizarSchema,
  buscarFragmentosSchema,
  estadisticasFiltroSchema,
  reporteCrearSchema,
  reporteResolverSchema,
  reportesFiltroSchema,
  similaresFiltroSchema,
} from './esquemas';
import * as servicio from './servicio';

/** Montado en /api/v1. */
export const rutasCalidad = Router();

// Cualquier usuario puede reportar una pregunta que le salió en un quiz.
rutasCalidad.post('/preguntas/:id/reportes', requiereAuth, async (req, res) => {
  res.status(201).json(await servicio.reportar(req.usuario!.id, req.params.id, reporteCrearSchema.parse(req.body)));
});

const revisores = requiereRol('ADMIN', 'REVISOR');

rutasCalidad.get('/admin/calidad', revisores, async (_req, res) => {
  res.json(await servicio.resumen());
});

rutasCalidad.post('/admin/calidad/analizar', requiereRol('ADMIN'), async (req, res) => {
  res.json(await servicio.analizar(analizarSchema.parse(req.body ?? {})));
});

rutasCalidad.get('/admin/calidad/similares', revisores, async (req, res) => {
  res.json(await servicio.similares(similaresFiltroSchema.parse(req.query)));
});

rutasCalidad.get('/admin/estadisticas/preguntas', revisores, async (req, res) => {
  res.json(await servicio.estadisticas(estadisticasFiltroSchema.parse(req.query)));
});

rutasCalidad.get('/admin/fragmentos/buscar', revisores, async (req, res) => {
  res.json(await servicio.buscarFragmentos(buscarFragmentosSchema.parse(req.query)));
});

rutasCalidad.get('/admin/reportes', revisores, async (req, res) => {
  res.json(await servicio.listarReportes(reportesFiltroSchema.parse(req.query).resuelto));
});

rutasCalidad.patch('/admin/reportes/:id', revisores, async (req, res) => {
  res.json(await servicio.resolverReporte(req.params.id, reporteResolverSchema.parse(req.body).resuelto));
});
