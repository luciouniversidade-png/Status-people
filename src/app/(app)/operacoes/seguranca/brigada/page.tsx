import { scopeUnit, can } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge, Flash, Field, Btn, Input, Select } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { fmtData } from "@/lib/utils";
import { situacaoBrigada, FUNCAO_BRIGADA } from "@/lib/seguranca";
import { salvarBrigadista } from "../actions";
import { requireSeguranca, SubNavSeg } from "../_ui";

export const dynamic = "force-dynamic";
const SIT: Record<string, [string, string]> = { OK: ["APROVADA", "Treinamento válido"], VENCE: ["PENDENTE", "Vence em até 30 dias"], VENCIDO: ["REJEITADA", "Treinamento vencido"], INATIVO: ["CANCELADA", "Inativo"] };

export default async function Brigada({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSeguranca(); const sp = await searchParams; const escopo = scopeUnit(s); const pode = can.operacoes(s) || s.role === "RH";
  const [b, emps, units] = await Promise.all([situacaoBrigada(escopo), sql<{ id: number; nome: string; unidade: string }[]>`SELECT e.id, e.nome, u.nome AS unidade FROM employees e JOIN units u ON u.id=e.unit_id WHERE e.situacao='ATIVO' ${escopo === null ? sql`` : sql`AND e.unit_id=${escopo}`} ORDER BY e.nome`, sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ${escopo === null ? sql`` : sql`WHERE id=${escopo}`} ORDER BY nome`]);
  type M = typeof b.membros[number];
  const Form = ({ m }: { m?: M }) => <form action={salvarBrigadista} className="space-y-2">{m && <input type="hidden" name="id" value={m.id} />}
    <Field label="Colaborador(a)"><Select name="employeeId" required defaultValue={m?.employee_id ?? ""}><option value="">Escolha</option>{emps.map(e => <option key={e.id} value={e.id}>{e.nome} · {e.unidade}</option>)}</Select></Field>
    <div className="grid grid-cols-2 gap-2"><Field label="Unidade da brigada"><Select name="unitId" defaultValue={m?.unit_id ?? ""}><option value="">A do colaborador</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Field label="Função"><Select name="funcao" defaultValue={m?.funcao ?? "BRIGADISTA"}>{Object.entries(FUNCAO_BRIGADA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
      <Field label="Treinamento em"><Input name="treinamentoEm" type="date" defaultValue={m?.treinamento_em ?? ""} /></Field><Field label="Válido até" hint="Vazio = 12 meses do treinamento"><Input name="validade" type="date" defaultValue={m?.validade ?? ""} /></Field>
      <Field label="Turno"><Select name="turno" defaultValue={m?.turno ?? ""}><option value="">—</option><option>Matutino</option><option>Vespertino</option><option>Integral</option></Select></Field>{m && <Field label="Situação"><Select name="ativo" defaultValue={m.ativo ? "1" : "0"}><option value="1">Ativo</option><option value="0">Inativo</option></Select></Field>}</div>
    <Field label="Observação"><Input name="obs" defaultValue={m?.obs ?? ""} /></Field><Btn small>{m ? "Salvar" : "Incluir na brigada"}</Btn></form>;
  return (
    <Page title="Brigada de emergência" sub={`Brigadistas por unidade com a validade do treinamento. Mínimo configurado: ${b.min} por unidade — ajuste ao plano de emergência aprovado pelo Corpo de Bombeiros.`}>
      <SubNavSeg ativo="/operacoes/seguranca/brigada" />
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{b.porUnidade.map(u => <Card key={u.id} className={u.abaixo ? "border-amber-300" : ""}><div className="text-xs text-slate-500">{u.nome}</div><div className={`text-xl font-semibold ${u.abaixo ? "text-aviso" : "text-navy"}`}>{u.validos} válido(s)</div>{u.abaixo && <div className="text-[11px] text-aviso">abaixo do mínimo ({b.min})</div>}</Card>)}</div>
      <div className={`grid grid-cols-1 gap-4 ${pode ? "lg:grid-cols-[minmax(0,1fr)_320px]" : ""} lg:items-start`}>
        <Table head={["Brigadista", "Função", "Treinamento", "Situação", ""]} empty="Nenhum brigadista cadastrado.">{b.membros.map(m => <tr key={m.id} className={!m.ativo ? "opacity-60" : ""}><Td className="font-medium">{m.nome}<div className="text-[11px] font-normal text-slate-500">{m.unidade}{m.turno ? ` · ${m.turno}` : ""}</div></Td><Td>{FUNCAO_BRIGADA[m.funcao]}</Td><Td className="text-xs">{m.treinamento_em ? fmtData(m.treinamento_em) : "—"}{m.validade ? <div>até {fmtData(m.validade)}</div> : null}</Td><Td><Badge v={SIT[m.situacao][0]} label={SIT[m.situacao][1]} /></Td><Td>{pode && <Modal label="Editar" title={m.nome}><Form m={m} /></Modal>}</Td></tr>)}</Table>
        {pode && <Card title="Incluir brigadista"><Form /></Card>}
      </div>
    </Page>
  );
}
