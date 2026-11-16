import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card } from "@/components/ui";
import { fmtData } from "@/lib/utils";
import { DOC_PESSOAL, fmtCompetencia } from "@/lib/folha-dividir";
import { TIPOS_PESSOAIS_FOLHA } from "@/lib/anexos";

export const dynamic = "force-dynamic";
const ORDEM = ["HOLERITES", "ADIANTAMENTO", "RECIBO_FERIAS", "DECIMO_TERCEIRO", "PLR", "INFORME_RENDIMENTOS"];

/** v34 · Meu espaço → Meus documentos: holerites, adiantamentos, recibos de férias e de 13º, PLR e informes de rendimentos, por tipo e ano. */
export default async function MeusDocumentos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!s.employeeId) redirect("/conta"); const sp = await searchParams;
  const docs = await sql<{ id: number; tipo: string; competencia: string | null; attachment_id: number; created_at: string; visto: boolean }[]>`
    SELECT d.id, CASE WHEN d.tipo='HOLERITE' THEN 'HOLERITES' ELSE d.tipo END AS tipo, coalesce(d.competencia, c.competencia) AS competencia, d.attachment_id, d.created_at::text,
      EXISTS (SELECT 1 FROM payroll_doc_views v WHERE v.doc_id=d.id AND v.user_id=${s.id}) AS visto
    FROM payroll_docs d LEFT JOIN payroll_cycles c ON c.id=d.cycle_id WHERE d.employee_id=${s.employeeId} AND d.tipo = ANY(${TIPOS_PESSOAIS_FOLHA}) ORDER BY coalesce(d.competencia, c.competencia) DESC NULLS LAST, d.id DESC`;
  const tipos = ORDEM.filter(t => docs.some(d => d.tipo === t)); const tipo = sp.tipo && tipos.includes(sp.tipo) ? sp.tipo : null;
  const lista = tipo ? docs.filter(d => d.tipo === tipo) : docs;
  const anos = [...new Set(lista.map(d => (d.competencia ?? d.created_at).slice(0, 4)))];
  const novos = docs.filter(d => !d.visto).length;
  return (
    <Page title="Meus documentos" sub={`Holerites, recibos e informes de rendimentos — só seus. Cada abertura fica registrada.${novos ? ` ${novos} ainda não aberto(s).` : ""}`}>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Link href="/eu/documentos" className={`rounded-full border px-2.5 py-1 text-xs ${!tipo ? "border-acao bg-sky-50 text-acao" : "border-line text-slate-600"}`}>Todos ({docs.length})</Link>
        {tipos.map(t => <Link key={t} href={`/eu/documentos?tipo=${t}`} className={`rounded-full border px-2.5 py-1 text-xs ${tipo === t ? "border-acao bg-sky-50 text-acao" : "border-line text-slate-600"}`}>{DOC_PESSOAL[t]} ({docs.filter(d => d.tipo === t).length})</Link>)}
      </div>
      {docs.length === 0 ? <Card><p className="text-sm text-slate-500">Seus holerites e recibos aparecem aqui quando o RH publicar a folha do mês.</p></Card> :
        <div className="space-y-4">{anos.map(a => <Card key={a} title={a}>
          <ul className="divide-y divide-line">{lista.filter(d => (d.competencia ?? d.created_at).slice(0, 4) === a).map(d => <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <a className="min-w-0 text-sm font-medium text-acao" href={`/api/anexos/${d.attachment_id}`} target="_blank" rel="noopener">{DOC_PESSOAL[d.tipo] ?? d.tipo} · {fmtCompetencia(d.competencia)}</a>
            <span className="text-xs text-slate-500">{d.visto ? "" : <b className="mr-2 rounded bg-sky-100 px-1.5 py-0.5 text-[11px] text-acao">novo</b>}publicado em {fmtData(d.created_at.slice(0, 10))}</span>
          </li>)}</ul>
        </Card>)}</div>}
      <p className="mt-3 text-xs text-slate-500">Falta algum documento ou há algo errado nele? <Link className="text-acao underline" href="/solicitacoes/nova">Fale com o RH</Link>.</p>
    </Page>
  );
}
