import Link from "@/components/Link";
import { cloneElement, isValidElement, type ReactNode } from "react";
import { fmtCompacto } from "@/lib/formato";
import { AjusteTabela } from "@/components/AjusteTabela";

export function Page({ title, sub, actions, children }: { title: string; sub?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-3 py-4 sm:px-4 sm:py-6 md:px-8">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-navy sm:text-2xl">{title}</h1>
          {sub && <p className="mt-1 text-sm text-slate-600">{sub}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

export function Card({ title, children, className = "", actions }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={`rounded-md border border-line bg-white ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-semibold text-navy">{title}</h2>
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Flash({ ok, erro }: { ok?: string; erro?: string }) {
  if (!ok && !erro) return null;
  return (
    <div className={`mb-4 rounded-md border px-4 py-2.5 text-sm ${erro ? "border-red-200 bg-red-50 text-erro" : "border-emerald-200 bg-emerald-50 text-ok"}`}>
      {erro ? decodeURIComponent(erro) : decodeURIComponent(ok!)}
    </div>
  );
}

const tone: Record<string, string> = {
  ATIVO: "bg-emerald-50 text-ok border-emerald-200", APROVADA: "bg-emerald-50 text-ok border-emerald-200", APROVADO: "bg-emerald-50 text-ok border-emerald-200", CONCLUIDO: "bg-emerald-50 text-ok border-emerald-200", QUITADO: "bg-emerald-50 text-ok border-emerald-200", RECEBIDO: "bg-emerald-50 text-ok border-emerald-200",
  EM_ADMISSAO: "bg-sky-50 text-acao border-sky-200", ABERTO: "bg-sky-50 text-acao border-sky-200", EM_AQUISICAO: "bg-slate-50 text-slate-600 border-slate-200",
  SOLICITADA: "bg-amber-50 text-aviso border-amber-200", PENDENTE: "bg-amber-50 text-aviso border-amber-200", FERIAS: "bg-amber-50 text-aviso border-amber-200", AFASTADO: "bg-amber-50 text-aviso border-amber-200", VENCE_EM_BREVE: "bg-amber-50 text-aviso border-amber-200",
  DESLIGADO: "bg-slate-100 text-slate-600 border-slate-200", CANCELADA: "bg-slate-100 text-slate-600 border-slate-200", CANCELADO: "bg-slate-100 text-slate-600 border-slate-200",
  REJEITADA: "bg-red-50 text-erro border-red-200", REJEITADO: "bg-red-50 text-erro border-red-200", VENCIDO: "bg-red-50 text-erro border-red-200",
};
export function Badge({ v, label }: { v: string; label?: string }) {
  return <span className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-xs font-medium ${tone[v] ?? "bg-slate-50 text-slate-700 border-slate-200"}`}>{label ?? v}</span>;
}

export { Btn } from "./Btn";

// Rótulo ou dica com “palavra” muito longa (cabeçalho de CSV, identificador) quebra em qualquer ponto para não alargar a página;
// texto comum quebra só entre palavras.
const quebraLonga = (t?: string) => (t && /\S{20,}/.test(t) ? "[overflow-wrap:anywhere]" : "");
// listas de colunas de CSV (a;b;c) quebram depois do ponto e vírgula, não no meio do nome da coluna
const pontosDeQuebra = (t?: string) => (t && /\S{20,}/.test(t) ? t.replace(/;(?=\S)/g, ";\u200b") : t);
export function Field({ label, children, hint, className = "" }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className={`mb-1 block font-medium text-slate-700 ${quebraLonga(label)}`}>{pontosDeQuebra(label)}</span>
      {children}
      {hint && <span className={`mt-1 block text-xs text-slate-500 ${quebraLonga(hint)}`}>{pontosDeQuebra(hint)}</span>}
    </label>
  );
}
export const inputCls = "w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink focus:border-acao focus:outline-none focus:ring-1 focus:ring-acao";
// largura explícita (ex.: "w-20") substitui o w-full padrão — no CSS gerado o w-full venceria e espremeria o rótulo ao lado
const baseCls = (c?: string) => c && /(^|\s)!?w-\S+/.test(c) ? inputCls.replace("w-full ", "") : inputCls;
export function Input(p: React.InputHTMLAttributes<HTMLInputElement>) { return <input {...p} className={`${baseCls(p.className)} ${p.className ?? ""}`} />; }
export function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) { return <select {...p} className={`${baseCls(p.className)} ${p.className ?? ""}`} />; }
export function Textarea(p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea {...p} className={`${inputCls} min-h-[80px] ${p.className ?? ""}`} />; }

// Cabeçalho: texto simples ou { label, className } — p.ex. "hidden sm:table-cell" para esconder a coluna no celular (a célula usa a mesma classe)
export type Cabecalho = string | { label: string; className?: string };
export function Table({ head, children, empty, denso }: { head: Cabecalho[]; children: ReactNode; empty?: string; denso?: boolean }) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <AjusteTabela className="overflow-x-auto rounded-md border border-line bg-white [-webkit-overflow-scrolling:touch]">
      <table className={`w-full text-left text-xs ${denso ? "[&_td]:px-2 [&_th]:px-2" : "sm:text-sm"}`}>
        <thead className="bg-mist text-xs text-slate-600">
          <tr>{head.map((h, i) => <th key={i} className={`whitespace-nowrap px-2 py-2 font-medium 2xl:px-3 ${i === 0 ? "sticky left-0 z-[1] bg-mist" : ""} ${typeof h === "string" ? "" : h.className ?? ""}`}>{typeof h === "string" ? h : h.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.length === 0 ? <tr><td colSpan={head.length} className="px-3 py-6 text-center text-slate-500">{empty ?? "Nada por aqui ainda."}</td></tr> : rows}
        </tbody>
      </table>
    </AjusteTabela>
  );
}
export const Td = ({ children, className = "", colSpan }: { children: ReactNode; className?: string; colSpan?: number }) => <td colSpan={colSpan} className={`px-2 py-2 align-top first:sticky first:left-0 first:z-[1] first:bg-white 2xl:px-3 ${className}`}>{children}</td>;

export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: string; href?: string }) {
  // Valor em reais longo (R$ 10 mil ou mais) quebraria no meio do número num cartão estreito: mostra compacto e leva o valor exato para a dica
  const compactar = (txt: string): string | null => {
    const m = txt.match(/^(-?)R\$\s?([\d.]+),(\d{2})$/);
    if (!m) return null; const n = Number(m[2].replace(/\./g, "") + "." + m[3]); if (n < 10000) return null;
    hint = hint ? `${txt} · ${hint}` : txt; return `${m[1] ? "−" : ""}R$ ${fmtCompacto(n)}`;
  };
  if (typeof value === "string") { const c = compactar(value); if (c) value = c; }
  // valor colorido (<span className="text-ok">R$ …</span>): mesma regra, preservando o elemento
  else if (isValidElement<{ children?: ReactNode }>(value) && typeof value.props.children === "string") { const c = compactar(value.props.children); if (c) value = cloneElement(value, {}, c); }
  // texto longo (p.ex. "R$ 3.800,00" num cartão de 6 colunas): uma fonte menor no desktop em vez de quebrar o número no meio
  const txt = typeof value === "string" ? value : isValidElement<{ children?: ReactNode }>(value) && typeof value.props.children === "string" ? value.props.children : null;
  const longo = txt !== null && txt.length >= 11;
  const inner = (
    <div className="h-full min-w-0 rounded-md border border-line bg-white px-3 py-2.5 sm:px-4 sm:py-3">
      <div className="text-[11px] leading-tight text-slate-600 sm:text-xs">{label}</div>
      <div className={`mt-1 min-w-0 text-lg font-semibold leading-tight tabular-nums text-navy [overflow-wrap:anywhere] ${longo ? "sm:text-base xl:text-lg" : "sm:text-xl xl:text-2xl"}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] leading-tight text-slate-500 sm:text-xs">{hint}</div>}
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{inner}</Link> : inner;
}
