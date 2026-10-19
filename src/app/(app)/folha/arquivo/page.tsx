import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession } from "@/lib/auth";
import { Page, Card, Flash, Badge, Field, Input, Btn, Table, Td } from "@/components/ui";
import { podeFolha } from "@/lib/folha";
import { TIPOS_DOC, docsFaltando, STATUS_CICLO } from "@/lib/folha-calc";
import { cobrarDocumentos } from "../actions";
import { rotuloMes } from "@/lib/formato";
import { fmtDataHora, getSettings } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** T-057 · Arquivo de holerites e guias: competência → entidade → documentos, com estado (completo/faltando) e trilha de consulta. */
export default async function ArquivoFolha({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!podeFolha(s)) redirect("/"); const sp = await searchParams; const q = (sp.q ?? "").trim();
  const cfg = await getSettings(); const verHolerite = ["RH", "DIRECAO"].includes(s.role);
  const ciclos = await sql<{ id: number; competencia: string; company_id: number; entidade: string; status: string }[]>`SELECT c.id, c.competencia, c.company_id, co.nome AS entidade, c.status FROM payroll_cycles c JOIN companies co ON co.id=c.company_id ORDER BY c.competencia DESC, co.nome LIMIT 240`;
  const docs = await sql<{ id: number; cycle_id: number; tipo: string; colaborador: string | null; attachment_id: number; nome: string; user_nome: string | null; created_at: string; consultas: number }[]>`SELECT d.id, d.cycle_id, d.tipo, e.nome AS colaborador, d.attachment_id, a.nome, a.user_nome, d.created_at::text, (SELECT count(*) FROM payroll_doc_views v WHERE v.doc_id=d.id)::int AS consultas
    FROM payroll_docs d JOIN attachments a ON a.id=d.attachment_id LEFT JOIN employees e ON e.id=d.employee_id
    WHERE true ${verHolerite ? sql`` : sql`AND (d.tipo LIKE 'GUIA_%' OR d.tipo='RESUMO_FOLHA')`} ${q ? sql`AND (e.nome ILIKE ${"%" + q + "%"} OR a.nome ILIKE ${"%" + q + "%"})` : sql``} ORDER BY d.tipo, d.id`;
  const consultas = s.role === "DIRECAO" ? await sql<{ at: string; user_nome: string | null; tipo: string; nome: string; competencia: string }[]>`SELECT v.at::text, v.user_nome, d.tipo, a.nome, c.competencia FROM payroll_doc_views v JOIN payroll_docs d ON d.id=v.doc_id JOIN attachments a ON a.id=d.attachment_id JOIN payroll_cycles c ON c.id=d.cycle_id ORDER BY v.at DESC LIMIT 60` : [];
  const porComp = [...new Set(ciclos.map(c => c.competencia))];
  const obrig = cfg.folha.docsObrigatorios as string[];
  return (
    <Page title="Holerites e guias" sub="A memória documental da folha: por competência e entidade, com o que falta e quem consultou. Holerites só para RH e Direção (e o próprio colaborador, no Meu painel); guias também para o Financeiro." actions={<Btn kind="ghost" href="/folha">Ciclo da folha</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-4 flex flex-wrap items-end gap-2"><Field label="Buscar colaborador ou arquivo"><Input name="q" defaultValue={q} placeholder="nome" /></Field><Btn kind="ghost">Buscar</Btn>{q && <Link href="/folha/arquivo" className="text-sm text-acao">limpar</Link>}</form>
      {porComp.length === 0 && <Card><p className="text-sm text-slate-600">Nenhum ciclo da folha iniciado. Os documentos entram no passo 5 do ciclo.</p></Card>}
      <div className="space-y-3">
        {porComp.map(m => (
          <details key={m} open={m === porComp[0]} className="rounded-md border border-line bg-white">
            <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-navy">{rotuloMes(m)} <span className="ml-2 text-xs font-normal text-slate-500">{ciclos.filter(c => c.competencia === m).length} entidade(s)</span></summary>
            <div className="grid grid-cols-1 gap-3 border-t border-line p-3 lg:grid-cols-2">
              {ciclos.filter(c => c.competencia === m).map(c => { const ds = docs.filter(d => d.cycle_id === c.id); const faltam = docsFaltando(obrig, [...new Set(docs.filter(d => d.cycle_id === c.id).map(d => d.tipo))]); const completo = faltam.length === 0; return (
                <div key={c.id} className="rounded-md border border-line p-3 text-sm">
                  <div className="mb-2 flex flex-wrap items-center gap-2"><Link href={`/folha/${c.id}`} className="font-medium text-acao">{c.entidade}</Link><Badge v={completo ? "APROVADA" : "PENDENTE"} label={completo ? "completo" : `faltando ${faltam.length}`} /><span className="text-xs text-slate-500">{STATUS_CICLO[c.status] ?? c.status}</span></div>
                  {ds.length === 0 ? <p className="text-xs text-slate-500">Nenhum documento{q ? " com a busca" : ""}.</p> : <ul className="space-y-1">{ds.map(d => <li key={d.id} className="flex flex-wrap items-center gap-2 text-xs"><span className="rounded bg-mist px-1.5 py-0.5">{TIPOS_DOC[d.tipo] ?? d.tipo}</span><a href={`/api/anexos/${d.attachment_id}`} target="_blank" rel="noreferrer" className="text-acao">{d.nome}</a>{d.colaborador && <span className="text-slate-500">· {d.colaborador}</span>}<span className="ml-auto text-slate-400">{d.consultas} consulta(s)</span></li>)}</ul>}
                  {!completo && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-aviso">Faltando: {faltam.map(t => TIPOS_DOC[t] ?? t).join(", ")}<form action={cobrarDocumentos}><input type="hidden" name="cycleId" value={c.id} /><input type="hidden" name="voltar" value="/folha/arquivo" /><button className="text-acao underline">registrar cobrança ao contador</button></form></div>}
                </div>); })}
            </div>
          </details>
        ))}
      </div>
      {s.role === "DIRECAO" && <Card title="Relatório de consultas (últimas 60)" className="mt-4"><Table head={["Quando", "Quem", "Documento", "Competência"]} empty="Nenhuma consulta registrada.">{consultas.map((v, i) => <tr key={i}><Td className="whitespace-nowrap text-xs">{fmtDataHora(v.at)}</Td><Td>{v.user_nome ?? "—"}</Td><Td className="text-xs">{TIPOS_DOC[v.tipo] ?? v.tipo} · {v.nome}</Td><Td>{rotuloMes(v.competencia)}</Td></tr>)}</Table></Card>}
    </Page>
  );
}
