import { useEffect, useState } from 'react';
import { useSesion } from './auth/sesion';
import { Contenidos } from './paginas/Contenidos';
import { Login } from './paginas/Login';
import { Revision } from './paginas/Revision';

const PAGINAS = {
  contenidos: { titulo: 'Contenidos', componente: Contenidos },
  revision: { titulo: 'Revisión', componente: Revision },
} as const;
type Pagina = keyof typeof PAGINAS;

function paginaDelHash(): Pagina {
  const h = window.location.hash.replace('#/', '');
  return h in PAGINAS ? (h as Pagina) : 'contenidos';
}

export function App() {
  const { usuario, cargando, cerrar } = useSesion();
  const [pagina, setPagina] = useState<Pagina>(paginaDelHash);

  useEffect(() => {
    const alCambiar = () => setPagina(paginaDelHash());
    window.addEventListener('hashchange', alCambiar);
    return () => window.removeEventListener('hashchange', alCambiar);
  }, []);

  if (cargando) return <p className="p-6 text-center text-slate-500">Cargando…</p>;
  if (!usuario) return <Login />;

  const esStaff = usuario.rol === 'ADMIN' || usuario.rol === 'REVISOR';
  const visibles = (Object.keys(PAGINAS) as Pagina[]).filter((p) => usuario.rol === 'ADMIN' || p === 'revision');
  const actual = visibles.includes(pagina) ? pagina : visibles[0];
  const Componente = actual ? PAGINAS[actual].componente : null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <span className="text-lg font-bold text-indigo-700">EstudIA</span>
          <nav className="flex gap-1">
            {visibles.map((p) => (
              <a
                key={p}
                href={`#/${p}`}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  p === actual ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {PAGINAS[p].titulo}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className="hidden text-slate-500 sm:inline">
              {usuario.nombre} · {usuario.rol}
            </span>
            <button className="btn-secundario py-1.5" onClick={cerrar}>
              Salir
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        {esStaff && Componente ? (
          <Componente />
        ) : (
          <p className="rounded-lg bg-white p-6 text-center text-slate-600 shadow-sm">
            Hola, {usuario.nombre}. Los quizzes llegan en el Hito 2.
          </p>
        )}
      </main>
    </div>
  );
}
