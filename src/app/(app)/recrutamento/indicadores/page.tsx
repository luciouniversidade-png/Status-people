import Link from "@/components/Link";
import { requireStaff, scopeUnit } from "@/lib/auth";
import { Page, Card, Table, Td, Stat, Field, Select, Btn } from "@/components/ui";
import { fmtData, getSettings } from "@/lib/utils";
import { ETAPA_LABEL, ORIGEM_CAND } from "@/lib/talento";
import { indicadoresRecrutamento, qualidadeContratacao } from "@/lib/recrutamento-indicadores";
import { DECISAO_LABEL } from "@/lib/recrutamento-fit";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
const pct = (v: number | null | undefined) => v == null ? "—" : `${Math.round(v * 100)}%`;
const dias = (v: number | null | undefined) => v == null ? "—" : `${v.toFixed(v < 10 ? 1 : 0).replace(".", ",")} d`;
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export default async function IndicadoresRecrutamento({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); if (!["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role)) redirect("/recrutamento");
  const sp = await searchParams; const meses = [3, 6, 12].includes(Number(sp.meses)) ? Number(sp.meses) : 6; const cfg = await getSettings(); const u = scopeUnit(s);
  const [R, QH] = await Promise.all([indicadoresRecrutamento(u, meses, { etapas: cfg.recrutamento.etapas, ...cfg.recrutamento.indicadores }), qualidadeContratacao(u)]);
  const maxM = Math.max(1, ...R.mensal.map(m => Math.max(m.candidaturas, m.contratacoes * 4)));
  return (
    <Page title="Indicadores de recrutamento" sub={`Tempo, prazo, conversão, origem, qualidade e retenção das contratações · desde ${fmtData(R.inicio)}${u !== null ? " · sua unidade" : " · rede"}`} actions={<><form className="flex items-end gap-1"><Field label="Período"><Select name="meses" defaultValue={String(meses)}><option value="3">3 meses</option><option value="6">6 meses</option><option value="12">12 meses</option></Select></Field><Btn small kind="ghost">Ver</Btn></form><Btn kind="ghost" href="/recrutamento">Vagas</Btn></>}>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <Stat label="Vagas abertas" value={R.kpi.abertas} hint={R.kpi.atrasadas ? `${R.kpi.atrasadas} fora do prazo` : "todas no prazo"} />
        <Stat label="Contratações" value={R.kpi.contratacoes} hint="no período" />
        <Stat label="Tempo para preencher" value={dias(R.kpi.tempoMedio)} hint={R.kpi.tempoMediano != null ? `mediana ${dias(R.kpi.tempoMediano)}` : "sem vaga fechada"} />
        <Stat label="Preenchidas no prazo" value={pct(R.kpi.noPrazo)} hint={`${R.kpi.preenchidas} vaga(s) fechada(s)`} />
        <Stat label="Candidaturas" value={R.kpi.candidaturas} hint={R.kpi.porVaga != null ? `${R.kpi.porVaga.toFixed(1).replace(".", ",")} por vaga` : undefined} />
        <Stat label="Aproveitamento" value={pct(R.kpi.aproveitamento)} hint="contratados ÷ processos encerrados" />
        <Stat label={`Ficaram ${cfg.recrutamento.indicadores.retencaoDias} dias`} value={pct(R.retencao)} hint={`${R.naoFicaram.length} saíram antes`} />
        <Stat label="Paradas além do prazo" value={<span className={R.kpi.parados ? "text-aviso" : ""}>{R.kpi.parados}</span>} hint={`triagem > ${cfg.recrutamento.indicadores.slaTriagemDias} d · demais > 7 d`} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Mês a mês">
          <div className="flex items-end gap-2 overflow-x-auto pb-1" style={{ minHeight: 150 }}>{R.mensal.map(m => <div key={m.mes} className="flex min-w-[46px] flex-1 flex-col items-center gap-1 text-[10px]">
            <div className="flex h-[110px] items-end gap-0.5"><div title={`${m.candidaturas} candidaturas`} className="w-3 rounded-t bg-acao/70" style={{ height: `${(m.candidaturas / maxM) * 100}%` }} /><div title={`${m.contratacoes} contratações`} className="w-3 rounded-t bg-ok" style={{ height: `${(m.contratacoes * 4 / maxM) * 100}%` }} /></div>
            <div className="text-slate-500">{MES[Number(m.mes.slice(5)) - 1]}/{m.mes.slice(2, 4)}</div><div className="text-slate-700">{m.candidaturas} · <b className="text-ok">{m.contratacoes}</b></div></div>)}</div>
          <p className="mt-1 text-[11px] text-slate-500"><span className="text-acao">■</span> candidaturas · <span className="text-ok">■</span> contratações (escala ×4). Vagas abertas no período: {R.mensal.reduce((x, m) => x + m.abertas, 0)} · preenchidas: {R.mensal.reduce((x, m) => x + m.preenchidas, 0)}.</p>
        </Card>
        <Card title="Funil e tempo em cada etapa">
          <Table head={["Etapa", "Chegaram", "Passaram da anterior", "Tempo na etapa"]} empty="Sem candidaturas no período.">{R.funil.map(f => { const t = R.porEtapa.find(x => x.etapa === f.etapa); return <tr key={f.etapa}><Td>{ETAPA_LABEL[f.etapa] ?? f.etapa}</Td><Td>{f.n}</Td><Td>{f.conv == null ? "—" : <span className={f.conv < 0.3 ? "text-aviso" : ""}>{pct(f.conv)}</span>}</Td><Td>{t?.n ? <>{dias(t.media)} <span className="text-[10px] text-slate-400">média · {dias(t.mediana)} mediana · {t.n} passagem(ns)</span></> : "—"}</Td></tr>; })}</Table>
          <p className="mt-1 text-[11px] text-slate-500">Tempo medido pela linha do tempo de cada candidatura (entrada na etapa → próxima movimentação).</p>
        </Card>
      </div>
      <Card className="mt-4" title="Vagas abertas — prazo e previsão">
        <Table head={["Vaga", "Unidade", "Aberta há", "Prazo", "Situação", "Em processo", "Sem movimento", "Previsão de preenchimento"]} empty="Nenhuma vaga aberta.">{R.abertas.map(v => <tr key={v.id}><Td><Link className="text-acao" href={`/recrutamento/vagas/${v.id}`}>{v.titulo}</Link></Td><Td className="text-xs">{v.unidade}</Td><Td>{v.dias} d</Td><Td className="text-xs">{fmtData(v.limite)}{v.prazo ? "" : <span className="text-slate-400"> (padrão)</span>}</Td><Td>{v.atrasada ? <span className="font-medium text-erro">fora do prazo</span> : <span className="text-ok">no prazo</span>}</Td><Td>{v.ativos}{v.ativos === 0 && <span className="text-xs text-aviso"> · sem candidato</span>}</Td><Td className={v.parada > 7 ? "text-aviso" : ""}>{v.parada} d</Td><Td className="text-xs">{fmtData(v.previsao)}</Td></tr>)}</Table>
        <p className="mt-1 text-[11px] text-slate-500">Previsão = abertura + tempo médio de preenchimento das vagas fechadas no período (sem histórico, {cfg.recrutamento.indicadores.slaVagaDias} dias). Vaga sem prazo usa {cfg.recrutamento.indicadores.slaVagaDias} dias como referência.</p>
      </Card>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Candidaturas paradas além do prazo">
          <Table head={["Candidato", "Vaga", "Etapa", "Parado há"]} empty="Nenhuma candidatura parada. 👍">{R.parados.slice(0, 15).map(p => <tr key={p.id}><Td><Link className="text-acao" href={`/recrutamento/candidatos/${p.candidate_id}`}>{p.nome}</Link></Td><Td className="text-xs"><Link className="text-acao" href={`/recrutamento/vagas/${p.requisition_id}`}>{p.vaga}</Link></Td><Td className="text-xs">{ETAPA_LABEL[p.etapa] ?? p.etapa}</Td><Td className="text-aviso">{p.dias} d</Td></tr>)}</Table>
          {R.parados.length > 15 && <p className="mt-1 text-xs text-slate-500">+ {R.parados.length - 15} outras.</p>}
        </Card>
        <Card title="De onde vêm as boas contratações">
          <Table head={["Origem", "Candidaturas", "Contratados", "Taxa", "Saíram em até " + cfg.recrutamento.indicadores.retencaoDias + " d"]} empty="Sem candidaturas no período.">{R.origens.map(o => <tr key={o.origem}><Td>{ORIGEM_CAND[o.origem] ?? o.origem}</Td><Td>{o.candidaturas}</Td><Td>{o.contratados}</Td><Td>{o.candidaturas ? pct(o.contratados / o.candidaturas) : "—"}</Td><Td className={o.naoFicaram ? "text-erro" : ""}>{o.naoFicaram}</Td></tr>)}</Table>
        </Card>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title="A aderência acerta?">
          <Table head={["Grupo", "Com aderência", "Média"]} empty="">{([["Contratados", R.qualidade.contratados], ["Reprovados", R.qualidade.reprovados], ["Em processo", R.qualidade.emProcesso]] as const).map(([k, g]) => <tr key={k}><Td>{k}</Td><Td>{g.n}</Td><Td>{g.media == null ? "—" : `${Math.round(g.media)}%`}</Td></tr>)}</Table>
          <p className="mt-1 text-[11px] text-slate-500">Se contratados e reprovados têm médias parecidas, os critérios das vagas precisam ser revistos.</p>
        </Card>
        <Card title="Decisões sobre a shortlist">
          <Table head={["Decisão", "Quantidade"]} empty="">{R.dec.porDecisao.map(d => <tr key={d.k}><Td>{DECISAO_LABEL[d.k]}</Td><Td>{d.n}</Td></tr>)}<tr><Td><b>Contrariaram a sugestão</b></Td><Td><b>{R.dec.divergiu}</b>{R.dec.total ? <span className="text-xs text-slate-500"> ({pct(R.dec.divergiu / R.dec.total)})</span> : ""}</Td></tr></Table>
          <p className="mt-1 text-[11px] text-slate-500">Contrariar a sugestão é normal — a justificativa fica na linha do tempo de cada candidatura.</p>
        </Card>
        <Card title="Motivos de reprovação">
          <Table head={["Motivo", "Qtd"]} empty="Nenhuma reprovação no período.">{R.motivos.map(([m, n]) => <tr key={m}><Td className="text-xs">{m}</Td><Td>{n}</Td></tr>)}</Table>
        </Card>
      </div>
      <Card className="mt-4" title="Qualidade da contratação — contratados nos últimos 24 meses">
        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4"><Stat label="Contratados pela seleção" value={QH.contratados} /><Stat label="Seguem na escola" value={QH.contratados ? `${Math.round(100 * QH.ativos / QH.contratados)}%` : "—"} hint={`${QH.ativos} de ${QH.contratados}`} /><Stat label="Nota na 1ª avaliação" value={QH.nota1 != null ? QH.nota1.toFixed(2).replace(".", ",") : "—"} hint={`${QH.avaliados} avaliado(s)`} /><Stat label="Média da casa" value={QH.mediaCasa != null ? QH.mediaCasa.toFixed(2).replace(".", ",") : "—"} hint="última avaliação de cada colaborador" /></div>
        <Table head={["Origem", "Contratados", "Seguem", "Avaliados", "Nota na 1ª avaliação"]} empty="Nenhuma contratação pela seleção nos últimos 24 meses.">{QH.origens.map(o => <tr key={o.origem}><Td>{ORIGEM_CAND[o.origem] ?? o.origem}</Td><Td>{o.contratados}</Td><Td>{o.ativos}</Td><Td>{o.avaliados}</Td><Td>{o.nota != null ? <span className={QH.mediaCasa != null && o.nota < QH.mediaCasa - 0.3 ? "text-erro" : ""}>{o.nota.toFixed(2).replace(".", ",")}</span> : "—"}</Td></tr>)}</Table>
        <p className="mt-1 text-[11px] text-slate-500">Uma boa contratação fica e vai bem na primeira avaliação. Origens com nota bem abaixo da média da casa (vermelho) merecem revisão dos critérios ou do canal.</p>
      </Card>
      <Card className="mt-4" title={`Contratações que não ficaram (saíram em até ${cfg.recrutamento.indicadores.retencaoDias} dias)`}>
        <Table head={["Colaborador", "Vaga", "Origem", "Aderência na seleção", "Admissão", "Saída", "Dias"]} empty="Nenhuma contratação do período saiu antes do prazo.">{R.naoFicaram.map(c => <tr key={c.application_id}><Td><Link className="text-acao" href={`/colaboradores/${c.employee_id}`}>{c.nome}</Link></Td><Td className="text-xs">{c.vaga}</Td><Td className="text-xs">{ORIGEM_CAND[c.origem ?? ""] ?? c.origem}</Td><Td>{c.score == null ? "—" : `${c.score}%`}</Td><Td className="text-xs">{fmtData(c.admissao)}</Td><Td className="text-xs">{fmtData(c.desligamento)}</Td><Td className="text-erro">{c.dias}</Td></tr>)}</Table>
        <p className="mt-1 text-[11px] text-slate-500">Cada saída precoce custa uma nova seleção (≈ {cfg.analytics.custoReposicaoSalarios} salários pela configuração de People Analytics). Vale olhar origem, critérios e integração dessas contratações.</p>
      </Card>
    </Page>
  );
}
