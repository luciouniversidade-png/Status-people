import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession } from "@/lib/auth";
import { Page, Card, Flash, Table, Td, Badge } from "@/components/ui";
import { KpiCard, Linhas, Rosca, COR, Vazio } from "@/components/graficos";
import { BarraContexto, CarimboContexto } from "@/components/BarraContexto";
import { lerContexto, qsContexto } from "@/lib/contexto";
import { podeFolha, custosAceitos, receitaPorMes, type LinhaCusto } from "@/lib/folha";
import { competenciaAnterior, exigeExplicacao } from "@/lib/folha-calc";
import { fmtReais, fmtPct, rotuloMes, fmtEixo, variacao } from "@/lib/formato";
import { getSettings } from "@/lib/utils";

export const dynamic = "force-dynamic";
type Dim = "entidade" | "unidade" | "area";

/** T-056 · Custo de folha por dimensão: só o resultado aceito (fonte REAL — CRQ-FOL-V3-04), nunca o indivíduo. */
export default async function CustoFolha({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!podeFolha(s) && s.role !== "LEITURA") redirect("/"); const sp = await searchParams;
  const ctx = await lerContexto(s, sp); const cfg = await getSettings(); const dim: Dim = sp.dim === "unidade" || sp.dim === "area" ? sp.dim : "entidade";
  const meses = Array.from({ length: 13 }, (_, i) => { let m = ctx.periodo; for (let k = 0; k < 12 - i; k++) m = competenciaAnterior(m); return m; });
  const ano = ctx.periodo.slice(0, 4); const mesesAno = meses.filter(m => m.startsWith(ano));
  const linhas = await custosAceitos(meses, { companyId: ctx.entidadeId, unitId: ctx.unitId });
  const receita = await receitaPorMes(meses, ctx.unitIds);
  const doMes = (m: string) => linhas.filter(l => l.competencia === m);
  const soma = (ls: LinhaCusto[], k: "custo" | "salarios" | "encargos" | "provisao_13" | "provisao_ferias") => ls.length ? ls.reduce((a, l) => a + l[k], 0) : null;
  const serie = meses.map(m => soma(doMes(m), "custo")); const atual = serie[12]; const anterior = serie[11];
  const rec = receita.get(ctx.periodo) ?? null; const folhaReceita = atual !== null && rec ? (100 * atual) / rec : null;
  const encPct = (() => { const l = doMes(ctx.periodo); const sal = soma(l, "salarios"); const enc = soma(l, "encargos"); return sal && enc !== null ? (100 * enc) / sal : null; })();
  const provAno = (() => { const l = linhas.filter(x => mesesAno.includes(x.competencia) && x.competencia <= ctx.periodo); return l.length ? l.reduce((a, x) => a + x.provisao_13 + x.provisao_ferias, 0) : null; })();
  const hc = doMes(ctx.periodo).some(l => l.headcount !== null) ? doMes(ctx.periodo).reduce((a, l) => a + (l.headcount ?? 0), 0) : null;
  const [al] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM students WHERE aluno_atual ${ctx.unitIds ? sql`AND unit_atual_id = ANY(${ctx.unitIds})` : sql``}`;
  const custoAluno = atual !== null && al.n ? atual / al.n : null;
  const chave = (l: LinhaCusto) => dim === "entidade" ? l.entidade : dim === "unidade" ? l.unidade ?? "Sem unidade" : l.area ?? "Sem área";
  const grupos = [...new Set(linhas.filter(l => l.competencia === ctx.periodo || l.competencia === meses[11]).map(chave))].sort();
  const tabela = grupos.map(g => { const a = doMes(ctx.periodo).filter(l => chave(l) === g); const b = doMes(meses[11]).filter(l => chave(l) === g); const va = soma(a, "custo"), vb = soma(b, "custo"); return { g, va, vb, delta: va !== null && vb !== null ? va - vb : null, pct: va !== null && atual ? (100 * va) / atual : null }; }).sort((x, y) => (y.va ?? 0) - (x.va ?? 0));
  const porArea = [...new Set(doMes(ctx.periodo).map(l => l.area ?? "Sem área"))].map(a => ({ rotulo: a, valor: doMes(ctx.periodo).filter(l => (l.area ?? "Sem área") === a).reduce((x, l) => x + l.custo, 0) }));
  const pendentes = await sql<{ id: number; competencia: string; entidade: string; variacao_pct: number | null; expl: number }[]>`SELECT c.id, c.competencia, co.nome AS entidade, c.variacao_pct::float, (SELECT count(*) FROM payroll_explanations x WHERE x.cycle_id=c.id)::int AS expl FROM payroll_cycles c JOIN companies co ON co.id=c.company_id WHERE c.status='RESULTADO_IMPORTADO' ${ctx.entidadeId ? sql`AND c.company_id=${ctx.entidadeId}` : sql``}`;
  const semExpl = pendentes.filter(p => exigeExplicacao(p.variacao_pct, Number(cfg.folha.variacaoMaxPct)) && !p.expl);
  const lacunas = meses.filter((m, i) => serie[i] === null);
  const v = variacao(atual, anterior, "R$"); const qs = qsContexto(ctx);
  return (
    <Page title="Custo de folha por dimensão" sub="Leitura gerencial do custo de pessoal — só resultados aceitos da Payroll Bridge (fonte REAL), por entidade, unidade e área. Nunca expõe holerite individual."
      actions={<a className="inline-flex items-center rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-navy hover:bg-mist" href={`/api/folha/custo?${qs}&dim=${dim}`}>Exportar CSV (agregado)</a>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <BarraContexto ctx={ctx} voltar={`/folha/custo?dim=${dim}`} notaPeriodo="período = competência" />
      <CarimboContexto ctx={ctx} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard titulo={`Custo de pessoal · ${rotuloMes(ctx.periodo)}`} valor={atual === null ? "sem fonte" : fmtReais(atual, true)} tom={atual === null ? "neutro" : "neutro"} serie={serie} deltas={[v ? { texto: v.texto, rotulo: "vs mês anterior", bom: v.sentido === 0 ? null : v.sentido < 0 } : null]} sub={atual === null ? "nenhum resultado aceito na competência" : "REAL · resultado aceito"} href={`/folha?mes=${ctx.periodo}`} />
        <KpiCard titulo="Folha ÷ receita (KPI-13)" valor={folhaReceita === null ? "sem fonte" : fmtPct(folhaReceita)} sub={rec ? `receita de caixa ${fmtReais(rec, true)}` : ctx.semVinculo ? "entidade sem unidades vinculadas" : "sem receita no mês"} />
        <KpiCard titulo="Encargos sobre proventos" valor={encPct === null ? "—" : fmtPct(encPct)} sub="INSS patronal + FGTS" />
        <KpiCard titulo={`Provisões acumuladas ${ano}`} valor={provAno === null ? "—" : fmtReais(provAno, true)} sub="13º + férias e 1/3" />
        <KpiCard titulo="Custo por aluno" valor={custoAluno === null ? "—" : fmtReais(custoAluno)} sub={`${al.n} alunos atuais no recorte`} />
        <KpiCard titulo="Custo médio por pessoa" valor={atual !== null && hc ? fmtReais(atual / hc) : "—"} sub={hc ? `${hc} no resultado` : "headcount não informado"} />
      </div>
      {(semExpl.length > 0 || lacunas.length > 0) && <Card title="Atenção" className="mb-4"><ul className="space-y-1 text-sm">
        {semExpl.map(p => <li key={p.id} className="text-erro">⛔ <Link href={`/folha/${p.id}`} className="hover:underline">{p.entidade} · {rotuloMes(p.competencia)}: variação de {fmtPct(p.variacao_pct)} sem explicação — o aceite está travado</Link></li>)}
        {lacunas.length > 0 && <li className="text-slate-600">Sem resultado aceito em {lacunas.map(m => rotuloMes(m)).join(", ")} — os meses ficam em branco (nunca zero).</li>}
      </ul></Card>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Custo de pessoal — 13 competências" className="lg:col-span-2">{serie.some(x => x !== null) ? <Linhas tamanho="inteiro" categorias={meses.map(m => rotuloMes(m))} series={[{ nome: "Custo total (REAL)", valores: serie, cor: COR.navy, area: true }, { nome: "Proventos", valores: meses.map(m => soma(doMes(m), "salarios")), cor: COR.acao, tracejada: true }]} formato={fmtEixo("R$")} formatoDica={x => fmtReais(x)} rotulo="Custo de pessoal por competência" /> : <Vazio texto="Nenhum resultado aceito no período. Importe e aceite o resultado no ciclo da folha." />}</Card>
        <Card title={`Por área · ${rotuloMes(ctx.periodo)}`}>{porArea.length ? <Rosca rotulo="Custo por área" fatias={porArea} formato={x => fmtReais(x, true)} centro={atual !== null ? { valor: fmtReais(atual, true), rotulo: "total" } : undefined} /> : <Vazio />}</Card>
      </div>
      <Card title="Por dimensão" className="mt-4" actions={<div className="flex gap-2 text-xs">{(["entidade", "unidade", "area"] as Dim[]).map(d => <Link key={d} href={`/folha/custo?${qs}&dim=${d}`} className={d === dim ? "font-semibold text-navy" : "text-acao"}>{d === "area" ? "área" : d}</Link>)}</div>}>
        <Table head={[dim === "area" ? "Área" : dim === "unidade" ? "Unidade" : "Entidade", rotuloMes(ctx.periodo), rotuloMes(meses[11]), "Δ", "% do total"]} empty="Sem resultado aceito para comparar.">
          {tabela.map(t => <tr key={t.g}><Td>{t.g}</Td><Td className="tabular-nums">{fmtReais(t.va)}</Td><Td className="tabular-nums text-slate-600">{fmtReais(t.vb)}</Td><Td className={`tabular-nums ${t.delta !== null && t.delta > 0 ? "text-erro" : t.delta !== null && t.delta < 0 ? "text-ok" : ""}`}>{t.delta === null ? "—" : `${t.delta > 0 ? "+" : ""}${fmtReais(t.delta)}`}</Td><Td className="tabular-nums">{t.pct === null ? "—" : fmtPct(t.pct)}</Td></tr>)}
        </Table>
        <p className="mt-2 text-xs text-slate-500">Custo = proventos + INSS patronal + FGTS + provisões (13º, férias e 1/3) + benefícios + rescisões. IRRF é retido do colaborador e não é custo. Detalhar a pessoa não é possível aqui por desenho: o arquivo de holerites é restrito e cada consulta fica registrada. <Badge v="ABERTO" label="REAL" /></p>
      </Card>
    </Page>
  );
}
