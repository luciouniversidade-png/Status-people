import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireFinanceiro } from "@/lib/auth";
import { Page, Card, Flash, Table, Td } from "@/components/ui";
import { KpiCard, Linhas, Execucao, BarrasH, COR, Situacao, type Tom } from "@/components/graficos";
import { BarraContexto, CarimboContexto } from "@/components/BarraContexto";
import { PrintButton } from "@/components/PrintButton";
import { lerContexto, qsContexto } from "@/lib/contexto";
import { painelFinanceiro, execucaoPorCategoria, tesouraria, topListas } from "@/lib/cockpit";
import { narrativaCfo } from "@/lib/narrativa";
import { fmtReais, fmtPct, rotuloMes, variacao, fmtEixo, fmtNumero } from "@/lib/formato";
import { getSettings, fmtDataHora, fmtData } from "@/lib/utils";

export const dynamic = "force-dynamic";
const TOM_TXT: Record<string, string> = { bom: "border-l-ok", atencao: "border-l-aviso", ruim: "border-l-erro", neutro: "border-l-slate-300" };
const R = (v: number | null | undefined) => v === null || v === undefined ? "sem fonte" : fmtReais(v, true);
const dm = (iso: string | null) => iso ? iso.split("-").reverse().slice(0, 2).join("/") : "";

/** T-023 · Cockpit do CFO + T-028 · Tesouraria: as seis perguntas de sobrevivência com meta e delta, 13 meses, a narrativa do mês, execução por área e as listas de ação. */
export default async function Cockpit({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireFinanceiro(); if (s.role === "RH") redirect("/folha/custo"); const sp = await searchParams;
  const ctx = await lerContexto(s, sp); const cfg = await getSettings(); const qs = qsContexto(ctx);
  const pf = await painelFinanceiro(ctx);
  const [exec, tes, top, [ped]] = await Promise.all([execucaoPorCategoria(ctx), tesouraria(ctx, pf.caixa.saldo), topListas(ctx),
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM budget_explain_requests WHERE status='ABERTA' AND escopo = ANY(${ctx.unitIds ?? ctx.units.map(u => u.id)})`]);
  const metaInad = Number(cfg.commandCenter.inadimplenciaAlertaPct); const faixa = exec.faixa;
  const estouros = exec.itens.filter(i => i.pct !== null && i.pct > faixa[1]).map(i => ({ categoria: i.categoria, pct: i.pct! }));
  const pc = pf.parcial; const ateTxt = pc ? dm(pc.ate) : "";
  const frases = narrativaCfo({ periodo: ctx.periodo, parcial: pc ? { ate: pc.ate, orcReceita: pc.orcReceita, orcDespesa: pc.orcDespesa, base: pc.base } : null, folhaCompetencia: pf.folhaReceita?.competencia ?? null, receita: pf.receita, despesa: pf.despesa, ebitda: pf.ebitda, margem: pf.margem, caixa: { saldo: pf.caixa.saldo, dadosAte: pf.caixa.dadosAte, coberturaDias: tes.coberturaDias }, inad30: pf.inad30, metaInad, acoesCobranca: top.acoesPendentes, folhaReceita: pf.folhaReceita?.pct ?? null, estouros, faixaMax: faixa[1], explicacoesAbertas: ped.n });
  // mês em andamento: as comparações usam a mesma régua (até o mesmo dia) e o orçado proporcional
  const ant = pc ? pc.anterior : pf.anterior; const aa = pc ? pc.anoAnterior : pf.mesAnoAnterior; const orcRec = pc ? pc.orcReceita : pf.receita.orc;
  const vRecO = variacao(pf.receita.real, orcRec, "R$"); const vRecA = variacao(pf.receita.real, aa?.receita, "R$");
  const vEbA = variacao(pf.ebitda, ant?.ebitda, "R$"); const vEbAA = variacao(pf.ebitda, aa?.ebitda, "R$");
  const margemAA = aa?.receita && aa.ebitda !== null ? (100 * aa.ebitda) / aa.receita : null;
  const tomRec: Tom = pf.receita.real === null || !orcRec ? "neutro" : pf.receita.real >= orcRec ? "bom" : pf.receita.real >= 0.95 * orcRec ? "atencao" : "ruim";
  const s13 = (k: "receita" | "despesa" | "ebitda") => pf.serie13.map((x, i) => pc && i === pf.serie13.length - 1 ? null : x[k]);
  const tomInad: Tom = !pf.inad30 ? "neutro" : pf.inad30.pct <= metaInad ? "bom" : pf.inad30.pct <= metaInad * 1.5 ? "atencao" : "ruim";
  const tomCob: Tom = tes.coberturaDias === null ? "neutro" : tes.coberturaDias < 15 ? "ruim" : tes.coberturaDias < 30 ? "atencao" : "bom";
  const categorias = pf.serie13.map(x => rotuloMes(x.periodo));
  const atalhos: [string, string][] = [["DRE gerencial", `/financeiro/dre?${qs}`], ["Orçado × real", `/financeiro/orcamento?ano=${pf.ano}&mes=${pf.mes}`], ["Fluxo de caixa", "/financeiro/caixa"], ["Inadimplência e régua", "/financeiro/inadimplencia"], ["Caixa projetado (13 sem.)", "/financeiro/projecao"], ["Custo de folha", `/folha/custo?${qs}`]];
  const unidadesCaixa = pf.caixa.porUnidade.map(u => ({ ...u, entidade: ctx.entidades.find(e => e.id === ctx.units.find(x => x.id === u.id)?.company_id)?.nome ?? "sem entidade" })).sort((a, b) => a.entidade.localeCompare(b.entidade, "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR"));
  const secundarios: { rotulo: string; valor: string; sub: string; href?: string }[] = [
    { rotulo: "Ticket médio (mensalidade)", valor: pf.ticket === null ? "sem fonte" : fmtReais(pf.ticket), sub: "média dos títulos de mensalidade do mês" , href: "/financeiro/receita" },
    { rotulo: "Recebido do emitido no mês", valor: pf.recebimentoPct === null ? "sem fonte" : fmtPct(pf.recebimentoPct), sub: "títulos vencidos no mês, pagos até o corte", href: "/financeiro/inadimplencia" },
    { rotulo: "Receita por aluno", valor: pf.receitaAluno === null ? "sem fonte" : fmtReais(pf.receitaAluno), sub: `${fmtNumero(pf.alunos)} alunos atuais` },
    { rotulo: "Custo por aluno", valor: pf.custoAluno === null ? "sem fonte" : fmtReais(pf.custoAluno), sub: "despesa do mês ÷ alunos atuais" },
    { rotulo: "Orçamento de despesa executado", valor: pf.orcExecutadoPct === null ? "sem fonte" : fmtPct(pf.orcExecutadoPct, 0), sub: `banda saudável ${faixa[0]}–${faixa[1]}%`, href: `/financeiro/orcamento?ano=${pf.ano}&mes=${pf.mes}&visao=mes` },
    { rotulo: "Prazo médio de recebimento", valor: tes.pmrDias === null ? "sem fonte" : `${fmtNumero(tes.pmrDias, 1)} dia(s)`, sub: tes.pmrBase ? `pagamento − vencimento · ${tes.pmrBase} título(s) em 90 dias` : "sem títulos pagos em 90 dias" },
  ];
  return (
    <Page title="Cockpit do CFO" sub="As seis perguntas de sobrevivência com meta e variação, 13 meses, a narrativa do mês e onde agir. Regime de caixa gerencial; folha pelo resultado aceito."
      actions={<div className="flex flex-wrap gap-2 print:hidden"><a href={`/api/financeiro/cockpit?${qs}`} className="inline-flex items-center rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-navy hover:bg-mist">Exportar CSV</a><PrintButton /></div>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <BarraContexto ctx={ctx} voltar="/financeiro/cockpit" />
      <CarimboContexto ctx={ctx} extra={`retrato de ${fmtDataHora(new Date())}`} />
      <nav aria-label="Relatórios do dia" className="mb-4 flex flex-wrap gap-2 print:hidden">{atalhos.map(([r, h]) => <Link key={r} href={h} className="rounded-full border border-line bg-white px-3 py-1 text-xs font-medium text-navy hover:bg-mist">{r}</Link>)}</nav>
      <section aria-label="Indicadores de sobrevivência" className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard titulo={pc ? `Receita · ${rotuloMes(ctx.periodo)} até ${ateTxt}` : `Receita · ${rotuloMes(ctx.periodo)}`} valor={R(pf.receita.real)} tom={tomRec} serie={s13("receita")} meta={pf.receita.orc ? { texto: `meta do mês ${fmtReais(pf.receita.orc, true)}`, tom: tomRec } : { texto: "sem orçamento", tom: "neutro" }} deltas={[vRecO ? { texto: vRecO.texto, rotulo: pc ? "vs orçado proporcional" : "vs orçado", bom: vRecO.sentido >= 0 } : null, vRecA ? { texto: vRecA.texto, rotulo: pc ? "vs mesmo período do ano anterior" : "vs mesmo mês do ano anterior", bom: vRecA.sentido === 0 ? null : vRecA.sentido > 0 } : null]} href={`/financeiro/dre?${qs}`} ajuda={pc ? `Mês em andamento: orçado proporcional ${pc.base === "perfil" ? "pelo perfil do mesmo mês do ano anterior" : "por dias corridos"}; comparações até o mesmo dia` : undefined} />
        <KpiCard titulo={pc ? `EBITDA até ${ateTxt}` : "EBITDA do mês"} valor={R(pf.ebitda)} tom={pf.ebitda === null ? "neutro" : pf.ebitda < 0 ? "ruim" : "bom"} serie={s13("ebitda")} deltas={[vEbA ? { texto: vEbA.texto, rotulo: pc ? "vs mês anterior, mesmo dia" : "vs mês anterior", bom: vEbA.sentido === 0 ? null : vEbA.sentido > 0 } : null, vEbAA ? { texto: vEbAA.texto, rotulo: pc ? "vs ano anterior, mesmo dia" : "vs ano anterior", bom: vEbAA.sentido === 0 ? null : vEbAA.sentido > 0 } : null]} href={`/financeiro/dre?${qs}`} ajuda="Receita − despesas, sem as despesas financeiras (juros e tarifas) e sem transferências internas" />
        <KpiCard titulo={pc ? `Margem EBITDA até ${ateTxt}` : "Margem EBITDA"} valor={pf.margem === null ? "sem fonte" : fmtPct(pf.margem)} tom={pf.margem === null ? "neutro" : pf.margem < 0 ? "ruim" : pf.margem < 10 ? "atencao" : "bom"} deltas={[pf.margem !== null && margemAA !== null ? { texto: `${pf.margem - margemAA >= 0 ? "+" : "−"}${fmtNumero(Math.abs(pf.margem - margemAA), 1)} p.p.`, rotulo: "vs ano anterior", bom: pf.margem >= margemAA } : null]} href={`/financeiro/dre?${qs}&modo=av`} />
        <KpiCard titulo="Caixa disponível" valor={R(pf.caixa.saldo)} tom={pf.caixa.saldo === null ? "neutro" : pf.caixa.saldo < 0 ? "ruim" : tomCob} sub={pf.caixa.dadosAte ? `dados até ${fmtData(pf.caixa.dadosAte)}${pf.caixa.parcial ? " · parcial" : ""}` : "sem saldo inicial do mês"} nota={pf.caixa.previstoDepois ? `Depois de ${fmtData(pf.caixa.previstoDepois)} os valores são previstos, não realizados` : null} href="#tesouraria" />
        <KpiCard titulo="Inadimplência 30+" valor={pf.inad30 ? fmtPct(pf.inad30.pct) : "sem fonte"} tom={tomInad} meta={pf.inad30 ? { texto: `meta ≤ ${fmtPct(metaInad, 0)}`, tom: tomInad } : null} sub={pf.inad30 ? `${fmtReais(pf.inad30.valor, true)} · ${pf.inad30.familias} família(s)` : "importe os títulos"} href="/financeiro/inadimplencia" />
        <KpiCard titulo={pf.folhaReceita && pf.folhaReceita.competencia !== ctx.periodo ? `Folha ÷ receita · ${rotuloMes(pf.folhaReceita.competencia)}` : "Folha ÷ receita"} valor={pf.folhaReceita ? fmtPct(pf.folhaReceita.pct) : "sem fonte"} tom={pf.folhaReceita ? (pf.folhaReceita.pct > 60 ? "ruim" : pf.folhaReceita.pct > 50 ? "atencao" : "bom") : "neutro"} sub={pf.folhaReceita ? `custo REAL ${fmtReais(pf.folhaReceita.custo, true)}${pf.folhaReceita.unidades < pf.folhaReceita.total ? ` · ${pf.folhaReceita.unidades} de ${pf.folhaReceita.total} unidades` : ""}` : "aceite o resultado da folha"} href={`/folha/custo?${qs}`} ajuda="Última competência com o resultado da folha aceito (até 3 meses), sobre a receita das mesmas unidades" />
      </section>
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Receita, despesa e EBITDA — 13 meses" className="lg:col-span-2">
          <Linhas tamanho="inteiro" categorias={categorias} series={[{ nome: "Receita", valores: s13("receita"), cor: COR.ok }, { nome: "Despesa", valores: s13("despesa"), cor: COR.erro }, { nome: "EBITDA", valores: s13("ebitda"), cor: COR.navy, area: true }, { nome: "Receita orçada", valores: pf.serie13.map(x => x.orcReceita), cor: COR.neutro, tracejada: true }]} notas={pc ? [{ indice: pf.serie13.length - 1, texto: `em andamento até ${ateTxt}: receita ${R(pf.receita.real)}, despesa ${R(pf.despesa.real)}, EBITDA ${R(pf.ebitda)}` }] : undefined} formato={fmtEixo("R$")} formatoDica={x => fmtReais(x)} zero rotulo="Receita, despesa e EBITDA dos últimos 13 meses" />
          {pc && <p className="mt-1 text-[11px] text-slate-500">{rotuloMes(ctx.periodo)} está em andamento (dados até {ateTxt}): as linhas mostram só meses fechados; o parcial está nos cartões acima e no marcador âmbar.</p>}
        </Card>
        <Card title="Narrativa do mês">
          <ul className="space-y-2">{frases.map((f, i) => <li key={i} className={`rounded-md border border-line border-l-4 bg-white p-2.5 text-sm ${TOM_TXT[f.tom]}`}><p className="leading-snug">{f.texto}</p>{f.chips.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1.5">{f.chips.map(c => <Link key={c.href + c.rotulo} href={c.href} className="rounded-full border border-acao/30 bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-acao hover:bg-sky-100">{c.rotulo}</Link>)}</div>}</li>)}</ul>
          <p className="mt-2 text-[11px] text-slate-500">Texto determinístico: cada frase vem de um número com fonte (sem IA).</p>
        </Card>
      </div>
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title={`Execução por área — acumulado ${pf.ano}${exec.parcialAte ? ` (${rotuloMes(ctx.periodo)} proporcional até ${dm(exec.parcialAte)})` : ""}`} actions={<Link href={`/financeiro/orcamento?ano=${pf.ano}&mes=${pf.mes}`} className="text-xs text-acao">Orçado × real →</Link>}>
          {exec.itens.filter(i => i.orc).length === 0 ? <p className="text-sm text-slate-500">Sem orçamento de despesa em {pf.ano}. Cadastre em Orçamento mês a mês.</p> : <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2">{exec.itens.filter(i => i.orc).slice(0, 6).map(i => <Execucao key={i.categoria} rotulo={i.categoria} real={i.real} orcado={i.orc} faixa={faixa} formato={x => fmtReais(x, true)} tamanho={96} href={`/financeiro/lancamentos?ano=${pf.ano}&m1=1&m2=${pf.mes}&cat=${encodeURIComponent(i.categoria)}${ctx.unitIds?.length === 1 ? `&u=${ctx.unitIds[0]}` : ""}`} />)}</div>}
          {ped.n > 0 && <p className="mt-2 text-xs"><Link href="/financeiro/orcamento#explicacoes" className="font-medium text-aviso">{ped.n} pedido(s) de explicação em aberto →</Link></p>}
        </Card>
        <Card title="Aging dos títulos vencidos" actions={<Link href="/financeiro/inadimplencia" className="text-xs text-acao">Régua →</Link>}>
          {top.totalVencido ? <BarrasH itens={top.aging.map((a, i) => ({ rotulo: a.faixa, valor: a.valor, sub: `${a.n} título(s)`, cor: i === 0 ? COR.aviso : COR.erro, href: "/financeiro/inadimplencia" }))} formato={x => fmtReais(x, true)} rotulo="Valor vencido por faixa de atraso" /> : <p className="text-sm text-slate-500">Nenhum título vencido em aberto.</p>}
          <p className="mt-2 text-xs text-slate-600">Total vencido: <b className="tabular-nums">{fmtReais(top.totalVencido)}</b>{top.acoesPendentes ? <> · <span className="text-aviso">{top.acoesPendentes} sem a ação da régua</span></> : null}</p>
        </Card>
        <Card title="Indicadores secundários">
          <dl className="divide-y divide-line text-sm">{secundarios.map(x => <div key={x.rotulo} className="flex items-baseline justify-between gap-3 py-1.5"><dt className="min-w-0"><span className="text-slate-700">{x.href ? <Link href={x.href} className="hover:underline">{x.rotulo}</Link> : x.rotulo}</span><span className="block text-[11px] text-slate-500">{x.sub}</span></dt><dd className="shrink-0 font-semibold tabular-nums text-ink">{x.valor}</dd></div>)}</dl>
        </Card>
      </div>
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        <Card title="Maiores devedores" actions={<Link href="/financeiro/inadimplencia" className="text-xs text-acao">Acionar cobrança →</Link>}>
          <Table head={["Aluno · responsável", "Unidade", "Títulos", "Maior atraso", "Valor"]} empty="Nenhum título vencido.">{top.devedores.map(d => <tr key={d.aluno + (d.responsavel ?? "")}><Td>{d.student_id ? <Link href={`/matriculas/alunos/${d.student_id}`} className="text-acao hover:underline">{d.aluno}</Link> : d.aluno}{d.responsavel ? <div className="text-[11px] text-slate-500">{d.responsavel}</div> : null}</Td><Td className="text-xs">{d.unidade}</Td><Td className="tabular-nums">{d.titulos}</Td><Td className="tabular-nums">{d.dias} d</Td><Td className="tabular-nums font-medium">{fmtReais(d.valor)}</Td></tr>)}</Table>
        </Card>
        <Card title={`Maiores despesas de ${rotuloMes(ctx.periodo)}`} actions={<Link href={`/financeiro/lancamentos?ano=${pf.ano}&m1=${pf.mes}&m2=${pf.mes}&linha=OPERACIONAIS`} className="text-xs text-acao">Todos →</Link>}>
          <Table head={["Data", "Categoria", "Descrição / contraparte", "Valor"]} empty="Nenhuma saída no mês.">{top.despesas.map(d => <tr key={d.id}><Td className="whitespace-nowrap text-xs">{dm(d.data)}</Td><Td className="text-xs">{d.categoria}<div className="text-[11px] text-slate-500">{d.unidade}</div></Td><Td className="text-xs"><Link href={`/financeiro/lancamentos/${d.id}`} className="hover:underline">{d.descricao ?? "—"}</Link>{d.contraparte ? <div className="text-slate-500">{d.contraparte}</div> : null}</Td><Td className="tabular-nums font-medium">{fmtReais(d.valor)}</Td></tr>)}</Table>
        </Card>
      </div>
      <section id="tesouraria" aria-label="Tesouraria" className="scroll-mt-20">
        <h2 className="mb-2 mt-2 text-base font-semibold text-navy">Tesouraria — caixa disponível × caixa exigido</h2>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <KpiCard titulo="Caixa disponível" valor={R(pf.caixa.saldo)} tom={pf.caixa.saldo !== null && pf.caixa.saldo < 0 ? "ruim" : "neutro"} sub={pf.caixa.dadosAte ? `dados até ${fmtData(pf.caixa.dadosAte)}` : "sem saldo inicial"} />
          <KpiCard titulo="Saídas previstas 30 dias" valor={tes.projecao ? fmtReais(tes.projecao.saidas30, true) : "sem fonte"} tom="neutro" sub={tes.projecao ? `entradas previstas ${fmtReais(tes.projecao.entradas30, true)}` : "projeção indisponível"} href="/financeiro/projecao" />
          <KpiCard titulo="Saídas previstas 60 dias" valor={tes.projecao ? fmtReais(tes.projecao.saidas60, true) : "sem fonte"} tom="neutro" sub="contas a pagar aprovadas + orçado (ou média de 3 meses)" href="/financeiro/projecao" />
          <KpiCard titulo="Dias de cobertura" valor={tes.coberturaDias === null ? "sem fonte" : fmtNumero(Math.floor(tes.coberturaDias))} tom={tomCob} sub="caixa ÷ média diária de saídas (90 dias)" />
          <KpiCard titulo="Menor saldo em 13 semanas" valor={tes.projecao?.menor ? fmtReais(tes.projecao.menor.min, true) : "—"} tom={tes.projecao?.menor && tes.projecao.menor.min < 0 ? "ruim" : "neutro"} sub={tes.projecao?.menor ? `semana até ${fmtData(tes.projecao.menor.ate)} (cenário pessimista)` : "disponível por unidade ou rede"} href="/financeiro/projecao" />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
          <Card title="Caixa por entidade e unidade">
            <Table head={["Entidade", "Unidade", "Saldo hoje", ""]} empty="Sem unidades no recorte.">{unidadesCaixa.map(u => <tr key={u.id}><Td className="text-xs">{u.entidade}</Td><Td>{u.nome}</Td><Td className={`tabular-nums ${u.saldo !== null && u.saldo < 0 ? "text-erro" : ""}`}>{u.saldo === null ? <span className="text-xs text-aviso">sem saldo inicial</span> : fmtReais(u.saldo)}</Td><Td><Link href={`/financeiro/caixa?unidade=${u.id}`} className="text-xs text-acao">extrato</Link></Td></tr>)}</Table>
            <p className="mt-2 text-[11px] text-slate-500">Saldo = saldo inicial do mês informado + entradas − saídas lançadas até hoje. O movimento por conta bancária fica no Fluxo de caixa e a conferência com o extrato e a Cielo, na Conciliação.</p>
          </Card>
          <Card title="Memória de cálculo">
            <details open className="text-sm"><summary className="cursor-pointer text-xs font-medium text-navy">Como os dias de cobertura são calculados</summary>
              <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-xs"><dt>Caixa disponível hoje</dt><dd className="text-right tabular-nums">{R(pf.caixa.saldo)}</dd><dt>Média diária de saídas (últimos 90 dias)</dt><dd className="text-right tabular-nums">{tes.mediaSaidasDia === null ? "sem fonte" : fmtReais(tes.mediaSaidasDia)}</dd><dt className="font-semibold">= Dias de cobertura</dt><dd className="text-right font-semibold tabular-nums">{tes.coberturaDias === null ? "—" : fmtNumero(tes.coberturaDias, 1)}</dd></dl>
              <p className="mt-2 text-[11px] text-slate-500">Recalculado a cada abertura da tela com o período corrente. Abaixo de 15 dias: vermelho; até 30: âmbar.</p>
            </details>
            <div className="mt-3 border-t border-line pt-2 text-xs"><b>Contas a pagar:</b> {tes.contasPagar ? <><Link className="text-acao underline" href="/financeiro/contas-a-pagar?sit=30d">{tes.contasPagar.n30} parcela(s) a vencer em 30 dias · {fmtReais(tes.contasPagar.v30, true)}</Link>{tes.contasPagar.vencN > 0 && <> · <Link className="text-erro underline" href="/financeiro/contas-a-pagar?sit=vencidas">{tes.contasPagar.vencN} vencida(s) sem baixa · {fmtReais(tes.contasPagar.vencV, true)}</Link></>} — já estão nas saídas previstas (na data programada, senão no vencimento); o resto vem do orçado ou da média.</> : <><Situacao tom="neutro" texto="sem fonte" /> — o caixa registra o pago; compromissos futuros entram pela projeção (orçado ou média).</>}</div>
          </Card>
        </div>
      </section>
    </Page>
  );
}
