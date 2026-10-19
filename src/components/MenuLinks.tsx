"use client";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { NavLink } from "./NavLink";

/** Item do menu que corresponde à tela atual: o caminho mais específico que contém a tela ("/" só no próprio Início). */
export function itemAtivo(path: string, hrefs: string[]): string | null {
  let melhor: string | null = null;
  for (const h of hrefs) {
    const base = h.split("?")[0];
    const casa = base === "/" ? path === "/" : path === base || path.startsWith(`${base}/`);
    if (casa && (melhor === null || base.length > melhor.split("?")[0].length)) melhor = h;
  }
  return melhor;
}

/**
 * Menu do ONE (celular e computador): títulos dos grupos e links, com a tela atual destacada.
 * No computador o menu tem rolagem própria; ao abrir uma tela cujo item está fora da vista, o menu rola até ele.
 */
export function MenuLinks({ grupos, cls, ativoCls, rolar = false }: { grupos: [string, [string, string][]][]; cls: string; ativoCls: string; rolar?: boolean }) {
  const path = usePathname() ?? "/"; const ref = useRef<HTMLDivElement>(null);
  const alvo = itemAtivo(path, grupos.flatMap(([, xs]) => xs.map(([h]) => h)));
  useEffect(() => {
    if (!rolar || !window.matchMedia("(min-width: 768px)").matches) return;
    const el = ref.current?.querySelector<HTMLElement>('[aria-current="page"]'); const caixa = ref.current?.closest("aside");
    if (!el || !caixa) return;
    const r = el.getBoundingClientRect(), b = caixa.getBoundingClientRect();
    if (r.top < b.top + 8 || r.bottom > b.bottom - 8) caixa.scrollTop += r.top - b.top - b.height / 3;
  }, [alvo, rolar]);
  let marcado = false;
  return (
    <div ref={ref} className="contents">
      {grupos.flatMap(([titulo, items]) => [
        titulo ? <div key={"t" + titulo} className="mt-2 px-3 pb-1 text-[10px] uppercase tracking-widest text-sky-300/80">{titulo}</div> : null,
        ...items.map(([href, label]) => { const ativo = !marcado && href === alvo; if (ativo) marcado = true; return <NavLink key={href} href={href} className={cls} ativo={ativo} ativoClassName={ativoCls}>{label}</NavLink>; }),
      ])}
    </div>
  );
}
