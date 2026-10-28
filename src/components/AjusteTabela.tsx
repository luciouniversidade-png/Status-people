"use client";
import { useLayoutEffect, useRef, type ReactNode } from "react";

/** v28 · Contêiner de tabela que se ajusta à largura disponível. Se a tabela não cabe no cartão, primeiro deixa os títulos
 *  das colunas quebrarem linha (nível 1), depois reduz a letra e o espaçamento (níveis 2 e 3). Só se ainda assim não couber
 *  é que fica a rolagem lateral. Recalcula quando a largura muda (janela, menu, cartão aberto). */
export function AjusteTabela({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    let largura = -1;
    const ajustar = () => {
      const w = el.clientWidth; if (w === largura) return; largura = w;
      delete el.dataset.ajuste;
      for (const n of ["1", "2", "3"]) { if (el.scrollWidth <= el.clientWidth + 1) break; el.dataset.ajuste = n; }
    };
    ajustar();
    const ro = new ResizeObserver(ajustar); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <div ref={ref} className={className}>{children}</div>;
}
