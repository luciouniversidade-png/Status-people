import Link from "next/link";
import { requireStaff, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Table, Td, Badge, Flash, Select, Field, Btn } from "@/components/ui";
import { fmtData, PROC_LABEL, PROC_STATUS, hoje } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Processos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const sp = await searchParams; const u = scopeUnit(s);
  const tipo = sp.tipo ?? ""; const status = sp.status ?? "ABERTO"; const h = hoje();
  const rows = await sql<{ id: number; tipo: string; status: string; inicio: string; prazo: string | null; nome: string; employee_id: number; unidade: string; total: number; feitos: number }[]>`
    SELECT p.id, p.tipo, p.status, p.inicio::text, p.prazo::text, e.nome, e.id AS employee_id, u.nome AS unidade,
      (SELECT count(*) FROM process_items i WHERE i.process_id=p.id)::int AS total,
      (SELECT count(*) FROM process_items i WHERE i.process_id=p.id AND i.concluido)::int AS feitos
    FROM processes p JOIN employees e ON e.id=p.employee_id JOIN units u ON u.id=e.unit_id
    WHERE 1=1 ${tipo ? sql`AND p.tipo=${tipo}` : sql``} ${status ? sql`AND p.status=${status}` : sql``} ${u === null ? sql`` : sql`AND e.unit_id=${u}`}
    ORDER BY p.status='ABERTO' DESC, p.prazo NULLS LAST, p.id DESC LIMIT 300`;
  return (
    <Page title="Admissões e desligamentos" sub="Checklists com prazo. O vínculo muda de situação quando o checklist é concluído.">
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-4 grid gap-2 rounded-md border border-line bg-white p-3 sm:grid-cols-[200px_200px_auto]">
        <Field label="Tipo"><Select name="tipo" defaultValue={tipo}><option value="">Todos</option><option value="ADMISSAO">Admissões</option><option value="DESLIGAMENTO">Desligamentos</option></Select></Field>
        <Field label="Situação"><Select name="status" defaultValue={status}><option value="ABERTO">Em andamento</option><option value="CONCLUIDO">Concluídos</option><option value="CANCELADO">Cancelados</option><option value="">Todos</option></Select></Field>
        <div className="flex items-end"><Btn kind="ghost">Filtrar</Btn></div>
      </form>
      <Table head={["Colaborador", "Unidade", "Tipo", "Início", "Prazo", "Checklist", "Situação"]} empty="Nenhum processo. Admissões são abertas ao cadastrar um colaborador; desligamentos, na ficha do colaborador.">
        {rows.map(r => (
          <tr key={r.id} className="hover:bg-mist/60">
            <Td><Link className="font-medium text-acao" href={`/processos/${r.id}`}>{r.nome}</Link></Td><Td>{r.unidade}</Td><Td>{PROC_LABEL[r.tipo]}</Td>
            <Td>{fmtData(r.inicio)}</Td><Td className={r.status === "ABERTO" && r.prazo && r.prazo < h ? "font-medium text-erro" : ""}>{fmtData(r.prazo)}{r.status === "ABERTO" && r.prazo && r.prazo < h ? " · atrasado" : ""}</Td>
            <Td><span className="tabular-nums">{r.feitos}/{r.total}</span><div className="mt-1 h-1.5 w-24 rounded bg-mist"><div className="h-1.5 rounded bg-acao" style={{ width: `${r.total ? Math.round(100 * r.feitos / r.total) : 0}%` }} /></div></Td>
            <Td><Badge v={r.status} label={PROC_STATUS[r.status]} /></Td>
          </tr>
        ))}
      </Table>
    </Page>
  );
}
