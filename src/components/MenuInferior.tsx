"use client";
import { usePathname } from "next/navigation";
import { NavLink } from "./NavLink";
import { itemAtivo } from "./MenuLinks";

/** Menu inferior no celular (Cap. 4.2): os 5 destinos do papel sempre a um toque; some no computador e na impressão. */
export function MenuInferior({ itens, alertas = 0 }: { itens: { href: string; rotulo: string; icone: string }[]; alertas?: number }) {
  const path = usePathname() ?? "/"; const alvo = itemAtivo(path, itens.map(i => i.href));
  return (
    <nav aria-label="Atalhos do seu papel" className="menu-inferior fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_12px_-6px_rgba(0,0,0,0.18)] backdrop-blur md:hidden print:hidden" style={{ gridTemplateColumns: `repeat(${itens.length}, minmax(0, 1fr))` }}>
      {itens.map(i => <NavLink key={i.href} href={i.href} ativo={i.href === alvo} ativoClassName="!text-acao font-semibold" className="relative min-w-0 flex-col justify-center !gap-0 px-1 py-1.5 text-center text-[10.5px] leading-tight text-slate-600"><span aria-hidden className="text-lg leading-none">{i.icone}</span><span className="mt-0.5 block w-full truncate">{i.rotulo}</span>{i.href === "/alertas" && alertas > 0 && <span className="absolute right-[22%] top-1 rounded-full bg-erro px-1 text-[9px] font-semibold text-white">{alertas > 99 ? "99+" : alertas}</span>}</NavLink>)}
    </nav>
  );
}
