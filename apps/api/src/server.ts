import { crearApp } from './app';
import { config } from './config';

const puerto = config.puerto;
crearApp().listen(puerto, () => {
  console.log(`API EstudIA escuchando en http://localhost:${puerto}/api/v1`);
});
