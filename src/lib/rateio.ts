import { sql } from "@/db";
import { getSettings } from "./utils";
import { participacoes, resultadoPorUnidade, type BaseRateio, type MovRateio } from "./rateio-calc";
import { garantirCentrosPadrao } from "./plano-contas";

/**
 * v28 · Resultado por unidade com rateio do corporativo (catálogo: “classificar custos diretos da turma e custos indiretos
 * compartilhados sem confundi-los”; “aprovar critérios de rateio”). Regime de caixa, como o fluxo de caixa: transferências internas,
 * principal de dívida e adiantamentos ficam fora. A regra vigente é a última aprovada com “desde” até o mês de referência.
 */
export type Regra = { id: number; nome: string; base: BaseRateio; percentuais: Record<string, number> | null; desde: string; status: string; motivo: string | null; decisao_motivo: string | null; criado_por: string | null; aprovado_por: string | null; aprovado_em: string | null; created_at: string };

export async function listarRegras(): Promise<Regra[]> {
  return sql<Regra[]>`SELECT r.id, r.nome, r.base, r.percentuais, r.desde, r.status, r.motivo, r.decisao_motivo, uc.nome AS criado_por, ua.nome AS aprovado_por, r.aprovado_em::text, r.created_at::text
    FROM allocation_rules r LEFT JOIN users uc ON uc.id=r.criado_por LEFT JOIN users ua ON ua.id=r.aprovado_por ORDER BY (r.status='RASCUNHO') DESC, r.desde DESC, r.aprovado_em DESC NULLS LAST, r.id DESC`;
}
export function regraVigente(regras: Regra[], periodo: string): Regra | null {
  return regras.filter(r => r.status === "APROVADA" && r.desde <= periodo).sort((a, b) => b.desde.localeCompare(a.desde) || (b.aprovado_em ?? "").localeCompare(a.aprovado_em ?? ""))[0] ?? null;
}

/** Valor da base de cada unidade no período (alunos atuais, turmas do ano, colaboradores ativos, receita ou percentual fixo). */
export async function basePorUnidade(base: BaseRateio, unidades: number[], ini: string, fimExcl: string, percentuais: Record<string, number> | null): Promise<Map<number, number>> {
  const cfg = await getSettings(); const internas = cfg.dre.internas as string[];
  const ano = Number(fimExcl.slice(0, 4)) - (fimExcl.slice(5, 7) === "01" ? 1 : 0);
  let rows: { unit_id: number; v: number }[] = [];
  if (base === "ALUNOS") rows = await sql<{ unit_id: number; v: number }[]>`SELECT unit_atual_id AS unit_id, count(*)::float AS v FROM students WHERE aluno_atual AND unit_atual_id = ANY(${unidades}::int[]) GROUP BY 1`;
  else if (base === "TURMAS") { rows = await sql<{ unit_id: number; v: number }[]>`SELECT unit_id, count(*)::float AS v FROM classes WHERE ano=${ano} AND modalidade='REGULAR' AND unit_id = ANY(${unidades}::int[]) GROUP BY 1`;
    if (!rows.length) rows = await sql<{ unit_id: number; v: number }[]>`SELECT unit_id, count(*)::float AS v FROM classes WHERE ano=(SELECT max(ano) FROM classes) AND modalidade='REGULAR' AND unit_id = ANY(${unidades}::int[]) GROUP BY 1`; }
  else if (base === "COLABORADORES") rows = await sql<{ unit_id: number; v: number }[]>`SELECT unit_id, count(*)::float AS v FROM employees WHERE situacao='ATIVO' AND unit_id = ANY(${unidades}::int[]) GROUP BY 1`;
  else if (base === "RECEITA") rows = await sql<{ unit_id: number; v: number }[]>`SELECT unit_id, sum(valor)::float AS v FROM cash_entries WHERE tipo='ENTRADA' AND NOT (categoria = ANY(${internas})) AND data >= ${ini}::date AND data < ${fimExcl}::date AND unit_id = ANY(${unidades}::int[]) GROUP BY 1`;
  else rows = unidades.map(u => ({ unit_id: u, v: Number(percentuais?.[String(u)] ?? 0) }));
  return new Map(rows.map(r => [Number(r.unit_id), Number(r.v)]));
}

/** Resultado por unidade do recorte (mês de referência ou acumulado no ano até ele), com a memória do rateio. */
export async function resultadoComRateio(periodo: string, visao: "mes" | "acumulado") {
  await garantirCentrosPadrao();
  const cfg = await getSettings(); const internas = cfg.dre.internas as string[]; const naoDespesa = (cfg.dre.naoDespesa ?? []) as string[];
  const [a, m] = periodo.split("-").map(Number);
  const ini = visao === "mes" ? `${periodo}-01` : `${a}-01-01`; const fimExcl = new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 10); const meses = visao === "mes" ? 1 : m;
  const unidades = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`; const ids = unidades.map(u => u.id);
  const [regras, movs, alunosR] = await Promise.all([listarRegras(),
    sql<MovRateio[]>`SELECT c.unit_id, c.tipo, sum(c.valor)::float AS valor, a.custo, cc.tipo AS centro_tipo, cc.unit_id AS centro_unit_id FROM cash_entries c LEFT JOIN chart_accounts a ON a.id=c.conta_id LEFT JOIN cost_centers cc ON cc.id=c.cost_center_id
      WHERE c.tipo IN ('ENTRADA','SAIDA') AND NOT (c.categoria = ANY(${[...internas, ...naoDespesa]})) AND c.data >= ${ini}::date AND c.data < ${fimExcl}::date GROUP BY c.unit_id, c.tipo, a.custo, cc.tipo, cc.unit_id`,
    sql<{ unit_id: number; n: number }[]>`SELECT unit_atual_id AS unit_id, count(*)::int AS n FROM students WHERE aluno_atual GROUP BY 1`]);
  const regra = regraVigente(regras, periodo);
  const base = (regra?.base ?? "ALUNOS") as BaseRateio;
  const valores = await basePorUnidade(base, ids, ini, fimExcl, regra?.percentuais ?? null);
  const part = participacoes(ids, valores); const alunos = new Map(alunosR.map(x => [Number(x.unit_id), x.n]));
  const r = resultadoPorUnidade(unidades, movs.map(x => ({ ...x, valor: Number(x.valor), unit_id: Number(x.unit_id), centro_unit_id: x.centro_unit_id === null ? null : Number(x.centro_unit_id) })), part, alunos, meses);
  const [sem] = await sql<{ n: number; v: number | null }[]>`SELECT count(*)::int AS n, sum(valor)::float AS v FROM cash_entries WHERE tipo='SAIDA' AND conta_id IS NULL AND NOT (categoria = ANY(${[...internas, ...naoDespesa]})) AND data >= ${ini}::date AND data < ${fimExcl}::date`;
  return { ...r, regra, regras, base, valores, participacao: part, ini, fimExcl, meses, unidades, semConta: { n: sem?.n ?? 0, v: sem?.v ?? 0 }, provisoria: !regra };
}
export type ResultadoRateio = Awaited<ReturnType<typeof resultadoComRateio>>;
