import { useState, type FormEvent } from 'react';
import { mensajeDeError } from '../api/cliente';
import { useSesion } from '../auth/sesion';
import { SelectorTema } from '../componentes/SelectorTema';

export function Login() {
  const { iniciar } = useSesion();
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await iniciar({ usuario: usuario.trim(), password });
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <div className="absolute right-4 top-4">
        <SelectorTema />
      </div>
      <form onSubmit={enviar} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-lg">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-indigo-700">EstudIA</h1>
          <p className="text-sm text-slate-500">Estudio intensivo para exámenes de ascenso</p>
        </div>
        <div>
          <label htmlFor="usuario" className="etiqueta">
            Usuario
          </label>
          <input
            id="usuario"
            className="campo"
            autoComplete="username"
            autoFocus
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="password" className="etiqueta">
            Contraseña
          </label>
          <input
            id="password"
            type="password"
            className="campo"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button type="submit" className="btn-primario w-full" disabled={enviando}>
          {enviando ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </div>
  );
}
