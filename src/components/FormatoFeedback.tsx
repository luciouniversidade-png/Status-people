"use client";
// v31 · campos do feedback conforme o formato: livre / elogio / sugestão (um texto) ou situação · comportamento · impacto (três campos).
import { useState } from "react";
const inputCls = "w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink focus:border-acao focus:outline-none focus:ring-1 focus:ring-acao";

type Formatos = Record<string, { rotulo: string; dica: string }>;
export function FormatoFeedback({ formatos, inicial, texto, situacao, comportamento, impacto, assunto }: { formatos: Formatos; inicial: string; texto?: string | null; situacao?: string | null; comportamento?: string | null; impacto?: string | null; assunto?: string | null }) {
  const [f, setF] = useState(formatos[inicial] ? inicial : "LIVRE");
  const label = "mb-1 block text-xs font-medium text-slate-700";
  return <>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_16rem]">
      <label className="block"><span className={label}>Assunto</span><input name="assunto" maxLength={120} defaultValue={assunto ?? ""} placeholder="P.ex., Sua capacidade de resolver conflitos (opcional)" className={inputCls} /></label>
      <label className="block"><span className={label}>Formato</span><select name="formato" value={f} onChange={e => setF(e.target.value)} className={inputCls}>{Object.entries(formatos).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}</select></label>
    </div>
    {f === "SCI" ? <div className="space-y-3">
      <label className="block"><span className={label}>Situação — quando e onde</span><textarea name="situacao" defaultValue={situacao ?? ""} className={`${inputCls} min-h-[56px]`} placeholder="Ex.: Na reunião de planejamento de terça, com a equipe do Fundamental II" /></label>
      <label className="block"><span className={label}>Comportamento — o que a pessoa fez (fato observável)</span><textarea name="comportamento" defaultValue={comportamento ?? ""} className={`${inputCls} min-h-[56px]`} placeholder="Ex.: Você trouxe os dados das turmas e propôs dividir as tarefas por série" /></label>
      <label className="block"><span className={label}>Impacto — o efeito que isso teve</span><textarea name="impacto" defaultValue={impacto ?? ""} className={`${inputCls} min-h-[56px]`} placeholder="Ex.: Terminamos no horário e cada professor saiu sabendo o que fazer" /></label>
    </div> : <label className="block"><span className={label}>Feedback</span><textarea name="texto" defaultValue={texto ?? ""} className={`${inputCls} min-h-[150px]`} placeholder={formatos[f]?.dica} /></label>}
    <p className="text-[11px] text-slate-500">{formatos[f]?.dica}</p>
  </>;
}
