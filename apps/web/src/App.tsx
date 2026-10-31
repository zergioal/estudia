import { useEffect, useState } from 'react';
import type { Rol } from '@estudia/shared';
import { useSesion } from './auth/sesion';
import { SelectorTema } from './componentes/SelectorTema';
import { Contenidos } from './paginas/Contenidos';
import { Documentos } from './paginas/Documentos';
import { Estudiar } from './paginas/Estudiar';
import { Guias } from './paginas/Guias';
import { Login } from './paginas/Login';
import { Quiz } from './paginas/Quiz';
import { Resultado } from './paginas/Resultado';
import { Revision } from './paginas/Revision';
import { Simulacro } from './paginas/Simulacro';

const PAGINAS = {
  estudiar: { titulo: 'Estudiar', roles: ['ADMIN', 'REVISOR', 'ESTUDIANTE'] },
  simulacro: { titulo: 'Examen simulacro', roles: ['ADMIN', 'REVISOR', 'ESTUDIANTE'] },
  guias: { titulo: 'Guías', roles: ['ADMIN', 'REVISOR', 'ESTUDIANTE'] },
  contenidos: { titulo: 'Contenidos', roles: ['ADMIN'] },
  documentos: { titulo: 'Documentos', roles: ['ADMIN'] },
  revision: { titulo: 'Revisión', roles: ['ADMIN', 'REVISOR'] },
} satisfies Record<string, { titulo: string; roles: Rol[] }>;
type Pagina = keyof typeof PAGINAS;

/** "#/quiz/abc" → { ruta: 'quiz', id: 'abc' } */
function leerHash() {
  const [ruta = '', id] = window.location.hash.replace(/^#\/?/, '').split('/');
  return { ruta, id };
}

export function App() {
  const { usuario, cargando, cerrar } = useSesion();
  const [hash, setHash] = useState(leerHash);

  useEffect(() => {
    const alCambiar = () => {
      setHash(leerHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', alCambiar);
    return () => window.removeEventListener('hashchange', alCambiar);
  }, []);

  if (cargando) return <p className="p-6 text-center text-slate-500">Cargando…</p>;
  if (!usuario) return <Login />;

  const visibles = (Object.keys(PAGINAS) as Pagina[]).filter((p) => (PAGINAS[p].roles as Rol[]).includes(usuario.rol));
  const enQuiz = hash.ruta === 'quiz' || hash.ruta === 'resultado';
  const actual: Pagina = enQuiz ? 'estudiar' : visibles.includes(hash.ruta as Pagina) ? (hash.ruta as Pagina) : 'estudiar';

  let contenido;
  if (hash.ruta === 'quiz' && hash.id) contenido = <Quiz id={hash.id} />;
  else if (hash.ruta === 'resultado' && hash.id) contenido = <Resultado id={hash.id} />;
  else if (actual === 'simulacro') contenido = <Simulacro id={hash.id} />;
  else if (actual === 'guias') contenido = <Guias id={hash.id} />;
  else if (actual === 'contenidos') contenido = <Contenidos />;
  else if (actual === 'documentos') contenido = <Documentos />;
  else if (actual === 'revision') contenido = <Revision />;
  else contenido = <Estudiar key={hash.id ?? ''} preseleccion={hash.ruta === 'estudiar' ? hash.id : undefined} />;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <span className="text-lg font-bold text-indigo-700">EstudIA</span>
          <nav className="flex gap-1 overflow-x-auto">
            {visibles.map((p) => (
              <a
                key={p}
                href={`#/${p}`}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ${
                  p === actual ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {PAGINAS[p].titulo}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <SelectorTema />
            <span className="hidden text-slate-500 sm:inline">
              {usuario.nombre} · {usuario.rol}
            </span>
            <button className="btn-secundario py-1.5" onClick={cerrar}>
              Salir
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{contenido}</main>
    </div>
  );
}
