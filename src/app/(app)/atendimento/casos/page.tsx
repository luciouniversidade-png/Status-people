import Link from "next/link";
import { requireMatriculas, scopeUnit } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Table, Td, Badge, Flash, Select, Field, Btn, Input } from "@/components/ui";
import { fmtDataHora, getSettings } from "@/lib/utils";
import { escalarVencidos, CASE_TIPOS, CASE_TIPO_LABEL, CASE_STATUS, CASE_PRIO, ABERTOS } from "@/lib/atendimento";
import { NovoCasoForm } from "../_shared";

export const dynamic = "force-dynamic";

export default async function Casos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireMatriculas(); const sp = await searchParams; const cfg = await getSettings(); await escalarVencidos();
  const scope = scopeUnit(s); const unitId = scope ?? (sp.unidade ? Number(sp.unidade) : null); const filtro = sp.filtro ?? "ABERTOS"; const tipo = sp.tipo ?? ""; const q = (sp.q ?? "").trim();
  const rows = await sql<{ id: number; assunto: string; tipo: string; status: string; prioridade: string; unidade: string; aluno: string | null; student_id: number | null; contato: string | null; responsavel: string | null; sla_ate: Date | null; escalado: boolean; created_at: Date; categoria: string | null; gravidade: number | null; resultado: string | null }[]>`
    SELECT c.id, c.assunto, c.tipo, c.status, c.prioridade, u.nome AS unidade, st.nome AS aluno, c.student_id, c.contato_nome AS contato, us.nome AS responsavel, c.sla_ate, (c.escalado_em IS NOT NULL) AS escalado, c.created_at, c.categoria, c.gravidade, c.resultado
    FROM cases c JOIN units u ON u.id=c.unit_id LEFT JOIN students st ON st.id=c.student_id LEFT JOIN users us ON us.id=c.responsavel_user_id
    WHERE 1=1 ${unitId === null ? sql`` : sql`AND c.unit_id=${unitId}`} ${tipo ? sql`AND c.tipo=${tipo}` : sql``}
      ${filtro === "ABERTOS" ? sql`AND c.status = ANY(${ABERTOS})` : filtro === "ATRASADOS" ? sql`AND c.status = ANY(${ABERTOS}) AND c.sla_ate < now()` : filtro === "MEUS" ? sql`AND c.status = ANY(${ABERTOS}) AND c.responsavel_user_id=${s.id}` : filtro === "FECHADOS" ? sql`AND c.status IN ('RESOLVIDO','FECHADO')` : sql``}
      ${q ? sql`AND (c.assunto ILIKE ${"%" + q + "%"} OR st.nome ILIKE ${"%" + q + "%"} OR c.contato_nome ILIKE ${"%" + q + "%"})` : sql``}
    ORDER BY (c.status = ANY(${ABERTOS})) DESC, (c.sla_ate < now()) DESC, c.sla_ate NULLS LAST, c.created_at DESC LIMIT 400`;
  const units = scope ? [] : await db.select().from(schema.units).orderBy(asc(schema.units.nome));
  const agora = Date.now();
  return (
    <Page title="Casos de atendimento" sub="Solicitações, dúvidas, reclamações, elogios e pedidos de saída — com responsável e prazo (SLA)." actions={<Btn kind="ghost" href="/api/export/casos">Exportar CSV</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div>
          <form className="mb-3 grid gap-2 rounded-md border border-line bg-white p-3 sm:grid-cols-[1fr_170px_170px_150px_auto]">
            <Field label="Buscar"><Input name="q" defaultValue={q} placeholder="Assunto, aluno ou contato" /></Field>
            <Field label="Situação"><Select name="filtro" defaultValue={filtro}><option value="ABERTOS">Abertos</option><option value="ATRASADOS">SLA vencido</option><option value="MEUS">Meus casos</option><option value="FECHADOS">Resolvidos/fechados</option><option value="TODOS">Todos</option></Select></Field>
            <Field label="Tipo"><Select name="tipo" defaultValue={tipo}><option value="">Todos</option>{CASE_TIPOS.map(t => <option key={t} value={t}>{CASE_TIPO_LABEL[t]}</option>)}</Select></Field>
            {!scope ? <Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Todas</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field> : <div />}
            <div className="flex items-end"><Btn kind="ghost">Filtrar</Btn></div>
          </form>
          <Table head={["#", "Assunto", "Família", "Tipo", "Unidade", "Prioridade", "Situação", "Prazo", "Responsável"]} empty="Nenhum caso neste filtro.">
            {rows.map(c => { const venc = c.sla_ate ? new Date(c.sla_ate).getTime() : null; const aberto = ABERTOS.includes(c.status); const atrasado = aberto && venc !== null && venc < agora; return (
              <tr key={c.id} className={atrasado ? "bg-red-50/40" : ""}>
                <Td className="text-slate-500">{c.id}</Td>
                <Td><Link className="font-medium text-acao" href={`/atendimento/casos/${c.id}`}>{c.assunto}</Link>{c.categoria && <div className="text-xs text-slate-500">{c.categoria}{c.gravidade ? ` · gravidade ${c.gravidade}` : ""}</div>}{c.escalado && aberto && <Badge v="REJEITADA" label="escalado" />}</Td>
                <Td>{c.student_id ? <Link className="text-acao" href={`/matriculas/alunos/${c.student_id}#atendimento`}>{c.aluno}</Link> : c.contato ?? <span className="text-slate-400">avulso</span>}</Td>
                <Td>{CASE_TIPO_LABEL[c.tipo]}{c.tipo === "SAIDA" && c.resultado && c.resultado !== "EM_ANDAMENTO" && <div className="text-xs">{c.resultado === "RETIDO" ? "retida" : "perdida"}</div>}</Td><Td>{c.unidade}</Td>
                <Td><Badge v={c.prioridade === "URGENTE" ? "REJEITADA" : c.prioridade === "ALTA" ? "PENDENTE" : "EM_AQUISICAO"} label={CASE_PRIO[c.prioridade]} /></Td>
                <Td><Badge v={c.status === "FECHADO" || c.status === "RESOLVIDO" ? "APROVADA" : c.status === "AGUARDANDO_FAMILIA" ? "PENDENTE" : "EM_ADMISSAO"} label={CASE_STATUS[c.status]} /></Td>
                <Td className={`whitespace-nowrap text-xs ${atrasado ? "font-medium text-erro" : "text-slate-600"}`}>{aberto ? fmtDataHora(c.sla_ate) : fmtDataHora(c.created_at)}</Td><Td className="text-xs">{c.responsavel ?? "—"}</Td>
              </tr>); })}
          </Table>
        </div>
        <NovoCasoForm s={s} categorias={cfg.atendimento.categorias} voltar="/atendimento/casos" />
      </div>
    </Page>
  );
}
