import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TIPOS_FUENTE, type ColeccionNodo, type ContenidoNodo, type TemaNodo, type TipoFuente } from '@estudia/shared';
import { api, mensajeDeError } from '../api/cliente';

const CLAVE_ARBOL = ['arbol'];

function useAccion<T>(fn: (v: T) => Promise<unknown>) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => cliente.invalidateQueries({ queryKey: CLAVE_ARBOL }),
    onError: (e) => alert(mensajeDeError(e)),
  });
}

export function Contenidos() {
  const arbol = useQuery({ queryKey: CLAVE_ARBOL, queryFn: () => api<ColeccionNodo[]>('/admin/arbol') });
  const crearColeccion = useAccion((nombre: string) =>
    api('/admin/colecciones', { metodo: 'POST', cuerpo: { nombre } }),
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Contenidos</h1>
        <FormularioNombre etiqueta="+ Colección" placeholder="Ascenso de categoría 2027" onGuardar={crearColeccion.mutateAsync} />
      </div>

      {arbol.isLoading && <p className="text-slate-500">Cargando…</p>}
      {arbol.error && <p className="text-red-700">{mensajeDeError(arbol.error)}</p>}
      {arbol.data?.length === 0 && (
        <p className="rounded-lg bg-white p-6 text-center text-slate-500 shadow-sm">
          Aún no hay colecciones. Crea una o importa preguntas con <code>npm run importar</code>.
        </p>
      )}

      <ul className="space-y-3">
        {arbol.data?.map((c) => <NodoColeccion key={c.id} coleccion={c} />)}
      </ul>
    </section>
  );
}

function NodoColeccion({ coleccion }: { coleccion: ColeccionNodo }) {
  const renombrar = useAccion((nombre: string) =>
    api(`/admin/colecciones/${coleccion.id}`, { metodo: 'PATCH', cuerpo: { nombre } }),
  );
  const eliminar = useAccion(() => api(`/admin/colecciones/${coleccion.id}`, { metodo: 'DELETE' }));
  const crearContenido = useAccion((datos: { titulo: string; tipoFuente: TipoFuente }) =>
    api('/admin/contenidos', { metodo: 'POST', cuerpo: { ...datos, coleccionId: coleccion.id } }),
  );

  return (
    <li className="rounded-xl bg-white p-4 shadow-sm">
      <Fila
        icono="📚"
        titulo={<span className="font-semibold">{coleccion.nombre}</span>}
        onRenombrar={() => pedirNombre('Nombre de la colección', coleccion.nombre, renombrar.mutate)}
        onEliminar={() => confirmar(`¿Eliminar la colección "${coleccion.nombre}"?`) && eliminar.mutate(undefined)}
      >
        <FormularioContenido onGuardar={crearContenido.mutateAsync} />
      </Fila>
      {coleccion.contenidos.length > 0 && (
        <ul className="mt-2 space-y-2 border-l border-slate-200 pl-3 sm:pl-5">
          {coleccion.contenidos.map((ct) => <NodoContenido key={ct.id} contenido={ct} />)}
        </ul>
      )}
    </li>
  );
}

function NodoContenido({ contenido }: { contenido: ContenidoNodo }) {
  const [abierto, setAbierto] = useState(true);
  const editar = useAccion((cuerpo: object) =>
    api(`/admin/contenidos/${contenido.id}`, { metodo: 'PATCH', cuerpo }),
  );
  const eliminar = useAccion(() => api(`/admin/contenidos/${contenido.id}`, { metodo: 'DELETE' }));
  const crearTema = useAccion((nombre: string) =>
    api('/admin/temas', { metodo: 'POST', cuerpo: { contenidoId: contenido.id, nombre } }),
  );
  const total = contarPreguntas(contenido.temas);

  return (
    <li>
      <Fila
        icono={abierto ? '▾' : '▸'}
        onIcono={() => setAbierto(!abierto)}
        titulo={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{contenido.titulo}</span>
            <Insignia>{contenido.tipoFuente}</Insignia>
            <Insignia color={contenido.publicado ? 'verde' : 'gris'}>
              {contenido.publicado ? 'Publicado' : 'No publicado'}
            </Insignia>
            <span className="text-xs text-slate-500">{total} preguntas</span>
          </span>
        }
        onRenombrar={() => pedirNombre('Título del contenido', contenido.titulo, (titulo) => editar.mutate({ titulo }))}
        onEliminar={() => confirmar(`¿Eliminar "${contenido.titulo}" y sus temas?`) && eliminar.mutate(undefined)}
        extra={
          <button className="text-xs text-indigo-700 hover:underline" onClick={() => editar.mutate({ publicado: !contenido.publicado })}>
            {contenido.publicado ? 'Despublicar' : 'Publicar'}
          </button>
        }
      >
        <FormularioNombre etiqueta="+ Tema" placeholder="Título I" onGuardar={crearTema.mutateAsync} compacto />
      </Fila>
      {abierto && contenido.temas.length > 0 && (
        <ul className="mt-1 space-y-1 border-l border-slate-200 pl-3 sm:pl-5">
          {contenido.temas.map((t) => <NodoTema key={t.id} tema={t} contenidoId={contenido.id} />)}
        </ul>
      )}
    </li>
  );
}

function NodoTema({ tema, contenidoId }: { tema: TemaNodo; contenidoId: string }) {
  const renombrar = useAccion((nombre: string) => api(`/admin/temas/${tema.id}`, { metodo: 'PATCH', cuerpo: { nombre } }));
  const eliminar = useAccion(() => api(`/admin/temas/${tema.id}`, { metodo: 'DELETE' }));
  const crearHijo = useAccion((nombre: string) =>
    api('/admin/temas', { metodo: 'POST', cuerpo: { contenidoId, padreId: tema.id, nombre } }),
  );

  return (
    <li>
      <Fila
        icono="•"
        titulo={
          <span className="text-sm">
            {tema.nombre}
            {tema.totalPreguntas > 0 && <span className="ml-2 text-xs text-slate-500">({tema.totalPreguntas})</span>}
          </span>
        }
        onRenombrar={() => pedirNombre('Nombre del tema', tema.nombre, renombrar.mutate)}
        onEliminar={() => confirmar(`¿Eliminar el tema "${tema.nombre}"?`) && eliminar.mutate(undefined)}
      >
        <FormularioNombre etiqueta="+ Subtema" placeholder="Capítulo I" onGuardar={crearHijo.mutateAsync} compacto />
      </Fila>
      {tema.hijos.length > 0 && (
        <ul className="mt-1 space-y-1 border-l border-slate-200 pl-3 sm:pl-5">
          {tema.hijos.map((h) => <NodoTema key={h.id} tema={h} contenidoId={contenidoId} />)}
        </ul>
      )}
    </li>
  );
}

// ---------- Piezas ----------

function Fila(props: {
  icono: string;
  onIcono?: () => void;
  titulo: ReactNode;
  onRenombrar: () => void;
  onEliminar: () => void;
  extra?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="group flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-1 py-1 hover:bg-slate-50">
      <button className="w-4 text-slate-400" onClick={props.onIcono} disabled={!props.onIcono} aria-label="Expandir">
        {props.icono}
      </button>
      <div className="min-w-0 flex-1">{props.titulo}</div>
      <div className="flex items-center gap-3">
        {props.extra}
        {props.children}
        <button className="text-xs text-slate-600 hover:underline" onClick={props.onRenombrar}>
          Renombrar
        </button>
        <button className="text-xs text-red-700 hover:underline" onClick={props.onEliminar}>
          Eliminar
        </button>
      </div>
    </div>
  );
}

function FormularioNombre(props: {
  etiqueta: string;
  placeholder: string;
  onGuardar: (nombre: string) => Promise<unknown>;
  compacto?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState('');

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    await props.onGuardar(nombre.trim()).catch(() => undefined);
    setNombre('');
    setAbierto(false);
  }

  if (!abierto) {
    return (
      <button
        className={props.compacto ? 'text-xs text-indigo-700 hover:underline' : 'btn-primario'}
        onClick={() => setAbierto(true)}
      >
        {props.etiqueta}
      </button>
    );
  }
  return (
    <form onSubmit={enviar} className="flex items-center gap-1">
      <input
        className="campo py-1"
        autoFocus
        placeholder={props.placeholder}
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setAbierto(false)}
      />
      <button className="btn-primario py-1" type="submit">
        OK
      </button>
      <button className="btn-secundario py-1" type="button" onClick={() => setAbierto(false)}>
        ✕
      </button>
    </form>
  );
}

function FormularioContenido({ onGuardar }: { onGuardar: (d: { titulo: string; tipoFuente: TipoFuente }) => Promise<unknown> }) {
  const [abierto, setAbierto] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [tipoFuente, setTipoFuente] = useState<TipoFuente>('LEY');

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!titulo.trim()) return;
    await onGuardar({ titulo: titulo.trim(), tipoFuente }).catch(() => undefined);
    setTitulo('');
    setAbierto(false);
  }

  if (!abierto) {
    return (
      <button className="text-xs text-indigo-700 hover:underline" onClick={() => setAbierto(true)}>
        + Contenido
      </button>
    );
  }
  return (
    <form onSubmit={enviar} className="flex flex-wrap items-center gap-1">
      <input className="campo w-44 py-1" autoFocus placeholder="Ley 070" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
      <select className="campo w-auto py-1" value={tipoFuente} onChange={(e) => setTipoFuente(e.target.value as TipoFuente)}>
        {TIPOS_FUENTE.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
      <button className="btn-primario py-1" type="submit">
        OK
      </button>
      <button className="btn-secundario py-1" type="button" onClick={() => setAbierto(false)}>
        ✕
      </button>
    </form>
  );
}

function Insignia({ children, color = 'gris' }: { children: ReactNode; color?: 'gris' | 'verde' }) {
  const clases = color === 'verde' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600';
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${clases}`}>{children}</span>;
}

function contarPreguntas(temas: TemaNodo[]): number {
  return temas.reduce((suma, t) => suma + t.totalPreguntas + contarPreguntas(t.hijos), 0);
}

function pedirNombre(mensaje: string, actual: string, fn: (nombre: string) => void) {
  const nuevo = window.prompt(mensaje, actual)?.trim();
  if (nuevo && nuevo !== actual) fn(nuevo);
}

function confirmar(mensaje: string) {
  return window.confirm(mensaje);
}
