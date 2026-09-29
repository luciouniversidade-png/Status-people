import Link from "@/components/Link";
import { faixa, FAIXA_LABEL, fmtNota, descricaoQuadrante } from "@/lib/avaliacao";

export type PontoMatriz = { id: number; nome: string; A: number; R: number; href: string; provisoria?: boolean };
/** Matriz 4×4 Atitudes (vertical) × Resultados (horizontal). Nomes visíveis só para quem já tem acesso às avaliações. */
export function MatrizEquipe({ pontos, titulo = "Atitudes × Resultados" }: { pontos: PontoMatriz[]; titulo?: string }) {
  const cel = (fa: number, fr: number) => pontos.filter(p => faixa(p.A) === fa && faixa(p.R) === fr);
  const cor = (fa: number, fr: number) => fa === 4 && fr === 4 ? "bg-emerald-100" : fa + fr >= 6 ? "bg-emerald-50" : fa + fr >= 4 ? "bg-amber-50" : "bg-red-50";
  return (
    <div><div className="mb-2 text-sm font-semibold text-navy">{titulo}</div>
      <div className="overflow-x-auto"><div className="grid min-w-[420px] grid-cols-[70px_repeat(4,1fr)] gap-1 text-[11px]">
        <div /><div className="col-span-4 text-center font-medium text-slate-600">Resultados →</div>
        <div /><div className="text-center text-slate-500">1 – 1,9</div><div className="text-center text-slate-500">2 – 2,9</div><div className="text-center text-slate-500">3 – 3,9</div><div className="text-center text-slate-500">4 – 5</div>
        {[4, 3, 2, 1].map(fa => <div key={fa} className="contents"><div className="flex items-center justify-center text-center text-slate-600">{fa === 4 ? "Atitudes ↑ 4–5" : fa === 3 ? "3–3,9" : fa === 2 ? "2–2,9" : "1–1,9"}</div>{[1, 2, 3, 4].map(fr => { const ps = cel(fa, fr); return <div key={fr} title={descricaoQuadrante(fa + 0.5, fr + 0.5)} className={`min-h-[64px] rounded p-1 ${cor(fa, fr)}`}><div className="text-right text-base font-semibold text-navy">{ps.length || ""}</div><div className="space-y-0.5">{ps.slice(0, 6).map(p => <Link key={p.id} href={p.href} className={`block truncate text-acao ${p.provisoria ? "italic opacity-70" : ""}`}>{p.nome.split(" ")[0]} {p.nome.split(" ").slice(-1)[0]?.[0]}. · {fmtNota(p.R)}/{fmtNota(p.A)}</Link>)}{ps.length > 6 && <div className="text-slate-500">+{ps.length - 6}</div>}</div></div>; })}</div>)}
      </div></div>
      <p className="mt-2 text-[11px] text-slate-500">Faixas: {Object.entries(FAIXA_LABEL).map(([k, v]) => `${k}: ${v}`).join(" · ")}. Posição descreve evidências do período, não a pessoa. Notas provisórias em itálico.</p>
    </div>
  );
}
