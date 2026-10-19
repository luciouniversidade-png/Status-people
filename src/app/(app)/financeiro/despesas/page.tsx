import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { requireSession } from "@/lib/auth";
import { Page, Card, Badge, Flash, Btn, Stat, Table, Td } from "@/components/ui";
import { BarraContexto } from "@/components/BarraContexto";
import { Treemap, Funil, type Tom } from "@/components/graficos";
import { lerContexto } from "@/lib/contexto";
import { painelDespesas, EXCECAO_ROTULO } from "@/lib/despesas";
import { fmtValorBr } from "@/lib/solicitacoes";
import { audit, fmtData, getSettings, hoje, addDays } from "@/lib/utils";
import { fmtCompacto } from "@/lib/formato";

export const dynamic = "force-dynamic";
const PERFIS = ["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE", "RH", "LEITURA"];

/** T-029 · Despesas & fila de aprovação: política embutida, fila C10 com exceções à vista, treemap do OPEX (C15), estados submetido → aprovado → pago e recorrentes com vencimento. */
export default async function Despesas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams;
  if (!PERFIS.includes(s.role)) { await audit(s, "acesso negado: despesas e aprovações", "requests", null, null, { papel: s.role }); redirect("/solicitacoes"); }
  const ctx = await lerContexto(s, sp); const cfg = await getSettings(); const d = cfg.despesas;
  const p = await painelDespesas(ctx.periodo, ctx.unitIds); const h = hoje(); const fin = ["DIRECAO", "FINANCEIRO"].includes(s.role);
  const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const soma = (xs: { valor: number | null }[]) => xs.reduce((a, x) => a + (x.valor ?? 0), 0);
  const nExc = p.emAprovacao.filter(f => (p.exc.get(f.id) ?? []).length).length;
  const atrasadas = p.aPagar.filter(f => f.concluida && f.concluida.slice(0, 10) <= addDays(h, -p.atrasoPagamento));
  const [ano, mes] = ctx.periodo.split("-").map(Number);
  const uParam = ctx.unitIds ? `&u=${ctx.unitIds.join(",")}` : "";
  const tomDe = (real: number, orc: number | undefined): Tom => !orc ? "neutro" : real <= orc ? "bom" : real <= orc * 1.1 ? "atencao" : "ruim";
  const itens = p.opex.map(o => { const orc = p.orcado.get(o.categoria); return { rotulo: o.categoria, valor: o.valor, tom: tomDe(o.valor, orc), sub: orc ? `${Math.round((100 * o.valor) / orc)}% do orçado (${fmtCompacto(orc)})` : "sem orçamento no mês", href: `/financeiro/lancamentos?ano=${ano}&m1=${mes}&m2=${mes}&cat=${encodeURIComponent(o.categoria)}${uParam}` }; });
  return (
    <Page title="Despesas e aprovações" sub={`Política embutida: aprovação por etapas e alçada por valor, lote só para o normal e exceções item a item; “paga” só com o débito conciliado no extrato. ${ctx.carimbo}.`}
      actions={<><Btn kind="ghost" href="/solicitacoes?aba=aprovar">Para eu aprovar</Btn>{fin && <Btn kind="ghost" href="/solicitacoes?aba=pagar">A pagar</Btn>}<Btn kind="ghost" href="/financeiro/projecao">Caixa projetado</Btn></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <BarraContexto ctx={ctx} voltar="/financeiro/despesas" />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Submetidas no mês" value={brl(p.estados.vsub)} hint={`${p.estados.submetidas} solicitação(ões) com valor`} />
        <Stat label="Em aprovação agora" value={brl(soma(p.emAprovacao))} hint={`${p.emAprovacao.length} na fila · ${nExc} exceção(ões)`} href="/solicitacoes?aba=aprovar" />
        <Stat label="Aprovadas a pagar" value={brl(soma(p.aPagar))} hint={`${p.aPagar.length} despesa(s)${atrasadas.length ? ` · ${atrasadas.length} há mais de ${p.atrasoPagamento} dias` : ""}`} href={fin ? "/solicitacoes?aba=pagar" : undefined} />
        <Stat label="Pagas no mês (débito conciliado)" value={brl(p.estados.vpag)} hint={`${p.estados.pagas} despesa(s)`} />
        <Stat label="Contratos recorrentes" value={brl(p.mensalRecorrente)} hint={`por mês · ${p.recorrentes.length} contrato(s) vigente(s)`} href="/operacoes/contratos" />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title="OPEX do mês por categoria" actions={<span className="text-[11px] text-slate-500">área = valor · cor = execução do orçamento</span>}>
          <Treemap rotulo={`Saídas do caixa por categoria em ${ctx.rotulo.periodo}`} itens={itens} formato={v => `R$ ${fmtCompacto(v)}`} legendaTom={[{ tom: "bom", rotulo: "dentro do orçado" }, { tom: "atencao", rotulo: "até 10% acima" }, { tom: "ruim", rotulo: "mais de 10% acima" }, { tom: "neutro", rotulo: "sem orçamento" }]} />
          <p className="mt-2 text-[11px] text-slate-500">Saídas do caixa no mês (transferências internas fora). Toque numa categoria para ver os lançamentos e os documentos.</p>
        </Card>
        <Card title="Estados do mês: submetido → aprovado → pago">
          <Funil rotulo="Despesas do mês por estado" formato={v => brl(v)} etapas={[{ rotulo: "Submetidas", valor: p.estados.vsub, sub: `${p.estados.submetidas} pedido(s)` }, { rotulo: "Aprovadas", valor: p.estados.vapr, sub: `${p.estados.aprovadas} pedido(s)` }, { rotulo: "Pagas (débito conciliado)", valor: p.estados.vpag, sub: `${p.estados.pagas} pedido(s)` }]} />
          {p.estados.rejeitadas > 0 && <p className="mt-2 text-xs text-slate-500">{p.estados.rejeitadas} rejeitada(s) no mês.</p>}
          <p className="mt-2 text-[11px] text-slate-500">“Paga” só existe com o débito do extrato vinculado — nunca por declaração.</p>
        </Card>
      </div>
      <Card title={`Fila de aprovação (${p.emAprovacao.length})`} className="mt-4" actions={<Link className="text-xs text-acao underline" href="/solicitacoes?aba=aprovar">Aprovar em lote</Link>}>
        <Table head={["Solicitação", "Unidade", "Valor", "Etapa", "Prazo", "Exceções da política"]} empty="Nada em aprovação.">
          {p.emAprovacao.map(f => { const ex = p.exc.get(f.id) ?? []; return <tr key={f.id} className={ex.length ? "bg-amber-50/50" : ""}>
            <Td><Link className="text-acao" href={`/solicitacoes/${f.id}`}>{f.numero}</Link><div className="text-xs text-slate-500 [overflow-wrap:anywhere]">{f.titulo} · {f.tipo}</div></Td><Td>{f.unidade ?? "Rede"}</Td><Td className="whitespace-nowrap tabular-nums">{fmtValorBr(f.valor)}</Td>
            <Td className="text-xs">{f.etapa}</Td><Td className={`whitespace-nowrap text-xs ${f.prazo && f.prazo < h ? "text-aviso" : ""}`}>{fmtData(f.prazo)}</Td>
            <Td>{ex.length ? <span className="flex flex-wrap gap-1">{ex.map(e => <span key={e.codigo} title={e.texto}><Badge v="PENDENTE" label={EXCECAO_ROTULO[e.codigo]} /></span>)}</span> : <span className="text-xs text-ok">normal · entra no lote</span>}</Td></tr>; })}
        </Table>
        {p.devolvidas.length > 0 && <p className="mt-2 text-xs text-slate-500">{p.devolvidas.length} devolvida(s) ao solicitante para ajuste.</p>}
      </Card>
      <Card title={`Aprovadas a pagar (${p.aPagar.length})`} className="mt-4">
        <Table head={["Solicitação", "Unidade", "Valor", "Aprovada em", "Pagamento", "Situação"]} empty="Nenhuma despesa aprovada aguardando pagamento.">
          {p.aPagar.map(f => { const velha = !!f.concluida && f.concluida.slice(0, 10) <= addDays(h, -p.atrasoPagamento); return <tr key={f.id}>
            <Td><Link className="text-acao" href={`/solicitacoes/${f.id}`}>{f.numero}</Link><div className="text-xs text-slate-500 [overflow-wrap:anywhere]">{f.titulo}</div></Td><Td>{f.unidade ?? "Rede"}</Td><Td className="whitespace-nowrap tabular-nums">{fmtValorBr(f.valor)}</Td>
            <Td className="whitespace-nowrap text-xs">{fmtData(f.concluida?.slice(0, 10) ?? null)}</Td><Td className="whitespace-nowrap text-xs">{f.previsto ? `programado ${fmtData(f.previsto)}` : "sem data"}</Td>
            <Td>{velha ? <Badge v="REJEITADA" label={`há mais de ${p.atrasoPagamento} dias`} /> : <Badge v="PENDENTE" label="a pagar" />}</Td></tr>; })}
        </Table>
        <p className="mt-2 text-[11px] text-slate-500">O Financeiro abre a solicitação e escolhe o débito do extrato (mesmo valor). As programadas entram na projeção de caixa na data; sem data, amanhã.</p>
      </Card>
      <Card title="Contratos recorrentes — próximos vencimentos" className="mt-4" actions={<Link className="text-xs text-acao underline" href="/operacoes/contratos">Contratos</Link>}>
        <Table head={["Fornecedor e objeto", "Unidade", "Valor mensal", "Próximo marco", "Situação"]} empty="Nenhum contrato vigente com valor mensal.">
          {p.recorrentes.slice(0, 12).map(c => <tr key={c.id}>
            <Td><Link className="text-acao" href={`/operacoes/contratos/${c.id}`}>{c.fornecedor}</Link><div className="text-xs text-slate-500 [overflow-wrap:anywhere]">{c.objeto}</div></Td><Td>{c.unidade ?? "Rede"}</Td><Td className="whitespace-nowrap tabular-nums">{fmtValorBr(c.valor_mensal)}</Td>
            <Td className="whitespace-nowrap text-xs">{c.proximo ? `${fmtData(c.proximo)} · ${c.proximo === c.proximo_reajuste ? "reajuste" : c.fim && c.proximo === addDays(c.fim, -c.aviso_previo_dias) ? "limite do aviso" : "fim do contrato"}` : "prazo indeterminado"}</Td>
            <Td className="text-xs">{c.sit.alertas.length ? c.sit.alertas.map(a => a.texto).join("; ") : "em dia"}</Td></tr>)}
        </Table>
      </Card>
      <Card title="Regras da política" className="mt-4">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Alçada por valor: as etapas de cada tipo (ex.: Direção acima de R$ 1.000 no reembolso) — Solicitações → Tipos.</li>
          <li>Lote só para o normal: até {brl(Number(d.loteAte))}{d.exigirDocumento ? ", com documento anexado" : ""}{d.excecaoOrcamento ? ", dentro do orçamento da categoria no mês" : ""}{(d.categoriasBloqueadas as string[]).length ? ` e fora das categorias ${(d.categoriasBloqueadas as string[]).join(", ")}` : ""}. O resto é exceção: decisão item a item, com trilha.</li>
          <li>Ninguém aprova a própria solicitação; cada decisão fica na linha do tempo e na auditoria (lote inclusive).</li>
          <li>Paga só com o débito do extrato (mesmo valor, a partir de 7 dias antes da aprovação); o lançamento do caixa é reclassificado para a categoria do tipo, com trilha.</li>
          <li>Competência financeira fechada bloqueia registrar ou desfazer pagamento com débito daquele mês.</li>
        </ul>
        {s.role === "DIRECAO" && <p className="mt-2 text-xs"><Link className="text-acao underline" href="/configuracoes#v25-despesas">Ajustar a política em Configurações</Link></p>}
        <p className="mt-1 text-[11px] text-slate-500">Recorte: {ctx.rotulo.entidade} · {ctx.rotulo.unidade} · {ctx.rotulo.periodo}.</p>
      </Card>
    </Page>
  );
}
