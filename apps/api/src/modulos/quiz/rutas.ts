import { Router } from 'express';
import { requiereAuth } from '../../middleware/auth';
import { quizCrearSchema, respuestaEnviarSchema } from './esquemas';
import * as servicio from './servicio';

/** Montado en /api/v1. Cualquier usuario autenticado estudia; cada quien solo ve sus intentos. */
export const rutasQuiz = Router();

rutasQuiz.get('/me/panel', requiereAuth, async (req, res) => {
  res.json(await servicio.panel(req.usuario!));
});

rutasQuiz.get('/me/estudio', requiereAuth, async (req, res) => {
  res.json(await servicio.arbolEstudio(req.usuario!));
});

rutasQuiz.post('/quizzes', requiereAuth, async (req, res) => {
  res.status(201).json(await servicio.crearQuiz(req.usuario!, quizCrearSchema.parse(req.body)));
});

rutasQuiz.get('/quizzes/:id', requiereAuth, async (req, res) => {
  res.json(await servicio.obtenerQuiz(req.usuario!, req.params.id));
});

rutasQuiz.post('/quizzes/:id/respuestas', requiereAuth, async (req, res) => {
  res.json(await servicio.responder(req.usuario!, req.params.id, respuestaEnviarSchema.parse(req.body)));
});

rutasQuiz.post('/quizzes/:id/finalizar', requiereAuth, async (req, res) => {
  res.json(await servicio.finalizar(req.usuario!, req.params.id));
});

rutasQuiz.get('/quizzes/:id/resumen', requiereAuth, async (req, res) => {
  res.json(await servicio.resumen(req.usuario!, req.params.id));
});
