import Link from "next/link";
import { requireStaff, scopeUnit, can } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Table, Td, Badge, Flash, Field, Input, Select, Textarea, Btn, Stat } from "@/components/ui";
import { fmtData, getSettings } from "@/lib/utils";
import { REQ_STATUS, REQ_TIPO, ETAPA_LABEL, ORIGEM_CAND, funilVagas } from "@/lib/talento";
import { salvarRequisicao } from "../talento/actions";

export const dynamic = "force-dynamic";

export default async function Recrutamento({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const sp = await searchParams; const cfg = await getSettings(); const u = scopeUnit(s); const status = sp.status ?? "ATIVAS";
  const rows = await sql<{ id: number; titulo: string; cargo: string | null; unidade: string; quantidade: number; tipo: string; status: string; solicitante: string | null; prazo: string | null; aberta_em: string | null; candidatos: number; contratados: number; created_at: Date }[]>`SELECT r.id, r.titulo, p.nome AS cargo, u.nome AS unidade, r.quantidade, r.tipo, r.status, us.nome AS solicitante, r.prazo::text, r.aberta_em::text, (SELECT count(*) FROM applications a WHERE a.requisition_id=r.id AND a.etapa NOT IN ('REPROVADO','DESISTIU'))::int AS candidatos, (SELECT count(*) FROM applications a WHERE a.requisition_id=r.id AND a.etapa='CONTRATADO')::int AS contratados, r.created_at FROM requisitions r JOIN units u ON u.id=r.unit_id LEFT JOIN positions p ON p.id=r.position_id LEFT JOIN users us ON us.id=r.solicitante_user_id WHERE 1=1 ${u === null ? sql`` : sql`AND r.unit_id=${u}`} ${status === "ATIVAS" ? sql`AND r.status IN ('SOLICITADA','APROVADA','ABERTA')` : status ? sql`AND r.status=${status}` : sql``} ORDER BY (r.status='SOLICITADA') DESC, r.created_at DESC`;
  const [funil, units, positions] = await Promise.all([funilVagas(u), db.select().from(schema.units).orderBy(asc(schema.units.nome)), db.select().from(schema.positions).orderBy(asc(schema.positions.ordem))]);
  const gestao = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role);
  return (
    <Page title="Recrutamento e seleção" sub="Requisição de vaga → aprovação → seleção por etapas com scorecard → proposta → contratado vira pré-cadastro com admissão aberta." actions={<><Btn kind="ghost" href="/recrutamento/candidatos">Banco de talentos</Btn><Btn kind="ghost" href="/api/export/vagas">Exportar CSV</Btn></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Stat label="Vagas abertas" value={funil.v.abertas} /><Stat label="Aguardando aprovação" value={<span className={funil.v.solicitadas ? "text-aviso" : ""}>{funil.v.solicitadas}</span>} /><Stat label="Candidatos em processo" value={funil.v.candidatos_ativos} /><Stat label="Preenchidas (90 dias)" value={funil.v.preenchidas_90} /><Stat label="Tempo médio para preencher" value={funil.tempoMedio ? `${Math.round(funil.tempoMedio)} dias` : "—"} />
      </div>
      <div className={`grid gap-4 ${gestao ? "lg:grid-cols-[1fr_340px]" : ""} lg:items-start`}>
        <div className="space-y-4">
          <form className="flex items-end gap-2"><Field label="Situação"><Select name="status" defaultValue={status}><option value="ATIVAS">Ativas</option>{Object.entries(REQ_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}<option value="">Todas</option></Select></Field><Btn kind="ghost">Filtrar</Btn></form>
          <Table head={["Vaga", "Cargo", "Unidade", "Qtd", "Tipo", "Situação", "Candidatos", "Prazo"]} empty="Nenhuma vaga neste filtro.">
            {rows.map(r => <tr key={r.id}><Td><Link className="font-medium text-acao" href={`/recrutamento/vagas/${r.id}`}>{r.titulo}</Link><div className="text-xs text-slate-500">por {r.solicitante ?? "—"} · {fmtData(String(r.created_at).slice(0, 10))}</div></Td><Td className="text-xs">{r.cargo ?? "—"}</Td><Td>{r.unidade}</Td><Td>{r.quantidade}</Td><Td className="text-xs">{REQ_TIPO[r.tipo]}</Td><Td><Badge v={r.status === "ABERTA" ? "EM_ADMISSAO" : r.status === "SOLICITADA" ? "PENDENTE" : r.status === "PREENCHIDA" ? "APROVADA" : "CANCELADA"} label={REQ_STATUS[r.status]} /></Td><Td>{r.candidatos}{r.contratados ? <span className="text-xs text-ok"> · {r.contratados} contratado(s)</span> : ""}</Td><Td className="text-xs">{fmtData(r.prazo)}</Td></tr>)}
          </Table>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card title="Funil por etapa (vagas abertas e preenchidas)"><Table head={["Etapa", "Candidaturas"]} empty="Sem candidaturas.">{[...cfg.recrutamento.etapas, "REPROVADO", "DESISTIU"].map(et => { const n = funil.etapas.find(x => x.etapa === et)?.n ?? 0; return n ? <tr key={et}><Td>{ETAPA_LABEL[et] ?? et}</Td><Td>{n}</Td></tr> : null; })}</Table></Card>
            <Card title="Origem dos candidatos"><Table head={["Origem", "Candidaturas", "Contratados"]} empty="Sem dados.">{funil.origens.map(o => <tr key={o.origem}><Td>{ORIGEM_CAND[o.origem] ?? o.origem}</Td><Td>{o.n}</Td><Td>{o.contratados}</Td></tr>)}</Table></Card>
          </div>
        </div>
        {gestao && <Card title="Solicitar vaga"><form action={salvarRequisicao} className="space-y-2">
          <Field label="Título da vaga"><Input name="titulo" required placeholder="Ex.: Professor de Matemática — Fund II" /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Cargo"><Select name="positionId" defaultValue=""><option value="">—</option>{positions.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</Select></Field><Field label="Unidade"><Select name="unitId" defaultValue={u ?? ""} required>{units.filter(x => u === null || x.id === u).map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field></div>
          <div className="grid grid-cols-3 gap-2"><Field label="Qtd"><Input name="quantidade" type="number" min={1} defaultValue={1} /></Field><Field label="Tipo"><Select name="tipo" defaultValue="SUBSTITUICAO">{Object.entries(REQ_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Regime"><Select name="regime" defaultValue="CLT"><option>CLT</option><option>HORISTA</option><option>ESTAGIARIO</option><option>PJ</option><option>TEMPORARIO</option></Select></Field></div>
          <Field label="Justificativa"><Textarea name="justificativa" className="min-h-[50px]" /></Field><Field label="Requisitos"><Textarea name="requisitos" className="min-h-[50px]" /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Jornada"><Input name="jornada" placeholder="Ex.: 20 aulas/semana" /></Field><Field label="Faixa / remuneração"><Input name="faixa" placeholder="Ex.: G3 · R$ 3.200" /></Field></div>
          <Field label="Prazo desejado"><Input name="prazo" type="date" /></Field>
          <Btn small>Enviar para aprovação</Btn><p className="text-xs text-slate-500">Aprovam: {cfg.alcadas.vagas.join(", ")}.</p></form></Card>}
      </div>
    </Page>
  );
}
