import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QuizCrearEntrada, QuizEstado } from '@estudia/shared';
import { api, mensajeDeError } from '../api/cliente';
import { ir } from '../navegacion';

/** Crea un quiz (práctica o repaso) y abre la pantalla del quiz. */
export function useCrearQuiz() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (datos: QuizCrearEntrada) => api<QuizEstado>('/quizzes', { metodo: 'POST', cuerpo: datos }),
    onSuccess: (q) => {
      cliente.invalidateQueries({ queryKey: ['panel'] });
      ir(`quiz/${q.id}`);
    },
    onError: (e) => alert(mensajeDeError(e)),
  });
}
