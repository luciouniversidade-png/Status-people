import { redirect } from "next/navigation";
import { requireFinanceiro, scopeUnit, can } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Flash, Field, Select, Btn, Input } from "@/components/ui";
import { getSettings, hoje } from "@/lib/utils";
import { fmtReais, MESES_CURTOS } from "@/lib/formato";
import { salvarPlanilha, copiarOrcamento } from "../actions";

export const dynamic = "force-dynamic";

/** Orçamento mês a mês de uma unidade: categorias × 12 meses (13º, material de janeiro, campanhas). Vazio = valor mensal fixo. */
export default async function Planilha({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireFinanceiro(); const sp = await searchParams; const cfg = await getSettings();
  if (!can.aprovar(s, cfg.alcadas.financeiro as string[])) redirect("/financeiro/orcamento");
  const escopo = scopeUnit(s); const units = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`;
  const unitId = escopo ?? (units.some(u => u.id === Number(sp.unidade)) ? Number(sp.unidade) : units[0]?.id);
  const anoAtual = Number(hoje().slice(0, 4)); const ano = Number(sp.ano) >= 2020 && Number(sp.ano) <= anoAtual + 1 ? Number(sp.ano) : anoAtual;
  const [mensal, fixo, real] = await Promise.all([
    sql<{ tipo: string; categoria: string; mes: number; valor: number }[]>`SELECT tipo, categoria, mes, valor::float FROM budget_months WHERE ano=${ano} AND unit_id=${unitId}`,
    sql<{ tipo: string; categoria: string; valor_mensal: number }[]>`SELECT tipo, categoria, valor_mensal::float FROM budgets WHERE ano=${ano} AND unit_id=${unitId}`,
    sql<{ tipo: string; categoria: string; valor: number }[]>`SELECT tipo, categoria, sum(valor)::float AS valor FROM cash_entries WHERE unit_id=${unitId} AND tipo IN ('ENTRADA','SAIDA') AND data >= ${`${ano - 1}-01-01`}::date AND data < ${`${ano}-01-01`}::date GROUP BY 1, 2`]);
  const grupos: [string, "ENTRADA" | "SAIDA", string[]][] = [["Receitas", "ENTRADA", cfg.financeiro.categoriasEntrada as string[]], ["Despesas", "SAIDA", cfg.financeiro.categoriasSaida as string[]]];
  const cel = (tipo: string, cat: string, mes: number) => mensal.find(x => x.tipo === tipo && x.categoria === cat && x.mes === mes)?.valor ?? null;
  const fix = (tipo: string, cat: string) => fixo.find(x => x.tipo === tipo && x.categoria === cat)?.valor_mensal ?? null;
  const total = (tipo: string, cat: string) => { let t = 0, algum = false; for (let m = 1; m <= 12; m++) { const v = cel(tipo, cat, m) ?? fix(tipo, cat); if (v !== null) { t += v; algum = true; } } return algum ? t : null; };
  const fmtCampo = (v: number | null) => v === null ? "" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nomeU = units.find(u => u.id === unitId)?.nome ?? "";
  return (
    <Page title={`Orçamento mês a mês ${ano}`} sub={`${nomeU}. Cada célula é o valor do mês; vazia, vale o valor mensal fixo (cinza). Valores no padrão brasileiro (12.500,00).`} actions={<Btn kind="ghost" href={`/financeiro/orcamento?ano=${ano}&unidade=${unitId}`}>Orçado × realizado</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-4 flex flex-wrap items-end gap-2">{!escopo && <Field label="Unidade"><Select name="unidade" defaultValue={unitId}>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}<Field label="Ano"><Select name="ano" defaultValue={ano}>{[anoAtual + 1, anoAtual, anoAtual - 1].map(a => <option key={a} value={a}>{a}</option>)}</Select></Field><Btn kind="ghost">Ver</Btn></form>
      <Card title={`Criar ${ano} a partir de ${ano - 1}`} className="mb-4">
        <form action={copiarOrcamento} className="flex flex-wrap items-end gap-3"><input type="hidden" name="ano" value={ano} /><input type="hidden" name="unitId" value={unitId} />
          <Field label="Base"><Select name="fonte" defaultValue="ORCADO"><option value="ORCADO">Orçamento de {ano - 1}</option><option value="REALIZADO">Realizado de {ano - 1} (caixa)</option></Select></Field>
          <Field label="Reajuste (%)"><Input name="reajuste" inputMode="decimal" defaultValue="0" className="w-24" /></Field>
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="substituir" value="1" /> substituir o que já existe em {ano}</label>
          <Btn kind="ghost" pendingText="Criando…">Criar orçamento mês a mês</Btn>
        </form>
        <p className="mt-2 text-xs text-slate-500">Mantém a sazonalidade de {ano - 1} (13º em dezembro, material em janeiro, campanhas). Realizado de {ano - 1} nesta unidade: receitas {fmtReais(real.filter(r => r.tipo === "ENTRADA").reduce((a, r) => a + r.valor, 0) || null, true)} · despesas {fmtReais(real.filter(r => r.tipo === "SAIDA").reduce((a, r) => a + r.valor, 0) || null, true)}.</p>
      </Card>
      <form action={salvarPlanilha}><input type="hidden" name="ano" value={ano} /><input type="hidden" name="unitId" value={unitId} />
        {grupos.map(([titulo, tipo, cats]) => (
          <Card key={tipo} title={titulo} className="mb-4">
            <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]"><table className="w-full min-w-[1100px] text-left text-xs">
              <thead className="bg-mist text-[11px] text-slate-600"><tr><th className="sticky left-0 z-[1] bg-mist px-2 py-2 font-medium">Categoria</th>{MESES_CURTOS.map(m => <th key={m} className="px-1 py-2 text-center font-medium">{m}</th>)}<th className="px-2 py-2 text-right font-medium">Ano</th></tr></thead>
              <tbody className="divide-y divide-line">{cats.map((c, i) => <tr key={c}>
                <th scope="row" className="sticky left-0 z-[1] bg-white px-2 py-1 text-left font-medium">{c}<input type="hidden" name={`c_${tipo}_${i}`} value={c} />{fix(tipo, c) !== null && <span className="block text-[10px] font-normal text-slate-400">fixo {fmtReais(fix(tipo, c), true)}/mês</span>}</th>
                {MESES_CURTOS.map((m, j) => <td key={m} className="px-0.5 py-1"><input name={`v_${tipo}_${i}_${j + 1}`} aria-label={`${c} — ${m}`} inputMode="decimal" defaultValue={fmtCampo(cel(tipo, c, j + 1))} placeholder={fix(tipo, c) !== null ? fmtCampo(fix(tipo, c)) : ""} className="w-full min-w-[78px] rounded border border-line px-1.5 py-1 text-right tabular-nums placeholder:text-slate-300 focus:border-acao focus:outline-none" /></td>)}
                <td className="px-2 py-1 text-right font-medium tabular-nums">{fmtReais(total(tipo, c), true)}</td>
              </tr>)}</tbody>
            </table></div>
          </Card>
        ))}
        <div className="sticky bottom-0 z-10 -mx-3 flex items-center gap-3 border-t border-line bg-white/95 px-3 py-3 backdrop-blur sm:mx-0 sm:rounded-md sm:border"><Btn pendingText="Salvando…">Salvar orçamento</Btn><span className="text-xs text-slate-500">Grava tudo ou nada. Apague uma célula para voltar ao valor fixo.</span></div>
      </form>
    </Page>
  );
}
