"use client";
import { useEffect, useRef, useState } from "react";

/** “Todas / nenhuma” das telas de um grupo (marca e desmarca as caixas do grupo; as telas fixas ficam como estão). */
export function MarcarGrupo() {
  const ref = useRef<HTMLSpanElement>(null);
  const marcar = (v: boolean) => { ref.current?.closest("fieldset")?.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="telas"]:not(:disabled)').forEach(c => { c.checked = v; c.dispatchEvent(new Event("change", { bubbles: true })); }); };
  return (
    <span ref={ref} className="ml-2 inline-flex gap-1 align-middle text-[11px] font-normal">
      <button type="button" onClick={() => marcar(true)} className="rounded border border-line px-1.5 py-0.5 text-acao hover:bg-mist">todas</button>
      <button type="button" onClick={() => marcar(false)} className="rounded border border-line px-1.5 py-0.5 text-slate-600 hover:bg-mist">nenhuma</button>
    </span>
  );
}

/** Contador ao vivo: quantas telas estão marcadas no formulário. */
export function ContadorTelas({ total }: { total: number }) {
  const ref = useRef<HTMLSpanElement>(null); const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    const f = ref.current?.closest("form"); if (!f) return;
    const conta = () => setN(f.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="telas"]:checked, input[type="checkbox"][data-fixa]:checked').length);
    conta(); f.addEventListener("change", conta); return () => f.removeEventListener("change", conta);
  }, []);
  return <span ref={ref} className="text-xs font-normal text-slate-500">{n === null ? "" : `${n} de ${total} telas marcadas`}</span>;
}

/** “Seguir o padrão da atuação”: enquanto marcado, as caixas de aprovação ficam só de leitura (o padrão vale). */
export function SeguePadrao({ marcado, children }: { marcado: boolean; children: React.ReactNode }) {
  const [on, setOn] = useState(marcado);
  return (
    <div>
      <label className="mb-2 flex items-start gap-2 rounded-md bg-mist px-3 py-2 text-sm"><input type="checkbox" name="seguePadrao" value="1" checked={on} onChange={e => setOn(e.target.checked)} className="mt-0.5" /><span><b>Seguir o padrão da atuação</b> <span className="text-xs text-slate-600">(Configurações → Aprovações: padrão de cada atuação). Desmarque para escolher, neste cargo, exatamente o que ele aprova.</span></span></label>
      <fieldset disabled={on} className={on ? "opacity-60" : ""}>{children}</fieldset>
    </div>
  );
}
