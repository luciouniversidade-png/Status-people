/**
 * v28 · Rateio e resultado por unidade — cálculo puro (sem banco).
 * Custos diretos (da turma/segmento) e indiretos da própria unidade ficam nela; centro de custo de outra unidade leva o gasto para a
 * unidade beneficiária; sem conta do plano, o gasto aparece como “não classificado” (para ninguém confundir); o centro CORPORATIVO
 * vai para o rateio pela base aprovada (alunos, turmas, colaboradores, receita ou percentual fixo).
 */
export type BaseRateio = "ALUNOS" | "TURMAS" | "COLABORADORES" | "RECEITA" | "PERCENTUAL";
export const ROTULO_BASE: Record<BaseRateio, string> = { ALUNOS: "Alunos atuais", TURMAS: "Turmas do ano", COLABORADORES: "Colaboradores ativos", RECEITA: "Receita do período", PERCENTUAL: "Percentual fixo" };
export const BASES = Object.keys(ROTULO_BASE) as BaseRateio[];

/** Participação de cada unidade (soma 1). Base zerada em todas: partes iguais. Percentual fixo: o informado (normalizado). */
export function participacoes(unidades: number[], valores: Map<number, number>): Map<number, number> {
  const tot = unidades.reduce((a, u) => a + Math.max(0, valores.get(u) ?? 0), 0);
  return new Map(unidades.map(u => [u, tot > 0 ? Math.max(0, valores.get(u) ?? 0) / tot : unidades.length ? 1 / unidades.length : 0]));
}

export type MovRateio = { unit_id: number; tipo: "ENTRADA" | "SAIDA"; valor: number; custo: "DIRETO" | "INDIRETO" | null; centro_tipo: string | null; centro_unit_id: number | null };
export type LinhaUnidade = { unitId: number; nome: string; receita: number; diretos: number; indiretos: number; naoClassificados: number; antes: number; rateio: number; pctRateio: number; depois: number; margem: number | null;
  alunos: number; custoAluno: { direto: number | null; indireto: number | null; rateio: number | null; total: number | null } };

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Resultado por unidade antes e depois do rateio do corporativo, com custo por aluno ao mês. */
export function resultadoPorUnidade(unidades: { id: number; nome: string }[], movs: MovRateio[], part: Map<number, number>, alunos: Map<number, number>, meses: number) {
  const linhas = new Map<number, LinhaUnidade>(unidades.map(u => [u.id, { unitId: u.id, nome: u.nome, receita: 0, diretos: 0, indiretos: 0, naoClassificados: 0, antes: 0, rateio: 0, pctRateio: 0, depois: 0, margem: null, alunos: alunos.get(u.id) ?? 0, custoAluno: { direto: null, indireto: null, rateio: null, total: null } }]));
  let corporativo = 0; let foraDoRecorte = 0;
  for (const m of movs) {
    if (m.tipo === "SAIDA" && m.centro_tipo === "CORPORATIVO") { corporativo += m.valor; continue; }
    const benef = m.centro_unit_id ?? m.unit_id; const l = linhas.get(benef); if (!l) { foraDoRecorte += m.valor; continue; }
    if (m.tipo === "ENTRADA") { l.receita += m.valor; continue; }
    if (m.custo === "DIRETO") l.diretos += m.valor; else if (m.custo === "INDIRETO") l.indiretos += m.valor; else l.naoClassificados += m.valor;
  }
  const mes = Math.max(1, meses);
  // parte de cada unidade, com os centavos do arredondamento na maior parte (a soma rateada fecha com o corporativo)
  const lsr = [...linhas.values()];
  for (const l of lsr) { const p = part.get(l.unitId) ?? 0; l.pctRateio = p; l.rateio = r2(corporativo * p); }
  const sobra = r2(r2(corporativo) - lsr.reduce((a, l) => a + l.rateio, 0));
  if (Math.abs(sobra) >= 0.005 && lsr.length && lsr.some(l => l.pctRateio > 0)) { const maior = lsr.reduce((a, l) => l.pctRateio > a.pctRateio ? l : a); maior.rateio = r2(maior.rateio + sobra); }
  for (const l of linhas.values()) {
    l.receita = r2(l.receita); l.diretos = r2(l.diretos); l.indiretos = r2(l.indiretos); l.naoClassificados = r2(l.naoClassificados);
    l.antes = r2(l.receita - l.diretos - l.indiretos - l.naoClassificados); l.depois = r2(l.antes - l.rateio); l.margem = l.receita > 0 ? (100 * l.depois) / l.receita : null;
    const a = l.alunos; const pa = (v: number) => a > 0 ? v / a / mes : null;
    l.custoAluno = { direto: pa(l.diretos), indireto: pa(l.indiretos + l.naoClassificados), rateio: pa(l.rateio), total: pa(l.diretos + l.indiretos + l.naoClassificados + l.rateio) };
  }
  const ls = [...linhas.values()];
  const soma = (k: "receita" | "diretos" | "indiretos" | "naoClassificados" | "antes" | "rateio" | "depois") => r2(ls.reduce((a, l) => a + l[k], 0));
  const alunosRede = ls.reduce((a, l) => a + l.alunos, 0);
  const totalCustos = soma("diretos") + soma("indiretos") + soma("naoClassificados") + r2(corporativo);
  return { linhas: ls, corporativo: r2(corporativo), foraDoRecorte: r2(foraDoRecorte),
    rede: { receita: soma("receita"), diretos: soma("diretos"), indiretos: soma("indiretos"), naoClassificados: soma("naoClassificados"), antes: soma("antes"), rateio: soma("rateio"), depois: soma("depois"), alunos: alunosRede,
      custoAlunoMes: alunosRede > 0 ? totalCustos / alunosRede / mes : null, margem: soma("receita") > 0 ? (100 * soma("depois")) / soma("receita") : null } };
}
