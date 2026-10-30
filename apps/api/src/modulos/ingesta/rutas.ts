import { Router } from 'express';
import multer from 'multer';
import { config } from '../../config';
import { ErrorApp } from '../../errores';
import { requiereRol } from '../../middleware/auth';
import { encolarProcesamiento } from './cola';
import { documentoSubirSchema, documentosFiltroSchema } from './esquemas';
import { exportarContenido } from './exportar';
import * as servicio from './servicio';

/** Montado en /api/v1/admin */
export const rutasIngesta = Router();

const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxMbPdf * 1024 * 1024, files: 1 } });

rutasIngesta.post('/documentos', requiereRol('ADMIN'), subida.single('archivo'), async (req, res) => {
  if (!req.file) throw new ErrorApp(400, 'VALIDACION', 'Falta el archivo PDF (campo "archivo")');
  const { contenidoId, ocr } = documentoSubirSchema.parse(req.body);
  // multer entrega el nombre en latin1.
  const nombreArchivo = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const doc = await servicio.registrarDocumento({ contenidoId, archivo: req.file.buffer, nombreArchivo });
  await encolarProcesamiento(doc.id, ocr);
  res.status(202).json(await servicio.obtenerDocumento(doc.id));
});

rutasIngesta.get('/documentos', requiereRol('ADMIN'), async (req, res) => {
  res.json(await servicio.listarDocumentos(documentosFiltroSchema.parse(req.query)));
});

rutasIngesta.get('/documentos/:id', requiereRol('ADMIN'), async (req, res) => {
  res.json(await servicio.obtenerDocumento(req.params.id));
});

/** Vuelve a extraer (con OCR) y fragmentar. */
rutasIngesta.post('/documentos/:id/procesar', requiereRol('ADMIN'), async (req, res) => {
  await servicio.obtenerDocumento(req.params.id);
  await encolarProcesamiento(req.params.id, req.body?.ocr !== false);
  res.status(202).json(await servicio.obtenerDocumento(req.params.id));
});

/** Rehace solo los cortes a partir del texto ya extraído (rápido, sin OCR). */
rutasIngesta.post('/documentos/:id/fragmentar', requiereRol('ADMIN'), async (req, res) => {
  const doc = await servicio.obtenerDocumento(req.params.id);
  await servicio.fragmentarDocumento(req.params.id);
  await exportarContenido(doc.contenido.id);
  res.json(await servicio.obtenerDocumento(req.params.id));
});

rutasIngesta.delete('/documentos/:id', requiereRol('ADMIN'), async (req, res) => {
  await servicio.eliminarDocumento(req.params.id);
  res.status(204).end();
});

rutasIngesta.post('/contenidos/:id/exportar', requiereRol('ADMIN'), async (req, res) => {
  res.json(await exportarContenido(req.params.id));
});
