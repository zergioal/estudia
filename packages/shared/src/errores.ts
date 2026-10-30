/** Formato único de error de la API: { error: { codigo, mensaje, detalles? } } */
export interface ErrorApi {
  error: {
    codigo: string;
    mensaje: string;
    detalles?: unknown;
  };
}
