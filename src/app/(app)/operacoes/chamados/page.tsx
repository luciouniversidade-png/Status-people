import Link from "next/link";
import { requireSession, scopeUnit, can } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Table, Td, Badge, Flash, Field, Select, Btn, Input } from "@/components/ui";
import { fmtDataHora, getSettings } from "@/lib/utils";
import { OS_TIPO, OS_STATUS, OS_PRIO, ABERTAS } from "@/lib/operacoes";
import { NovoChamadoForm } from "../_shared";

export const dynamic = "force-dynamic";

export default async function Chamados({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams; const cfg = await getSettings(); const scope = scopeUnit(s); const unitId = scope ?? (sp.unidade ? Number(sp.unidade) : null); const filtro = sp.filtro ?? "ABERTOS"; const q = (sp.q ?? "").trim();
  const meus = !can.operacoes(s);
  const rows = await sql<{ id: number; titulo: string; tipo: string; prioridade: string; status: string; unidade: string; ambiente: string | null; solicitante: string | null; responsavel: string | null; sla_ate: Date | null; created_at: Date; ativo: string | null }[]>`SELECT w.id, w.titulo, w.tipo, w.prioridade, w.status, u.nome AS unidade, w.ambiente, us.nome AS solicitante, ur.nome AS responsavel, w.sla_ate, w.created_at, a.nome AS ativo FROM work_orders w JOIN units u ON u.id=w.unit_id LEFT JOIN users us ON us.id=w.solicitante_user_id LEFT JOIN users ur ON ur.id=w.responsavel_user_id LEFT JOIN assets a ON a.id=w.asset_id
    WHERE 1=1 ${unitId === null ? sql`` : sql`AND w.unit_id=${unitId}`} ${meus ? sql`AND w.solicitante_user_id=${s.id}` : sql``} ${filtro === "ABERTOS" ? sql`AND w.status = ANY(${ABERTAS})` : filtro === "ATRASADOS" ? sql`AND w.status = ANY(${ABERTAS}) AND w.sla_ate < now()` : filtro === "MEUS" ? sql`AND w.status = ANY(${ABERTAS}) AND w.responsavel_user_id=${s.id}` : filtro === "CONCLUIDOS" ? sql`AND w.status='CONCLUIDO'` : sql``} ${q ? sql`AND (w.titulo ILIKE ${"%" + q + "%"} OR w.ambiente ILIKE ${"%" + q + "%"})` : sql``}
    ORDER BY (w.status = ANY(${ABERTAS})) DESC, (w.prioridade='URGENTE') DESC, w.sla_ate NULLS LAST, w.created_at DESC LIMIT 400`;
  const units = scope ? [] : await db.select().from(schema.units).orderBy(asc(schema.units.nome)); const agora = Date.now();
  return (
    <Page title="Chamados e ordens de serviço" sub={meus ? "Seus chamados. Abra um novo ao lado e acompanhe a situação." : "Todos os chamados. Urgente = risco à segurança; o SLA vem da prioridade."} actions={can.operacoes(s) ? <Btn kind="ghost" href="/api/export/chamados">Exportar CSV</Btn> : undefined}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px] lg:items-start">
        <div>
          <form className="mb-3 grid gap-2 rounded-md border border-line bg-white p-3 sm:grid-cols-[1fr_170px_170px_auto]"><Field label="Buscar"><Input name="q" defaultValue={q} placeholder="Título ou ambiente" /></Field><Field label="Situação"><Select name="filtro" defaultValue={filtro}><option value="ABERTOS">Abertos</option><option value="ATRASADOS">SLA vencido</option>{!meus && <option value="MEUS">Sob minha responsabilidade</option>}<option value="CONCLUIDOS">Concluídos</option><option value="TODOS">Todos</option></Select></Field>{!scope ? <Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Todas</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field> : <div />}<div className="flex items-end"><Btn kind="ghost">Filtrar</Btn></div></form>
          <Table head={["#", "Chamado", "Tipo", "Unidade · ambiente", "Prioridade", "Situação", "Prazo", "Responsável"]} empty="Nenhum chamado neste filtro.">
            {rows.map(w => { const aberto = ABERTAS.includes(w.status); const atrasado = aberto && w.sla_ate && new Date(w.sla_ate).getTime() < agora; return <tr key={w.id} className={atrasado ? "bg-red-50/40" : ""}><Td className="text-slate-500">{w.id}</Td><Td><Link className="font-medium text-acao" href={`/operacoes/chamados/${w.id}`}>{w.titulo}</Link>{w.ativo && <div className="text-xs text-slate-500">{w.ativo}</div>}<div className="text-xs text-slate-500">por {w.solicitante ?? "—"} · {fmtDataHora(w.created_at)}</div></Td><Td className="text-xs">{OS_TIPO[w.tipo]}</Td><Td className="text-xs">{w.unidade}{w.ambiente ? ` · ${w.ambiente}` : ""}</Td><Td><Badge v={w.prioridade === "URGENTE" ? "REJEITADA" : w.prioridade === "ALTA" ? "PENDENTE" : "EM_AQUISICAO"} label={OS_PRIO[w.prioridade].split(" ")[0]} /></Td><Td><Badge v={w.status === "CONCLUIDO" ? "APROVADA" : w.status === "CANCELADO" ? "CANCELADA" : w.status === "AGUARDANDO" ? "PENDENTE" : "EM_ADMISSAO"} label={OS_STATUS[w.status]} /></Td><Td className={`whitespace-nowrap text-xs ${atrasado ? "font-medium text-erro" : "text-slate-600"}`}>{aberto ? fmtDataHora(w.sla_ate) : "—"}</Td><Td className="text-xs">{w.responsavel ?? "—"}</Td></tr>; })}
          </Table>
        </div>
        <NovoChamadoForm s={s} voltar="/operacoes/chamados" cfg={cfg.operacoes} />
      </div>
    </Page>
  );
}
