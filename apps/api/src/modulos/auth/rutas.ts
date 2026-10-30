import { Router } from 'express';
import { requiereAuth } from '../../middleware/auth';
import { loginEntradaSchema } from './esquemas';
import * as servicio from './servicio';

export const rutasAuth = Router();

rutasAuth.post('/login', async (req, res) => {
  const datos = loginEntradaSchema.parse(req.body);
  res.json(await servicio.login(datos));
});

rutasAuth.get('/yo', requiereAuth, async (req, res) => {
  res.json(await servicio.obtenerUsuario(req.usuario!.id));
});
