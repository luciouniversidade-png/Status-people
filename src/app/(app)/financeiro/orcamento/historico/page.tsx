import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { sql } from "@/db";
import { requireSession, scopeUnit } from "@/lib/auth";
import { Page, Card, Flash, Stat, Table, Td, Field, Select, Input, Textarea, Btn, Badge } from "@/components/ui";
import { Colunas, Linhas, BarrasH, COR } from "@/components/graficos";
import { audit, getSettings, hoje, fmtData, addDays } from "@/lib/utils";
import { fmtCompacto, MESES_CURTOS } from "@/lib/formato";
import { vePlano, editaPlano, aprovaRateio, qualidadeClassificacao } from "@/lib/plano-contas";
import { listarRegras, regraVigente } from "@/lib/rateio";
import { ROTULO_BASE } from "@/lib/rateio-calc";
import { macrogrupo, ROTULO_INDICE, ROTULO_DRIVER } from "@/lib/plano-contas-calc";
import { orcamentoPeloHistorico, anoPadrao, type OrcHistorico } from "@/lib/orcamento-historico";
import { VERSOES, ROTULO_VERSAO, SINAIS, ROTULO_SINAL, ROTULO_DECISAO, porCategoria, rotuloMes, type Versao, type Sinal, type LinhaProj } from "@/lib/orcamento-historico-calc";
import { pedidosExplicacao } from "@/lib/orcamento-v24";
import { decidirSinais, aceitarSugestoes, salvarParametros, aplicarVersao } from "./actions";

export const dynamic = "force-dynamic";
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brl0 = (v: number | null | undefined) => (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pct = (v: number | null | undefined, casas = 1) => v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: casas })}%`;
const var_ = (a: number, b: number) => b > 0 ? (100 * (a - b)) / b : null;
const sinalTxt = (v: number | null) => v === null ? "—" : `${v >= 0 ? "+" : "−"}${pct(Math.abs(v))}`;
const n2 = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const ETAPAS = [
  { k: "higienizar", n: 1, rotulo: "Higienizar a base", dica: "duplicidades, estornos, transferências, dívida, investimentos e picos" },
  { k: "classificar", n: 2, rotulo: "Classificar e ratear", dica: "conta, centro de custo e critério de rateio aprovado" },
  { k: "projetar", n: 3, rotulo: "Projetar os custos", dica: "volume × preço × calendário, matrículas e contratos" },
  { k: "governar", n: 4, rotulo: "Governar o orçamento", dica: "versões, aplicação, tolerâncias e revisão mensal" },
] as const;
type Etapa = typeof ETAPAS[number]["k"];
const TOM_SINAL: Record<Sinal, string> = { DUPLICADO: "REJEITADO", ESTORNO: "REJEITADO", INVESTIMENTO: "ABERTO", EXTRAORDINARIO: "PENDENTE", FORA_DO_PADRAO: "PENDENTE", EVENTO: "EM_AQUISICAO" };

/** v28 · Do histórico ao orçamento do ano (catálogo: higienizar → classificar e ratear → projetar → governar). */
export default async function OrcamentoHistorico({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams;
  if (!vePlano(s)) { await audit(s, "acesso negado: orçamento pelo histórico", "budget_plans", null, null, { papel: s.role }); redirect("/financeiro"); }
  const cfg = await getSettings(); const escopo = scopeUnit(s); const h = hoje(); const anoAtual = Number(h.slice(0, 4));
  const ano = Number(sp.ano) >= anoAtual - 1 && Number(sp.ano) <= anoAtual + 2 ? Number(sp.ano) : anoPadrao(h);
  const etapa: Etapa = (ETAPAS.find(e => e.k === sp.etapa)?.k ?? "higienizar") as Etapa;
  const r = await orcamentoPeloHistorico(ano, escopo === null ? null : [escopo]);
  const unidadeSel = escopo ?? (sp.unidade && r.unidades.some(u => u.id === Number(sp.unidade)) ? Number(sp.unidade) : null);
  const nomeUnidade = new Map(r.unidades.map(u => [u.id, u.nome]));
  const versao: Versao = VERSOES.includes(sp.versao as Versao) ? (sp.versao as Versao) : ((r.plano?.versao_aplicada as Versao | null) ?? "BASE");
  const edita = editaPlano(cfg, s); const aplica = aprovaRateio(s);
  const fimBaseDia = addDays(r.fimBaseExcl, -1); const visiveis = unidadeSel ? [unidadeSel] : r.unidades.map(u => u.id);
  const [qual, regras] = await Promise.all([qualidadeClassificacao(unidadeSel ? [unidadeSel] : escopo === null ? null : [escopo], r.iniBase, fimBaseDia), listarRegras()]);
  const vigente = regraVigente(regras, h.slice(0, 7)); const regrasPend = regras.filter(x => x.status === "RASCUNHO").length;
  const tot = (v: Versao) => unidadeSel ? r.versoes[v].tot.porUnidade.get(unidadeSel)! : r.versoes[v].tot.rede;
  const sinaisVis = r.sinais.filter(x => visiveis.includes(x.mov.unit_id)); const pend = sinaisVis.filter(x => !x.decisao);
  const qsBase = (extra: Record<string, string | number | null | undefined>) => { const q = new URLSearchParams({ ano: String(ano), etapa }); if (unidadeSel && escopo === null) q.set("unidade", String(unidadeSel)); for (const [k, v] of Object.entries(extra)) { if (v === null || v === undefined || v === "") q.delete(k); else q.set(k, String(v)); } return `/financeiro/orcamento/historico?${q}`; };
  const statusEtapa: Record<Etapa, string> = {
    higienizar: pend.length ? `${pend.length} sinal(is) para decidir` : sinaisVis.length ? "sinais decididos" : "nada a revisar",
    classificar: qual.pctSemConta === null ? "sem saídas na base" : `${pct(100 - qual.pctSemConta, 0)} das saídas com conta`,
    projetar: `resultado ${ROTULO_VERSAO[versao].toLowerCase()}: ${brl0(tot(versao).resultado)}`,
    governar: r.plano?.status === "APLICADO" ? `aplicado: versão ${ROTULO_VERSAO[(r.plano.versao_aplicada ?? "BASE") as Versao].toLowerCase()}` : "rascunho — aplicar",
  };
  const titulo = `Orçamento ${ano} pelo histórico`;
  return (
    <Page title={titulo} sub={<>Base de 12 meses de caixa: <b>{rotuloMes(r.meses[0])} a {rotuloMes(r.meses[11])}</b> (por unidade que paga, como o orçado × realizado). Do histórico ao orçamento em quatro passos — o que for decidido aqui fica na trilha de auditoria.</>}
      actions={<><Btn kind="ghost" href={`/financeiro/orcamento?ano=${ano}`}>Orçado × realizado</Btn><Btn kind="ghost" href={`/financeiro/orcamento/planilha?ano=${ano}`}>Planilha mês a mês</Btn><Btn kind="ghost" href={`/api/export/orcamento-historico?ano=${ano}&versao=${versao}${unidadeSel ? `&unidade=${unidadeSel}` : ""}`}>Exportar memória</Btn></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-3 flex flex-wrap items-end gap-2 text-sm" action="/financeiro/orcamento/historico">
        <input type="hidden" name="etapa" value={etapa} />
        <Field label="Ano do orçamento"><Select name="ano" defaultValue={String(ano)}>{[anoAtual - 1, anoAtual, anoAtual + 1, anoAtual + 2].map(a => <option key={a} value={a}>{a}</option>)}</Select></Field>
        {escopo === null && <Field label="Unidade"><Select name="unidade" defaultValue={unidadeSel ? String(unidadeSel) : ""}><option value="">Rede (todas)</option>{r.unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
        {(etapa === "projetar" || etapa === "governar") && <Field label="Versão"><Select name="versao" defaultValue={versao}>{VERSOES.map(v => <option key={v} value={v}>{ROTULO_VERSAO[v]}</option>)}</Select></Field>}
        <Btn small kind="ghost">Ver</Btn>
      </form>
      <nav aria-label="Passos do orçamento" className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {ETAPAS.map(e => <Link key={e.k} href={qsBase({ etapa: e.k })} className={`rounded-md border px-3 py-2 ${etapa === e.k ? "border-acao bg-sky-50" : "border-line bg-white hover:bg-mist"}`} aria-current={etapa === e.k ? "step" : undefined}>
          <div className="flex items-center gap-2"><span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${etapa === e.k ? "bg-acao text-white" : "bg-mist text-navy"}`}>{e.n}</span><span className="text-sm font-semibold text-navy">{e.rotulo}</span></div>
          <div className="mt-0.5 text-[11px] text-slate-600">{statusEtapa[e.k]}</div></Link>)}
      </nav>
      {etapa === "higienizar" && <Higienizar r={r} sp={sp} ano={ano} edita={edita} visiveis={visiveis} unidadeSel={unidadeSel} escopo={escopo} nomeUnidade={nomeUnidade} qsBase={qsBase} />}
      {etapa === "classificar" && <Classificar r={r} qual={qual} vigente={vigente} regrasPend={regrasPend} fimBaseDia={fimBaseDia} unidadeSel={unidadeSel} />}
      {etapa === "projetar" && <Projetar r={r} ano={ano} versao={versao} edita={edita} unidadeSel={unidadeSel} escopo={escopo} nomeUnidade={nomeUnidade} visiveis={visiveis} tot={tot} />}
      {etapa === "governar" && <Governar r={r} s={s} cfg={cfg} ano={ano} versao={versao} aplica={aplica} tot={tot} unidadeSel={unidadeSel} />}
    </Page>
  );
}

// ---------------------------------------------------------------- 1. Higienizar
function Higienizar({ r, sp, ano, edita, visiveis, unidadeSel, escopo, nomeUnidade, qsBase }: { r: OrcHistorico; sp: Record<string, string | undefined>; ano: number; edita: boolean; visiveis: number[]; unidadeSel: number | null; escopo: number | null; nomeUnidade: Map<number, string>; qsBase: (e: Record<string, string | number | null | undefined>) => string }) {
  const todos = r.sinais.filter(x => visiveis.includes(x.mov.unit_id));
  const filtro = SINAIS.includes(sp.sinal as Sinal) ? (sp.sinal as Sinal) : null;
  const pendentes = todos.filter(x => !x.decisao);
  const situacao = sp.situacao === "decididos" || sp.situacao === "todos" ? sp.situacao : pendentes.length ? "pendentes" : "todos";
  const lista = todos.filter(x => (!filtro || x.sinal === filtro) && (situacao === "todos" || (situacao === "pendentes" ? !x.decisao : !!x.decisao)));
  const mostra = lista.slice(0, 200);
  const anos = [...new Set(r.historico.map(x => x.ano))].sort();
  const linhaAno = (a: number) => { const xs = r.historico.filter(x => x.ano === a); const sum = (f: (x: typeof xs[number]) => boolean) => xs.filter(f).reduce((s, x) => s + x.v, 0); const n = xs.reduce((s, x) => s + x.n, 0); const cc = xs.reduce((s, x) => s + x.com_conta, 0);
    return { a, ent: sum(x => x.tipo === "ENTRADA" && !x.fora), sai: sum(x => x.tipo === "SAIDA" && !x.fora), fora: sum(x => x.fora), nFora: xs.filter(x => x.fora).reduce((s, x) => s + x.n, 0), n, pctConta: n ? (100 * cc) / n : null, meses: Math.max(0, ...xs.map(x => x.meses)) }; };
  const efeitoPend = pendentes.reduce((s, x) => s + (x.sugestao === "FORA" ? x.mov.valor : x.sugestao === "NORMALIZAR" && x.mediana !== null ? Math.max(0, x.mov.valor - x.mediana) : 0), 0);
  const porSinal = SINAIS.map(k => ({ k, n: todos.filter(x => x.sinal === k).length, p: pendentes.filter(x => x.sinal === k).length })).filter(x => x.n > 0);
  const contaTxt = (id: number | null, cat: string) => { const c = id ? r.contas.get(id) : undefined; return c ? `${c.codigo} ${c.nome}` : `${cat} (sem conta)`; };
  return (<>
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      <Stat label="Lançamentos na base" value={r.movsBase.toLocaleString("pt-BR")} hint={`${rotuloMes(r.meses[0])} a ${rotuloMes(r.meses[11])}`} />
      <Stat label="Saídas na base" value={brl(r.saidasBase)} hint={`entradas ${brl0(r.entradasBase)}`} />
      <Stat label="Fora automaticamente" value={r.nAutoBase.toLocaleString("pt-BR")} hint="transferências, dívida e adiantamentos" />
      <Stat label="Sinais" value={`${pendentes.length} de ${todos.length}`} hint="pendentes de decisão" />
      <Stat label="Efeito na base" value={<span className="text-aviso">−{brl0(r.base.resumo.foraDecidido + r.base.resumo.normalizado)}</span>} hint={`fora ${brl0(r.base.resumo.foraDecidido)} · normalizado ${brl0(r.base.resumo.normalizado)}${pendentes.length ? " (com sugestões pendentes)" : ""}`} />
    </div>
    <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card title={`Reunir ${anos[0] ?? ano - 3}–${anos[anos.length - 1] ?? ano - 1}`} className="lg:col-span-2">
        <Table head={["Ano", "Entradas", "Saídas", { label: "Fora da base", className: "hidden sm:table-cell" }, { label: "Lançamentos", className: "hidden md:table-cell" }, { label: "Com conta", className: "hidden md:table-cell" }, "Meses"]} empty="Sem caixa lançado nos últimos três anos.">
          {anos.map(a => { const x = linhaAno(a); return <tr key={a}><Td className="font-medium">{a}</Td><Td className="whitespace-nowrap tabular-nums" >{`R$ ${fmtCompacto(x.ent)}`}</Td><Td className="whitespace-nowrap tabular-nums">{`R$ ${fmtCompacto(x.sai)}`}</Td><Td className="hidden whitespace-nowrap tabular-nums text-slate-600 sm:table-cell">{x.fora ? `R$ ${fmtCompacto(x.fora)}` : "—"} <span className="text-[11px]">({x.nFora})</span></Td><Td className="hidden tabular-nums md:table-cell">{x.n.toLocaleString("pt-BR")}</Td><Td className="hidden tabular-nums md:table-cell">{pct(x.pctConta, 0)}</Td><Td className="tabular-nums">{x.meses}</Td></tr>; })}
        </Table>
        <p className="mt-2 text-[11px] text-slate-500">A projeção usa os 12 meses da base; os 12 anteriores servem para achar pares (estornos) e separar o que é sazonal (o mesmo mês do ano anterior) do que é pico. Mude o fim da base em “Projetar os custos › Parâmetros”.</p>
      </Card>
      <Card title="Fora da base automaticamente">
        {r.auto.size === 0 ? <p className="text-sm text-slate-500">Nada: a base não tem transferências, principal de dívida nem adiantamentos.</p> :
          <ul className="space-y-1.5 text-sm">{[...r.auto.entries()].sort((a, b) => b[1].v - a[1].v).map(([k, x]) => <li key={k} className="flex justify-between gap-2"><span>{k}</span><span className="whitespace-nowrap tabular-nums text-slate-600">{x.n} · {brl0(x.v)}</span></li>)}</ul>}
        <p className="mt-2 text-[11px] text-slate-500">Saem do caixa, mas não são custo do ano: movimentos entre unidades e contas, principal de empréstimos (os juros ficam) e adiantamentos.</p>
      </Card>
    </div>
    <Card title={`Sinais para decidir (${lista.length})`} className="mb-4" actions={edita && pendentes.length > 0 ? <form action={aceitarSugestoes}><input type="hidden" name="ano" value={ano} /><input type="hidden" name="etapa" value="higienizar" />{filtro && <input type="hidden" name="sinal" value={filtro} />}{unidadeSel && escopo === null && <input type="hidden" name="unidade" value={unidadeSel} />}<Btn small kind="ghost">Aceitar as {filtro ? pendentes.filter(x => x.sinal === filtro).length : pendentes.length} sugestões pendentes</Btn></form> : undefined}>
      <div id="sinais" className="mb-3 flex flex-wrap gap-1.5 text-xs">
        <Link href={qsBase({ sinal: null })} className={`rounded-full border px-2.5 py-1 ${!filtro ? "border-acao bg-sky-50 text-navy" : "border-line text-slate-600"}`}>Todos ({todos.length})</Link>
        {porSinal.map(x => <Link key={x.k} href={qsBase({ sinal: x.k })} title={ROTULO_SINAL[x.k].dica} className={`rounded-full border px-2.5 py-1 ${filtro === x.k ? "border-acao bg-sky-50 text-navy" : "border-line text-slate-600"}`}>{ROTULO_SINAL[x.k].rotulo} ({x.p ? `${x.p}/` : ""}{x.n})</Link>)}
        <span className="mx-1 self-center text-slate-400">·</span>
        {(["pendentes", "decididos", "todos"] as const).map(k => <Link key={k} href={qsBase({ sinal: filtro, situacao: k })} className={`rounded-full border px-2.5 py-1 ${situacao === k ? "border-navy bg-mist text-navy" : "border-line text-slate-600"}`}>{k === "pendentes" ? "Pendentes" : k === "decididos" ? "Decididos" : "Todos"}</Link>)}
      </div>
      {todos.length === 0 ? <p className="text-sm text-slate-600">Nenhum sinal na base: sem duplicidades, estornos, investimentos, gastos extraordinários, picos fora do padrão ou eventos acima de {brl0(r.params.eventoMinimo)}.</p> : <form action={decidirSinais}>
        <input type="hidden" name="ano" value={ano} /><input type="hidden" name="etapa" value="higienizar" />{filtro && <input type="hidden" name="sinal" value={filtro} />}<input type="hidden" name="situacao" value={situacao} />{unidadeSel && escopo === null && <input type="hidden" name="unidade" value={unidadeSel} />}
        <Table head={["", "Lançamento", { label: "Conta", className: "hidden md:table-cell" }, { label: "Valor", className: "hidden sm:table-cell" }, { label: "Sinal", className: "hidden sm:table-cell" }, { label: "Sugestão", className: "hidden md:table-cell" }, { label: "Decisão", className: "hidden sm:table-cell" }]} empty="Nada com este filtro.">
          {mostra.map(x => <tr key={x.id}>
            <Td>{edita && <><input type="checkbox" name="id" value={x.id} aria-label={`Selecionar lançamento ${x.id}`} className="h-4 w-4" /><input type="hidden" name={`sinal_${x.id}`} value={x.sinal} /></>}</Td>
            <Td><Link href={`/financeiro/lancamentos/${x.id}`} className="font-medium text-acao">{fmtData(x.mov.data)}</Link><div className="text-[11px] text-slate-600">{nomeUnidade.get(x.mov.unit_id)} · {x.mov.tipo === "ENTRADA" ? "entrada" : "saída"}</div><div className="max-w-[16rem] truncate text-xs text-slate-700">{x.mov.contraparte || x.mov.descricao || "—"}</div><div className="text-[11px] text-slate-500 md:hidden">{contaTxt(x.mov.conta_id, x.mov.categoria)}</div>
              <div className="mt-1 sm:hidden"><div className="font-medium tabular-nums">{brl(x.mov.valor)}{x.mediana !== null && <span className="text-[11px] font-normal text-slate-500"> · mediana {brl(x.mediana)}</span>}</div><Badge v={TOM_SINAL[x.sinal]} label={ROTULO_SINAL[x.sinal].rotulo} /><div className="mt-0.5 text-[11px] text-slate-600">{x.motivo}</div><div className="text-[11px]">{x.decisao ? <b>{ROTULO_DECISAO[x.decisao.decisao]}</b> : <span className="text-aviso">pendente — vale “{ROTULO_DECISAO[x.sugestao].toLowerCase()}”</span>}</div></div></Td>
            <Td className="hidden max-w-[14rem] text-xs md:table-cell">{contaTxt(x.mov.conta_id, x.mov.categoria)}</Td>
            <Td className="hidden whitespace-nowrap tabular-nums sm:table-cell">{brl(x.mov.valor)}{x.mediana !== null && <div className="text-[11px] text-slate-500">mediana {brl(x.mediana)}</div>}</Td>
            <Td className="hidden sm:table-cell"><Badge v={TOM_SINAL[x.sinal]} label={ROTULO_SINAL[x.sinal].rotulo} /><div className="mt-0.5 max-w-[18rem] text-[11px] text-slate-600">{x.motivo}</div></Td>
            <Td className="hidden text-xs md:table-cell">{ROTULO_DECISAO[x.sugestao]}</Td>
            <Td className="hidden text-xs sm:table-cell">{x.decisao ? <><b>{ROTULO_DECISAO[x.decisao.decisao]}</b><div className="text-[11px] text-slate-500">{x.decisao.user_nome ?? "—"} · {fmtData(x.decisao.decidido_em.slice(0, 10))}</div>{x.decisao.motivo && <div className="text-[11px] text-slate-500">{x.decisao.motivo}</div>}</> : <span className="text-aviso">pendente — vale a sugestão</span>}</Td>
          </tr>)}
        </Table>
        {lista.length > mostra.length && <p className="mt-2 text-xs text-slate-500">Mostrando os 200 maiores de {lista.length}. Filtre por tipo de sinal para ver os demais.</p>}
        {edita && <div className="mt-3 flex flex-wrap items-end gap-2"><Field label="Motivo (opcional)" className="min-w-[14rem] flex-1"><Input name="motivo" maxLength={300} placeholder="Ex.: pagamento em dobro, estornado pelo banco" /></Field>
          <Btn small name="decisao" value="FORA">Tirar da base</Btn><Btn small kind="ghost" name="decisao" value="MANTER">Manter</Btn><Btn small kind="ghost" name="decisao" value="NORMALIZAR">Normalizar pela mediana</Btn><Btn small kind="ghost" name="decisao" value="SUGESTAO">Voltar à sugestão</Btn></div>}
      </form>}
      <ul className="mt-3 grid grid-cols-1 gap-1 text-[11px] text-slate-500 sm:grid-cols-2">{SINAIS.map(k => <li key={k}><b className="text-slate-600">{ROTULO_SINAL[k].rotulo}:</b> {ROTULO_SINAL[k].dica}.</li>)}</ul>
      {pendentes.length > 0 && <p className="mt-2 text-xs text-slate-600">Enquanto não houver decisão, a projeção usa a sugestão do sistema (efeito das pendentes: −{brl0(efeitoPend)}).</p>}
    </Card>
  </>);
}

// ---------------------------------------------------------------- 2. Classificar e ratear
function Classificar({ r, qual, vigente, regrasPend, fimBaseDia, unidadeSel }: { r: OrcHistorico; qual: Awaited<ReturnType<typeof qualidadeClassificacao>>; vigente: Awaited<ReturnType<typeof listarRegras>>[number] | null; regrasPend: number; fimBaseDia: string; unidadeSel: number | null }) {
  const comConta = qual.pctSemConta === null ? null : 100 - qual.pctSemConta; const comCentro = qual.pctSemCentro === null ? null : 100 - qual.pctSemCentro;
  const itens = [
    { ok: comConta !== null && comConta >= 90, titulo: `Saídas da base com conta do plano: ${pct(comConta, 0)}`, texto: "A conta define o reajuste (dissídio, IPCA, mensalidade) e o que varia com alunos ou receita. Sem conta, vale o mais comum da categoria.", href: `/financeiro/plano-de-contas?aba=classificacao&de=${r.iniBase}&ate=${fimBaseDia}${unidadeSel ? `&unidade=${unidadeSel}` : ""}`, acao: "Classificar a base" },
    { ok: qual.pctGenerica !== null && qual.pctGenerica <= qual.meta, titulo: `Conta genérica: ${pct(qual.pctGenerica, 1)} (meta até ${qual.meta}%)`, texto: "“Outras despesas” esconde o que mudou de um ano para outro: prefira a conta específica.", href: `/financeiro/plano-de-contas?aba=classificacao&generica=1&de=${r.iniBase}&ate=${fimBaseDia}`, acao: "Revisar genéricas" },
    { ok: !!vigente, titulo: vigente ? `Rateio aprovado: ${vigente.nome} (${ROTULO_BASE[vigente.base]})` : "Sem critério de rateio aprovado", texto: regrasPend ? `${regrasPend} regra(s) aguardando a Direção.` : "O corporativo (contabilidade, sistemas, mídia, direção geral) é rateado pela regra aprovada no resultado por unidade.", href: "/financeiro/rateio#regras", acao: "Ver rateio" },
    { ok: comCentro !== null && comCentro >= 70, titulo: `Com centro de custo: ${pct(comCentro, 0)}`, texto: "Sem centro, o gasto fica na unidade que pagou; o centro corporativo vai para o rateio; o de outra unidade leva o gasto para a beneficiária.", href: "/financeiro/plano-de-contas?aba=centros", acao: "Centros de custo" },
  ];
  return (<>
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat label="Saídas da base" value={brl(qual.saidas)} hint={`${qual.n.toLocaleString("pt-BR")} lançamentos`} />
      <Stat label="Sem conta" value={<span className={qual.nSemConta ? "text-aviso" : "text-ok"}>{qual.nSemConta.toLocaleString("pt-BR")}</span>} hint={brl0(qual.semConta)} />
      <Stat label="Em conta genérica" value={pct(qual.pctGenerica, 1)} hint={`meta até ${qual.meta}%`} />
      <Stat label="Com centro de custo" value={pct(comCentro, 0)} hint="o resto fica na unidade que pagou" />
    </div>
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title="Pronto para projetar?">
        <ul className="space-y-3">{itens.map((x, i) => <li key={i} className="flex gap-3"><span aria-hidden className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${x.ok ? "bg-emerald-100 text-ok" : "bg-amber-100 text-aviso"}`}>{x.ok ? "✓" : "!"}</span>
          <div className="min-w-0"><div className="text-sm font-medium text-navy">{x.titulo}</div><p className="text-xs text-slate-600">{x.texto}</p><Link href={x.href} className="text-xs text-acao underline">{x.acao}</Link></div></li>)}</ul>
        <p className="mt-3 text-[11px] text-slate-500">Nada aqui bloqueia a projeção: o que estiver sem conta é projetado pela categoria. Quanto melhor a classificação, melhor a memória do orçamento por conta.</p>
      </Card>
      <Card title="Peso de cada macrogrupo nas saídas da base">
        {qual.porMacrogrupo.length ? <BarrasH rotulo="Saídas da base por macrogrupo" itens={qual.porMacrogrupo.map(m => ({ rotulo: `${m.codigo} ${m.nome}`, valor: m.valor, texto: `${brl0(m.valor)} · ${m.n}` }))} formato={v => fmtCompacto(v)} largRotulo="11rem" /> : <p className="text-sm text-slate-500">Nenhuma saída classificada na base ainda.</p>}
        {qual.contrapartes.length > 0 && <><h3 className="mb-1 mt-4 text-xs font-semibold text-slate-600">Maiores contrapartes sem conta</h3><ul className="space-y-1 text-xs">{qual.contrapartes.map(c => <li key={c.contraparte} className="flex justify-between gap-2"><span className="truncate">{c.contraparte}</span><span className="whitespace-nowrap tabular-nums text-slate-600">{c.n} · {brl0(c.valor)}</span></li>)}</ul></>}
      </Card>
    </div>
  </>);
}

// ---------------------------------------------------------------- 3. Projetar
type Agg = { chave: string; tipo: "ENTRADA" | "SAIDA"; conta_id: number | null; categoria: string; bruto: number; limpo: number; nivelado: number; comPreco: number; total: number; piso: number; meses: number[]; indice: string; driver: string; avisos: Set<string>; origem: Set<string>; estimados: number; removido: number; normalizado: number; unidades: number };
function agrupar(linhas: LinhaProj[]): Agg[] {
  const m = new Map<string, Agg>();
  for (const l of linhas) {
    const k = l.conta_id ? `c${l.conta_id}` : `k${l.tipo}|${l.categoria}`;
    const a = m.get(k) ?? { chave: k, tipo: l.tipo, conta_id: l.conta_id, categoria: l.categoria, bruto: 0, limpo: 0, nivelado: 0, comPreco: 0, total: 0, piso: 0, meses: Array(12).fill(0), indice: l.attr.indice, driver: l.attr.driver, avisos: new Set<string>(), origem: new Set<string>(), estimados: 0, removido: 0, normalizado: 0, unidades: 0 };
    a.bruto += l.bruto; a.limpo += l.limpo; a.nivelado += l.nivelado; a.comPreco += l.nivelado * l.fatorPreco; a.total += l.total; a.piso += l.acrescimoPiso; a.estimados += l.estimados; a.removido += l.removido; a.normalizado += l.normalizado; a.unidades++;
    l.meses.forEach((v, i) => { a.meses[i] += v; }); l.avisos.forEach(x => a.avisos.add(x)); l.piso?.origem.forEach(x => a.origem.add(x)); m.set(k, a);
  }
  return [...m.values()];
}
function Projetar({ r, ano, versao, edita, unidadeSel, escopo, nomeUnidade, visiveis, tot }: { r: OrcHistorico; ano: number; versao: Versao; edita: boolean; unidadeSel: number | null; escopo: number | null; nomeUnidade: Map<number, string>; visiveis: number[]; tot: (v: Versao) => ReturnType<OrcHistorico["versoes"]["BASE"]["tot"]["porUnidade"]["get"]> & object }) {
  const p = r.params; const ver = r.versoes[versao];
  const linhasVis = ver.linhas.filter(l => visiveis.includes(l.unit_id));
  const porId = new Map(r.contasAll.map(c => [c.id, c]));
  const ag = agrupar(linhasVis).filter(a => a.total > 0 || a.limpo > 0 || a.bruto > 0);
  // receitas (plano, depois sem conta), saídas pelos macrogrupos 1…9, saídas sem conta por último
  const macro = (a: Agg) => { if (!a.conta_id) return { k: `~${a.tipo}`, rot: a.tipo === "ENTRADA" ? "Receitas sem conta (pela categoria)" : "Saídas sem conta (pela categoria)", ord: a.tipo === "ENTRADA" ? "0~" : "2~" }; const c = porId.get(a.conta_id); if (!c) return { k: "~?", rot: "Outras", ord: "3~" }; const g = macrogrupo(c, porId); return { k: g.codigo, rot: `${g.codigo} ${g.nome}`, ord: g.tipo === "ENTRADA" ? `0-${g.codigo}` : `1-${g.codigo.padStart(3, "0")}` }; };
  const grupos = new Map<string, { rot: string; ord: string; itens: Agg[] }>();
  for (const a of ag) { const m = macro(a); const g = grupos.get(m.k) ?? { rot: m.rot, ord: m.ord, itens: [] }; g.itens.push(a); grupos.set(m.k, g); }
  const ordGr = [...grupos.values()].sort((a, b) => a.ord < b.ord ? -1 : a.ord > b.ord ? 1 : 0);
  const contaRot = (a: Agg) => { const c = a.conta_id ? porId.get(a.conta_id) : undefined; return c ? `${c.codigo} ${c.nome}` : a.categoria; };
  // resultado mensal das três versões
  const mensal = (v: Versao) => { const ls = r.versoes[v].linhas.filter(l => visiveis.includes(l.unit_id)); return Array.from({ length: 12 }, (_, i) => ls.reduce((s, l) => s + (l.tipo === "ENTRADA" ? 1 : -1) * l.meses[i], 0)); };
  const recMes = Array.from({ length: 12 }, (_, i) => linhasVis.filter(l => l.tipo === "ENTRADA").reduce((s, l) => s + l.meses[i], 0));
  const despMes = Array.from({ length: 12 }, (_, i) => linhasVis.filter(l => l.tipo === "SAIDA").reduce((s, l) => s + l.meses[i], 0));
  const orcAt = visiveis.reduce((a, u) => { const x = r.orcAtual.get(u); return { receita: a.receita + (x?.receita ?? 0), despesa: a.despesa + (x?.despesa ?? 0) }; }, { receita: 0, despesa: 0 });
  const temOrc = orcAt.receita > 0 || orcAt.despesa > 0; const t0 = tot("BASE");
  const linhasComp: { rot: string; f: (t: ReturnType<typeof tot>) => string; base: string; orc: string | null }[] = [
    { rot: "Receita", f: t => brl0(t.receita), base: brl0(t0.receitaBase), orc: temOrc ? brl0(orcAt.receita) : null },
    { rot: "Despesas", f: t => brl0(t.despesa), base: brl0(t0.despesaBase), orc: temOrc ? brl0(orcAt.despesa) : null },
    { rot: "Resultado", f: t => brl0(t.resultado), base: brl0(t0.receitaBase - t0.despesaBase), orc: temOrc ? brl0(orcAt.receita - orcAt.despesa) : null },
    { rot: "Margem", f: t => pct(t.margem), base: pct(t0.receitaBase > 0 ? (100 * (t0.receitaBase - t0.despesaBase)) / t0.receitaBase : null), orc: temOrc && orcAt.receita > 0 ? pct((100 * (orcAt.receita - orcAt.despesa)) / orcAt.receita) : null },
    { rot: "Alunos", f: t => t.alunos.toLocaleString("pt-BR"), base: visiveis.reduce((a, u) => a + (r.alunosAtuais.get(u) ?? 0), 0).toLocaleString("pt-BR"), orc: null },
    { rot: "Custo por aluno ao mês", f: t => t.custoAlunoMes === null ? "—" : brl(t.custoAlunoMes), base: (() => { const al = visiveis.reduce((a, u) => a + (r.alunosAtuais.get(u) ?? 0), 0); return al ? brl(t0.despesaBase / al / 12) : "—"; })(), orc: null },
  ];
  const cats = porCategoria(linhasVis.map(l => ({ ...l, unit_id: 0 })));
  const fmtIn = (v: number) => String(v).replace(".", ",");
  return (<>
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {VERSOES.map(v => { const t = tot(v); return <Stat key={v} label={`Resultado · ${ROTULO_VERSAO[v].toLowerCase()}`} value={<span className={t.resultado < 0 ? "text-erro" : "text-ok"}>{brl0(t.resultado)}</span>} hint={`margem ${pct(t.margem)} · receita ${brl0(t.receita)}`} />; })}
      <Stat label="Base 12 meses (limpa)" value={brl0(t0.receitaBase - t0.despesaBase)} hint={`receita ${brl0(t0.receitaBase)} · despesas ${brl0(t0.despesaBase)}`} />
    </div>
    <div className="mb-4 grid grid-cols-1 gap-4">
      <Card title={`As três versões${unidadeSel ? ` · ${nomeUnidade.get(unidadeSel)}` : " · rede"}`}>
        <Table head={["", "Base 12m", ...VERSOES.map(v => v === versao ? `${ROTULO_VERSAO[v]} •` : ROTULO_VERSAO[v]), ...(temOrc ? [{ label: `Orçamento ${ano} atual`, className: "hidden sm:table-cell" }] : [])]}>
          {linhasComp.map(l => <tr key={l.rot}><Td className="font-medium">{l.rot}</Td><Td className="whitespace-nowrap tabular-nums text-slate-600">{l.base}</Td>{VERSOES.map(v => <Td key={v} className={`whitespace-nowrap tabular-nums ${v === versao ? "font-semibold" : ""}`}>{l.f(tot(v))}</Td>)}{temOrc && <Td className="hidden whitespace-nowrap tabular-nums text-slate-600 sm:table-cell">{l.orc ?? "—"}</Td>}</tr>)}
        </Table>
        <p className="mt-2 text-[11px] text-slate-500">Otimista: alunos {sinalTxt(p.otimista.alunosPct)}, IPCA {p.otimista.ipcaPp >= 0 ? "+" : ""}{n2(p.otimista.ipcaPp)} p.p., dissídio {p.otimista.dissidioPp >= 0 ? "+" : ""}{n2(p.otimista.dissidioPp)} p.p., mensalidade {p.otimista.mensalidadePp >= 0 ? "+" : ""}{n2(p.otimista.mensalidadePp)} p.p. · Estresse: alunos {sinalTxt(p.estresse.alunosPct)}, IPCA {p.estresse.ipcaPp >= 0 ? "+" : ""}{n2(p.estresse.ipcaPp)} p.p., dissídio {p.estresse.dissidioPp >= 0 ? "+" : ""}{n2(p.estresse.dissidioPp)} p.p., mensalidade {p.estresse.mensalidadePp >= 0 ? "+" : ""}{n2(p.estresse.mensalidadePp)} p.p. — em relação à base.</p>
      </Card>
      <Card title={`Mês a mês em ${ano}`}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div><h3 className="mb-1 text-xs font-semibold text-slate-600">Resultado nas três versões</h3><Linhas rotulo={`Resultado mensal projetado em ${ano} nas três versões`} categorias={MESES_CURTOS} series={[{ nome: "Base", valores: mensal("BASE"), cor: COR.acao }, { nome: "Otimista", valores: mensal("OTIMISTA"), cor: COR.ok, tracejada: true }, { nome: "Estresse", valores: mensal("ESTRESSE"), cor: COR.erro, tracejada: true }]} formato={v => fmtCompacto(v)} formatoDica={v => brl0(v)} tamanho="meio" zero /></div>
          <div><h3 className="mb-1 text-xs font-semibold text-slate-600">Receita e despesas · versão {ROTULO_VERSAO[versao].toLowerCase()}</h3><Colunas rotulo={`Receita e despesas por mês · ${ROTULO_VERSAO[versao].toLowerCase()}`} categorias={MESES_CURTOS} series={[{ nome: "Receita", valores: recMes, cor: COR.ok }, { nome: "Despesas", valores: despMes, cor: COR.neutro }]} formato={v => fmtCompacto(v)} formatoDica={v => brl0(v)} tamanho="meio" /></div>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">Dezembro concentra o 13º; janeiro e fevereiro, material e taxas — a sazonalidade vem do próprio histórico.</p>
      </Card>
    </div>
    {!unidadeSel && <Card title={`Por unidade · versão ${ROTULO_VERSAO[versao].toLowerCase()}`} className="mb-4">
      <Table head={["Unidade", "Alunos", "Receita", { label: "vs base", className: "hidden sm:table-cell" }, "Despesas", { label: "vs base", className: "hidden sm:table-cell" }, "Resultado", { label: "Custo/aluno/mês", className: "hidden md:table-cell" }, { label: "Folha aceita (ref.)", className: "hidden lg:table-cell" }]}>
        {r.unidades.map(u => { const t = ver.tot.porUnidade.get(u.id)!; const f = r.folha.get(u.id); const pes = ver.linhas.filter(l => l.unit_id === u.id && l.tipo === "SAIDA" && ["Pessoal", "Encargos e benefícios"].includes(l.categoria)).reduce((a, l) => a + l.nivelado, 0) / 12;
          return <tr key={u.id}><Td className="whitespace-nowrap font-medium">{u.nome}</Td><Td className="whitespace-nowrap tabular-nums">{(r.alunosAtuais.get(u.id) ?? 0).toLocaleString("pt-BR")} → <b>{t.alunos.toLocaleString("pt-BR")}</b></Td>
            <Td className="whitespace-nowrap tabular-nums">{brl0(t.receita)}</Td><Td className="hidden whitespace-nowrap text-xs tabular-nums sm:table-cell">{sinalTxt(var_(t.receita, t.receitaBase))}</Td>
            <Td className="whitespace-nowrap tabular-nums">{brl0(t.despesa)}</Td><Td className="hidden whitespace-nowrap text-xs tabular-nums sm:table-cell">{sinalTxt(var_(t.despesa, t.despesaBase))}</Td>
            <Td className={`whitespace-nowrap font-semibold tabular-nums ${t.resultado < 0 ? "text-erro" : "text-ok"}`}>{brl0(t.resultado)}<div className="text-[11px] font-normal text-slate-500">margem {pct(t.margem)}</div></Td>
            <Td className="hidden whitespace-nowrap tabular-nums md:table-cell">{t.custoAlunoMes === null ? "—" : brl(t.custoAlunoMes)}</Td>
            <Td className="hidden whitespace-nowrap text-xs tabular-nums lg:table-cell">{f ? <>{brl0(f.custo)}/mês <span className="text-slate-500">({rotuloMes(f.mes)})</span><div className="text-[11px] text-slate-500">base de pessoal {brl0(pes)}/mês</div></> : "—"}</Td></tr>; })}
      </Table>
      <p className="mt-2 text-[11px] text-slate-500">Folha aceita: custo de pessoal do último ciclo de folha aceito (salários, encargos, provisões e benefícios) — referência para conferir a base de Pessoal + Encargos, já a preços de hoje.</p>
    </Card>}
    <Card title={`Memória por conta · versão ${ROTULO_VERSAO[versao].toLowerCase()}${unidadeSel ? ` · ${nomeUnidade.get(unidadeSel)}` : " · rede"}`} className="mb-4">
      <Table head={["Conta", { label: "Base bruta", className: "hidden lg:table-cell" }, "Base limpa", { label: "A preços de hoje", className: "hidden md:table-cell" }, { label: "Reajuste", className: "hidden md:table-cell" }, { label: "Volume", className: "hidden md:table-cell" }, { label: "Piso contratos", className: "hidden lg:table-cell" }, `Projetado ${ano}`, { label: "vs base", className: "hidden sm:table-cell" }]} empty="Sem lançamentos na base.">
        {ordGr.flatMap(g => {
          const sub = g.itens.reduce((a, x) => ({ limpo: a.limpo + x.limpo, total: a.total + x.total }), { limpo: 0, total: 0 });
          return [<tr key={`g${g.rot}`} className="bg-mist"><Td className="!bg-mist font-semibold text-navy">{g.rot}</Td><Td className="hidden lg:table-cell">{""}</Td><Td className="whitespace-nowrap font-semibold tabular-nums">{brl0(sub.limpo)}</Td><Td className="hidden md:table-cell">{""}</Td><Td className="hidden md:table-cell">{""}</Td><Td className="hidden md:table-cell">{""}</Td><Td className="hidden lg:table-cell">{""}</Td><Td className="whitespace-nowrap font-semibold tabular-nums">{brl0(sub.total)}</Td><Td className="hidden text-xs tabular-nums sm:table-cell">{sinalTxt(var_(sub.total, sub.limpo))}</Td></tr>,
            ...g.itens.sort((a, b) => contaRot(a).localeCompare(contaRot(b), "pt-BR", { numeric: true })).map(a => { const reaj = a.nivelado > 0 ? (100 * (a.comPreco - a.nivelado)) / a.nivelado : null; const vol = a.comPreco > 0 ? (a.total - a.piso) / a.comPreco : null;
              return <tr key={a.chave}><Td><div className="font-medium">{contaRot(a)}</div><div className="text-[11px] text-slate-500">{ROTULO_INDICE[a.indice] ?? a.indice}{a.driver !== "NENHUM" ? ` · varia com ${ROTULO_DRIVER[a.driver]?.toLowerCase() ?? a.driver}` : ""}{a.removido > 0 ? ` · −${brl0(a.removido)} higienizado` : ""}{a.normalizado > 0 ? ` · −${brl0(a.normalizado)} normalizado` : ""}</div>
                {[...a.avisos].map(x => <div key={x} className="text-[11px] text-aviso">{x}</div>)}{[...a.origem].slice(0, 3).map(x => <div key={x} className="text-[11px] text-slate-500">piso: {x}</div>)}</Td>
                <Td className="hidden whitespace-nowrap tabular-nums text-slate-600 lg:table-cell">{brl0(a.bruto)}</Td><Td className="whitespace-nowrap tabular-nums">{brl0(a.limpo)}</Td><Td className="hidden whitespace-nowrap tabular-nums md:table-cell">{brl0(a.nivelado)}</Td>
                <Td className="hidden whitespace-nowrap text-xs tabular-nums md:table-cell">{reaj === null ? "—" : sinalTxt(reaj)}</Td><Td className="hidden whitespace-nowrap text-xs tabular-nums md:table-cell">{vol === null ? "—" : `× ${vol.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`}</Td>
                <Td className="hidden whitespace-nowrap text-xs tabular-nums lg:table-cell">{a.piso > 0 ? `+${brl0(a.piso)}` : "—"}</Td><Td className="whitespace-nowrap font-medium tabular-nums">{brl0(a.total)}</Td><Td className="hidden whitespace-nowrap text-xs tabular-nums sm:table-cell">{sinalTxt(var_(a.total, a.limpo))}</Td></tr>; })];
        })}
      </Table>
      <p className="mt-2 text-[11px] text-slate-500">Base limpa: 12 meses depois da higienização. A preços de hoje: meses anteriores aos reajustes de {ano - 1} (mensalidade em {MESES_CURTOS[p.mesReajusteMensalidade - 1]}, dissídio em {MESES_CURTOS[p.mesDissidio - 1]}, IPCA proporcional ao tempo) trazidos ao nível do fim da base. Reajuste de {ano}: mensalidade {pct(r.versoes[versao].pv.mensalidadePct)} a partir de {MESES_CURTOS[p.mesReajusteMensalidade - 1]}, dissídio {pct(r.versoes[versao].pv.dissidioPct)} a partir de {MESES_CURTOS[p.mesDissidio - 1]}, IPCA {pct(r.versoes[versao].pv.ipcaPct)} ao ano proporcional ao tempo desde o fim da base. Volume: alunos do ano ÷ alunos atuais (contas que variam com alunos) ou receita projetada ÷ receita da base (tributos e taxas de cartão). Sazonalidade: o mês a mês da própria base. Piso: o orçamento do mês não fica abaixo do que já está contratado ou lançado em contas a pagar.</p>
    </Card>
    <Card title={`O que vai para o orçamento ${ano} (categoria × mês) · ${ROTULO_VERSAO[versao].toLowerCase()}`} className="mb-4">
      <div className="overflow-x-auto rounded-md border border-line [-webkit-overflow-scrolling:touch]">
        <table className="w-full text-right text-xs tabular-nums">
          <thead className="bg-mist text-slate-600"><tr><th className="sticky left-0 z-[1] bg-mist px-2 py-2 text-left font-medium">Categoria</th>{MESES_CURTOS.map(m => <th key={m} className="px-2 py-2 font-medium">{m}</th>)}<th className="px-2 py-2 font-medium">Ano</th></tr></thead>
          <tbody className="divide-y divide-line">{(["ENTRADA", "SAIDA"] as const).flatMap(t => { const xs = cats.filter(c => c.tipo === t); const soma = Array.from({ length: 12 }, (_, i) => xs.reduce((a, c) => a + c.meses[i], 0));
            return [...xs.map(c => <tr key={`${t}${c.categoria}`}><td className="sticky left-0 z-[1] whitespace-nowrap bg-white px-2 py-1.5 text-left">{c.categoria}</td>{c.meses.map((v, i) => <td key={i} className="px-2 py-1.5">{fmtCompacto(v)}</td>)}<td className="px-2 py-1.5 font-medium">{fmtCompacto(c.meses.reduce((a, b) => a + b, 0))}</td></tr>),
              <tr key={`t${t}`} className="bg-mist font-semibold"><td className="sticky left-0 z-[1] bg-mist px-2 py-1.5 text-left">{t === "ENTRADA" ? "Receitas" : "Despesas"}</td>{soma.map((v, i) => <td key={i} className="px-2 py-1.5">{fmtCompacto(v)}</td>)}<td className="px-2 py-1.5">{fmtCompacto(soma.reduce((a, b) => a + b, 0))}</td></tr>]; })}</tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">O orçamento oficial fica na categoria (como o caixa, a DRE e o orçado × realizado); a conta do plano é a memória do cálculo e sai na exportação.</p>
    </Card>
    <Card title={`Parâmetros de ${ano}`} className="mb-4">
      <div id="parametros" />
      {!edita ? <p className="text-sm text-slate-600">Parâmetros definidos pelo Financeiro e pela Direção. Reajustes: IPCA {pct(p.ipcaPct)}, dissídio {pct(p.dissidioPct)} ({MESES_CURTOS[p.mesDissidio - 1]}), mensalidade {pct(p.reajusteMensalidadePct)} ({MESES_CURTOS[p.mesReajusteMensalidade - 1]}).</p> :
        <form action={salvarParametros} className="space-y-4">
          <input type="hidden" name="ano" value={ano} /><input type="hidden" name="etapa" value="projetar" /><input type="hidden" name="versao" value={versao} />{unidadeSel && escopo === null && <input type="hidden" name="unidade" value={unidadeSel} />}
          <fieldset className="rounded-md border border-line p-3"><legend className="px-1 text-xs font-semibold text-navy">Base e reajustes de {ano}</legend>
            <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-3 lg:grid-cols-7">
              <Field label="Último mês da base" className="col-span-2 sm:col-span-1 lg:col-span-2"><Input name="fimBase" type="month" defaultValue={p.fimBase} max={`${ano - 1}-12`} required /></Field>
              <Field label="IPCA no ano (%)"><Input name="ipcaPct" inputMode="decimal" defaultValue={fmtIn(p.ipcaPct)} required /></Field>
              <Field label="Dissídio (%)"><Input name="dissidioPct" inputMode="decimal" defaultValue={fmtIn(p.dissidioPct)} required /></Field>
              <Field label="Mês do dissídio"><Select name="mesDissidio" defaultValue={String(p.mesDissidio)}>{MESES_CURTOS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select></Field>
              <Field label="Mensalidade (%)"><Input name="reajusteMensalidadePct" inputMode="decimal" defaultValue={fmtIn(p.reajusteMensalidadePct)} required /></Field>
              <Field label="Mês da mensalidade"><Select name="mesReajusteMensalidade" defaultValue={String(p.mesReajusteMensalidade)}>{MESES_CURTOS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select></Field>
            </div></fieldset>
          <fieldset className="rounded-md border border-line p-3"><legend className="px-1 text-xs font-semibold text-navy">Nivelar a base a preços de hoje (reajustes de {ano - 1})</legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><Field label="IPCA dos 12 meses (%)" hint="meses mais antigos sobem proporcionalmente"><Input name="nivelIpcaPct" inputMode="decimal" defaultValue={fmtIn(p.nivelIpcaPct)} required /></Field>
              <Field label={`Dissídio de ${ano - 1} (%)`} hint={`meses antes de ${MESES_CURTOS[p.mesDissidio - 1]}/${ano - 1}`}><Input name="nivelDissidioPct" inputMode="decimal" defaultValue={fmtIn(p.nivelDissidioPct)} required /></Field>
              <Field label={`Mensalidade de ${ano - 1} (%)`} hint={`meses antes de ${MESES_CURTOS[p.mesReajusteMensalidade - 1]}/${ano - 1}`}><Input name="nivelMensalidadePct" inputMode="decimal" defaultValue={fmtIn(p.nivelMensalidadePct)} required /></Field></div></fieldset>
          <fieldset className="rounded-md border border-line p-3"><legend className="px-1 text-xs font-semibold text-navy">Matrículas: alunos em {ano} por unidade</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{r.unidades.filter(u => escopo === null || u.id === escopo).map(u => { const ref = r.refsAlunos.get(u.id); const salvo = (r.plano?.params?.alunosAlvo as Record<string, number> | undefined)?.[String(u.id)];
              return <Field key={u.id} label={u.nome} hint={`atuais ${ref?.atuais ?? 0}${ref?.meta !== null && ref?.meta !== undefined ? ` · meta ${ref.meta}` : ""}${ref && (ref.confirmadas || ref.reservas) ? ` · ${ano}: ${ref.confirmadas} confirmadas + ${ref.reservas} reservas` : ""}${ref?.potencial !== null && ref?.potencial !== undefined ? ` · potencial ${ref.potencial}` : ""}`}>
                <Input name={`alunos_${u.id}`} inputMode="numeric" defaultValue={salvo !== undefined ? String(salvo) : ""} placeholder={String(r.alunosPadrao.get(u.id) ?? 0)} /></Field>; })}</div>
            <p className="mt-1 text-[11px] text-slate-500">Em branco: a meta de matrículas do ano (vagas × meta de ocupação); sem meta, os alunos atuais. Contas que variam com alunos (mensalidades, material didático, plataformas) seguem a razão alunos do ano ÷ alunos atuais.</p></fieldset>
          <fieldset className="rounded-md border border-line p-3"><legend className="px-1 text-xs font-semibold text-navy">Calendário escolar, higienização e contratos</legend>
            <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-sm"><span className="text-xs text-slate-600">Férias:</span>{MESES_CURTOS.map((m, i) => <label key={m} className="inline-flex items-center gap-1 text-xs"><input type="checkbox" name="mesesFerias" value={i + 1} defaultChecked={p.mesesFerias.includes(i + 1)} />{m}</label>)}</div>
            <div className="grid grid-cols-2 items-start gap-3 sm:grid-cols-4"><Field label="Consumo nas férias (×)" hint="só para meses sem histórico"><Input name="fatorFerias" inputMode="decimal" defaultValue={fmtIn(p.fatorFerias)} required /></Field>
              <Field label="Pico: × a mediana"><Input name="outlierFator" inputMode="decimal" defaultValue={fmtIn(p.outlierFator)} required /></Field>
              <Field label="Pico: R$ acima da mediana"><Input name="outlierMinimo" inputMode="decimal" defaultValue={fmtIn(p.outlierMinimo)} required /></Field>
              <Field label="Evento a confirmar a partir de R$"><Input name="eventoMinimo" inputMode="decimal" defaultValue={fmtIn(p.eventoMinimo)} required /></Field></div>
            <label className="mt-2 inline-flex items-center gap-2 text-sm"><input type="checkbox" name="usarContratos" value="1" defaultChecked={p.usarContratos} />Piso dos contratos vigentes e dos títulos a pagar já lançados para {ano}</label></fieldset>
          <fieldset className="rounded-md border border-line p-3"><legend className="px-1 text-xs font-semibold text-navy">Versões (em relação à base)</legend>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{(["otimista", "estresse"] as const).map(k => <div key={k}><div className="mb-1 text-xs font-medium text-slate-700">{k === "otimista" ? "Otimista" : "Estresse"}</div><div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-4">
              <Field label="Alunos (%)"><Input name={`${k}_alunosPct`} inputMode="decimal" defaultValue={fmtIn(p[k].alunosPct)} required /></Field><Field label="IPCA (p.p.)"><Input name={`${k}_ipcaPp`} inputMode="decimal" defaultValue={fmtIn(p[k].ipcaPp)} required /></Field>
              <Field label="Dissídio (p.p.)"><Input name={`${k}_dissidioPp`} inputMode="decimal" defaultValue={fmtIn(p[k].dissidioPp)} required /></Field><Field label="Mensal. (p.p.)"><Input name={`${k}_mensalidadePp`} inputMode="decimal" defaultValue={fmtIn(p[k].mensalidadePp)} required /></Field></div></div>)}</div></fieldset>
          <div className="flex flex-wrap items-center gap-3"><Btn>Salvar e recalcular</Btn>{r.plano?.atualizado_por && <span className="text-xs text-slate-500">Última alteração: {r.plano.atualizado_por} · {fmtData(r.plano.updated_at.slice(0, 10))}</span>}</div>
        </form>}
    </Card>
  </>);
}

// ---------------------------------------------------------------- 4. Governar
async function Governar({ r, s, cfg, ano, versao, aplica, tot, unidadeSel }: { r: OrcHistorico; s: Awaited<ReturnType<typeof requireSession>>; cfg: Awaited<ReturnType<typeof getSettings>>; ano: number; versao: Versao; aplica: boolean; tot: (v: Versao) => { receita: number; despesa: number; resultado: number; margem: number | null; alunos: number; custoAlunoMes: number | null }; unidadeSel: number | null }) {
  const donos = (cfg.orcamento.donosCategoria ?? {}) as Record<string, number | string>; const ids = [...new Set(Object.values(donos).map(Number).filter(Boolean))];
  const [users, pedidos] = await Promise.all([ids.length ? sql<{ id: number; nome: string }[]>`SELECT id, nome FROM users WHERE id = ANY(${ids}::int[])` : Promise.resolve([] as { id: number; nome: string }[]), pedidosExplicacao(s, { ano })]);
  const nomeU = new Map(users.map(u => [u.id, u.nome])); const abertos = pedidos.filter(p => p.status === "ABERTA").length;
  const plano = r.plano; const aplicado = plano?.status === "APLICADO"; const res = plano?.resumo ?? null;
  // os números mudaram depois da aplicação (parâmetros, decisões da higienização, classificação, novos títulos)? compara com a fotografia
  const agora = res ? r.versoes[res.versao] : null;
  const alterado = !!(aplicado && res && agora && r.unidades.some(u => { const f = res.porUnidade.find(x => x.unit_id === u.id); const t = agora.tot.porUnidade.get(u.id); return !f || !t || Math.abs(f.receita - t.receita) > 1 || Math.abs(f.despesa - t.despesa) > 1; }));
  const faixaMin = Number(cfg.orcamento.faixaMinPct) || 90, faixaMax = Number(cfg.orcamento.faixaMaxPct) || 105;
  return (<>
    <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card title="Situação do orçamento" className="lg:col-span-1">
        {aplicado && res ? <div className="space-y-1 text-sm"><Badge v="APROVADO" label={`Aplicado · versão ${ROTULO_VERSAO[res.versao].toLowerCase()}`} />
          <p>Por {plano?.aplicado_por ?? "—"} em {fmtData(plano?.aplicado_em?.slice(0, 10))} · base até {rotuloMes(res.fimBase)} · {res.celulas.toLocaleString("pt-BR")} valores mês a mês.</p>
          <p className="text-xs text-slate-600">Na aplicação: receita {brl0(res.totais[res.versao].receita)}, despesas {brl0(res.totais[res.versao].despesa)}, resultado {brl0(res.totais[res.versao].resultado)}.</p>
          {alterado && <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-aviso">Os números mudaram depois da aplicação (parâmetros, decisões da higienização, classificação ou títulos novos): o orçamento oficial continua o aplicado. Aplique de novo para atualizar.</p>}</div>
          : <p className="text-sm text-slate-600"><Badge v="PENDENTE" label="Rascunho" /> Ainda não aplicado: o orçado × realizado de {ano} usa {r.temOrcamentoMensal ? "o orçamento mês a mês já lançado" : "apenas o valor mensal fixo (se houver)"}.</p>}
      </Card>
      <Card title="Tolerâncias e revisão mensal" className="lg:col-span-2">
        <ul className="space-y-2 text-sm">
          <li><b>Banda saudável:</b> despesa até {faixaMax}% do orçado do mês; receita a partir de {faixaMin}%. Acima do teto, o dono da categoria explica o desvio. {s.role === "DIRECAO" && <Link href="/configuracoes#v24-financeiro" className="text-xs text-acao underline">ajustar</Link>}</li>
          <li><b>Revisão mensal:</b> quando o mês fecha, cada estouro gera um pedido de explicação ao responsável — {abertos ? <span className="text-aviso">{abertos} pedido(s) aberto(s) em {ano}</span> : `nenhum pedido aberto em ${ano}`}. <Link href={`/financeiro/orcamento?ano=${ano}#explicacoes`} className="text-xs text-acao underline">orçado × realizado</Link></li>
          <li><b>Donos do orçamento:</b> {Object.keys(donos).length ? Object.entries(donos).map(([c, u]) => `${c}: ${nomeU.get(Number(u)) ?? "—"}`).join(" · ") : "sem dono por categoria — vale a direção da unidade, depois o Financeiro"}. {s.role === "DIRECAO" && <Link href="/configuracoes#v24-financeiro" className="text-xs text-acao underline">definir</Link>}</li>
          <li><b>Versões:</b> base para o compromisso; otimista e estresse mostram a faixa — o estresse diz quanto caixa é preciso se as matrículas e os reajustes vierem piores.</li>
        </ul>
      </Card>
    </div>
    <Card title={`Aplicar ao orçamento oficial de ${ano}`} className="mb-4">
      <div id="aplicar" />
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">{VERSOES.map(v => { const t = tot(v); return <div key={v} className={`rounded-md border p-3 ${v === versao ? "border-acao bg-sky-50" : "border-line"}`}><div className="text-sm font-semibold text-navy">{ROTULO_VERSAO[v]}</div><div className="text-xs text-slate-600">Receita {brl0(t.receita)} · despesas {brl0(t.despesa)}</div><div className={`text-sm font-semibold tabular-nums ${t.resultado < 0 ? "text-erro" : "text-ok"}`}>{brl0(t.resultado)} <span className="text-xs font-normal text-slate-500">({pct(t.margem)})</span></div><div className="text-[11px] text-slate-500">{t.alunos.toLocaleString("pt-BR")} alunos · {t.custoAlunoMes === null ? "—" : `${brl(t.custoAlunoMes)}/aluno/mês`}</div></div>; })}</div>
      {unidadeSel && <p className="mb-2 text-xs text-slate-600">Os cartões mostram a unidade escolhida; a aplicação vale para a rede inteira (todas as unidades).</p>}
      {aplica ? <form action={aplicarVersao} className="space-y-2">
        <input type="hidden" name="ano" value={ano} /><input type="hidden" name="etapa" value="governar" />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><Field label="Versão"><Select name="versao" defaultValue={versao}>{VERSOES.map(v => <option key={v} value={v}>{ROTULO_VERSAO[v]}</option>)}</Select></Field>
          <Field label="Critério da escolha" className="sm:col-span-2" hint="Fica na aprovação e na auditoria."><Textarea name="motivo" required minLength={10} className="min-h-[44px]" placeholder="Ex.: versão base aprovada no comitê de outubro; estresse como reserva de caixa" /></Field></div>
        {r.temOrcamentoMensal && <label className="inline-flex items-center gap-2 text-sm text-aviso"><input type="checkbox" name="substituir" value="1" />Substituir o orçamento mês a mês já lançado em {ano} (ajustes manuais da planilha serão trocados)</label>}
        <div><Btn>Aplicar ao orçamento {ano}</Btn></div>
        <p className="text-[11px] text-slate-500">Grava o orçamento mês a mês por unidade e categoria; depois dá para ajustar célula a célula na planilha. As unidades e o Financeiro recebem um aviso.</p>
      </form> : <p className="text-sm text-slate-600">A Direção escolhe e aplica a versão. O Financeiro prepara a base, os parâmetros e as decisões da higienização.</p>}
    </Card>
    {res && <Card title="Fotografia da aplicação" className="mb-4">
      <Table head={["Unidade", "Alunos", "Receita", "Despesas", "Resultado"]}>
        {res.porUnidade.map(u => <tr key={u.unit_id}><Td className="font-medium">{u.nome}</Td><Td className="tabular-nums">{u.alunos.toLocaleString("pt-BR")}</Td><Td className="whitespace-nowrap tabular-nums">{brl0(u.receita)}</Td><Td className="whitespace-nowrap tabular-nums">{brl0(u.despesa)}</Td><Td className={`whitespace-nowrap tabular-nums ${u.resultado < 0 ? "text-erro" : "text-ok"}`}>{brl0(u.resultado)}</Td></tr>)}
      </Table>
      <p className="mt-2 text-[11px] text-slate-500">Na aplicação: base {brl0(res.totais.BASE.resultado)} · otimista {brl0(res.totais.OTIMISTA.resultado)} · estresse {brl0(res.totais.ESTRESSE.resultado)} (resultado da rede).</p>
    </Card>}
  </>);
}
