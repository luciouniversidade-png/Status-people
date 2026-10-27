import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Badge, Flash, Btn, Stat, Table, Td, Field, Input, Select } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { BarraContexto } from "@/components/BarraContexto";
import { Colunas, BarrasH, COR } from "@/components/graficos";
import { lerContexto } from "@/lib/contexto";
import { audit, fmtData, getSettings, addDays } from "@/lib/utils";
import { fmtCompacto } from "@/lib/formato";
import { proximoDiaUtil } from "@/lib/parcelas";
import { painelContasPagar, sugestoesBaixa, situacaoParcela, veCP, operaCP, numeroCP, opcoesFeriado, CP_STATUS, FILTROS_SIT, POR_PAGINA, NATUREZAS, ehNatureza } from "@/lib/contas-pagar";
import { confirmarSugestoes, programarParcelas, desprogramarParcela } from "./actions";

export const dynamic = "force-dynamic";
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number | null) => v === null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const ABAS: Record<string, string> = { parcelas: "Parcelas", titulos: "Títulos", programacao: "Programação de pagamentos", fornecedores: "Fornecedores" };

/** v27 · Contas a pagar: vencimentos, atrasos, retidas, programação e pagos (com o débito do extrato), aging, orçado × pago × comprometido, competência e fornecedores. */
export default async function ContasAPagar({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams;
  if (!veCP(s)) { await audit(s, "acesso negado: contas a pagar", "payables", null, null, { papel: s.role }); redirect("/financeiro"); }
  const ctx = await lerContexto(s, sp); const cfg = await getSettings(); const opera = operaCP(s);
  const sit = sp.sit && sp.sit in FILTROS_SIT ? sp.sit : "abertas"; const aba = sp.aba && sp.aba in ABAS ? sp.aba : "parcelas";
  const f = { sit, cat: sp.cat && (cfg.financeiro.categoriasSaida as string[]).includes(sp.cat) ? sp.cat : null, q: sp.q?.trim().slice(0, 80) || null, de: /^\d{4}-\d{2}-\d{2}$/.test(sp.de ?? "") ? sp.de! : null, ate: /^\d{4}-\d{2}-\d{2}$/.test(sp.ate ?? "") ? sp.ate! : null, pag: Number(sp.pag) || 1, nat: sp.nat && ehNatureza(sp.nat) ? sp.nat : null };
  const escopo = { unitIds: ctx.unitIds, entidadeId: ctx.entidadeId, unitId: ctx.unitId };
  const [p, sug, contas] = await Promise.all([painelContasPagar(escopo, ctx.periodo, f), opera ? sugestoesBaixa(escopo) : Promise.resolve([]),
    opera ? sql<{ id: number; apelido: string; unidade: string | null }[]>`SELECT a.id, a.apelido, u.nome AS unidade FROM bank_accounts a LEFT JOIN units u ON u.id=a.unit_id WHERE a.ativo ${ctx.unitIds === null ? sql`` : sql`AND (a.unit_id IS NULL OR a.unit_id = ANY(${ctx.unitIds}::int[]))`} ORDER BY a.apelido` : Promise.resolve([])]);
  const k = p.k; const unicos = sug.filter(x => x.unico); const ambiguos = sug.filter(x => !x.unico); const ind = p.indicadores;
  const qs = (o: Record<string, string | null | undefined>) => { const u = new URLSearchParams(); const base = { aba, sit, cat: f.cat, q: f.q, de: f.de, ate: f.ate, nat: f.nat, ...o }; for (const [a, b] of Object.entries(base)) if (b) u.set(a, b); return `/financeiro/contas-a-pagar?${u.toString()}`; };
  const c = cfg.contasPagar; const locais = (c.feriadosLocais as string[]).map(x => x.split("-").reverse().join("/"));
  const proxUtil = proximoDiaUtil(addDays(p.h, 1), opcoesFeriado(cfg));
  const programaveis = p.lista.filter(x => x.status === "A_PAGAR" && x.payable_status === "ATIVO" && !x.retida);
  type Prog = (typeof p.programacao)[number]; const porData = new Map<string, Prog[]>(); for (const x of p.programacao) { const d = x.programado_para!; if (!porData.has(d)) porData.set(d, []); porData.get(d)!.push(x); }
  const vencidasAging = p.aging.filter(a => a.vencida); const aVencerAging = p.aging.filter(a => !a.vencida);
  return (
    <Page title="Contas a pagar" sub={`Títulos parcelados ou recorrentes · alçada, orçamento e dupla checagem · programação financeira · baixa só com o débito do extrato. ${ctx.carimbo}.`}
      actions={<>{opera && <Btn href="/financeiro/contas-a-pagar/nova">Nova conta a pagar</Btn>}<Btn kind="ghost" href={`/api/export/contas-a-pagar?sit=${sit}${f.cat ? `&cat=${encodeURIComponent(f.cat)}` : ""}${f.nat ? `&nat=${f.nat}` : ""}${ctx.unitId ? `&unidade=${ctx.unitId}` : ""}`}>Exportar CSV</Btn><Btn kind="ghost" href="/financeiro/projecao">Caixa projetado</Btn><Btn kind="ghost" href="/financeiro/despesas">Despesas</Btn></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <BarraContexto ctx={ctx} voltar="/financeiro/contas-a-pagar" notaPeriodo="o período vale para “pagas no mês” e para o orçado × pago" />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Vencidas sem baixa" value={<span className={k.venc_n ? "text-erro" : "text-ok"}>{brl(k.venc_v)}</span>} hint={`${k.venc_n} parcela(s)`} href={qs({ sit: "vencidas", aba: "parcelas" })} />
        <Stat label="Vencem hoje" value={<span className={k.hoje_n ? "text-aviso" : ""}>{brl(k.hoje_v)}</span>} hint={`${k.hoje_n} parcela(s) · programado p/ hoje ${brl(k.prog_hoje_v)}`} href={qs({ sit: "hoje", aba: "parcelas" })} />
        <Stat label="Próximos 7 dias" value={brl(k.d7_v)} hint={`${k.d7_n} parcela(s)${k.aprog_n ? ` · ${k.aprog_n} sem programação` : ""}`} href={qs({ sit: "aprogramar", aba: "parcelas" })} />
        <Stat label="Próximos 30 dias" value={brl(k.d30_v)} hint={`${k.d30_n} parcela(s)`} href={qs({ sit: "30d", aba: "parcelas" })} />
        <Stat label={`Pagas em ${ctx.rotulo.periodo}`} value={brl(k.pag_v)} hint={`${k.pag_n} parcela(s)${k.jur_v ? ` · ${brl(k.jur_v)} de juros/multa` : ""}${k.man_n ? ` · ${k.man_n} baixa(s) manual(is)` : ""}`} href={qs({ sit: "pagas", aba: "parcelas" })} />
        <Stat label="Aguardando aprovação" value={<span className={k.apr_n ? "text-aviso" : ""}>{k.apr_n}</span>} hint={k.apr_n ? `título(s) · ${brl(k.apr_v)} em parcelas` : "nada na fila"} href={qs({ sit: "aprovacao", aba: "parcelas" })} />
      </div>
      {opera && sug.length > 0 && <Card title={`Débitos do extrato que batem com parcelas (${sug.length})`} className="mb-4" actions={<span className="text-[11px] text-slate-500">mesmo valor · até {Number(c.janelaExtratoDias)} dias do vencimento ou da programação · débito sem vínculo</span>}>
        <form action={confirmarSugestoes}>
          <input type="hidden" name="voltar" value={qs({})} />
          <Table head={["", "Parcela", "Vencimento", "Valor", "Débito no extrato"]}>
            {sug.map(x => <tr key={x.inst} className={x.unico ? "" : "bg-amber-50/50"}>
              <Td>{x.unico ? <input type="checkbox" name="par" value={`${x.inst}:${x.line}`} defaultChecked aria-label={`Confirmar ${numeroCP(x.numero)} parcela ${x.parcela}`} /> : <span className="text-xs text-aviso" title="mais de um débito possível">?</span>}</Td>
              <Td><Link className="font-medium text-acao" href={`/financeiro/contas-a-pagar/${x.payable}#p${x.inst}`}>{numeroCP(x.numero)} · {x.parcela}/{x.parcelas}</Link><div className="text-xs text-slate-500 [overflow-wrap:anywhere]">{x.fornecedor} · {x.descricao}</div></Td>
              <Td className="whitespace-nowrap text-xs">{fmtData(x.vencimento)}</Td><Td className="whitespace-nowrap tabular-nums">{brl(x.valor)}</Td>
              <Td className="text-xs">{fmtData(x.data)} · {x.conta}<div className="text-[11px] text-slate-500 [overflow-wrap:anywhere]">{x.historico}{!x.unico ? ` · ${x.alternativas ? `+${x.alternativas} débito(s) possível(is)` : "o débito também serve a outra parcela"} — abra e escolha` : ""}</div></Td></tr>)}
          </Table>
          {unicos.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-2"><Btn small pendingText="Conciliando…">Confirmar as baixas marcadas ({unicos.length})</Btn><span className="text-[11px] text-slate-500">Cada par passa pela mesma conferência da baixa individual (valor, unidade, competência, retenção e segregação).</span></div>}
          {ambiguos.length > 0 && <p className="mt-1 text-[11px] text-aviso">{ambiguos.length} parcela(s) com mais de um débito possível: abra o título e escolha qual pagou.</p>}
        </form>
      </Card>}
      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title="Agenda — próximas 8 semanas">
          <Colunas rotulo="Valor a pagar por semana" categorias={p.agenda.map(a => a.rotulo)} series={[{ nome: "A pagar", valores: p.agenda.map(a => a.valor) }]} corValor={(_, i) => i === 0 ? COR.erro : undefined} formato={v => fmtCompacto(v)} formatoDica={v => brl(v)} legenda={false} tamanho="meio" />
          <p className="mt-1 text-[11px] text-slate-500">Em aberto: {brl(k.aberto_v)} em {k.aberto_n} parcela(s). Vencidas em vermelho.</p>
        </Card>
        <Card title="Aging — vencidas × a vencer">
          <table className="w-full text-xs"><thead className="text-[11px] text-slate-500"><tr><th className="py-1 text-left font-medium">Faixa</th><th className="py-1 text-right font-medium">Parcelas</th><th className="py-1 text-right font-medium">Valor</th></tr></thead>
            <tbody className="divide-y divide-line">
              <tr><td colSpan={3} className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-erro">Vencidas há</td></tr>
              {vencidasAging.map(a => <tr key={a.chave}><td className="py-1">{a.rotulo}</td><td className="py-1 text-right tabular-nums">{a.n}</td><td className={`py-1 text-right tabular-nums ${a.valor ? "font-medium text-erro" : "text-slate-400"}`}>{brl(a.valor)}</td></tr>)}
              <tr><td colSpan={3} className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-acao">A vencer em</td></tr>
              {aVencerAging.map(a => <tr key={a.chave}><td className="py-1">{a.rotulo}</td><td className="py-1 text-right tabular-nums">{a.n}</td><td className="py-1 text-right tabular-nums">{brl(a.valor)}</td></tr>)}
            </tbody></table>
          {k.ret_n > 0 && <p className="mt-2 text-[11px] text-aviso"><Link className="underline" href={qs({ sit: "retidas", aba: "parcelas" })}>{k.ret_n} parcela(s) retida(s) em contestação</Link> · {brl(k.ret_v)} — fora da programação.</p>}
        </Card>
        <Card title="Em aberto por plano (categoria)">
          {p.porCategoria.length === 0 ? <p className="text-sm text-slate-500">Nada em aberto.</p> : <BarrasH rotulo="Em aberto por categoria" itens={p.porCategoria.map(x => ({ rotulo: x.categoria, valor: x.valor, sub: `${x.n} parcela(s)${x.vencido ? ` · ${brl(x.vencido)} vencido` : ""}`, href: qs({ cat: x.categoria, sit: "abertas", aba: "parcelas" }), cor: x.vencido ? COR.erro : undefined }))} formato={v => `R$ ${fmtCompacto(v)}`} largRotulo="10rem" />}
        </Card>
      </div>
      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card title={`Orçado × pago × a pagar — ${ctx.rotulo.periodo}`} actions={<Link className="text-xs text-acao underline" href="/financeiro/orcamento">FP&A</Link>}>
          {p.orcamento.length === 0 ? <p className="text-sm text-slate-500">Sem orçamento lançado para o período nem parcelas no mês.</p> :
            <Table head={["Plano", "Orçado", "Pago (caixa)", "A pagar no mês", "Livre"]}>
              {p.orcamento.slice(0, 12).map(o => <tr key={o.categoria}><Td className="text-xs">{o.categoria}</Td><Td className="whitespace-nowrap text-xs tabular-nums">{o.orcado ? brl(o.orcado) : <span className="text-slate-400">sem orçamento</span>}</Td><Td className="whitespace-nowrap text-xs tabular-nums">{brl(o.pago)}</Td><Td className="whitespace-nowrap text-xs tabular-nums">{brl(o.apagar)}</Td>
                <Td className={`whitespace-nowrap text-xs font-medium tabular-nums ${!o.orcado ? "text-slate-400" : o.livre < 0 ? "text-erro" : o.livre < o.orcado * 0.1 ? "text-aviso" : "text-ok"}`}>{o.orcado ? brl(o.livre) : "—"}</Td></tr>)}
            </Table>}
          <p className="mt-1 text-[11px] text-slate-500">Livre = orçado − pago no caixa − parcelas a pagar com vencimento no mês. Negativo: o mês já estoura o plano.</p>
        </Card>
        <div className="space-y-4"><Card title="Despesa por competência (pago + a pagar)">
          <Colunas rotulo="Despesa por competência" categorias={p.competencia.map(x => x.rotulo)} series={[{ nome: "Pago", valores: p.competencia.map(x => x.pago), cor: COR.ok }, { nome: "A pagar", valores: p.competencia.map(x => x.aberto), cor: COR.acao }]} empilhado formato={v => fmtCompacto(v)} formatoDica={v => brl(v)} tamanho="meio" />
          <p className="mt-1 text-[11px] text-slate-500">Competência = mês a que a despesa se refere (definida em cada parcela), não o mês do pagamento.</p>
        </Card>
        <Card title="Natureza da despesa">
          <ul className="divide-y divide-line">
            {p.porNatureza.map(x => <li key={x.natureza} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0"><Link className="text-sm font-medium text-acao" href={qs({ nat: x.natureza, aba: "parcelas", sit: "abertas" })}>{x.rotulo}</Link>
                <div className="text-[11px] leading-snug text-slate-500">{x.dica}{(c.naturezaSempreAprova as string[]).includes(x.natureza) ? " · sempre passa pela aprovação" : ""}</div></div>
              <div className="shrink-0 text-right tabular-nums"><div className="text-sm font-semibold text-navy">{brl(x.aberto)} <span className="text-[11px] font-normal text-slate-500">em aberto</span></div>
                <div className="text-[11px] text-slate-500">{brl(x.pago12)} pagos em 12 meses · {x.titulos} título(s)</div>
                {x.aguardando > 0 && <div className="text-[11px] text-aviso">+ {brl(x.aguardando)} aguardando aprovação</div>}</div></li>)}
          </ul>
          <p className="mt-2 text-[11px] text-slate-500">Separa o que se repete (operação) do que fica para a escola (investimento) e do que não se repete (extraordinária) — para o orçamento do ano seguinte e a leitura do resultado.</p>
        </Card></div>
      </div>
      <Card title="Indicadores de contas a pagar (12 meses)" className="mb-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Pagas até o vencimento" value={<span className={ind.pontualidade === null ? "" : ind.pontualidade >= 95 ? "text-ok" : ind.pontualidade >= 85 ? "text-aviso" : "text-erro"}>{pct(ind.pontualidade)}</span>} hint={`${ind.pagas12} parcela(s) pagas`} />
          <Stat label="Juros e multas pagos" value={<span className={ind.juros12 ? "text-erro" : "text-ok"}>{brl(ind.juros12)}</span>} hint={ind.valor12 ? `${pct((100 * ind.juros12) / ind.valor12)} do pago` : "nada pago"} />
          <Stat label="Prazo médio de aprovação" value={ind.prazoAprovacao === null ? "—" : ind.prazoAprovacao >= 1 ? `${ind.prazoAprovacao.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dia(s)` : ind.prazoAprovacao * 24 >= 1 ? `${Math.round(ind.prazoAprovacao * 24)} h` : "< 1 h"} hint={`${ind.aprovadas} título(s) aprovados por outra pessoa`} />
          <Stat label="Baixas manuais" value={<span className={ind.manuais12 ? "text-aviso" : "text-ok"}>{ind.manuais12}</span>} hint={ind.pctManuais === null ? "sem baixas" : `${pct(ind.pctManuais)} das baixas · meta 0`} href={qs({ sit: "manuais", aba: "parcelas" })} />
          <Stat label="Títulos sem documento" value={<span className={ind.semDoc ? "text-aviso" : "text-ok"}>{ind.semDoc}</span>} hint="sem boleto, nota fiscal ou recibo anexado" href={qs({ sit: "semdoc", aba: "parcelas" })} />
          <Stat label="A programar (7 dias)" value={<span className={k.aprog_n ? "text-aviso" : "text-ok"}>{k.aprog_n}</span>} hint={k.aprog_n ? `${brl(k.aprog_v)} vencendo sem data de pagamento` : "tudo programado"} href={qs({ sit: "aprogramar", aba: "parcelas" })} />
        </div>
      </Card>
      <Card title={<span className="flex flex-wrap gap-x-4 gap-y-1">{Object.entries(ABAS).map(([a, r]) => <Link key={a} href={qs({ aba: a })} className={aba === a ? "text-navy underline underline-offset-4" : "font-normal text-acao"}>{r}{a === "programacao" && p.programacao.length ? ` (${p.programacao.length})` : ""}</Link>)}</span>}>
        {(aba === "parcelas" || aba === "titulos" || aba === "fornecedores") && <form className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 lg:items-end">
          <input type="hidden" name="aba" value={aba} />
          {aba === "parcelas" && <Field label="Situação"><Select name="sit" defaultValue={sit}>{Object.entries(FILTROS_SIT).map(([a, b]) => <option key={a} value={a}>{b}</option>)}</Select></Field>}
          {aba !== "fornecedores" && <Field label="Plano"><Select name="cat" defaultValue={f.cat ?? ""}><option value="">Todos</option>{(cfg.financeiro.categoriasSaida as string[]).map(x => <option key={x} value={x}>{x}</option>)}</Select></Field>}
          {aba !== "fornecedores" && <Field label="Natureza"><Select name="nat" defaultValue={f.nat ?? ""}><option value="">Todas</option>{Object.entries(NATUREZAS).map(([k2, x]) => <option key={k2} value={k2}>{x.rotulo}</option>)}</Select></Field>}
          <Field label="Busca" className={aba === "parcelas" ? "" : "lg:col-span-2"}><Input name="q" defaultValue={f.q ?? ""} placeholder="Fornecedor, descrição, documento, CP-0001" /></Field>
          {aba === "parcelas" && <><Field label="Vence de"><Input name="de" type="date" defaultValue={f.de ?? ""} /></Field><Field label="até"><Input name="ate" type="date" defaultValue={f.ate ?? ""} /></Field></>}
          <div className="flex gap-2"><Btn small kind="ghost">Filtrar</Btn>{(f.cat || f.q || f.de || f.ate || f.nat || sit !== "abertas") && <Btn small kind="ghost" href={`/financeiro/contas-a-pagar?aba=${aba}`}>Limpar</Btn>}</div>
        </form>}
        {aba === "parcelas" && <form action={programarParcelas}>
          <input type="hidden" name="voltar" value={qs({})} />
          <Table head={[opera && programaveis.length ? "Prog." : "", { label: "Vencimento", className: "hidden sm:table-cell" }, "Título", { label: "Parcela", className: "hidden sm:table-cell" }, { label: "Plano", className: "hidden sm:table-cell" }, "Valor", { label: "Situação", className: "hidden sm:table-cell" }]} empty="Nenhuma parcela neste filtro.">
            {p.lista.map(x => { const st = situacaoParcela(x, p.h, p.alerta); const pode = opera && x.status === "A_PAGAR" && x.payable_status === "ATIVO" && !x.retida; return <tr key={x.id} className={st.codigo === "VENCIDA" ? "bg-red-50/40" : ""}>
              <Td>{pode ? <input type="checkbox" name="ids" value={x.id} aria-label={`Programar ${numeroCP(x.numero)} parcela ${x.parcela}`} /> : null}</Td>
              <Td className="hidden whitespace-nowrap text-xs sm:table-cell">{fmtData(x.vencimento)}{x.programado_para && <div className="text-[11px] text-acao">pagar {fmtData(x.programado_para)}</div>}</Td>
              <Td>{/* celular: vencimento, parcela e situação na mesma célula (as colunas próprias aparecem a partir do tablet) */}
                <div className="mb-0.5 text-[11px] sm:hidden"><b className="tabular-nums">{fmtData(x.vencimento)}</b> · {x.parcela}/{x.parcelas}{x.recorrente ? " ↻" : ""}{x.programado_para && <span className="text-acao"> · pagar {fmtData(x.programado_para)}</span>}</div>
                <Link className="font-medium text-acao" href={`/financeiro/contas-a-pagar/${x.payable_id}#p${x.id}`}>{numeroCP(x.numero)} · {x.fornecedor}</Link><div className="line-clamp-2 text-xs text-slate-500 [overflow-wrap:anywhere] sm:line-clamp-none">{x.descricao} · {x.unidade ?? (x.entidade ? `Rede · ${x.entidade}` : "Rede")}{x.numero_documento ? ` · ${x.tipo_documento} ${x.numero_documento}` : ` · ${x.tipo_documento}`}{x.tem_boleto ? " · boleto ✓" : ""}{x.conta_codigo ? <span className="font-mono"> · {x.conta_codigo}</span> : null}</div><div className="mt-1 sm:hidden"><Badge v={st.tom} label={st.rotulo} /></div></Td>
              <Td className="hidden whitespace-nowrap text-xs tabular-nums sm:table-cell">{x.parcela}/{x.parcelas}{x.recorrente ? " ↻" : ""}{x.competencia && <div className="text-[11px] text-slate-500">comp. {x.competencia.split("-").reverse().join("/")}</div>}</Td><Td className="hidden text-xs sm:table-cell">{x.categoria}</Td>
              <Td className="whitespace-nowrap tabular-nums">{brl(x.valor)}{x.status === "PAGA" && x.valor_pago !== null && Math.abs(x.valor_pago - x.valor) >= 0.005 ? <div className="text-[11px] text-slate-500">pago {brl(x.valor_pago)}</div> : null}</Td>
              <Td className="hidden sm:table-cell"><Badge v={st.tom} label={st.rotulo} />{x.status === "PAGA" && <div className="mt-0.5 text-[11px] text-slate-500">{fmtData(x.pago_em)}{x.baixa_manual ? <span className="text-aviso"> · baixa manual</span> : " · débito conciliado"}</div>}</Td></tr>; })}
          </Table>
          {p.listaTotal.n > 0 && <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500"><span>{p.listaTotal.n} parcela(s) no filtro · {brl(p.listaTotal.v)} · ↻ recorrente{p.paginas > 1 ? ` · página ${p.pagina} de ${p.paginas}` : ""}</span>
            {p.paginas > 1 && <span className="flex gap-2">{p.pagina > 1 && <Link className="text-acao underline" href={qs({ pag: String(p.pagina - 1) })}>← anteriores</Link>}{p.pagina < p.paginas && <Link className="text-acao underline" href={qs({ pag: String(p.pagina + 1) })}>próximas {POR_PAGINA} →</Link>}</span>}</div>}
          {opera && programaveis.length > 0 && <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md border border-line bg-mist p-2">
            <span className="self-center text-xs font-medium text-navy">Programar as marcadas:</span>
            <Field label="Pagar em"><Input name="data" type="date" defaultValue={proxUtil} min={p.h} required className="!w-40" /></Field>
            <Field label="Conta"><Select name="contaId" defaultValue="" className="!w-48"><option value="">— a definir —</option>{contas.map(a => <option key={a.id} value={a.id}>{a.apelido}{a.unidade ? ` · ${a.unidade}` : ""}</option>)}</Select></Field>
            <Btn small pendingText="Programando…">Programar</Btn><span className="self-center text-[11px] text-slate-500">Retidas e não aprovadas ficam de fora. A data entra no caixa projetado e no borderô.</span>
          </div>}
        </form>}
        {aba === "titulos" && <Table head={["Título", { label: "Plano", className: "hidden sm:table-cell" }, { label: "Parcelas", className: "hidden sm:table-cell" }, { label: "Compromisso", className: "hidden sm:table-cell" }, { label: "Pago", className: "hidden sm:table-cell" }, "Em aberto", { label: "Próximo vencimento", className: "hidden sm:table-cell" }, { label: "Situação", className: "hidden sm:table-cell" }]} empty="Nenhum título.">
          {p.titulos.map(t => <tr key={t.id}>
            <Td><Link className="font-medium text-acao" href={`/financeiro/contas-a-pagar/${t.id}`}>{numeroCP(t.numero)} · {t.fornecedor}</Link><div className="text-xs text-slate-500 [overflow-wrap:anywhere]">{t.descricao} · {t.unidade ?? (t.entidade ? `Rede · ${t.entidade}` : "Rede")}{t.recorrente ? " · recorrente" : ""}{t.natureza !== "OPERACAO" && ehNatureza(t.natureza) ? <span className="font-medium text-navy"> · {NATUREZAS[t.natureza].curto}</span> : ""}{t.sem_doc ? <span className="text-aviso"> · sem documento</span> : ""}</div>
              {/* celular: parcelas, próximo vencimento e situação na mesma célula */}
              <div className="mt-1 text-[11px] text-slate-600 sm:hidden">{t.pagas}/{t.parcelas} paga(s){t.proximo ? ` · próx. ${fmtData(t.proximo)}` : ""} · total {brl(t.total)}</div><div className="mt-0.5 sm:hidden"><Badge v={CP_STATUS[t.status]?.tom ?? t.status} label={CP_STATUS[t.status]?.rotulo ?? t.status} /></div></Td>
            <Td className="hidden text-xs sm:table-cell">{t.categoria}</Td><Td className="hidden whitespace-nowrap text-xs tabular-nums sm:table-cell">{t.pagas}/{t.parcelas} paga(s)</Td>
            <Td className="hidden whitespace-nowrap tabular-nums sm:table-cell">{brl(t.total)}</Td><Td className="hidden whitespace-nowrap tabular-nums text-ok sm:table-cell">{brl(t.pago)}</Td><Td className="whitespace-nowrap tabular-nums">{brl(t.aberto)}</Td>
            <Td className="hidden whitespace-nowrap text-xs sm:table-cell">{fmtData(t.proximo)}</Td><Td className="hidden sm:table-cell"><Badge v={CP_STATUS[t.status]?.tom ?? t.status} label={CP_STATUS[t.status]?.rotulo ?? t.status} />{t.aguardando_dias !== null && <div className={`mt-0.5 text-[11px] ${t.aguardando_dias > 2 ? "text-aviso" : "text-slate-500"}`}>{t.aguardando_dias <= 0 ? "desde hoje" : t.aguardando_dias === 1 ? "há 1 dia" : `há ${t.aguardando_dias} dias`}</div>}</Td></tr>)}
        </Table>}
        {aba === "programacao" && (porData.size === 0 ? <p className="text-sm text-slate-500">Nenhum pagamento programado. Marque parcelas na aba Parcelas e escolha a data (e a conta).</p> : <div className="space-y-4">
          {[...porData.entries()].map(([d, xs]) => { const tot = xs.reduce((a, x) => a + x.valor, 0); const atrasado = d < p.h; const porConta = new Map<string, number>(); for (const x of xs) porConta.set(x.conta_programada ?? "conta a definir", (porConta.get(x.conta_programada ?? "conta a definir") ?? 0) + x.valor);
            return <section key={d} className={`rounded-md border ${atrasado ? "border-red-200" : "border-line"}`}>
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-mist px-3 py-2 text-sm"><span><b>{fmtData(d)}</b>{d === p.h ? " · hoje" : ""}{atrasado ? <span className="text-erro"> · programado e ainda sem baixa</span> : ""} · {xs.length} parcela(s) · <b>{brl(tot)}</b> <span className="text-xs text-slate-500">({[...porConta.entries()].map(([cc, v]) => `${cc}: ${brl(v)}`).join(" · ")})</span></span>
                <Btn small kind="ghost" href={`/api/export/contas-a-pagar-bordero?data=${d}${ctx.unitId ? `&unidade=${ctx.unitId}` : ""}`}>Borderô (CSV)</Btn></header>
              <Table head={["Título", { label: "Parcela", className: "hidden sm:table-cell" }, { label: "Vencimento", className: "hidden sm:table-cell" }, { label: "Conta", className: "hidden sm:table-cell" }, "Valor", ""]}>
                {xs.map(x => <tr key={x.id}><Td>{/* celular: parcela e vencimento na mesma célula */}
                <div className="mb-0.5 text-[11px] sm:hidden">{x.parcela}/{x.parcelas}{x.recorrente ? " ↻" : ""} · <span className={x.vencimento < d ? "text-erro" : ""}>vence {fmtData(x.vencimento)}{x.vencimento < d ? " (paga depois do vencimento)" : ""}</span></div>
                <Link className="font-medium text-acao" href={`/financeiro/contas-a-pagar/${x.payable_id}#p${x.id}`}>{numeroCP(x.numero)} · {x.fornecedor}</Link><div className="line-clamp-2 text-xs text-slate-500 [overflow-wrap:anywhere] sm:line-clamp-none">{x.descricao}{x.tem_boleto ? " · boleto ✓" : x.tipo_documento === "Boleto" ? <span className="text-aviso"> · sem linha digitável</span> : ` · ${x.tipo_documento}`}</div></Td>
                  <Td className="hidden whitespace-nowrap text-xs tabular-nums sm:table-cell">{x.parcela}/{x.parcelas}</Td><Td className={`hidden whitespace-nowrap text-xs sm:table-cell ${x.vencimento < d ? "text-erro" : ""}`}>{fmtData(x.vencimento)}{x.vencimento < d ? " (paga depois do vencimento)" : ""}</Td><Td className="hidden text-xs sm:table-cell">{x.conta_programada ?? "—"}</Td><Td className="whitespace-nowrap tabular-nums">{brl(x.valor)}</Td>
                  <Td>{opera && <Modal label="Tirar" title={`Tirar ${numeroCP(x.numero)} · ${x.parcela}/${x.parcelas} da programação`}><form action={desprogramarParcela} className="space-y-2"><input type="hidden" name="id" value={x.id} /><input type="hidden" name="voltar" value={qs({ aba: "programacao" })} /><p className="text-xs text-slate-600">A parcela volta a entrar no caixa projetado pelo vencimento.</p><Btn small danger>Tirar da programação</Btn></form></Modal>}</Td></tr>)}
              </Table></section>; })}
          <p className="text-[11px] text-slate-500">O borderô lista fornecedor, documento, linha digitável, vencimento e valor de cada parcela do dia — para pagar no banco. A baixa continua com o débito do extrato.</p>
        </div>)}
        {aba === "fornecedores" && <Table head={["Fornecedor", "Pago em 12 meses", { label: "Últimos 30 dias", className: "hidden sm:table-cell" }, "Em aberto", { label: "Próximo vencimento", className: "hidden sm:table-cell" }, { label: "Títulos", className: "hidden sm:table-cell" }, { label: "Planos", className: "hidden sm:table-cell" }]} empty="Nenhum fornecedor com títulos.">
          {p.fornecedores.map(x => { const varia = x.pago30ant ? (100 * (x.pago30 - x.pago30ant)) / x.pago30ant : null; return <tr key={x.fornecedor}>
            <Td><Link className="font-medium text-acao" href={qs({ aba: "parcelas", sit: "todas", q: x.fornecedor })}>{x.fornecedor}</Link>{x.recorrente && <div className="text-[11px] text-slate-500">↻ recorrente ativo</div>}{!x.supplier_id && <div className="text-[11px] text-aviso">fora do cadastro de fornecedores</div>}<div className="text-[11px] text-slate-500 sm:hidden">{x.titulos} título(s){x.proximo ? ` · próx. ${fmtData(x.proximo)}` : ""}</div></Td>
            <Td className="whitespace-nowrap tabular-nums">{brl(x.pago12)}</Td><Td className="hidden whitespace-nowrap tabular-nums sm:table-cell">{brl(x.pago30)}{varia !== null && Math.abs(varia) >= 1 && <div className={`text-[11px] ${varia > 0 ? "text-aviso" : "text-ok"}`}>{varia > 0 ? "▲" : "▼"} {pct(Math.abs(varia))} vs. 30 dias antes</div>}</Td>
            <Td className="whitespace-nowrap tabular-nums">{brl(x.aberto)}</Td><Td className="hidden whitespace-nowrap text-xs sm:table-cell">{fmtData(x.proximo)}</Td><Td className="hidden text-xs tabular-nums sm:table-cell">{x.titulos}</Td><Td className="hidden text-xs [overflow-wrap:anywhere] sm:table-cell">{x.categorias}</Td></tr>; })}
        </Table>}
      </Card>
      <Card title="Regras de contas a pagar" className="mt-4">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Alçada: compromisso total a partir de {brl(Number(c.alcadaValor))} (parcelado: o total; recorrente: a soma das parcelas) vai para quem aprova ({((cfg.alcadas.contasPagar ?? ["DIRECAO"]) as string[]).map(r => r === "DIRECAO" ? "Direção" : r === "FINANCEIRO" ? "Financeiro" : r).join(", ")}). Quem lança não aprova o próprio título.{Number(c.alcadaDuplaValor) > 0 ? ` A partir de ${brl(Number(c.alcadaDuplaValor))}, dupla checagem: duas pessoas diferentes aprovam.` : ""}</li>
          {c.exigirOrcamento && <li>Orçamento: parcela que passa do orçado da categoria no mês (realizado + comprometido + este título) ou categoria sem orçamento também pede aprovação.</li>}
          <li>Programação financeira: só título aprovado é programado (data e conta); parcela retida em contestação fica fora até ser liberada. A data programada vale para o caixa projetado e para o borderô.</li>
          <li>Dia útil: {c.ajustarDiaUtil ? "vencimento" : "quando marcado no lançamento, vencimento"} em fim de semana ou feriado bancário vai para o próximo dia útil — feriados nacionais (inclui 20/11), Sexta-feira Santa{c.carnavalSemBanco ? ", Carnaval (seg. e ter.)" : ""}{c.corpusChristiSemBanco ? ", Corpus Christi" : ""}{locais.length ? ` e locais ${locais.join(", ")}` : ""}.</li>
          <li>Documento: linha digitável do boleto e chave da NF-e têm os dígitos conferidos; o mesmo boleto ou a mesma nota não entram em dois títulos (pagamento em duplicidade bloqueado).</li>
          <li>Baixa só com o débito do extrato: parcela + juros/multa − desconto = débito; o débito não é reutilizado e o caixa vai para o plano do título.{c.segregarAprovarPagar ? " Quem aprovou não registra o pagamento (segregação de funções)." : ""} Baixa manual é exceção justificada, auditada e avisada à Direção.</li>
          <li>Competência fechada trava baixar e desfazer naquele mês. Parcelas aprovadas entram no caixa projetado (na data programada, senão no vencimento) e comprometem o orçado do mês.</li>
        </ul>
        {s.role === "DIRECAO" && <p className="mt-2 text-xs"><Link className="text-acao underline" href="/configuracoes#v27-contas">Ajustar as regras em Configurações</Link></p>}
      </Card>
    </Page>
  );
}
