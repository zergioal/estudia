function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre} (revisa .env)`);
  return valor;
}

export const config = {
  get puerto() {
    return Number(process.env.PORT ?? 3000);
  },
  get jwtSecreto() {
    return requerida('JWT_SECRET');
  },
  get jwtExpira() {
    return process.env.JWT_EXPIRA ?? '7d';
  },
  get corsOrigen() {
    return (process.env.CORS_ORIGEN ?? 'http://localhost:5173').split(',').map((o) => o.trim());
  },
};
