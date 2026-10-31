import { Router } from 'express';
import { requiereAuth, requiereRol } from '../../middleware/auth';
import { guiaContenidoSchema } from './esquemas';
import * as servicio from './servicio';

/** Montado en /api/v1. Leer guías: cualquier usuario autenticado (solo de los documentos que ve). */
export const rutasGuias = Router();

rutasGuias.get('/guias', requiereAuth, async (req, res) => {
  res.json(await servicio.listar(req.usuario!));
});

rutasGuias.get('/guias/:contenidoId', requiereAuth, async (req, res) => {
  res.json(await servicio.obtener(req.usuario!, req.params.contenidoId));
});

rutasGuias.put('/admin/guias/:contenidoId', requiereRol('ADMIN'), async (req, res) => {
  await servicio.guardar(req.params.contenidoId, guiaContenidoSchema.parse(req.body));
  res.json(await servicio.obtener(req.usuario!, req.params.contenidoId));
});
