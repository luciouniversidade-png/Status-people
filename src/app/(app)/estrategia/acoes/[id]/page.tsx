import Link from "@/components/Link";
import { notFound } from "next/navigation";
import { requireGestao, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Flash, Btn } from "@/components/ui";
import { fmtData, fmtDataHora } from "@/lib/utils";
import { brl } from "@/lib/operacoes";
import { listarAcoes, ACAO_STATUS } from "@/lib/gestao-estrategica";
import { SubNav } from "../../_ui";
import { FormAcao, opcoesAcao, MoverAcao, SituacaoAcao, podeMexerAcao } from "../_form";

export const dynamic = "force-dynamic";
const Item = ({ k, v }: { k: string; v: React.ReactNode }) => <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{k}</dt><dd className="mt-0.5 whitespace-pre-line text-sm text-ink">{v || <span className="text-slate-400">—</span>}</dd></div>;

export default async function Acao({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireGestao(); const { id } = await params; const sp = await searchParams; const aid = Number(id); if (!Number.isInteger(aid)) notFound();
  const [a] = await listarAcoes(scopeUnit(s), { id: aid, situacao: "TODAS", limite: 1 }); if (!a) notFound();
  const pode = podeMexerAcao(s, a); const aberta = ["A_FAZER", "EM_ANDAMENTO", "BLOQUEADA"].includes(a.status);
  const [hist, opcoes] = await Promise.all([
    sql<{ at: Date; user_nome: string | null; acao: string; antes: Record<string, unknown> | null; depois: Record<string, unknown> | null }[]>`SELECT at, user_nome, acao, antes, depois FROM audit_log WHERE entidade='action_plans' AND entidade_id=${aid} ORDER BY id`,
    pode && aberta ? opcoesAcao(s) : null]);
  const st = (v: unknown) => typeof v === "string" ? ACAO_STATUS[v] ?? v : "";
  return (
    <Page title={a.titulo} sub={<span className="flex flex-wrap items-center gap-2"><SituacaoAcao a={a} /> · {a.unidade ?? "rede"}{a.origem ? ` · ${a.origem}` : ""}</span>} actions={<Btn kind="ghost" href="/estrategia/acoes">Plano de ação</Btn>}>
      <SubNav atual="acoes" />
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="space-y-4">
          <Card title="5W2H" actions={pode ? <MoverAcao a={a} voltar={`/estrategia/acoes/${aid}`} /> : undefined}>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Item k="O quê" v={a.titulo} /><Item k="Por quê" v={a.porque} />
              <Item k="Quem" v={a.responsavel} /><Item k="Quando" v={<>{a.inicio ? `${fmtData(a.inicio)} → ` : ""}{fmtData(a.prazo)}{a.vencida ? <span className="text-erro"> · vencida há {a.dias_atraso} dia(s)</span> : null}</>} />
              <Item k="Onde" v={`${a.unidade ?? "Rede"}${a.local ? ` · ${a.local}` : ""}`} /><Item k="Quanto" v={a.custo_previsto !== null || a.custo_real !== null ? `${a.custo_previsto !== null ? `previsto ${brl(a.custo_previsto)}` : ""}${a.custo_real !== null ? ` · real ${brl(a.custo_real)}` : ""}` : null} />
              <div className="sm:col-span-2"><Item k="Como" v={a.como} /></div>
              {a.status === "BLOQUEADA" && <div className="sm:col-span-2"><Item k="Bloqueio — o que falta" v={`${a.bloqueio ?? ""}${a.bloqueio_desde ? ` (desde ${fmtData(a.bloqueio_desde)})` : ""}`} /></div>}
              {a.evidencia && <div className="sm:col-span-2"><Item k="Evidência de conclusão" v={a.evidencia} /></div>}
              {a.cancel_justificativa && <div className="sm:col-span-2"><Item k="Justificativa do cancelamento" v={a.cancel_justificativa} /></div>}
            </dl>
            <div className="mt-3 flex flex-wrap gap-3 border-t border-line pt-3 text-xs">
              {a.objective_id && <span>Objetivo: <Link className="text-acao" href={`/estrategia/okrs/${a.objective_id}`}>{a.objetivo}</Link></span>}
              {a.indicator_id && <span>Indicador: <Link className="text-acao" href={`/estrategia/indicadores/${a.indicator_id}`}>{a.indicador}</Link></span>}
              {a.project_id && <span>Projeto: <Link className="text-acao" href={`/estrategia/projetos/${a.project_id}`}>{a.projeto}</Link></span>}
              {a.ritual_meeting_id && <span>Reunião: <Link className="text-acao" href={`/estrategia/reunioes/${a.ritual_meeting_id}`}>{a.ritual} · {fmtData(a.reuniao_data)}</Link></span>}
              <span className="text-slate-500">criada por {a.criador ?? "—"}</span>
            </div>
          </Card>
          <Card title="Histórico"><ol className="space-y-1.5 text-sm">{hist.length === 0 && <li className="text-slate-500">Sem registros.</li>}{hist.map((h, k) => <li key={k}><span className="text-xs text-slate-500">{fmtDataHora(h.at)} · {h.user_nome ?? "sistema"}</span> — {h.acao}{h.depois && typeof h.depois === "object" && "status" in h.depois ? <> : {st(h.antes?.status)} → <b>{st(h.depois.status)}</b>{h.depois.bloqueio ? ` (${String(h.depois.bloqueio)})` : ""}</> : null}{h.depois && typeof h.depois === "object" && "prazo" in h.depois && h.antes && "prazo" in h.antes && h.antes.prazo !== h.depois.prazo ? <span className="text-xs text-slate-600"> · prazo {fmtData(String(h.antes.prazo))} → {fmtData(String(h.depois.prazo))}</span> : null}</li>)}</ol></Card>
        </div>
        {opcoes && <Card title="Editar ação"><FormAcao o={opcoes} a={a} padrao={{ voltar: `/estrategia/acoes/${aid}` }} /><p className="mt-2 text-xs text-slate-500">Mudanças de prazo e de responsável ficam no histórico.</p></Card>}
      </div>
    </Page>
  );
}
