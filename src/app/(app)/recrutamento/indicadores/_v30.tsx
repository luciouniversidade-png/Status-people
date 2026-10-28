// v30 · indicadores novos: saúde das vagas, projeção do próximo mês, tempo por unidade e cargo, propostas, experiência do candidato
// e o índice de qualidade da contratação (retenção + gestor aos 90 dias + 1ª avaliação)
import Link from "@/components/Link";
import { Card, Table, Td, Stat, Badge } from "@/components/ui";
import { BarrasH, COR } from "@/components/graficos";
import { fmtData } from "@/lib/utils";
import { ORIGEM_CAND } from "@/lib/talento";
import { saudeVagas, projetar, tempoParaPreencher, propostas, experienciaCandidato, qualidadeContratacoes, tomSaude } from "@/lib/recrutamento-v30";

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const n1 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1).replace(".", ","));
const corTom = { bom: "text-ok", atencao: "text-aviso", ruim: "text-erro" } as const;

export async function IndicadoresV30({ u, meses, cfg, mensal }: { u: number | null; meses: number; cfg: { indicadores: { slaTriagemDias: number; slaVagaDias: number; retencaoDias: number }; candidatosPorVaga: number; minimoExperiencia: number; satisfacaoGestorDias: number }; mensal: { mes: string; candidaturas: number; contratacoes: number }[] }) {
  const [saude, tempo, prop, exp, q] = await Promise.all([
    saudeVagas(u, { ...cfg.indicadores, candidatosPorVaga: cfg.candidatosPorVaga }), tempoParaPreencher(u), propostas(u, meses), experienciaCandidato(u, Math.max(meses, 12), cfg.minimoExperiencia), qualidadeContratacoes(u, cfg.indicadores.retencaoDias),
  ]);
  const passados = mensal.slice(0, -1); // o mês corrente ainda não fechou
  const pCand = projetar(passados.map(m => m.candidaturas)), pCont = projetar(passados.map(m => m.contratacoes));
  const media = saude.length ? Math.round(saude.reduce((n, x) => n + x.score, 0) / saude.length) : null;
  return <>
    <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card title={`Saúde das vagas abertas${media !== null ? ` — média ${media}/100` : ""}`}>
        <Table head={["Vaga", "Saúde", "O que puxa para baixo"]} empty="Nenhuma vaga aberta.">{[...saude].sort((a, b) => a.score - b.score).map(v => <tr key={v.id}><Td><Link className="text-acao" href={`/recrutamento/vagas/${v.id}`}>{v.titulo}</Link><div className="text-[11px] text-slate-500">{v.unidade} · {v.ativos} em processo para {v.quantidade} posição(ões)</div></Td><Td className={`font-semibold tabular-nums ${corTom[tomSaude(v.score)]}`}>{v.score}</Td><Td className="text-xs">{v.motivos.join(" · ") || <span className="text-ok">tudo em ordem</span>}</Td></tr>)}</Table>
        <p className="mt-1 text-[11px] text-slate-500">100 = candidaturas suficientes ({cfg.candidatosPorVaga} por posição), alguém além da triagem, nada parado além do prazo, dentro do prazo da vaga e notas dos avaliadores em dia.</p>
      </Card>
      <Card title="Próximo mês — projeção">
        <div className="grid grid-cols-2 gap-3">
          {([["Candidaturas", pCand], ["Contratações", pCont]] as const).map(([k, p]) => <div key={k} className="rounded-md border border-line p-3"><div className="text-xs text-slate-500">{k}</div><div className="text-2xl font-semibold tabular-nums text-navy">{p ? (p.min === p.max ? p.min : `${p.min} a ${p.max}`) : "—"}</div><div className="text-[11px] text-slate-500">{p ? <>confiança <b className={p.confianca === "alta" ? "text-ok" : p.confianca === "média" ? "text-aviso" : "text-erro"}>{p.confianca}</b> · média de {n1(p.media)} nos últimos {p.meses} meses</> : "histórico insuficiente (3 meses fechados)"}</div></div>)}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">Faixa = média ± variação dos meses fechados do período. Confiança alta quando o ritmo é regular (4+ meses e variação pequena). Serve para planejar entrevistas e a agenda do RH — não é meta.</p>
      </Card>
    </div>
    <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Card title={`Tempo para preencher — por unidade (${tempo.total} vaga(s) em 24 meses)`}>
        <BarrasH rotulo="Dias médios para preencher por unidade" formato={v => `${Math.round(v)} d`} itens={tempo.porUnidade.map(x => ({ rotulo: x.grupo, valor: x.media, sub: `${x.vagas} vaga(s) · máx. ${x.max} d`, cor: x.media > cfg.indicadores.slaVagaDias ? COR.aviso : COR.acao }))} />
      </Card>
      <Card title="Tempo para preencher — por cargo">
        <BarrasH rotulo="Dias médios para preencher por cargo" formato={v => `${Math.round(v)} d`} itens={tempo.porCargo.slice(0, 10).map(x => ({ rotulo: x.grupo, valor: x.media, sub: `${x.vagas} vaga(s)`, cor: x.media > cfg.indicadores.slaVagaDias ? COR.aviso : COR.acao }))} />
        <p className="mt-1 text-[11px] text-slate-500">Desconta os dias em que a vaga ficou pausada. Laranja: acima de {cfg.indicadores.slaVagaDias} dias.</p>
      </Card>
      <Card title={`Propostas — ${prop.enviadas} no período`}>
        <div className="grid grid-cols-2 gap-2"><Stat label="Aceite" value={pct(prop.aceite)} hint={`${prop.aceitas} aceita(s) · ${prop.recusadas} recusada(s)`} /><Stat label="Resposta em" value={prop.diasResposta == null ? "—" : `${n1(prop.diasResposta)} d`} hint={prop.aguardando ? `${prop.aguardando} aguardando resposta` : "nenhuma aguardando"} /></div>
        {prop.motivos.length > 0 ? <Table head={["Por que recusaram", "Qtd"]}>{prop.motivos.map(m => <tr key={m.motivo}><Td className="text-xs">{m.motivo}</Td><Td>{m.n}</Td></tr>)}</Table> : <p className="mt-2 text-xs text-slate-500">Nenhuma recusa no período.</p>}
      </Card>
    </div>
    <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <Card title="Experiência do candidato (anônima)">
        {!exp.liberado ? <p className="text-sm text-slate-600">{exp.n} resposta(s) — o resultado aparece a partir de {exp.minimo} (anonimato). A pesquisa aparece no portal do candidato quando o processo dele termina.</p> : <>
          <div className="grid grid-cols-2 gap-2"><Stat label="Processo (1–5)" value={n1(exp.processo)} hint={`${exp.n} respostas`} /><Stat label="Recomendaria (NPS)" value={exp.nps ?? "—"} hint="promotores − detratores" /><Stat label="Clareza das informações" value={n1(exp.clareza)} /><Stat label="Respeito e cordialidade" value={n1(exp.respeito)} /></div>
          <Table head={["Desfecho", "Respostas", "Processo"]}>{exp.porDesfecho.map(d => <tr key={d.desfecho}><Td>{d.desfecho === "CONTRATADO" ? "Contratados" : d.desfecho === "REPROVADO" ? "Não aprovados" : "Outros"}</Td><Td>{d.n}</Td><Td>{d.processo === null ? <span className="text-xs text-slate-400">grupo pequeno</span> : n1(d.processo)}</Td></tr>)}</Table>
          {exp.comentarios.length > 0 && <ul className="mt-2 space-y-1 text-xs text-slate-600">{exp.comentarios.map((c, i) => <li key={i}>“{c}”</li>)}</ul>}
        </>}
      </Card>
      <Card title={`Índice de qualidade da contratação — ${q.comIndice} contratação(ões) com índice`}>
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat label="Índice médio (0–100)" value={q.indice == null ? "—" : Math.round(q.indice)} hint="retenção + gestor + 1ª avaliação" /><Stat label={`Gestor aos ${cfg.satisfacaoGestorDias} dias`} value={q.satisfacao == null ? "—" : `${n1(q.satisfacao)}/5`} hint={`${q.respondidas} resposta(s)`} /><Stat label="Contrataria de novo" value={pct(q.contratariaPct)} /><Stat label="Por origem (melhor)" value={(() => { const o = [...q.porOrigem].filter(x => x.indice !== null).sort((a, b) => b.indice! - a.indice!)[0]; return o ? ORIGEM_CAND[o.origem] ?? o.origem : "—"; })()} /></div>
        <Table head={["Contratado", "Origem", "Admissão", "Retenção", "Gestor", "1ª avaliação", "Índice"]} empty="Nenhuma contratação pela seleção nos últimos 24 meses.">{q.lista.slice(0, 12).map(c => <tr key={c.application_id}><Td><Link className="text-acao" href={`/colaboradores/${c.employee_id}`}>{c.nome}</Link><div className="text-[11px] text-slate-500">{c.vaga}</div></Td><Td className="text-xs">{ORIGEM_CAND[c.origem] ?? c.origem}</Td><Td className="text-xs">{fmtData(c.admissao)}</Td><Td className="text-xs">{c.retencao === null ? "no prazo" : c.retencao ? "ficou" : <span className="text-erro">saiu cedo</span>}</Td><Td className="text-xs">{c.gestor === null ? <Link className="text-acao" href={`/recrutamento/contratacao/${c.application_id}`}>pedir</Link> : Math.round(c.gestor)}</Td><Td className="text-xs">{c.desempenho === null ? "—" : Math.round(c.desempenho)}</Td><Td>{c.indice === null ? <span className="text-xs text-slate-400">incompleto</span> : <Badge v={c.indice >= 75 ? "APROVADA" : c.indice >= 50 ? "PENDENTE" : "REJEITADA"} label={String(c.indice)} />}</Td></tr>)}</Table>
        <p className="mt-1 text-[11px] text-slate-500">Cada componente vai de 0 a 100: ficou {cfg.indicadores.retencaoDias} dias (100) ou saiu antes (0); a nota do gestor aos {cfg.satisfacaoGestorDias} dias; a 1ª avaliação de desempenho. O índice sai com pelo menos dois componentes. O gestor direto recebe o pedido em Minhas pendências.</p>
      </Card>
    </div>
  </>;
}
