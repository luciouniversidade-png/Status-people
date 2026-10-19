import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession } from "@/lib/auth";
import { Page, Card, Flash, Badge } from "@/components/ui";
import { KpiCard, Linhas, COR, type Tom } from "@/components/graficos";
import { BarraContexto, CarimboContexto } from "@/components/BarraContexto";
import { PrintButton } from "@/components/PrintButton";
import { lerContexto, qsContexto, limitesPeriodo } from "@/lib/contexto";
import { painelFinanceiro, funilPonderado, resumoPorUnidade, projetarReceita } from "@/lib/cockpit";
import { caixaProjetado } from "@/lib/fpa";
import { narrativaBoard } from "@/lib/narrativa";
import { varrerAlertas, listarAlertas, escopoDo, SEVERIDADE_LABEL } from "@/lib/alertas";
import { filaFerias, filaBanco } from "@/lib/aprovacoes";
import { fmtReais, fmtPct, rotuloMes, variacao, fmtEixo } from "@/lib/formato";
import { getSettings, hoje, addDays, fmtDataHora } from "@/lib/utils";
import { somaMeses } from "@/lib/gestao-calc";

export const dynamic = "force-dynamic";
const TOM_TXT: Record<string, string> = { bom: "border-l-ok", atencao: "border-l-aviso", ruim: "border-l-erro", neutro: "border-l-slate-300" };

/** T-001 · Board do dono: em 30 segundos, no celular — como está o grupo, o que desviou e o que decidir. Tudo derivado dos módulos. */
export default async function Board({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!["DIRECAO", "RH", "FINANCEIRO", "DIRETOR_UNIDADE"].includes(s.role)) redirect("/"); const sp = await searchParams;
  const ctx = await lerContexto(s, sp); const cfg = await getSettings(); const h = hoje(); const qs = qsContexto(ctx); const { ano, mes } = limitesPeriodo(ctx.periodo);
  try { await varrerAlertas(escopoDo(s)); } catch { /* usa o último retrato */ }
  const [pf, funil, unidades, alertas, ferias, banco, [venc], proj] = await Promise.all([
    painelFinanceiro(ctx), funilPonderado(ctx), resumoPorUnidade(ctx), listarAlertas(s, escopoDo(s)), filaFerias(s), filaBanco(s),
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM enrollments e JOIN classes c ON c.id=e.class_id WHERE e.status='RESERVADA' AND e.reserva_ate <= ${addDays(h, 2)} AND c.ano=${cfg.matriculas.anoLetivo} AND c.unit_id = ANY(${ctx.unitIds ?? ctx.units.map(u => u.id)})`,
    (ctx.unitIds === null || ctx.unitIds.length === 1 ? caixaProjetado(ctx.unitId) : Promise.resolve(null)).catch(() => null),
  ]);
  // trajetória 24 meses: realizado × orçado × previsão até dezembro, com a banda dos cenários
  const futuros = Array.from({ length: 12 - mes }, (_, i) => somaMeses(ctx.periodo, i + 1));
  const orcFut = futuros.length ? await sql<{ mes: number; v: number }[]>`WITH cats AS (SELECT DISTINCT unit_id, categoria FROM budgets WHERE ano=${ano} AND tipo='ENTRADA' UNION SELECT DISTINCT unit_id, categoria FROM budget_months WHERE ano=${ano} AND tipo='ENTRADA')
      SELECT ms.mes, sum(coalesce(bm.valor, b.valor_mensal))::float AS v FROM cats c CROSS JOIN generate_series(${mes + 1}::int, 12) AS ms(mes) LEFT JOIN budget_months bm ON bm.ano=${ano} AND bm.unit_id=c.unit_id AND bm.tipo='ENTRADA' AND bm.categoria=c.categoria AND bm.mes=ms.mes LEFT JOIN budgets b ON b.ano=${ano} AND b.unit_id=c.unit_id AND b.tipo='ENTRADA' AND b.categoria=c.categoria
      WHERE c.unit_id = ANY(${ctx.unitIds ?? ctx.units.map(u => u.id)}) AND coalesce(bm.valor, b.valor_mensal) IS NOT NULL GROUP BY 1` : [];
  // mês em andamento: o realizado do gráfico vai até o último mês fechado; o mês corrente aparece como ponto "parcial" e entra na previsão (mês cheio)
  const pc = pf.parcial; const fechados = pc ? pf.serie24.slice(0, -1) : pf.serie24; const ultFechado = fechados.length - 1;
  const alvo = [...(pc ? [{ periodo: ctx.periodo, orc: pf.atual.orcReceita }] : []), ...futuros.map(p => ({ periodo: p, orc: orcFut.find(o => o.mes === Number(p.slice(5, 7)))?.v ?? null }))];
  const prev = projetarReceita(fechados, alvo, Number(cfg.fpa.cenarioPessimistaPct) / 100, Number(cfg.fpa.cenarioOtimistaPct) / 100);
  const prevFut = pc ? prev.slice(1) : prev;
  const cats = [...pf.serie24.map(x => x.periodo), ...futuros];
  const serieReal = [...fechados.map(x => x.receita), ...(pc ? [null] : []), ...futuros.map(() => null)];
  const serieParcial = pc ? [...fechados.map(() => null), pf.receita.real, ...futuros.map(() => null)] : null;
  const serieOrc = [...pf.serie24.map(x => x.orcReceita), ...prevFut.map(p => orcFut.find(o => o.mes === Number(p.periodo.slice(5, 7)))?.v ?? null)];
  const serieFc = [...fechados.map((x, i) => i === ultFechado ? x.receita : null), ...prev.map(p => p.valor)];
  const faixaMin = [...fechados.map(() => null), ...prev.map(p => p.min)]; const faixaMax = [...fechados.map(() => null), ...prev.map(p => p.max)];
  const ateTxt = pc ? pc.ate.slice(5, 10).split("-").reverse().join("/") : "";
  const recRef = pc ? pc.orcReceita : pf.receita.orc; const aaRef = pc ? pc.anoAnterior?.receita ?? null : pf.mesAnoAnterior?.receita ?? null;
  const criticos = alertas.filter(a => a.severidade === "ALTO").length; const atrasados = alertas.filter(a => (a.horas_restantes ?? 1) < 0).length;
  const frases = narrativaBoard({ periodo: ctx.periodo, receita: { real: pf.receita.real, orc: pf.receita.orc, anoAnterior: pf.mesAnoAnterior?.receita ?? null, parcial: pc ? { ate: pc.ate, orc: pc.orcReceita, anoAnterior: pc.anoAnterior?.receita ?? null, base: pc.base } : null }, folhaCompetencia: pf.folhaReceita?.competencia ?? null, caixa: { saldo: pf.caixa.saldo, dadosAte: pf.caixa.dadosAte }, semanaCritica: proj?.menor ? { ate: proj.menor.ate, min: proj.menor.min } : null, inad30: pf.inad30 ? { pct: pf.inad30.pct, familias: pf.inad30.familias } : null, metaInad: Number(cfg.commandCenter.inadimplenciaAlertaPct), folhaReceita: pf.folhaReceita?.pct ?? null, funil: { ponderado: funil.ponderado, vagas: funil.vagas, ocupacaoPct: funil.ocupacaoPct, reservasVencendo: venc.n }, alertas: { criticos, atrasados }, aprovacoes: ferias.length + banco.length, ebitda: pf.ebitda });
  const vRec = variacao(pf.receita.real, aaRef, "R$"); const tomRec: Tom = pf.receita.real === null || !recRef ? "neutro" : pf.receita.real >= recRef ? "bom" : pf.receita.real >= 0.9 * recRef ? "atencao" : "ruim";
  const metaInad = Number(cfg.commandCenter.inadimplenciaAlertaPct); const tomInad: Tom = !pf.inad30 ? "neutro" : pf.inad30.pct <= metaInad ? "bom" : pf.inad30.pct <= metaInad * 1.5 ? "atencao" : "ruim";
  const tomUn = (x: number | null) => x === null ? "border-line" : x >= 80 ? "border-ok" : x >= 60 ? "border-aviso" : "border-erro";
  return (
    <Page title="Board do dono" sub="Como está o grupo, o que desviou e o que decidir — em 30 segundos. Todo número vem de um módulo; sem fonte, aparece “sem fonte” (nunca zero). Toque em qualquer cartão para descer até o registro."
      actions={<><Link href={`/executivo?${qs}`} className="inline-flex items-center rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-navy hover:bg-mist">Painel completo</Link><PrintButton /></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <BarraContexto ctx={ctx} voltar="/executivo/board" />
      <CarimboContexto ctx={ctx} extra={`retrato de ${fmtDataHora(new Date())}`} />
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-3">
        <section aria-label="Indicadores do dono" className="order-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:order-none lg:col-span-3 xl:grid-cols-6">
          <KpiCard titulo={pc ? `Receita de ${rotuloMes(ctx.periodo)} · até ${ateTxt}` : `Receita de ${rotuloMes(ctx.periodo)}`} valor={pf.receita.real === null ? "sem fonte" : fmtReais(pf.receita.real, true)} tom={tomRec} serie={(pc ? pf.serie13.slice(0, -1) : pf.serie13).map(x => x.receita)} deltas={[recRef ? { texto: `${fmtPct((100 * (pf.receita.real ?? 0)) / recRef, 0)}`, rotulo: pc ? "do orçado proporcional" : "do orçado", bom: (pf.receita.real ?? 0) >= recRef } : null, vRec ? { texto: vRec.texto, rotulo: pc ? "vs mesmo período do ano passado" : "vs mesmo mês do ano passado", bom: vRec.sentido === 0 ? null : vRec.sentido > 0 } : null]} href={`/financeiro/dre?${qs}`} sub={pf.receita.real === null && pf.caixa.dadosAte ? `caixa importado até ${pf.caixa.dadosAte.split("-").reverse().join("/")}` : pf.receita.orc ? `${pc ? "mês em andamento · " : ""}meta do mês ${fmtReais(pf.receita.orc, true)}` : "sem orçamento"} ajuda={pc ? `Mês em andamento: comparado com o orçado proporcional (${pc.base === "perfil" ? "perfil do mesmo mês do ano anterior" : "dias corridos"}) e com o ano anterior até o mesmo dia` : undefined} />
          <KpiCard titulo="Caixa consolidado" valor={pf.caixa.saldo === null ? "sem fonte" : fmtReais(pf.caixa.saldo, true)} tom={pf.caixa.saldo === null ? "neutro" : pf.caixa.saldo < 0 ? "ruim" : "neutro"} sub={pf.caixa.dadosAte ? `dados até ${pf.caixa.dadosAte.split("-").reverse().join("/")}${pf.caixa.parcial ? " · parcial (unidade sem saldo inicial)" : ""}` : "sem saldo inicial do mês"} href={`/financeiro/cockpit?${qs}#tesouraria`} nota={proj?.menor && proj.menor.min < 0 ? "semana negativa projetada" : null} />
          <KpiCard titulo="Inadimplência 30+" valor={pf.inad30 ? fmtPct(pf.inad30.pct) : "sem fonte"} tom={tomInad} meta={pf.inad30 ? { texto: `meta ≤ ${fmtPct(metaInad, 0)}`, tom: tomInad } : null} sub={pf.inad30 ? `${pf.inad30.familias} família(s) · ${fmtReais(pf.inad30.valor, true)}` : "importe os títulos"} href={`/rede?${qs}&kpi=inad`} />
          <KpiCard titulo="Alunos atuais × vagas" valor={pf.alunos.toLocaleString("pt-BR")} tom={funil.ocupacaoPct === null ? "neutro" : funil.ocupacaoPct >= 85 ? "bom" : funil.ocupacaoPct >= 70 ? "atencao" : "ruim"} sub={funil.vagas ? `ocupação ${funil.ano}: ${fmtPct(funil.ocupacaoPct, 0)} de ${funil.vagas} vagas` : `sem turmas ${funil.ano}`} href={`/rede?${qs}&kpi=alunos`} />
          <KpiCard titulo={`Funil ${funil.ano} ponderado`} valor={funil.ponderado.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} sub={`${funil.conf} matriculados · ${funil.res} reservas · ${funil.fila} na fila`} tom="neutro" href="/matriculas/metas" ajuda={`Pesos: matrícula ${funil.pesos.CONFIRMADA ?? 1} · reserva ${funil.pesos.RESERVADA ?? 0.6} · fila ${funil.pesos.FILA ?? 0.15}`} />
          <KpiCard titulo={pf.folhaReceita && pf.folhaReceita.competencia !== ctx.periodo ? `Folha ÷ receita · ${rotuloMes(pf.folhaReceita.competencia)}` : "Folha ÷ receita"} valor={pf.folhaReceita ? fmtPct(pf.folhaReceita.pct) : "sem fonte"} tom={pf.folhaReceita ? (pf.folhaReceita.pct > 60 ? "ruim" : pf.folhaReceita.pct > 50 ? "atencao" : "bom") : "neutro"} sub={pf.folhaReceita ? `custo REAL ${fmtReais(pf.folhaReceita.custo, true)}${pf.folhaReceita.unidades < pf.folhaReceita.total ? ` · ${pf.folhaReceita.unidades} de ${pf.folhaReceita.total} unidades` : ""}` : "aceite o resultado da folha"} href={`/folha/custo?${qs}`} ajuda="Última competência com o resultado da folha aceito (até 3 meses), sobre a receita das mesmas unidades" />
        </section>
        <Card title="Trajetória da receita — 24 meses, orçado e previsão" className="order-4 lg:order-none lg:col-span-2">
          <Linhas tamanho="inteiro" categorias={cats.map(p => rotuloMes(p))} series={[{ nome: "Realizado", valores: serieReal, cor: COR.navy, area: true }, ...(serieParcial ? [{ nome: `Parcial até ${ateTxt}`, valores: serieParcial, cor: COR.aviso }] : []), { nome: "Orçado", valores: serieOrc, cor: COR.neutro, tracejada: true }, { nome: "Previsão", valores: serieFc, cor: COR.acao, tracejada: true }]} faixa={futuros.length ? { min: faixaMin, max: faixaMax, rotulo: "Faixa (pessimista–otimista)" } : null} formato={fmtEixo("R$")} formatoDica={x => fmtReais(x)} rotulo="Receita realizada, orçada e prevista" />
          <p className="mt-1 text-[11px] text-slate-500">Previsão até dezembro: orçado do mês (ou média dos 3 últimos meses fechados) com a banda dos cenários de Configurações (FP&A). Regime de caixa.{pc ? ` ${rotuloMes(ctx.periodo)} está em andamento: o ponto âmbar é o realizado até ${ateTxt}; a linha do realizado só inclui meses fechados.` : ""}</p>
        </Card>
        <Card title="O que importa hoje" className="order-1 lg:order-none">
          <ul className="space-y-2">{frases.map((f, i) => <li key={i} className={`rounded-md border border-line border-l-4 bg-white p-2.5 text-sm ${TOM_TXT[f.tom]}`}><p className="leading-snug">{f.texto}</p>{f.chips.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1.5">{f.chips.map(c => <Link key={c.href + c.rotulo} href={c.href} className="rounded-full border border-acao/30 bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-acao hover:bg-sky-100">{c.rotulo}</Link>)}</div>}</li>)}</ul>
          <p className="mt-2 text-[11px] text-slate-500">Leitura determinística (sem IA): cada frase cita o número e a fonte.</p>
        </Card>
        <Card title="As unidades" className="order-5 lg:order-none lg:col-span-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{unidades.map(un => <Link key={un.id} href={`/rede?ctx_u=${un.id}&ctx_p=${ctx.periodo}`} className={`block rounded-md border-2 bg-white p-3 transition hover:shadow-sm ${tomUn(un.saude)}`}>
            <div className="flex items-baseline justify-between gap-2"><b className="text-navy">{un.nome}</b>{un.saude !== null && <span className="text-xs text-slate-600">saúde <b className="tabular-nums">{un.saude}</b></span>}</div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs"><div><dt className="text-slate-500">{pc ? `Receita até ${ateTxt}` : "Receita do mês"}</dt><dd className="font-medium tabular-nums">{un.receita === null ? "sem fonte" : fmtReais(un.receita, true)}</dd></div><div><dt className="text-slate-500">Alunos</dt><dd className="font-medium tabular-nums">{un.alunos}</dd></div><div><dt className="text-slate-500">Ocupação {funil.ano}</dt><dd className="font-medium tabular-nums">{un.ocupacaoPct === null ? "—" : fmtPct(un.ocupacaoPct, 0)}</dd></div><div><dt className="text-slate-500">Inadimplência 30+</dt><dd className={`font-medium tabular-nums ${un.inad30 !== null && un.inad30 > metaInad ? "text-erro" : ""}`}>{un.inad30 === null ? "—" : fmtPct(un.inad30)}</dd></div></dl>
          </Link>)}</div>
        </Card>
        <Card title={`Alertas mais críticos (${alertas.length} abertos${criticos ? ` · ${criticos} crítico(s)` : ""})`} className="order-3 lg:order-none" actions={<Link href="/alertas" className="text-xs text-acao">Central →</Link>}>
          {alertas.length === 0 ? <p className="text-sm text-slate-600">Nada exige atenção agora.</p> : <ul className="space-y-2 text-sm">{alertas.slice(0, 3).map(a => <li key={a.id}><Badge v={a.severidade === "ALTO" ? "REJEITADA" : "PENDENTE"} label={SEVERIDADE_LABEL[a.severidade]} /> <Link href={`/alertas?id=${a.id}`} className="hover:underline">{a.titulo}</Link><div className="text-[11px] text-slate-500">dono: {a.dono ?? "sem dono"}{(a.horas_restantes ?? 1) < 0 ? " · prazo estourado" : ""}</div></li>)}</ul>}
          {ferias.length + banco.length > 0 && <p className="mt-3 border-t border-line pt-2 text-xs"><Link href="/aprovacoes" className="font-medium text-acao">{ferias.length + banco.length} aprovação(ões) aguardando você →</Link></p>}
        </Card>
      </div>
    </Page>
  );
}
