import Link from "next/link";
import { requireFinanceiro, scopeUnit, can } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Table, Td, Flash, Field, Select, Btn, Stat } from "@/components/ui";
import { getSettings, hoje } from "@/lib/utils";
import { inadimplencia, receita, caixaMes, orcamentoAno, brl } from "@/lib/financeiro";

export const dynamic = "force-dynamic";

export default async function Financeiro({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireFinanceiro(); const sp = await searchParams; const cfg = await getSettings(); const scope = scopeUnit(s); const unitId = scope ?? (sp.unidade ? Number(sp.unidade) : null); const mes = hoje().slice(0, 7); const ano = cfg.matriculas.anoLetivo;
  const [inad, rec, cx, orc, units, [descPend]] = await Promise.all([inadimplencia(unitId), receita(ano, unitId), caixaMes(mes, unitId), orcamentoAno(Number(hoje().slice(0, 4)), unitId), scope ? Promise.resolve([]) : db.select().from(schema.units).orderBy(asc(schema.units.nome)),
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM discounts d WHERE d.status='SOLICITADO' ${unitId === null ? sql`` : sql`AND d.unit_id=${unitId}`}`]);
  const alertas: string[] = [];
  if (inad.taxa90 !== null && inad.taxa90 > 8) alertas.push(`Inadimplência de ${inad.taxa90}% nos últimos 90 dias (acima de 8%).`);
  if (inad.acoesPendentes) alertas.push(`${inad.acoesPendentes} título(s) sem a ação de cobrança que a régua pede.`);
  if (descPend.n) alertas.push(`${descPend.n} desconto(s) aguardando aprovação.`);
  if (rec.semPreco) alertas.push(`${rec.semPreco} matriculado(s) ${ano} sem valor de mensalidade cadastrado — a previsão está incompleta.`);
  orc.cats.filter(c => c.tipo === "SAIDA" && c.variacao !== null && c.variacao > 10).forEach(c => alertas.push(`${c.categoria}: ${c.variacao}% acima do orçamento no ano.`));
  if (cx.saldoFinal !== null && cx.saldoFinal < 0) alertas.push("Caixa projetado negativo no mês.");
  return (
    <Page title="Financeiro" sub="Camada de gestão sobre o ActiveSoft: inadimplência e régua, descontos com alçada, receita prevista × realizada, caixa consolidado, orçamento e DRE gerencial."
      actions={<><Btn kind="ghost" href="/financeiro/inadimplencia">Inadimplência</Btn><Btn kind="ghost" href="/financeiro/descontos">Descontos</Btn><Btn kind="ghost" href="/financeiro/receita">Receita</Btn><Btn kind="ghost" href="/financeiro/caixa">Caixa</Btn><Btn kind="ghost" href="/financeiro/orcamento">Orçamento e DRE</Btn>{can.financeiro(s) && <Btn href="/financeiro/importar">Importar</Btn>}</>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {!scope && <form className="mb-4 flex items-end gap-2"><Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Rede</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Btn kind="ghost">Ver</Btn></form>}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Inadimplência (90 dias)" value={inad.taxa90 === null ? "—" : <span className={inad.taxa90 > 8 ? "text-erro" : inad.taxa90 > 4 ? "text-aviso" : "text-ok"}>{inad.taxa90}%</span>} hint={`${brl(inad.total)} em aberto · ${inad.familias} família(s)`} href="/financeiro/inadimplencia" />
        <Stat label="Receita prevista/mês" value={<span className="text-xl">{brl(rec.mensal)}</span>} hint={`${rec.alunos} matriculado(s) ${ano}${rec.semPreco ? ` · ${rec.semPreco} sem preço` : ""}`} href="/financeiro/receita" />
        <Stat label="Entradas no mês" value={<span className="text-xl">{brl(cx.tot.entradas)}</span>} hint={`saídas ${brl(cx.tot.saidas)}`} href="/financeiro/caixa" />
        <Stat label="Saldo de caixa" value={cx.saldoFinal === null ? "—" : <span className={`text-xl ${cx.saldoFinal < 0 ? "text-erro" : ""}`}>{brl(cx.saldoFinal)}</span>} hint={cx.temSaldo ? "inicial + entradas − saídas" : "informe o saldo inicial do mês"} href="/financeiro/caixa" />
        <Stat label="Resultado no ano" value={<span className={`text-xl ${orc.resultado < 0 ? "text-erro" : "text-ok"}`}>{brl(orc.resultado)}</span>} hint={`entradas − saídas registradas em ${hoje().slice(0, 4)}`} href="/financeiro/orcamento" />
        <Stat label="Custo por aluno/mês" value={<span className="text-xl">{brl(orc.custoPorAlunoMensal)}</span>} hint={`pessoal + ${cfg.financeiro.encargosPct}% encargos ÷ ${orc.alunos} alunos`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Card title="Alertas">{alertas.length === 0 ? <p className="text-sm text-slate-600">Nenhum alerta. Importe títulos, caixa e cadastre orçamento para o painel ganhar vida.</p> : <ul className="space-y-1 text-sm">{alertas.map((a, i) => <li key={i} className="flex gap-2"><span className="text-erro">●</span>{a}</li>)}</ul>}</Card>
        <Card title="Aging da inadimplência"><Table head={["Faixa", "Títulos", "Valor"]}>{inad.aging.map(a => <tr key={a.faixa}><Td>{a.faixa}</Td><Td>{a.n}</Td><Td className="tabular-nums">{brl(a.valor)}</Td></tr>)}</Table></Card>
        {!scope && inad.porUnidade.length > 0 && <Card title="Inadimplência por unidade"><Table head={["Unidade", "Títulos", "Valor"]}>{inad.porUnidade.map(u => <tr key={u.unidade}><Td>{u.unidade}</Td><Td>{u.n}</Td><Td className="tabular-nums">{brl(u.valor)}</Td></tr>)}</Table></Card>}
        <Card title={`Receita ${ano}: previsto por unidade e modalidade`}><Table head={["Unidade", "Modalidade", "Alunos", "Previsto/mês"]} empty="Nenhum matriculado confirmado ou preços não cadastrados.">{Object.values(rec.linhas.reduce<Record<string, { unidade: string; modalidade: string; alunos: number; mensal: number }>>((a, l) => { const k = `${l.unidade}|${l.modalidade}`; a[k] = a[k] ?? { unidade: l.unidade, modalidade: l.modalidade, alunos: 0, mensal: 0 }; a[k].alunos += l.alunos; a[k].mensal += l.mensal ?? 0; return a; }, {})).map((r, i) => <tr key={i}><Td>{r.unidade}</Td><Td>{r.modalidade === "REGULAR" ? "Regular" : "Integral"}</Td><Td>{r.alunos}</Td><Td className="tabular-nums">{brl(r.mensal)}</Td></tr>)}</Table></Card>
      </div>
      <p className="mt-3 text-xs text-slate-500">Boletos, notas e contabilidade continuam no ActiveSoft e com o contador; este módulo lê exportações e organiza a gestão. <Link className="text-acao" href="/financeiro/importar">Importar dados</Link>.</p>
    </Page>
  );
}
