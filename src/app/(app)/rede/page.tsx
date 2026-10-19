import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { requireGestao } from "@/lib/auth";
import { Page, Card, Flash, Stat, Btn } from "@/components/ui";
import { BarrasH, Minigrafico, COR } from "@/components/graficos";
import { SelectAuto } from "@/components/EnvioAuto";
import { BarraContexto, CarimboContexto } from "@/components/BarraContexto";
import { PrintButton } from "@/components/PrintButton";
import { lerContexto, qsContexto } from "@/lib/contexto";
import { visaoRede, INDICADORES_RANKING, valorRanking, type CartaoRede } from "@/lib/rede";
import { fmtReais, fmtPct, fmtNumero } from "@/lib/formato";
import { getSettings, fmtDataHora } from "@/lib/utils";

export const dynamic = "force-dynamic";

const fmtInd = (k: string, v: number | null) => v === null ? "—" : INDICADORES_RANKING[k].formato === "%" ? fmtPct(v) : INDICADORES_RANKING[k].formato === "R$" ? fmtReais(v, true) : fmtNumero(v, k === "nps" ? 0 : 0);
const borda = (c: CartaoRede, sel: number | null) => c.propria || c.id === sel ? "border-acao ring-2 ring-acao/30" : c.saude === null ? "border-line" : c.saude >= 80 ? "border-ok" : c.saude >= 60 ? "border-aviso" : "border-erro";
/** Destino do drill por indicador (≤ 3 cliques do Board ao registro). */
const destino = (k: string, id: number, periodo: string) => ({ inad: `/financeiro/inadimplencia?unidade=${id}`, receita: `/financeiro/dre?ctx_u=${id}&ctx_p=${periodo}`, alunos: `/matriculas/turmas?unidade=${id}`, ocupacao: `/matriculas/turmas?unidade=${id}`, pendencias: `/operacoes/chamados?unidade=${id}`, saude: `/command-center?unidade=${id}`, nps: `/atendimento?unidade=${id}`, colaboradores: `/colaboradores?unidade=${id}` } as Record<string, string>)[k] ?? `/rede?ctx_u=${id}&ctx_p=${periodo}`;

/** T-008 · Visão da rede multi-campus: totais da rede (soma exata dos cartões), um cartão por unidade, ranking por indicador e comparação lado a lado. */
export default async function Rede({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireGestao(); if (s.role === "COLABORADOR") redirect("/"); const sp = await searchParams;
  const ctx = await lerContexto(s, sp); const cfg = await getSettings(); const qs = qsContexto(ctx);
  const v = await visaoRede(s, ctx); const fin = v.escopo === null && s.role !== "COMERCIAL";
  const opcoes = Object.entries(INDICADORES_RANKING).filter(([, d]) => fin || !d.financeiro);
  const kpi = opcoes.some(([k]) => k === sp.kpi) ? sp.kpi! : "alunos"; const def = INDICADORES_RANKING[kpi];
  const ranking = v.cartoes.map(c => ({ c, valor: valorRanking(c, kpi) })).sort((a, b) => a.valor === null ? 1 : b.valor === null ? -1 : def.menorMelhor ? a.valor - b.valor : b.valor - a.valor);
  const A = v.cartoes.find(c => c.id === Number(sp.a)) ?? null; const B = v.cartoes.find(c => c.id === Number(sp.b)) ?? null;
  const metaInad = Number(cfg.commandCenter.inadimplenciaAlertaPct);
  const linhasComp: { rotulo: string; k: string; menorMelhor?: boolean }[] = [{ rotulo: "Alunos atuais", k: "alunos" }, { rotulo: `Turmas ${v.ano}`, k: "turmas" }, { rotulo: `Ocupação ${v.ano}`, k: "ocupacao" }, { rotulo: "Colaboradores", k: "colaboradores" }, { rotulo: "Pendências abertas", k: "pendencias", menorMelhor: true }, { rotulo: "Saúde (health)", k: "saude" }, { rotulo: "NPS (180 dias)", k: "nps" }, ...(fin ? [{ rotulo: "Receita do mês", k: "receita" }, { rotulo: "Inadimplência 30+", k: "inad", menorMelhor: true }] : [])];
  const valComp = (c: CartaoRede, k: string) => k === "turmas" ? c.turmas : valorRanking(c, k);
  const fmtComp = (k: string, x: number | null) => k === "turmas" ? (x === null ? "—" : fmtNumero(x)) : fmtInd(k, x);
  const base = `/rede?${qs}`;
  return (
    <Page title="Visão da rede" sub={`As ${v.cartoes.length} unidades em um olhar: alunos, turmas, ocupação ${v.ano}, pendências e saúde. Os totais são a soma exata dos cartões.`}
      actions={<div className="flex flex-wrap gap-2 print:hidden"><a href={`/api/rede?${qs}`} className="inline-flex items-center rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-navy hover:bg-mist">Exportar CSV</a><PrintButton /></div>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <BarraContexto ctx={ctx} voltar="/rede" notaPeriodo="período dos valores do mês (receita, inadimplência)" />
      <CarimboContexto ctx={ctx} extra={`retrato de ${fmtDataHora(new Date())}`} />
      <section aria-label="Totais da rede" className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Alunos atuais" value={fmtNumero(v.totais.alunos)} hint="soma dos cartões" />
        <Stat label={`Turmas ${v.ano}`} value={fmtNumero(v.totais.turmas)} hint={`${fmtNumero(v.totais.vagas)} vagas`} />
        <Stat label={`Ocupação ${v.ano}`} value={v.totais.ocupacaoPct === null ? "—" : fmtPct(v.totais.ocupacaoPct, 0)} hint={`${fmtNumero(v.totais.ocupadas)} matrículas e reservas ÷ vagas`} />
        <Stat label="Frequência do dia" value={<span className="text-base text-slate-500">sem fonte</span>} hint="frequência fica no ActiveSoft (fora do escopo)" />
        <Stat label="Pendências abertas" value={fmtNumero(v.totais.pendencias)} hint={`${v.totais.chamados} chamados · ${v.totais.casos} casos · ${v.totais.reservasVencendo} reservas 48 h`} />
        {fin ? <Stat label={v.parcialAte ? `Receita até ${v.parcialAte.slice(5, 10).split("-").reverse().join("/")}` : "Receita do mês"} value={v.totais.receita === null ? "sem fonte" : fmtReais(v.totais.receita, true)} hint={v.parcialAte ? "mês em andamento · soma dos cartões · regime de caixa" : "soma dos cartões · regime de caixa"} /> : <Stat label="Colaboradores" value={fmtNumero(v.totais.colaboradores)} hint="ativos, férias e afastados" />}
      </section>
      {v.avisos.length > 0 && <div role="status" className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-aviso">{v.avisos.map((a, i) => <p key={i}>⚠ {a}</p>)}</div>}
      <section aria-label="Unidades" className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {v.cartoes.map(c => <article key={c.id} id={`unidade-${c.id}`} className={`flex scroll-mt-20 flex-col rounded-md border-2 bg-white p-3 ${borda(c, ctx.unitId)}`}>
          <header className="flex items-baseline justify-between gap-2"><h2 className="font-semibold text-navy">{c.nome}{c.propria && <span className="ml-1 text-[11px] font-normal text-acao">sua unidade</span>}</h2>{c.saude !== null && <span className="text-xs text-slate-600">saúde <b className="tabular-nums">{c.saude}</b></span>}</header>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <div><dt className="text-slate-500">Alunos</dt><dd className="flex items-center gap-1 font-semibold tabular-nums text-ink">{fmtNumero(c.alunos)}{c.serieAlunos.some(x => x !== null) && <Minigrafico valores={c.serieAlunos} largura={56} altura={18} rotulo={`Alunos de ${c.nome} em 13 meses`} />}</dd></div>
            <div><dt className="text-slate-500">Turmas · vagas</dt><dd className="font-semibold tabular-nums">{c.turmas} · {fmtNumero(c.vagas)}</dd></div>
            <div><dt className="text-slate-500">Ocupação {v.ano}</dt><dd className="font-semibold tabular-nums">{c.ocupacaoPct === null ? "—" : fmtPct(c.ocupacaoPct, 0)}</dd></div>
            <div><dt className="text-slate-500">Pendências</dt><dd className="font-semibold tabular-nums">{c.pendencias}<span className="block text-[10px] font-normal text-slate-500">{c.chamados} chamados · {c.casos} casos{c.casosAtrasados ? ` (${c.casosAtrasados} atrasados)` : ""} · {c.reservasVencendo} reservas 48 h</span></dd></div>
            {c.financeiro && <div><dt className="text-slate-500">{v.parcialAte ? `Receita até ${v.parcialAte.slice(5, 10).split("-").reverse().join("/")}` : "Receita do mês"}</dt><dd className="flex items-center gap-1 font-semibold tabular-nums">{c.receita === null ? "sem fonte" : fmtReais(c.receita, true)}{c.serieReceita.some(x => x !== null) && <Minigrafico valores={c.serieReceita} cor={COR.ok} largura={56} altura={18} rotulo={`Receita de ${c.nome} em 13 meses`} />}</dd></div>}
            {c.financeiro && <div><dt className="text-slate-500">Inadimplência 30+</dt><dd className={`font-semibold tabular-nums ${c.inad30 !== null && c.inad30 > metaInad ? "text-erro" : ""}`}>{c.inad30 === null ? "—" : fmtPct(c.inad30)}</dd></div>}
            <div><dt className="text-slate-500">Colaboradores</dt><dd className="font-semibold tabular-nums">{c.colaboradores}</dd></div>
            <div><dt className="text-slate-500">NPS (180 dias)</dt><dd className="font-semibold tabular-nums">{c.nps === null ? "—" : fmtNumero(c.nps)}</dd></div>
          </dl>
          <footer className="mt-auto flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-2 text-xs print:hidden"><Link href={`/matriculas/turmas?unidade=${c.id}&ano=${v.ano}`} className="text-acao">Turmas e séries →</Link>{(v.escopo === null || c.propria) && <Link href={`/executivo/board?ctx_u=${c.id}&ctx_p=${ctx.periodo}`} className="text-acao">Board da unidade</Link>}<Link href={`${base}&kpi=${kpi}&a=${c.id}${B && B.id !== c.id ? `&b=${B.id}` : A && A.id !== c.id ? `&b=${A.id}` : ""}#comparar`} className="text-slate-600 hover:text-acao">comparar</Link></footer>
        </article>)}
        {s.role === "DIRECAO" && <Link href="/configuracoes#unidades" className="flex min-h-[8rem] flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-line bg-white p-3 text-center text-sm text-slate-500 hover:border-acao hover:text-acao print:hidden"><span className="font-medium">+ Nova unidade</span><span className="max-w-[16rem] text-[11px] leading-snug">a rede está pronta para crescer: a unidade entra em todos os painéis</span></Link>}
      </section>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        <Card title="Ranking por indicador" actions={<form className="flex items-center gap-1 print:hidden" action="/rede"><input type="hidden" name="ctx_p" value={ctx.periodo} />{ctx.entidadeId && <input type="hidden" name="ctx_e" value={ctx.entidadeId} />}<label className="sr-only" htmlFor="kpi">Indicador</label><SelectAuto id="kpi" name="kpi" defaultValue={kpi} className="rounded-md border border-line bg-white px-2 py-1 text-xs">{opcoes.map(([k, d]) => <option key={k} value={k}>{d.rotulo}</option>)}</SelectAuto><noscript><Btn small kind="ghost">Ver</Btn></noscript></form>}>
          <BarrasH itens={ranking.map((r, i) => ({ rotulo: `${i + 1}º ${r.c.nome}`, valor: r.valor, texto: fmtInd(kpi, r.valor), cor: r.c.propria ? COR.acao : COR.navy, href: destino(kpi, r.c.id, ctx.periodo) }))} formato={x => fmtInd(kpi, x)} rotulo={`Unidades por ${def.rotulo}`} />
          <p className="mt-1 text-[11px] text-slate-500">{def.menorMelhor ? "Menor é melhor." : "Maior é melhor."} Unidades sem fonte ficam no fim. Toque na barra para abrir os registros da unidade.</p>
        </Card>
        <Card title="Comparar duas unidades" className="scroll-mt-20" actions={<span id="comparar" />}>
          <form action="/rede" className="mb-3 flex flex-wrap items-end gap-2 print:hidden"><input type="hidden" name="ctx_p" value={ctx.periodo} /><input type="hidden" name="kpi" value={kpi} />
            <label className="text-xs">Unidade A<select name="a" defaultValue={A?.id ?? ""} className="mt-0.5 block rounded-md border border-line px-2 py-1 text-sm"><option value="">—</option>{v.cartoes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
            <label className="text-xs">Unidade B<select name="b" defaultValue={B?.id ?? ""} className="mt-0.5 block rounded-md border border-line px-2 py-1 text-sm"><option value="">—</option>{v.cartoes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
            <Btn small kind="ghost">Comparar</Btn></form>
          {A && B ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-mist text-xs text-slate-600"><tr><th className="px-2 py-1.5 text-left font-medium">Indicador</th><th className="px-2 py-1.5 text-right font-medium">{A.nome}</th><th className="px-2 py-1.5 text-right font-medium">{B.nome}</th><th className="px-2 py-1.5 text-right font-medium">A − B</th></tr></thead>
            <tbody className="divide-y divide-line">{linhasComp.map(l => { const a = valComp(A, l.k), b = valComp(B, l.k); const d = a !== null && b !== null ? a - b : null; const melhor = d === null || d === 0 ? null : l.menorMelhor ? d < 0 : d > 0; return <tr key={l.k}><td className="px-2 py-1.5">{l.rotulo}</td><td className="px-2 py-1.5 text-right tabular-nums">{fmtComp(l.k, a)}</td><td className="px-2 py-1.5 text-right tabular-nums">{fmtComp(l.k, b)}</td><td className={`px-2 py-1.5 text-right tabular-nums ${melhor === null ? "text-slate-500" : melhor ? "text-ok" : "text-erro"}`}>{d === null ? "—" : `${d > 0 ? "+" : d < 0 ? "−" : ""}${INDICADORES_RANKING[l.k]?.formato === "%" ? `${fmtNumero(Math.abs(d), 1)} p.p.` : INDICADORES_RANKING[l.k]?.formato === "R$" ? fmtReais(Math.abs(d), true) : fmtNumero(Math.abs(d))}`}</td></tr>; })}</tbody></table>
            <p className="mt-1 text-[11px] text-slate-500">Verde: A melhor que B no indicador · vermelho: pior.</p></div>
            : <p className="text-sm text-slate-500">Escolha duas unidades (ou use “comparar” nos cartões).</p>}
        </Card>
      </div>
    </Page>
  );
}
