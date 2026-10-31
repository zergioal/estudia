import { useQuery } from '@tanstack/react-query';
import type { ResumenQuiz } from '@estudia/shared';
import { api, mensajeDeError } from '../api/cliente';

export function Resultado({ id }: { id: string }) {
  const r = useQuery({ queryKey: ['resumen', id], queryFn: () => api<ResumenQuiz>(`/quizzes/${id}/resumen`) });
  if (r.isLoading) return <p className="text-slate-500">Cargando resultado…</p>;
  if (r.error) return <p className="text-red-700">{mensajeDeError(r.error)}</p>;
  const d = r.data!;
  // Referencia del examen real: nota mínima 51/100 (Reglamento Convocatoria Pública 0001/2026, Art. 14).
  const aprobaria = d.porcentaje >= 51;

  return (
    <section className="mx-auto max-w-2xl space-y-4">
      <div className="rounded-2xl bg-white p-5 text-center shadow-sm">
        <p className="text-sm text-slate-500">Resultado</p>
        <p className={`text-5xl font-bold ${aprobaria ? 'text-emerald-600' : 'text-red-600'}`}>{d.porcentaje}%</p>
        <p className="mt-1 text-slate-700">
          {d.aciertos} de {d.respondidas} correctas{d.respondidas < d.cantidad && ` (${d.cantidad - d.respondidas} sin responder)`}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {aprobaria ? 'Por encima' : 'Por debajo'} de la nota mínima del examen (51/100)
          {d.segundosPromedio !== null && ` · ${d.segundosPromedio} s por pregunta (el examen da 90 s)`}
        </p>
        <div className="mt-3 flex justify-center gap-6 text-sm">
          <span>
            <b className="text-indigo-700">+{d.puntaje}</b> XP
          </span>
          <span>
            <b className="text-indigo-700">{d.xpTotal}</b> XP total
          </span>
          <span>
            <b className="text-indigo-700">{d.rachaDias}</b> {d.rachaDias === 1 ? 'día' : 'días'} de racha
          </span>
        </div>
        <a href="#/estudiar" className="btn-primario mt-4 w-full py-3">
          Nuevo quiz
        </a>
      </div>

      {d.porTema.length > 0 && (
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-2 font-semibold">Aciertos por tema</h2>
          <ul className="space-y-2">
            {d.porTema.map((t) => {
              const pct = Math.round((t.aciertos / t.total) * 100);
              return (
                <li key={`${t.contenido}|${t.tema}`} className="text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="truncate">
                      <span className="text-slate-500">{t.contenido} › </span>
                      {t.tema}
                    </span>
                    <span className="shrink-0 font-medium">
                      {t.aciertos}/{t.total}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                    <div className={`h-full ${pct >= 70 ? 'bg-emerald-500' : pct >= 51 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {d.falladas.length > 0 && (
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-2 font-semibold">Para repasar ({d.falladas.length})</h2>
          <ul className="space-y-3">
            {d.falladas.map((f) => (
              <li key={f.preguntaId} className="rounded-xl border border-slate-200 p-3 text-sm">
                <p className="font-medium">{f.enunciado}</p>
                <p className="mt-1 text-red-700">✗ Tu respuesta: {f.elegida.join('; ')}</p>
                <p className="text-emerald-700">✓ Correcta: {f.correctas.join('; ')}</p>
                <p className="mt-2 text-slate-700">{f.explicacion}</p>
                <p className="mt-2 rounded bg-amber-50 p-2 text-xs italic">
                  “{f.citaTextual}” <span className="not-italic font-medium">— {f.referencia}</span>
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
