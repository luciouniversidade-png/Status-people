import Link from "@/components/Link";
import { Modal } from "@/components/Modal";
import { requireGestao, scopeUnit } from "@/lib/auth";
import { Page, Card, Table, Td, Flash, Field, Input, Select, Btn, Stat } from "@/components/ui";
import { fmtData, getSettings } from "@/lib/utils";
import { brl } from "@/lib/operacoes";
import { listarAcoes, SITUACAO_ACAO } from "@/lib/gestao-estrategica";
import { resumoAcoes } from "@/lib/metricas-extra";
import { SubNav, corFaixa } from "../_ui";
import { FormAcao, opcoesAcao, MoverAcao, SituacaoAcao, podeMexerAcao } from "./_form";

export const dynamic = "force-dynamic";

export default async function Acoes({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireGestao(); const sp = await searchParams; const u = scopeUnit(s); const cfg = await getSettings();
  const situacao = sp.situacao && SITUACAO_ACAO[sp.situacao] ? sp.situacao : "ABERTAS"; const minhas = sp.minhas === "1";
  const gestao = ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "FINANCEIRO", "OPERACOES", "COMERCIAL"].includes(s.role);
  const [acoes, r, opcoes] = await Promise.all([listarAcoes(u, { situacao, responsavel: minhas ? s.id : null, q: sp.q || null }), resumoAcoes(u), gestao ? opcoesAcao(s) : null]);
  const qs = new URLSearchParams(Object.entries({ situacao, minhas: minhas ? "1" : "", q: sp.q ?? "" }).filter(([, v]) => v)).toString(); const voltar = `/estrategia/acoes${qs ? `?${qs}` : ""}`;
  return (
    <Page title="Plano de ação" sub="Ações 5W2H — o quê, por quê, onde, quando, quem, como e quanto. Vencida = passou do prazo sem estar bloqueada; bloqueada = aguarda apoio de terceiros e não conta como atraso de quem executa."
      actions={<>{opcoes && <Modal label="Nova ação" kind="primary" small={false} title="Nova ação (5W2H)"><FormAcao o={opcoes} padrao={{ voltar }} /></Modal>}<Btn kind="ghost" href="/estrategia/acoes/quadro">Ver em quadro</Btn><Btn kind="ghost" href="/api/export/acoes">Exportar CSV</Btn></>}>
      <SubNav atual="acoes" />
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Abertas" value={r.abertas} href="/estrategia/acoes" />
        <Stat label="Em dia" value={r.pct === null ? "—" : <span className={corFaixa(r.pct, cfg.estrategia.faixasSaude as [number, number])}>{Math.round(r.pct)}%</span>} hint={`${r.em_dia} de ${r.abertas}`} />
        <Stat label="Vencidas" value={<span className={r.vencidas ? "text-erro" : ""}>{r.vencidas}</span>} href="/estrategia/acoes?situacao=VENCIDAS" />
        <Stat label="Bloqueadas" value={<span className={r.bloqueadas ? "text-aviso" : ""}>{r.bloqueadas}</span>} hint="aguardando apoio" href="/estrategia/acoes?situacao=BLOQUEADA" />
        <Stat label="Concluídas em 30 dias" value={r.concluidas_30} href="/estrategia/acoes?situacao=CONCLUIDA" />
        <Stat label="Custo previsto × real" value={<span className="text-lg">{brl(r.custo_previsto ?? 0)}</span>} hint={`real: ${brl(r.custo_real ?? 0)}`} />
      </div>
      <form className="mb-3 grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
        <Field label="Situação"><Select name="situacao" defaultValue={situacao}>{Object.entries(SITUACAO_ACAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Buscar"><Input name="q" defaultValue={sp.q ?? ""} placeholder="ação, motivo ou origem" /></Field>
        <label className="flex items-center gap-1.5 pb-2 text-xs"><input type="checkbox" name="minhas" value="1" defaultChecked={minhas} /> só as minhas</label>
        <Btn kind="ghost">Filtrar</Btn>
      </form>
      <Card title={`${SITUACAO_ACAO[situacao]}${minhas ? " · sob minha responsabilidade" : ""} (${acoes.length})`}>
        <Table head={["O quê", "Quem", "Quando", "Onde", "Quanto", "Ligada a", "Situação", ""]} empty="Nenhuma ação nesta situação.">{acoes.map(a => <tr key={a.id}>
          <Td><Link className="font-medium text-acao" href={`/estrategia/acoes/${a.id}`}>{a.titulo}</Link>{a.porque && <div className="max-w-[22rem] text-xs text-slate-500">{a.porque}</div>}{a.origem && <div className="text-[11px] text-slate-400">{a.origem}</div>}</Td>
          <Td className="text-xs">{a.responsavel ?? "—"}</Td>
          <Td className={`whitespace-nowrap text-xs ${a.vencida ? "font-medium text-erro" : ""}`}>{fmtData(a.prazo)}{a.inicio && <div className="text-[11px] text-slate-500">início {fmtData(a.inicio)}</div>}</Td>
          <Td className="text-xs">{a.unidade ?? "rede"}{a.local ? <div className="text-[11px] text-slate-500">{a.local}</div> : null}</Td>
          <Td className="whitespace-nowrap text-xs tabular-nums">{a.custo_previsto !== null ? brl(a.custo_previsto) : "—"}{a.custo_real !== null ? <div className="text-[11px] text-slate-500">real {brl(a.custo_real)}</div> : null}</Td>
          <Td className="text-xs">{a.objective_id && <div><Link className="text-acao" href={`/estrategia/okrs/${a.objective_id}`}>{a.objetivo}</Link></div>}{a.indicator_id && <div><Link className="text-acao" href={`/estrategia/indicadores/${a.indicator_id}`}>{a.indicador}</Link></div>}{a.project_id && <div><Link className="text-acao" href={`/estrategia/projetos/${a.project_id}`}>{a.projeto}</Link></div>}{a.ritual_meeting_id && <div><Link className="text-acao" href={`/estrategia/reunioes/${a.ritual_meeting_id}`}>{a.ritual} · {fmtData(a.reuniao_data)}</Link></div>}{!a.objective_id && !a.indicator_id && !a.project_id && !a.ritual_meeting_id && "—"}</Td>
          <Td><SituacaoAcao a={a} /></Td>
          <Td>{podeMexerAcao(s, a) ? <MoverAcao a={a} voltar={voltar} /> : null}</Td>
        </tr>)}</Table>
      </Card>
    </Page>
  );
}
