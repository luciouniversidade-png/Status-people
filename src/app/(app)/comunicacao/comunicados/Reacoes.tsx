import { reagirComunicado } from "../v34-actions";

export const EMOJIS = ["👍", "❤️", "👏", "🎉", "😮"] as const;

/** v34 · reações num comunicado: um toque marca, outro desmarca. Mostra só a contagem (sem lista de nomes). */
export function Reacoes({ id, contagem, minhas }: { id: number; contagem: Record<string, number>; minhas: string[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1" aria-label="Reações">
      {EMOJIS.map(e => { const n = contagem[e] ?? 0; const meu = minhas.includes(e); return (
        <form key={e} action={reagirComunicado}><input type="hidden" name="id" value={id} /><input type="hidden" name="emoji" value={e} />
          <button className={`rounded-full border px-2 py-0.5 text-xs ${meu ? "border-acao bg-sky-50 text-acao" : "border-line bg-white text-slate-600 hover:bg-mist"}`} aria-pressed={meu} title={meu ? "tirar a sua reação" : "reagir"}>{e}{n ? <span className="ml-1 tabular-nums">{n}</span> : null}</button>
        </form>); })}
    </span>
  );
}
