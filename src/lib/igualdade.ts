/**
 * v30 · Igualdade salarial entre mulheres e homens (Lei 14.611/2023 · CLT art. 461) e diversidade.
 * - Remuneração comparada NO MESMO CARGO (e nível): só com mulheres E homens suficientes no grupo (mínimo configurável).
 *   Professores horistas e jornadas parciais: compara o valor da hora contratada (salário ÷ horas mensais), não o salário do mês.
 * - Diferença “bruta” (todas as mulheres × todos os homens) mostra a composição; a “no mesmo cargo” é a que pede explicação.
 * - Relatório de transparência salarial: CNPJ com 100+ empregados publica em março e setembro (Decreto 11.795/2023) — o ONE
 *   lembra o prazo e guarda onde foi publicado e o plano de ação.
 * Sexo é dado pessoal comum (eSocial); raça/cor é dado sensível (LGPD art. 5º, II) e não é tratado aqui.
 */
import { sql } from "@/db";
import { getSettings } from "./utils";

export type PessoaIg = { id: number; sexo: string | null; unitId: number; unidade: string; companyId: number | null; empresa: string | null; positionId: number | null; cargo: string | null; familia: string | null; nivel: string | null; salario: number | null; jornadaMinDia: number | null; admissao: string; vinculo: string; diretos: number };
/** Vínculos com salário comparável (estágio recebe bolsa; PJ não é empregado). */
export const VINCULOS_SALARIO = ["CLT", "HORISTA", "TEMPORARIO"];
/** Horas mensais contratadas pela jornada diária (divisor da CLT: 8h48 por dia → 220 h; 4h24 → 110 h). */
export const horasMes = (jornadaMinDia: number | null | undefined) => (jornadaMinDia && jornadaMinDia > 0 ? (jornadaMinDia / 60) * 25 : null);
const media = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export type GrupoCargo = {
  chave: string; cargo: string; nivel: string | null; nF: number; nM: number; comparavel: boolean; base: "HORA" | "MES";
  mediaF: number | null; mediaM: number | null; razao: number | null; diferencaPct: number | null; acimaLimite: boolean;
  casaF: number | null; casaM: number | null;
};
const anos = (adm: string, h: string) => (Date.parse(h) - Date.parse(adm)) / (365.25 * 86400000);

/** Compara a remuneração por cargo (e nível). Diferença positiva = mulheres recebem menos. */
export function compararSalarios(ps: PessoaIg[], grupoMinimo: number, limitePct: number, h: string, porNivel = true) {
  const elegiveis = ps.filter(p => p.sexo && VINCULOS_SALARIO.includes(p.vinculo) && p.salario && p.salario > 0 && p.positionId);
  const grupos = new Map<string, PessoaIg[]>();
  for (const p of elegiveis) { const k = `${p.positionId}|${porNivel ? p.nivel ?? "" : ""}`; grupos.set(k, [...(grupos.get(k) ?? []), p]); }
  const out: GrupoCargo[] = [];
  for (const [k, g] of grupos) {
    const F = g.filter(p => p.sexo === "F"), M = g.filter(p => p.sexo === "M"); if (!F.length && !M.length) continue;
    const todosComJornada = g.every(p => horasMes(p.jornadaMinDia)); const base: "HORA" | "MES" = todosComJornada ? "HORA" : "MES";
    const val = (p: PessoaIg) => (base === "HORA" ? p.salario! / horasMes(p.jornadaMinDia)! : p.salario!);
    const comparavel = F.length >= grupoMinimo && M.length >= grupoMinimo;
    const mF = comparavel ? media(F.map(val)) : null, mM = comparavel ? media(M.map(val)) : null;
    const razao = mF !== null && mM ? mF / mM : null; const dif = razao === null ? null : (1 - razao) * 100;
    out.push({ chave: k, cargo: g[0].cargo ?? "—", nivel: porNivel ? g[0].nivel : null, nF: F.length, nM: M.length, comparavel, base, mediaF: mF, mediaM: mM, razao, diferencaPct: dif, acimaLimite: dif !== null && Math.abs(dif) > limitePct,
      casaF: comparavel ? media(F.map(p => anos(p.admissao, h))) : null, casaM: comparavel ? media(M.map(p => anos(p.admissao, h))) : null });
  }
  out.sort((a, b) => Number(b.comparavel) - Number(a.comparavel) || Math.abs(b.diferencaPct ?? 0) - Math.abs(a.diferencaPct ?? 0) || b.nF + b.nM - (a.nF + a.nM));
  // no mesmo cargo: média das razões ponderada pelo tamanho do grupo
  const comp = out.filter(g => g.razao !== null); const peso = comp.reduce((a, g) => a + g.nF + g.nM, 0);
  const ajustada = peso ? comp.reduce((a, g) => a + g.razao! * (g.nF + g.nM), 0) / peso : null;
  // bruta: todas as mulheres × todos os homens (salário do mês) — mostra a composição, não a discriminação
  const mF = media(elegiveis.filter(p => p.sexo === "F").map(p => p.salario!)), mM = media(elegiveis.filter(p => p.sexo === "M").map(p => p.salario!));
  const bruta = mF !== null && mM ? mF / mM : null;
  return { grupos: out, ajustada, bruta, comparados: comp.length, pessoasComparadas: peso, elegiveis: elegiveis.length };
}

/** Composição por sexo de um recorte e a liderança (família de gestão/coordenação ou quem tem equipe direta). */
export function composicaoSexo(ps: PessoaIg[], familiasLideranca: string[]) {
  const lider = (p: PessoaIg) => p.diretos > 0 || (!!p.familia && familiasLideranca.includes(p.familia));
  const conta = (xs: PessoaIg[]) => ({ total: xs.length, F: xs.filter(p => p.sexo === "F").length, M: xs.filter(p => p.sexo === "M").length, NI: xs.filter(p => !p.sexo).length });
  const geral = conta(ps), lid = conta(ps.filter(lider));
  const pct = (c: { F: number; M: number }) => (c.F + c.M ? (100 * c.F) / (c.F + c.M) : null);
  return { geral, lideranca: lid, pctMulheres: pct(geral), pctMulheresLideranca: pct(lid) };
}

/** Pessoas ativas para o relatório (escopo: rede; salário só sai para quem vê salário — a página confere). */
export async function pessoasIgualdade(): Promise<PessoaIg[]> {
  const rows = await sql<{ id: number; sexo: string | null; unit_id: number; unidade: string; company_id: number | null; empresa: string | null; position_id: number | null; cargo: string | null; familia: string | null; nivel: string | null; salario: number | null; jornada_min_dia: number | null; admissao: string; vinculo: string; diretos: number }[]>`
    SELECT e.id, e.sexo, e.unit_id, u.nome AS unidade, e.company_id, c.nome AS empresa, e.position_id, p.nome AS cargo, p.familia, e.nivel, e.salario::float, e.jornada_min_dia, e.admissao::text, e.vinculo,
      (SELECT count(*) FROM employees x WHERE x.gestor_id=e.id AND x.situacao <> 'DESLIGADO')::int AS diretos
    FROM employees e JOIN units u ON u.id=e.unit_id LEFT JOIN companies c ON c.id=e.company_id LEFT JOIN positions p ON p.id=e.position_id
    WHERE e.situacao NOT IN ('DESLIGADO','EM_ADMISSAO')`;
  return rows.map(r => ({ id: r.id, sexo: r.sexo, unitId: r.unit_id, unidade: r.unidade, companyId: r.company_id, empresa: r.empresa, positionId: r.position_id, cargo: r.cargo, familia: r.familia, nivel: r.nivel, salario: r.salario, jornadaMinDia: r.jornada_min_dia, admissao: r.admissao, vinculo: r.vinculo, diretos: r.diretos }));
}

/** Prazo de publicação do semestre (março e setembro): fim do mês. */
export const prazoSemestre = (ano: number, semestre: number) => (semestre === 1 ? `${ano}-03-31` : `${ano}-09-30`);
export const inicioJanela = (ano: number, semestre: number) => (semestre === 1 ? `${ano}-03-01` : `${ano}-09-01`);

/** Situação do relatório de transparência de cada CNPJ no ano: obrigatório (100+ empregados), janelas abertas e o que já foi registrado. */
export async function situacaoTransparencia(h: string) {
  const cfg = await getSettings(); const minimo = Number(cfg.igualdade.empregadosObrigatorio) || 100; const ano = Number(h.slice(0, 4));
  const [empresas, regs] = await Promise.all([
    sql<{ id: number; nome: string; empregados: number }[]>`SELECT c.id, c.nome, (SELECT count(*) FROM employees e WHERE e.company_id=c.id AND e.situacao NOT IN ('DESLIGADO','EM_ADMISSAO') AND e.vinculo IN ('CLT','HORISTA','TEMPORARIO'))::int AS empregados FROM companies c ORDER BY c.nome`,
    sql<{ company_id: number; ano: number; semestre: number; publicado_em: string | null }[]>`SELECT company_id, ano, semestre, publicado_em::text FROM pay_transparency_reports WHERE ano=${ano}`,
  ]);
  const out: { companyId: number; empresa: string; empregados: number; obrigatorio: boolean; ano: number; semestre: number; prazo: string; publicado: boolean; aberta: boolean }[] = [];
  for (const c of empresas) for (const sem of [1, 2]) {
    const aberta = h >= inicioJanela(ano, sem); const r = regs.find(x => x.company_id === c.id && x.semestre === sem);
    out.push({ companyId: c.id, empresa: c.nome, empregados: c.empregados, obrigatorio: c.empregados >= minimo, ano, semestre: sem, prazo: prazoSemestre(ano, sem), publicado: !!r?.publicado_em, aberta });
  }
  return out.filter(x => x.aberta);
}
