import { useTema, type PreferenciaTema } from '../tema';

const OPCIONES: { valor: PreferenciaTema; icono: string; nombre: string }[] = [
  { valor: 'claro', icono: '☀️', nombre: 'Modo claro' },
  { valor: 'oscuro', icono: '🌙', nombre: 'Modo oscuro' },
  { valor: 'sistema', icono: '🖥️', nombre: 'Como el sistema' },
];

export function SelectorTema() {
  const { preferencia, setPreferencia } = useTema();
  return (
    <div className="flex rounded-lg border border-slate-300 p-0.5" role="radiogroup" aria-label="Tema">
      {OPCIONES.map((o) => (
        <button
          key={o.valor}
          role="radio"
          aria-checked={preferencia === o.valor}
          title={o.nombre}
          onClick={() => setPreferencia(o.valor)}
          className={`rounded-md px-1.5 py-0.5 text-sm leading-none ${
            preferencia === o.valor ? 'bg-slate-200' : 'opacity-60 hover:opacity-100'
          }`}
        >
          {o.icono}
        </button>
      ))}
    </div>
  );
}
