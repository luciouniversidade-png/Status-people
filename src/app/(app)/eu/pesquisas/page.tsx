import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Flash } from "@/components/ui";
import { fmtData } from "@/lib/utils";
import { pesquisasPendentes } from "@/lib/pesquisas";

export const dynamic = "force-dynamic";

/** v34 · Meu espaço → Pesquisas: as abertas para responder e as já respondidas. */
export default async function MinhasPesquisas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!s.employeeId) redirect("/conta"); const sp = await searchParams;
  const [pend, feitas] = await Promise.all([
    pesquisasPendentes(s),
    sql<{ id: number; titulo: string; status: string; identificada: boolean }[]>`SELECT sv.id, sv.titulo, sv.status, sv.identificada FROM custom_surveys sv JOIN custom_survey_marks m ON m.survey_id=sv.id AND m.user_id=${s.id} ORDER BY sv.fim DESC LIMIT 30`,
  ]);
  return (
    <Page title="Pesquisas" sub="Sua opinião ajuda a escola a decidir. Nas anônimas, ninguém vê o que você respondeu — o resultado só aparece somado, com um mínimo de respostas.">
      <Flash ok={sp.ok} erro={sp.erro} />
      <Card title={`Para responder (${pend.length})`} className="mb-4">
        {pend.length === 0 ? <p className="text-sm text-ok">Nenhuma pesquisa aberta para você agora.</p> :
          <ul className="divide-y divide-line">{pend.map(p => <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><Link className="font-medium text-acao [overflow-wrap:anywhere]" href={`/eu/pesquisas/${p.id}`}>{p.titulo}</Link><span className="text-xs text-slate-500">{p.identificada ? "identificada" : "anônima"} · até {fmtData(p.fim)}</span></li>)}</ul>}
      </Card>
      <Card title="Já respondidas">
        {feitas.length === 0 ? <p className="text-sm text-slate-500">Nenhuma ainda.</p> : <ul className="divide-y divide-line text-sm">{feitas.map(p => <li key={p.id} className="flex flex-wrap justify-between gap-2 py-1.5"><span className="[overflow-wrap:anywhere]">{p.titulo}</span><span className="text-xs text-slate-500">{p.identificada ? "identificada" : "anônima"} · {p.status === "ABERTA" ? "em andamento" : "encerrada"}</span></li>)}</ul>}
      </Card>
    </Page>
  );
}
