/** Navegación por hash: ir('quiz/abc') → #/quiz/abc */
export const ir = (ruta: string) => {
  window.location.hash = `#/${ruta}`;
};
