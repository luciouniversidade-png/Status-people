import Link from "@/components/Link";
import type { ReactNode } from "react";

/**
 * Quadro em colunas (kanban) do ONE — HTML puro no servidor. Cada coluna mostra a quantidade e, quando faz sentido, um total;
 * cada cartão traz o que importa para decidir (prazo, responsável, dias parado) e o link para agir no módulo.
 * No celular as colunas rolam de lado, uma de cada vez; na impressão, quebram em linhas.
 */
export type TomCartao = "bom" | "atencao" | "ruim" | "neutro";
const SELO: Record<TomCartao, string> = { bom: "bg-emerald-50 text-ok border-emerald-200", atencao: "bg-amber-50 text-aviso border-amber-200", ruim: "bg-red-50 text-erro border-red-200", neutro: "bg-slate-50 text-slate-600 border-slate-200" };
export type CartaoQuadro = {
  chave: string; titulo: ReactNode; href?: string; linhas?: ReactNode[]; selos?: { texto: string; tom: TomCartao }[];
  responsavel?: string | null; rodape?: ReactNode; acoes?: ReactNode; destaque?: TomCartao | null;
};
export type ColunaQuadro = { chave: string; titulo: string; cor: string; total?: string | null; descricao?: string; itens: CartaoQuadro[]; mais?: { texto: string; href: string } | null };

const iniciais = (n: string) => n.split(" ").filter(Boolean).slice(0, 2).map(x => x[0]).join("").toUpperCase();
const BORDA: Record<TomCartao, string> = { bom: "border-l-ok", atencao: "border-l-aviso", ruim: "border-l-erro", neutro: "border-l-slate-200" };

export function Quadro({ colunas, rotulo, max = 40 }: { colunas: ColunaQuadro[]; rotulo: string; max?: number }) {
  return (
    <div role="region" aria-label={rotulo} className="-mx-3 overflow-x-auto px-3 pb-2 [-webkit-overflow-scrolling:touch] sm:mx-0 sm:px-0 print:overflow-visible">
      <div className="flex snap-x snap-mandatory gap-3 print:flex-wrap" style={{ minWidth: "min-content" }}>
        {colunas.map(c => (
          <section key={c.chave} aria-label={`${c.titulo}: ${c.itens.length}`} className="flex w-[17.5rem] shrink-0 snap-start flex-col rounded-md border border-line bg-mist/60 sm:w-72 xl:w-auto xl:min-w-[15rem] xl:flex-1 xl:shrink print:w-[31%]">
            <header className="rounded-t-md border-t-4 bg-white px-3 py-2" style={{ borderTopColor: c.cor }}>
              <div className="flex items-baseline justify-between gap-2"><h3 className="truncate text-sm font-semibold text-navy">{c.titulo}</h3><span className="rounded-full bg-mist px-2 text-xs tabular-nums text-slate-600">{c.itens.length}</span></div>
              {(c.total || c.descricao) && <div className="mt-0.5 text-[11px] text-slate-500">{c.total}{c.total && c.descricao ? " · " : ""}{c.descricao}</div>}
            </header>
            <ol className="flex-1 space-y-2 p-2">
              {c.itens.length === 0 && <li className="rounded border border-dashed border-line px-3 py-4 text-center text-xs text-slate-400">Nenhum item</li>}
              {c.itens.slice(0, max).map(it => (
                <li key={it.chave} className={`rounded-md border border-line border-l-4 bg-white px-3 py-2 shadow-[0_1px_0_rgba(15,23,42,0.04)] ${BORDA[it.destaque ?? "neutro"]}`}>
                  <div className="text-sm font-medium leading-snug [overflow-wrap:anywhere]">{it.href ? <Link href={it.href} className="text-navy hover:text-acao hover:underline">{it.titulo}</Link> : it.titulo}</div>
                  {it.linhas?.filter(Boolean).map((l, i) => <div key={i} className="mt-0.5 text-xs text-slate-500 [overflow-wrap:anywhere]">{l}</div>)}
                  {(it.selos?.length || it.responsavel) ? <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {it.selos?.map((s, i) => <span key={i} className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${SELO[s.tom]}`}>{s.texto}</span>)}
                    {it.responsavel && <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-slate-500" title={it.responsavel}><span aria-hidden className="grid h-5 w-5 place-items-center rounded-full bg-navy text-[9px] font-semibold text-white">{iniciais(it.responsavel)}</span><span className="max-w-[7rem] truncate">{it.responsavel.split(" ")[0]}</span></span>}
                  </div> : null}
                  {it.rodape && <div className="mt-1 text-[11px] text-slate-500">{it.rodape}</div>}
                  {it.acoes && <div className="mt-2 border-t border-line pt-2 print:hidden">{it.acoes}</div>}
                </li>
              ))}
              {c.itens.length > max && <li className="px-1 text-center text-xs text-slate-500">e mais {c.itens.length - max}{c.mais ? <> · <Link href={c.mais.href} className="text-acao hover:underline">{c.mais.texto}</Link></> : null}</li>}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
