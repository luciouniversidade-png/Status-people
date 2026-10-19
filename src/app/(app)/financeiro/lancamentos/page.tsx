import Link from "@/components/Link";
import { requireFinanceiro, scopeUnit } from "@/lib/auth";
import { Page, Table, Td, Badge, Flash } from "@/components/ui";
import { lancamentosDaCelula } from "@/lib/dre";
import { LINHAS_DRE, type CodigoLinha } from "@/lib/dre-calc";
import { fmtReais, MESES_CURTOS } from "@/lib/formato";
import { fmtData, getSettings } from "@/lib/utils";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

/** Drill da DRE (CRQ-FIN-V3-02): célula → lançamentos → documento. Recebe o mesmo recorte da célula (ano, meses, unidades, linha, categoria). */
export default async function Lancamentos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireFinanceiro(); const sp = await searchParams; const cfg = await getSettings();
  const ano = Number(sp.ano) || new Date().getFullYear(); const m1 = Math.min(12, Math.max(1, Number(sp.m1) || 1)); const m2 = Math.min(12, Math.max(m1, Number(sp.m2) || m1));
  const todas = (await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`); const escopo = scopeUnit(s);
  let units = (sp.u ?? "").split(",").map(Number).filter(n => todas.some(u => u.id === n)); if (!units.length) units = todas.map(u => u.id);
  if (escopo !== null) units = units.filter(u => u === escopo).length ? [escopo] : [escopo];
  const linha = (LINHAS_DRE.find(l => l.codigo === sp.linha)?.codigo ?? null) as CodigoLinha | null; const cat = sp.cat ?? null;
  const d = cfg.dre; const naoOper = [...d.deducoes, ...d.pessoal, ...d.financeiras, ...d.internas] as string[];
  const filtro = cat ? { tipo: linha === "RECEITA" ? "ENTRADA" : "SAIDA", categorias: [cat], excluirCategorias: null }
    : linha === "RECEITA" ? { tipo: "ENTRADA", categorias: null, excluirCategorias: d.internas as string[] }
    : linha === "DEDUCOES" ? { tipo: "SAIDA", categorias: d.deducoes as string[], excluirCategorias: null }
    : linha === "PESSOAL" ? { tipo: "SAIDA", categorias: d.pessoal as string[], excluirCategorias: null }
    : linha === "FINANCEIRO" ? { tipo: "SAIDA", categorias: d.financeiras as string[], excluirCategorias: null }
    : linha === "OPERACIONAIS" ? { tipo: "SAIDA", categorias: null, excluirCategorias: naoOper }
    : { tipo: null, categorias: null, excluirCategorias: d.internas as string[] };
  const r = await lancamentosDaCelula({ ano, m1, m2, units, ...filtro });
  const nomeLinha = linha ? LINHAS_DRE.find(l => l.codigo === linha)!.nome.replace(/^[(=−) ]+/, "") : "Todos os lançamentos";
  return (
    <Page title={`Lançamentos · ${nomeLinha}${cat ? ` · ${cat}` : ""}`} sub={`${MESES_CURTOS[m1 - 1]}${m2 !== m1 ? `–${MESES_CURTOS[m2 - 1]}` : ""}/${ano} · ${units.length === todas.length ? "rede" : units.map(u => todas.find(x => x.id === u)?.nome).join(", ")} · ${r.n} lançamento(s) · ${fmtReais(r.total)}`}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <p className="mb-3 text-sm"><Link href="/financeiro/dre" className="text-acao">← voltar à DRE</Link>{linha === "PESSOAL" && <span className="ml-3 text-xs text-slate-500">No mês/unidade com folha aceita, a DRE usa o resultado REAL e estes lançamentos de caixa ficam fora da conta.</span>}</p>
      <Table head={["Data", "Unidade", "Categoria", "Descrição / contraparte", "Forma", "Valor", "Documento"]} empty="Nenhum lançamento nesta célula.">
        {r.rows.map(x => <tr key={x.id}><Td className="whitespace-nowrap">{fmtData(x.data)}</Td><Td>{x.unidade}</Td><Td className="text-xs">{x.categoria}</Td><Td className="text-xs">{x.descricao ?? "—"}{x.contraparte ? <div className="text-slate-500">{x.contraparte}</div> : null}</Td><Td className="text-xs">{x.forma ?? "—"}</Td><Td className={`whitespace-nowrap tabular-nums ${x.tipo === "SAIDA" ? "text-erro" : "text-ok"}`}>{fmtReais(x.valor)}</Td><Td><Link href={`/financeiro/lancamentos/${x.id}`} className="text-xs text-acao">{x.anexos ? <Badge v="APROVADA" label={`${x.anexos} anexo(s)`} /> : "abrir"}</Link></Td></tr>)}
      </Table>
      {r.n > r.rows.length && <p className="mt-2 text-xs text-slate-500">Mostrando os {r.rows.length} maiores de {r.n}. O total acima considera todos.</p>}
    </Page>
  );
}
