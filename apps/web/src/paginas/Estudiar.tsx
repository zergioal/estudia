import { useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  CANTIDADES_QUIZ,
  DIFICULTADES,
  type ColeccionEstudio,
  type ContenidoEstudio,
  type Dificultad,
  type Panel,
  type QuizCrear,
  type QuizEstado,
  type TemaEstudio,
} from '@estudia/shared';
import { api, mensajeDeError } from '../api/cliente';
import { ir } from '../navegacion';

/** Bloques del examen (Reglamento 0001/2026, Art. 11): normativa 35%, técnico-pedagógico 65%. */
const BLOQUES = [
  { nombre: 'Normativa', tipos: ['LEY', 'DECRETO', 'RM'] },
  { nombre: 'Técnico-pedagógico', tipos: ['LIBRO', 'GUIA'] },
];

const NOMBRE_DIFICULTAD: Record<Dificultad, string> = { FACIL: 'Fácil', MEDIA: 'Media', DIFICIL: 'Difícil' };

export function Estudiar({ preseleccion }: { preseleccion?: string } = {}) {
  const panel = useQuery({ queryKey: ['panel'], queryFn: () => api<Panel>('/me/panel') });
  const arbol = useQuery({ queryKey: ['estudio'], queryFn: () => api<ColeccionEstudio[]>('/me/estudio') });
  // Desde una guía (#/estudiar/<contenidoId>) el documento llega ya marcado.
  const [contenidos, setContenidos] = useState<Set<string>>(() => new Set(preseleccion ? [preseleccion] : []));
  const [temas, setTemas] = useState<Set<string>>(new Set());
  const [dificultades, setDificultades] = useState<Set<Dificultad>>(new Set());
  const [cantidad, setCantidad] = useState<number>(20);

  const crear = useMutation({
    mutationFn: (datos: QuizCrear) => api<QuizEstado>('/quizzes', { metodo: 'POST', cuerpo: datos }),
    onSuccess: (q) => ir(`quiz/${q.id}`),
    onError: (e) => alert(mensajeDeError(e)),
  });

  const alternar = <T,>(set: Set<T>, valor: T, fijar: (s: Set<T>) => void) => {
    const n = new Set(set);
    if (n.has(valor)) n.delete(valor);
    else n.add(valor);
    fijar(n);
  };
  const todosLosDocumentos = (arbol.data ?? []).flatMap((c) => c.contenidos).filter((c) => c.disponibles > 0);
  /** Marca o desmarca varios documentos a la vez (un documento elegido entero no necesita temas sueltos). */
  const marcar = (docs: ContenidoEstudio[], valor: boolean) => {
    const n = new Set(contenidos);
    for (const d of docs) {
      if (valor) n.add(d.id);
      else n.delete(d.id);
    }
    setContenidos(n);
  };
  const seleccionadas = contarSeleccion(arbol.data ?? [], contenidos, temas);
  const p = panel.data;

  return (
    <section className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Dato titulo="XP acumulado" valor={p?.xpTotal ?? '–'} />
        <Dato titulo="Racha" valor={p ? `${p.rachaDias} ${p.rachaDias === 1 ? 'día' : 'días'}` : '–'} />
        <Dato titulo="Respondidas hoy" valor={p?.respondidasHoy ?? '–'} />
        <Dato titulo="Preguntas en el banco" valor={p?.preguntasDisponibles ?? '–'} />
      </div>

      <div className="space-y-4 rounded-2xl bg-white p-4 shadow-sm sm:p-5">
        <h1 className="text-lg font-semibold">Nuevo quiz de práctica</h1>

        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="etiqueta mb-0 mr-auto">¿Qué documentos quieres estudiar?</p>
            <span className="text-xs text-slate-500">
              {contenidos.size} {contenidos.size === 1 ? 'documento' : 'documentos'}
              {temas.size > 0 && ` + ${temas.size} ${temas.size === 1 ? 'tema' : 'temas'}`}
            </span>
            <button className="btn-secundario py-1 text-xs" onClick={() => marcar(todosLosDocumentos, true)}>
              Todos los documentos
            </button>
            <button
              className="btn-secundario py-1 text-xs"
              onClick={() => {
                setContenidos(new Set());
                setTemas(new Set());
              }}
            >
              Ninguno
            </button>
          </div>
          {arbol.isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
          {arbol.error && <p className="text-sm text-red-700">{mensajeDeError(arbol.error)}</p>}
          {arbol.data?.length === 0 && <p className="text-sm text-slate-500">No tienes contenidos asignados todavía.</p>}
          <div className="space-y-3">
            {arbol.data?.map((col) => (
              <div key={col.id} className="rounded-xl border border-slate-200 p-3">
                <p className="mb-2 font-medium">{col.nombre}</p>
                {BLOQUES.map((bloque) => {
                  const docs = col.contenidos.filter((c) => bloque.tipos.includes(c.tipoFuente));
                  if (docs.length === 0) return null;
                  const conPreguntas = docs.filter((c) => c.disponibles > 0);
                  const todos = conPreguntas.length > 0 && conPreguntas.every((c) => contenidos.has(c.id));
                  return (
                    <div key={bloque.nombre} className="mb-2 last:mb-0">
                      <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
                        <span>{bloque.nombre}</span>
                        <button
                          className="ml-auto font-normal normal-case text-indigo-700 hover:underline disabled:opacity-40"
                          disabled={conPreguntas.length === 0}
                          onClick={() => marcar(conPreguntas, !todos)}
                        >
                          {todos ? 'Quitar todos' : 'Todos'}
                        </button>
                      </div>
                      <ul className="space-y-1">
                        {docs.map((c) => (
                          <NodoContenido
                            key={c.id}
                            contenido={c}
                            marcado={contenidos.has(c.id)}
                            onMarcar={() => alternar(contenidos, c.id, setContenidos)}
                            temas={temas}
                            onTema={(id) => alternar(temas, id, setTemas)}
                          />
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="etiqueta">Dificultad (vacío = todas)</p>
          <div className="flex flex-wrap gap-2">
            {DIFICULTADES.map((d) => (
              <Chip key={d} activo={dificultades.has(d)} onClick={() => alternar(dificultades, d, setDificultades)}>
                {NOMBRE_DIFICULTAD[d]}
              </Chip>
            ))}
          </div>
        </div>

        <div>
          <p className="etiqueta">Cantidad de preguntas</p>
          <div className="flex flex-wrap gap-2">
            {CANTIDADES_QUIZ.map((n) => (
              <Chip key={n} activo={cantidad === n} onClick={() => setCantidad(n)}>
                {n}
              </Chip>
            ))}
          </div>
        </div>

        <button
          className="btn-primario w-full py-3 text-base"
          disabled={(contenidos.size === 0 && temas.size === 0) || crear.isPending}
          onClick={() =>
            crear.mutate({
              modo: 'PRACTICA',
              contenidoIds: [...contenidos],
              temaIds: [...temas],
              dificultades: [...dificultades],
              cantidad,
            })
          }
        >
          {crear.isPending ? 'Armando quiz…' : `Comenzar (${Math.min(cantidad, seleccionadas)} de ${seleccionadas} disponibles)`}
        </button>
      </div>

      {p && p.intentos.length > 0 && (
        <div className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
          <h2 className="mb-2 font-semibold">Intentos recientes</h2>
          <ul className="divide-y divide-slate-100">
            {p.intentos.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="text-slate-500">{new Date(i.iniciadoEn).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })}</span>
                <span className="min-w-0 flex-1 truncate">{i.contenidos.join(', ') || 'Quiz'}</span>
                <span>
                  {i.aciertos}/{i.respondidas} de {i.cantidad} · {i.puntaje} XP
                </span>
                {i.modo === 'SIMULACRO' ? (
                  <a className="text-indigo-700 hover:underline" href={`#/simulacro/${i.id}`}>
                    {i.finalizadoEn ? 'Ver resultado' : 'Continuar simulacro'}
                  </a>
                ) : i.finalizadoEn || i.respondidas === i.cantidad ? (
                  <a className="text-indigo-700 hover:underline" href={`#/resultado/${i.id}`}>
                    Ver resultado
                  </a>
                ) : (
                  <a className="font-medium text-indigo-700 hover:underline" href={`#/quiz/${i.id}`}>
                    Continuar
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function NodoContenido(props: {
  contenido: ContenidoEstudio;
  marcado: boolean;
  onMarcar: () => void;
  temas: Set<string>;
  onTema: (id: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const c = props.contenido;
  const sinPreguntas = c.disponibles === 0;
  return (
    <li>
      <div className="flex items-center gap-2">
        <button
          className="w-5 text-slate-400 disabled:opacity-30"
          disabled={c.temas.length === 0 || props.marcado}
          onClick={() => setAbierto(!abierto)}
          aria-label="Ver temas"
        >
          {abierto && !props.marcado ? '▾' : '▸'}
        </button>
        <label className={`flex flex-1 items-center gap-2 text-sm ${sinPreguntas ? 'text-slate-400' : ''}`}>
          <input type="checkbox" checked={props.marcado} disabled={sinPreguntas} onChange={props.onMarcar} />
          <span className="flex-1">{c.titulo}</span>
          <span className="text-xs text-slate-500">{c.disponibles}</span>
        </label>
      </div>
      {abierto && !props.marcado && (
        <ul className="ml-7 mt-1 space-y-1 border-l border-slate-200 pl-3">
          {c.temas.map((t) => (
            <NodoTema key={t.id} tema={t} temas={props.temas} onTema={props.onTema} />
          ))}
        </ul>
      )}
    </li>
  );
}

function NodoTema({ tema, temas, onTema }: { tema: TemaEstudio; temas: Set<string>; onTema: (id: string) => void }) {
  const marcado = temas.has(tema.id);
  return (
    <li>
      <label className={`flex items-center gap-2 text-sm ${tema.disponibles === 0 ? 'text-slate-400' : ''}`}>
        <input type="checkbox" checked={marcado} disabled={tema.disponibles === 0} onChange={() => onTema(tema.id)} />
        <span className="flex-1">{tema.nombre}</span>
        <span className="text-xs text-slate-500">{tema.disponibles}</span>
      </label>
      {!marcado && tema.hijos.some((h) => h.disponibles > 0) && (
        <ul className="ml-5 mt-1 space-y-1">
          {tema.hijos.map((h) => (
            <NodoTema key={h.id} tema={h} temas={temas} onTema={onTema} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Preguntas disponibles en la selección (sin contar dos veces un tema dentro de otro elegido). */
function contarSeleccion(arbol: ColeccionEstudio[], contenidos: Set<string>, temas: Set<string>) {
  let total = 0;
  const recorrer = (t: TemaEstudio) => {
    if (temas.has(t.id)) total += t.disponibles;
    else t.hijos.forEach(recorrer);
  };
  for (const col of arbol) {
    for (const c of col.contenidos) {
      if (contenidos.has(c.id)) total += c.disponibles;
      else c.temas.forEach(recorrer);
    }
  }
  return total;
}

function Dato({ titulo, valor }: { titulo: string; valor: string | number }) {
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm">
      <p className="text-xs text-slate-500">{titulo}</p>
      <p className="text-xl font-semibold text-indigo-700">{valor}</p>
    </div>
  );
}

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-4 py-1.5 text-sm font-medium ${
        activo ? 'border-indigo-600 bg-indigo-600 text-blanco' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  );
}
