import { Router } from 'express';
import { requiereRol } from '../../middleware/auth';
import {
  coleccionCrearSchema,
  coleccionEditarSchema,
  contenidoCrearSchema,
  contenidoEditarSchema,
  temaCrearSchema,
  temaEditarSchema,
} from './esquemas';
import * as servicio from './servicio';

/** Montado en /api/v1/admin */
export const rutasContenidos = Router();

rutasContenidos.use(requiereRol('ADMIN'));

rutasContenidos.get('/arbol', async (_req, res) => {
  res.json(await servicio.arbol());
});

rutasContenidos.post('/colecciones', async (req, res) => {
  res.status(201).json(await servicio.crearColeccion(coleccionCrearSchema.parse(req.body)));
});
rutasContenidos.patch('/colecciones/:id', async (req, res) => {
  res.json(await servicio.editarColeccion(req.params.id, coleccionEditarSchema.parse(req.body)));
});
rutasContenidos.delete('/colecciones/:id', async (req, res) => {
  await servicio.eliminarColeccion(req.params.id);
  res.status(204).end();
});

rutasContenidos.post('/contenidos', async (req, res) => {
  res.status(201).json(await servicio.crearContenido(contenidoCrearSchema.parse(req.body)));
});
rutasContenidos.patch('/contenidos/:id', async (req, res) => {
  res.json(await servicio.editarContenido(req.params.id, contenidoEditarSchema.parse(req.body)));
});
rutasContenidos.delete('/contenidos/:id', async (req, res) => {
  await servicio.eliminarContenido(req.params.id);
  res.status(204).end();
});

rutasContenidos.post('/temas', async (req, res) => {
  res.status(201).json(await servicio.crearTema(temaCrearSchema.parse(req.body)));
});
rutasContenidos.patch('/temas/:id', async (req, res) => {
  res.json(await servicio.editarTema(req.params.id, temaEditarSchema.parse(req.body)));
});
rutasContenidos.delete('/temas/:id', async (req, res) => {
  await servicio.eliminarTema(req.params.id);
  res.status(204).end();
});
