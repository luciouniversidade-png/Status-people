import Link from "next/link";
import { requireMatriculas, scopeUnit, can } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Table, Td, Badge, Flash, Select, Field, Btn, Input, Textarea, Stat } from "@/components/ui";
import { fmtData, hoje } from "@/lib/utils";
import { registrarPesquisa, importarPesquisas } from "../actions";
import { alunosDaRede } from "../_shared";

export const dynamic = "force-dynamic";

export default async function Pesquisas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireMatriculas(); const sp = await searchParams; const scope = scopeUnit(s); const unitId = scope ?? (sp.unidade ? Number(sp.unidade) : null);
  const uf = unitId === null ? sql`` : sql`AND s.unit_id=${unitId}`;
  const [rows, meses, units, alunos] = await Promise.all([
    sql<{ id: number; tipo: string; nota: number; comentario: string | null; aluno: string | null; student_id: number | null; unidade: string; data: string; canal: string | null; case_id: number | null }[]>`SELECT s.id, s.tipo, s.nota, s.comentario, st.nome AS aluno, s.student_id, u.nome AS unidade, s.data::text, s.canal, s.case_id FROM surveys s JOIN units u ON u.id=s.unit_id LEFT JOIN students st ON st.id=s.student_id WHERE 1=1 ${uf} ORDER BY s.data DESC, s.id DESC LIMIT 300`,
    sql<{ mes: string; n: number; nps: number | null; csat: number | null }[]>`SELECT to_char(s.data,'YYYY-MM') AS mes, count(*) FILTER (WHERE s.tipo='NPS')::int AS n,
        CASE WHEN count(*) FILTER (WHERE s.tipo='NPS')>0 THEN round(100.0*(count(*) FILTER (WHERE s.tipo='NPS' AND s.nota>=9) - count(*) FILTER (WHERE s.tipo='NPS' AND s.nota<=6))/count(*) FILTER (WHERE s.tipo='NPS')) END::int AS nps,
        round(avg(s.nota) FILTER (WHERE s.tipo='CSAT'),2)::float AS csat FROM surveys s WHERE 1=1 ${uf} GROUP BY 1 ORDER BY 1 DESC LIMIT 12`,
    scope ? Promise.resolve([]) : db.select().from(schema.units).orderBy(asc(schema.units.nome)), alunosDaRede(scope),
  ]);
  const unitsAll = await db.select().from(schema.units).orderBy(asc(schema.units.nome));
  return (
    <Page title="Pesquisas — NPS e satisfação" sub="NPS: 0–10 (promotores 9–10, detratores 0–6). CSAT: 1–5 após um atendimento. Registre respostas colhidas por WhatsApp, formulário ou presencialmente." actions={<Btn kind="ghost" href="/api/export/pesquisas">Exportar CSV</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="space-y-4">
          {!scope && <form className="flex items-end gap-2"><Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Todas</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Btn kind="ghost">Filtrar</Btn></form>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{meses.slice(0, 3).map(m => <Stat key={m.mes} label={m.mes.split("-").reverse().join("/")} value={m.nps === null ? "—" : <span className={m.nps >= 50 ? "text-ok" : m.nps >= 0 ? "text-aviso" : "text-erro"}>NPS {m.nps}</span>} hint={`${m.n} resp.${m.csat ? ` · CSAT ${m.csat}` : ""}`} />)}</div>
          <Table head={["Data", "Tipo", "Nota", "Família", "Unidade", "Comentário", "Canal"]} empty="Nenhuma resposta registrada.">
            {rows.map(r => <tr key={r.id}><Td className="whitespace-nowrap">{fmtData(r.data)}</Td><Td>{r.tipo}</Td><Td><Badge v={r.tipo === "NPS" ? (r.nota >= 9 ? "APROVADA" : r.nota >= 7 ? "PENDENTE" : "REJEITADA") : (r.nota >= 4 ? "APROVADA" : r.nota === 3 ? "PENDENTE" : "REJEITADA")} label={String(r.nota)} /></Td><Td>{r.student_id ? <Link className="text-acao" href={`/matriculas/alunos/${r.student_id}#atendimento`}>{r.aluno}</Link> : <span className="text-slate-400">anônimo</span>}{r.case_id && <div className="text-xs text-slate-500"><Link href={`/atendimento/casos/${r.case_id}`} className="text-acao">caso #{r.case_id}</Link></div>}</Td><Td>{r.unidade}</Td><Td className="max-w-[280px] text-xs text-slate-600">{r.comentario ?? "—"}</Td><Td className="text-xs">{r.canal ?? "—"}</Td></tr>)}
          </Table>
        </div>
        <div className="space-y-4">
          <Card title="Registrar resposta"><form action={registrarPesquisa} className="space-y-2"><input type="hidden" name="voltar" value="/atendimento/pesquisas" />
            <div className="grid grid-cols-2 gap-2"><Field label="Tipo"><Select name="tipo" defaultValue="NPS"><option value="NPS">NPS (0–10)</option><option value="CSAT">CSAT (1–5)</option></Select></Field><Field label="Nota"><Input name="nota" type="number" min={0} max={10} required /></Field></div>
            <Field label="Família (aluno)"><Select name="studentId"><option value="">anônimo</option>{alunos.map(a => <option key={a.id} value={a.id}>{a.nome}{a.unidade ? ` · ${a.unidade}` : ""}</option>)}</Select></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="Unidade"><Select name="unitId" defaultValue={scope ?? ""}><option value="">a do aluno</option>{unitsAll.filter(u => !scope || u.id === scope).map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Field label="Data"><Input name="data" type="date" defaultValue={hoje()} /></Field></div>
            <Field label="Comentário"><Textarea name="comentario" className="min-h-[50px]" /></Field><Field label="Canal"><Input name="canal" placeholder="WhatsApp, formulário, presencial…" /></Field>
            <Btn small>Registrar</Btn></form></Card>
          {(can.editar(s) || s.role === "COMERCIAL") && <Card title="Importar respostas (CSV)"><form action={importarPesquisas} className="space-y-2"><Field label="tipo;nota;data;aluno;unidade;comentario;canal"><Textarea name="csv" className="min-h-[100px] font-mono text-xs" placeholder={"tipo;nota;data;aluno;unidade;comentario\nNPS;9;05/09/2026;Ana Souza;Carandá;Ótima escola"} /></Field><Field label="Ou envie o arquivo (.xlsx/.xls/.csv)"><input type="file" name="arquivo" accept=".xlsx,.xls,.xlsm,.csv,.txt" className="block w-full rounded-md border border-line bg-white px-2 py-1.5 text-xs file:mr-2 file:rounded file:border-0 file:bg-acao file:px-2 file:py-1 file:text-xs file:text-white" /></Field><Btn small kind="ghost">Importar</Btn></form></Card>}
        </div>
      </div>
    </Page>
  );
}
