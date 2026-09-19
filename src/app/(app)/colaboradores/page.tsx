import Link from "next/link";
import { requireStaff, scopeUnit, can } from "@/lib/auth";
import { sql, db, schema } from "@/db";
import { Page, Btn, Table, Td, Badge, Flash, Select, Input, Field } from "@/components/ui";
import { fmtData, SITUACAO_LABEL, VINCULO_LABEL, hoje } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Colaboradores({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const sp = await searchParams;
  const scope = scopeUnit(s);
  const unitId = scope ?? (sp.unidade ? Number(sp.unidade) : null);
  const q = (sp.q ?? "").trim(); const sit = sp.situacao ?? "ATIVOS";
  const h = hoje();
  const rows = await sql<{ id: number; nome: string; unidade: string; cargo: string | null; vinculo: string; admissao: string; situacao: string; ferias: boolean; afastado: boolean }[]>`
    SELECT e.id, e.nome, u.nome AS unidade, p.nome AS cargo, e.vinculo, e.admissao::text, e.situacao,
      EXISTS (SELECT 1 FROM leave_requests l WHERE l.employee_id=e.id AND l.status='APROVADA' AND l.tipo='FERIAS' AND l.inicio<=${h} AND l.fim>=${h}) AS ferias,
      EXISTS (SELECT 1 FROM leave_requests l WHERE l.employee_id=e.id AND l.status='APROVADA' AND l.tipo IN ('AFASTAMENTO_SAUDE','LICENCA') AND l.inicio<=${h} AND l.fim>=${h}) AS afastado
    FROM employees e JOIN units u ON u.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id
    WHERE 1=1
      ${unitId ? sql`AND e.unit_id=${unitId}` : sql``}
      ${sit === "ATIVOS" ? sql`AND e.situacao <> 'DESLIGADO'` : sit === "TODOS" ? sql`` : sql`AND e.situacao=${sit}`}
      ${q ? sql`AND (e.nome ILIKE ${"%" + q + "%"} OR p.nome ILIKE ${"%" + q + "%"})` : sql``}
    ORDER BY e.nome LIMIT 500`;
  const units = scope ? [] : await db.select().from(schema.units).orderBy(schema.units.nome);

  return (
    <Page title="Colaboradores" sub={`${rows.length} registro(s)`}
      actions={<><Btn kind="ghost" href="/api/export/colaboradores">Exportar CSV</Btn>{can.editar(s) && <><Btn kind="ghost" href="/colaboradores/importar">Importar planilha</Btn><Btn href="/colaboradores/novo">Novo colaborador</Btn></>}</>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-4 grid gap-2 rounded-md border border-line bg-white p-3 sm:grid-cols-[1fr_180px_180px_auto]">
        <Field label="Buscar"><Input name="q" defaultValue={q} placeholder="Nome ou cargo" /></Field>
        {!scope && <Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Todas</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
        <Field label="Situação"><Select name="situacao" defaultValue={sit}><option value="ATIVOS">Ativos e em admissão</option><option value="ATIVO">Somente ativos</option><option value="EM_ADMISSAO">Em admissão</option><option value="DESLIGADO">Desligados</option><option value="TODOS">Todos</option></Select></Field>
        <div className="flex items-end"><Btn kind="ghost">Filtrar</Btn></div>
      </form>
      <Table head={["Nome", "Unidade", "Cargo", "Vínculo", "Admissão", "Situação"]} empty="Nenhum colaborador encontrado. Cadastre o primeiro ou importe a planilha.">
        {rows.map(r => {
          const sit2 = r.situacao === "ATIVO" && r.ferias ? "FERIAS" : r.situacao === "ATIVO" && r.afastado ? "AFASTADO" : r.situacao;
          return (
            <tr key={r.id} className="hover:bg-mist/60">
              <Td><Link href={`/colaboradores/${r.id}`} className="font-medium text-acao">{r.nome}</Link></Td>
              <Td>{r.unidade}</Td><Td>{r.cargo ?? <span className="text-slate-400">sem cargo</span>}</Td><Td>{VINCULO_LABEL[r.vinculo] ?? r.vinculo}</Td>
              <Td>{fmtData(r.admissao)}</Td><Td><Badge v={sit2} label={SITUACAO_LABEL[sit2]} /></Td>
            </tr>
          );
        })}
      </Table>
    </Page>
  );
}
