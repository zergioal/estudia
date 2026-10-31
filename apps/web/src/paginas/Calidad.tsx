import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  NOMBRE_MOTIVO,
  type EstadisticasPreguntas,
  type FragmentoEncontrado,
  type ParSimilar,
  type PreguntaBreve,
  type ReporteAdmin,
  type ResultadoAnalisis,
  type ResumenCalidad,
} from '@estudia/shared';
import { api, mensajeDeError } from '../api/cliente';
import { useSesion } from '../auth/sesion';

const PROBLEMA = {
  DIFICILISIMA: { texto: 'Casi nadie acierta: ¿respuesta errada o ambigua?', color: 'bg-red-50 text-red-800' },
  DISTRACTOR_ATRACTIVO: { texto: 'Un distractor gana a la correcta', color: 'bg-amber-50 text-amber-900' },
  REGALADA: { texto: 'Todos aciertan: ¿la correcta se delata?', color: 'bg-sky-50 text-sky-800' },
} as const;

export function Calidad() {
  return (
    <section className="space-y-5">
      <Resumen />
      <Reportes />
      <Rotas />
      <Similares />
      <BuscarFuentes />
    </section>
  );
}

function Caja({ titulo, descripcion, children, acciones }: { titulo: string; descripcion?: string; children: React.ReactNode; acciones?: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h2 className="font-semibold">{titulo}</h2>
          {descripcion && <p className="text-xs text-slate-500">{descripcion}</p>}
        </div>
        {acciones}
      </div>
      {children}
    </div>
  );
}

function Resumen() {
  const { usuario } = useSesion();
  const cliente = useQueryClient();
  const [ciego, setCiego] = useState(false);
  const r = useQuery({ queryKey: ['calidad', 'resumen'], queryFn: () => api<ResumenCalidad>('/admin/calidad') });
  const analizar = useMutation({
    mutationFn: () => api<ResultadoAnalisis>('/admin/calidad/analizar', { metodo: 'POST', cuerpo: { ciego } }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['calidad'] });
      cliente.invalidateQueries({ queryKey: ['revision'] });
    },
    onError: (e) => alert(mensajeDeError(e)),
  });
  const d = r.data;
  const n = (e: string) => d?.porEstado[e] ?? 0;

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
      <h1 className="text-lg font-semibold">Calidad del banco</h1>
      <p className="text-sm text-slate-600">
        Cada pregunta nueva pasa por reglas automáticas (cita, largo de opciones, negaciones, "todas las anteriores"…) y por
        una comparación semántica que detecta duplicados aunque estén redactados distinto.
      </p>
      {r.error && <p className="mt-2 text-sm text-red-700">{mensajeDeError(r.error)}</p>}
      {d && (
        <div className="mt-4 grid grid-cols-2 gap-2 text-center sm:grid-cols-3 lg:grid-cols-6">
          <Cifra titulo="Aprobadas" valor={n('APROBADA')} />
          <Cifra titulo="Validadas (por aprobar)" valor={n('VALIDADA')} enlace="#/revision" />
          <Cifra titulo="Borrador con alertas" valor={d.conAlertas} alerta={d.conAlertas > 0} />
          <Cifra titulo="Duplicadas" valor={n('DUPLICADA')} />
          <Cifra titulo="Descartadas" valor={n('DESCARTADA')} />
          <Cifra titulo="Reportes abiertos" valor={d.reportesAbiertos} alerta={d.reportesAbiertos > 0} />
        </div>
      )}
      {d && usuario?.rol === 'ADMIN' && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-indigo-50 p-3 text-sm">
          <span className="text-indigo-900">
            {d.sinValidar + d.sinEmbedding > 0
              ? `${d.sinValidar} sin validar · ${d.sinEmbedding} sin embedding`
              : 'Todo el banco está analizado.'}
          </span>
          {d.ciegoDisponible ? (
            <label className="flex items-center gap-2 text-indigo-900">
              <input type="checkbox" checked={ciego} onChange={(e) => setCiego(e.target.checked)} />
              Resolver además "a ciegas" con Claude (usa la API, tiene costo)
            </label>
          ) : (
            <span className="text-xs text-indigo-800">Validador a ciegas: agrega ANTHROPIC_API_KEY en .env para activarlo.</span>
          )}
          <button className="btn-primario ml-auto py-1.5" disabled={analizar.isPending} onClick={() => analizar.mutate()}>
            {analizar.isPending ? 'Analizando… (la 1.ª vez carga el modelo)' : 'Analizar pendientes'}
          </button>
          {analizar.data && (
            <p className="w-full text-xs text-indigo-900">
              {analizar.data.embebidas} embebidas · {analizar.data.duplicadas} marcadas duplicadas · {analizar.data.validadas} sin
              alertas · {analizar.data.conAlertas} con alertas
              {ciego && ` · a ciegas: ${analizar.data.ciegas} resueltas, ${analizar.data.ciegasFallidas} no coinciden`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Cifra({ titulo, valor, alerta, enlace }: { titulo: string; valor: number; alerta?: boolean; enlace?: string }) {
  const cuerpo = (
    <>
      <p className="text-xs text-slate-500">{titulo}</p>
      <p className={`text-xl font-semibold ${alerta ? 'text-red-700' : 'text-indigo-700'}`}>{valor}</p>
    </>
  );
  return enlace ? (
    <a href={enlace} className="rounded-xl bg-slate-100 p-3 hover:ring-2 hover:ring-indigo-200">
      {cuerpo}
    </a>
  ) : (
    <div className="rounded-xl bg-slate-100 p-3">{cuerpo}</div>
  );
}

/** Botones para descartar o abrir una pregunta. */
function useDescartar() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/admin/preguntas/${id}`, { metodo: 'PATCH', cuerpo: { estado: 'DESCARTADA' } }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['calidad'] }),
    onError: (e) => alert(mensajeDeError(e)),
  });
}

function Reportes() {
  const cliente = useQueryClient();
  const r = useQuery({ queryKey: ['calidad', 'reportes'], queryFn: () => api<ReporteAdmin[]>('/admin/reportes') });
  const resolver = useMutation({
    mutationFn: (id: string) => api(`/admin/reportes/${id}`, { metodo: 'PATCH', cuerpo: { resuelto: true } }),
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['calidad'] }),
  });
  const lista = r.data ?? [];
  if (r.isSuccess && lista.length === 0) return null;
  return (
    <Caja titulo={`Reportes de estudiantes (${lista.length})`} descripcion="Revisa la pregunta, corrígela o descártala y marca el reporte como resuelto.">
      {r.error && <p className="text-sm text-red-700">{mensajeDeError(r.error)}</p>}
      <ul className="space-y-2">
        {lista.map((x) => (
          <li key={x.id} className="rounded-xl border border-slate-200 p-3 text-sm">
            <p className="mb-1 text-xs text-slate-500">
              <span className="rounded bg-red-50 px-1.5 font-medium text-red-700">{NOMBRE_MOTIVO[x.motivo]}</span> · {x.usuario} ·{' '}
              {new Date(x.creadoEn).toLocaleDateString()} · {x.pregunta.contenido}
            </p>
            {x.comentario && <p className="mb-1 italic">“{x.comentario}”</p>}
            <p className="font-medium">{x.pregunta.enunciado}</p>
            <p className="text-emerald-700">✓ {x.pregunta.correcta}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <a className="btn-secundario py-1" href={`#/revision/${x.pregunta.id}`}>
                Abrir y editar
              </a>
              <button className="btn-secundario py-1" disabled={resolver.isPending} onClick={() => resolver.mutate(x.id)}>
                ✓ Marcar resuelto
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Caja>
  );
}

function Rotas() {
  const [min, setMin] = useState(5);
  const r = useQuery({
    queryKey: ['calidad', 'rotas', min],
    queryFn: () => api<EstadisticasPreguntas>(`/admin/estadisticas/preguntas?minRespuestas=${min}`),
  });
  const d = r.data;
  return (
    <Caja
      titulo={`Preguntas rotas${d ? ` (${d.rotas.length})` : ''}`}
      descripcion={d ? `Entre ${d.evaluadas} aprobadas con al menos ${min} respuestas.` : undefined}
      acciones={
        <select className="campo w-auto py-1.5" value={min} onChange={(e) => setMin(Number(e.target.value))} aria-label="Respuestas mínimas">
          {[3, 5, 10, 20].map((n) => (
            <option key={n} value={n}>
              ≥ {n} respuestas
            </option>
          ))}
        </select>
      }
    >
      {r.error && <p className="text-sm text-red-700">{mensajeDeError(r.error)}</p>}
      {d && d.rotas.length === 0 && (
        <p className="text-sm text-slate-500">
          {d.evaluadas === 0 ? 'Aún no hay preguntas con suficientes respuestas.' : 'Ninguna pregunta se ve rota. 👍'}
        </p>
      )}
      <ul className="space-y-2">
        {d?.rotas.map((p) => (
          <li key={p.id} className="rounded-xl border border-slate-200 p-3 text-sm">
            <p className="mb-1 flex flex-wrap gap-2 text-xs">
              <span className={`rounded px-1.5 font-medium ${PROBLEMA[p.problema].color}`}>{PROBLEMA[p.problema].texto}</span>
              <span className="text-slate-500">
                {p.acierto}% de acierto en {p.respondidas} · {p.contenido}
              </span>
              {p.reportes > 0 && <span className="text-red-700">⚑ {p.reportes}</span>}
            </p>
            <p className="font-medium">{p.enunciado}</p>
            <ul className="mt-1 space-y-0.5">
              {p.opciones.map((o) => {
                const total = p.opciones.reduce((s, x) => s + x.elegida, 0) || 1;
                return (
                  <li key={o.id} className="flex items-center gap-2 text-xs">
                    <span className="w-9 shrink-0 text-right tabular-nums text-slate-500">{Math.round((o.elegida / total) * 100)}%</span>
                    <span className={o.correcta ? 'font-medium text-emerald-700' : 'text-slate-700'}>
                      {o.correcta ? '✓' : '·'} {o.texto}
                    </span>
                  </li>
                );
              })}
            </ul>
            <a className="mt-2 inline-block text-xs text-indigo-700 hover:underline" href={`#/revision/${p.id}`}>
              Abrir y editar →
            </a>
          </li>
        ))}
      </ul>
    </Caja>
  );
}

function Similares() {
  const [umbral, setUmbral] = useState(0.96);
  const r = useQuery({
    queryKey: ['calidad', 'similares', umbral],
    queryFn: () => api<ParSimilar[]>(`/admin/calidad/similares?umbral=${umbral}`),
  });
  const descartar = useDescartar();
  return (
    <Caja
      titulo={`Aprobadas muy parecidas${r.data ? ` (${r.data.length})` : ''}`}
      descripcion="Pares del mismo documento que preguntan casi lo mismo. Si son la misma pregunta, descarta una; si preguntan datos distintos, déjalas."
      acciones={
        <select className="campo w-auto py-1.5" value={umbral} onChange={(e) => setUmbral(Number(e.target.value))} aria-label="Similitud mínima">
          {[0.95, 0.96, 0.97, 0.98].map((u) => (
            <option key={u} value={u}>
              ≥ {Math.round(u * 100)} % de similitud
            </option>
          ))}
        </select>
      }
    >
      {r.error && <p className="text-sm text-red-700">{mensajeDeError(r.error)}</p>}
      {r.data?.length === 0 && <p className="text-sm text-slate-500">No hay pares por encima de ese umbral.</p>}
      <ul className="space-y-2">
        {r.data?.map((par) => (
          <li key={`${par.a.id}-${par.b.id}`} className="rounded-xl border border-slate-200 p-3">
            <p className="mb-2 text-xs text-slate-500">
              {Math.round(par.similitud * 1000) / 10}% · {par.contenido}
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              {[par.a, par.b].map((p) => (
                <LadoPar key={p.id} p={p} onDescartar={() => descartar.mutate(p.id)} ocupado={descartar.isPending} />
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Caja>
  );
}

function LadoPar({ p, onDescartar, ocupado }: { p: PreguntaBreve; onDescartar: () => void; ocupado: boolean }) {
  return (
    <div className="rounded-lg bg-slate-100 p-2 text-sm">
      <p className="font-medium">{p.enunciado}</p>
      <p className="text-emerald-700">✓ {p.correcta}</p>
      <p className="text-xs text-slate-500">{p.referencia}</p>
      <div className="mt-1 flex gap-2">
        <a className="text-xs text-indigo-700 hover:underline" href={`#/revision/${p.id}`}>
          Abrir
        </a>
        <button className="text-xs text-red-700 hover:underline disabled:opacity-50" disabled={ocupado} onClick={onDescartar}>
          Descartar esta
        </button>
      </div>
    </div>
  );
}

function BuscarFuentes() {
  const [q, setQ] = useState('');
  const [consulta, setConsulta] = useState('');
  const r = useQuery({
    queryKey: ['calidad', 'buscar', consulta],
    queryFn: () => api<FragmentoEncontrado[]>(`/admin/fragmentos/buscar?q=${encodeURIComponent(consulta)}`),
    enabled: consulta.length >= 3,
  });
  return (
    <Caja titulo="Buscar en las fuentes" descripcion="Búsqueda por significado en los artículos y bloques de toda la bibliografía (no hace falta la palabra exacta).">
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setConsulta(q.trim());
        }}
      >
        <input className="campo" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej.: quién aprueba el cierre de un CEA" />
        <button className="btn-primario" disabled={q.trim().length < 3}>
          Buscar
        </button>
      </form>
      {r.isFetching && <p className="text-sm text-slate-500">Buscando…</p>}
      {r.error && <p className="text-sm text-red-700">{mensajeDeError(r.error)}</p>}
      <ul className="space-y-2">
        {r.data?.map((f) => (
          <li key={f.id} className="rounded-xl border border-slate-200 p-3 text-sm">
            <p className="mb-1 text-xs text-slate-500">
              <span className="font-semibold text-slate-700">{f.contenido}</span> · {f.etiqueta} · pág. {f.paginaDesde}
              {f.paginaHasta !== f.paginaDesde && `-${f.paginaHasta}`} · {Math.round(f.similitud * 100)}%
              {f.ref && <code className="ml-1">{f.ref}</code>}
            </p>
            <p className="whitespace-pre-line text-slate-700">{f.extracto}</p>
          </li>
        ))}
      </ul>
    </Caja>
  );
}
