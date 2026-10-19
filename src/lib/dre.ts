import { sql } from "@/db";
import { getSettings } from "./utils";
import type { Contexto } from "./contexto";
import { montarDre, type Coluna, type Mov, type FolhaMes, type MapaDre } from "./dre-calc";
import { MESES_CURTOS } from "./formato";

export type DimDre = "unidade" | "entidade" | "mes";
export type VisaoDre = "mes" | "acumulado";

async function movimentos(ano: number, units: number[]) {
  return sql<Mov[]>`SELECT unit_id, extract(month FROM data)::int AS mes, tipo, categoria, sum(valor)::float AS valor FROM cash_entries WHERE data >= ${`${ano}-01-01`}::date AND data < ${`${ano + 1}-01-01`}::date AND unit_id = ANY(${units}) GROUP BY 1, 2, 3, 4`;
}
async function orcamentos(ano: number, units: number[]) {
  return sql<Mov[]>`WITH cats AS (SELECT DISTINCT unit_id, tipo, categoria FROM budgets WHERE ano=${ano} AND unit_id = ANY(${units}) UNION SELECT DISTINCT unit_id, tipo, categoria FROM budget_months WHERE ano=${ano} AND unit_id = ANY(${units}))
    SELECT c.unit_id, ms.mes, c.tipo, c.categoria, coalesce(bm.valor, b.valor_mensal)::float AS valor FROM cats c CROSS JOIN generate_series(1, 12) AS ms(mes)
      LEFT JOIN budget_months bm ON bm.ano=${ano} AND bm.unit_id=c.unit_id AND bm.tipo=c.tipo AND bm.categoria=c.categoria AND bm.mes=ms.mes
      LEFT JOIN budgets b ON b.ano=${ano} AND b.unit_id=c.unit_id AND b.tipo=c.tipo AND b.categoria=c.categoria
    WHERE coalesce(bm.valor, b.valor_mensal) IS NOT NULL`;
}
async function folhaReal(ano: number, units: number[]) {
  return sql<FolhaMes[]>`SELECT r.unit_id, substr(c.competencia, 6, 2)::int AS mes, sum(r.salarios + r.inss + r.fgts + r.provisao_13 + r.provisao_ferias + r.beneficios + r.rescisoes + r.outros)::float AS custo
    FROM payroll_cycles c JOIN payroll_results r ON r.cycle_id=c.id WHERE c.aceito_em IS NOT NULL AND c.competencia LIKE ${`${ano}-%`} AND r.unit_id = ANY(${units}) GROUP BY 1, 2`;
}

/** Dados completos da DRE no contexto: colunas pela dimensão, meses pela visão e o mesmo recorte do ano anterior. */
export async function dadosDre(ctx: Contexto, dim: DimDre, visao: VisaoDre) {
  const cfg = await getSettings(); const ano = Number(ctx.periodo.slice(0, 4)); const mesRef = Number(ctx.periodo.slice(5, 7));
  const units = ctx.unitIds ?? ctx.units.map(u => u.id); const nomes = new Map(ctx.units.map(u => [u.id, u]));
  const meses = visao === "mes" && dim !== "mes" ? [mesRef] : Array.from({ length: mesRef }, (_, i) => i + 1);
  let cols: Coluna[] = [];
  if (dim === "unidade") cols = [...units.map(u => ({ chave: `u${u}`, rotulo: nomes.get(u)?.nome ?? `Unidade ${u}`, units: [u], meses })), ...(units.length > 1 ? [{ chave: "total", rotulo: "Consolidado", units, meses, consolidado: true }] : [])];
  else if (dim === "entidade") {
    const ents = [...new Set(units.map(u => nomes.get(u)?.company_id ?? 0))];
    cols = ents.map(e => ({ chave: `e${e}`, rotulo: e ? ctx.entidades.find(x => x.id === e)?.nome ?? "Entidade" : "Sem entidade vinculada", units: units.filter(u => (nomes.get(u)?.company_id ?? 0) === e), meses }));
    if (cols.length > 1) cols.push({ chave: "total", rotulo: "Consolidado", units, meses, consolidado: true });
  } else cols = [...meses.map(m => ({ chave: `m${m}`, rotulo: MESES_CURTOS[m - 1], units, meses: [m] })), { chave: "total", rotulo: `Acumulado ${MESES_CURTOS[0]}–${MESES_CURTOS[mesRef - 1]}`, units, meses, consolidado: units.length > 1 }];
  const mapa: MapaDre = { deducoes: cfg.dre.deducoes as string[], pessoal: cfg.dre.pessoal as string[], financeiras: cfg.dre.financeiras as string[], internas: cfg.dre.internas as string[] };
  const [mov, orc, folha, movAnt, folhaAnt, [ultimo]] = await Promise.all([movimentos(ano, units), orcamentos(ano, units), folhaReal(ano, units), movimentos(ano - 1, units), folhaReal(ano - 1, units),
    sql<{ d: string | null }[]>`SELECT max(data)::text AS d FROM cash_entries WHERE unit_id = ANY(${units})`]);
  const dre = montarDre({ cols, unidadesRecorte: units, mov, orc, folha, movAnt, folhaAnt, mapa });
  return { dre, cols, ano, mesRef, mapa, dadosAte: ultimo?.d ?? null, temOrcamento: orc.length > 0, temFolhaReal: folha.length > 0, meses };
}

/** Lançamentos de uma célula da DRE (drill até o documento — CRQ-FIN-V3-02). */
export async function lancamentosDaCelula(f: { ano: number; m1: number; m2: number; units: number[]; tipo: string | null; categorias: string[] | null; excluirCategorias: string[] | null; limite?: number }) {
  const ini = `${f.ano}-${String(f.m1).padStart(2, "0")}-01`; const fimM = f.m2 === 12 ? `${f.ano + 1}-01-01` : `${f.ano}-${String(f.m2 + 1).padStart(2, "0")}-01`;
  const filtroTipo = f.tipo ? sql`AND c.tipo=${f.tipo}` : sql`AND c.tipo IN ('ENTRADA','SAIDA')`;
  const filtroCat = f.categorias ? sql`AND c.categoria = ANY(${f.categorias})` : f.excluirCategorias ? sql`AND NOT (c.categoria = ANY(${f.excluirCategorias}))` : sql``;
  const [rows, [tot]] = await Promise.all([
    sql<{ id: number; data: string; unidade: string; tipo: string; categoria: string; forma: string | null; descricao: string | null; contraparte: string | null; valor: number; anexos: number }[]>`SELECT c.id, c.data::text, u.nome AS unidade, c.tipo, c.categoria, c.forma, c.descricao, c.contraparte, c.valor::float, (SELECT count(*) FROM attachments a WHERE a.entidade='cash_entry' AND a.entidade_id=c.id)::int AS anexos
      FROM cash_entries c JOIN units u ON u.id=c.unit_id WHERE c.data >= ${ini}::date AND c.data < ${fimM}::date AND c.unit_id = ANY(${f.units}) ${filtroTipo} ${filtroCat} ORDER BY c.valor DESC, c.data LIMIT ${f.limite ?? 300}`,
    sql<{ n: number; v: number | null }[]>`SELECT count(*)::int AS n, sum(c.valor)::float AS v FROM cash_entries c WHERE c.data >= ${ini}::date AND c.data < ${fimM}::date AND c.unit_id = ANY(${f.units}) ${filtroTipo} ${filtroCat}`,
  ]);
  return { rows, total: tot?.v ?? null, n: tot?.n ?? 0 };
}
