import type { ErrorApi } from '@estudia/shared';

const CLAVE_TOKEN = 'estudia.token';

export const almacenToken = {
  leer: () => localStorage.getItem(CLAVE_TOKEN),
  guardar: (t: string) => localStorage.setItem(CLAVE_TOKEN, t),
  borrar: () => localStorage.removeItem(CLAVE_TOKEN),
};

export class ErrorDeApi extends Error {
  constructor(
    public status: number,
    public codigo: string,
    mensaje: string,
    public detalles?: unknown,
  ) {
    super(mensaje);
  }
}

/** Se llama cuando la API responde 401 (token vencido): la sesión lo usa para cerrar sesión. */
let alNoAutenticado: (() => void) | null = null;
export const configurarAlNoAutenticado = (fn: () => void) => {
  alNoAutenticado = fn;
};

export async function api<T>(ruta: string, opciones: { metodo?: string; cuerpo?: unknown } = {}): Promise<T> {
  const token = almacenToken.leer();
  const esFormulario = opciones.cuerpo instanceof FormData;
  const res = await fetch(`/api/v1${ruta}`, {
    method: opciones.metodo ?? 'GET',
    headers: {
      // Con FormData el navegador pone el Content-Type multipart con su boundary.
      ...(opciones.cuerpo !== undefined && !esFormulario && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: esFormulario
      ? (opciones.cuerpo as FormData)
      : opciones.cuerpo !== undefined
        ? JSON.stringify(opciones.cuerpo)
        : undefined,
  });

  if (res.status === 204) return undefined as T;
  const datos = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (datos as ErrorApi | null)?.error;
    if (res.status === 401 && token) alNoAutenticado?.();
    throw new ErrorDeApi(res.status, e?.codigo ?? 'ERROR', e?.mensaje ?? `Error ${res.status}`, e?.detalles);
  }
  return datos as T;
}

/** Texto legible de un error, incluidos los detalles de validación de Zod. */
export function mensajeDeError(e: unknown): string {
  if (e instanceof ErrorDeApi) {
    if (Array.isArray(e.detalles) && e.detalles.length > 0) {
      const lineas = (e.detalles as { ruta?: string; mensaje?: string }[])
        .map((d) => (d.ruta ? `${d.ruta}: ${d.mensaje}` : d.mensaje))
        .join(' · ');
      return `${e.message} (${lineas})`;
    }
    return e.message;
  }
  return e instanceof Error ? e.message : 'Error inesperado';
}
