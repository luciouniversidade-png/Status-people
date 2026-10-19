import { Modal } from "@/components/Modal";
import Link from "@/components/Link";
import { scopeUnit, can } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Table, Td, Badge, Flash, Field, Btn, Input, Select, Textarea } from "@/components/ui";
import { fmtData, fmtDataHora, getSettings, hoje, addDays } from "@/lib/utils";
import { EXC_STATUS, expirarExcecoes, revisoesPop } from "@/lib/governanca";
import { solicitarExcecao, decidirExcecao, concluirRevisaoPop } from "../actions";
import { requireGestao, popsLista } from "../_shared";

export const dynamic = "force-dynamic";

export default async function Excecoes({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireGestao(); const sp = await searchParams; const cfg = await getSettings(); await expirarExcecoes();
  const u = scopeUnit(s); const status = sp.status ?? "ATIVAS";
  const rows = await sql<{ id: number; regra: string; motivo: string; descricao: string | null; referencia: string | null; status: string; validade_ate: string | null; unidade: string | null; solicitante: string; aprovador: string | null; created_at: Date; motivo_decisao: string | null; solicitante_id: number; pop: string | null }[]>`
    SELECT e.id, e.regra, e.motivo, e.descricao, e.referencia, e.status, e.validade_ate::text, un.nome AS unidade, us.nome AS solicitante, e.solicitante_user_id AS solicitante_id, ua.nome AS aprovador, e.created_at, e.motivo_decisao, p.codigo AS pop
    FROM exceptions e LEFT JOIN units un ON un.id=e.unit_id JOIN users us ON us.id=e.solicitante_user_id LEFT JOIN users ua ON ua.id=e.aprovador_user_id LEFT JOIN procedures p ON p.id=e.procedure_id
    WHERE 1=1 ${u === null ? sql`` : sql`AND (e.unit_id IS NULL OR e.unit_id=${u})`} ${status === "ATIVAS" ? sql`AND e.status IN ('SOLICITADA','APROVADA','EXPIRADA')` : status ? sql`AND e.status=${status}` : sql``}
    ORDER BY (e.status='SOLICITADA') DESC, (e.status='EXPIRADA') DESC, e.created_at DESC LIMIT 300`;
  const [pops, units] = await Promise.all([popsLista(), db.select().from(schema.units).orderBy(asc(schema.units.nome))]);
  const podeAprovar = can.aprovar(s, cfg.alcadas.excecao); const h = hoje();
  return (
    <Page title="Exceções a regras e POPs" sub="Toda exceção tem motivo padronizado, aprovador, validade e revisão. Três exceções iguais em 90 dias = a regra precisa mudar." actions={<Btn kind="ghost" href="/api/export/excecoes">Exportar CSV</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div>
          <form className="mb-3 flex items-end gap-2"><Field label="Situação"><Select name="status" defaultValue={status}><option value="ATIVAS">Pendentes, vigentes e expiradas</option>{Object.entries(EXC_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}<option value="">Todas</option></Select></Field><Btn kind="ghost">Filtrar</Btn></form>
          <Table head={["#", "Regra / POP", "Motivo", "Referência", "Solicitante", "Situação", "Validade", ""]} empty="Nenhuma exceção neste filtro.">
            {rows.map(e => <tr key={e.id}><Td className="text-slate-500">{e.id}</Td><Td><div className="font-medium">{e.regra}</div>{e.pop && <div className="text-xs text-slate-500">{e.pop}</div>}{e.descricao && <div className="max-w-[260px] text-xs text-slate-600">{e.descricao}</div>}</Td><Td className="text-xs">{e.motivo}</Td><Td className="text-xs">{e.referencia ?? "—"}{e.unidade && <div className="text-slate-500">{e.unidade}</div>}</Td><Td className="text-xs">{e.solicitante}<div className="text-slate-500">{fmtDataHora(e.created_at)}</div></Td>
              <Td><Badge v={e.status === "APROVADA" ? "APROVADA" : e.status === "SOLICITADA" ? "SOLICITADA" : e.status === "EXPIRADA" ? "VENCIDO" : e.status === "REJEITADA" ? "REJEITADA" : "CANCELADA"} label={EXC_STATUS[e.status]} />{e.aprovador && <div className="text-xs text-slate-500">{e.aprovador}{e.motivo_decisao ? `: ${e.motivo_decisao}` : ""}</div>}</Td>
              <Td className={`text-xs ${e.status === "APROVADA" && e.validade_ate && e.validade_ate <= addDays(h, 7) ? "font-medium text-aviso" : ""}`}>{fmtData(e.validade_ate)}</Td>
              <Td>{e.status === "SOLICITADA" && podeAprovar && e.solicitante_id !== s.id && <Modal label={"Decidir"} kind="primary"><form action={decidirExcecao} className="space-y-2"><input type="hidden" name="id" value={e.id} /><Field label="Validade até"><Input name="validadeAte" type="date" defaultValue={e.validade_ate ?? ""} /></Field><Field label="Nota"><Input name="nota" /></Field><div className="flex gap-1"><Btn small name="decisao" value="APROVADA">Aprovar</Btn><Btn small kind="ghost" name="decisao" value="REJEITADA">Rejeitar</Btn></div></form></Modal>}
                {(e.status === "EXPIRADA" || e.status === "APROVADA") && <Modal label={"Revisar"} kind="ghost"><form action={decidirExcecao} className="space-y-2"><input type="hidden" name="id" value={e.id} /><input type="hidden" name="decisao" value="REVISADA" /><Field label="Conclusão da revisão"><Input name="nota" placeholder="Ex.: incorporada ao POP-003 v2" required /></Field><Btn small>Encerrar como revisada</Btn></form></Modal>}</Td></tr>)}
          </Table>
        </div>
        <Card title="Solicitar exceção">
          <form action={solicitarExcecao} className="space-y-2"><input type="hidden" name="voltar" value="/governanca/excecoes" />
            <Field label="Regra ou POP excepcionado"><Input name="regra" required placeholder="Ex.: desconto acima da alçada · prazo de matrícula" /></Field>
            <Field label="POP relacionado (opcional)"><Select name="procedureId" defaultValue=""><option value="">—</option>{pops.map(p => <option key={p.id} value={p.id}>{p.codigo} {p.titulo}</option>)}</Select></Field>
            <Field label="Motivo padronizado"><Select name="motivo" required>{cfg.governanca.motivosExcecao.map(m => <option key={m}>{m}</option>)}</Select></Field>
            <Field label="Referência (aluno, contrato, colaborador…)"><Input name="referencia" /></Field>
            <Field label="Descrição"><Textarea name="descricao" className="min-h-[60px]" /></Field>
            <Field label="Impacto (financeiro, pedagógico, legal, reputacional)"><Input name="impacto" /></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="Unidade"><Select name="unitId" defaultValue={u ?? ""}><option value="">Rede</option>{units.filter(x => u === null || x.id === u).map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field><Field label="Validade sugerida"><Input name="validadeAte" type="date" defaultValue={addDays(h, cfg.governanca.excecaoValidadeDias)} /></Field></div>
            <Btn small>Enviar para aprovação</Btn>
            <p className="text-xs text-slate-500">Aprovam: {cfg.alcadas.excecao.join(", ")}. Quem solicita não aprova a própria exceção. Toda exceção expira e é revisada.</p>
          </form>
        </Card>
      </div>
      <RevisoesPop />
    </Page>
  );
}

const DESFECHO: Record<string, string> = { NOVA_VERSAO: "nova versão do POP", MANTIDO: "POP mantido (exceção legítima)", VIROU_REGRA: "virou regra", NC_ABERTA: "virou não conformidade" };
/** CRQ-PRJ-V3-03 · três exceções iguais abrem revisão do POP com evidências e prazo. */
async function RevisoesPop() {
  const rs = await revisoesPop(); const h = hoje();
  return (
    <Card title="Revisões de POP por exceção repetida" className="mt-4"><div id="revisoes" />
      {rs.length === 0 ? <p className="text-sm text-slate-500">Nenhuma revisão aberta: nenhum POP com exceções iguais acima do limite.</p> :
        <Table head={["POP / regra", "Motivo das exceções", "Evidências", "Prazo", "Dono", "Situação"]}>
          {rs.map(r => <tr key={r.id}><Td>{r.procedure_id ? <Link className="text-acao" href={`/governanca/pops/${r.procedure_id}#revisao`}>{r.codigo} {r.titulo}</Link> : r.regra}</Td><Td className="text-xs">{r.motivo}</Td><Td className="text-xs">{r.evidencias.length} exceção(ões): {r.evidencias.map(e => `#${e}`).join(", ")}</Td>
            <Td className={`whitespace-nowrap text-xs ${r.status === "ABERTA" && r.prazo < h ? "font-semibold text-erro" : ""}`}>{fmtData(r.prazo)}</Td><Td className="text-xs">{r.dono ?? "—"}</Td>
            <Td>{r.status === "ABERTA" ? <div className="flex flex-wrap items-center gap-1"><Badge v={r.prazo < h ? "REJEITADA" : "PENDENTE"} label={r.prazo < h ? "vencida" : "aberta"} /><Modal label="Concluir sem mudar o POP" title="Concluir a revisão sem nova versão"><form action={concluirRevisaoPop} className="space-y-2"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="voltar" value="/governanca/excecoes#revisoes" />
                <Field label="Desfecho"><Select name="desfecho" defaultValue="MANTIDO"><option value="MANTIDO">POP mantido — exceção legítima</option><option value="VIROU_REGRA">O caso virou regra (comunicada)</option><option value="NC_ABERTA">Aberta não conformidade</option></Select></Field>
                <Field label="Justificativa"><Textarea name="obs" required minLength={15} /></Field><p className="text-[11px] text-slate-500">Para mudar o procedimento, publique uma nova versão do POP: a revisão fecha sozinha.</p><Btn small>Concluir</Btn></form></Modal></div>
              : <span className="text-xs text-slate-600">concluída em {fmtData(r.concluida_em?.slice(0, 10) ?? null)} · {DESFECHO[r.desfecho ?? ""] ?? r.desfecho}{r.versao_publicada ? ` (v${r.versao_publicada})` : ""}</span>}</Td></tr>)}
        </Table>}
    </Card>
  );
}
