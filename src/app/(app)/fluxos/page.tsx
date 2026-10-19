import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { sql } from "@/db";
import { requireGestao } from "@/lib/auth";
import { Page, Card, Field, Select, Btn } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { KpiCard, Colunas, Linhas, Rosca, BarrasH, MapaCalor, Situacao as Selo, COR, type CelulaCalor, type Tom } from "@/components/graficos";
import {
  FLUXOS, ORDEM_FLUXOS, SITUACAO_LABEL, SITUACAO_TOM, NC_ABERTAS, fluxosVisiveis, veFluxos, instancias, resumir, porSemana, gargalosAprovacao, esperas,
  porResponsavel, porUnidadeFluxo, abertosPorSemana, leituraFluxos, ncsPainel, contexto, type Fluxo, type Instancia, type Situacao,
} from "@/lib/fluxos";
import { NC_ORIGEM, NC_STATUS } from "@/lib/governanca";
import { addDays, fmtData } from "@/lib/utils";
import { fmtPct, fmtNumero } from "@/lib/formato";

export const dynamic = "force-dynamic";

const DIA = 86400000;
const SIT_COR: Record<Situacao, string> = { NO_PRAZO: COR.ok, EM_RISCO: COR.aviso, VENCIDO: COR.erro, SEM_PRAZO: "#94a3b8", CONCLUIDO_NO_PRAZO: COR.ok, CONCLUIDO_FORA: COR.erro, CONCLUIDO_SEM_PRAZO: "#94a3b8" };
const dias1 = (x: number | null) => x === null ? "—" : `${fmtNumero(x, x < 10 ? 1 : 0)} ${Math.abs(x) >= 1 && Math.abs(x) < 2 ? "dia" : "dias"}`;
const dataCurta = (ms: number) => new Date(ms - 4 * 3600000).toISOString().slice(0, 10);
const tomPct = (p: number | null): Tom => p === null ? "neutro" : p >= 90 ? "bom" : p >= 75 ? "atencao" : "ruim";

/**
 * Central de fluxos e SLA (v23): todos os processos com prazo num só lugar — no prazo, em risco e vencidos; cumprimento por semana;
 * gargalos das aprovações; carga por responsável; unidades; e a visão de auditoria das não conformidades.
 */
export default async function Fluxos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireGestao(); if (!veFluxos(s)) redirect("/");
  const sp = await searchParams; const ctx = await contexto(s);
  const units = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`;
  const unitId = ctx.escopo ?? (units.some(u => u.id === Number(sp.unidade)) ? Number(sp.unidade) : null);
  const visiveis = await fluxosVisiveis(s);
  if (!visiveis.length) redirect("/");
  const fluxo = sp.fluxo && visiveis.includes(sp.fluxo as Fluxo) ? (sp.fluxo as Fluxo) : null;
  const dias = [30, 90, 180, 365].includes(Number(sp.dias)) ? Number(sp.dias) : 90;
  const abas = [{ chave: "visao", rotulo: "Visão geral" }, { chave: "lista", rotulo: "Itens" }, ...(visiveis.includes("SOLICITACAO") ? [{ chave: "aprovacoes", rotulo: "Aprovações" }] : []), ...(visiveis.includes("NC") ? [{ chave: "ncs", rotulo: "Auditoria e NCs" }] : [])];
  const aba = abas.some(a => a.chave === sp.aba) ? sp.aba! : "visao";
  const desde = addDays(ctx.hoje, -dias); const agora = Date.now();
  const insts = await instancias(fluxo ? [fluxo] : visiveis, unitId, desde);
  const R = resumir(insts, agora, ctx.riscoPct);
  const qs = (extra: Record<string, string | number | null | undefined>) => { const q = new URLSearchParams(); const base: Record<string, string | number | null | undefined> = { aba, unidade: unitId ?? undefined, fluxo: fluxo ?? undefined, dias, ...extra }; for (const [k, v] of Object.entries(base)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v)); return `/fluxos?${q.toString()}`; };
  const nomeUnidade = unitId ? units.find(u => u.id === unitId)?.nome ?? "Unidade" : "Rede";
  const T = R.total; const cumprimento = T.concluidosComPrazo ? (100 * T.concluidosNoPrazo) / T.concluidosComPrazo : null;
  const abertosPct = (n: number) => T.abertos ? fmtPct((100 * n) / T.abertos, 0) : "—";
  const semanas = porSemana(insts, 12, agora);

  return (
    <Page title="Central de fluxos e SLA" sub={<>{nomeUnidade} · {fluxo ? FLUXOS[fluxo].nome : `${visiveis.length} processos com prazo`} · concluídos nos últimos {dias} dias. Prazos de data vencem às 23h59 (Campo Grande); “em risco” = resta até {ctx.riscoPct}% do prazo.</>}
      actions={<div className="flex flex-wrap gap-2 print:hidden"><Btn kind="ghost" href={`/api/export/fluxos?dias=${dias}${unitId ? `&unidade=${unitId}` : ""}${fluxo ? `&fluxo=${fluxo}` : ""}`}>Exportar CSV</Btn><PrintButton /><Btn kind="ghost" href="/pendencias">Minhas pendências</Btn></div>}>
      <form className="mb-3 flex flex-wrap items-end gap-2 print:hidden">
        <input type="hidden" name="aba" value={aba} />
        {ctx.escopo === null && <Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Rede</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
        <Field label="Processo"><Select name="fluxo" defaultValue={fluxo ?? ""}><option value="">Todos</option>{ORDEM_FLUXOS.filter(f => visiveis.includes(f)).map(f => <option key={f} value={f}>{FLUXOS[f].nome}</option>)}</Select></Field>
        <Field label="Concluídos em"><Select name="dias" defaultValue={dias}>{[30, 90, 180, 365].map(d => <option key={d} value={d}>últimos {d} dias</option>)}</Select></Field>
        <Btn kind="ghost">Ver</Btn>
      </form>
      <nav aria-label="Visões da central" className="mb-4 flex gap-1 overflow-x-auto border-b border-line print:hidden [-webkit-overflow-scrolling:touch]">
        {abas.map(a => <Link key={a.chave} href={qs({ aba: a.chave })} aria-current={a.chave === aba ? "page" : undefined} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${a.chave === aba ? "border-acao font-semibold text-navy" : "border-transparent text-slate-600 hover:text-navy"}`}>{a.rotulo}</Link>)}
      </nav>

      {aba === "visao" && <Visao insts={insts} R={R} semanas={semanas} unitId={unitId} desde={desde} agora={agora} qs={qs} cumprimento={cumprimento} abertosPct={abertosPct} temSolic={visiveis.includes("SOLICITACAO") && (!fluxo || fluxo === "SOLICITACAO")} escopo={ctx.escopo} />}
      {aba === "lista" && <Lista insts={insts} sit={R.situacoes} agora={agora} sp={sp} qs={qs} />}
      {aba === "aprovacoes" && <Aprovacoes unitId={unitId} desde={desde} insts={insts.filter(i => i.fluxo === "SOLICITACAO")} sit={R.situacoes} dias={dias} />}
      {aba === "ncs" && <Ncs unitId={unitId} desde={desde} dias={dias} />}
    </Page>
  );
}

async function Visao({ insts, R, semanas, unitId, desde, agora, qs, cumprimento, abertosPct, temSolic, escopo }: {
  insts: Instancia[]; R: ReturnType<typeof resumir>; semanas: ReturnType<typeof porSemana>; unitId: number | null; desde: string; agora: number; qs: (e: Record<string, string | number | null | undefined>) => string;
  cumprimento: number | null; abertosPct: (n: number) => string; temSolic: boolean; escopo: number | null;
}) {
  const T = R.total;
  const gargalos = temSolic ? await gargalosAprovacao(unitId, desde) : null;
  const unidades = porUnidadeFluxo(insts, R.situacoes); const resp = porResponsavel(insts, R.situacoes); const esp = esperas(insts, agora);
  const leitura = leituraFluxos({ resumo: R, semanas, gargalos, unidades, agora });
  const entrada = abertosPorSemana(insts, 12, agora);
  const ciclo = (() => { const c = insts.filter(i => i.concluido !== null); return c.length ? c.reduce((a, i) => a + Math.max(0, (i.concluido ?? 0) - i.aberto) / DIA, 0) / c.length : null; })();
  const ordem = [...R.porFluxo].sort((a, b) => ORDEM_FLUXOS.indexOf(a.fluxo) - ORDEM_FLUXOS.indexOf(b.fluxo));
  const efic = cumprimento;
  return <>
    <div className="mb-4 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <KpiCard titulo="Em andamento" valor={fmtNumero(T.abertos)} sub={`${T.semPrazo} sem prazo definido`} href={qs({ aba: "lista", sit: "ABERTOS" })} />
      <KpiCard titulo="No prazo" valor={fmtNumero(T.noPrazo)} tom="bom" sub={`${abertosPct(T.noPrazo)} dos itens em andamento`} href={qs({ aba: "lista", sit: "NO_PRAZO" })} />
      <KpiCard titulo="Em risco" valor={fmtNumero(T.emRisco)} tom={T.emRisco ? "atencao" : "neutro"} sub={`${abertosPct(T.emRisco)} · vencem em breve`} href={qs({ aba: "lista", sit: "EM_RISCO" })} />
      <KpiCard titulo="Vencidos" valor={fmtNumero(T.vencidos)} tom={T.vencidos ? "ruim" : "bom"} sub={`${abertosPct(T.vencidos)} dos itens em andamento`} href={qs({ aba: "lista", sit: "VENCIDO" })} />
      <KpiCard titulo="Concluídos no prazo" valor={fmtPct(cumprimento, 1)} tom={tomPct(cumprimento)} sub={`${T.concluidosNoPrazo} de ${T.concluidosComPrazo} com prazo · ${T.concluidos} concluídos`} />
      <KpiCard titulo="Ciclo médio" valor={dias1(ciclo)} sub="da abertura à conclusão (concluídos no período)" />
    </div>

    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card title="Leitura da central">
        {leitura.length === 0 ? <p className="text-sm text-slate-500">Sem itens no recorte.</p> : <ul className="space-y-2">{leitura.map((f, i) => <li key={i} className="flex gap-2 text-sm leading-snug"><span aria-hidden className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: f.tom === "ruim" ? COR.erro : f.tom === "atencao" ? COR.aviso : f.tom === "bom" ? COR.ok : COR.neutro }} /><span className="min-w-0">{f.texto}</span></li>)}</ul>}
        <p className="mt-3 text-[11px] text-slate-500">Gerada pelos próprios registros (sem IA e sem nomes de pessoas).</p>
      </Card>
      <Card title="Situação dos itens em andamento">
        <Rosca rotulo="Itens em andamento por situação" fatias={[{ rotulo: "No prazo", valor: T.noPrazo, cor: COR.ok, href: qs({ aba: "lista", sit: "NO_PRAZO" }) }, { rotulo: "Em risco", valor: T.emRisco, cor: COR.aviso, href: qs({ aba: "lista", sit: "EM_RISCO" }) }, { rotulo: "Vencidos", valor: T.vencidos, cor: COR.erro, href: qs({ aba: "lista", sit: "VENCIDO" }) }, { rotulo: "Sem prazo", valor: T.semPrazo, cor: "#cbd5e1", href: qs({ aba: "lista", sit: "SEM_PRAZO" }) }]} centro={{ valor: fmtNumero(T.abertos), rotulo: "em andamento" }} tamanho={140} />
        {efic !== null && <div className="mt-3 border-t border-line pt-3 text-sm"><span className="text-slate-600">Índice de eficiência do período (concluídos no prazo): </span><b className={efic >= 90 ? "text-ok" : efic >= 75 ? "text-aviso" : "text-erro"}>{fmtPct(efic, 1)}</b></div>}
      </Card>
    </div>

    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title="Cumprimento do prazo por semana (concluídos)">
        <Colunas categorias={semanas.map(w => fmtData(w.semana).slice(0, 5))} empilhado series={[{ nome: "No prazo", valores: semanas.map(w => w.noPrazo + w.fora ? (100 * w.noPrazo) / (w.noPrazo + w.fora) : null), cor: COR.ok }, { nome: "Fora do prazo", valores: semanas.map(w => w.noPrazo + w.fora ? (100 * w.fora) / (w.noPrazo + w.fora) : null), cor: COR.erro }]} formato={x => `${Math.round(x)}%`} formatoDica={x => fmtPct(x, 1)} rotulo="Percentual de itens concluídos no prazo e fora dele, por semana" />
        <p className="mt-1 text-[11px] text-slate-500">Semanas de segunda a domingo; semana sem conclusões com prazo fica em branco.</p>
      </Card>
      <Card title="Entrada de demanda (itens abertos por semana)">
        <Linhas categorias={entrada.map(w => fmtData(w.semana).slice(0, 5))} series={[{ nome: "Itens abertos", valores: entrada.map(w => w.n), cor: COR.acao, area: true }]} zero formato={x => fmtNumero(x)} rotulo="Itens abertos por semana" />
      </Card>
    </div>

    <Card title="Por processo" className="mt-4">
      <BarrasH rotulo="Itens em andamento por processo e situação" largRotulo="13rem" itens={ordem.map(r => ({ chave: r.fluxo, rotulo: FLUXOS[r.fluxo].nome, href: qs({ fluxo: r.fluxo }), valor: r.abertos, texto: `${r.abertos} em andamento${r.vencidos ? ` · ${r.vencidos} vencido(s)` : ""}`, segmentos: [{ valor: r.noPrazo, cor: COR.ok, rotulo: "No prazo" }, { valor: r.emRisco, cor: COR.aviso, rotulo: "Em risco" }, { valor: r.vencidos, cor: COR.erro, rotulo: "Vencidos" }, { valor: r.semPrazo, cor: "#cbd5e1", rotulo: "Sem prazo" }] }))} formato={x => fmtNumero(x)} />
      <div className="mt-4 overflow-x-auto [-webkit-overflow-scrolling:touch]"><table className="w-full min-w-[760px] text-left text-xs sm:text-sm">
        <thead className="bg-mist text-xs text-slate-600"><tr>{["Processo", "Em andamento", "No prazo", "Em risco", "Vencidos", "Sem prazo", "Concluídos", "No prazo (concl.)", "Ciclo médio", "Mais antigo"].map((h, i) => <th key={h} className={`whitespace-nowrap px-2 py-2 font-medium sm:px-3 ${i === 0 ? "sticky left-0 z-[1] bg-mist" : "text-right"}`}>{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{ordem.map(r => { const p = r.concluidosComPrazo ? (100 * r.concluidosNoPrazo) / r.concluidosComPrazo : null; return (
          <tr key={r.fluxo}><th scope="row" className="sticky left-0 z-[1] bg-white px-2 py-2 text-left font-medium sm:px-3"><Link className="text-acao hover:underline" href={qs({ fluxo: r.fluxo, aba: "lista" })}>{FLUXOS[r.fluxo].nome}</Link></th>
            <td className="px-2 py-2 text-right tabular-nums sm:px-3">{r.abertos}</td><td className="px-2 py-2 text-right tabular-nums text-ok sm:px-3">{r.noPrazo || "·"}</td><td className="px-2 py-2 text-right tabular-nums text-aviso sm:px-3">{r.emRisco || "·"}</td><td className={`px-2 py-2 text-right tabular-nums sm:px-3 ${r.vencidos ? "font-semibold text-erro" : ""}`}>{r.vencidos || "·"}</td><td className="px-2 py-2 text-right tabular-nums text-slate-500 sm:px-3">{r.semPrazo || "·"}</td>
            <td className="px-2 py-2 text-right tabular-nums sm:px-3">{r.concluidos}</td><td className="px-2 py-2 text-right sm:px-3">{p === null ? "—" : <Selo tom={tomPct(p)} texto={fmtPct(p, 0)} />}</td><td className="px-2 py-2 text-right tabular-nums sm:px-3">{dias1(r.cicloMedioDias)}</td><td className="px-2 py-2 text-right tabular-nums sm:px-3">{r.maisAntigoDias === null ? "—" : dias1(Math.floor(r.maisAntigoDias))}</td></tr>); })}</tbody>
      </table></div>
    </Card>

    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      {escopo === null && unitId === null && unidades.length > 0 && <Card title="Por unidade">
        <div className="overflow-x-auto"><table className="w-full text-left text-xs sm:text-sm"><thead className="bg-mist text-xs text-slate-600"><tr>{["Unidade", "Em andamento", "Em risco", "Vencidos", "No prazo (concl.)"].map((h, i) => <th key={h} className={`px-3 py-2 font-medium ${i ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">{unidades.map(u => <tr key={u.nome}><td className="px-3 py-2">{u.unitId ? <Link className="text-acao hover:underline" href={qs({ unidade: u.unitId })}>{u.nome}</Link> : u.nome}</td><td className="px-3 py-2 text-right tabular-nums">{u.abertos}</td><td className="px-3 py-2 text-right tabular-nums text-aviso">{u.emRisco || "·"}</td><td className={`px-3 py-2 text-right tabular-nums ${u.vencidos ? "font-semibold text-erro" : ""}`}>{u.vencidos || "·"}</td><td className="px-3 py-2 text-right">{u.pct === null ? "—" : <Selo tom={tomPct(u.pct)} texto={fmtPct(u.pct, 0)} />}</td></tr>)}</tbody></table></div>
      </Card>}
      <Card title="Carga por responsável (em andamento)">
        {resp.length === 0 ? <p className="text-sm text-slate-500">Nenhum item com responsável nomeado.</p> : <BarrasH rotulo="Itens em andamento por responsável" largRotulo="10rem" itens={resp.map(r => ({ chave: r.nome, rotulo: r.nome, valor: r.total, texto: `${r.total}${r.vencidos ? ` · ${r.vencidos} venc.` : ""}`, segmentos: [{ valor: r.noPrazo, cor: COR.ok, rotulo: "No prazo" }, { valor: r.emRisco, cor: COR.aviso, rotulo: "Em risco" }, { valor: r.vencidos, cor: COR.erro, rotulo: "Vencidos" }, { valor: r.semPrazo, cor: "#cbd5e1", rotulo: "Sem prazo" }] }))} formato={x => fmtNumero(x)} />}
        <p className="mt-2 text-[11px] text-slate-500">Solicitações, férias, vagas, descontos e exceções aguardam o aprovador da vez e não entram aqui — veja a aba Aprovações.</p>
      </Card>
      <Card title="Onde os itens esperam mais">
        {esp.length === 0 ? <p className="text-sm text-slate-500">Nenhum item em andamento.</p> : <BarrasH rotulo="Espera média por processo e etapa" largRotulo="13rem" itens={esp.map(e => ({ chave: `${e.fluxo}|${e.etapa}`, rotulo: `${FLUXOS[e.fluxo].curto} · ${e.etapa}`, valor: e.media, cor: e.media > 15 ? COR.erro : e.media > 5 ? COR.aviso : COR.acao, texto: `${dias1(e.media)} · ${e.n} item(ns)` }))} formato={x => dias1(x)} />}
        <p className="mt-2 text-[11px] text-slate-500">Idade média dos itens em andamento em cada etapa (do mais crítico para o menos: idade × volume).</p>
      </Card>
      {gargalos && gargalos.etapas.length > 0 && <Card title="Gargalos das aprovações (tempo de decisão por etapa)">
        <BarrasH rotulo="Tempo médio de decisão por etapa" largRotulo="13rem" itens={gargalos.etapas.slice(0, 8).map(g => ({ chave: g.chave, rotulo: g.chave, valor: g.media, cor: g.prazo !== null && g.media > g.prazo ? COR.erro : COR.acao, texto: `${dias1(g.media)}${g.prazo !== null ? ` · prazo ${dias1(g.prazo)}` : ""}`, sub: `${g.n} decisão(ões)` }))} formato={x => dias1(x)} />
      </Card>}
    </div>
  </>;
}

function Lista({ insts, sit, agora, sp, qs }: { insts: Instancia[]; sit: Map<Instancia, Situacao>; agora: number; sp: Record<string, string | undefined>; qs: (e: Record<string, string | number | null | undefined>) => string }) {
  const filtros: { chave: string; rotulo: string; ok: (s: Situacao, i: Instancia) => boolean }[] = [
    { chave: "ATENCAO", rotulo: "Vencidos e em risco", ok: s => s === "VENCIDO" || s === "EM_RISCO" },
    { chave: "VENCIDO", rotulo: "Vencidos", ok: s => s === "VENCIDO" }, { chave: "EM_RISCO", rotulo: "Em risco", ok: s => s === "EM_RISCO" }, { chave: "NO_PRAZO", rotulo: "No prazo", ok: s => s === "NO_PRAZO" },
    { chave: "SEM_PRAZO", rotulo: "Sem prazo", ok: s => s === "SEM_PRAZO" }, { chave: "ABERTOS", rotulo: "Todos em andamento", ok: (_, i) => i.concluido === null },
    { chave: "FORA", rotulo: "Concluídos fora do prazo", ok: s => s === "CONCLUIDO_FORA" }, { chave: "CONCLUIDOS", rotulo: "Todos os concluídos", ok: (_, i) => i.concluido !== null },
  ];
  const f = filtros.find(x => x.chave === sp.sit) ?? filtros[0];
  const lista = insts.filter(i => f.ok(sit.get(i)!, i)).sort((a, b) => { const pa = a.prazo ?? Infinity, pb = b.prazo ?? Infinity; return a.concluido === null && b.concluido === null ? pa - pb || a.aberto - b.aberto : (b.concluido ?? 0) - (a.concluido ?? 0); });
  const max = 300;
  return <>
    <div className="mb-3 flex flex-wrap gap-1.5 print:hidden">{filtros.map(x => { const n = insts.filter(i => x.ok(sit.get(i)!, i)).length; return <Link key={x.chave} href={qs({ aba: "lista", sit: x.chave })} className={`rounded-full border px-2.5 py-1 text-xs ${x.chave === f.chave ? "border-acao bg-sky-50 font-semibold text-navy" : "border-line text-slate-600 hover:bg-mist"}`}>{x.rotulo} <span className="tabular-nums text-slate-500">{n}</span></Link>; })}</div>
    <div className="overflow-x-auto rounded-md border border-line bg-white [-webkit-overflow-scrolling:touch]"><table className="w-full min-w-[860px] text-left text-xs sm:text-sm">
      <thead className="bg-mist text-xs text-slate-600"><tr>{["Situação", "Processo", "Item", "Unidade", "Etapa", "Responsável", "Aberto em", "Prazo", "Folga / atraso"].map((h, i) => <th key={h} className={`whitespace-nowrap px-2 py-2 font-medium sm:px-3 ${i === 2 ? "sticky left-0 z-[1] bg-mist" : ""}`}>{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-line">
        {lista.length === 0 ? <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-500">Nada nesta situação.</td></tr> : lista.slice(0, max).map(i => { const st = sit.get(i)!; const ref = i.concluido ?? agora; const folga = i.prazo === null ? null : (i.prazo - ref) / DIA; return (
          <tr key={`${i.fluxo}${i.id}`}>
            <td className="whitespace-nowrap px-2 py-2 sm:px-3"><Selo tom={SITUACAO_TOM[st]} texto={SITUACAO_LABEL[st]} /></td>
            <td className="whitespace-nowrap px-2 py-2 text-slate-600 sm:px-3">{FLUXOS[i.fluxo].curto}{i.grupo ? <span className="block text-[11px] text-slate-400">{i.grupo}</span> : null}</td>
            <th scope="row" className="sticky left-0 z-[1] max-w-[18rem] bg-white px-2 py-2 text-left font-medium sm:px-3"><Link href={i.href} className="line-clamp-2 text-acao hover:underline">{i.titulo}</Link></th>
            <td className="whitespace-nowrap px-2 py-2 sm:px-3">{i.unidade ?? "Rede"}</td>
            <td className="px-2 py-2 sm:px-3">{i.etapa}</td>
            <td className="whitespace-nowrap px-2 py-2 sm:px-3">{i.responsavel ?? <span className="text-slate-400">—</span>}</td>
            <td className="whitespace-nowrap px-2 py-2 tabular-nums sm:px-3">{fmtData(dataCurta(i.aberto))}</td>
            <td className="whitespace-nowrap px-2 py-2 tabular-nums sm:px-3">{i.prazo === null ? "—" : fmtData(dataCurta(i.prazo))}</td>
            <td className={`whitespace-nowrap px-2 py-2 tabular-nums sm:px-3 ${folga !== null && folga < 0 ? "font-medium text-erro" : ""}`}>{folga === null ? "—" : folga < 0 ? `${dias1(Math.ceil(-folga))} de atraso` : i.concluido !== null ? "no prazo" : `${dias1(Math.floor(folga))} de folga`}</td>
          </tr>); })}
      </tbody>
    </table></div>
    {lista.length > max && <p className="mt-2 text-xs text-slate-500">Mostrando os {max} primeiros de {lista.length}. Use os filtros ou exporte o CSV para ver todos.</p>}
  </>;
}

async function Aprovacoes({ unitId, desde, insts, sit, dias }: { unitId: number | null; desde: string; insts: Instancia[]; sit: Map<Instancia, Situacao>; dias: number }) {
  const g = await gargalosAprovacao(unitId, desde);
  const pendentes = insts.filter(i => i.concluido === null); const porTipo = new Map<string, { n: number; vencidos: number; emRisco: number }>();
  for (const i of pendentes) { const k = i.grupo ?? "Solicitação"; const x = porTipo.get(k) ?? { n: 0, vencidos: 0, emRisco: 0 }; x.n++; if (sit.get(i) === "VENCIDO") x.vencidos++; if (sit.get(i) === "EM_RISCO") x.emRisco++; porTipo.set(k, x); }
  const devolvidas = g.etapas.reduce((a, e) => a + e.devolvidas, 0);
  return <>
    <div className="mb-4 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
      <KpiCard titulo={`Decisões em ${dias} dias`} valor={fmtNumero(g.decisoes)} sub={`${devolvidas} devolução(ões) para ajuste`} />
      <KpiCard titulo="Decididas no prazo da etapa" valor={fmtPct(g.noPrazoPct, 1)} tom={tomPct(g.noPrazoPct)} sub="prazo de cada tipo de solicitação" />
      <KpiCard titulo="Tempo médio de decisão" valor={dias1(g.mediaDias)} sub="da chegada na etapa até a decisão" />
      <KpiCard titulo="Aguardando decisão agora" valor={fmtNumero(pendentes.length)} tom={pendentes.some(i => sit.get(i) === "VENCIDO") ? "ruim" : "neutro"} sub={`${pendentes.filter(i => sit.get(i) === "VENCIDO").length} vencida(s)`} />
    </div>
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title="Por etapa — onde a decisão demora">
        {g.etapas.length === 0 ? <p className="text-sm text-slate-500">Nenhuma decisão no período.</p> : <BarrasH rotulo="Tempo médio de decisão por etapa" largRotulo="14rem" itens={g.etapas.map(e => ({ chave: e.chave, rotulo: e.chave, valor: e.media, cor: e.prazo !== null && e.media > e.prazo ? COR.erro : e.prazo !== null && e.media > e.prazo * 0.75 ? COR.aviso : COR.ok, texto: `${dias1(e.media)} (máx. ${dias1(e.max)})`, sub: `${e.n} decisão(ões)${e.prazo !== null ? ` · prazo ${dias1(e.prazo)} · ${Math.round((100 * e.noPrazo) / e.n)}% no prazo` : ""}` }))} formato={x => dias1(x)} />}
        <p className="mt-2 text-[11px] text-slate-500">Vermelho: média acima do prazo da etapa · âmbar: acima de 75% do prazo.</p>
      </Card>
      <Card title="Por aprovador">
        {g.aprovadores.length === 0 ? <p className="text-sm text-slate-500">Nenhuma decisão no período.</p> : <BarrasH rotulo="Tempo médio de decisão por aprovador" largRotulo="11rem" itens={g.aprovadores.map(e => ({ chave: e.chave, rotulo: e.chave, valor: e.media, cor: e.prazo !== null && e.media > e.prazo ? COR.erro : COR.acao, texto: `${dias1(e.media)} · ${e.n}`, sub: e.devolvidas ? `${e.devolvidas} devolução(ões)` : undefined }))} formato={x => dias1(x)} />}
      </Card>
      <Card title="Aguardando decisão, por tipo" className="lg:col-span-2">
        {porTipo.size === 0 ? <p className="text-sm text-slate-500">Nenhuma solicitação aguardando decisão.</p> : <BarrasH rotulo="Solicitações aguardando decisão por tipo" largRotulo="14rem" itens={[...porTipo.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, x]) => ({ chave: k, rotulo: k, valor: x.n, texto: `${x.n}${x.vencidos ? ` · ${x.vencidos} vencida(s)` : ""}`, segmentos: [{ valor: x.n - x.vencidos - x.emRisco, cor: COR.ok, rotulo: "No prazo" }, { valor: x.emRisco, cor: COR.aviso, rotulo: "Em risco" }, { valor: x.vencidos, cor: COR.erro, rotulo: "Vencidas" }] }))} formato={x => fmtNumero(x)} />}
      </Card>
    </div>
  </>;
}

async function Ncs({ unitId, desde, dias }: { unitId: number | null; desde: string; dias: number }) {
  const n = await ncsPainel(unitId, desde);
  const encPct = n.encComPrazo ? (100 * n.encNoPrazo) / n.encComPrazo : null;
  const origens = Object.keys(NC_ORIGEM).filter(o => n.porOrigem.some(([k]) => k === o));
  const celula = (u: string, o: string): CelulaCalor => { const v = n.porUnidadeOrigem.get(`${u}|${o}`) ?? 0; return { texto: v ? String(v) : "·", tom: v === 0 ? "vazio" : v >= 5 ? "ruim" : v >= 2 ? "atencao" : "neutro" }; };
  return <>
    <div className="mb-4 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
      <KpiCard titulo="Não conformidades abertas" valor={fmtNumero(n.abertas.length)} tom={n.vencidas ? "ruim" : n.abertas.length ? "atencao" : "bom"} sub={`${n.noPrazo} no prazo · ${n.semPrazo} sem prazo`} href="/governanca/controles" />
      <KpiCard titulo="Vencidas (prazo de tratamento)" valor={fmtNumero(n.vencidas)} tom={n.vencidas ? "ruim" : "bom"} />
      <KpiCard titulo={`Encerradas em ${dias} dias`} valor={fmtNumero(n.encerradas.length)} sub={`${n.encNoPrazo} de ${n.encComPrazo} com prazo dentro dele`} />
      <KpiCard titulo="Encerradas no prazo" valor={fmtPct(encPct, 0)} tom={tomPct(encPct)} />
    </div>
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title="Abertas por responsável">{n.porResponsavel.length === 0 ? <p className="text-sm text-slate-500">Nenhuma não conformidade aberta.</p> : <BarrasH rotulo="Não conformidades abertas por responsável" itens={n.porResponsavel.map(([k, v]) => ({ chave: k, rotulo: k, valor: v, cor: COR.aviso }))} formato={x => fmtNumero(x)} />}</Card>
      <Card title="Situação atual (abertas)">{n.porStatus.length === 0 ? <p className="text-sm text-slate-500">Nenhuma não conformidade aberta.</p> : <BarrasH rotulo="Não conformidades abertas por situação" itens={NC_ABERTAS.map(st => ({ chave: st, rotulo: NC_STATUS[st] ?? st, valor: n.porStatus.find(([k]) => k === st)?.[1] ?? 0, cor: st === "ABERTA" ? COR.erro : st === "EM_TRATAMENTO" ? COR.aviso : COR.ok }))} formato={x => fmtNumero(x)} />}</Card>
      <Card title="Prazo de tratamento"><Rosca rotulo="Não conformidades por prazo" fatias={[{ rotulo: "Abertas no prazo", valor: n.noPrazo, cor: COR.ok }, { rotulo: "Abertas vencidas", valor: n.vencidas, cor: COR.erro }, { rotulo: "Abertas sem prazo", valor: n.semPrazo, cor: "#cbd5e1" }, { rotulo: "Encerradas no prazo", valor: n.encNoPrazo, cor: "#2a9d8f" }, { rotulo: "Encerradas fora do prazo", valor: n.encComPrazo - n.encNoPrazo, cor: "#d1495b" }]} centro={{ valor: fmtNumero(n.abertas.length + n.encerradas.length), rotulo: "no recorte" }} tamanho={130} /></Card>
      <Card title="Gravidade (abertas)">{n.porGravidade.length === 0 ? <p className="text-sm text-slate-500">Nenhuma não conformidade aberta.</p> : <BarrasH rotulo="Não conformidades abertas por gravidade" itens={[...n.porGravidade].sort((a, b) => Number(b[0]) - Number(a[0])).map(([k, v]) => ({ chave: k, rotulo: k === "0" ? "sem gravidade" : `gravidade ${k}`, valor: v, cor: Number(k) >= 3 ? COR.erro : Number(k) === 2 ? COR.aviso : COR.acao }))} formato={x => fmtNumero(x)} />}</Card>
    </div>
    {n.unidades.length > 0 && origens.length > 0 && <Card title={`Unidade × origem (abertas e encerradas em ${dias} dias)`} className="mt-4">
      <MapaCalor rotulo="Não conformidades por unidade e origem" cabecalho="Unidade" colunas={origens.map(o => ({ chave: o, rotulo: NC_ORIGEM[o] }))} linhas={n.unidades.map(u => ({ chave: u, rotulo: u }))} celula={celula} />
    </Card>}
    <Card title={`Abertas (${n.abertas.length})`} className="mt-4">
      {n.abertas.length === 0 ? <p className="text-sm text-slate-500">Nenhuma não conformidade aberta.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-xs sm:text-sm"><thead className="bg-mist text-xs text-slate-600"><tr>{["Não conformidade", "Origem", "Unidade", "Responsável", "Situação", "Prazo"].map(h => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{n.abertas.slice(0, 100).map(x => { const venc = x.prazo !== null && x.prazo < dataCurta(Date.now()); return <tr key={x.id}><td className="px-3 py-2"><Link href="/governanca/controles" className="text-acao hover:underline">{x.titulo}</Link></td><td className="px-3 py-2">{NC_ORIGEM[x.origem] ?? x.origem}</td><td className="px-3 py-2">{x.unidade ?? "Rede"}</td><td className="px-3 py-2">{x.responsavel ?? "—"}</td><td className="px-3 py-2">{NC_STATUS[x.status] ?? x.status}</td><td className={`whitespace-nowrap px-3 py-2 tabular-nums ${venc ? "font-medium text-erro" : ""}`}>{x.prazo ? fmtData(x.prazo) : "—"}{venc ? " · vencida" : ""}</td></tr>; })}</tbody></table></div>}
    </Card>
  </>;
}
