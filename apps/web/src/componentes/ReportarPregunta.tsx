import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { MOTIVOS_REPORTE, NOMBRE_MOTIVO, type MotivoReporte, type ReporteCrear } from '@estudia/shared';
import { api, mensajeDeError } from '../api/cliente';

/** Enlace discreto "⚑ Reportar un problema" que despliega un pequeño formulario. */
export function ReportarPregunta({ preguntaId }: { preguntaId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState<MotivoReporte>('RESPUESTA_ERRADA');
  const [comentario, setComentario] = useState('');
  const enviar = useMutation({
    mutationFn: (cuerpo: ReporteCrear) => api(`/preguntas/${preguntaId}/reportes`, { metodo: 'POST', cuerpo }),
    onError: (e) => alert(mensajeDeError(e)),
  });

  if (enviar.isSuccess) return <p className="text-center text-xs text-emerald-700">Gracias: el reporte llegó a la bandeja de calidad.</p>;
  if (!abierto)
    return (
      <button className="mx-auto block text-xs text-slate-500 hover:text-red-700 hover:underline" onClick={() => setAbierto(true)}>
        ⚑ Reportar un problema con esta pregunta
      </button>
    );
  return (
    <form
      className="space-y-2 rounded-xl border border-slate-200 p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        enviar.mutate({ motivo, comentario: comentario.trim() || undefined });
      }}
    >
      <select className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoReporte)} aria-label="Motivo">
        {MOTIVOS_REPORTE.map((m) => (
          <option key={m} value={m}>
            {NOMBRE_MOTIVO[m]}
          </option>
        ))}
      </select>
      <textarea
        className="campo"
        rows={2}
        maxLength={1000}
        value={comentario}
        onChange={(e) => setComentario(e.target.value)}
        placeholder="Opcional: qué está mal y qué dice la norma"
      />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secundario py-1.5" onClick={() => setAbierto(false)}>
          Cancelar
        </button>
        <button className="btn-primario py-1.5" disabled={enviar.isPending}>
          Enviar reporte
        </button>
      </div>
    </form>
  );
}
