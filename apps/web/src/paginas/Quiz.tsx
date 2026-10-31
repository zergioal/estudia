import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Feedback, PreguntaQuiz, QuizEstado, RespuestaEnviar, ResumenQuiz } from '@estudia/shared';
import { api, mensajeDeError } from '../api/cliente';
import { ReportarPregunta } from '../componentes/ReportarPregunta';
import { ir } from '../navegacion';

const LETRAS = ['A', 'B', 'C', 'D', 'E', 'F'];
const NOMBRE_MODO: Record<string, string> = { REPASO_DIARIO: '🔁 Repaso de hoy', REPASO_ERRORES: '📕 Cuaderno de errores' };

/** "mañana", "en 3 días", "en 2 semanas"… */
const cuando = (dias: number) =>
  dias <= 1 ? 'mañana' : dias < 14 ? `en ${dias} días` : dias < 60 ? `en ${Math.round(dias / 7)} semanas` : `en ${Math.round(dias / 30)} meses`;
const CONFIANZAS = [
  { valor: 3, texto: 'Seguro' },
  { valor: 2, texto: 'Dudé' },
  { valor: 1, texto: 'Adiviné' },
] as const;

export function Quiz({ id }: { id: string }) {
  const cliente = useQueryClient();
  const quiz = useQuery({ queryKey: ['quiz', id], queryFn: () => api<QuizEstado>(`/quizzes/${id}`) });
  const [indice, setIndice] = useState<number | null>(null);

  // Al cargar, retoma en la primera pregunta sin responder.
  useEffect(() => {
    if (quiz.data && indice === null) {
      const primera = quiz.data.preguntas.findIndex((p) => !p.feedback);
      setIndice(primera === -1 ? quiz.data.preguntas.length - 1 : primera);
    }
  }, [quiz.data, indice]);

  const finalizar = useMutation({
    mutationFn: () => api<ResumenQuiz>(`/quizzes/${id}/finalizar`, { metodo: 'POST' }),
    onSuccess: () => {
      cliente.invalidateQueries({ queryKey: ['panel'] });
      ir(`resultado/${id}`);
    },
    onError: (e) => alert(mensajeDeError(e)),
  });

  // Un quiz ya finalizado no se puede seguir respondiendo: se muestra su resultado.
  // Los simulacros tienen su propia pantalla (sin feedback y con reloj).
  useEffect(() => {
    if (quiz.data?.modo === 'SIMULACRO') ir(`simulacro/${id}`);
    else if (quiz.data?.finalizadoEn) ir(`resultado/${id}`);
  }, [quiz.data, id]);

  if (quiz.error) return <p className="text-red-700">{mensajeDeError(quiz.error)}</p>;
  if (quiz.isLoading || indice === null || quiz.data?.finalizadoEn) return <p className="text-slate-500">Cargando quiz…</p>;
  const q = quiz.data!;
  const pregunta = q.preguntas[indice]!;
  const respondidas = q.preguntas.filter((p) => p.feedback).length;
  const esUltima = q.preguntas.every((p, i) => i === indice || p.feedback);

  const alResponder = (feedback: Feedback) => {
    cliente.setQueryData<QuizEstado>(['quiz', id], (viejo) =>
      viejo && {
        ...viejo,
        puntaje: viejo.puntaje + feedback.xp,
        aciertos: viejo.aciertos + (feedback.correcta ? 1 : 0),
        respondidas: viejo.respondidas + 1,
        preguntas: viejo.preguntas.map((p) => (p.id === pregunta.id ? { ...p, feedback } : p)),
      },
    );
  };
  const siguiente = () => {
    const prox = q.preguntas.findIndex((p, i) => i > indice && !p.feedback);
    const cualquiera = q.preguntas.findIndex((p) => !p.feedback && p.id !== pregunta.id);
    if (prox !== -1) setIndice(prox);
    else if (cualquiera !== -1) setIndice(cualquiera);
    else finalizar.mutate();
  };

  return (
    <section className="mx-auto max-w-2xl space-y-4">
      {NOMBRE_MODO[q.modo] && <p className="text-sm font-semibold text-indigo-700">{NOMBRE_MODO[q.modo]}</p>}
      <div className="flex items-center gap-3 text-sm">
        <span className="font-medium">
          {indice + 1} / {q.cantidad}
        </span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full bg-indigo-600 transition-all" style={{ width: `${(respondidas / q.cantidad) * 100}%` }} />
        </div>
        <span className="text-slate-600">
          {q.aciertos} ✓ · {q.puntaje} XP
        </span>
      </div>

      <TarjetaPregunta
        key={pregunta.id}
        quizId={id}
        pregunta={pregunta}
        onRespondida={alResponder}
        onSiguiente={siguiente}
        esUltima={esUltima}
        finalizando={finalizar.isPending}
      />

      <div className="flex justify-between text-sm">
        <button className="text-slate-600 hover:underline disabled:opacity-40" disabled={indice === 0} onClick={() => setIndice(indice - 1)}>
          ← Anterior
        </button>
        <button
          className="text-slate-600 hover:underline"
          onClick={() => confirm('¿Terminar el quiz ahora? Las preguntas sin responder no cuentan.') && finalizar.mutate()}
        >
          Terminar quiz
        </button>
        <button
          className="text-slate-600 hover:underline disabled:opacity-40"
          disabled={indice === q.preguntas.length - 1}
          onClick={() => setIndice(indice + 1)}
        >
          Saltar →
        </button>
      </div>
    </section>
  );
}

function TarjetaPregunta(props: {
  quizId: string;
  pregunta: PreguntaQuiz;
  onRespondida: (f: Feedback) => void;
  onSiguiente: () => void;
  esUltima: boolean;
  finalizando: boolean;
}) {
  const { pregunta: p } = props;
  const [elegidas, setElegidas] = useState<string[]>([]);
  const inicio = useRef(Date.now());
  const multiple = p.tipo === 'SELECCION_MULTIPLE';
  const fb = p.feedback;

  const responder = useMutation({
    mutationFn: (confianza: number) =>
      api<Feedback>(`/quizzes/${props.quizId}/respuestas`, {
        metodo: 'POST',
        cuerpo: {
          preguntaId: p.id,
          opcionIds: elegidas,
          confianza,
          segundos: Math.min(3600, Math.round((Date.now() - inicio.current) / 1000)),
        } satisfies RespuestaEnviar,
      }),
    onSuccess: props.onRespondida,
    onError: (e) => alert(mensajeDeError(e)),
  });

  const elegir = (opcionId: string) => {
    if (fb) return;
    setElegidas((e) => (multiple ? (e.includes(opcionId) ? e.filter((x) => x !== opcionId) : [...e, opcionId]) : [opcionId]));
  };

  // Teclado: 1-4 / A-D eligen, Enter responde con "Seguro" o pasa a la siguiente.
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const n = '1234'.indexOf(e.key) !== -1 ? Number(e.key) - 1 : 'abcd'.indexOf(e.key.toLowerCase());
      const opcion = p.opciones[n];
      if (opcion && !fb) elegir(opcion.id);
      if (e.key === 'Enter') {
        if (fb) props.onSiguiente();
        else if (elegidas.length && !responder.isPending) responder.mutate(3);
      }
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  });

  const estiloOpcion = (id: string) => {
    if (!fb) return elegidas.includes(id) ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-200' : 'border-slate-200 hover:border-indigo-300';
    const o = fb.opciones.find((x) => x.id === id);
    if (o?.correcta) return 'border-emerald-500 bg-emerald-50';
    if (fb.opcionesElegidas.includes(id)) return 'border-red-400 bg-red-50';
    return 'border-slate-200 opacity-70';
  };

  return (
    <div className="space-y-4 rounded-2xl bg-white p-4 shadow-sm sm:p-6">
      <p className="text-xs text-slate-500">
        {p.contenido} › {p.tema} · {p.dificultad === 'DIFICIL' ? 'Difícil' : p.dificultad === 'MEDIA' ? 'Media' : 'Fácil'}
      </p>
      <p className="whitespace-pre-line text-base font-medium leading-relaxed sm:text-lg">{p.enunciado}</p>
      {multiple && !fb && <p className="text-xs text-indigo-700">Marca todas las correctas.</p>}

      <ul className="space-y-2">
        {p.opciones.map((o, i) => {
          const conFb = fb?.opciones.find((x) => x.id === o.id);
          return (
            <li key={o.id}>
              <button
                className={`w-full rounded-xl border-2 px-4 py-3 text-left text-sm transition sm:text-base ${estiloOpcion(o.id)}`}
                onClick={() => elegir(o.id)}
                disabled={Boolean(fb)}
              >
                <span className="mr-2 font-semibold text-slate-500">{LETRAS[i]})</span>
                {o.texto}
                {conFb?.porQue && (fb!.opcionesElegidas.includes(o.id) || conFb.correcta) && (
                  <span className="mt-1 block text-xs text-slate-600">{conFb.porQue}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {!fb ? (
        <div>
          <p className="mb-2 text-center text-xs text-slate-500">Responder con tu nivel de seguridad:</p>
          <div className="grid grid-cols-3 gap-2">
            {CONFIANZAS.map((c) => (
              <button
                key={c.valor}
                className={c.valor === 3 ? 'btn-primario py-3' : 'btn-secundario py-3'}
                disabled={elegidas.length === 0 || responder.isPending}
                onClick={() => responder.mutate(c.valor)}
              >
                {c.texto}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className={`rounded-xl px-4 py-3 font-semibold ${fb.correcta ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
            {fb.correcta ? `¡Correcto! +${fb.xp} XP` : 'Incorrecto'}
            {fb.proximoRepasoDias !== null && (
              <span className="block text-xs font-normal opacity-80">Próximo repaso de esta pregunta: {cuando(fb.proximoRepasoDias)}</span>
            )}
          </p>
          <div className="text-sm">
            <p className="text-xs font-semibold uppercase text-slate-500">Explicación</p>
            <p className="whitespace-pre-line">{fb.explicacion}</p>
          </div>
          <div className="rounded-xl bg-amber-50 p-3 text-sm">
            <p className="text-xs font-semibold uppercase text-amber-800">Fuente</p>
            <blockquote className="italic">“{fb.citaTextual}”</blockquote>
            <p className="mt-1 text-xs font-medium text-amber-900">{fb.referencia}</p>
          </div>
          <button className="btn-primario w-full py-3" onClick={props.onSiguiente} disabled={props.finalizando}>
            {props.esUltima ? 'Ver resultado' : 'Siguiente →'}
          </button>
          <ReportarPregunta key={p.id} preguntaId={p.id} />
        </div>
      )}
    </div>
  );
}
