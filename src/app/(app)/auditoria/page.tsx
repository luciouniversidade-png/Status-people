import { redirect } from "next/navigation";
import { requireSession, can } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Table, Td, Select, Field, Btn, Input } from "@/components/ui";
import { fmtDataHora } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Auditoria({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!can.auditoria(s)) redirect("/");
  const sp = await searchParams; const ent = sp.entidade ?? ""; const q = (sp.q ?? "").trim();
  const rows = await sql<{ id: number; at: Date; user_nome: string | null; acao: string; entidade: string; entidade_id: number | null; antes: unknown; depois: unknown }[]>`
    SELECT id, at, user_nome, acao, entidade, entidade_id, antes, depois FROM audit_log WHERE 1=1 ${ent ? sql`AND entidade=${ent}` : sql``} ${q ? sql`AND (user_nome ILIKE ${"%" + q + "%"} OR acao ILIKE ${"%" + q + "%"} OR depois::text ILIKE ${"%" + q + "%"})` : sql``} ORDER BY at DESC LIMIT 300`;
  const labels: Record<string, string> = { employees: "Colaborador", leave_requests: "Férias/afastamento", hour_entries: "Banco de horas", documents: "Documento", processes: "Processo", process_items: "Item de checklist", users: "Usuário", settings: "Configuração", positions: "Cargo", units: "Unidade", companies: "Empresa" };
  return (
    <Page title="Auditoria" sub="Trilha imutável: quem fez o quê, quando. Registros não podem ser editados nem apagados pela interface.">
      <form className="mb-4 grid gap-2 rounded-md border border-line bg-white p-3 sm:grid-cols-[220px_1fr_auto]">
        <Field label="Entidade"><Select name="entidade" defaultValue={ent}><option value="">Todas</option>{Object.entries(labels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Buscar"><Input name="q" defaultValue={q} placeholder="Usuário, ação ou conteúdo" /></Field>
        <div className="flex items-end"><Btn kind="ghost">Filtrar</Btn></div>
      </form>
      <Table head={["Quando", "Quem", "Ação", "Entidade", "Antes → Depois"]} empty="Nenhum registro.">
        {rows.map(r => <tr key={r.id}><Td className="whitespace-nowrap text-slate-500">{fmtDataHora(r.at)}</Td><Td>{r.user_nome}</Td><Td>{r.acao}</Td><Td>{labels[r.entidade] ?? r.entidade}{r.entidade_id ? ` #${r.entidade_id}` : ""}</Td>
          <Td className="max-w-[460px] text-xs text-slate-600"><details><summary className="cursor-pointer">{r.depois ? JSON.stringify(r.depois).slice(0, 90) : r.antes ? "(removido)" : "—"}</summary><pre className="mt-1 whitespace-pre-wrap break-all rounded bg-mist p-2">{JSON.stringify({ antes: r.antes, depois: r.depois }, null, 1)}</pre></details></Td></tr>)}
      </Table>
    </Page>
  );
}
