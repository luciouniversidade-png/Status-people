import Link from "@/components/Link";
import { requireFinanceiro, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Flash, Field, Select, Btn } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { Linhas, KpiCard, Colunas, COR } from "@/components/graficos";
import { caixaProjetado } from "@/lib/fpa";
import { fmtReais, fmtPct, fmtEixo } from "@/lib/formato";
import { fmtData } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Caixa projetado para 30, 60 e 90 dias, com faixa entre o cenário pessimista e o otimista. */
export default async function Projecao({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireFinanceiro(); const sp = await searchParams; const escopo = scopeUnit(s);
  const units = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`;
  const unitId = escopo ?? (units.some(u => u.id === Number(sp.unidade)) ? Number(sp.unidade) : null);
  const p = await caixaProjetado(unitId);
  const nomeU = unitId ? units.find(u => u.id === unitId)?.nome : "Rede";
  const dd = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  return (
    <Page title="Caixa projetado" sub={`${nomeU} · próximos 90 dias a partir de hoje. Entradas: ${p.usaTitulos ? `títulos a vencer × taxa de recebimento dos últimos 6 meses (${fmtPct(100 * p.taxa, 1)})` : "média das entradas dos últimos 3 meses (sem títulos importados para o período)"}. Saídas: orçamento de despesas (sem orçamento, a média dos últimos 3 meses).`}
      actions={<div className="flex gap-2 print:hidden"><Btn kind="ghost" href={`/financeiro/orcamento${unitId ? `?unidade=${unitId}` : ""}`}>Orçado × realizado</Btn><Btn kind="ghost" href="/financeiro/caixa">Fluxo de caixa</Btn><PrintButton /></div>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {!escopo && <form className="mb-4 flex items-end gap-2 print:hidden"><Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Rede</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Btn kind="ghost">Ver</Btn></form>}
      {p.saldoHoje === null ? <Card><p className="text-sm">Para projetar o caixa, informe o <b>saldo inicial do mês</b> {p.semSaldo.length > 1 || !unitId ? `de ${p.semSaldo.map(id => units.find(u => u.id === id)?.nome).join(", ")}` : "desta unidade"} em <Link className="text-acao underline" href="/financeiro/caixa">Fluxo de caixa</Link>. A projeção da rede só sai com o saldo de todas as unidades.</p></Card> : <>
        <div className="mb-4 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
          <KpiCard titulo="Saldo hoje" valor={fmtReais(p.saldoHoje, true)} sub="saldo inicial do mês + movimentos até hoje" tom="neutro" />
          {p.marcos.map(m => <KpiCard key={m.dias} titulo={`Em ${m.dias} dias (${fmtData(m.ate)})`} valor={fmtReais(m.saldo, true)} tom={(m.saldoMin ?? 0) < 0 ? "ruim" : (m.saldo ?? 0) < p.saldoHoje! ? "atencao" : "bom"} sub={`entram ${fmtReais(m.entradas, true)} · saem ${fmtReais(m.saidas, true)}`} meta={{ texto: `faixa ${fmtReais(m.saldoMin, true)} a ${fmtReais(m.saldoMax, true)}`, tom: (m.saldoMin ?? 0) < 0 ? "ruim" : "neutro" }} />)}
        </div>
        {p.menor && p.menor.min < 0 && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-erro">No cenário pessimista o caixa fica negativo na semana até {fmtData(p.menor.ate)} ({fmtReais(p.menor.min, true)}). Antecipe a cobrança ou reprograme pagamentos.</div>}
        <Card title="Saldo projetado por semana">
          <Linhas categorias={p.semanas.map(w => dd(w.ate))} series={[{ nome: "Saldo provável", valores: p.semanas.map(w => w.saldo), cor: COR.acao, area: true }]} faixa={{ min: p.semanas.map(w => w.min), max: p.semanas.map(w => w.max), rotulo: `Faixa: recebimento entre ${Math.round(p.pess * 100)}% e ${Math.round(p.otim * 100)}% do esperado` }} formato={fmtEixo("R$")} formatoDica={x => fmtReais(x)} tamanho="inteiro" rotulo="Saldo de caixa projetado por semana" />
        </Card>
        <Card title="Entradas e saídas previstas por semana" className="mt-4">
          <Colunas categorias={p.semanas.map(w => dd(w.ate))} series={[{ nome: "Entradas", valores: p.semanas.map(w => w.entradas), cor: COR.ok }, { nome: "Saídas", valores: p.semanas.map(w => w.saidas), cor: COR.erro }]} formato={fmtEixo("R$")} formatoDica={x => fmtReais(x)} tamanho="inteiro" rotulo="Entradas e saídas previstas por semana" />
          <p className="mt-2 text-xs text-slate-500">Títulos em aberto a vencer nos próximos 90 dias: {fmtReais(p.titulos90, true)}. Despesas aprovadas a pagar: {p.compromissos.n ? <>{p.compromissos.n} ({fmtReais(p.compromissos.total, true)}), {p.compromissos.programadas} com data programada — entram na data (sem data: amanhã) e abatem o orçamento da categoria no mês (<Link className="text-acao underline" href="/financeiro/despesas">Despesas</Link>)</> : "nenhuma"}. Os cenários estão em Configurações → Insights. Projeção gerencial — não substitui a conciliação bancária.</p>
        </Card>
      </>}
    </Page>
  );
}
