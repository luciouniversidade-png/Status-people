import Link from "@/components/Link";
import { requireFinanceiro, scopeUnit, can } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Table, Td, Flash, Field, Select, Btn, Stat } from "@/components/ui";
import { fmtReais } from "@/lib/formato";
import { getSettings, hoje } from "@/lib/utils";
import { inadimplencia, receita, caixaMes, orcamentoAno, brl } from "@/lib/financeiro";
import { veTela } from "@/lib/acesso";

export const dynamic = "force-dynamic";

export default async function Financeiro({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireFinanceiro(); const sp = await searchParams; const cfg = await getSettings(); const scope = scopeUnit(s); const unitId = scope ?? (sp.unidade ? Number(sp.unidade) : null); const mes = hoje().slice(0, 7); const ano = cfg.matriculas.anoLetivo;
  const [inad, rec, cx, orc, units, [descPend]] = await Promise.all([inadimplencia(unitId), receita(ano, unitId), caixaMes(mes, unitId), orcamentoAno(Number(hoje().slice(0, 4)), unitId), scope ? Promise.resolve([]) : db.select().from(schema.units).orderBy(asc(schema.units.nome)),
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM discounts d WHERE d.status='SOLICITADO' ${unitId === null ? sql`` : sql`AND d.unit_id=${unitId}`}`]);
  // v29: cada número e alerta do painel aparece só para quem vê a tela de onde ele vem (o auxiliar não vê o resultado do gerente)
  const v = (tela: string) => veTela(s, tela);
  const alertas: string[] = []; const avisa = (tela: string, texto: string) => { if (v(tela)) alertas.push(texto); };
  if (inad.taxa90 !== null && inad.taxa90 > 8) avisa("/financeiro/inadimplencia", `Inadimplência de ${String(inad.taxa90).replace(".", ",")}% nos últimos 90 dias (acima de 8%).`);
  if (inad.acoesPendentes) avisa("/financeiro/inadimplencia", `${inad.acoesPendentes} título(s) sem a ação de cobrança que a régua pede.`);
  if (descPend.n) avisa("/financeiro/descontos", `${descPend.n} desconto(s) aguardando aprovação.`);
  if (rec.semPreco) avisa("/financeiro/receita", `${rec.semPreco} matriculado(s) ${ano} sem valor de mensalidade cadastrado — a previsão está incompleta.`);
  orc.cats.filter(c => c.tipo === "SAIDA" && c.variacao !== null && c.variacao > 10).forEach(c => avisa("/financeiro/orcamento", `${c.categoria}: ${c.variacao}% acima do orçamento no ano.`));
  if (cx.saldoFinal !== null && cx.saldoFinal < 0) avisa("/financeiro/caixa", "Caixa projetado negativo no mês.");
  try { const [d] = await sql<{ n: number; velhas: number }[]>`SELECT count(*)::int AS n, count(*) FILTER (WHERE created_at::date <= current_date - 15)::int AS velhas FROM recon_issues WHERE status='ABERTA' ${unitId === null ? sql`` : sql`AND unit_id=${unitId}`}`;
    if (d.n) avisa("/financeiro/divergencias", `${d.n} divergência(s) de conciliação em aberto${d.velhas ? `, ${d.velhas} há mais de 15 dias` : ""}.`); } catch { /* banco anterior à v25 */ }
  try { const [p] = await sql<{ n: number; velhas: number }[]>`SELECT count(*)::int AS n, count(*) FILTER (WHERE concluida_em::date <= current_date - 7)::int AS velhas FROM requests WHERE status='APROVADA' AND valor > 0 AND pago_em IS NULL ${unitId === null ? sql`` : sql`AND unit_id=${unitId}`}`;
    if (p.n) avisa("/financeiro/despesas", `${p.n} despesa(s) aprovada(s) aguardando pagamento${p.velhas ? `, ${p.velhas} aprovada(s) há mais de 7 dias` : ""} — Solicitações → A pagar.`); } catch { /* banco anterior à v25 */ }
  // v27/v28 · contas a pagar e plano de contas no painel (só para quem enxerga essas telas)
  const veCP = ["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE"].includes(s.role) && v("/financeiro/contas-a-pagar");
  if (veCP) {
    try { const j = Number(cfg.contasPagar?.alertaDias ?? 3); const h = hoje(); const fu = unitId === null ? sql`` : sql`AND p.unit_id=${unitId}`;
      const [c] = await sql<{ vencidas: number; vencendo: number; aprov: number }[]>`SELECT count(*) FILTER (WHERE i.status='A_PAGAR' AND p.status='ATIVO' AND i.vencimento < ${h}::date)::int AS vencidas,
          count(*) FILTER (WHERE i.status='A_PAGAR' AND p.status='ATIVO' AND NOT i.retida AND i.programado_para IS NULL AND i.vencimento BETWEEN ${h}::date AND (${h}::date + ${j}::int))::int AS vencendo,
          count(DISTINCT p.id) FILTER (WHERE p.status='AGUARDANDO_APROVACAO')::int AS aprov
        FROM payable_installments i JOIN payables p ON p.id=i.payable_id WHERE true ${fu}`;
      if (c.vencidas) alertas.push(`${c.vencidas} parcela(s) de contas a pagar vencida(s) sem baixa — Contas a pagar.`);
      if (c.vencendo) alertas.push(`${c.vencendo} parcela(s) de contas a pagar vencendo em até ${j} dia(s) sem programação de pagamento.`);
      if (c.aprov) alertas.push(`${c.aprov} conta(s) a pagar aguardando aprovação.`); } catch { /* banco anterior à v27 */ }
    try { const janela = Number(cfg.planoContas?.janelaClassificacaoDias ?? 120); const internas = [...(cfg.dre.internas as string[])];
      const [c] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM cash_entries WHERE tipo='SAIDA' AND conta_id IS NULL AND data >= (current_date - ${janela}::int) AND NOT (categoria = ANY(${internas})) ${unitId === null ? sql`` : sql`AND unit_id=${unitId}`}`;
      if (c.n) avisa("/financeiro/plano-de-contas", `${c.n} saída(s) dos últimos ${janela} dias sem conta do plano — Plano de contas → Classificação.`); } catch { /* banco anterior à v28 */ }
  }
  return (
    <Page title="Financeiro" sub="Camada de gestão sobre o ActiveSoft: inadimplência e régua, descontos com alçada, receita prevista × realizada, caixa consolidado, contas a pagar, orçamento e DRE gerencial."
      actions={<>{([["/financeiro/inadimplencia", "Inadimplência"], ["/financeiro/descontos", "Descontos"], ["/financeiro/receita", "Receita"], ["/financeiro/caixa", "Caixa"], ["/financeiro/recebimentos", "Recebimentos"], ["/financeiro/conciliacao", "Conciliação"], ...(["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE"].includes(s.role) ? [["/financeiro/contas-a-pagar", "Contas a pagar"], ["/financeiro/plano-de-contas", "Plano de contas"]] : []), ["/financeiro/orcamento", "Orçamento e DRE"]] as [string, string][]).filter(([h]) => v(h)).map(([h, l]) => <Btn key={h} kind="ghost" href={h}>{l}</Btn>)}{can.gerirFinanceiro(s) && <Btn href="/financeiro/importar">Importar</Btn>}</>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {!scope && <form className="mb-4 flex items-end gap-2"><Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Rede</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Btn kind="ghost">Ver</Btn></form>}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {v("/financeiro/inadimplencia") && <Stat label="Inadimplência (90 dias)" value={inad.taxa90 === null ? "—" : <span className={inad.taxa90 > 8 ? "text-erro" : inad.taxa90 > 4 ? "text-aviso" : "text-ok"}>{String(inad.taxa90).replace(".", ",")}%</span>} hint={`${brl(inad.total)} em aberto · ${inad.familias} família(s)`} href="/financeiro/inadimplencia" />}
        {v("/financeiro/receita") && <Stat label="Receita prevista/mês" value={fmtReais(rec.mensal, true)} hint={`${brl(rec.mensal)} · ${rec.alunos} matriculado(s) ${ano}${rec.semPreco ? ` · ${rec.semPreco} sem preço` : ""}`} href="/financeiro/receita" />}
        {v("/financeiro/caixa") && <><Stat label="Entradas no mês" value={fmtReais(cx.tot.entradas, true)} hint={`${brl(cx.tot.entradas)} · saídas ${brl(cx.tot.saidas)}`} href="/financeiro/caixa" />
        <Stat label="Saldo de caixa" value={cx.saldoFinal === null ? "—" : <span className={cx.saldoFinal < 0 ? "text-erro" : ""}>{fmtReais(cx.saldoFinal, true)}</span>} hint={cx.temSaldo ? `${brl(cx.saldoFinal)} · inicial + entradas − saídas` : "informe o saldo inicial do mês"} href="/financeiro/caixa" /></>}
        {v("/financeiro/orcamento") && <><Stat label="Resultado no ano" value={<span className={orc.resultado < 0 ? "text-erro" : "text-ok"}>{fmtReais(orc.resultado, true)}</span>} hint={`${brl(orc.resultado)} · entradas − saídas registradas em ${hoje().slice(0, 4)}`} href="/financeiro/orcamento" />
        <Stat label="Custo por aluno/mês" value={<span className="text-xl">{brl(orc.custoPorAlunoMensal)}</span>} hint={`pessoal + ${cfg.financeiro.encargosPct}% encargos ÷ ${orc.alunos} alunos`} /></>}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        <Card title="Alertas">{alertas.length === 0 ? <p className="text-sm text-slate-600">Nenhum alerta. Importe títulos, caixa e cadastre orçamento para o painel ganhar vida.</p> : <ul className="space-y-1 text-sm">{alertas.map((a, i) => <li key={i} className="flex gap-2"><span className="text-erro">●</span>{a}</li>)}</ul>}</Card>
        {v("/financeiro/inadimplencia") && <Card title="Aging da inadimplência"><Table head={["Faixa", "Títulos", "Valor"]}>{inad.aging.map(a => <tr key={a.faixa}><Td>{a.faixa}</Td><Td>{a.n}</Td><Td className="tabular-nums">{brl(a.valor)}</Td></tr>)}</Table></Card>}
        {!scope && v("/financeiro/inadimplencia") && inad.porUnidade.length > 0 && <Card title="Inadimplência por unidade"><Table head={["Unidade", "Títulos", "Valor"]}>{inad.porUnidade.map(u => <tr key={u.unidade}><Td>{u.unidade}</Td><Td>{u.n}</Td><Td className="tabular-nums">{brl(u.valor)}</Td></tr>)}</Table></Card>}
        {v("/financeiro/receita") && <Card title={`Receita ${ano}: previsto por unidade e modalidade`}><Table head={["Unidade", "Modalidade", "Alunos", "Previsto/mês"]} empty="Nenhum matriculado confirmado ou preços não cadastrados.">{Object.values(rec.linhas.reduce<Record<string, { unidade: string; modalidade: string; alunos: number; mensal: number }>>((a, l) => { const k = `${l.unidade}|${l.modalidade}`; a[k] = a[k] ?? { unidade: l.unidade, modalidade: l.modalidade, alunos: 0, mensal: 0 }; a[k].alunos += l.alunos; a[k].mensal += l.mensal ?? 0; return a; }, {})).map((r, i) => <tr key={i}><Td>{r.unidade}</Td><Td>{r.modalidade === "REGULAR" ? "Regular" : "Integral"}</Td><Td>{r.alunos}</Td><Td className="tabular-nums">{brl(r.mensal)}</Td></tr>)}</Table></Card>}
      </div>
      <p className="mt-3 text-xs text-slate-500">Boletos, notas e contabilidade continuam no ActiveSoft e com o contador; este módulo lê exportações e organiza a gestão.{can.gerirFinanceiro(s) && <> <Link className="text-acao" href="/financeiro/importar">Importar dados</Link>.</>}</p>
    </Page>
  );
}
