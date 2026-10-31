import { useEffect, useState, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DIFICULTADES,
  NIVELES_BLOOM,
  type ColeccionEstudio,
  type Paginado,
  type PreguntaEditar,
  type PreguntaRevision,
} from '@estudia/shared';
import { api, mensajeDeError } from '../api/cliente';
import { useSesion } from '../auth/sesion';

const POR_PAGINA = 20;
const ESTADOS = ['BORRADOR', 'VALIDADA', 'DUPLICADA', 'APROBADA', 'DESCARTADA'] as const;
const NOMBRE_ESTADO: Record<(typeof ESTADOS)[number], string> = {
  BORRADOR: 'Borrador (con alertas o sin validar)',
  VALIDADA: 'Validada (pasó las reglas)',
  DUPLICADA: 'Duplicada',
  APROBADA: 'Aprobada',
  DESCARTADA: 'Descartada',
};

export function Revision({ id }: { id?: string }) {
  return id ? <PreguntaSuelta id={id} /> : <Bandeja />;
}

/** Una sola pregunta (#/revision/<id>), para llegar desde Calidad o desde un duplicado. */
function PreguntaSuelta({ id }: { id: string }) {
  const cliente = useQueryClient();
  const p = useQuery({ queryKey: ['pregunta', id], queryFn: () => api<PreguntaRevision>(`/admin/preguntas/${id}`) });
  return (
    <section className="space-y-3">
      <button className="text-sm text-indigo-700 hover:underline" onClick={() => history.back()}>
        ← Volver
      </button>
      {p.isLoading && <p className="text-slate-500">Cargando…</p>}
      {p.error && <p className="text-red-700">{mensajeDeError(p.error)}</p>}
      {p.data && (
        <ul>
          <TarjetaPregunta
            pregunta={p.data}
            seleccionable={false}
            seleccionada={false}
            onSeleccionar={() => {}}
            onCambio={() => {
              cliente.invalidateQueries({ queryKey: ['pregunta', id] });
              cliente.invalidateQueries({ queryKey: ['revision'] });
              cliente.invalidateQueries({ queryKey: ['calidad'] });
            }}
          />
        </ul>
      )}
    </section>
  );
}

function Bandeja() {
  const { usuario } = useSesion();
  const puedeAprobar = usuario?.rol === 'ADMIN' || usuario?.rol === 'REVISOR';
  const cliente = useQueryClient();
  const [estado, setEstado] = useState<(typeof ESTADOS)[number]>('BORRADOR');
  const [contenidoId, setContenidoId] = useState('');
  const [pagina, setPagina] = useState(1);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());

  const params = new URLSearchParams({ estado, pagina: String(pagina), porPagina: String(POR_PAGINA) });
  if (contenidoId) params.set('contenidoId', contenidoId);

  const lista = useQuery({
    queryKey: ['revision', estado, contenidoId, pagina],
    queryFn: () => api<Paginado<PreguntaRevision>>(`/admin/revision?${params}`),
    placeholderData: keepPreviousData,
  });
  // /me/estudio responde a ADMIN y REVISOR (lista todos los documentos).
  const arbol = useQuery({ queryKey: ['estudio'], queryFn: () => api<ColeccionEstudio[]>('/me/estudio') });
  const contenidos = arbol.data?.flatMap((c) => c.contenidos) ?? [];

  useEffect(() => setSeleccion(new Set()), [estado, contenidoId, pagina]);

  const refrescar = () => {
    cliente.invalidateQueries({ queryKey: ['revision'] });
    cliente.invalidateQueries({ queryKey: ['arbol'] });
    cliente.invalidateQueries({ queryKey: ['estudio'] });
    cliente.invalidateQueries({ queryKey: ['panel'] });
  };

  const aprobarTodas = useMutation({
    mutationFn: () =>
      api<{ aprobadas: number }>('/admin/preguntas/aprobar-todas', {
        metodo: 'POST',
        cuerpo: { estado: estado as 'BORRADOR' | 'VALIDADA', ...(contenidoId && { contenidoId }) },
      }),
    onSuccess: (r) => {
      setSeleccion(new Set());
      setPagina(1);
      refrescar();
      alert(`Se aprobaron ${r.aprobadas} preguntas.`);
    },
    onError: (e) => alert(mensajeDeError(e)),
  });

  const aprobarLote = useMutation({
    mutationFn: (ids: string[]) =>
      api<{ aprobadas: number; omitidas: number }>('/admin/preguntas/aprobar-lote', { metodo: 'POST', cuerpo: { ids } }),
    onSuccess: (r) => {
      setSeleccion(new Set());
      refrescar();
      if (r.omitidas) alert(`Aprobadas: ${r.aprobadas}. Omitidas (no estaban en borrador): ${r.omitidas}.`);
    },
    onError: (e) => alert(mensajeDeError(e)),
  });

  const pendiente = estado === 'BORRADOR' || estado === 'VALIDADA';
  const items = lista.data?.items ?? [];
  const total = lista.data?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const todasMarcadas = items.length > 0 && items.every((p) => seleccion.has(p.id));

  const alternar = (id: string) =>
    setSeleccion((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="mr-auto text-xl font-semibold">Bandeja de revisión</h1>
        <label className="text-sm">
          <span className="etiqueta">Estado</span>
          <select className="campo" value={estado} onChange={(e) => (setEstado(e.target.value as typeof estado), setPagina(1))}>
            {ESTADOS.map((e) => (
              <option key={e} value={e}>
                {NOMBRE_ESTADO[e]}
              </option>
            ))}
          </select>
        </label>
        {contenidos.length > 0 && (
          <label className="text-sm">
            <span className="etiqueta">Documento</span>
            <select className="campo" value={contenidoId} onChange={(e) => (setContenidoId(e.target.value), setPagina(1))}>
              <option value="">Todos</option>
              {contenidos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.titulo}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {puedeAprobar && pendiente && items.length > 0 && (
        <div className="sticky top-14 z-[5] flex flex-wrap items-center gap-3 rounded-xl bg-indigo-50 px-4 py-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={todasMarcadas}
              onChange={() => setSeleccion(todasMarcadas ? new Set() : new Set(items.map((p) => p.id)))}
            />
            Seleccionar página
          </label>
          <span className="text-slate-600">{seleccion.size} seleccionadas</span>
          <button
            className="btn-secundario ml-auto py-1.5"
            disabled={seleccion.size === 0 || aprobarLote.isPending}
            onClick={() => aprobarLote.mutate([...seleccion])}
          >
            ✓ Aprobar seleccionadas
          </button>
          <button
            className="btn-exito py-1.5"
            disabled={aprobarTodas.isPending}
            onClick={() => {
              const doc = contenidos.find((c) => c.id === contenidoId)?.titulo;
              const alcance = doc ? `del documento "${doc}"` : 'de todos los documentos';
              const aviso = estado === 'BORRADOR' ? ' Ojo: las de borrador tienen alertas o no pasaron por el validador.' : '';
              if (confirm(`¿Aprobar las ${total} preguntas en ${estado} ${alcance}?${aviso}`)) aprobarTodas.mutate();
            }}
          >
            {aprobarTodas.isPending ? 'Aprobando…' : `✓✓ Aprobar todas (${total})`}
          </button>
        </div>
      )}

      {lista.isLoading && <p className="text-slate-500">Cargando…</p>}
      {lista.error && <p className="text-red-700">{mensajeDeError(lista.error)}</p>}
      {lista.data && items.length === 0 && (
        <p className="rounded-lg bg-white p-6 text-center text-slate-500 shadow-sm">No hay preguntas en {NOMBRE_ESTADO[estado].toLowerCase()}.</p>
      )}

      <ul className="space-y-3">
        {items.map((p) => (
          <TarjetaPregunta
            key={p.id}
            pregunta={p}
            seleccionable={puedeAprobar && pendiente}
            seleccionada={seleccion.has(p.id)}
            onSeleccionar={() => alternar(p.id)}
            onCambio={refrescar}
          />
        ))}
      </ul>

      {total > POR_PAGINA && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button className="btn-secundario" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>
            ← Anterior
          </button>
          <span>
            Página {pagina} de {paginas} · {total} preguntas
          </span>
          <button className="btn-secundario" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>
            Siguiente →
          </button>
        </div>
      )}
    </section>
  );
}

function TarjetaPregunta(props: {
  pregunta: PreguntaRevision;
  seleccionable: boolean;
  seleccionada: boolean;
  onSeleccionar: () => void;
  onCambio: () => void;
}) {
  const { pregunta: p } = props;
  const [editando, setEditando] = useState(false);

  const guardar = useMutation({
    mutationFn: (cuerpo: PreguntaEditar) =>
      api<PreguntaRevision>(`/admin/preguntas/${p.id}`, { metodo: 'PATCH', cuerpo }),
    onSuccess: () => {
      setEditando(false);
      props.onCambio();
    },
    onError: (e) => alert(mensajeDeError(e)),
  });

  if (editando) {
    return (
      <li className="rounded-xl bg-white p-4 shadow-sm ring-2 ring-indigo-200">
        <EditorPregunta
          pregunta={p}
          guardando={guardar.isPending}
          onCancelar={() => setEditando(false)}
          onGuardar={(datos) => guardar.mutate(datos)}
        />
      </li>
    );
  }

  return (
    <li className={`rounded-xl bg-white p-4 shadow-sm ${props.seleccionada ? 'ring-2 ring-emerald-300' : ''}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        {props.seleccionable && (
          <input type="checkbox" checked={props.seleccionada} onChange={props.onSeleccionar} aria-label="Seleccionar" />
        )}
        <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-700">{p.tipo}</span>
        <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">{p.dificultad}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">{p.nivelBloom}</span>
        <span className="text-slate-500">
          {p.tema.contenido.titulo} › {p.tema.nombre}
        </span>
        {p.estado === 'VALIDADA' && <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">✓ pasó el validador</span>}
        {p.reportesAbiertos > 0 && (
          <span className="rounded bg-red-50 px-1.5 py-0.5 font-medium text-red-700">⚑ {p.reportesAbiertos} reporte(s)</span>
        )}
      </div>

      {p.duplicadaDe && (
        <div className="mb-3 rounded-lg bg-violet-50 p-3 text-sm text-violet-900">
          <p className="font-semibold">
            Se parece {p.duplicadaDe.similitud ? `al ${Math.round(p.duplicadaDe.similitud * 100)} %` : ''} a una pregunta {p.duplicadaDe.estado.toLowerCase()}:
          </p>
          <a className="underline" href={`#/revision/${p.duplicadaDe.id}`}>
            {p.duplicadaDe.enunciado}
          </a>
          <p className="mt-1 text-xs">Si en realidad pregunta algo distinto, usa "Volver a borrador".</p>
        </div>
      )}
      {p.alertas.length > 0 && (
        <ul className="mb-3 list-disc space-y-0.5 rounded-lg bg-amber-50 py-2 pl-7 pr-3 text-sm text-amber-900">
          {p.alertas.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      {p.ciega?.coincide && !p.ciega.ambigua && (
        <p className="mb-3 text-xs text-emerald-700">✓ Resuelta a ciegas por {p.ciega.modelo}: eligió la correcta.</p>
      )}

      <p className="mb-3 font-medium">{p.enunciado}</p>

      <ol className="mb-3 space-y-1.5">
        {p.opciones.map((o, i) => (
          <li
            key={o.id}
            className={`rounded-lg border px-3 py-2 text-sm ${
              o.correcta ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200'
            }`}
          >
            <span className="font-medium">
              {p.tipo === 'ORDENAR' ? `${i + 1}.` : o.correcta ? '✓' : '✗'} {o.texto}
            </span>
            {o.porQue && <span className="block text-xs text-slate-500">{o.porQue}</span>}
          </li>
        ))}
      </ol>

      <div className="grid gap-3 text-sm md:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">Explicación</p>
          <p>{p.explicacion}</p>
        </div>
        <div className="rounded-lg bg-amber-50 p-3">
          <p className="text-xs font-semibold uppercase text-amber-800">Cita de la fuente</p>
          <blockquote className="italic">“{p.citaTextual}”</blockquote>
          <p className="mt-1 text-xs text-amber-800">{p.referencia}</p>
        </div>
      </div>

      {p.etiquetas.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">{p.etiquetas.map((e) => `#${e}`).join(' ')}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {p.estado !== 'APROBADA' && (
          <button className="btn-exito" disabled={guardar.isPending} onClick={() => guardar.mutate({ estado: 'APROBADA' })}>
            ✓ Aprobar
          </button>
        )}
        <button className="btn-secundario" onClick={() => setEditando(true)}>
          ✎ Editar
        </button>
        {p.estado !== 'DESCARTADA' && (
          <button className="btn-peligro" disabled={guardar.isPending} onClick={() => guardar.mutate({ estado: 'DESCARTADA' })}>
            ✕ Descartar
          </button>
        )}
        {p.estado !== 'BORRADOR' && (
          <button className="btn-secundario" disabled={guardar.isPending} onClick={() => guardar.mutate({ estado: 'BORRADOR' })}>
            ↺ Volver a borrador
          </button>
        )}
      </div>
    </li>
  );
}

type OpcionForm = { texto: string; correcta: boolean; porQue: string };

function EditorPregunta(props: {
  pregunta: PreguntaRevision;
  guardando: boolean;
  onCancelar: () => void;
  onGuardar: (datos: PreguntaEditar) => void;
}) {
  const { pregunta: p } = props;
  const [enunciado, setEnunciado] = useState(p.enunciado);
  const [explicacion, setExplicacion] = useState(p.explicacion);
  const [citaTextual, setCitaTextual] = useState(p.citaTextual);
  const [referencia, setReferencia] = useState(p.referencia);
  const [dificultad, setDificultad] = useState(p.dificultad as PreguntaEditar['dificultad']);
  const [nivelBloom, setNivelBloom] = useState(p.nivelBloom as PreguntaEditar['nivelBloom']);
  const [etiquetas, setEtiquetas] = useState(p.etiquetas.join(', '));
  const [opciones, setOpciones] = useState<OpcionForm[]>(
    p.opciones.map((o) => ({ texto: o.texto, correcta: o.correcta, porQue: o.porQue ?? '' })),
  );
  const unaSola = ['OPCION_MULTIPLE', 'VERDADERO_FALSO', 'CASO'].includes(p.tipo);

  const cambiarOpcion = (i: number, cambio: Partial<OpcionForm>) =>
    setOpciones((ops) =>
      ops.map((o, j) => {
        if (j === i) return { ...o, ...cambio };
        // En tipos de una sola correcta, marcar una desmarca las demás.
        return unaSola && cambio.correcta ? { ...o, correcta: false } : o;
      }),
    );

  function guardar() {
    props.onGuardar({
      enunciado,
      explicacion,
      citaTextual,
      referencia,
      dificultad,
      nivelBloom,
      etiquetas: etiquetas.split(',').map((e) => e.trim()).filter(Boolean),
      opciones: opciones.map((o) => ({ texto: o.texto, correcta: o.correcta, porQue: o.porQue.trim() || null })),
    });
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs font-medium text-indigo-700">Editando · {p.tipo}</p>
      <Campo etiqueta="Enunciado">
        <textarea className="campo" rows={3} value={enunciado} onChange={(e) => setEnunciado(e.target.value)} />
      </Campo>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Dificultad">
          <select className="campo" value={dificultad} onChange={(e) => setDificultad(e.target.value as typeof dificultad)}>
            {DIFICULTADES.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Nivel Bloom">
          <select className="campo" value={nivelBloom} onChange={(e) => setNivelBloom(e.target.value as typeof nivelBloom)}>
            {NIVELES_BLOOM.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </Campo>
      </div>

      <div>
        <span className="etiqueta">Opciones {p.tipo === 'ORDENAR' && '(en el orden correcto)'}</span>
        <div className="space-y-2">
          {opciones.map((o, i) => (
            <div key={i} className="flex flex-wrap items-start gap-2 rounded-lg border border-slate-200 p-2">
              <label className="flex items-center gap-1 pt-2 text-xs">
                <input
                  type="checkbox"
                  checked={o.correcta}
                  onChange={(e) => cambiarOpcion(i, { correcta: e.target.checked })}
                />
                Correcta
              </label>
              <div className="min-w-48 flex-1 space-y-1">
                <input className="campo" value={o.texto} onChange={(e) => cambiarOpcion(i, { texto: e.target.value })} />
                <input
                  className="campo text-xs"
                  placeholder="Por qué (feedback)"
                  value={o.porQue}
                  onChange={(e) => cambiarOpcion(i, { porQue: e.target.value })}
                />
              </div>
              <button
                className="pt-2 text-xs text-red-700 hover:underline"
                onClick={() => setOpciones((ops) => ops.filter((_, j) => j !== i))}
              >
                Quitar
              </button>
            </div>
          ))}
        </div>
        <button
          className="mt-2 text-xs text-indigo-700 hover:underline"
          onClick={() => setOpciones((ops) => [...ops, { texto: '', correcta: false, porQue: '' }])}
        >
          + Agregar opción
        </button>
      </div>

      <Campo etiqueta="Explicación">
        <textarea className="campo" rows={2} value={explicacion} onChange={(e) => setExplicacion(e.target.value)} />
      </Campo>
      <Campo etiqueta="Cita textual">
        <textarea className="campo" rows={2} value={citaTextual} onChange={(e) => setCitaTextual(e.target.value)} />
      </Campo>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Referencia">
          <input className="campo" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
        </Campo>
        <Campo etiqueta="Etiquetas (separadas por coma)">
          <input className="campo" value={etiquetas} onChange={(e) => setEtiquetas(e.target.value)} />
        </Campo>
      </div>

      <div className="flex gap-2">
        <button className="btn-primario" disabled={props.guardando} onClick={guardar}>
          {props.guardando ? 'Guardando…' : 'Guardar cambios'}
        </button>
        <button className="btn-secundario" onClick={props.onCancelar}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="etiqueta">{etiqueta}</span>
      {children}
    </label>
  );
}
