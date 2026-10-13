import Link from "@/components/Link";
import { requireGestao, scopeUnit } from "@/lib/auth";
import { Page, Card, Table, Td, Badge, Flash, Btn, Stat } from "@/components/ui";
import { fmtData, getSettings } from "@/lib/utils";
import { SAUDE, PROJ_STATUS, CONFIANCA } from "@/lib/estrategia";
import { brl } from "@/lib/operacoes";
import { painelGestao, listarAcoes, fmtValor } from "@/lib/gestao-estrategica";
import { RITUAL_TIPO, NIVEL_MAT, aderenciaRitual, nomePeriodo, type TipoRitual, type Perspectiva } from "@/lib/gestao-calc";
import { SubNav, Barra, FarolBadge, SaudeDetalhe, corFaixa, metaCurta } from "./_ui";

export const dynamic = "force-dynamic";
const barra = (p: number | null) => <div className="h-2 w-full overflow-hidden rounded bg-mist"><div className={`h-2 ${p === null ? "" : p >= 70 ? "bg-ok" : p >= 40 ? "bg-aviso" : "bg-erro"}`} style={{ width: `${p ?? 0}%` }} /></div>;

export default async function Estrategia({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireGestao(); const sp = await searchParams; const cfg = await getSettings(); const u = scopeUnit(s); const ciclo = sp.ciclo ?? cfg.estrategia.cicloAtual;
  const [g, atencao] = await Promise.all([painelGestao(u, ciclo), listarAcoes(u, { situacao: "ATENCAO", limite: 8 })]);
  const { ok, pf } = g; const faixas = cfg.estrategia.faixasSaude as [number, number];
  const ativos = ok.objetivos.filter(o => o.status === "ATIVO"); const proximos = pf.rows.filter(r => r.proximo_prazo && r.status === "EM_ANDAMENTO").sort((a, b) => (a.proximo_prazo! < b.proximo_prazo! ? -1 : 1)).slice(0, 8);
  const nomePersp = new Map((cfg.estrategia.perspectivas as Perspectiva[]).map(p => [p.chave, p.nome]));
  const persp = new Map(g.objsAtivos.map(o => [o.id, o.persp]));
  const rituais = g.rit.lista.filter(r => r.ativo).sort((a, b) => (a.situacao === "ATRASADO" ? 0 : 1) - (b.situacao === "ATRASADO" ? 0 : 1) || (a.proxima_data ?? "9") .localeCompare(b.proxima_data ?? "9")).slice(0, 6);
  const fora = g.inds.filter(i => i.temMeta && (i.farol === "VERMELHO" || i.farol === "AMARELO")).sort((a, b) => (a.farol === "VERMELHO" ? 0 : 1) - (b.farol === "VERMELHO" ? 0 : 1)).slice(0, 8);
  return (
    <Page title={`Estratégia ${ciclo}`} sub="Identidade, mapa estratégico, OKRs, indicadores, projetos, plano de ação e rituais de gestão — o que a escola decidiu fazer, se está acontecendo e o que pede atenção hoje." >
      <SubNav atual="painel" />
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start">
        <Card title="Saúde estratégica" actions={<span className="text-xs text-slate-500">pesos e faixas em Configurações</span>}><SaudeDetalhe saude={g.saude} comps={g.comps} faixas={faixas} /></Card>
        <Card title={`O que pede atenção (${g.alertas.length})`}>
          {g.alertas.length === 0 ? <p className="text-sm text-ok">Nenhum alerta: rituais, ações, indicadores e OKRs em dia.</p> :
            <ul className="space-y-1.5 text-sm">{g.alertas.map((a, i) => <li key={i} className="flex items-start gap-2"><span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${a.nivel === "ALTO" ? "bg-erro" : "bg-aviso"}`} /><Link className="text-acao hover:underline" href={a.href}>{a.texto}</Link></li>)}</ul>}
          <p className="mt-3 text-xs text-slate-500">Alertas por regra explícita (atraso, ausência de medição, limite do farol) — nada é inferido.</p>
        </Card>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label={`Progresso dos OKRs ${ciclo}`} value={ok.progressoCiclo === null ? "—" : <span className={ok.progressoCiclo >= 70 ? "text-ok" : ok.progressoCiclo >= 40 ? "text-aviso" : "text-erro"}>{ok.progressoCiclo}%</span>} hint={`${ativos.length} objetivo(s) · ${ok.totalKRs} KRs · ${ok.krsSemMedicao} sem medição`} href="/estrategia/okrs" />
        <Stat label="KRs com confiança baixa" value={<span className={ok.krsBaixaConfianca ? "text-erro" : ""}>{ok.krsBaixaConfianca}</span>} />
        <Stat label="Projetos ativos" value={pf.ativos} hint={`${pf.vermelhos} em risco · ${pf.amarelos} atenção`} href="/estrategia/projetos" />
        <Stat label="Marcos atrasados" value={<span className={pf.marcosAtrasados ? "text-erro" : ""}>{pf.marcosAtrasados}</span>} />
        <Stat label="Sem status report" value={<span className={pf.semAtualizacao.length ? "text-aviso" : ""}>{pf.semAtualizacao.length}</span>} hint={`há mais de ${cfg.estrategia.atualizacaoProjetoDias} dias`} />
        <Stat label="Orçamento dos projetos" value={<span className="text-xl">{brl(pf.gasto)}</span>} hint={`de ${brl(pf.orcamento)} · ${pf.estourados} estourado(s)`} />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Indicadores no alvo" value={g.comMeta ? <span className={corFaixa((100 * g.noAlvo) / g.comMeta, faixas)}>{g.noAlvo}/{g.comMeta}</span> : "—"} hint={`${g.inds.length} ativo(s) · ${g.semMedicao} sem medição em dia`} href="/estrategia/indicadores" />
        <Stat label="Ações do plano abertas" value={g.ac.abertas} hint={`${g.ac.vencidas} vencida(s) · ${g.ac.bloqueadas} bloqueada(s)`} href="/estrategia/acoes" />
        <Stat label="Ações em dia" value={g.ac.pct === null ? "—" : <span className={corFaixa(g.ac.pct, faixas)}>{Math.round(g.ac.pct)}%</span>} hint={`${g.ac.concluidas_30} concluída(s) em 30 dias`} href="/estrategia/acoes?situacao=ATENCAO" />
        <Stat label="Rituais em dia" value={g.rit.ativos ? <span className={corFaixa(g.rit.pct, faixas)}>{g.rit.emDia}/{g.rit.ativos}</span> : "—"} hint={`${g.rit.atrasados.length} atrasado(s) · ${g.rit.atasPendentes} ata(s) pendente(s)`} href="/estrategia/rituais" />
        <Stat label="Maturidade dos processos" value={g.mat.pct === null ? "—" : <span className={corFaixa(g.mat.pct, faixas)}>{Math.round(g.mat.pct)}%</span>} hint={`${g.mat.itens.length} POP(s) · ${g.mat.porNivel[4]} no nível 5`} href="#maturidade" />
        <Stat label="Identidade institucional" value={g.ident.vigente ? <span className="text-ok">v{g.ident.vigente.versao}</span> : <span className="text-aviso">rascunho</span>} hint={g.ident.vigente ? `vigente desde ${fmtData(g.ident.vigente.vigencia_inicio)}` : "missão, visão e valores não publicados"} href="/estrategia/identidade" />
      </div>
      <Card title="Perspectivas do mapa estratégico" className="mb-4" actions={<Link className="text-xs text-acao" href="/estrategia/mapa">abrir o mapa</Link>}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">{g.perspectivas.map(p => <Link key={p.chave} href={`/estrategia/mapa#p-${p.chave}`} className="block rounded-md border border-line p-3 hover:bg-mist">
          <div className="text-sm font-semibold text-navy">{p.nome}</div><div className="mb-2 text-[11px] leading-snug text-slate-500">{p.descricao}</div>
          <div className="flex items-baseline justify-between text-xs"><span>{p.objetivos} objetivo(s)</span><b className={`tabular-nums ${p.progresso === null ? "text-slate-400" : p.progresso >= 70 ? "text-ok" : p.progresso >= 40 ? "text-aviso" : "text-erro"}`}>{p.progresso === null ? "—" : `${p.progresso}%`}</b></div>
          <div className="mt-1">{barra(p.progresso)}</div>
          <div className="mt-1.5 text-[11px] text-slate-500">{p.indicadores ? `${p.indicadoresNoAlvo} de ${p.indicadores} indicador(es) no alvo` : "nenhum indicador com meta"}</div>
        </Link>)}</div>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        <Card title={`Objetivos ${ciclo}`}>{ativos.length === 0 ? <p className="text-sm text-slate-500">Nenhum objetivo ativo neste ciclo.</p> : <div className="space-y-3">{ativos.map(o => <div key={o.id}><div className="flex items-center justify-between gap-2"><Link className="font-medium text-acao" href={`/estrategia/okrs/${o.id}`}>{o.titulo}</Link><span className={`text-sm font-semibold tabular-nums ${o.progresso === null ? "text-slate-400" : o.progresso >= 70 ? "text-ok" : o.progresso >= 40 ? "text-aviso" : "text-erro"}`}>{o.progresso === null ? "—" : `${o.progresso}%`}</span></div><div className="mb-1 text-xs text-slate-500">{o.pilar ?? "—"}{persp.get(o.id) ? ` · ${nomePersp.get(persp.get(o.id)!) ?? persp.get(o.id)}` : ""} · {o.owner ?? "sem dono"} · {o.krs.length} KR(s) · {o.projetos} projeto(s)</div>{barra(o.progresso)}<ul className="mt-1 space-y-0.5 text-xs text-slate-600">{o.krs.map(k => <li key={k.id} className="flex justify-between gap-2"><span>{k.titulo}</span><span className="whitespace-nowrap tabular-nums">{k.valor_atual === null ? "—" : k.valor_atual}{k.metrica ? ` ${k.metrica}` : ""} → {k.valor_meta}{k.metrica ? ` ${k.metrica}` : ""} · {k.progresso === null ? "—" : `${k.progresso}%`}{k.confianca ? ` · conf. ${CONFIANCA[k.confianca]}` : ""}</span></li>)}</ul></div>)}</div>}</Card>
        <div className="space-y-4">
          <Card title="Projetos que pedem atenção">{pf.rows.filter(r => ["VERMELHO", "AMARELO"].includes(r.saude) && ["EM_ANDAMENTO", "PAUSADO", "PLANEJADO"].includes(r.status)).length === 0 && pf.semAtualizacao.length === 0 ? <p className="text-sm text-slate-500">Nenhum projeto em risco ou sem atualização.</p> : <Table head={["Projeto", "Saúde", "Situação", "Próximo marco", "Última atualização"]}>{[...pf.rows.filter(r => ["VERMELHO", "AMARELO"].includes(r.saude) && ["EM_ANDAMENTO", "PAUSADO", "PLANEJADO"].includes(r.status)), ...pf.semAtualizacao.filter(r => !["VERMELHO", "AMARELO"].includes(r.saude))].map(r => <tr key={r.id}><Td><Link className="text-acao" href={`/estrategia/projetos/${r.id}`}>{r.nome}</Link><div className="text-xs text-slate-500">{r.owner ?? "—"} · {r.unidade ?? "rede"}</div></Td><Td><Badge v={r.saude === "VERDE" ? "APROVADA" : r.saude === "AMARELO" ? "PENDENTE" : "REJEITADA"} label={SAUDE[r.saude]} /></Td><Td className="text-xs">{PROJ_STATUS[r.status]}</Td><Td className={`text-xs ${r.marcos_atrasados ? "text-erro" : ""}`}>{r.proximo_marco ? `${r.proximo_marco} · ${fmtData(r.proximo_prazo)}` : "—"}{r.marcos_atrasados ? ` · ${r.marcos_atrasados} atrasado(s)` : ""}</Td><Td className={`text-xs ${!r.ultima_atualizacao ? "text-aviso" : ""}`}>{fmtData(r.ultima_atualizacao) || "nunca"}</Td></tr>)}</Table>}</Card>
          <Card title="Próximos marcos"><Table head={["Marco", "Projeto", "Prazo"]} empty="Nenhum marco pendente em projetos em andamento.">{proximos.map(r => <tr key={r.id}><Td>{r.proximo_marco}</Td><Td><Link className="text-acao" href={`/estrategia/projetos/${r.id}`}>{r.nome}</Link></Td><Td className={`text-xs ${r.marcos_atrasados ? "text-erro" : ""}`}>{fmtData(r.proximo_prazo)}</Td></tr>)}</Table></Card>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        <Card title="Indicadores fora do alvo ou em atenção" actions={<Link className="text-xs text-acao" href="/estrategia/indicadores">todos</Link>}>
          <Table head={["Indicador", "Último", "Meta", "Farol"]} empty={g.comMeta ? "Todos os indicadores com meta estão no alvo." : "Nenhum indicador com meta ainda — cadastre em Indicadores."}>{fora.map(i => <tr key={i.id}><Td><Link className="text-acao" href={`/estrategia/indicadores/${i.id}`}>{i.nome}</Link><div className="text-xs text-slate-500">{i.unidade ?? "rede"}{i.responsavel ? ` · ${i.responsavel}` : ""}{i.emDia ? "" : " · medição atrasada"}</div></Td><Td className="whitespace-nowrap tabular-nums">{fmtValor(i.ultimoValor, i.unidade_medida)}<div className="text-[11px] text-slate-500">{i.ultimoPeriodo ? nomePeriodo(i.ultimoPeriodo) : ""}</div></Td><Td className="whitespace-nowrap text-xs">{metaCurta(i.config, i.unidade_medida)}</Td><Td><FarolBadge f={i.farol} /></Td></tr>)}</Table>
        </Card>
        <Card title="Ações vencidas ou bloqueadas" actions={<Link className="text-xs text-acao" href="/estrategia/acoes?situacao=ATENCAO">plano de ação</Link>}>
          <Table head={["O quê", "Quem", "Prazo", "Situação"]} empty="Nenhuma ação vencida ou bloqueada.">{atencao.map(a => <tr key={a.id}><Td><span className="font-medium">{a.titulo}</span><div className="text-xs text-slate-500">{a.unidade ?? "rede"}{a.origem ? ` · ${a.origem}` : ""}</div></Td><Td className="text-xs">{a.responsavel ?? "—"}</Td><Td className={`whitespace-nowrap text-xs ${a.vencida ? "text-erro" : ""}`}>{fmtData(a.prazo)}{a.vencida ? ` · ${a.dias_atraso} dia(s)` : ""}</Td><Td>{a.status === "BLOQUEADA" ? <><Badge v="PENDENTE" label="Bloqueada" /><div className="mt-0.5 text-[11px] text-slate-500">{a.bloqueio}</div></> : <Badge v="REJEITADA" label="Vencida" />}</Td></tr>)}</Table>
        </Card>
        <Card title="Rituais de gestão" actions={<Link className="text-xs text-acao" href="/estrategia/rituais">todos</Link>}>
          <Table head={["Ritual", "Próxima reunião", "Aderência"]} empty="Nenhum ritual ativo. Crie a partir de um modelo em Rituais.">{rituais.map(r => { const ad = aderenciaRitual(r.realizadas_janela, r.tipo as TipoRitual, r.criado_dias); return <tr key={r.id}><Td><Link className="text-acao" href={`/estrategia/rituais/${r.id}`}>{r.nome}</Link><div className="text-xs text-slate-500">{RITUAL_TIPO[r.tipo as TipoRitual]} · {r.dono ?? "sem dono"} · {r.unidade ?? "rede"}</div></Td><Td className="whitespace-nowrap text-xs">{fmtData(r.proxima_data) || "—"} {r.situacao === "ATRASADO" ? <Badge v="REJEITADA" label="atrasado" /> : null}{r.ata_pendente ? <div className="text-aviso">{r.ata_pendente} ata(s) pendente(s)</div> : null}</Td><Td className={`text-xs tabular-nums ${corFaixa(ad.pct, faixas)}`}>{ad.pct === null ? "sem base" : `${ad.pct}%`}<div className="text-[11px] text-slate-500">{r.realizadas_janela} de {ad.esperadas} esperada(s)</div></Td></tr>; })}</Table>
        </Card>
        <Card title="Maturidade dos processos (POPs)"><div id="maturidade" />
          {g.mat.itens.length === 0 ? <p className="text-sm text-slate-500">Nenhum POP cadastrado.</p> : <>
            <div className="mb-3 grid grid-cols-5 gap-1 text-center">{g.mat.porNivel.map((n, k) => <div key={k} className="rounded border border-line p-1.5"><div className="text-lg font-semibold tabular-nums text-navy">{n}</div><div className="text-[10px] leading-tight text-slate-500">nível {k + 1}</div></div>)}</div>
            <ul className="space-y-1.5 text-sm">{g.mat.areas.map(a => <li key={a.area}><div className="flex justify-between text-xs"><span>{a.area} · {a.pops} POP(s)</span><b className={corFaixa(a.pct, faixas)}>{Math.round(a.pct)}%</b></div><Barra p={a.pct} faixas={faixas} /></li>)}</ul>
            <details className="mt-3 text-xs text-slate-600"><summary className="cursor-pointer text-acao">Como o nível é calculado</summary><ol className="mt-1 list-decimal space-y-0.5 pl-4">{[1, 2, 3, 4, 5].map(n => <li key={n}>{NIVEL_MAT[n]}</li>)}</ol><p className="mt-1">Cada nível exige os anteriores. O percentual conta 6 critérios de mesmo peso: vigente, dono, ciência de toda a equipe, indicador definido, controle em dia e revisão em dia.</p></details>
          </>}
        </Card>
      </div>
    </Page>
  );
}
