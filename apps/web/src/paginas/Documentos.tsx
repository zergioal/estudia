import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ColeccionNodo,
  DocumentoDetalle,
  DocumentoResumen,
  EstadoDocumento,
  FragmentoResumen,
  ResultadoExportacion,
} from '@estudia/shared';
import { api, mensajeDeError } from '../api/cliente';

const COLOR_ESTADO: Record<EstadoDocumento, string> = {
  SUBIDO: 'bg-slate-100 text-slate-700',
  PROCESANDO: 'bg-amber-100 text-amber-800',
  EXTRAIDO: 'bg-sky-100 text-sky-800',
  FRAGMENTADO: 'bg-emerald-100 text-emerald-800',
  ERROR: 'bg-red-100 text-red-800',
};
const EN_CURSO: EstadoDocumento[] = ['SUBIDO', 'PROCESANDO', 'EXTRAIDO'];

export function Documentos() {
  const cliente = useQueryClient();
  const [contenidoId, setContenidoId] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null);

  const arbol = useQuery({ queryKey: ['arbol'], queryFn: () => api<ColeccionNodo[]>('/admin/arbol') });
  const documentos = useQuery({
    queryKey: ['documentos', contenidoId],
    queryFn: () => api<DocumentoResumen[]>(`/admin/documentos${contenidoId ? `?contenidoId=${contenidoId}` : ''}`),
    // Mientras haya algo procesándose, se refresca solo.
    refetchInterval: (q) => (q.state.data?.some((d) => EN_CURSO.includes(d.estado)) ? 3000 : false),
  });

  const refrescar = () => {
    cliente.invalidateQueries({ queryKey: ['documentos'] });
    cliente.invalidateQueries({ queryKey: ['documento'] });
    cliente.invalidateQueries({ queryKey: ['arbol'] });
  };
  const accion = useMutation({
    mutationFn: ({ ruta, metodo = 'POST' }: { ruta: string; metodo?: string }) => api(ruta, { metodo }),
    onSuccess: refrescar,
    onError: (e) => alert(mensajeDeError(e)),
  });

  const contenidos = arbol.data?.flatMap((c) => c.contenidos.map((ct) => ({ ...ct, coleccion: c.nombre }))) ?? [];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="mr-auto text-xl font-semibold">Documentos</h1>
        <label className="text-sm">
          <span className="etiqueta">Contenido</span>
          <select className="campo" value={contenidoId} onChange={(e) => setContenidoId(e.target.value)}>
            <option value="">Todos</option>
            {contenidos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.coleccion} › {c.titulo}
              </option>
            ))}
          </select>
        </label>
      </div>

      <FormularioSubida contenidos={contenidos} contenidoInicial={contenidoId} onSubido={refrescar} />

      <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
        Para cargar una carpeta completa (con títulos desde <code>manifiesto.json</code>) usa{' '}
        <code>npm run ingestar -- fuentes/&lt;carpeta&gt;</code>. Los fragmentos se exportan a{' '}
        <code>fuentes/&lt;clave&gt;/</code> para generar preguntas con Claude Code.
      </p>

      {documentos.isLoading && <p className="text-slate-500">Cargando…</p>}
      {documentos.error && <p className="text-red-700">{mensajeDeError(documentos.error)}</p>}
      {documentos.data?.length === 0 && (
        <p className="rounded-lg bg-white p-6 text-center text-slate-500 shadow-sm">No hay documentos.</p>
      )}

      <ul className="space-y-2">
        {documentos.data?.map((d) => (
          <li key={d.id} className="rounded-xl bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${COLOR_ESTADO[d.estado]}`}>{d.estado}</span>
              <span className="font-medium">{d.contenido.titulo}</span>
              <span className="text-xs text-slate-500">{d.nombreArchivo}</span>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              {d.paginas ?? '?'} págs.
              {d.paginasOcr > 0 && ` · ${d.paginasOcr} con OCR`}
              {d.modo && ` · ${d.modo === 'NORMATIVA' ? 'por artículos' : 'por bloques'}`}
              {` · ${d.totalFragmentos} fragmentos`}
              {d.contenido.clave && (
                <>
                  {' · '}
                  <code>fuentes/{d.contenido.clave}/</code>
                </>
              )}
            </p>
            {d.error && <p className="mt-1 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{d.error}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="btn-secundario py-1" disabled={d.totalFragmentos === 0} onClick={() => setAbierto(abierto === d.id ? null : d.id)}>
                {abierto === d.id ? 'Ocultar fragmentos' : 'Ver fragmentos'}
              </button>
              <button
                className="btn-secundario py-1"
                disabled={EN_CURSO.includes(d.estado) || accion.isPending}
                title="Rehace los cortes con el texto ya extraído (sin OCR)"
                onClick={() => accion.mutate({ ruta: `/admin/documentos/${d.id}/fragmentar` })}
              >
                Re-fragmentar
              </button>
              <button
                className="btn-secundario py-1"
                disabled={EN_CURSO.includes(d.estado) || accion.isPending}
                title="Vuelve a extraer el texto (con OCR) y fragmentar"
                onClick={() => confirm('¿Volver a extraer el texto? Con OCR puede tardar varios minutos.') && accion.mutate({ ruta: `/admin/documentos/${d.id}/procesar` })}
              >
                Reprocesar
              </button>
              <BotonExportar contenidoId={d.contenido.id} deshabilitado={d.totalFragmentos === 0} />
              <button
                className="btn-peligro py-1"
                disabled={d.estado === 'PROCESANDO' || accion.isPending}
                onClick={() =>
                  confirm(`¿Eliminar "${d.nombreArchivo}" y sus fragmentos? Las preguntas se conservan.`) &&
                  accion.mutate({ ruta: `/admin/documentos/${d.id}`, metodo: 'DELETE' })
                }
              >
                Eliminar
              </button>
            </div>
            {abierto === d.id && <Fragmentos documentoId={d.id} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function FormularioSubida(props: {
  contenidos: { id: string; titulo: string; coleccion: string }[];
  contenidoInicial: string;
  onSubido: () => void;
}) {
  const [contenidoId, setContenidoId] = useState(props.contenidoInicial);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [ocr, setOcr] = useState(true);
  const subir = useMutation({
    mutationFn: () => {
      const datos = new FormData();
      datos.set('contenidoId', contenidoId || props.contenidoInicial);
      datos.set('ocr', String(ocr));
      datos.set('archivo', archivo!);
      return api<DocumentoDetalle>('/admin/documentos', { metodo: 'POST', cuerpo: datos });
    },
    onSuccess: () => {
      setArchivo(null);
      props.onSubido();
    },
    onError: (e) => alert(mensajeDeError(e)),
  });

  function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    subir.mutate();
    e.currentTarget.reset();
  }

  return (
    <form onSubmit={enviar} className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 shadow-sm">
      <label className="min-w-56 flex-1 text-sm">
        <span className="etiqueta">Contenido destino</span>
        <select className="campo" value={contenidoId || props.contenidoInicial} onChange={(e) => setContenidoId(e.target.value)} required>
          <option value="">Elige…</option>
          {props.contenidos.map((c) => (
            <option key={c.id} value={c.id}>
              {c.coleccion} › {c.titulo}
            </option>
          ))}
        </select>
      </label>
      <label className="min-w-56 flex-1 text-sm">
        <span className="etiqueta">PDF</span>
        <input
          className="campo py-1.5"
          type="file"
          accept="application/pdf"
          onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
          required
        />
      </label>
      <label className="flex items-center gap-2 pb-2 text-sm">
        <input type="checkbox" checked={ocr} onChange={(e) => setOcr(e.target.checked)} />
        OCR en páginas escaneadas
      </label>
      <button className="btn-primario" disabled={!archivo || subir.isPending}>
        {subir.isPending ? 'Subiendo…' : 'Subir y procesar'}
      </button>
    </form>
  );
}

function BotonExportar({ contenidoId, deshabilitado }: { contenidoId: string; deshabilitado: boolean }) {
  const exportar = useMutation({
    mutationFn: () => api<ResultadoExportacion>(`/admin/contenidos/${contenidoId}/exportar`, { metodo: 'POST' }),
    onSuccess: (r) => alert(`Exportados ${r.archivos} fragmentos a ${r.carpeta}/`),
    onError: (e) => alert(mensajeDeError(e)),
  });
  return (
    <button className="btn-secundario py-1" disabled={deshabilitado || exportar.isPending} onClick={() => exportar.mutate()}>
      Exportar a fuentes/
    </button>
  );
}

function Fragmentos({ documentoId }: { documentoId: string }) {
  const [filtro, setFiltro] = useState('');
  const detalle = useQuery({
    queryKey: ['documento', documentoId],
    queryFn: () => api<DocumentoDetalle>(`/admin/documentos/${documentoId}`),
  });

  const grupos = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    const mapa = new Map<string, FragmentoResumen[]>();
    for (const fr of detalle.data?.fragmentos ?? []) {
      if (f && !`${fr.ref} ${fr.etiqueta} ${fr.texto}`.toLowerCase().includes(f)) continue;
      const tema = fr.tema ?? 'Sin tema';
      mapa.set(tema, [...(mapa.get(tema) ?? []), fr]);
    }
    return [...mapa.entries()];
  }, [detalle.data, filtro]);

  if (detalle.isLoading) return <p className="mt-3 text-sm text-slate-500">Cargando fragmentos…</p>;
  if (detalle.error) return <p className="mt-3 text-sm text-red-700">{mensajeDeError(detalle.error)}</p>;

  return (
    <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
      <input className="campo" placeholder="Buscar en fragmentos (texto, ref, etiqueta)…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
      {grupos.map(([tema, frags]) => (
        <div key={tema}>
          <p className="mb-1 text-xs font-semibold text-slate-600">{tema.replaceAll(' - ', ' › ')}</p>
          <ul className="space-y-1">
            {frags.map((f) => (
              <li key={f.id}>
                <details className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                    <span className="font-medium">{f.etiqueta}</span>
                    <code className="text-xs text-slate-500">{f.ref}</code>
                    <span className="text-xs text-slate-500">
                      pág. {f.paginaDesde === f.paginaHasta ? f.paginaDesde : `${f.paginaDesde}–${f.paginaHasta}`} · {f.palabras} palabras
                    </span>
                    {f.totalPreguntas > 0 && (
                      <span className="rounded bg-indigo-50 px-1.5 text-xs text-indigo-700">{f.totalPreguntas} preguntas</span>
                    )}
                  </summary>
                  <p className="mt-2 whitespace-pre-line text-slate-700">{f.texto}</p>
                </details>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {grupos.length === 0 && <p className="text-sm text-slate-500">Sin resultados.</p>}
    </div>
  );
}
