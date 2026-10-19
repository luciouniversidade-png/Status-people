import { sql } from "@/db";
import { scopeUnit, type Session } from "./auth";
import { getSettings, hoje, addDays } from "./utils";
import { resumoPorUnidade, mesParcial, type ResumoUnidade } from "./cockpit";
import { somaMeses } from "./gestao-calc";
import type { Contexto } from "./contexto";

/**
 * T-008 · Visão da rede: um cartão por unidade e a linha de totais da rede — cada total é a soma exata dos cartões (CRQ de totais íntegros);
 * quando a fonte tem registros fora de qualquer unidade, a tela avisa com a origem em vez de esconder a diferença.
 * Perfis de unidade veem todas as unidades nos indicadores sem valor financeiro e os valores em R$ só da própria unidade.
 */
export type CartaoRede = ResumoUnidade & { turmas: number; reservasVencendo: number; pendencias: number; serieAlunos: (number | null)[]; serieReceita: (number | null)[]; propria: boolean; financeiro: boolean };
export const INDICADORES_RANKING: Record<string, { rotulo: string; financeiro?: boolean; menorMelhor?: boolean; formato: "n" | "%" | "R$" }> = {
  alunos: { rotulo: "Alunos atuais", formato: "n" }, ocupacao: { rotulo: "Ocupação das vagas", formato: "%" }, receita: { rotulo: "Receita do mês", financeiro: true, formato: "R$" },
  inad: { rotulo: "Inadimplência 30+", financeiro: true, menorMelhor: true, formato: "%" }, saude: { rotulo: "Saúde (health)", formato: "n" }, nps: { rotulo: "NPS (180 dias)", formato: "n" },
  pendencias: { rotulo: "Pendências abertas", menorMelhor: true, formato: "n" }, colaboradores: { rotulo: "Colaboradores", formato: "n" },
};
export function valorRanking(c: CartaoRede, k: string): number | null {
  switch (k) { case "alunos": return c.alunos; case "ocupacao": return c.ocupacaoPct; case "receita": return c.financeiro ? c.receita : null; case "inad": return c.financeiro ? c.inad30 : null; case "saude": return c.saude; case "nps": return c.nps; case "pendencias": return c.pendencias; case "colaboradores": return c.colaboradores; default: return null; }
}

export async function visaoRede(s: Session, ctx: Contexto) {
  const cfg = await getSettings(); const h = hoje(); const ano = cfg.matriculas.anoLetivo as number; const escopo = scopeUnit(s);
  // recorte: a entidade escolhida (ou a rede); perfil de unidade vê todas as unidades, com R$ só da sua
  const ids = (escopo !== null ? ctx.units : ctx.entidadeId ? ctx.units.filter(u => u.company_id === ctx.entidadeId) : ctx.units).map(u => u.id);
  const base = await resumoPorUnidade({ ...ctx, unitIds: ids });
  const de13 = somaMeses(ctx.periodo, -12);
  const [turmas, reservas, series] = await Promise.all([
    sql<{ unit_id: number; n: number }[]>`SELECT unit_id, count(*)::int AS n FROM classes WHERE ano=${ano} AND status <> 'CANCELADA' AND unit_id = ANY(${ids}) GROUP BY 1`,
    sql<{ unit_id: number; n: number }[]>`SELECT c.unit_id, count(*)::int AS n FROM enrollments e JOIN classes c ON c.id=e.class_id WHERE e.status='RESERVADA' AND e.reserva_ate <= ${addDays(h, 2)} AND c.ano=${ano} AND c.unit_id = ANY(${ids}) GROUP BY 1`,
    sql<{ chave: string; unit_id: number; periodo: string; valor: number | null }[]>`SELECT chave, unit_id, periodo, valor::float FROM kpi_series WHERE chave IN ('matriculas.alunos','financeiro.receita') AND unit_id = ANY(${ids}) AND periodo >= ${de13} AND periodo <= ${ctx.periodo}`,
  ]);
  const meses: string[] = []; for (let p = de13; p <= ctx.periodo; p = somaMeses(p, 1)) meses.push(p);
  const cartoes: CartaoRede[] = base.map(b => {
    const propria = escopo === null || escopo === b.id; const fin = propria && s.role !== "COMERCIAL";
    const reservasVencendo = reservas.find(x => x.unit_id === b.id)?.n ?? 0;
    const serie = (chave: string) => meses.map(m => series.find(x => x.chave === chave && x.unit_id === b.id && x.periodo === m)?.valor ?? null);
    return { ...b, receita: fin ? b.receita : null, despesa: fin ? b.despesa : null, inad30: fin ? b.inad30 : null, vencido: fin ? b.vencido : null, turmas: turmas.find(x => x.unit_id === b.id)?.n ?? 0, reservasVencendo, pendencias: b.chamados + b.casos + reservasVencendo,
      serieAlunos: serie("matriculas.alunos"), serieReceita: fin ? serie("financeiro.receita") : [], propria: escopo !== null && escopo === b.id, financeiro: fin };
  });
  // totais = soma exata dos cartões; o que a fonte tem fora das unidades vira aviso com origem
  const soma = (f: (c: CartaoRede) => number | null) => { const v = cartoes.map(f).filter((x): x is number => x !== null); return v.length ? v.reduce((a, x) => a + x, 0) : null; };
  const vagas = soma(c => c.vagas) ?? 0, ocupadas = soma(c => c.ocupadas) ?? 0;
  const totais = { alunos: soma(c => c.alunos) ?? 0, turmas: soma(c => c.turmas) ?? 0, vagas, ocupadas, ocupacaoPct: vagas ? (100 * ocupadas) / vagas : null, pendencias: soma(c => c.pendencias) ?? 0, colaboradores: soma(c => c.colaboradores) ?? 0,
    receita: cartoes.every(c => c.financeiro) ? soma(c => c.receita) : null, chamados: soma(c => c.chamados) ?? 0, casos: soma(c => c.casos) ?? 0, reservasVencendo: soma(c => c.reservasVencendo) ?? 0 };
  const avisos: string[] = [];
  if (escopo === null && !ctx.entidadeId) {
    const [[semUn], [colSem]] = await Promise.all([
      sql<{ n: number }[]>`SELECT count(*)::int AS n FROM students WHERE aluno_atual AND (unit_atual_id IS NULL OR NOT (unit_atual_id = ANY(${ids})))`,
      sql<{ n: number }[]>`SELECT count(*)::int AS n FROM employees WHERE situacao IN ('ATIVO','FERIAS','AFASTADO') AND (unit_id IS NULL OR NOT (unit_id = ANY(${ids})))`,
    ]);
    if (semUn.n) avisos.push(`${semUn.n} aluno(s) atual(is) sem unidade no cadastro (origem: importação de alunos do ActiveSoft) — fora dos cartões e do total.`);
    if (colSem.n) avisos.push(`${colSem.n} colaborador(es) ativo(s) sem unidade (origem: cadastro de pessoas) — fora dos cartões e do total.`);
  }
  // mês em andamento: a receita dos cartões é parcial (até o último lançamento importado)
  const [{ fim }] = await sql<{ fim: string | null }[]>`SELECT max(data)::text AS fim FROM cash_entries WHERE unit_id = ANY(${ids})`;
  const parcialAte = mesParcial(ctx.periodo, h, fim)?.ate ?? null;
  return { cartoes, totais, avisos, meses, ano, escopo, parcialAte };
}
