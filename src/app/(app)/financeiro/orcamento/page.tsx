import Link from "@/components/Link";
import { requireFinanceiro, scopeUnit, can } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Flash, Field, Select, Btn, Input, Stat, Textarea } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { Modal } from "@/components/Modal";
import { Cascata, Colunas, Linhas, KpiCard, Situacao, Execucao, COR, type Tom } from "@/components/graficos";
import { getSettings, hoje, fmtDataHora } from "@/lib/utils";
import { orcamentoAno, brl } from "@/lib/financeiro";
import { fpa, passosCascata, porUnidade, desvio, type LinhaFpa } from "@/lib/fpa";
import { fmtReais, fmtPct, fmtEixo, variacao, MESES_CURTOS, MESES_LONGOS } from "@/lib/formato";
import { salvarOrcamento } from "../actions";
import { explicarDesvio, removerExplicacao, gerarPedidos } from "./actions";
import { pedidosExplicacao } from "@/lib/orcamento-v24";

export const dynamic = "force-dynamic";

const R = (v: number | null | undefined) => fmtReais(v ?? null, true);
const pctDe = (a: number | null, b: number | null) => a === null || b === null || b === 0 ? null : (100 * a) / Math.abs(b);
const TOM_TXT: Record<Tom, string> = { bom: "text-ok", atencao: "text-aviso", ruim: "text-erro", neutro: "text-slate-500" };

export default async function Orcamento({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireFinanceiro(); const sp = await searchParams; const cfg = await getSettings(); const scope = scopeUnit(s);
  const units = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`;
  const unitId = scope ?? (sp.unidade && units.some(u => u.id === Number(sp.unidade)) ? Number(sp.unidade) : null);
  const h = hoje(); const anoAtual = Number(h.slice(0, 4)); const ano = Number(sp.ano) >= 2020 && Number(sp.ano) <= anoAtual + 1 ? Number(sp.ano) : anoAtual;
  const mesPadrao = ano < anoAtual ? 12 : ano > anoAtual ? 1 : Math.max(1, Number(h.slice(5, 7)) - 1);
  const mesRef = Number(sp.mes) >= 1 && Number(sp.mes) <= 12 ? Number(sp.mes) : mesPadrao;
  const visao: "mes" | "acumulado" = sp.visao === "mes" ? "mes" : "acumulado";
  const [orc, f, unid, pedidos, explic] = await Promise.all([orcamentoAno(ano, unitId), fpa(ano, unitId, mesRef), unitId === null ? porUnidade(ano, mesRef, visao) : Promise.resolve(null), pedidosExplicacao(s, { ano }),
    sql<{ id: number; mes: number; unit_id: number | null; unidade: string | null; tipo: string; categoria: string; texto: string; user_id: number | null; user_nome: string | null; created_at: Date }[]>`SELECT c.id, c.mes, c.unit_id, u.nome AS unidade, c.tipo, c.categoria, c.texto, c.user_id, c.user_nome, c.created_at FROM budget_comments c LEFT JOIN units u ON u.id=c.unit_id WHERE c.ano=${ano} ${unitId === null ? sql`` : sql`AND (c.unit_id=${unitId} OR c.unit_id IS NULL)`} ORDER BY c.created_at DESC LIMIT 40`]);
  const gest = can.gerirFinanceiro(s); const explica = ["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE"].includes(s.role);
  const oc = visao === "mes" ? "orcMes" : "orcAcum"; const rc = visao === "mes" ? "realMes" : "realAcum"; const ac = visao === "mes" ? "antMes" : "antAcum";
  const periodoTxt = visao === "mes" ? `${MESES_LONGOS[mesRef - 1]} de ${ano}` : `janeiro a ${MESES_LONGOS[mesRef - 1]} de ${ano}`;
  const qs = (extra: Record<string, string | number>) => { const q = new URLSearchParams({ ano: String(ano), mes: String(mesRef), visao, ...(unitId ? { unidade: String(unitId) } : {}), ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])) }); return `/financeiro/orcamento?${q}`; };
  const voltar = qs({});
  const passos = passosCascata(f, visao);
  const ent = f.linhas.filter(l => l.tipo === "ENTRADA"), sai = f.linhas.filter(l => l.tipo === "SAIDA");
  // desvios relevantes: desfavoráveis, fora da banda saudável e acima de R$ 1 mil no recorte
  // v24 · uma régua só (KPI-15): desvio desfavorável fora da banda — despesa acima do teto (padrão 105%), receita abaixo do piso (padrão 90%) — e acima de R$ 1 mil
  const bandaMin = Number(cfg.orcamento.faixaMinPct) || 90, bandaMax = Number(cfg.orcamento.faixaMaxPct) || 105;
  const relevantes = f.linhas.map(l => ({ l, d: desvio(l.tipo, l[oc], l[rc]) })).filter(x => x.d && !x.d.favoravel && Math.abs(x.d.abs) >= 1000 && (x.d.pct === null || Math.abs(x.d.pct) >= (x.l.tipo === "ENTRADA" ? 100 - bandaMin : bandaMax - 100))).sort((a, b) => Math.abs(b.d!.abs) - Math.abs(a.d!.abs));
  const cartao = (titulo: string, tipo: "ENTRADA" | "SAIDA" | "RES") => {
    const real = tipo === "RES" ? f.resultado[rc] : f.tot[rc][tipo]; const orcado = tipo === "RES" ? f.resultado[oc] : f.tot[oc][tipo]; const ant = tipo === "RES" ? f.resultado[ac] : f.tot[ac][tipo];
    const d = desvio(tipo === "SAIDA" ? "SAIDA" : "ENTRADA", orcado, real); const vo = variacao(real, orcado, "R$"); const va = variacao(real, ant, "R$");
    return <KpiCard titulo={`${titulo} · ${visao === "mes" ? MESES_CURTOS[mesRef - 1] : "no ano"}`} valor={R(real)} tom={d ? d.tom : "neutro"}
      deltas={[vo ? { texto: vo.texto, rotulo: "vs. orçado", bom: d ? d.favoravel : null } : null, va ? { texto: va.texto, rotulo: `vs. ${ano - 1}`, bom: va.sentido === 0 ? null : (tipo === "SAIDA" ? va.sentido < 0 : va.sentido > 0) } : null]}
      meta={orcado !== null ? { texto: `Orçado ${R(orcado)}${d?.pct !== null && d?.pct !== undefined ? ` · ${fmtPct(100 + d.pct, 0)} do orçado` : ""}`, tom: d ? d.tom : "neutro" } : { texto: "sem orçamento", tom: "neutro" }} />;
  };
  // desvio que some no centavo não tem sinal nem cor ("sem desvio")
  const txtDesvio = (d: ReturnType<typeof desvio>) => !d ? "—" : Math.abs(d.abs) < 0.5 ? "sem desvio" : `${d.abs >= 0 ? "+" : "−"}${R(Math.abs(d.abs))}`;
  const clsDesvio = (d: ReturnType<typeof desvio>) => !d ? "" : Math.abs(d.abs) < 0.5 ? "text-slate-500" : TOM_TXT[d.tom];
  const linhaDre = (l: LinhaFpa) => {
    const d = desvio(l.tipo, l[oc], l[rc]); const va = variacao(l[rc], l[ac], "R$");
    return (
      <tr key={`${l.tipo}${l.categoria}`}>
        <td className="sticky left-0 z-[1] bg-white py-1.5 pl-6 pr-2">{l.categoria}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">{R(l[oc])}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">{R(l[rc])}</td>
        <td className={`px-2 py-1.5 text-right tabular-nums ${clsDesvio(d)}`}>{txtDesvio(d)}<span className="block text-[10px]">{d?.pct !== null && d?.pct !== undefined && Math.abs(d.abs) >= 0.5 ? `${d.pct >= 0 ? "+" : "−"}${fmtPct(Math.abs(d.pct), Math.abs(d.pct) < 1 ? 1 : 0)}` : ""}</span></td>
        <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{R(l[ac])}{va && va.sentido !== 0 ? <span className="block text-[10px]">{va.texto}</span> : null}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">{R(l.previsao)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{R(l.orcAno)}</td>
        <td className="px-2 py-1.5 print:hidden">{explica ? <Modal label={l.comentarios ? `${l.comentarios} nota(s)` : "explicar"} kind="link" title={`${l.categoria} · ${MESES_LONGOS[mesRef - 1]} de ${ano}`}>
          <form action={explicarDesvio} className="space-y-2"><input type="hidden" name="ano" value={ano} /><input type="hidden" name="mes" value={mesRef} /><input type="hidden" name="tipo" value={l.tipo} /><input type="hidden" name="categoria" value={l.categoria} /><input type="hidden" name="unitId" value={unitId ?? ""} /><input type="hidden" name="voltar" value={voltar} />
            <p className="text-xs text-slate-600">Orçado {R(l[oc])} · realizado {R(l[rc])}{d ? ` · ${d.abs >= 0 ? "+" : "−"}${R(Math.abs(d.abs))}` : ""}</p>
            <Field label="O que explica o desvio e o que será feito"><Textarea name="texto" required maxLength={1000} /></Field><Btn small>Registrar explicação</Btn>
          </form>
          {explic.filter(x => x.tipo === l.tipo && x.categoria === l.categoria).map(x => <div key={x.id} className="mt-3 border-l-2 border-amber-300 pl-2 text-xs"><div className="text-slate-500">{MESES_CURTOS[x.mes - 1]}/{ano} · {x.unidade ?? "Rede"} · {x.user_nome}</div><div className="whitespace-pre-line text-sm">{x.texto}</div></div>)}
        </Modal> : l.comentarios ? <span className="text-xs text-slate-500">{l.comentarios} nota(s)</span> : null}</td>
      </tr>
    );
  };
  const subtotal = (rotulo: string, tipo: "ENTRADA" | "SAIDA") => { const d = desvio(tipo, f.tot[oc][tipo], f.tot[rc][tipo]); return <tr className="bg-mist font-medium"><td className="sticky left-0 z-[1] bg-mist px-2 py-1.5">{rotulo}</td><td className="px-2 py-1.5 text-right tabular-nums">{R(f.tot[oc][tipo])}</td><td className="px-2 py-1.5 text-right tabular-nums">{R(f.tot[rc][tipo])}</td><td className={`px-2 py-1.5 text-right tabular-nums ${clsDesvio(d)}`}>{txtDesvio(d)}</td><td className="px-2 py-1.5 text-right tabular-nums">{R(f.tot[ac][tipo])}</td><td className="px-2 py-1.5 text-right tabular-nums">{R(f.tot.previsao[tipo])}</td><td className="px-2 py-1.5 text-right tabular-nums">{R(f.tot.orcAno[tipo])}</td><td className="print:hidden" /></tr>; };
  // séries do ano: resultado acumulado realizado × orçado × ano anterior
  const acumula = (xs: (number | null)[], ys: (number | null)[], ate = 12) => { let a: number | null = null; return xs.map((x, i) => { if (i >= ate) return null; if (x === null && ys[i] === null) return a; a = (a ?? 0) + (x ?? 0) - (ys[i] ?? 0); return a; }); };
  const mesHoje = ano === anoAtual ? Number(h.slice(5, 7)) : ano < anoAtual ? 12 : 0;
  // gráficos mês a mês: só meses fechados — o mês corrente (parcial) entra quando é o próprio mês de referência
  const ateMes = ano === anoAtual && mesRef < mesHoje ? mesHoje - 1 : mesHoje;
  return (
    <Page title={`Orçado × realizado ${ano}`} sub={`FP&A · ${unitId ? units.find(u => u.id === unitId)?.nome : "Rede"} · ${periodoTxt}. Realizado = caixa importado ou lançado; receita abaixo e despesa acima do orçado são desvios desfavoráveis.`}
      actions={<div className="flex flex-wrap gap-2 print:hidden">{gest && <Btn href={`/financeiro/orcamento/planilha?ano=${ano}${unitId ? `&unidade=${unitId}` : ""}`}>Orçamento mês a mês</Btn>}{["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE"].includes(s.role) && <Btn kind="ghost" href={`/financeiro/orcamento/historico?ano=${ano + (ano <= anoAtual ? 1 : 0)}`}>Orçamento pelo histórico</Btn>}<Btn kind="ghost" href={`/financeiro/projecao${unitId ? `?unidade=${unitId}` : ""}`}>Caixa projetado</Btn><Btn kind="ghost" href={`/api/export/fpa?ano=${ano}&mes=${mesRef}${unitId ? `&unidade=${unitId}` : ""}`}>Exportar CSV</Btn><PrintButton /><Btn kind="ghost" href="/financeiro">Painel</Btn></div>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-4 flex flex-wrap items-end gap-2 print:hidden">
        {!scope && <Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Rede</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
        <Field label="Ano"><Input name="ano" type="number" defaultValue={ano} className="w-24" /></Field>
        <Field label="Mês de referência"><Select name="mes" defaultValue={mesRef}>{MESES_LONGOS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select></Field>
        <Field label="Visão"><Select name="visao" defaultValue={visao}><option value="acumulado">Acumulado no ano</option><option value="mes">Só o mês</option></Select></Field>
        <Btn kind="ghost">Ver</Btn>
      </form>
      {!f.temRealizado && <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-aviso">Ainda não há caixa lançado em {ano}{unitId ? " nesta unidade" : ""}: o realizado fica em branco até a importação em <Link href="/financeiro/caixa" className="underline">Fluxo de caixa</Link>.</div>}
      <div className="mb-4 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
        {cartao("Receita", "ENTRADA")}{cartao("Despesa", "SAIDA")}{cartao("Resultado", "RES")}
        <KpiCard titulo={`Resultado previsto para ${ano}`} valor={R(f.resultado.previsao)} tom={f.resultado.orcAno !== null && f.resultado.previsao !== null ? (f.resultado.previsao >= f.resultado.orcAno ? "bom" : f.resultado.previsao >= f.resultado.orcAno * 0.95 ? "atencao" : "ruim") : "neutro"} sub="realizado até o mês + orçado dos meses seguintes" meta={f.resultado.orcAno !== null ? { texto: `Resultado orçado no ano ${R(f.resultado.orcAno)}`, tom: "neutro" } : null} deltas={[variacao(f.resultado.previsao, f.resultado.orcAno, "R$") ? { texto: variacao(f.resultado.previsao, f.resultado.orcAno, "R$")!.texto, rotulo: "vs. orçado no ano", bom: (f.resultado.previsao ?? 0) >= (f.resultado.orcAno ?? 0) } : null]} />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><Stat label={`Margem ${visao === "mes" ? "do mês" : "no ano"}`} value={f.tot[rc].ENTRADA ? fmtPct(100 * (f.resultado[rc] ?? 0) / f.tot[rc].ENTRADA!, 1) : "—"} hint={f.tot[oc].ENTRADA ? `orçada ${fmtPct(100 * (f.resultado[oc] ?? 0) / f.tot[oc].ENTRADA!, 1)}` : "sem orçamento"} /><Stat label="Custo de pessoal/mês" value={R(orc.custoPessoalMensal)} hint={`${orc.colaboradores} colaboradores · +${cfg.financeiro.encargosPct}% encargos`} /><Stat label="Pessoal sobre a receita" value={orc.custoPessoalMensal && f.tot.realAcum.ENTRADA ? fmtPct(100 * orc.custoPessoalMensal / (f.tot.realAcum.ENTRADA / mesRef), 1) : "—"} hint="custo de pessoal ÷ receita média mensal do ano" /><Stat label="Custo por aluno/mês" value={brl(orc.custoPorAlunoMensal)} hint={`${orc.alunos} alunos atuais`} /></div>

      <Card title={`DRE gerencial — ${periodoTxt}`}>
        <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]"><table className="w-full min-w-[760px] text-left text-xs sm:text-sm">
          <thead className="bg-mist text-xs text-slate-600"><tr>{["Linha", "Orçado", "Realizado", "Desvio", `${ano - 1}`, "Previsão do ano", "Orçado no ano", ""].map((c, i) => <th key={i} className={`whitespace-nowrap px-2 py-2 font-medium ${i === 0 ? "sticky left-0 z-[1] bg-mist" : "text-right"} ${i === 7 ? "print:hidden" : ""}`}>{c}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {subtotal("Receitas", "ENTRADA")}{ent.map(linhaDre)}
            {subtotal("Despesas", "SAIDA")}{sai.map(linhaDre)}
            <tr className="bg-navy-100 font-semibold"><td className="sticky left-0 z-[1] bg-navy-100 px-2 py-2">Resultado</td><td className="px-2 py-2 text-right tabular-nums">{R(f.resultado[oc])}</td><td className={`px-2 py-2 text-right tabular-nums ${(f.resultado[rc] ?? 0) < 0 ? "text-erro" : "text-ok"}`}>{R(f.resultado[rc])}</td><td className={`px-2 py-2 text-right tabular-nums ${clsDesvio(desvio("ENTRADA", f.resultado[oc], f.resultado[rc]))}`}>{txtDesvio(desvio("ENTRADA", f.resultado[oc], f.resultado[rc]))}</td><td className="px-2 py-2 text-right tabular-nums">{R(f.resultado[ac])}</td><td className="px-2 py-2 text-right tabular-nums">{R(f.resultado.previsao)}</td><td className="px-2 py-2 text-right tabular-nums">{R(f.resultado.orcAno)}</td><td className="print:hidden" /></tr>
          </tbody>
        </table></div>
        <p className="mt-2 text-xs text-slate-500">Desvio em verde: favorável · âmbar: desfavorável até 5% · vermelho: desfavorável acima de 5%. Margem e participação no resultado ficam no gráfico de cascata. Custo de pessoal estimado pelos salários cadastrados no People (não pelo caixa).</p>
      </Card>

      {(() => { const faixa: [number, number] = [Number(cfg.orcamento.faixaMinPct) || 90, Number(cfg.orcamento.faixaMaxPct) || 105]; const itens = sai.filter(l => (l[oc] ?? 0) > 0).sort((a, b) => (b[oc] ?? 0) - (a[oc] ?? 0)); return itens.length > 0 && (
        <Card className="mt-4" title={`Execução por categoria de despesa — ${visao === "mes" ? MESES_CURTOS[mesRef - 1] : "acumulado no ano"}`} actions={<span className="text-[11px] text-slate-500">banda saudável {faixa[0]}–{faixa[1]}% do orçado</span>}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{itens.map(l => <Execucao key={l.categoria} rotulo={l.categoria} real={l[rc]} orcado={l[oc]} faixa={faixa} formato={x => fmtReais(x, true)} href={`/financeiro/lancamentos?ano=${ano}&m1=${visao === "mes" ? mesRef : 1}&m2=${mesRef}&cat=${encodeURIComponent(l.categoria)}${unitId ? `&u=${unitId}` : ""}`} />)}</div>
          <p className="mt-2 text-[11px] text-slate-500">Verde: dentro da banda · âmbar: abaixo de {faixa[0]}% (sobra que pode ser atraso de pagamento) · vermelho: acima de {faixa[1]}% — no mês encerrado, vira pedido de explicação ao responsável.</p>
        </Card>); })()}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {passos.length > 0 && <Card className="lg:col-span-2" title={`Do resultado orçado ao realizado — ${visao === "mes" ? MESES_CURTOS[mesRef - 1] : "no ano"}`}><Cascata passos={passos} formato={fmtEixo("R$")} formatoDica={x => fmtReais(x)} tamanho="inteiro" rotulo="Cascata do resultado: orçado, desvios por categoria e realizado" /><p className="mt-1 text-[11px] text-slate-500">Barras verdes somam ao resultado (receita acima ou despesa abaixo do orçado); vermelhas tiram.</p></Card>}
        <Card className="lg:col-span-2" title={`Resultado acumulado: realizado × orçado × ${ano - 1}`}><Linhas categorias={MESES_CURTOS} series={[{ nome: "Realizado", valores: acumula(f.serie.realEnt, f.serie.realSai, ateMes), cor: COR.acao }, { nome: "Orçado", valores: acumula(f.serie.orcEnt, f.serie.orcSai), cor: COR.navy, tracejada: true }, { nome: String(ano - 1), valores: acumula(f.serie.antEnt, f.serie.antSai), cor: COR.neutro, tracejada: true }]} formato={fmtEixo("R$")} formatoDica={x => fmtReais(x)} zero rotulo="Resultado acumulado no ano" tamanho="inteiro" rotuloUltimo={false} /></Card>
        <Card title="Receita mês a mês (barra) × orçado (traço)"><Colunas categorias={MESES_CURTOS} series={[{ nome: "Receita realizada", valores: f.serie.realEnt.map((x, i) => i < ateMes ? x : null), cor: COR.ok }]} marcadores={{ nome: "Orçado", valores: f.serie.orcEnt, cor: COR.navy }} linhas={[{ nome: String(ano - 1), valores: f.serie.antEnt, cor: COR.neutro, tracejada: true }]} formato={fmtEixo("R$")} formatoDica={x => fmtReais(x)} rotulo="Receita realizada e orçada por mês" /></Card>
        <Card title="Despesa mês a mês (barra) × orçado (traço)"><Colunas categorias={MESES_CURTOS} series={[{ nome: "Despesa realizada", valores: f.serie.realSai.map((x, i) => i < ateMes ? x : null), cor: COR.erro }]} marcadores={{ nome: "Orçado", valores: f.serie.orcSai, cor: COR.navy }} linhas={[{ nome: String(ano - 1), valores: f.serie.antSai, cor: COR.neutro, tracejada: true }]} formato={fmtEixo("R$")} formatoDica={x => fmtReais(x)} rotulo="Despesa realizada e orçada por mês" /></Card>
      </div>

      {unid && <Card title={`Por unidade — ${periodoTxt}`} className="mt-4">
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-xs sm:text-sm"><thead className="bg-mist text-xs text-slate-600"><tr>{["Unidade", "Receita", "% do orçado", "Despesa", "% do orçado", "Resultado", "Margem"].map((c, i) => <th key={c + i} className={`px-3 py-2 font-medium ${i ? "text-right" : ""}`}>{c}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">{unid.map(u => { const pr = pctDe(u.recReal, u.recOrc), pd = pctDe(u.desReal, u.desOrc); return (
            <tr key={u.id}><td className="px-3 py-2"><Link className="text-acao hover:underline" href={`/financeiro/orcamento?ano=${ano}&mes=${mesRef}&visao=${visao}&unidade=${u.id}`}>{u.nome}</Link></td><td className="px-3 py-2 text-right tabular-nums">{R(u.recReal)}</td><td className="px-3 py-2 text-right">{pr === null ? "—" : <Situacao tom={pr >= 100 ? "bom" : pr >= 95 ? "atencao" : "ruim"} texto={fmtPct(pr, 0)} />}</td><td className="px-3 py-2 text-right tabular-nums">{R(u.desReal)}</td><td className="px-3 py-2 text-right">{pd === null ? "—" : <Situacao tom={pd <= 100 ? "bom" : pd <= 105 ? "atencao" : "ruim"} texto={fmtPct(pd, 0)} />}</td><td className={`px-3 py-2 text-right tabular-nums ${(u.resReal ?? 0) < 0 ? "text-erro" : ""}`}>{R(u.resReal)}</td><td className="px-3 py-2 text-right tabular-nums">{u.recReal ? fmtPct(100 * (u.resReal ?? 0) / u.recReal, 1) : "—"}</td></tr>); })}</tbody></table></div>
      </Card>}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
        <Card title={`Desvios fora da banda (${relevantes.length})`}>
          <p className="mb-2 text-[11px] text-slate-500">Desfavoráveis no recorte: despesa acima de {bandaMax}% do orçado ou receita abaixo de {bandaMin}%, e acima de R$ 1 mil — a mesma banda dos donuts e dos pedidos de explicação.</p>
          {relevantes.length === 0 ? <p className="text-sm text-slate-500">Nenhum desvio desfavorável fora da banda no recorte.</p> : <ul className="space-y-2 text-sm">{relevantes.slice(0, 10).map(({ l, d }) => <li key={l.tipo + l.categoria} className="flex flex-wrap items-baseline justify-between gap-2"><span className="min-w-0"><b>{l.categoria}</b> <span className="text-xs text-slate-500">{l.tipo === "ENTRADA" ? "receita" : "despesa"}</span></span><span className={`tabular-nums ${TOM_TXT[d!.tom]}`}>{d!.abs >= 0 ? "+" : "−"}{R(Math.abs(d!.abs))}{d!.pct !== null ? ` (${d!.pct >= 0 ? "+" : "−"}${fmtPct(Math.abs(d!.pct), 0)})` : ""}</span><span className="w-full text-xs">{l.comentarios ? <span className="text-ok">explicado ({l.comentarios})</span> : <span className="text-aviso">sem explicação — use “explicar” na linha da DRE</span>}</span></li>)}</ul>}
        </Card>
        <Card title={`Pedidos de explicação ${ano} (${pedidos.filter(p => p.status === "ABERTA").length} em aberto)`} className="scroll-mt-20" actions={gest ? <form action={gerarPedidos} className="print:hidden"><input type="hidden" name="ano" value={ano} /><input type="hidden" name="mes" value={mesRef} /><input type="hidden" name="voltar" value={voltar} /><Btn small kind="ghost">Gerar pedidos de {MESES_CURTOS[mesRef - 1]}</Btn></form> : null}>
          <div id="explicacoes" />
          {pedidos.length === 0 ? <p className="text-sm text-slate-500">Nenhum pedido: quando um mês fecha com categoria acima de {Number(cfg.orcamento.faixaMaxPct) || 105}% do orçado, o responsável recebe o pedido aqui e em Minhas pendências.</p> : <ul className="divide-y divide-line text-sm">{pedidos.slice(0, 20).map(p => <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5"><span className="min-w-0"><b>{p.categoria}</b> · {p.unidade ?? "Rede"} · {MESES_CURTOS[p.mes - 1]}/{p.ano}<span className="block text-[11px] text-slate-500">{p.executado_pct !== null ? `${fmtPct(p.executado_pct, 0)} do orçado` : ""} · responsável: {p.responsavel ?? "sem responsável (defina em Configurações › Orçamento)"}</span></span>{p.status === "ABERTA" ? <Link className="text-xs font-medium text-acao" href={`/financeiro/orcamento?ano=${p.ano}&mes=${p.mes}&visao=mes&unidade=${p.escopo}`}>explicar →</Link> : <Situacao tom="bom" texto={`respondido ${p.respondida_em ? fmtDataHora(p.respondida_em).slice(0, 10) : ""}`} />}</li>)}</ul>}
        </Card>
        <Card title="Explicações registradas no ano">
          {explic.length === 0 ? <p className="text-sm text-slate-500">Nenhuma explicação registrada.</p> : <ul className="space-y-3">{explic.slice(0, 15).map(x => <li key={x.id} className="border-l-2 border-amber-300 pl-3 text-sm"><div className="text-[11px] text-slate-500">{MESES_CURTOS[x.mes - 1]}/{ano} · {x.categoria} · {x.unidade ?? "Rede"} · {x.user_nome} · {fmtDataHora(x.created_at)}</div><div className="whitespace-pre-line">{x.texto}</div>{(x.user_id === s.id || s.role === "DIRECAO") && <form action={removerExplicacao} className="print:hidden"><input type="hidden" name="id" value={x.id} /><input type="hidden" name="voltar" value={voltar} /><button className="text-[11px] text-erro hover:underline">remover</button></form>}</li>)}</ul>}
        </Card>
      </div>

      {gest && <details className="mt-4 rounded-md border border-line bg-white print:hidden"><summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-navy">Orçamento mensal (valor fixo por mês) — atalho</summary>
        <div className="border-t border-line p-4"><form action={salvarOrcamento} className="space-y-2"><input type="hidden" name="ano" value={ano} /><Field label="Unidade"><Select name="unitId" defaultValue={unitId ?? units[0]?.id ?? ""} required>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2"><div><div className="text-xs font-medium text-slate-600">Receitas (valor mensal previsto)</div>{(cfg.financeiro.categoriasEntrada as string[]).map((c, i) => <div key={c} className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-2 text-xs"><span>{c}<input type="hidden" name={`c_ENTRADA_${i}`} value={c} /></span><Input name={`b_ENTRADA_${i}`} type="number" step="0.01" className="!py-1 !text-xs" defaultValue={orc.cats.find(x => x.tipo === "ENTRADA" && x.categoria === c && unitId !== null)?.previstoMensal ?? ""} /></div>)}</div>
            <div><div className="text-xs font-medium text-slate-600">Despesas (valor mensal previsto)</div>{(cfg.financeiro.categoriasSaida as string[]).map((c, i) => <div key={c} className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-2 text-xs"><span>{c}<input type="hidden" name={`c_SAIDA_${i}`} value={c} /></span><Input name={`b_SAIDA_${i}`} type="number" step="0.01" className="!py-1 !text-xs" defaultValue={orc.cats.find(x => x.tipo === "SAIDA" && x.categoria === c && unitId !== null)?.previstoMensal ?? ""} /></div>)}</div></div>
          <Btn small>Salvar orçamento</Btn><p className="text-xs text-slate-500">Uma unidade por vez; linhas em branco não mudam. Para valores diferentes mês a mês (13º, material em janeiro, campanhas), use o Orçamento mês a mês — ele prevalece sobre este valor fixo.</p></form></div>
      </details>}
    </Page>
  );
}
