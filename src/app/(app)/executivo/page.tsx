import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { sql } from "@/db";
import { requireGestao } from "@/lib/auth";
import { Page, Card, Flash, Field, Select, Btn } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { MapaCalor, Bala, Funil, Colunas, BarrasH, COR, type CelulaCalor } from "@/components/graficos";
import { vePainelExecutivo, podeRecalcular, podeEditarMeta, orcamentoMensal } from "@/lib/kpi";
import { carregarPainel, linkPainel, type Painel } from "@/lib/painel-executivo";
import { TOM_FAROL, porUnidade, type VisaoKpi, type AreaKpi } from "@/lib/kpi-catalogo";
import { fmtKpi, fmtEixo, rotuloMes } from "@/lib/formato";
import { fmtData } from "@/lib/utils";
import { funilPorOrigem } from "@/lib/metricas-extra";
import { ORIGEM_FUNIL_LABEL } from "@/lib/gestao-estrategica";
import { CartaoKpi, GraficoKpi, Leitura, ResumoSituacao, Abas, TabelaKpis, GradeCartoes } from "./_ui";
import { assinarResumo, recalcularBase } from "./actions";

export const dynamic = "force-dynamic";

function Comparativo({ P, visoes, href }: { P: Painel; visoes: VisaoKpi[]; href: (chave: string, unidade?: number) => string }) {
  if (!P.comparativo) return null;
  const linhas = visoes.filter(v => porUnidade(v.def));
  if (!linhas.length) return null;
  const cols = [...P.comparativo.unidades.map(u => ({ chave: String(u.id), rotulo: u.nome })), { chave: "0", rotulo: "Rede" }];
  const celula = (chave: string, col: string): CelulaCalor => {
    const c = P.comparativo!.celulas.get(`${chave}|${col}`); const v = linhas.find(x => x.def.chave === chave)!;
    if (!c || c.valor === null) return { texto: "—", tom: "vazio", titulo: "sem medição" };
    return { texto: fmtKpi(c.valor, v.def.unidade, true) + (c.medidoEm && c.medidoEm !== P.periodo ? "*" : ""), tom: TOM_FAROL[c.farol], titulo: c.meta !== null ? `meta ${fmtKpi(c.meta, v.def.unidade, true)}` : "sem meta", href: href(chave, Number(col)) };
  };
  return (
    <Card title="Comparativo das unidades" className="mt-4" actions={<span className="text-[11px] text-slate-500">verde no alvo · âmbar atenção · vermelho fora · * última medição</span>}>
      <MapaCalor rotulo="Indicadores por unidade" cabecalho="Indicador" colunas={cols} linhas={linhas.map(v => ({ chave: v.def.chave, rotulo: v.nome, href: href(v.def.chave) }))} celula={celula} />
    </Card>
  );
}

async function GraficosArea({ P, area, href }: { P: Painel; area: AreaKpi; href: (chave: string, unidade?: number) => string }) {
  const vs = P.porArea[area] ?? []; const pega = (k: string) => vs.find(v => v.def.chave === k);
  const blocos: React.ReactNode[] = [];
  const ult12 = (v: VisaoKpi) => v.serie.slice(-12);
  if (area === "pessoas") {
    const a = pega("pessoas.admissoes"), d = pega("pessoas.desligamentos");
    if (a && d) blocos.push(<Card key="mov" title="Admissões × desligamentos (12 meses)"><Colunas categorias={ult12(a).map(p => rotuloMes(p.periodo))} series={[{ nome: "Admissões", valores: ult12(a).map(p => p.valor), cor: COR.ok }, { nome: "Desligamentos", valores: ult12(d).map(p => p.valor), cor: COR.erro }]} rotulo="Admissões e desligamentos por mês" rotulos /></Card>);
  }
  if (area === "matriculas" && P.comparativo) {
    for (const ch of ["matriculas.ocupacao", "matriculas.rematricula"]) {
      const v = pega(ch); if (!v) continue;
      blocos.push(<Card key={ch} title={`${v.nome} por unidade`}><Bala rotulo={`${v.nome} por unidade`} itens={[...P.comparativo.unidades.map(u => ({ id: u.id, nome: u.nome })), { id: 0, nome: "Rede" }].map(u => { const c = P.comparativo!.celulas.get(`${ch}|${u.id}`); return { rotulo: u.nome, atual: c?.valor ?? null, meta: c?.meta ?? null, maximo: 100, formato: (x: number) => fmtKpi(x, "%"), href: href(ch, u.id) }; })} /></Card>);
    }
  }
  if (area === "matriculas") {
    const c = pega("matriculas.candidatos"), n = pega("matriculas.novas");
    if (c && n && c.acumulado) blocos.push(<Card key="funil" title={`Captação no ano (até ${rotuloMes(P.periodo)})`}><Funil rotulo="Funil de captação no ano" etapas={[{ rotulo: "Candidatos cadastrados", valor: c.acumulado ?? 0 }, { rotulo: "Matrículas novas", valor: n.acumulado ?? 0 }]} /><p className="mt-2 text-[11px] text-slate-500">Números agregados do cadastro de Matrículas — não é cadastro de leads.</p></Card>);
    const f = await funilPorOrigem(P.periodo, P.unitId || null);
    const origens = f.porOrigem.filter(o => o.candidatos || o.matriculas).sort((a, b) => b.candidatos - a.candidatos);
    if (origens.length) blocos.push(<Card key="origem" title={`Origem dos candidatos — ${rotuloMes(P.periodo)}`}><BarrasH rotulo="Candidatos por origem" itens={origens.map(o => ({ rotulo: ORIGEM_FUNIL_LABEL[o.origem] ?? o.origem, valor: o.candidatos, sub: `${o.reservas} reserva(s) · ${o.matriculas} matrícula(s)`, cor: COR.acao }))} formato={x => String(x)} /></Card>);
  }
  if (area === "financeiro") {
    const r = pega("financeiro.receita"), d = pega("financeiro.despesa"), res = pega("financeiro.resultado");
    if (r && d) {
      const ano = Number(P.periodo.slice(0, 4)); const orc = await orcamentoMensal(ano, P.unitId);
      const meses = ult12(r).map(p => p.periodo);
      const marc = meses.map(p => Number(p.slice(0, 4)) === ano ? orc.get(Number(p.slice(5, 7)))?.ENTRADA ?? null : null);
      blocos.push(<Card key="rd" title="Receita × despesa (12 meses)"><Colunas categorias={meses.map(p => rotuloMes(p))} series={[{ nome: "Receita", valores: ult12(r).map(p => p.valor), cor: COR.ok }, { nome: "Despesa", valores: ult12(d).map(p => p.valor), cor: COR.erro }]} linhas={res ? [{ nome: "Resultado", valores: ult12(res).map(p => p.valor), cor: COR.navy }] : []} formato={fmtEixo("R$")} formatoDica={x => fmtKpi(x, "R$")} rotulo="Receita, despesa e resultado por mês" /></Card>);
      if (marc.some(x => x !== null)) blocos.push(<Card key="orc" title={`Receita: orçado × realizado (${ano})`}><Colunas categorias={meses.map(p => rotuloMes(p))} series={[{ nome: "Realizado", valores: ult12(r).map(p => p.valor), cor: COR.acao }]} marcadores={{ nome: "Orçado", valores: marc, cor: COR.navy }} corValor={(x, i) => marc[i] === null ? undefined : x >= (marc[i] ?? 0) ? COR.ok : x >= 0.95 * (marc[i] ?? 0) ? COR.aviso : COR.erro} formato={fmtEixo("R$")} formatoDica={x => fmtKpi(x, "R$")} rotulo="Receita realizada contra o orçamento" /><p className="mt-1 text-[11px] text-slate-500">Barra verde: acima do orçado · âmbar: até 5% abaixo · vermelha: mais de 5% abaixo. <Link className="text-acao hover:underline" href="/financeiro/orcamento">Ver orçado × realizado completo</Link></p></Card>);
    }
  }
  const especiais = new Set(area === "pessoas" ? ["pessoas.admissoes", "pessoas.desligamentos"] : area === "financeiro" ? ["financeiro.receita", "financeiro.despesa", "financeiro.resultado"] : area === "matriculas" ? ["matriculas.candidatos"] : []);
  for (const v of vs.filter(v => !especiais.has(v.def.chave) && v.serie.filter(p => p.valor !== null).length >= 2).slice(0, 8)) blocos.push(<Card key={v.def.chave} title={<Link href={href(v.def.chave)} className="hover:underline">{v.nome}</Link>}><GraficoKpi v={v} /></Card>);
  return <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">{blocos}</div>;
}

export default async function Executivo({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireGestao(); if (!vePainelExecutivo(s)) redirect("/");
  const sp = await searchParams; const P = await carregarPainel(s, sp);
  const aba = sp.aba && (sp.aba === "geral" || P.areas.includes(sp.aba as AreaKpi)) ? sp.aba : "geral";
  const base = { periodo: P.periodo, unitId: P.unitId };
  const href = (chave: string, unidade?: number) => linkPainel(`/executivo/indicador/${encodeURIComponent(chave)}`, { periodo: P.periodo, unitId: unidade ?? P.unitId });
  const voltar = linkPainel("/executivo", base, { aba });
  const [assin] = await sql<{ ativo: boolean }[]>`SELECT ativo FROM kpi_subscriptions WHERE user_id=${s.id}`;
  const editaMetas = P.defs.some(k => podeEditarMeta(s, k));
  const abas = [{ chave: "geral", rotulo: "Geral", href: linkPainel("/executivo", base, { aba: "geral" }) }, ...P.areas.map(a => ({ chave: a, rotulo: P.nomesArea[a].curto, href: linkPainel("/executivo", base, { aba: a }) }))];
  const tendencias = P.destaques.filter(v => v.serie.filter(p => p.valor !== null).length >= 3).slice(0, 4);
  return (
    <Page title="Painel Executivo" sub={<>{P.unidadeNome} · {P.titulo}{P.estado?.recenteEm ? <> · base atualizada em {fmtData(P.estado.recenteEm)}</> : null}</>}
      actions={<div className="flex flex-wrap gap-2 print:hidden">
        <Btn href={linkPainel("/apresentacao", base)}>Apresentar</Btn>
        <Btn kind="ghost" href={`/api/export/painel?periodo=${P.periodo}${P.unitId ? `&unidade=${P.unitId}` : ""}`}>Exportar CSV</Btn>
        <PrintButton />
        <Btn kind="ghost" href={`/executivo/metas?ano=${P.periodo.slice(0, 4)}`}>{editaMetas ? "Metas" : "Ver metas"}</Btn>
        <Btn kind="ghost" href="/executivo/dicionario">Dicionário</Btn>
      </div>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-3 flex flex-wrap items-end gap-2 print:hidden">
        <form className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="aba" value={aba} />
          <Field label="Mês"><Select name="periodo" defaultValue={P.periodo}>{P.periodos.map(p => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}</Select></Field>
          {P.escopo === null && <Field label="Unidade"><Select name="unidade" defaultValue={P.unitId || ""}><option value="">Rede</option>{P.units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
          <Btn kind="ghost">Ver</Btn>
        </form>
        <span className="flex-1" />
        <form action={assinarResumo}><input type="hidden" name="voltar" value={voltar} /><input type="hidden" name="ativo" value={assin?.ativo ? "0" : "1"} /><input type="hidden" name="unidade" value={P.unitId || ""} /><Btn small kind="ghost">{assin?.ativo ? "✓ Resumo semanal assinado · cancelar" : "Receber o resumo toda segunda"}</Btn></form>
        {podeRecalcular(s) && <form action={recalcularBase}><input type="hidden" name="voltar" value={voltar} /><Btn small kind="ghost" pendingText="Recalculando…">Recalcular base</Btn></form>}
      </div>
      <Abas itens={abas} atual={aba} />

      {aba === "geral" ? <>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card title={`Leitura de ${P.titulo}`}>
            <Leitura frases={P.frases} />
            <p className="mt-3 text-[11px] text-slate-500">Gerada pelos próprios números (sem IA): fora do alvo, movimentos acima do normal de cada indicador, sequências de 3 meses, recordes de 24 meses e comparação com o ano anterior.</p>
          </Card>
          <Card title="Situação dos indicadores"><ResumoSituacao visoes={P.vs} href={c => href(c)} /></Card>
        </div>
        <h2 className="mb-2 mt-5 text-sm font-semibold text-navy">Destaques</h2>
        <GradeCartoes>{P.destaques.map(v => <CartaoKpi key={v.def.chave} v={v} href={href(v.def.chave)} />)}</GradeCartoes>
        <Comparativo P={P} visoes={P.destaques} href={href} />
        {tendencias.length > 0 && <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">{tendencias.map(v => <Card key={v.def.chave} title={<Link href={href(v.def.chave)} className="hover:underline">{v.nome}</Link>}><GraficoKpi v={v} /></Card>)}</div>}
      </> : <>
        <p className="mb-3 text-sm text-slate-600">{P.nomesArea[aba as AreaKpi].descricao}</p>
        <GradeCartoes>{(P.porArea[aba as AreaKpi] ?? []).map(v => <CartaoKpi key={v.def.chave} v={v} href={href(v.def.chave)} />)}</GradeCartoes>
        <GraficosArea P={P} area={aba as AreaKpi} href={href} />
        <Comparativo P={P} visoes={P.porArea[aba as AreaKpi] ?? []} href={href} />
        <Card title="Todos os indicadores da área" className="mt-4"><TabelaKpis visoes={P.porArea[aba as AreaKpi] ?? []} href={c => href(c)} /></Card>
      </>}
      <p className="mt-4 text-[11px] text-slate-500">Mês sem medição aparece em branco — nunca como zero. Clique num indicador para ver 24 meses, a fórmula, cada unidade e os comentários da gestão.</p>
    </Page>
  );
}
