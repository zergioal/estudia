import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SIMULACRO,
  type Panel,
  type PreguntaQuiz,
  type QuizEstado,
  type RespuestaEnviar,
  type RespuestaRegistrada,
  type ResumenQuiz,
} from '@estudia/shared';
import { api, mensajeDeError } from '../api/cliente';
import { ir } from '../navegacion';

const LETRAS = ['A', 'B', 'C', 'D', 'E', 'F'];

export function Simulacro({ id }: { id?: string }) {
  return id ? <Examen id={id} /> : <Portada />;
}

// ---------- Portada: reglas, comenzar y simulacros anteriores ----------

function Portada() {
  const cliente = useQueryClient();
  const panel = useQuery({ queryKey: ['panel'], queryFn: () => api<Panel>('/me/panel') });
  const crear = useMutation({
    mutationFn: () => api<QuizEstado>('/simulacros', { metodo: 'POST' }),
    onSuccess: (q) => {
      cliente.invalidateQueries({ queryKey: ['panel'] });
      ir(`simulacro/${q.id}`);
    },
    onError: (e) => alert(mensajeDeError(e)),
  });
  const anteriores = (panel.data?.intentos ?? []).filter((i) => i.modo === 'SIMULACRO');
  const enCurso = anteriores.find((i) => !i.finalizadoEn);
  const nNormativa = Math.round((SIMULACRO.preguntas * SIMULACRO.porcentajeNormativa) / 100);

  return (
    <section className="mx-auto max-w-2xl space-y-5">
      <div className="rounded-2xl bg-white p-5 shadow-sm sm:p-6">
        <h1 className="text-xl font-bold">Examen simulacro</h1>
        <p className="mt-1 text-sm text-slate-600">
          Igual que el examen de competencia de la Convocatoria 0001/2026, con preguntas de toda la bibliografía.
        </p>
        <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <Regla icono="📝" texto={`${SIMULACRO.preguntas} preguntas de opción múltiple`} />
          <Regla icono="⏱️" texto={`${SIMULACRO.minutos} minutos (≈ ${Math.round((SIMULACRO.minutos * 60) / SIMULACRO.preguntas)} s por pregunta)`} />
          <Regla icono="⚖️" texto={`${nNormativa}% normativa · ${SIMULACRO.preguntas - nNormativa}% técnico-pedagógico`} />
          <Regla icono="🎯" texto={`Nota mínima de aprobación: ${SIMULACRO.notaMinima}/100`} />
        </ul>
        <div className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          Durante el examen solo marcas tu respuesta y pasas a la siguiente: no verás si acertaste. Las preguntas sin
          responder cuentan como error. Al terminar (o al agotarse el tiempo) recibirás tu nota y el repaso de tus errores.
        </div>
        {enCurso ? (
          <a className="btn-primario mt-5 w-full py-3 text-base" href={`#/simulacro/${enCurso.id}`}>
            Continuar el simulacro en curso ({enCurso.respondidas}/{enCurso.cantidad})
          </a>
        ) : (
          <button className="btn-primario mt-5 w-full py-3 text-base" disabled={crear.isPending} onClick={() => crear.mutate()}>
            {crear.isPending ? 'Armando el examen…' : 'Comenzar simulacro'}
          </button>
        )}
      </div>

      {anteriores.some((i) => i.finalizadoEn) && (
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-2 font-semibold">Simulacros anteriores</h2>
          <ul className="divide-y divide-slate-100">
            {anteriores
              .filter((i) => i.finalizadoEn)
              .map((i) => {
                const nota = Math.round((i.aciertos / Math.max(1, i.cantidad)) * 100);
                return (
                  <li key={i.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="text-slate-500">
                      {new Date(i.iniciadoEn).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                    <span className={`font-semibold ${nota >= SIMULACRO.notaMinima ? 'text-emerald-700' : 'text-red-700'}`}>
                      {nota}/100
                    </span>
                    <a className="ml-auto text-indigo-700 hover:underline" href={`#/simulacro/${i.id}`}>
                      Ver resultado
                    </a>
                  </li>
                );
              })}
          </ul>
        </div>
      )}
    </section>
  );
}

function Regla({ icono, texto }: { icono: string; texto: string }) {
  return (
    <li className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2">
      <span aria-hidden>{icono}</span>
      <span>{texto}</span>
    </li>
  );
}

// ---------- Examen en curso ----------

function Examen({ id }: { id: string }) {
  const cliente = useQueryClient();
  const quiz = useQuery({ queryKey: ['quiz', id], queryFn: () => api<QuizEstado>(`/quizzes/${id}`) });
  const finalizar = useMutation({
    mutationFn: () => api<ResumenQuiz>(`/quizzes/${id}/finalizar`, { metodo: 'POST' }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['quiz', id] });
      cliente.invalidateQueries({ queryKey: ['panel'] });
    },
    onError: (e) => alert(mensajeDeError(e)),
  });

  if (quiz.error) return <p className="text-red-700">{mensajeDeError(quiz.error)}</p>;
  if (quiz.isLoading || !quiz.data) return <p className="text-slate-500">Cargando…</p>;
  const q = quiz.data;
  if (q.modo !== 'SIMULACRO') {
    ir(`quiz/${id}`);
    return null;
  }
  if (q.finalizadoEn) return <ResultadoSimulacro id={id} />;
  return <Rendir quiz={q} terminar={() => finalizar.mutate()} terminando={finalizar.isPending} />;
}

function Rendir({ quiz: q, terminar, terminando }: { quiz: QuizEstado; terminar: () => void; terminando: boolean }) {
  const cliente = useQueryClient();
  const restante = useRestante(q.limiteEn);
  const [indice, setIndice] = useState(() => {
    const i = q.preguntas.findIndex((p) => !p.respondida);
    return i === -1 ? 0 : i;
  });
  const respondidas = q.preguntas.filter((p) => p.respondida).length;
  const vencido = restante !== null && restante <= 0;

  // Tiempo agotado: se entrega solo.
  useEffect(() => {
    if (vencido && !terminando) terminar();
  }, [vencido, terminando, terminar]);
  // Todas respondidas: se entrega solo.
  useEffect(() => {
    if (respondidas === q.cantidad && !terminando) terminar();
  }, [respondidas, q.cantidad, terminando, terminar]);

  const pregunta = q.preguntas[indice];
  const alRegistrar = (r: RespuestaRegistrada) => {
    cliente.setQueryData<QuizEstado>(['quiz', q.id], (v) =>
      v && {
        ...v,
        respondidas: v.respondidas + 1,
        preguntas: v.preguntas.map((p) => (p.id === r.preguntaId ? { ...p, respondida: true, opcionesElegidas: r.opcionIds } : p)),
      },
    );
    const prox = q.preguntas.findIndex((p, i) => i > indice && !p.respondida);
    const cualquiera = q.preguntas.findIndex((p) => !p.respondida && p.id !== r.preguntaId);
    if (prox !== -1) setIndice(prox);
    else if (cualquiera !== -1) setIndice(cualquiera);
  };

  return (
    <section className="mx-auto max-w-2xl space-y-4">
      <div className="sticky top-14 z-[5] flex items-center gap-3 rounded-xl bg-white px-4 py-2 shadow-sm">
        <span className="text-sm font-medium">
          Pregunta {indice + 1} de {q.cantidad}
        </span>
        <span className="text-xs text-slate-500">· {respondidas} respondidas</span>
        <Reloj segundos={restante} />
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full bg-indigo-600 transition-all" style={{ width: `${(respondidas / q.cantidad) * 100}%` }} />
      </div>

      {pregunta && !pregunta.respondida ? (
        <PreguntaSimulacro key={pregunta.id} quizId={q.id} pregunta={pregunta} numero={indice + 1} onRegistrada={alRegistrar} />
      ) : (
        <p className="rounded-2xl bg-white p-6 text-center text-slate-600 shadow-sm">Entregando el examen…</p>
      )}

      <div className="text-center">
        <button
          className="text-sm text-slate-600 hover:underline disabled:opacity-40"
          disabled={terminando}
          onClick={() => {
            const faltan = q.cantidad - respondidas;
            if (confirm(faltan ? `Quedan ${faltan} preguntas sin responder y contarán como error. ¿Entregar el examen?` : '¿Entregar el examen?'))
              terminar();
          }}
        >
          {terminando ? 'Entregando…' : 'Entregar examen ahora'}
        </button>
      </div>
    </section>
  );
}

function PreguntaSimulacro(props: {
  quizId: string;
  pregunta: PreguntaQuiz;
  numero: number;
  onRegistrada: (r: RespuestaRegistrada) => void;
}) {
  const { pregunta: p } = props;
  const [elegida, setElegida] = useState<string | null>(null);
  const inicio = useRef(Date.now());
  const enviar = useMutation({
    mutationFn: () =>
      api<RespuestaRegistrada>(`/quizzes/${props.quizId}/respuestas`, {
        metodo: 'POST',
        cuerpo: {
          preguntaId: p.id,
          opcionIds: [elegida!],
          segundos: Math.min(3600, Math.round((Date.now() - inicio.current) / 1000)),
        } satisfies RespuestaEnviar,
      }),
    onSuccess: props.onRegistrada,
    onError: (e) => alert(mensajeDeError(e)),
  });

  // Teclado: 1-4 / A-D eligen; Enter pasa a la siguiente.
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      const n = '1234'.indexOf(e.key) !== -1 ? Number(e.key) - 1 : 'abcd'.indexOf(e.key.toLowerCase());
      const o = p.opciones[n];
      if (o) setElegida(o.id);
      if (e.key === 'Enter' && elegida && !enviar.isPending) enviar.mutate();
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  });

  return (
    <div className="space-y-4 rounded-2xl bg-white p-4 shadow-sm sm:p-6">
      <p className="text-xs text-slate-500">{p.contenido}</p>
      <p className="whitespace-pre-line text-base font-medium leading-relaxed sm:text-lg">
        {props.numero}. {p.enunciado}
      </p>
      <ul className="space-y-2">
        {p.opciones.map((o, i) => (
          <li key={o.id}>
            <button
              onClick={() => setElegida(o.id)}
              className={`w-full rounded-xl border-2 px-4 py-3 text-left text-sm transition sm:text-base ${
                elegida === o.id ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-200' : 'border-slate-200 hover:border-indigo-300'
              }`}
            >
              <span className="mr-2 font-semibold text-slate-500">{LETRAS[i]})</span>
              {o.texto}
            </button>
          </li>
        ))}
      </ul>
      <button className="btn-primario w-full py-3 text-base" disabled={!elegida || enviar.isPending} onClick={() => enviar.mutate()}>
        {enviar.isPending ? 'Guardando…' : 'Siguiente →'}
      </button>
    </div>
  );
}

/** Segundos que faltan hasta `limiteEn`, actualizado cada segundo. */
function useRestante(limiteEn: string | null) {
  const calcular = () => (limiteEn ? Math.floor((Date.parse(limiteEn) - Date.now()) / 1000) : null);
  const [restante, setRestante] = useState(calcular);
  useEffect(() => {
    const t = setInterval(() => setRestante(calcular()), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limiteEn]);
  return restante;
}

function Reloj({ segundos }: { segundos: number | null }) {
  if (segundos === null) return null;
  const s = Math.max(0, segundos);
  const hh = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  const estilo = s <= 300 ? 'bg-red-100 text-red-800' : s <= 900 ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-800';
  return (
    <span className={`ml-auto rounded-lg px-2.5 py-1 font-mono text-sm font-semibold tabular-nums ${estilo}`} aria-label="Tiempo restante">
      ⏱ {hh}:{mm}:{ss}
    </span>
  );
}

// ---------- Resultado ----------

function ResultadoSimulacro({ id }: { id: string }) {
  const resumen = useQuery({ queryKey: ['resumen', id], queryFn: () => api<ResumenQuiz>(`/quizzes/${id}/resumen`) });
  const [verSinResponder, setVerSinResponder] = useState(false);
  if (resumen.error) return <p className="text-red-700">{mensajeDeError(resumen.error)}</p>;
  if (!resumen.data?.simulacro) return <p className="text-slate-500">Calculando tu nota…</p>;
  const r = resumen.data;
  const s = r.simulacro!;
  const minutos = Math.floor(s.segundosUsados / 60);
  const errores = r.falladas.filter((f) => verSinResponder || !f.sinResponder);

  return (
    <section className="mx-auto max-w-3xl space-y-5">
      <div className={`rounded-2xl p-6 text-center shadow-sm ${s.aprobado ? 'bg-emerald-50' : 'bg-red-50'}`}>
        <p className="text-sm font-medium text-slate-600">Tu nota</p>
        <p className={`text-6xl font-bold tabular-nums ${s.aprobado ? 'text-emerald-700' : 'text-red-700'}`}>
          {s.nota}
          <span className="text-2xl text-slate-500">/100</span>
        </p>
        <p className={`mt-1 text-lg font-semibold ${s.aprobado ? 'text-emerald-800' : 'text-red-800'}`}>
          {s.aprobado ? '¡Aprobado!' : 'No alcanzaste la nota mínima'} <span className="font-normal">(mínimo {s.notaMinima})</span>
        </p>
        <p className="mt-2 text-sm text-slate-600">
          {r.aciertos} correctas · {r.cantidad - r.aciertos - s.sinResponder} incorrectas · {s.sinResponder} sin responder · {minutos} de{' '}
          {s.minutosLimite} min
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold">Por bloque</h2>
          {s.porBloque.map((b) => (
            <Barra key={b.bloque} etiqueta={b.bloque} aciertos={b.aciertos} total={b.total} />
          ))}
        </div>
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold">Por documento <span className="text-xs font-normal text-slate-500">(los más débiles primero)</span></h2>
          <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {s.porContenido.map((c) => (
              <Barra key={c.contenido} etiqueta={c.contenido} aciertos={c.aciertos} total={c.total} compacta />
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-semibold">Repaso de errores ({errores.length})</h2>
          {s.sinResponder > 0 && (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={verSinResponder} onChange={(e) => setVerSinResponder(e.target.checked)} />
              Incluir las {s.sinResponder} sin responder
            </label>
          )}
        </div>
        {errores.length === 0 && <p className="text-sm text-slate-500">¡Sin errores que repasar!</p>}
        <ol className="space-y-3">
          {errores.map((f, i) => (
            <li key={f.preguntaId} className="rounded-xl border border-slate-200 p-3 text-sm">
              <p className="text-xs text-slate-500">{f.contenido}</p>
              <p className="font-medium">
                {i + 1}. {f.enunciado}
              </p>
              {f.sinResponder ? (
                <p className="mt-2 text-amber-800">Sin responder</p>
              ) : (
                <p className="mt-2 text-red-700">✗ Tu respuesta: {f.elegida.join(', ')}</p>
              )}
              <p className="text-emerald-700">✓ Correcta: {f.correctas.join(', ')}</p>
              <p className="mt-2 text-slate-700">{f.explicacion}</p>
              <div className="mt-2 rounded-lg bg-amber-50 p-2">
                <blockquote className="italic text-slate-700">“{f.citaTextual}”</blockquote>
                <p className="mt-1 text-xs font-medium text-amber-900">{f.referencia}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        <a className="btn-primario" href="#/simulacro">
          Otro simulacro
        </a>
        <a className="btn-secundario" href="#/guias">
          Ir a las guías de estudio
        </a>
      </div>
    </section>
  );
}

function Barra({ etiqueta, aciertos, total, compacta }: { etiqueta: string; aciertos: number; total: number; compacta?: boolean }) {
  const pct = total ? Math.round((aciertos / total) * 100) : 0;
  const color = pct >= 70 ? 'bg-emerald-500' : pct >= SIMULACRO.notaMinima ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className={compacta ? 'py-0.5' : 'mb-3'}>
      <div className="flex justify-between gap-2 text-xs">
        <span className="truncate text-slate-700">{etiqueta}</span>
        <span className="shrink-0 text-slate-500">
          {aciertos}/{total} · {pct}%
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
