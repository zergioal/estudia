import cors from 'cors';
import express from 'express';
import { config } from './config';
import { manejadorErrores, rutaNoEncontrada } from './errores';
import { rutasAuth } from './modulos/auth/rutas';
import { rutasContenidos } from './modulos/contenidos/rutas';
import { rutasPreguntas } from './modulos/preguntas/rutas';

export function crearApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.corsOrigen }));
  app.use(express.json({ limit: '5mb' }));

  const v1 = express.Router();
  v1.get('/salud', (_req, res) => {
    res.json({ ok: true });
  });
  v1.use('/auth', rutasAuth);
  // Preguntas antes que contenidos: rutasContenidos aplica requiereRol('ADMIN') a todo lo que recibe,
  // y la revisión también admite REVISOR.
  v1.use('/admin', rutasPreguntas);
  v1.use('/admin', rutasContenidos);

  app.use('/api/v1', v1);
  app.use(rutaNoEncontrada);
  app.use(manejadorErrores);
  return app;
}
