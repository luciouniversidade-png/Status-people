import { Field, Input, Select } from "@/components/ui";
import * as C from "@/lib/cadastro";

/** v34 · campos reaproveitados: arquivos com o tipo de documento e o bloco de um dependente (Meu espaço, ficha de admissão, ficha do RH). */
const ARQ = "block w-full rounded-md border border-line bg-white px-2 py-1.5 text-xs";

export function Arquivos({ tipos, n = 3 }: { tipos: string[]; n?: number }) {
  return <div className="space-y-1.5">{Array.from({ length: n }, (_, i) => <div key={i} className="grid grid-cols-1 gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"><Select name={`doc${i}Tipo`} aria-label={`Tipo do arquivo ${i + 1}`} defaultValue={tipos[0]}>{tipos.map(t => <option key={t}>{t}</option>)}</Select><input type="file" name={`doc${i}`} accept="application/pdf,image/*" className={ARQ} aria-label={`Arquivo ${i + 1}`} /></div>)}</div>;
}
export function CamposDependente({ i = 0 }: { i?: number }) {
  return <div className="space-y-2">
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Field label="Nome completo"><Input name={`dep${i}Nome`} maxLength={120} /></Field><Field label="Parentesco"><Select name={`dep${i}Parentesco`} defaultValue=""><option value="">—</option>{C.PARENTESCO.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field></div>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Field label="Nascimento"><Input type="date" name={`dep${i}Nascimento`} /></Field><Field label="CPF do dependente"><Input name={`dep${i}Cpf`} inputMode="numeric" maxLength={14} /></Field></div>
    <div className="flex flex-wrap gap-3 text-xs"><label className="flex items-center gap-1"><input type="checkbox" name={`dep${i}Irrf`} value="1" /> dependente no imposto de renda</label><label className="flex items-center gap-1"><input type="checkbox" name={`dep${i}Sf`} value="1" /> salário-família (filho até 14 anos)</label><label className="flex items-center gap-1"><input type="checkbox" name={`dep${i}Plano`} value="1" /> plano de saúde (se houver)</label></div>
  </div>;
}

