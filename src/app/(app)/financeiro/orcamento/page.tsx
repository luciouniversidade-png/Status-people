import { requireFinanceiro, scopeUnit, can } from "@/lib/auth";
import { db, schema } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Table, Td, Flash, Field, Select, Btn, Input, Stat } from "@/components/ui";
import { getSettings, hoje } from "@/lib/utils";
import { orcamentoAno, brl } from "@/lib/financeiro";
import { salvarOrcamento } from "../actions";

export const dynamic = "force-dynamic";

export default async function Orcamento({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireFinanceiro(); const sp = await searchParams; const cfg = await getSettings(); const scope = scopeUnit(s); const unitId = scope ?? (sp.unidade ? Number(sp.unidade) : null); const ano = sp.ano ? Number(sp.ano) : Number(hoje().slice(0, 4));
  const [orc, units] = await Promise.all([orcamentoAno(ano, unitId), db.select().from(schema.units).orderBy(asc(schema.units.nome))]);
  const ent = orc.cats.filter(c => c.tipo === "ENTRADA"), sai = orc.cats.filter(c => c.tipo === "SAIDA");
  const prevEnt = ent.reduce((a, c) => a + (c.previstoAteAgora ?? 0), 0), prevSai = sai.reduce((a, c) => a + (c.previstoAteAgora ?? 0), 0);
  const unidadeForm = unitId ?? units[0]?.id;
  return (
    <Page title={`Orçamento × realizado e DRE gerencial ${ano}`} sub={`Realizado = caixa importado/lançado. ${orc.mesesDecorridos} mês(es) decorrido(s) no ano.`} actions={<Btn kind="ghost" href="/financeiro">Painel</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-4 flex flex-wrap items-end gap-2">{!scope && <Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Rede</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}<Field label="Ano"><Input name="ano" type="number" defaultValue={ano} className="w-28" /></Field><Btn kind="ghost">Ver</Btn></form>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5"><Stat label="Entradas no ano" value={brl(orc.entradas)} hint={prevEnt ? `previsto ${brl(prevEnt)}` : "sem orçamento"} /><Stat label="Saídas no ano" value={brl(orc.saidas)} hint={prevSai ? `previsto ${brl(prevSai)}` : "sem orçamento"} /><Stat label="Resultado" value={<span className={orc.resultado < 0 ? "text-erro" : "text-ok"}>{brl(orc.resultado)}</span>} hint={orc.entradas ? `margem ${Math.round(100 * orc.resultado / orc.entradas)}%` : undefined} /><Stat label="Custo de pessoal/mês" value={brl(orc.custoPessoalMensal)} hint={`${orc.colaboradores} colaboradores · +${cfg.financeiro.encargosPct}% encargos`} /><Stat label="Custo por aluno/mês" value={brl(orc.custoPorAlunoMensal)} hint={`${orc.alunos} alunos atuais`} /></div>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px] lg:items-start">
        <div className="space-y-4">
          <Card title="DRE gerencial (caixa)"><Table head={["Linha", "Previsto até agora", "Realizado", "Variação"]} empty="Sem lançamentos no ano.">
            <tr className="bg-mist"><Td className="font-medium">Receitas</Td><Td className="tabular-nums">{brl(prevEnt)}</Td><Td className="tabular-nums">{brl(orc.entradas)}</Td><Td>{""}</Td></tr>{ent.map(c => <tr key={c.categoria}><Td className="pl-6">{c.categoria}</Td><Td className="tabular-nums">{c.previstoAteAgora === null ? "—" : brl(c.previstoAteAgora)}</Td><Td className="tabular-nums">{brl(c.realizado)}</Td><Td className={`tabular-nums ${c.variacao === null ? "" : c.variacao < -10 ? "text-erro" : c.variacao > 0 ? "text-ok" : ""}`}>{c.variacao === null ? "—" : `${c.variacao > 0 ? "+" : ""}${c.variacao}%`}</Td></tr>)}
            <tr className="bg-mist"><Td className="font-medium">Despesas</Td><Td className="tabular-nums">{brl(prevSai)}</Td><Td className="tabular-nums">{brl(orc.saidas)}</Td><Td>{""}</Td></tr>{sai.map(c => <tr key={c.categoria}><Td className="pl-6">{c.categoria}</Td><Td className="tabular-nums">{c.previstoAteAgora === null ? "—" : brl(c.previstoAteAgora)}</Td><Td className="tabular-nums">{brl(c.realizado)}</Td><Td className={`tabular-nums ${c.variacao === null ? "" : c.variacao > 10 ? "text-erro" : c.variacao < 0 ? "text-ok" : ""}`}>{c.variacao === null ? "—" : `${c.variacao > 0 ? "+" : ""}${c.variacao}%`}</Td></tr>)}
            <tr className="bg-mist font-medium"><Td>Resultado</Td><Td className="tabular-nums">{brl(prevEnt - prevSai)}</Td><Td className={`tabular-nums ${orc.resultado < 0 ? "text-erro" : "text-ok"}`}>{brl(orc.resultado)}</Td><Td>{""}</Td></tr>
          </Table><p className="mt-2 text-xs text-slate-500">Variação: receita abaixo de −10% e despesa acima de +10% do previsto ficam em vermelho. Custo de pessoal estimado pelos salários cadastrados no People, não pelo caixa.</p></Card>
        </div>
        {can.financeiro(s) && <Card title={`Orçamento mensal ${ano}`}><form action={salvarOrcamento} className="space-y-2"><input type="hidden" name="ano" value={ano} /><Field label="Unidade"><Select name="unitId" defaultValue={unidadeForm ?? ""} required>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>
          <div className="text-xs font-medium text-slate-600">Receitas (valor mensal previsto)</div>{cfg.financeiro.categoriasEntrada.map((c, i) => <div key={c} className="grid grid-cols-[1fr_110px] items-center gap-2 text-xs"><span>{c}<input type="hidden" name={`c_ENTRADA_${i}`} value={c} /></span><Input name={`b_ENTRADA_${i}`} type="number" step="0.01" className="!py-1 !text-xs" defaultValue={orc.cats.find(x => x.tipo === "ENTRADA" && x.categoria === c && unitId !== null)?.previstoMensal ?? ""} /></div>)}
          <div className="text-xs font-medium text-slate-600">Despesas (valor mensal previsto)</div>{cfg.financeiro.categoriasSaida.map((c, i) => <div key={c} className="grid grid-cols-[1fr_110px] items-center gap-2 text-xs"><span>{c}<input type="hidden" name={`c_SAIDA_${i}`} value={c} /></span><Input name={`b_SAIDA_${i}`} type="number" step="0.01" className="!py-1 !text-xs" defaultValue={orc.cats.find(x => x.tipo === "SAIDA" && x.categoria === c && unitId !== null)?.previstoMensal ?? ""} /></div>)}
          <Btn small>Salvar orçamento</Btn><p className="text-xs text-slate-500">Preencha uma unidade por vez. Linhas em branco não são alteradas.</p></form></Card>}
      </div>
    </Page>
  );
}
