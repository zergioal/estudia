/**
 * Repetición espaciada: SM-2 simplificado con confianza (docs/diseno.md, "Repetición espaciada").
 * - Fallo → intervalo 1 día, facilidad −0,2 (mínimo 1,3).
 * - Acierto "adiviné" (1) → fallo blando: intervalo 1 día, facilidad igual.
 * - Acierto "dudé" (2) → intervalo × 1,2.
 * - Acierto "seguro" (3) → intervalo × facilidad (1 → 3 → 7 → 18 → 45 días con facilidad 2,5).
 * Sin confianza (p. ej. en el simulacro) un acierto cuenta como "dudé".
 */
export const FACILIDAD_INICIAL = 2.5;
export const FACILIDAD_MINIMA = 1.3;
/** Una pregunta está "dominada" cuando su intervalo llega a una semana. */
export const DIAS_DOMINIO = 7;
/** Tope para que nada desaparezca del repaso por años. */
const INTERVALO_MAXIMO = 180;

export interface EstadoSrs {
  facilidad: number;
  intervaloDias: number;
}

export function siguienteEstado(previo: EstadoSrs | null, correcta: boolean, confianza: number | null | undefined): EstadoSrs {
  const facilidad = previo?.facilidad ?? FACILIDAD_INICIAL;
  const intervalo = previo?.intervaloDias ?? 0;
  if (!correcta) return { facilidad: Math.max(FACILIDAD_MINIMA, redondear(facilidad - 0.2)), intervaloDias: 1 };
  if (confianza === 1) return { facilidad, intervaloDias: 1 };
  const nuevo =
    intervalo === 0
      ? 1 // primer acierto: mañana se confirma
      : confianza === 3
        ? Math.round(intervalo * facilidad)
        : Math.round(intervalo * 1.2);
  // Siempre avanza al menos un día respecto del intervalo anterior.
  return { facilidad, intervaloDias: Math.min(INTERVALO_MAXIMO, Math.max(nuevo, intervalo + 1)) };
}

const redondear = (x: number) => Math.round(x * 100) / 100;

/** Próxima revisión: hoy + intervalo días. */
export const proximaRevision = (ahora: Date, intervaloDias: number) => new Date(ahora.getTime() + intervaloDias * 86_400_000);
