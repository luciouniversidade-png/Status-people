import Link from "@/components/Link";
import { Field, Input, Select, Textarea } from "@/components/ui";
import type { Campo } from "@/lib/solicitacoes";
import { fmtData } from "@/lib/utils";
import { fmtValorBr } from "@/lib/solicitacoes";

export function SubNavSol({ ativo, painel, config, pendentes }: { ativo: string; painel: boolean; config: boolean; pendentes: number }) {
  const itens: [string, string][] = [["/solicitacoes?aba=aprovar", `Para eu aprovar${pendentes ? ` (${pendentes})` : ""}`], ["/solicitacoes?aba=minhas", "Minhas"], ...(painel ? [["/solicitacoes?aba=todas", "Todas"] as [string, string]] : []), ["/solicitacoes/nova", "Nova solicitação"], ...(config ? [["/solicitacoes/tipos", "Tipos e aprovações"] as [string, string]] : [])];
  return <nav className="mb-4 flex flex-wrap gap-1">{itens.map(([h, l]) => <Link key={h} href={h} className={`rounded-md px-3 py-1.5 text-sm ${ativo === h ? "bg-navy text-white" : "border border-line bg-white text-navy hover:bg-mist"}`}>{l}</Link>)}</nav>;
}
/** Formulário gerado a partir dos campos do tipo (mesmos nomes que a action lê). */
export function CamposForm({ campos, dados = {} }: { campos: Campo[]; dados?: Record<string, unknown> }) {
  return <div className="space-y-2">{campos.map(c => { const n = `campo_${c.id}`; const v = dados[c.id]; const rot = `${c.rotulo}${c.obrigatorio && c.tipo !== "SIM_NAO" ? "" : " (opcional)"}`;
    if (c.tipo === "TEXTO_LONGO") return <Field key={c.id} label={rot}><Textarea name={n} required={c.obrigatorio} defaultValue={(v as string) ?? ""} /></Field>;
    if (c.tipo === "SELECAO") return <Field key={c.id} label={rot}><Select name={n} required={c.obrigatorio} defaultValue={(v as string) ?? ""}><option value="">Escolha</option>{c.opcoes?.map(o => <option key={o}>{o}</option>)}</Select></Field>;
    if (c.tipo === "SIM_NAO") return <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name={n} value="1" defaultChecked={v === true} /> {c.rotulo}</label>;
    return <Field key={c.id} label={rot}><Input name={n} required={c.obrigatorio} type={c.tipo === "DATA" ? "date" : "text"} inputMode={c.tipo === "NUMERO" || c.tipo === "VALOR" ? "decimal" : undefined} placeholder={c.tipo === "VALOR" ? "0,00" : undefined} defaultValue={v === null || v === undefined ? "" : String(c.tipo === "VALOR" || c.tipo === "NUMERO" ? String(v).replace(".", ",") : v)} /></Field>; })}</div>;
}
export function valorCampo(c: Campo, v: unknown) {
  if (v === null || v === undefined || v === "") return "—";
  if (c.tipo === "VALOR") return fmtValorBr(Number(v)); if (c.tipo === "DATA") return fmtData(String(v)); if (c.tipo === "SIM_NAO") return v ? "sim" : "não";
  return String(v);
}
