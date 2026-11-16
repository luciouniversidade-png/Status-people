import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Flash, Badge, Btn, Field, Input, Select, Table, Td } from "@/components/ui";
import { fmtDataHora, hoje, getSettings } from "@/lib/utils";
import { podePreparar } from "@/lib/folha";
import { TIPOS_DIVISAO, fmtCompetencia } from "@/lib/folha-dividir";
import { previaDivisao } from "./actions";

export const dynamic = "force-dynamic";
const STATUS: Record<string, [string, string]> = { PREVIA: ["PENDENTE", "Prévia — conferir"], PUBLICADO: ["APROVADA", "Publicado"], DESCARTADO: ["CANCELADA", "Descartado"] };

/** v34 · Dividir o PDF da folha por pessoa (holerites, adiantamento, férias, 13º, PLR, informes de rendimentos). */
export default async function Dividir({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!podePreparar(s)) redirect("/sem-acesso?t=%2Ffolha%2Fdividir"); const sp = await searchParams;
  const cfg = await getSettings();
  const [empresas, lista, [ciclo]] = await Promise.all([
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM companies ORDER BY nome`,
    sql<{ id: number; tipo: string; competencia: string; nome_arquivo: string | null; paginas: number; status: string; user_nome: string | null; created_at: string; publicados: number | null; abertos: number; total: number }[]>`
      SELECT p.id, p.tipo, p.competencia, p.nome_arquivo, p.paginas, p.status, p.user_nome, p.created_at::text, p.publicados,
        (SELECT count(DISTINCT d.id) FROM payroll_docs d JOIN payroll_doc_views v ON v.doc_id=d.id JOIN users u ON u.id=v.user_id AND u.employee_id=d.employee_id WHERE d.split_id=p.id)::int AS abertos,
        (SELECT count(*) FROM payroll_docs d WHERE d.split_id=p.id)::int AS total
      FROM pdf_splits p ORDER BY p.created_at DESC LIMIT 100`,
    sp.ciclo ? sql<{ competencia: string; company_id: number }[]>`SELECT competencia, company_id FROM payroll_cycles WHERE id=${Number(sp.ciclo)}` : Promise.resolve([] as { competencia: string; company_id: number }[]),
  ]);
  const mesAnterior = (() => { const d = new Date(`${hoje().slice(0, 7)}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  return (
    <Page title="Dividir o PDF da folha por pessoa" sub="Envie o PDF único do contador: o ONE acha o dono de cada página pelo CPF (ou pelo nome completo), mostra a prévia para você conferir e publica um PDF por pessoa no Meu espaço — cada um vê só o seu, e cada abertura fica registrada.">
      <Flash ok={sp.ok} erro={sp.erro} />
      <Card title="Novo PDF" className="mb-4">
        <form action={previaDivisao} className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.7fr)_minmax(0,0.6fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] lg:items-end">
          <Field label="Documento"><Select name="tipo" defaultValue="HOLERITES">{Object.entries(TIPOS_DIVISAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Competência (mês)"><Input type="month" name="competencia" defaultValue={ciclo?.competencia ?? mesAnterior} /></Field>
          <Field label="Ano (informe)"><Input name="ano" inputMode="numeric" defaultValue={String(Number(hoje().slice(0, 4)) - 1)} /></Field>
          <Field label="Empresa (CNPJ)"><Select name="companyId" defaultValue={ciclo ? String(ciclo.company_id) : ""}><option value="">Todas</option>{empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</Select></Field>
          <Field label={`PDF (até ${cfg.plataforma.anexoMaxMb} MB)`}><input type="file" name="arquivo" accept="application/pdf" required className="block w-full rounded-md border border-line bg-white px-2 py-1.5 text-xs" /></Field>
          <Btn>Ler o PDF</Btn>
        </form>
        <p className="mt-2 text-[11px] text-slate-500">Nada é publicado nesta etapa. O CPF lido nas páginas serve só para achar a ficha e não é guardado na prévia. O PDF precisa ter texto (o que o sistema da contabilidade gera); PDF digitalizado (imagem) não tem como ser lido — aí você escolhe o dono de cada página na prévia. Informe de rendimentos usa o ano; os demais, a competência.</p>
      </Card>
      <Card title="Divisões feitas">
        <Table head={["Documento", "Competência", "Arquivo", "Situação", "Abertos pela pessoa", "Quem e quando"]} empty="Nenhum PDF dividido ainda.">
          {lista.map(d => <tr key={d.id}>
            <Td><Link className="font-medium text-acao" href={`/folha/dividir/${d.id}`}>{TIPOS_DIVISAO[d.tipo] ?? d.tipo}</Link></Td><Td className="whitespace-nowrap text-xs">{fmtCompetencia(d.competencia)}</Td>
            <Td className="text-xs [overflow-wrap:anywhere]">{d.nome_arquivo ?? "—"}<span className="block text-[11px] text-slate-500">{d.paginas} página(s)</span></Td>
            <Td><Badge v={STATUS[d.status]?.[0] ?? "PENDENTE"} label={STATUS[d.status]?.[1] ?? d.status} /></Td>
            <Td className="text-xs">{d.status === "PUBLICADO" ? `${d.abertos} de ${d.total}` : "—"}</Td>
            <Td className="text-xs">{d.user_nome ?? "—"}<span className="block text-[11px] text-slate-500">{fmtDataHora(d.created_at)}</span></Td>
          </tr>)}
        </Table>
      </Card>
    </Page>
  );
}
