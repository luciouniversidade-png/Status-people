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

// ------------------------------------------------------------------ v32 · telas por pessoa (ajuste sobre o cargo)
type Caixa = HTMLInputElement;
const caixasAjuste = (raiz: Element | null | undefined) => [...(raiz?.querySelectorAll<Caixa>('input[type="checkbox"][name="telas"][data-base]:not(:disabled)') ?? [])];
const avisar = (cs: Caixa[]) => cs.forEach(c => c.dispatchEvent(new Event("change", { bubbles: true })));

/** “Todas / nenhuma / como o cargo” de um grupo do menu (o “como o cargo” devolve cada tela do grupo ao que o cargo dá). */
export function MarcarGrupoAjuste() {
  const ref = useRef<HTMLSpanElement>(null);
  const aplicar = (f: (c: Caixa) => boolean) => { const cs = caixasAjuste(ref.current?.closest("fieldset")); cs.forEach(c => { c.checked = f(c); }); avisar(cs); };
  return (
    <span ref={ref} className="ml-2 inline-flex flex-wrap gap-1 align-middle text-[11px] font-normal">
      <button type="button" onClick={() => aplicar(() => true)} className="rounded border border-line px-1.5 py-0.5 text-acao hover:bg-mist">todas</button>
      <button type="button" onClick={() => aplicar(() => false)} className="rounded border border-line px-1.5 py-0.5 text-slate-600 hover:bg-mist">nenhuma</button>
      <button type="button" onClick={() => aplicar(c => c.dataset.base === "1")} className="rounded border border-line px-1.5 py-0.5 text-slate-600 hover:bg-mist">como o cargo</button>
    </span>
  );
}

/** Botões do formulário inteiro: tudo como o cargo, marcar tudo, desmarcar tudo. */
export function MarcarTudoAjuste() {
  const ref = useRef<HTMLDivElement>(null);
  const aplicar = (f: (c: Caixa) => boolean) => { const cs = caixasAjuste(ref.current?.closest("form")); cs.forEach(c => { c.checked = f(c); }); avisar(cs); };
  return (
    <div ref={ref} className="flex flex-wrap gap-1.5 text-xs">
      <button type="button" onClick={() => aplicar(c => c.dataset.base === "1")} className="rounded-md border border-line bg-white px-2 py-1 font-medium text-navy hover:bg-mist">Tudo como o cargo</button>
      <button type="button" onClick={() => aplicar(() => true)} className="rounded-md border border-line bg-white px-2 py-1 text-acao hover:bg-mist">Marcar todas</button>
      <button type="button" onClick={() => aplicar(() => false)} className="rounded-md border border-line bg-white px-2 py-1 text-slate-600 hover:bg-mist">Desmarcar todas</button>
    </div>
  );
}

/** Contador ao vivo do ajuste: telas marcadas e quantas ficam a mais e a menos que o cargo. */
export function ContadorAjuste({ total, form }: { total: number; form?: string }) {
  const ref = useRef<HTMLSpanElement>(null); const [n, setN] = useState<{ marcadas: number; mais: number; menos: number } | null>(null);
  useEffect(() => {
    // o contador fica no cabeçalho do cartão (fora do formulário): acha o formulário pelo id
    const f = (form ? document.getElementById(form) : null) ?? ref.current?.closest("form"); if (!f) return;
    const conta = () => { const cs = [...f.querySelectorAll<Caixa>('input[type="checkbox"][name="telas"][data-base]')];
      const fixas = f.querySelectorAll('input[type="checkbox"]:disabled:checked').length; // as telas pessoais (sempre) também contam no total
      setN({ marcadas: cs.filter(c => c.checked).length + fixas, mais: cs.filter(c => c.checked && c.dataset.base === "0").length, menos: cs.filter(c => !c.checked && c.dataset.base === "1").length }); };
    conta(); f.addEventListener("change", conta); return () => f.removeEventListener("change", conta);
  }, [form]);
  return <span ref={ref} aria-live="polite" className="text-xs font-normal text-slate-600">{n === null ? "" : <>{n.marcadas} de {total} telas · <b className="text-ok">+{n.mais}</b> a mais · <b className="text-erro">−{n.menos}</b> a menos que o cargo</>}</span>;
}

/** “Todas / nenhuma” de uma lista de pessoas (ajuste em lote). */
export function MarcarPessoas({ nome = "users" }: { nome?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const marcar = (v: boolean) => { const cs = [...(ref.current?.closest("[data-lista]")?.querySelectorAll<Caixa>(`input[type="checkbox"][name="${nome}"]:not(:disabled)`) ?? [])]; cs.forEach(c => { c.checked = v; }); avisar(cs); };
  return (
    <span ref={ref} className="inline-flex gap-1 text-[11px] font-normal">
      <button type="button" onClick={() => marcar(true)} className="rounded border border-line px-1.5 py-0.5 text-acao hover:bg-mist">todas</button>
      <button type="button" onClick={() => marcar(false)} className="rounded border border-line px-1.5 py-0.5 text-slate-600 hover:bg-mist">nenhuma</button>
    </span>
  );
}

/** Quantas pessoas e telas estão marcadas no formulário do lote. */
export function ContadorLote() {
  const ref = useRef<HTMLSpanElement>(null); const [n, setN] = useState<[number, number] | null>(null);
  useEffect(() => {
    const f = ref.current?.closest("form"); if (!f) return;
    const conta = () => setN([f.querySelectorAll('input[type="checkbox"][name="users"]:checked').length, f.querySelectorAll('input[type="checkbox"][name="telas"]:checked').length]);
    conta(); f.addEventListener("change", conta); return () => f.removeEventListener("change", conta);
  }, []);
  return <span ref={ref} aria-live="polite" className="text-xs text-slate-600">{n === null ? "" : `${n[0]} pessoa(s) · ${n[1]} tela(s) marcadas`}</span>;
}
