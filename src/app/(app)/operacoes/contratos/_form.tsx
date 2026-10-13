import { Field, Input, Select, Textarea, Btn } from "@/components/ui";
import { RENOVACAO, INDICES } from "@/lib/contratos";
import { salvarContrato } from "./actions";

export type OpcoesContrato = { fornecedores: { id: number; nome: string }[]; units: { id: number; nome: string }[]; users: { id: number; nome: string }[]; podeRede: boolean };
export type ContratoForm = { id: number; supplier_id: number; unit_id: number | null; objeto: string; numero: string | null; valor_mensal: string | null; valor_total: string | null; inicio: string; fim: string | null; renovacao: string; aviso_previo_dias: number; reajuste_indice: string | null; proximo_reajuste: string | null; responsavel_user_id: number | null; obs: string | null };
export function FormContrato({ o, c }: { o: OpcoesContrato; c?: ContratoForm }) {
  return <form action={salvarContrato} className="space-y-2">{c && <input type="hidden" name="id" value={c.id} />}
    <Field label="Fornecedor"><Select name="supplierId" required defaultValue={c?.supplier_id ?? ""}><option value="">Escolha</option>{o.fornecedores.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}</Select></Field>
    <Field label="Objeto"><Input name="objeto" required defaultValue={c?.objeto ?? ""} placeholder="Manutenção de ar-condicionado, limpeza, transporte…" /></Field>
    <div className="grid grid-cols-2 gap-2"><Field label="Abrangência"><Select name="unitId" defaultValue={c?.unit_id ?? ""}>{o.podeRede && <option value="">Rede</option>}{o.units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Field label="Número"><Input name="numero" defaultValue={c?.numero ?? ""} /></Field>
      <Field label="Início"><Input name="inicio" type="date" required defaultValue={c?.inicio ?? ""} /></Field><Field label="Fim (vazio = indeterminado)"><Input name="fim" type="date" defaultValue={c?.fim ?? ""} /></Field>
      <Field label="Valor mensal (R$)"><Input name="valorMensal" inputMode="decimal" defaultValue={c?.valor_mensal ?? ""} /></Field><Field label="Valor total (R$)"><Input name="valorTotal" inputMode="decimal" defaultValue={c?.valor_total ?? ""} /></Field>
      <Field label="Renovação"><Select name="renovacao" defaultValue={c?.renovacao ?? "MANUAL"}>{Object.entries(RENOVACAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Aviso prévio para não renovar (dias)"><Input name="avisoPrevioDias" type="number" min={0} max={365} defaultValue={c?.aviso_previo_dias ?? 30} /></Field>
      <Field label="Índice de reajuste"><Select name="reajusteIndice" defaultValue={c?.reajuste_indice ?? ""}><option value="">—</option>{INDICES.map(i => <option key={i}>{i}</option>)}</Select></Field><Field label="Próximo reajuste"><Input name="proximoReajuste" type="date" defaultValue={c?.proximo_reajuste ?? ""} /></Field></div>
    <Field label="Responsável pelo contrato"><Select name="responsavelUserId" defaultValue={c?.responsavel_user_id ?? ""}><option value="">—</option>{o.users.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>
    <Field label="Observações (multas, SLA, cláusulas de atenção)"><Textarea name="obs" defaultValue={c?.obs ?? ""} className="min-h-[50px]" /></Field>
    <Btn small>{c ? "Salvar contrato" : "Cadastrar contrato"}</Btn></form>;
}
