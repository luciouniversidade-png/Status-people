/**
 * v30 · Benefícios (no estilo dos módulos de benefícios das plataformas de RH): catálogo com regra de elegibilidade e carência, adesões com
 * dependentes, bolsa de estudos para filho(a) aluno(a), o que a escola paga × o que é descontado em folha, as movimentações do mês que vão
 * no pacote da folha e a REMUNERAÇÃO TOTAL estimada (salário, 13º, férias + 1/3, FGTS, encargos e benefícios) — para a pessoa e para o RH.
 * Regras: VT com desconto de no máximo 6% do salário-base (Lei 7.418/1985); valores por pessoa só para quem vê salário (e a própria pessoa).
 */
import { sql } from "@/db";
import { getSettings, hoje, addDays } from "./utils";

export const BENEF_TIPOS_PADRAO: Record<string, string> = { VT: "Vale-transporte", VA: "Vale-alimentação", VR: "Vale-refeição", SAUDE: "Plano de saúde", ODONTO: "Plano odontológico", VIDA: "Seguro de vida", BOLSA_DEPENDENTE: "Bolsa de estudos para filho(a)", CRECHE: "Auxílio-creche", CESTA: "Cesta básica", OUTRO: "Outro" };
export const ADESAO_STATUS: Record<string, string> = { ATIVO: "Ativa", ENCERRADO: "Encerrada" };

export type Elegibilidade = { vinculos?: string[]; unidades?: number[]; cargos?: number[]; jornadaMinDia?: number | null; depPctEmpresa?: number | null };
export type Plano = { id: number; nome: string; tipo: string; fornecedor: string | null; custo_empresa: number | null; custo_empresa_pct: number | null; desconto_colab: number | null; desconto_colab_pct: number | null; custo_dependente: number | null; elegibilidade: Elegibilidade | null; carencia_dias: number; ativo: boolean; obs: string | null };
export type PessoaBenef = { id: number; nome: string; vinculo: string; unit_id: number; position_id: number | null; jornada_min_dia: number | null; admissao: string; salario: number | null; situacao: string };

/** A pessoa é elegível ao plano na data? Devolve os motivos quando não é (vínculo, unidade, cargo, jornada mínima, carência). */
export function elegivel(p: Plano, e: PessoaBenef, data = hoje()): { ok: boolean; motivos: string[]; liberaEm: string | null } {
  const r = p.elegibilidade ?? {}; const motivos: string[] = [];
  if (r.vinculos?.length && !r.vinculos.includes(e.vinculo)) motivos.push(`vínculo ${e.vinculo} fora da regra`);
  if (r.unidades?.length && !r.unidades.includes(e.unit_id)) motivos.push("unidade fora da regra");
  if (r.cargos?.length && (e.position_id === null || !r.cargos.includes(e.position_id))) motivos.push("cargo fora da regra");
  if (r.jornadaMinDia && (e.jornada_min_dia ?? 0) < r.jornadaMinDia) motivos.push(`jornada menor que ${Math.round(r.jornadaMinDia / 60 * 10) / 10} h/dia`);
  const liberaEm = p.carencia_dias > 0 ? addDays(e.admissao, p.carencia_dias) : null;
  if (liberaEm && liberaEm > data) motivos.push(`carência até ${liberaEm.split("-").reverse().join("/")}`);
  return { ok: motivos.length === 0, motivos, liberaEm };
}

/**
 * Valores mensais da adesão. Titular: preço do plano (ou o valor informado — VT é o custo real do transporte; bolsa é a mensalidade × %).
 * Parte da pessoa: VT = menor entre o custo e o % do salário (máx. 6%); com desconto fixo, o desconto; senão, o que a escola não cobre.
 * Dependentes: preço por dependente, com a parte da escola configurada no plano (padrão 0% — a pessoa paga).
 */
export function calcularAdesao(p: Plano, salario: number | null, dependentes: number, valorInformado: number | null, vtMaxPct: number) {
  const titular = valorInformado ?? Number(p.custo_empresa ?? 0);
  let colab = 0;
  if (p.tipo === "VT") { const pct = Math.min(Number(p.desconto_colab_pct ?? vtMaxPct), vtMaxPct); colab = salario ? Math.min(titular, (salario * pct) / 100) : 0; }
  else if (p.desconto_colab !== null && p.desconto_colab !== undefined) colab = Math.min(titular, Number(p.desconto_colab));
  else if (p.desconto_colab_pct !== null && p.desconto_colab_pct !== undefined && salario) colab = Math.min(titular, (salario * Number(p.desconto_colab_pct)) / 100);
  else colab = titular * (1 - Number(p.custo_empresa_pct ?? 100) / 100);
  const dep = Math.max(0, dependentes) * Number(p.custo_dependente ?? 0); const depEmp = dep * Math.min(100, Math.max(0, Number(p.elegibilidade?.depPctEmpresa ?? 0))) / 100;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return { empresa: r2(Math.max(0, titular - colab) + depEmp), colab: r2(colab + dep - depEmp), titular: r2(titular), dependentes: r2(dep) };
}

export type AdesaoLinha = { id: number; plan_id: number; plano: string; tipo: string; fornecedor: string | null; employee_id: number; nome: string; unidade: string; unit_id: number; inicio: string; fim: string | null; status: string; dependentes: number; student_id: number | null; aluno: string | null; bolsa_pct: number | null; valor_empresa: number | null; valor_colab: number | null; obs: string | null; motivo_fim: string | null };
export async function adesoes(f: { employeeId?: number; unitId?: number | null; planId?: number | null; status?: string | null }) {
  return sql<AdesaoLinha[]>`SELECT a.id, a.plan_id, p.nome AS plano, p.tipo, p.fornecedor, a.employee_id, e.nome, un.nome AS unidade, e.unit_id, a.inicio::text, a.fim::text, a.status, a.dependentes, a.student_id, st.nome AS aluno, a.bolsa_pct::float, a.valor_empresa::float, a.valor_colab::float, a.obs, a.motivo_fim
    FROM benefit_enrollments a JOIN benefit_plans p ON p.id=a.plan_id JOIN employees e ON e.id=a.employee_id JOIN units un ON un.id=e.unit_id LEFT JOIN students st ON st.id=a.student_id
    WHERE true ${f.employeeId ? sql`AND a.employee_id=${f.employeeId}` : sql``} ${f.unitId ? sql`AND e.unit_id=${f.unitId}` : sql``} ${f.planId ? sql`AND a.plan_id=${f.planId}` : sql``} ${f.status ? sql`AND a.status=${f.status}` : sql``}
    ORDER BY a.status, e.nome, p.nome`;
}

/** Remuneração total estimada no ano (para a conversa de valorização — não é holerite): salário × 12, 13º, férias + 1/3, FGTS, encargos e benefícios pagos pela escola. */
export async function remuneracaoTotal(employeeId: number) {
  const cfg = await getSettings();
  const [[e], ativos] = await Promise.all([
    sql<{ salario: number | null; vinculo: string; nome: string }[]>`SELECT salario::float, vinculo, nome FROM employees WHERE id=${employeeId}`,
    sql<{ plano: string; tipo: string; valor_empresa: number | null; valor_colab: number | null }[]>`SELECT p.nome AS plano, p.tipo, a.valor_empresa::float, a.valor_colab::float FROM benefit_enrollments a JOIN benefit_plans p ON p.id=a.plan_id WHERE a.employee_id=${employeeId} AND a.status='ATIVO'`,
  ]);
  if (!e) return null;
  const sal = Number(e.salario ?? 0); const clt = ["CLT", "HORISTA", "TEMPORARIO"].includes(e.vinculo);
  const fgtsPct = Number(cfg.beneficios.fgtsPct ?? 8) / 100; const encPct = Number(cfg.financeiro.encargosPct ?? 0) / 100;
  const anual = sal * 12, decimo = clt ? sal : 0, ferias = clt ? sal / 3 : 0;
  const base = anual + decimo + ferias; const fgts = clt ? base * fgtsPct : 0;
  // a estimativa de encargos do Financeiro (Configurações) inclui o FGTS: aqui o FGTS aparece separado e “encargos” é o restante (INSS patronal, RAT, terceiros)
  const encargos = clt ? Math.max(0, base * Math.max(0, encPct - fgtsPct)) : 0;
  const beneficios = ativos.reduce((a, b) => a + Number(b.valor_empresa ?? 0) * 12, 0);
  const total = base + fgts + encargos + beneficios;
  return { nome: e.nome, vinculo: e.vinculo, clt, salario: sal, partes: [
    { rotulo: "Salário (12 meses)", valor: anual }, { rotulo: "13º salário", valor: decimo }, { rotulo: "Férias + 1/3 (o terço)", valor: ferias }, { rotulo: "FGTS", valor: fgts },
    { rotulo: "Encargos pagos pela escola", valor: encargos }, { rotulo: "Benefícios pagos pela escola", valor: beneficios },
  ].filter(p => p.valor > 0), beneficios: ativos, total, mensalEquivalente: total / 12, multiplicador: sal ? total / anual : null, encargosPct: encPct * 100, fgtsPct: fgtsPct * 100 };
}

/** Movimentações de benefícios na competência (vão no pacote da folha): adesões, encerramentos e os descontos em folha ativos. */
export async function movimentosBeneficios(ids: number[], ini: string, fim: string) {
  if (!ids.length) return [];
  const rows = await sql<{ employee_id: number; plano: string; tipo: string; inicio: string; fim: string | null; status: string; dependentes: number; valor_colab: number | null; valor_empresa: number | null }[]>`SELECT a.employee_id, p.nome AS plano, p.tipo, a.inicio::text, a.fim::text, a.status, a.dependentes, a.valor_colab::float, a.valor_empresa::float
    FROM benefit_enrollments a JOIN benefit_plans p ON p.id=a.plan_id WHERE a.employee_id = ANY(${ids}) AND a.inicio <= ${fim}::date AND (a.fim IS NULL OR a.fim >= ${ini}::date) ORDER BY a.employee_id, p.nome`;
  const ordem: Record<string, number> = { ADESAO: 0, ENCERRAMENTO: 1, DESCONTO: 2 };
  // o que o contador precisa: adesões e encerramentos do mês e os descontos em folha (benefício sem desconto não é lançamento)
  return rows.map(r => ({ ...r, movimento: r.inicio >= ini ? "ADESAO" : r.fim && r.fim <= fim ? "ENCERRAMENTO" : "DESCONTO" }))
    .filter(r => r.movimento !== "DESCONTO" || Number(r.valor_colab ?? 0) > 0)
    .sort((a, b) => ordem[a.movimento] - ordem[b.movimento] || a.employee_id - b.employee_id);
}

/** Custo mensal dos benefícios ativos por plano e por unidade (escola × colaborador). */
export async function custoBeneficios(unitId: number | null) {
  return sql<{ plan_id: number; plano: string; tipo: string; unidade: string; unit_id: number; pessoas: number; dependentes: number; empresa: number; colab: number }[]>`SELECT p.id AS plan_id, p.nome AS plano, p.tipo, un.nome AS unidade, un.id AS unit_id, count(*)::int AS pessoas, sum(a.dependentes)::int AS dependentes, coalesce(sum(a.valor_empresa),0)::float AS empresa, coalesce(sum(a.valor_colab),0)::float AS colab
    FROM benefit_enrollments a JOIN benefit_plans p ON p.id=a.plan_id JOIN employees e ON e.id=a.employee_id JOIN units un ON un.id=e.unit_id WHERE a.status='ATIVO' ${unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`} GROUP BY p.id, un.id ORDER BY p.nome, un.nome`;
}
