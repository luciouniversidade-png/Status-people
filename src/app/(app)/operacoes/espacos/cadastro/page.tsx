import { redirect } from "next/navigation";
import { requireSession, scopeUnit, can } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge, Flash, Field, Btn, Input, Select } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { getSettings } from "@/lib/utils";
import { TIPO_ESPACO, capacidadeFisica } from "@/lib/espacos";
import { salvarEspaco } from "../actions";
import { SubNavEspacos } from "../_ui";

export const dynamic = "force-dynamic";
type Esp = { id: number; unit_id: number; unidade: string; nome: string; tipo: string; capacidade: number | null; area_m2: string | null; reservavel: boolean; ativo: boolean; obs: string | null; turmas: number; aulas: number };

export default async function Espacos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!can.operacoes(s)) redirect("/operacoes/espacos/reservas");
  const sp = await searchParams; const cfg = await getSettings(); const escopo = scopeUnit(s); const unidade = escopo ?? (sp.unidade ? Number(sp.unidade) : null);
  const [rows, units] = await Promise.all([
    sql<Esp[]>`SELECT sp.id, sp.unit_id, u.nome AS unidade, sp.nome, sp.tipo, sp.capacidade, sp.area_m2::text, sp.reservavel, sp.ativo, sp.obs, (SELECT count(*) FROM classes c WHERE c.space_id=sp.id AND c.ano=${cfg.matriculas.anoLetivo as number})::int AS turmas, (SELECT count(*) FROM teacher_slots t WHERE t.space_id=sp.id AND t.ativo)::int AS aulas FROM spaces sp JOIN units u ON u.id=sp.unit_id ${unidade === null ? sql`` : sql`WHERE sp.unit_id=${unidade}`} ORDER BY u.nome, sp.ativo DESC, sp.tipo, sp.nome`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ${escopo === null ? sql`` : sql`WHERE id=${escopo}`} ORDER BY nome`]);
  const m2 = Number(cfg.espacos.m2PorAluno) || 0;
  const Form = ({ e }: { e?: Esp }) => <form action={salvarEspaco} className="space-y-2">{e && <input type="hidden" name="id" value={e.id} />}<input type="hidden" name="voltar" value={`/operacoes/espacos/cadastro${unidade ? `?unidade=${unidade}` : ""}`} />
    <div className="grid grid-cols-2 gap-2"><Field label="Unidade"><Select name="unitId" required defaultValue={e?.unit_id ?? unidade ?? ""}>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Field label="Tipo"><Select name="tipo" defaultValue={e?.tipo ?? "SALA"}>{Object.entries(TIPO_ESPACO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field></div>
    <Field label="Nome"><Input name="nome" required defaultValue={e?.nome ?? ""} placeholder="Sala 5, Laboratório de Ciências, Projetor 1" /></Field>
    <div className="grid grid-cols-2 gap-2"><Field label="Capacidade (pessoas)" hint="Equipamento: quantidade"><Input name="capacidade" type="number" min={1} defaultValue={e?.capacidade ?? ""} /></Field><Field label="Área (m²)" hint="Sem capacidade, ela vem da área"><Input name="areaM2" type="number" step="0.01" min={0} defaultValue={e?.area_m2 ?? ""} /></Field>
      <Field label="Aceita reservas"><Select name="reservavel" defaultValue={e ? (e.reservavel ? "1" : "0") : "0"}><option value="0">Não</option><option value="1">Sim</option></Select></Field><Field label="Situação"><Select name="ativo" defaultValue={e ? (e.ativo ? "1" : "0") : "1"}><option value="1">Ativo</option><option value="0">Inativo</option></Select></Field></div>
    <Field label="Observação"><Input name="obs" defaultValue={e?.obs ?? ""} /></Field><Btn small>{e ? "Salvar" : "Cadastrar espaço"}</Btn></form>;
  return (
    <Page title="Espaços" sub="Salas, laboratórios, quadras, auditório e equipamentos de cada unidade: capacidade física, quem pode reservar e o uso pelas turmas e pela grade.">
      <SubNavEspacos ativo="/operacoes/espacos/cadastro" gestao />
      <Flash ok={sp.ok} erro={sp.erro} />
      {!escopo && <form className="mb-3 flex flex-wrap items-end gap-2"><Field label="Unidade"><Select name="unidade" defaultValue={unidade ?? ""}><option value="">Todas</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Btn kind="ghost">Filtrar</Btn></form>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <Table head={["Espaço", "Tipo", "Capacidade", "Reservas", "Uso", ""]} empty="Nenhum espaço cadastrado.">
          {rows.map(e => { const cap = capacidadeFisica(e, m2); return <tr key={e.id} className={!e.ativo ? "opacity-60" : ""}><Td className="font-medium">{e.nome}{!escopo && <div className="text-[11px] font-normal text-slate-500">{e.unidade}</div>}</Td><Td>{TIPO_ESPACO[e.tipo]}</Td><Td>{cap.valor ?? "—"}{cap.origem === "pela área" && <div className="text-[11px] text-slate-500">pela área</div>}</Td><Td>{e.reservavel ? <Badge v="APROVADA" label="aceita" /> : "—"}</Td><Td className="text-xs">{e.turmas ? `${e.turmas} turma(s)` : ""}{e.aulas ? `${e.turmas ? " · " : ""}${e.aulas} aula(s) fixas` : ""}{!e.turmas && !e.aulas ? "—" : ""}</Td><Td><Modal label="Editar" title={e.nome}><Form e={e} /></Modal></Td></tr>; })}
        </Table>
        <Card title="Novo espaço"><Form /></Card>
      </div>
    </Page>
  );
}
