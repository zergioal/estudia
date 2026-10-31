import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DominioContenido, ErrorCuaderno, Progreso as DatosProgreso } from '@estudia/shared';
import { api, mensajeDeError } from '../api/cliente';
import { useCrearQuiz } from '../componentes/useCrearQuiz';

/** Color según dominio: rojo < 30 %, ámbar < 60 %, verde ≥ 60 % (el umbral de "tema débil" del diseño). */
const colorDominio = (pct: number) => (pct >= 60 ? 'bg-emerald-500' : pct >= 30 ? 'bg-amber-500' : 'bg-red-500');
const fondoDominio = (pct: number, vistas: number) =>
  vistas === 0 ? 'bg-slate-100 text-slate-500' : pct >= 60 ? 'bg-emerald-100 text-emerald-800' : pct >= 30 ? 'bg-amber-100 text-amber-900' : 'bg-red-100 text-red-800';

export function Progreso() {
  const progreso = useQuery({ queryKey: ['progreso'], queryFn: () => api<DatosProgreso>('/me/progreso') });
  const p = progreso.data;

  return (
    <section className="space-y-5">
      <div className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
        <h1 className="text-lg font-semibold">Mi progreso</h1>
        <p className="text-sm text-slate-600">
          Una pregunta está <b>dominada</b> cuando la respondiste bien varias veces espaciadas y su próximo repaso queda a 7 días o más.
        </p>
        {progreso.error && <p className="mt-2 text-sm text-red-700">{mensajeDeError(progreso.error)}</p>}
        {p && (
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <Cifra titulo="Dominio general" valor={`${p.dominio}%`} />
            <Cifra titulo="Preguntas vistas" valor={`${p.vistas}/${p.total}`} />
            <Cifra titulo="Dominadas" valor={p.dominadas} />
          </div>
        )}
      </div>

      {p && (
        <div className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
          <h2 className="mb-1 font-semibold">Dominio por documento</h2>
          <p className="mb-3 text-xs text-slate-500">Toca un documento para ver sus temas, del más débil al más fuerte.</p>
          <ul className="space-y-2">
            {p.contenidos.map((c) => (
              <FilaDocumento key={c.contenidoId} c={c} />
            ))}
          </ul>
        </div>
      )}

      <CuadernoErrores contenidos={p?.contenidos ?? []} />
    </section>
  );
}

function Cifra({ titulo, valor }: { titulo: string; valor: string | number }) {
  return (
    <div className="rounded-xl bg-slate-100 p-3">
      <p className="text-xs text-slate-500">{titulo}</p>
      <p className="text-xl font-semibold text-indigo-700">{valor}</p>
    </div>
  );
}

function FilaDocumento({ c }: { c: DominioContenido }) {
  const [abierto, setAbierto] = useState(false);
  const practicar = useCrearQuiz();
  return (
    <li className="rounded-xl border border-slate-200">
      <button className="w-full p-3 text-left" onClick={() => setAbierto(!abierto)} aria-expanded={abierto}>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-400">{abierto ? '▾' : '▸'}</span>
          <span className="min-w-0 flex-1 truncate font-medium">{c.titulo}</span>
          <span className="shrink-0 text-xs text-slate-500">
            {c.vistas}/{c.total} vistas{c.acierto !== null && ` · ${c.acierto}% acierto`}
          </span>
          <span className="w-10 shrink-0 text-right font-semibold">{c.dominio}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
          <div className={`h-full ${colorDominio(c.dominio)}`} style={{ width: `${Math.max(c.dominio, c.dominadas ? 2 : 0)}%` }} />
        </div>
      </button>
      {abierto && (
        <div className="border-t border-slate-100 p-3">
          <div className="flex flex-wrap gap-1.5">
            {c.temas.map((t) => (
              <span
                key={t.temaId}
                title={`${t.nombre}: ${t.dominadas}/${t.total} dominadas, ${t.vistas} vistas`}
                className={`rounded-lg px-2 py-1 text-xs ${fondoDominio(t.dominio, t.vistas)}`}
              >
                {t.nombre.length > 48 ? `${t.nombre.slice(0, 46)}…` : t.nombre} · {t.vistas === 0 ? 'sin ver' : `${t.dominio}%`}
              </span>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="btn-primario py-1.5"
              disabled={practicar.isPending}
              onClick={() => practicar.mutate({ modo: 'PRACTICA', contenidoIds: [c.contenidoId], cantidad: 20 })}
            >
              Practicar 20 de este documento
            </button>
            <a className="btn-secundario py-1.5" href={`#/guias/${c.contenidoId}`}>
              Ver guía
            </a>
          </div>
        </div>
      )}
    </li>
  );
}

function CuadernoErrores({ contenidos }: { contenidos: DominioContenido[] }) {
  const [filtro, setFiltro] = useState('');
  const errores = useQuery({
    queryKey: ['errores', filtro],
    queryFn: () => api<ErrorCuaderno[]>(`/me/errores${filtro ? `?contenidoId=${filtro}` : ''}`),
  });
  const repasar = useCrearQuiz();
  const lista = errores.data ?? [];
  const cantidad = lista.length > 50 ? 100 : lista.length > 20 ? 50 : lista.length > 10 ? 20 : 10;

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-semibold">Cuaderno de errores ({lista.length})</h2>
        <select className="campo w-auto py-1.5" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar por documento">
          <option value="">Todos los documentos</option>
          {contenidos.map((c) => (
            <option key={c.contenidoId} value={c.contenidoId}>
              {c.titulo}
            </option>
          ))}
        </select>
        <button
          className="btn-primario py-1.5"
          disabled={lista.length === 0 || repasar.isPending}
          onClick={() =>
            repasar.mutate({
              modo: 'REPASO_ERRORES',
              contenidoIds: filtro ? [filtro] : [],
              cantidad,
            })
          }
        >
          {repasar.isPending ? 'Armando…' : `Repasar ${Math.min(cantidad, lista.length)}`}
        </button>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Preguntas que fallaste y todavía no dominas. Salen del cuaderno cuando las aciertas varias veces espaciadas.
      </p>
      {errores.isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
      {errores.error && <p className="text-sm text-red-700">{mensajeDeError(errores.error)}</p>}
      {!errores.isLoading && lista.length === 0 && <p className="text-sm text-slate-500">¡No tienes errores pendientes! 🎉</p>}
      <ul className="max-h-[32rem] space-y-2 overflow-y-auto pr-1">
        {lista.map((e) => (
          <li key={e.preguntaId} className="rounded-xl border border-slate-200 p-3 text-sm">
            <div className="mb-1 flex flex-wrap gap-2 text-xs text-slate-500">
              <span className="truncate">{e.contenido}</span>
              <span className="ml-auto shrink-0 rounded bg-red-50 px-1.5 text-red-700">
                ✗ {e.fallos} {e.fallos === 1 ? 'vez' : 'veces'}
              </span>
              {e.aciertos > 0 && <span className="shrink-0 rounded bg-emerald-50 px-1.5 text-emerald-700">✓ {e.aciertos}</span>}
            </div>
            <p className="font-medium">{e.enunciado}</p>
            <p className="mt-1 text-emerald-700">✓ {e.correctas.join('; ')}</p>
            <p className="text-xs text-slate-500">{e.referencia}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
