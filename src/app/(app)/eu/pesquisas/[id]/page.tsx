import Link from "@/components/Link";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Flash, Btn } from "@/components/ui";
import { fmtData, hoje } from "@/lib/utils";
import * as P from "@/lib/pesquisas";
import { responderPesquisaInterna } from "@/app/(app)/clima/pesquisas/actions";

export const dynamic = "force-dynamic";
const inp = "w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

/** v34 · Responder uma pesquisa interna (no celular também). */
export default async function Responder({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!s.employeeId) redirect("/conta"); const sp = await searchParams; const id = Number((await params).id);
  const [sv] = await sql<{ id: number; titulo: string; descricao: string | null; identificada: boolean; perguntas: P.Pergunta[]; status: string; inicio: string; fim: string }[]>`SELECT id, titulo, descricao, identificada, perguntas, status, inicio::text, fim::text FROM custom_surveys WHERE id=${id}`;
  if (!sv || sv.status === "RASCUNHO" || !(await P.noPublico(id, s.employeeId))) notFound();
  const [ja] = await sql`SELECT 1 FROM custom_survey_marks WHERE survey_id=${id} AND user_id=${s.id}`;
  const aberta = sv.status === "ABERTA" && sv.inicio <= hoje() && sv.fim >= hoje();
  return (
    <Page title={sv.titulo} sub={`${sv.identificada ? "Pesquisa identificada: o RH verá o seu nome junto das respostas." : "Pesquisa anônima: a resposta não guarda quem respondeu nem quando."} Aberta até ${fmtData(sv.fim)}.`}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {sv.descricao ? <p className="mb-3 rounded-md border border-line bg-white p-3 text-sm text-slate-700">{sv.descricao}</p> : null}
      {ja ? <Card><p className="text-sm text-ok">Você já respondeu. Obrigado! <Link className="text-acao underline" href="/eu/pesquisas">Voltar</Link></p></Card> : !aberta ? <Card><p className="text-sm text-slate-600">Esta pesquisa não está aberta.</p></Card> :
        <form action={responderPesquisaInterna} className="space-y-3"><input type="hidden" name="id" value={sv.id} />
          {sv.perguntas.map((q, i) => <Card key={q.id} title={`${i + 1}. ${q.texto}${q.obrigatoria ? "" : " (opcional)"}`}>
            {q.tipo === "ESCALA" ? <div className="grid grid-cols-5 gap-1.5">{[1, 2, 3, 4, 5].map(n => <label key={n} className="flex cursor-pointer flex-col items-center gap-1 rounded-md border border-line px-1 py-2 text-center text-[11px] has-[:checked]:border-acao has-[:checked]:bg-sky-50"><input type="radio" name={q.id} value={n} required={q.obrigatoria} className="sr-only" /><b className="text-base">{n}</b><span className="leading-tight text-slate-600">{P.ESCALA_ROTULO[n]}</span></label>)}</div>
              : q.tipo === "UNICA" ? <div className="space-y-1.5">{q.opcoes!.map(o => <label key={o} className="flex items-start gap-2 text-sm"><input type="radio" name={q.id} value={o} required={q.obrigatoria} className="mt-0.5" /> {o}</label>)}</div>
              : q.tipo === "MULTIPLA" ? <div className="space-y-1.5">{q.opcoes!.map(o => <label key={o} className="flex items-start gap-2 text-sm"><input type="checkbox" name={q.id} value={o} className="mt-0.5" /> {o}</label>)}<p className="text-[11px] text-slate-500">Marque quantas quiser.</p></div>
              : <textarea name={q.id} maxLength={2000} className={`${inp} min-h-[90px]`} placeholder={sv.identificada ? "" : "Evite escrever nomes ou detalhes que identifiquem você ou outra pessoa."} />}
          </Card>)}
          <Btn>Enviar respostas</Btn>
        </form>}
    </Page>
  );
}
