import Link from "@/components/Link";
import { PrintButton } from "@/components/PrintButton";
import { requireGestao, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge, Field, Input, Btn } from "@/components/ui";
import { fmtData, getSettings, hoje } from "@/lib/utils";
import { SAUDE, PROJ_STATUS, ATIVOS_PROJ } from "@/lib/estrategia";
import { painelGestao, painelMarketing, listarAcoes, listarIndicadores, fmtValor, fmtNum, ORIGEM_FUNIL_LABEL } from "@/lib/gestao-estrategica";
import { radarFamilias } from "@/lib/radar-familia";
import { farol, nomePeriodo, periodoDe, validoPeriodo, somaMeses, FAIXA_SAUDE, aderenciaRitual, type Perspectiva } from "@/lib/gestao-calc";
import { FarolBadge, SaudeDetalhe, metaCurta, corFaixa } from "../_ui";

export const dynamic = "force-dynamic";

export default async function Relatorio({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireGestao(); const sp = await searchParams; const u = scopeUnit(s); const cfg = await getSettings(); const h = hoje(); const atual = periodoDe(h);
  const mes = sp.mes && validoPeriodo(sp.mes) && sp.mes <= atual ? sp.mes : atual; const ini = `${mes}-01`, fim = `${somaMeses(mes, 1)}-01`; const faixas = cfg.estrategia.faixasSaude as [number, number];
  const [g, mk, rad, indsAte, concluidas, atencao, reunioes, decisoes, unidade] = await Promise.all([
    painelGestao(u), painelMarketing(u, mes, 3), radarFamilias(u), listarIndicadores(u, { ate: mes }),
    listarAcoes(u, { situacao: "CONCLUIDA", concluidasDesde: ini, limite: 200 }).then(xs => xs.filter(a => a.concluida_em && a.concluida_em < fim)),
    listarAcoes(u, { situacao: "ATENCAO", limite: 15 }),
    sql<{ id: number; ritual: string; data: string; status: string; ata: boolean; decisoes: number; encaminhamentos: number }[]>`SELECT m.id, r.nome AS ritual, m.data::text, m.status, coalesce(trim(m.ata),'') <> '' AS ata, (SELECT count(*) FROM decisions d WHERE d.ritual_meeting_id=m.id)::int AS decisoes, (SELECT count(*) FROM action_plans a WHERE a.ritual_meeting_id=m.id)::int AS encaminhamentos FROM ritual_meetings m JOIN rituals r ON r.id=m.ritual_id WHERE m.data >= ${ini} AND m.data < ${fim} ${u === null ? sql`` : sql`AND (r.unit_id IS NULL OR r.unit_id=${u})`} ORDER BY m.data`,
    sql<{ id: number; titulo: string; area: string; data: string; status: string }[]>`SELECT id, titulo, area, data::text, status FROM decisions WHERE data >= ${ini} AND data < ${fim} ${u === null ? sql`` : sql`AND (unit_id IS NULL OR unit_id=${u})`} ORDER BY data`,
    u === null ? Promise.resolve(null) : sql<{ nome: string }[]>`SELECT nome FROM units WHERE id=${u}`.then(r => r[0]?.nome ?? null)]);
  const persp = cfg.estrategia.perspectivas as Perspectiva[];
  const indsMes = indsAte.map(i => { const v = i.serie[mes] ?? null; return { ...i, vMes: v, fMes: farol(v, i.config) }; });
  const projetos = g.pf.rows.filter(r => ATIVOS_PROJ.includes(r.status)); const ativos = g.ok.objetivos.filter(o => o.status === "ATIVO");
  const rs = rad.resumo; const ident = g.ident.vigente;
  return (
    <Page title={`Relatório executivo — ${nomePeriodo(mes)}`} sub={`Colégio Status${unidade ? ` · ${unidade}` : " · rede"} · retrato de ${fmtData(h)} (saúde, OKRs, projetos, ações e famílias) e movimentos do mês (indicadores, reuniões, decisões, ações concluídas e captação).`}
      actions={<><PrintButton /><Btn kind="ghost" href="/estrategia">Painel</Btn></>}>
      <form className="mb-4 flex items-end gap-2 print:hidden"><Field label="Mês"><Input name="mes" type="month" defaultValue={mes} max={atual} /></Field><Btn kind="ghost">Ver</Btn></form>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-start print:grid-cols-2">
          <Card title="Saúde estratégica"><SaudeDetalhe saude={g.saude} comps={g.comps} faixas={faixas} /></Card>
          <Card title="Resumo para a Direção"><ul className="space-y-1.5 text-sm">
            <li>Saúde estratégica <b className={corFaixa(g.saude.score, faixas)}>{g.saude.score === null ? "sem dados" : `${Math.round(g.saude.score)} (${FAIXA_SAUDE[g.saude.faixa!]})`}</b>.</li>
            <li>OKRs {g.ciclo}: progresso <b>{g.ok.progressoCiclo === null ? "—" : `${g.ok.progressoCiclo}%`}</b> em {ativos.length} objetivo(s); {g.ok.krsBaixaConfianca} KR(s) com confiança baixa.</li>
            <li>Indicadores: <b>{g.noAlvo}</b> de {g.comMeta} com meta no alvo; {g.semMedicao} com medição atrasada.</li>
            <li>Projetos: {g.pf.ativos} ativo(s), <b className={g.pf.vermelhos ? "text-erro" : ""}>{g.pf.vermelhos} em risco</b>, {g.pf.marcosAtrasados} marco(s) atrasado(s).</li>
            <li>Plano de ação: {g.ac.abertas} aberta(s), <b className={g.ac.vencidas ? "text-erro" : ""}>{g.ac.vencidas} vencida(s)</b>, {g.ac.bloqueadas} bloqueada(s); {concluidas.length} concluída(s) no mês.</li>
            <li>Rituais: {g.rit.emDia} de {g.rit.ativos} em dia; {reunioes.filter(r => r.status === "REALIZADA").length} reunião(ões) realizada(s) no mês; {g.rit.atasPendentes} ata(s) pendente(s).</li>
            <li>Famílias: {rs.ativas} ativa(s) — {rs.saudaveis} saudável(is), {rs.atencao} em atenção, <b className={rs.risco ? "text-erro" : ""}>{rs.risco} em risco</b>; NPS {rs.nps === null ? "—" : rs.nps} ({rs.npsRespostas} resposta(s) em 180 dias); {rs.rematriculaPendente} sem rematrícula para {rad.anoLetivo}.</li>
            <li>Captação em {nomePeriodo(mes)}: {mk.atual.candidatos} candidato(s), {mk.atual.matriculas} matrícula(s) nova(s); custo por matrícula {mk.atual.cac.valor === null ? "sem base" : fmtValor(mk.atual.cac.valor, "R$")}.</li>
          </ul></Card>
        </div>
        {ident && <Card title={`Identidade institucional (versão ${ident.versao})`}><div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2"><div><b>Missão.</b> {ident.missao}</div><div><b>Visão.</b> {ident.visao}</div></div>{(ident.valores ?? []).length > 0 && <p className="mt-2 text-xs text-slate-600"><b>Valores:</b> {(ident.valores ?? []).map(v => v.nome).join(" · ")}</p>}</Card>}
        <Card title={`Indicadores — valor de ${nomePeriodo(mes)}`}>
          {persp.map(p => { const xs = indsMes.filter(i => i.perspectiva === p.chave); if (!xs.length) return null; return <div key={p.chave} className="mb-3 last:mb-0"><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{p.nome}</div>
            <Table head={["Indicador", nomePeriodo(mes), "Meta", "Farol"]}>{xs.map(i => <tr key={i.id}><Td>{i.nome}<div className="text-[11px] text-slate-500">{i.unidade ?? "rede"}</div></Td><Td className="whitespace-nowrap tabular-nums">{fmtValor(i.vMes, i.unidade_medida)}</Td><Td className="whitespace-nowrap text-xs">{metaCurta(i.config, i.unidade_medida)}</Td><Td><FarolBadge f={i.fMes} /></Td></tr>)}</Table></div>; })}
          {indsMes.filter(i => !i.perspectiva).length > 0 && <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Sem perspectiva</div><Table head={["Indicador", nomePeriodo(mes), "Meta", "Farol"]}>{indsMes.filter(i => !i.perspectiva).map(i => <tr key={i.id}><Td>{i.nome}</Td><Td className="whitespace-nowrap tabular-nums">{fmtValor(i.vMes, i.unidade_medida)}</Td><Td className="whitespace-nowrap text-xs">{metaCurta(i.config, i.unidade_medida)}</Td><Td><FarolBadge f={i.fMes} /></Td></tr>)}</Table></div>}
          {indsMes.length === 0 && <p className="text-sm text-slate-500">Nenhum indicador cadastrado.</p>}
        </Card>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-start print:grid-cols-2">
          <Card title={`OKRs ${g.ciclo}`}>{ativos.length === 0 ? <p className="text-sm text-slate-500">Nenhum objetivo ativo.</p> : <ul className="space-y-2 text-sm">{ativos.map(o => <li key={o.id}><div className="flex justify-between gap-2"><span className="font-medium">{o.titulo}</span><b className="tabular-nums">{o.progresso === null ? "—" : `${o.progresso}%`}</b></div><ul className="text-xs text-slate-600">{o.krs.map(k => <li key={k.id}>{k.titulo}: {k.valor_atual ?? "—"} de {k.valor_meta}{k.metrica ? ` ${k.metrica}` : ""} ({k.progresso === null ? "sem medição" : `${k.progresso}%`})</li>)}</ul></li>)}</ul>}</Card>
          <Card title="Projetos ativos"><Table head={["Projeto", "Saúde", "Situação", "Marcos"]} empty="Nenhum projeto ativo.">{projetos.map(r => <tr key={r.id}><Td>{r.nome}<div className="text-[11px] text-slate-500">{r.owner ?? "—"}</div></Td><Td><Badge v={r.saude === "VERDE" ? "APROVADA" : r.saude === "AMARELO" ? "PENDENTE" : "REJEITADA"} label={SAUDE[r.saude]} /></Td><Td className="text-xs">{PROJ_STATUS[r.status]}</Td><Td className={`text-xs ${r.marcos_atrasados ? "text-erro" : ""}`}>{r.marcos_ok}/{r.marcos}{r.marcos_atrasados ? ` · ${r.marcos_atrasados} atrasado(s)` : ""}</Td></tr>)}</Table></Card>
          <Card title="Ações vencidas ou bloqueadas (hoje)"><Table head={["Ação", "Responsável", "Prazo", "Situação"]} empty="Nenhuma.">{atencao.map(a => <tr key={a.id}><Td>{a.titulo}</Td><Td className="text-xs">{a.responsavel ?? "—"}</Td><Td className="whitespace-nowrap text-xs">{fmtData(a.prazo)}</Td><Td className="text-xs">{a.status === "BLOQUEADA" ? `bloqueada: ${a.bloqueio ?? ""}` : `vencida há ${a.dias_atraso} dia(s)`}</Td></tr>)}</Table></Card>
          <Card title={`Ações concluídas em ${nomePeriodo(mes)} (${concluidas.length})`}><Table head={["Ação", "Responsável", "Concluída", "Custo real"]} empty="Nenhuma ação concluída no mês.">{concluidas.map(a => <tr key={a.id}><Td>{a.titulo}{a.evidencia && <div className="text-[11px] text-slate-500">{a.evidencia}</div>}</Td><Td className="text-xs">{a.responsavel ?? "—"}</Td><Td className="whitespace-nowrap text-xs">{fmtData(a.concluida_em)}</Td><Td className="whitespace-nowrap text-xs tabular-nums">{a.custo_real === null ? "—" : fmtValor(a.custo_real, "R$")}</Td></tr>)}</Table></Card>
          <Card title={`Reuniões de gestão em ${nomePeriodo(mes)}`}><Table head={["Data", "Ritual", "Situação", "Ata", "Decisões", "Encam."]} empty="Nenhuma reunião registrada no mês.">{reunioes.map(r => <tr key={r.id}><Td className="whitespace-nowrap text-xs"><Link className="text-acao" href={`/estrategia/reunioes/${r.id}`}>{fmtData(r.data)}</Link></Td><Td className="text-xs">{r.ritual}</Td><Td className="text-xs">{r.status === "REALIZADA" ? "realizada" : "cancelada"}</Td><Td className={`text-xs ${r.status === "REALIZADA" && !r.ata ? "text-aviso" : ""}`}>{r.status !== "REALIZADA" ? "—" : r.ata ? "sim" : "pendente"}</Td><Td className="text-xs">{r.decisoes || "—"}</Td><Td className="text-xs">{r.encaminhamentos || "—"}</Td></tr>)}</Table>
            <p className="mt-2 text-xs text-slate-500">Aderência atual por ritual: {g.rit.lista.filter(r => r.ativo).map(r => { const ad = aderenciaRitual(r.realizadas_janela, r.tipo, r.criado_dias); return `${r.nome} ${ad.pct === null ? "sem base" : `${ad.pct}%`}`; }).join(" · ") || "—"}</p></Card>
          <Card title={`Decisões registradas em ${nomePeriodo(mes)}`}>{decisoes.length === 0 ? <p className="text-sm text-slate-500">Nenhuma decisão no mês.</p> : <ul className="space-y-1 text-sm">{decisoes.map(d => <li key={d.id}><span className="text-xs text-slate-500">{fmtData(d.data)} · {d.area}</span> — {d.titulo}{d.status !== "VIGENTE" ? <span className="text-xs text-slate-500"> ({d.status.toLowerCase()})</span> : null}</li>)}</ul>}</Card>
          <Card title={`Captação — ${nomePeriodo(mes)}`}><Table head={["Canal", "Investimento", "Candidatos", "Matrículas", "CAC"]}>{mk.canais.filter(c => c.candidatos || c.matriculas || c.investimento).map(c => <tr key={c.origem}><Td className="text-xs">{ORIGEM_FUNIL_LABEL[c.origem] ?? c.origem}</Td><Td className="whitespace-nowrap text-xs tabular-nums">{fmtValor(c.investimento, "R$")}</Td><Td className="text-xs tabular-nums">{c.candidatos}</Td><Td className="text-xs tabular-nums">{c.matriculas}</Td><Td className="whitespace-nowrap text-xs tabular-nums">{c.cac.valor === null ? "sem base" : fmtValor(c.cac.valor, "R$")}</Td></tr>)}</Table>
            <p className="mt-2 text-xs text-slate-500">Total: {fmtValor(mk.atual.investimento, "R$")} · {mk.atual.candidatos} candidato(s) · {mk.atual.reservas} reserva(s) · {mk.atual.matriculas} matrícula(s) nova(s) · conversão {mk.atual.conversao.valor === null ? "sem base" : `${fmtNum(mk.atual.conversao.valor, 1)}%`}.</p></Card>
          <Card title="Alertas de hoje">{g.alertas.length === 0 ? <p className="text-sm text-ok">Nenhum alerta.</p> : <ul className="space-y-1 text-sm">{g.alertas.map((a, i) => <li key={i} className={a.nivel === "ALTO" ? "text-erro" : "text-aviso"}>• {a.texto}</li>)}</ul>}</Card>
        </div>
        <p className="text-xs text-slate-500">Gerado em {fmtData(h)} por {s.nome}. Regras de cálculo explícitas em cada tela de origem; ausência de dado aparece como “—” ou “sem base”, nunca como zero.</p>
      </div>
    </Page>
  );
}
