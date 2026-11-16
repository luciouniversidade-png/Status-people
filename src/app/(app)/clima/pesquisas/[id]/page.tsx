import Link from "@/components/Link";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Flash, Badge, Btn, Stat } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { fmtData, fmtDataHora } from "@/lib/utils";
import * as P from "@/lib/pesquisas";
import { FormPesquisa } from "../FormPesquisa";
import { mudarStatusPesquisa } from "../actions";

export const dynamic = "force-dynamic";
const TOM: Record<string, string> = { RASCUNHO: "PENDENTE", ABERTA: "ABERTO", ENCERRADA: "CONCLUIDO" };

function Barra({ v, max, rot }: { v: number; max: number; rot: string }) {
  const pct = max ? Math.round(100 * v / max) : 0;
  return <div className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)_3rem] items-center gap-2 text-xs"><span className="truncate" title={rot}>{rot}</span><div className="h-2 rounded bg-slate-100"><div className="h-2 rounded bg-acao" style={{ width: `${pct}%` }} /></div><span className="text-right tabular-nums">{v}</span></div>;
}

/** v34 · Uma pesquisa interna: edição do rascunho, abrir/encerrar e o resultado (com o mínimo de respostas na anônima). */
export default async function Pesquisa({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!P.podePesquisas(s)) redirect("/sem-acesso?t=%2Fclima%2Fpesquisas"); const sp = await searchParams; const id = Number((await params).id);
  const [sv] = await sql<{ id: number; titulo: string; descricao: string | null; identificada: boolean; minimo_anonimato: number; perguntas: P.Pergunta[]; publico: string; unit_id: number | null; position_id: number | null; inicio: string; fim: string; status: string; criado_nome: string | null; aberta_em: string | null; encerrada_em: string | null; unidade: string | null; cargo: string | null }[]>`
    SELECT sv.id, sv.titulo, sv.descricao, sv.identificada, sv.minimo_anonimato, sv.perguntas, sv.publico, sv.unit_id, sv.position_id, sv.inicio::text, sv.fim::text, sv.status, sv.criado_nome, sv.aberta_em::text, sv.encerrada_em::text, u.nome AS unidade, p.nome AS cargo FROM custom_surveys sv LEFT JOIN units u ON u.id=sv.unit_id LEFT JOIN positions p ON p.id=sv.position_id WHERE sv.id=${id}`;
  if (!sv) notFound();
  const [resps, [{ marcas }], units, cargos, publico] = await Promise.all([
    sql<{ unit_id: number | null; respostas: Record<string, unknown>; nome: string | null; respondido_em: string | null }[]>`SELECT r.unit_id, r.respostas, e.nome, r.respondido_em::text FROM custom_survey_responses r LEFT JOIN employees e ON e.id=r.employee_id WHERE r.survey_id=${id}`,
    sql<{ marcas: number }[]>`SELECT count(*)::int AS marcas FROM custom_survey_marks WHERE survey_id=${id}`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`, sql<{ id: number; nome: string }[]>`SELECT id, nome FROM positions ORDER BY ordem, nome`,
    P.tamanhoPublico(sv),
  ]);
  const min = sv.minimo_anonimato; const pode = sv.identificada || resps.length >= min; const recorte = sp.u ? Number(sp.u) : null;
  const porUnidade = [...new Set(resps.map(r => r.unit_id))].map(u => ({ u, n: resps.filter(r => r.unit_id === u).length })).filter(x => x.u !== null);
  // recorte por unidade só quando a unidade e o resto têm o mínimo (senão daria para deduzir por diferença)
  const recortesOk = sv.identificada ? porUnidade : porUnidade.filter(x => x.n >= min && (resps.length - x.n === 0 || resps.length - x.n >= min));
  const base = recorte && recortesOk.some(x => x.u === recorte) ? resps.filter(r => r.unit_id === recorte) : resps;
  const res = pode ? P.agregar(sv.perguntas, base.map(r => r.respostas)) : [];
  const nomeU = (u: number | null) => units.find(x => x.id === u)?.nome ?? "—";
  return (
    <Page title={sv.titulo} sub={`${sv.identificada ? "Identificada" : `Anônima (mínimo de ${min} respostas)`} · ${P.PUBLICO[sv.publico]}${sv.unidade ? `: ${sv.unidade}` : ""}${sv.cargo ? `: ${sv.cargo}` : ""} · ${fmtData(sv.inicio)} a ${fmtData(sv.fim)}${sv.criado_nome ? ` · criada por ${sv.criado_nome}` : ""}`}
      actions={<span className="flex flex-wrap gap-2">
        {sv.status === "RASCUNHO" ? <><Modal label="Editar" title="Editar a pesquisa" small={false}><FormPesquisa units={units} cargos={cargos} valores={{ id: sv.id, titulo: sv.titulo, descricao: sv.descricao, perguntas: P.perguntasTexto(sv.perguntas), inicio: sv.inicio, fim: sv.fim, minimo: sv.minimo_anonimato, publico: sv.publico, unitId: sv.unit_id, positionId: sv.position_id, identificada: sv.identificada }} /></Modal>
          <form action={mudarStatusPesquisa}><input type="hidden" name="id" value={sv.id} /><input type="hidden" name="acao" value="ABRIR" /><Btn>Abrir e avisar o público</Btn></form>
          <form action={mudarStatusPesquisa}><input type="hidden" name="id" value={sv.id} /><input type="hidden" name="acao" value="EXCLUIR" /><Btn kind="ghost">Excluir rascunho</Btn></form></> : null}
        {sv.status === "ABERTA" ? <form action={mudarStatusPesquisa}><input type="hidden" name="id" value={sv.id} /><input type="hidden" name="acao" value="ENCERRAR" /><Btn kind="ghost">Encerrar</Btn></form> : null}
        {sv.identificada && resps.length ? <a className="inline-flex items-center rounded-md border border-line bg-white px-3 py-2 text-sm text-navy hover:bg-slate-50" href={`/api/export/pesquisa-interna?id=${sv.id}`}>Exportar CSV</a> : null}
        <Btn kind="ghost" href="/clima/pesquisas">Voltar</Btn></span>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Situação" value={<Badge v={TOM[sv.status] ?? "PENDENTE"} label={P.STATUS_PESQUISA[sv.status]} />} hint={sv.aberta_em ? `aberta em ${fmtDataHora(sv.aberta_em)}` : undefined} />
        <Stat label="Respostas" value={`${marcas}${publico ? ` de ${publico}` : ""}`} hint={publico ? `${Math.round(100 * marcas / publico)}% do público` : undefined} />
        <Stat label="Perguntas" value={sv.perguntas.length} />
        <Stat label="Resultado" value={<span className="text-sm">{pode ? "visível" : `aguardando ${min - resps.length} resposta(s)`}</span>} />
      </div>
      {sv.descricao ? <p className="mb-3 rounded-md border border-line bg-white p-3 text-sm text-slate-700">{sv.descricao}</p> : null}
      {sv.status === "RASCUNHO" ? <Card title="Prévia das perguntas"><ol className="list-decimal space-y-1 pl-5 text-sm">{sv.perguntas.map(q => <li key={q.id}>{q.texto} <span className="text-xs text-slate-500">({P.TIPO_PERGUNTA[q.tipo]}{q.opcoes ? `: ${q.opcoes.join(" · ")}` : ""}{q.obrigatoria ? "" : ", opcional"})</span></li>)}</ol></Card> :
        !pode ? <Card><p className="text-sm text-slate-600">Pesquisa anônima: o resultado aparece quando houver pelo menos {min} respostas. Até lá, só a contagem.</p></Card> : <>
          {recortesOk.length > 1 ? <div className="mb-3 flex flex-wrap gap-1.5 text-xs"><Link href={`/clima/pesquisas/${sv.id}`} className={`rounded-full border px-2.5 py-1 ${!recorte ? "border-acao bg-sky-50 text-acao" : "border-line text-slate-600"}`}>Todas ({resps.length})</Link>{recortesOk.map(x => <Link key={x.u} href={`/clima/pesquisas/${sv.id}?u=${x.u}`} className={`rounded-full border px-2.5 py-1 ${recorte === x.u ? "border-acao bg-sky-50 text-acao" : "border-line text-slate-600"}`}>{nomeU(x.u)} ({x.n})</Link>)}</div> : null}
          <div className="space-y-3">{res.map((r, i) => <Card key={r.pergunta.id} title={`${i + 1}. ${r.pergunta.texto}`}>
            <p className="mb-2 text-[11px] text-slate-500">{P.TIPO_PERGUNTA[r.pergunta.tipo]} · {r.n} resposta(s)</p>
            {r.pergunta.tipo === "ESCALA" ? <><p className="mb-2 text-sm">Média <b className="tabular-nums">{r.media !== null && r.media !== undefined ? r.media.toFixed(2).replace(".", ",") : "—"}</b> de 5 · concordam (4 e 5): <b>{r.n ? Math.round(100 * ((r.dist![3] + r.dist![4]) / r.n)) : 0}%</b></p><div className="space-y-1">{[5, 4, 3, 2, 1].map(k => <Barra key={k} v={r.dist![k - 1]} max={r.n} rot={`${k} · ${P.ESCALA_ROTULO[k]}`} />)}</div></>
              : r.contagem ? <div className="space-y-1">{r.contagem.sort((a, b) => b[1] - a[1]).map(([o, n]) => <Barra key={o} v={n} max={r.n} rot={o} />)}{r.pergunta.tipo === "MULTIPLA" ? <p className="text-[11px] text-slate-500">Várias escolhas por pessoa: as barras somam mais que o total.</p> : null}</div>
              : <ul className="max-h-80 space-y-1 overflow-y-auto text-sm">{(sv.identificada ? base.map(b => [b.nome, b.respostas[r.pergunta.id]] as [string | null, unknown]).filter(x => x[1]).map(([n, t], k) => <li key={k} className="rounded border border-line px-2 py-1 [overflow-wrap:anywhere]"><b className="text-xs text-slate-500">{n}:</b> {String(t)}</li>) : P.embaralhar(r.textos ?? []).map((t, k) => <li key={k} className="rounded border border-line px-2 py-1 [overflow-wrap:anywhere]">{t}</li>))}{!r.n ? <li className="text-slate-500">Sem comentários.</li> : null}</ul>}
          </Card>)}</div></>}
    </Page>
  );
}
