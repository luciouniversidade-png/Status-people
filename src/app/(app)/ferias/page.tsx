import Link from "next/link";
import { requireStaff, scopeUnit, can } from "@/lib/auth";
import { sql, db, schema } from "@/db";
import { asc, and, ne, eq } from "drizzle-orm";
import { Page, Table, Td, Badge, Flash, Select, Field, Btn, Card, Input, Textarea } from "@/components/ui";
import { fmtData, LEAVE_LABEL, LEAVE_STATUS, LEAVE_TIPOS, getSettings, hoje } from "@/lib/utils";
import { solicitarAfastamento, decidirAfastamento } from "./actions";
import { feriasAVencer } from "@/lib/ferias";

export const dynamic = "force-dynamic";

export default async function Ferias({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const sp = await searchParams; const u = scopeUnit(s); const cfg = await getSettings();
  const status = sp.status ?? "SOLICITADA"; const h = hoje();
  const rows = await sql<{ id: number; nome: string; employee_id: number; unidade: string; tipo: string; inicio: string; fim: string; dias: number; status: string; justificativa: string | null; solicitado_por: number | null }[]>`
    SELECT l.id, e.nome, e.id AS employee_id, u.nome AS unidade, l.tipo, l.inicio::text, l.fim::text, l.dias, l.status, l.justificativa, l.solicitado_por
    FROM leave_requests l JOIN employees e ON e.id=l.employee_id JOIN units u ON u.id=e.unit_id
    WHERE 1=1 ${status ? sql`AND l.status=${status}` : sql``} ${u === null ? sql`` : sql`AND e.unit_id=${u}`}
    ORDER BY l.status='SOLICITADA' DESC, l.inicio DESC LIMIT 300`;
  const emps = await db.select({ id: schema.employees.id, nome: schema.employees.nome, unitId: schema.employees.unitId }).from(schema.employees).where(u === null ? ne(schema.employees.situacao, "DESLIGADO") : and(ne(schema.employees.situacao, "DESLIGADO"), eq(schema.employees.unitId, u))).orderBy(asc(schema.employees.nome));
  const podeAprovar = can.aprovar(s, cfg.alcadas.ferias); const sensivel = can.verSensivel(s);
  const alertas = await feriasAVencer(u, 90);
  return (
    <Page title="Férias e afastamentos" sub="Solicitações passam por aprovação. O saldo de férias é calculado pelos períodos aquisitivos de cada colaborador." actions={<Btn kind="ghost" href="/api/export/ferias">Exportar CSV</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {alertas.length > 0 && (
        <Card title={`Períodos de férias a vencer — ${alertas.length}`} className="mb-4 border-amber-200">
          <div id="vencendo" />
          <p className="mb-2 text-xs text-slate-600">Prazo de concessão vencendo em 90 dias ou já vencido: férias não concedidas até o fim do período concessivo geram pagamento em dobro (CLT, art. 137).</p>
          <Table head={["Colaborador", "Unidade", "Período aquisitivo", "Conceder até", "Saldo (dias)", "Situação"]}>
            {alertas.map(a => <tr key={`${a.employeeId}-${a.periodo.inicio}`}><Td><Link className="text-acao" href={`/colaboradores/${a.employeeId}#ferias`}>{a.nome}</Link></Td><Td>{a.unidade}</Td><Td>{fmtData(a.periodo.inicio)} – {fmtData(a.periodo.fim)}</Td><Td className={a.periodo.status === "VENCIDO" ? "font-medium text-erro" : "font-medium text-aviso"}>{fmtData(a.periodo.concessivoAte)}</Td><Td>{a.periodo.saldo}</Td><Td><Badge v={a.periodo.status} label={a.periodo.status === "VENCIDO" ? "Vencido" : "Vence em breve"} /></Td></tr>)}
          </Table>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div>
          <form className="mb-3 flex flex-wrap items-end gap-2">
            <Field label="Situação"><Select name="status" defaultValue={status}><option value="SOLICITADA">Aguardando aprovação</option><option value="APROVADA">Aprovadas</option><option value="REJEITADA">Rejeitadas</option><option value="CANCELADA">Canceladas</option><option value="">Todas</option></Select></Field>
            <Btn kind="ghost">Filtrar</Btn>
          </form>
          <Table head={["Colaborador", "Unidade", "Tipo", "Período", "Dias", "Situação", ""]} empty="Nenhuma solicitação neste filtro.">
            {rows.map(l => (
              <tr key={l.id}>
                <Td><Link className="text-acao" href={`/colaboradores/${l.employee_id}#ferias`}>{l.nome}</Link>{l.justificativa && (sensivel || l.tipo !== "AFASTAMENTO_SAUDE") && <div className="max-w-[220px] text-xs text-slate-500">{l.justificativa}</div>}</Td>
                <Td>{l.unidade}</Td><Td>{LEAVE_LABEL[l.tipo]}</Td><Td className="whitespace-nowrap">{fmtData(l.inicio)} – {fmtData(l.fim)}</Td><Td>{l.dias}</Td>
                <Td><Badge v={l.status} label={LEAVE_STATUS[l.status]} /></Td>
                <Td>{l.status === "SOLICITADA" && (podeAprovar || l.solicitado_por === s.id || can.editar(s)) && (
                  <form action={decidirAfastamento} className="flex flex-wrap gap-1"><input type="hidden" name="id" value={l.id} /><input type="hidden" name="voltar" value={`/ferias?status=${status}`} />
                    {podeAprovar && l.solicitado_por !== s.id && <><Btn small name="decisao" value="APROVADA">Aprovar</Btn><Btn small kind="ghost" name="decisao" value="REJEITADA">Rejeitar</Btn></>}
                    <Btn small kind="ghost" name="decisao" value="CANCELADA">Cancelar</Btn></form>)}
                  {l.status === "APROVADA" && l.inicio > h && can.editar(s) && <form action={decidirAfastamento}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="voltar" value={`/ferias?status=${status}`} /><Btn small kind="ghost" name="decisao" value="CANCELADA">Cancelar</Btn></form>}</Td>
              </tr>
            ))}
          </Table>
        </div>
        {can.solicitar(s) && (
          <Card title="Nova solicitação">
            <form action={solicitarAfastamento} className="space-y-2"><input type="hidden" name="voltar" value="/ferias" />
              <Field label="Colaborador"><Select name="employeeId" required><option value="">Escolha</option>{emps.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</Select></Field>
              <Field label="Tipo"><Select name="tipo" defaultValue="FERIAS">{LEAVE_TIPOS.map(t => <option key={t} value={t}>{LEAVE_LABEL[t]}</option>)}</Select></Field>
              <div className="grid grid-cols-2 gap-2"><Field label="Início"><Input name="inicio" type="date" required /></Field><Field label="Fim"><Input name="fim" type="date" required /></Field></div>
              <Field label="Justificativa"><Textarea name="justificativa" className="min-h-[60px]" /></Field>
              <Btn>Enviar para aprovação</Btn>
              <p className="text-xs text-slate-500">Férias: mínimo 5 dias corridos, dentro do saldo do período aquisitivo mais antigo. Aprovam: {cfg.alcadas.ferias.join(", ")}.</p>
            </form>
          </Card>
        )}
      </div>
    </Page>
  );
}
