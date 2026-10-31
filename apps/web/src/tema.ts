import { useEffect, useState } from 'react';

/** Preferencia guardada: claro, oscuro o la del sistema operativo. */
export type PreferenciaTema = 'claro' | 'oscuro' | 'sistema';
const CLAVE = 'estudia.tema';
const consulta = () => window.matchMedia('(prefers-color-scheme: dark)');

export const leerPreferencia = (): PreferenciaTema => {
  const v = localStorage.getItem(CLAVE);
  return v === 'claro' || v === 'oscuro' ? v : 'sistema';
};

/** Pone o quita la clase .dark en <html> (index.html hace lo mismo antes de cargar React, sin parpadeo). */
export function aplicarTema(p: PreferenciaTema) {
  const oscuro = p === 'oscuro' || (p === 'sistema' && consulta().matches);
  document.documentElement.classList.toggle('dark', oscuro);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', oscuro ? '#0d1424' : '#4f46e5');
}

export function useTema() {
  const [preferencia, setPreferencia] = useState<PreferenciaTema>(leerPreferencia);
  useEffect(() => {
    aplicarTema(preferencia);
    if (preferencia === 'sistema') localStorage.removeItem(CLAVE);
    else localStorage.setItem(CLAVE, preferencia);
    if (preferencia !== 'sistema') return;
    // Siguiendo al sistema: si cambia mientras la app está abierta, se actualiza sola.
    const mq = consulta();
    const alCambiar = () => aplicarTema('sistema');
    mq.addEventListener('change', alCambiar);
    return () => mq.removeEventListener('change', alCambiar);
  }, [preferencia]);
  return { preferencia, setPreferencia };
}
