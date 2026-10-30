import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LoginEntrada, LoginRespuesta, UsuarioPublico } from '@estudia/shared';
import { almacenToken, api, configurarAlNoAutenticado } from '../api/cliente';

interface Sesion {
  usuario: UsuarioPublico | null;
  cargando: boolean;
  iniciar: (datos: LoginEntrada) => Promise<void>;
  cerrar: () => void;
}

const ContextoSesion = createContext<Sesion | null>(null);

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const cliente = useQueryClient();
  const [usuario, setUsuario] = useState<UsuarioPublico | null>(null);
  const [cargando, setCargando] = useState(() => Boolean(almacenToken.leer()));

  const cerrar = useCallback(() => {
    almacenToken.borrar();
    setUsuario(null);
    cliente.clear();
  }, [cliente]);

  useEffect(() => {
    configurarAlNoAutenticado(cerrar);
    if (!almacenToken.leer()) return;
    api<UsuarioPublico>('/auth/yo')
      .then(setUsuario)
      .catch(cerrar)
      .finally(() => setCargando(false));
  }, [cerrar]);

  const iniciar = useCallback(async (datos: LoginEntrada) => {
    const r = await api<LoginRespuesta>('/auth/login', { metodo: 'POST', cuerpo: datos });
    almacenToken.guardar(r.token);
    setUsuario(r.usuario);
  }, []);

  const valor = useMemo(() => ({ usuario, cargando, iniciar, cerrar }), [usuario, cargando, iniciar, cerrar]);
  return <ContextoSesion.Provider value={valor}>{children}</ContextoSesion.Provider>;
}

export function useSesion() {
  const s = useContext(ContextoSesion);
  if (!s) throw new Error('useSesion debe usarse dentro de ProveedorSesion');
  return s;
}
