import { useMutation, useQuery } from '@tanstack/react-query';
import type { GuiaDetalle, GuiaResumida, ParteLectura, QuizCrearEntrada, QuizEstado } from '@estudia/shared';
import { api, mensajeDeError } from '../api/cliente';
import { ir } from '../navegacion';

/** Mismos bloques que el examen (Reglamento 0001/2026, Art. 11). */
const BLOQUES = [
  { nombre: 'Normativa', tipos: ['LEY', 'DECRETO', 'RM'], color: 'bg-sky-50 text-sky-800' },
  { nombre: 'Técnico-pedagógico', tipos: ['LIBRO', 'GUIA'], color: 'bg-amber-50 text-amber-800' },
];
const ETIQUETA_TIPO: Record<string, string> = { LEY: 'Ley', DECRETO: 'Decreto', RM: 'RM', LIBRO: 'Libro', GUIA: 'Guía' };

export function Guias({ id }: { id?: string }) {
  return id ? <DetalleGuia id={id} /> : <ListaGuias />;
}

function ListaGuias() {
  const guias = useQuery({ queryKey: ['guias'], queryFn: () => api<GuiaResumida[]>('/guias') });

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Guías de estudio</h1>
        <p className="text-sm text-slate-600">
          Elige un documento para ver su resumen, qué partes leer obligatoriamente y cuáles son opcionales.
        </p>
      </div>
      {guias.isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
      {guias.error && <p className="text-sm text-red-700">{mensajeDeError(guias.error)}</p>}
      {guias.data?.length === 0 && <p className="text-sm text-slate-500">No tienes documentos asignados todavía.</p>}
      {BLOQUES.map((bloque) => {
        const docs = (guias.data ?? []).filter((g) => bloque.tipos.includes(g.tipoFuente));
        if (docs.length === 0) return null;
        return (
          <div key={bloque.nombre}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {bloque.nombre} · {docs.length}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {docs.map((g) => (
                <a
                  key={g.contenidoId}
                  href={g.tieneGuia ? `#/guias/${g.contenidoId}` : undefined}
                  className={`flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition ${
                    g.tieneGuia ? 'hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md' : 'opacity-60'
                  }`}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${bloque.color}`}>
                      {ETIQUETA_TIPO[g.tipoFuente] ?? g.tipoFuente}
                    </span>
                    <span className="ml-auto text-xs text-slate-500">{g.disponibles} preguntas</span>
                  </div>
                  <p className="font-semibold leading-snug">{g.titulo}</p>
                  <p className="mt-1 line-clamp-3 flex-1 text-sm text-slate-600">{g.extracto ?? 'Guía en preparación.'}</p>
                  {g.tieneGuia && (
                    <p className="mt-3 text-xs text-slate-500">
                      <span className="font-medium text-rose-700">{g.obligatorias} obligatorias</span> ·{' '}
                      <span className="text-slate-600">{g.opcionales} opcionales</span>
                    </p>
                  )}
                </a>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function DetalleGuia({ id }: { id: string }) {
  const guia = useQuery({ queryKey: ['guia', id], queryFn: () => api<GuiaDetalle>(`/guias/${id}`) });
  const crear = useMutation({
    mutationFn: (datos: QuizCrearEntrada) => api<QuizEstado>('/quizzes', { metodo: 'POST', cuerpo: datos }),
    onSuccess: (q) => ir(`quiz/${q.id}`),
    onError: (e) => alert(mensajeDeError(e)),
  });

  if (guia.isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;
  if (guia.error || !guia.data)
    return (
      <div className="space-y-3">
        <a href="#/guias" className="text-sm text-indigo-700 hover:underline">← Todas las guías</a>
        <p className="text-sm text-red-700">{mensajeDeError(guia.error)}</p>
      </div>
    );
  const g = guia.data;
  const quiz = (cantidad: number) =>
    crear.mutate({ modo: 'PRACTICA', contenidoIds: [g.contenidoId], temaIds: [], dificultades: [], cantidad });

  return (
    <article className="space-y-5">
      <a href="#/guias" className="text-sm text-indigo-700 hover:underline">← Todas las guías</a>

      <header className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
        <p className="text-xs font-medium uppercase text-slate-500">
          {ETIQUETA_TIPO[g.tipoFuente] ?? g.tipoFuente} · {g.coleccion}
        </p>
        <h1 className="mt-1 text-xl font-bold">{g.titulo}</h1>
        <div className="mt-4 rounded-xl bg-indigo-50 p-3">
          <p className="mb-2 text-sm font-medium text-indigo-900">
            Practicar solo este documento <span className="font-normal text-indigo-700">({g.disponibles} preguntas aprobadas)</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {[10, 20, 50].map((n) => (
              <button
                key={n}
                className="btn-primario py-1.5"
                disabled={g.disponibles === 0 || crear.isPending}
                onClick={() => quiz(n)}
              >
                Quiz de {Math.min(n, g.disponibles) || n}
              </button>
            ))}
            <a className="btn-secundario py-1.5" href={`#/estudiar/${g.contenidoId}`}>
              Elegir temas o dificultad…
            </a>
          </div>
          {g.disponibles === 0 && (
            <p className="mt-2 text-xs text-indigo-800">Aún no hay preguntas aprobadas de este documento (revisa la bandeja).</p>
          )}
        </div>
      </header>

      <section className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
        <h2 className="mb-2 font-semibold">Resumen</h2>
        {g.resumen.split(/\n\s*\n/).map((p, i) => (
          <p key={i} className="mb-2 text-sm leading-relaxed text-slate-700 last:mb-0">{p}</p>
        ))}
        {g.ideasClave.length > 0 && (
          <>
            <h3 className="mb-1 mt-4 text-sm font-semibold">Ideas clave</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
              {g.ideasClave.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          </>
        )}
      </section>

      <ListaPartes
        titulo="Lectura obligatoria"
        descripcion="Lo que más se pregunta y lo que un director/a de CEA debe dominar."
        partes={g.obligatorio}
        estilo="border-rose-200 bg-rose-50/40"
        marca="bg-rose-600"
      />
      {g.opcional.length > 0 && (
        <ListaPartes
          titulo="Lectura opcional"
          descripcion="Para repasar si tienes tiempo; pesa menos en el examen."
          partes={g.opcional}
          estilo="border-slate-200 bg-white"
          marca="bg-slate-400"
        />
      )}

      {g.consejos.length > 0 && (
        <section className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
          <h2 className="mb-2 font-semibold">Consejos para el examen</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            {g.consejos.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
        </section>
      )}
    </article>
  );
}

function ListaPartes(props: { titulo: string; descripcion: string; partes: ParteLectura[]; estilo: string; marca: string }) {
  return (
    <section className={`rounded-2xl border p-4 shadow-sm sm:p-5 ${props.estilo}`}>
      <h2 className="font-semibold">
        {props.titulo} <span className="text-sm font-normal text-slate-500">· {props.partes.length}</span>
      </h2>
      <p className="mb-3 text-sm text-slate-600">{props.descripcion}</p>
      <ol className="space-y-2">
        {props.partes.map((p, i) => (
          <li key={i} className="flex gap-3 rounded-xl bg-white p-3 ring-1 ring-slate-100">
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${props.marca}`} />
            <div className="min-w-0">
              <p className="text-sm">
                <span className="font-semibold">{p.parte}</span> — {p.titulo}
              </p>
              <p className="text-sm text-slate-600">{p.porQue}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
