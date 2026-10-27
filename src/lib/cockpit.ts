import { sql } from "@/db";
import { getSettings, hoje, addDays } from "./utils";
import { limitesPeriodo, type Contexto } from "./contexto";
import { inadimplencia } from "./financeiro";
import { caixaProjetado } from "./fpa";
import { somaMeses } from "./gestao-calc";

/**
 * Números do Cockpit do CFO (T-023/T-028) e do Board do dono (T-001) no contexto global — tudo derivado dos módulos
 * (CRQ-CMD-V3-03: nenhum número digitado); sem fonte, o valor fica null e a tela mostra "sem fonte" (nunca zero).
 */
export type SerieMes = { periodo: string; receita: number | null; despesa: number | null; ebitda: number | null; orcReceita: number | null; orcDespesa: number | null };
export type ValoresMes = { receita: number; despesa: number; ebitda: number };
/** Mês em andamento (régua MTD): o período é o mês corrente e o caixa tem lançamentos nele até antes do último dia do mês. */
export function mesParcial(periodo: string, hojeIso: string, fim: string | null) {
  if (!fim || periodo !== hojeIso.slice(0, 7) || fim.slice(0, 7) !== periodo) return null;
  const diasMes = Number(limitesPeriodo(periodo).ult.slice(8, 10)); const dia = Number(fim.slice(8, 10));
  if (!(dia >= 1) || dia >= diasMes) return null;
  return { ate: fim, dia, diasMes, fracao: dia / diasMes };
}
/** O mesmo dia em outro mês (limitado ao último dia dele): a régua para comparar o mês em andamento com o mês anterior e com o ano anterior. */
export function mesmoDia(periodo: string, dia: number) { const ult = Number(limitesPeriodo(periodo).ult.slice(8, 10)); return `${periodo}-${String(Math.min(dia, ult)).padStart(2, "0")}`; }
/**
 * Orçado proporcional ao período decorrido do mês: pelo perfil do mesmo mês do ano anterior (a fração que já tinha entrado até o mesmo dia —
 * respeita a concentração das mensalidades no vencimento) ou, sem esse histórico, por dias corridos.
 */
export function orcadoProporcional(orc: number | null, fracao: number, aaAte: number | null, aaMes: number | null): { valor: number | null; base: "perfil" | "linear" } {
  if (orc === null) return { valor: null, base: "linear" };
  if (aaAte !== null && aaMes !== null && aaMes > 0 && aaAte >= 0 && aaAte <= aaMes) return { valor: orc * (aaAte / aaMes), base: "perfil" };
  return { valor: orc * fracao, base: "linear" };
}

export async function painelFinanceiro(ctx: Contexto) {
  const cfg = await getSettings(); const h = hoje(); const { ini, prox, ano, mes } = limitesPeriodo(ctx.periodo);
  const units = ctx.unitIds ?? ctx.units.map(u => u.id);
  const internas = cfg.dre.internas as string[]; const financeiras = cfg.dre.financeiras as string[];
  const amanha = addDays(h, 1); const corte = prox < amanha ? prox : amanha;
  const de13 = somaMeses(ctx.periodo, -12); const de24 = somaMeses(ctx.periodo, -23);
  // série mensal de caixa (24 meses) e orçamento dos dois anos
  const [mov, orc] = await Promise.all([
    sql<{ periodo: string; receita: number; despesa: number; financeiras: number }[]>`SELECT to_char(data, 'YYYY-MM') AS periodo, coalesce(sum(valor) FILTER (WHERE tipo='ENTRADA'), 0)::float AS receita, coalesce(sum(valor) FILTER (WHERE tipo='SAIDA'), 0)::float AS despesa, coalesce(sum(valor) FILTER (WHERE tipo='SAIDA' AND categoria = ANY(${financeiras})), 0)::float AS financeiras
      FROM cash_entries WHERE tipo IN ('ENTRADA','SAIDA') AND NOT (categoria = ANY(${internas})) AND data >= ${de24 + "-01"}::date AND data < ${corte}::date AND unit_id = ANY(${units}) GROUP BY 1`,
    sql<{ ano: number; mes: number; tipo: string; valor: number }[]>`WITH cats AS (SELECT DISTINCT ano, unit_id, tipo, categoria FROM budgets WHERE ano BETWEEN ${ano - 1} AND ${ano} AND unit_id = ANY(${units}) UNION SELECT DISTINCT ano, unit_id, tipo, categoria FROM budget_months WHERE ano BETWEEN ${ano - 1} AND ${ano} AND unit_id = ANY(${units}))
      SELECT c.ano, ms.mes, c.tipo, sum(coalesce(bm.valor, b.valor_mensal))::float AS valor FROM cats c CROSS JOIN generate_series(1, 12) AS ms(mes)
        LEFT JOIN budget_months bm ON bm.ano=c.ano AND bm.unit_id=c.unit_id AND bm.tipo=c.tipo AND bm.categoria=c.categoria AND bm.mes=ms.mes LEFT JOIN budgets b ON b.ano=c.ano AND b.unit_id=c.unit_id AND b.tipo=c.tipo AND b.categoria=c.categoria
      WHERE coalesce(bm.valor, b.valor_mensal) IS NOT NULL AND NOT (c.categoria = ANY(${internas})) GROUP BY 1, 2, 3`,
  ]);
  const [{ inicio, fim }] = await sql<{ inicio: string | null; fim: string | null }[]>`SELECT min(data)::text AS inicio, max(data)::text AS fim FROM cash_entries WHERE unit_id = ANY(${units})`;
  // o mês só tem fonte entre o primeiro e o último mês importados: depois do último lançamento é "sem fonte" (ainda não importado), nunca zero
  const temCaixa = (p: string) => !!inicio && !!fim && p >= inicio.slice(0, 7) && p <= fim.slice(0, 7) && `${p}-01` < corte;
  const serie24: SerieMes[] = [];
  for (let p = de24; p <= ctx.periodo; p = somaMeses(p, 1)) {
    const m = mov.find(x => x.periodo === p); const [a, mm] = p.split("-").map(Number);
    const oR = orc.find(o => o.ano === a && o.mes === mm && o.tipo === "ENTRADA")?.valor ?? null; const oD = orc.find(o => o.ano === a && o.mes === mm && o.tipo === "SAIDA")?.valor ?? null;
    const tem = temCaixa(p);
    serie24.push({ periodo: p, receita: tem ? m?.receita ?? 0 : null, despesa: tem ? m?.despesa ?? 0 : null, ebitda: tem ? (m?.receita ?? 0) - (m?.despesa ?? 0) + (m?.financeiras ?? 0) : null, orcReceita: oR, orcDespesa: oD });
  }
  const serie13 = serie24.filter(x => x.periodo >= de13);
  const atual = serie24[serie24.length - 1]; const mesAnoAnterior = serie24.find(x => x.periodo === somaMeses(ctx.periodo, -12)) ?? null; const anterior = serie24[serie24.length - 2] ?? null;
  // caixa: saldo inicial do mês + movimentos até o corte (sem saldo inicial de alguma unidade do recorte → parcial)
  const saldos = await sql<{ unit_id: number; saldo: number }[]>`SELECT unit_id, saldo_inicial::float AS saldo FROM cash_balances WHERE mes=${ctx.periodo} AND unit_id = ANY(${units})`;
  const movUn = await sql<{ unit_id: number; v: number }[]>`SELECT unit_id, sum(CASE WHEN tipo='ENTRADA' THEN valor WHEN tipo='SAIDA' THEN -valor ELSE 0 END)::float AS v FROM cash_entries WHERE data >= ${ini}::date AND data < ${corte}::date AND unit_id = ANY(${units}) GROUP BY 1`;
  const porUnidadeCaixa = ctx.units.filter(u => units.includes(u.id)).map(u => { const s0 = saldos.find(x => x.unit_id === u.id); return { id: u.id, nome: u.nome, saldo: s0 ? s0.saldo + (movUn.find(x => x.unit_id === u.id)?.v ?? 0) : null }; });
  const caixaSaldo = porUnidadeCaixa.some(x => x.saldo !== null) ? porUnidadeCaixa.reduce((a, x) => a + (x.saldo ?? 0), 0) : null;
  const caixaParcial = porUnidadeCaixa.some(x => x.saldo === null) && caixaSaldo !== null;
  const [ult] = await sql<{ d: string | null }[]>`SELECT max(data)::text AS d FROM cash_entries WHERE unit_id = ANY(${units})`;
  // mês em andamento: comparações na mesma régua (até o mesmo dia) e orçado proporcional — nunca o mês parcial contra o mês cheio
  const pm = atual.receita !== null ? mesParcial(ctx.periodo, h, fim) : null;
  let parcial: (NonNullable<typeof pm> & { orcReceita: number | null; orcDespesa: number | null; base: "perfil" | "linear"; anterior: ValoresMes | null; anoAnterior: ValoresMes | null }) | null = null;
  if (pm) {
    const pAnt = somaMeses(ctx.periodo, -1), pAA = somaMeses(ctx.periodo, -12);
    const cmp = await sql<{ periodo: string; receita: number; despesa: number; financeiras: number }[]>`SELECT to_char(data, 'YYYY-MM') AS periodo, coalesce(sum(valor) FILTER (WHERE tipo='ENTRADA'), 0)::float AS receita, coalesce(sum(valor) FILTER (WHERE tipo='SAIDA'), 0)::float AS despesa, coalesce(sum(valor) FILTER (WHERE tipo='SAIDA' AND categoria = ANY(${financeiras})), 0)::float AS financeiras
      FROM cash_entries WHERE tipo IN ('ENTRADA','SAIDA') AND NOT (categoria = ANY(${internas})) AND unit_id = ANY(${units})
        AND ((data >= ${pAnt + "-01"}::date AND data <= ${mesmoDia(pAnt, pm.dia)}::date) OR (data >= ${pAA + "-01"}::date AND data <= ${mesmoDia(pAA, pm.dia)}::date)) GROUP BY 1`;
    const mtd = (p: string): ValoresMes | null => { if (!temCaixa(p)) return null; const r = cmp.find(x => x.periodo === p); const rec = r?.receita ?? 0, des = r?.despesa ?? 0; return { receita: rec, despesa: des, ebitda: rec - des + (r?.financeiras ?? 0) }; };
    const ant = mtd(pAnt), aa = mtd(pAA);
    const oR = orcadoProporcional(atual.orcReceita, pm.fracao, aa?.receita ?? null, mesAnoAnterior?.receita ?? null);
    const oD = orcadoProporcional(atual.orcDespesa, pm.fracao, aa?.despesa ?? null, mesAnoAnterior?.despesa ?? null);
    parcial = { ...pm, orcReceita: oR.valor, orcDespesa: oD.valor, base: oR.base, anterior: ant, anoAnterior: aa };
  }
  // inadimplência 30+ (KPI-07) no corte
  const [inad] = await sql<{ num: number | null; den: number | null; familias: number }[]>`SELECT coalesce(sum(valor) FILTER (WHERE vencimento < ${corte}::date - 31 AND NOT (status='PAGO' AND pago_em < ${corte}::date)), 0)::float AS num, sum(valor)::float AS den,
      count(DISTINCT aluno_nome) FILTER (WHERE vencimento < ${corte}::date - 31 AND NOT (status='PAGO' AND pago_em < ${corte}::date))::int AS familias
    FROM receivables WHERE status <> 'CANCELADO' AND vencimento >= ${corte}::date - 366 AND vencimento < ${corte}::date AND unit_id = ANY(${units})`;
  const inad30 = inad?.den ? { pct: (100 * (inad.num ?? 0)) / inad.den, valor: inad.num ?? 0, familias: inad.familias } : null;
  // folha ÷ receita com o resultado ACEITO (KPI-13): a competência mais recente com folha aceita (até 3 meses atrás; nunca o mês em andamento),
  // sobre a receita das MESMAS unidades cobertas pela folha — unidade sem resultado aceito fica fora do numerador e do denominador
  const folhas = await sql<{ competencia: string; unit_id: number; v: number }[]>`SELECT c.competencia, r.unit_id, sum(r.salarios + r.inss + r.fgts + r.provisao_13 + r.provisao_ferias + r.beneficios + r.rescisoes + r.outros)::float AS v
    FROM payroll_cycles c JOIN payroll_results r ON r.cycle_id=c.id WHERE c.aceito_em IS NOT NULL AND c.competencia >= ${somaMeses(ctx.periodo, -3)} AND c.competencia <= ${ctx.periodo} AND r.unit_id = ANY(${units}) GROUP BY 1, 2`;
  let folhaReceita: { pct: number; custo: number; competencia: string; unidades: number; total: number } | null = null;
  for (const comp of [...new Set(folhas.map(f => f.competencia))].sort().reverse()) {
    if (parcial && comp === ctx.periodo) continue;
    if (!temCaixa(comp)) continue;
    const us = folhas.filter(f => f.competencia === comp); const ids = us.map(f => f.unit_id); const lp = limitesPeriodo(comp);
    const [rr] = await sql<{ v: number | null }[]>`SELECT sum(valor)::float AS v FROM cash_entries WHERE tipo='ENTRADA' AND NOT (categoria = ANY(${internas})) AND unit_id = ANY(${ids}) AND data >= ${lp.ini}::date AND data < ${lp.prox}::date`;
    if (!rr?.v) continue;
    const custo = us.reduce((a, f) => a + f.v, 0); folhaReceita = { pct: (100 * custo) / rr.v, custo, competencia: comp, unidades: ids.length, total: units.length }; break;
  }
  const [al] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM students WHERE aluno_atual AND unit_atual_id = ANY(${units})`;
  const [tk] = await sql<{ v: number | null; emitido: number | null; pago: number | null }[]>`SELECT avg(valor) FILTER (WHERE tipo='MENSALIDADE')::float AS v, sum(valor)::float AS emitido, coalesce(sum(valor) FILTER (WHERE status='PAGO' AND pago_em < ${corte}::date), 0)::float AS pago FROM receivables WHERE status <> 'CANCELADO' AND vencimento >= ${ini}::date AND vencimento < ${corte}::date AND unit_id = ANY(${units})`;
  return {
    ano, mes, units, serie24, serie13, atual, anterior, mesAnoAnterior, parcial,
    receita: { real: atual.receita, orc: atual.orcReceita }, despesa: { real: atual.despesa, orc: atual.orcDespesa }, ebitda: atual.ebitda,
    margem: atual.receita && atual.ebitda !== null ? (100 * atual.ebitda) / atual.receita : null,
    caixa: { saldo: caixaSaldo, parcial: caixaParcial, porUnidade: porUnidadeCaixa, dadosAte: ult?.d ?? null, previstoDepois: ult?.d && ult.d < (corte > h ? h : addDays(corte, -1)) ? ult.d : null },
    inad30, folhaReceita, alunos: al.n,
    ticket: tk?.v ?? null, recebimentoPct: tk?.emitido ? (100 * (tk.pago ?? 0)) / tk.emitido : null,
    receitaAluno: atual.receita !== null && al.n ? atual.receita / al.n : null, custoAluno: atual.despesa !== null && al.n ? atual.despesa / al.n : null,
    orcExecutadoPct: atual.despesa !== null && (parcial ? parcial.orcDespesa : atual.orcDespesa) ? (100 * atual.despesa) / (parcial ? parcial.orcDespesa! : atual.orcDespesa!) : null,
  };
}
export type PainelFinanceiro = Awaited<ReturnType<typeof painelFinanceiro>>;

/** Execução do orçamento por categoria de despesa (acumulado até o mês): base dos donuts C7 com a banda saudável. */
export async function execucaoPorCategoria(ctx: Contexto) {
  const cfg = await getSettings(); const { ano, mes, prox } = limitesPeriodo(ctx.periodo); const units = ctx.unitIds ?? ctx.units.map(u => u.id); const h = hoje(); const amanha = addDays(h, 1); const corte = prox < amanha ? prox : amanha;
  const [{ fim }] = await sql<{ fim: string | null }[]>`SELECT max(data)::text AS fim FROM cash_entries WHERE unit_id = ANY(${units})`;
  const pm = mesParcial(ctx.periodo, h, fim); const fr = pm ? pm.fracao : 1; // mês em andamento: o orçado do mês corrente entra proporcional aos dias com dados
  const rows = await sql<{ categoria: string; real: number | null; orc: number | null }[]>`WITH cats AS (SELECT DISTINCT unit_id, categoria FROM budgets WHERE ano=${ano} AND tipo='SAIDA' AND unit_id = ANY(${units}) UNION SELECT DISTINCT unit_id, categoria FROM budget_months WHERE ano=${ano} AND tipo='SAIDA' AND unit_id = ANY(${units})),
      o AS (SELECT c.categoria, sum(coalesce(bm.valor, b.valor_mensal) * CASE WHEN ms.mes = ${mes}::int THEN ${fr}::float ELSE 1 END)::float AS v FROM cats c CROSS JOIN generate_series(1, ${mes}::int) AS ms(mes) LEFT JOIN budget_months bm ON bm.ano=${ano} AND bm.unit_id=c.unit_id AND bm.tipo='SAIDA' AND bm.categoria=c.categoria AND bm.mes=ms.mes LEFT JOIN budgets b ON b.ano=${ano} AND b.unit_id=c.unit_id AND b.tipo='SAIDA' AND b.categoria=c.categoria GROUP BY 1),
      r AS (SELECT categoria, sum(valor)::float AS v FROM cash_entries WHERE tipo='SAIDA' AND data >= ${`${ano}-01-01`}::date AND data < ${corte}::date AND unit_id = ANY(${units}) GROUP BY 1)
    SELECT coalesce(o.categoria, r.categoria) AS categoria, r.v AS real, o.v AS orc FROM o FULL JOIN r ON r.categoria=o.categoria`;
  const faixa: [number, number] = [Number(cfg.orcamento.faixaMinPct), Number(cfg.orcamento.faixaMaxPct)];
  return { faixa, parcialAte: pm?.ate ?? null, itens: rows.filter(r => !(cfg.dre.internas as string[]).includes(r.categoria)).map(r => ({ ...r, pct: r.orc ? (100 * (r.real ?? 0)) / r.orc : null })).sort((a, b) => (b.orc ?? 0) - (a.orc ?? 0)) };
}

/** Tesouraria (T-028): saldo por unidade, média diária de saídas (90 dias), dias de cobertura, PMR e saídas previstas 30/60 dias. */
export async function tesouraria(ctx: Contexto, saldo: number | null) {
  const cfg = await getSettings(); const h = hoje(); const units = ctx.unitIds ?? ctx.units.map(u => u.id);
  // no consolidado da rede, transferência entre unidades não sai do grupo: fica fora da média de saídas (numa unidade só, é saída real do caixa dela)
  const internas = ctx.unitIds === null ? (cfg.dre.internas as string[]) : [];
  const [sai] = await sql<{ v: number | null }[]>`SELECT (sum(valor) / 90.0)::float AS v FROM cash_entries WHERE tipo='SAIDA' AND NOT (categoria = ANY(${internas})) AND data > ${addDays(h, -90)}::date AND data <= ${h}::date AND unit_id = ANY(${units})`;
  const [pmr] = await sql<{ v: number | null; n: number }[]>`SELECT avg(pago_em - vencimento)::float AS v, count(*)::int AS n FROM receivables WHERE status='PAGO' AND pago_em IS NOT NULL AND pago_em > ${addDays(h, -90)}::date AND unit_id = ANY(${units})`;
  let projecao: { saidas30: number; saidas60: number; entradas30: number; menor: { ate: string; min: number } | null } | null = null;
  try {
    const alvo = ctx.unitIds === null ? [null] : ctx.unitIds; const ps = await Promise.all(alvo.map(u => caixaProjetado(u)));
    projecao = { saidas30: ps.reduce((a, p) => a + (p.marcos[0]?.saidas ?? 0), 0), saidas60: ps.reduce((a, p) => a + (p.marcos[1]?.saidas ?? 0), 0), entradas30: ps.reduce((a, p) => a + (p.marcos[0]?.entradas ?? 0), 0), menor: ps.length === 1 ? ps[0].menor : null };
  } catch { projecao = null; }
  const mediaDia = sai?.v ?? null;
  // v27 · contas a pagar como fonte: parcelas aprovadas a vencer em 30 dias e vencidas sem baixa (na rede, também as corporativas)
  let contasPagar: { n30: number; v30: number; vencN: number; vencV: number } | null = null;
  try {
    const [cp] = await sql<{ n30: number; v30: number; venc_n: number; venc_v: number }[]>`SELECT count(*) FILTER (WHERE i.vencimento >= ${h}::date AND i.vencimento <= ${addDays(h, 30)}::date)::int AS n30,
        coalesce(sum(i.valor) FILTER (WHERE i.vencimento >= ${h}::date AND i.vencimento <= ${addDays(h, 30)}::date), 0)::float AS v30,
        count(*) FILTER (WHERE i.vencimento < ${h}::date)::int AS venc_n, coalesce(sum(i.valor) FILTER (WHERE i.vencimento < ${h}::date), 0)::float AS venc_v
      FROM payable_installments i JOIN payables p ON p.id=i.payable_id WHERE i.status='A_PAGAR' AND p.status='ATIVO' AND (p.unit_id = ANY(${units}) ${ctx.unitIds === null ? sql`OR p.unit_id IS NULL` : sql``})`;
    contasPagar = { n30: cp.n30, v30: cp.v30, vencN: cp.venc_n, vencV: cp.venc_v };
  } catch { contasPagar = null; /* banco anterior à v27 */ }
  return { mediaSaidasDia: mediaDia, coberturaDias: saldo !== null && mediaDia ? saldo / mediaDia : null, pmrDias: pmr?.n ? pmr.v : null, pmrBase: pmr?.n ?? 0, projecao, contasPagar };
}

/** Maiores devedores (agrupados por aluno e responsável) e maiores despesas do mês — as listas de ação do cockpit. */
export async function topListas(ctx: Contexto) {
  const cfg = await getSettings(); const internas = cfg.dre.internas as string[]; const { ini, prox } = limitesPeriodo(ctx.periodo); const units = ctx.unitIds ?? ctx.units.map(u => u.id);
  const inad = await inadimplencia(ctx.unitId);
  const itens = inad.itens.filter(i => units.includes(i.unit_id));
  const porFamilia = new Map<string, { aluno: string; responsavel: string | null; unidade: string; valor: number; dias: number; titulos: number; student_id: number | null }>();
  for (const i of itens) { const k = `${i.aluno_nome}|${i.responsavel ?? ""}`; const x = porFamilia.get(k) ?? { aluno: i.aluno_nome, responsavel: i.responsavel, unidade: i.unidade, valor: 0, dias: 0, titulos: 0, student_id: i.student_id }; x.valor += i.valor; x.dias = Math.max(x.dias, i.dias); x.titulos++; porFamilia.set(k, x); }
  const devedores = [...porFamilia.values()].sort((a, b) => b.valor - a.valor).slice(0, 8);
  const despesas = await sql<{ id: number; data: string; unidade: string; categoria: string; descricao: string | null; contraparte: string | null; valor: number }[]>`SELECT c.id, c.data::text, u.nome AS unidade, c.categoria, c.descricao, c.contraparte, c.valor::float FROM cash_entries c JOIN units u ON u.id=c.unit_id WHERE c.tipo='SAIDA' AND NOT (c.categoria = ANY(${internas})) AND c.data >= ${ini}::date AND c.data < ${prox}::date AND c.unit_id = ANY(${units}) ORDER BY c.valor DESC LIMIT 8`;
  const aging = inad.aging.map((a, i) => ({ ...a, valor: itens.filter(x => x.faixa === i).reduce((s, x) => s + x.valor, 0), n: itens.filter(x => x.faixa === i).length }));
  return { devedores, despesas, aging, totalVencido: itens.reduce((a, x) => a + x.valor, 0), acoesPendentes: itens.filter(x => x.acaoPendente).length };
}

/** Funil 2027 ponderado (KPI-03 · Board): confirmadas × 1, reservas × peso, lista de espera × peso — pesos em Configurações (board). */
export async function funilPonderado(ctx: Contexto) {
  const cfg = await getSettings(); const ano = cfg.matriculas.anoLetivo as number; const pesos = cfg.board.pesosFunil as Record<string, number>; const units = ctx.unitIds ?? ctx.units.map(u => u.id);
  const [r] = await sql<{ conf: number; res: number; fila: number; vagas: number }[]>`SELECT
      (SELECT count(*) FROM enrollments e JOIN classes c ON c.id=e.class_id WHERE c.ano=${ano} AND c.modalidade='REGULAR' AND e.status='CONFIRMADA' AND c.unit_id = ANY(${units}))::int AS conf,
      (SELECT count(*) FROM enrollments e JOIN classes c ON c.id=e.class_id WHERE c.ano=${ano} AND c.modalidade='REGULAR' AND e.status='RESERVADA' AND c.unit_id = ANY(${units}))::int AS res,
      (SELECT count(*) FROM waitlist w WHERE w.ano=${ano} AND w.status IN ('AGUARDANDO','OFERTADA') AND w.unit_id = ANY(${units}))::int AS fila,
      (SELECT coalesce(sum(vagas), 0) FROM classes c WHERE c.ano=${ano} AND c.modalidade='REGULAR' AND c.status <> 'CANCELADA' AND c.unit_id = ANY(${units}))::int AS vagas`;
  const ponderado = r.conf * (pesos.CONFIRMADA ?? 1) + r.res * (pesos.RESERVADA ?? 0.6) + r.fila * (pesos.FILA ?? 0.15);
  return { ano, ...r, ponderado: Math.round(ponderado * 10) / 10, ocupacaoPct: r.vagas ? (100 * (r.conf + r.res)) / r.vagas : null, pesos };
}

/** Projeção de receita para os meses à frente no ano (orçado do mês ou média dos 3 últimos realizados) com a banda dos cenários. */
export function projetarReceita(serie: SerieMes[], futuros: { periodo: string; orc: number | null }[], pess: number, otim: number) {
  const reais = serie.map(s => s.receita).filter((x): x is number => x !== null); const base = reais.slice(-3);
  const media = base.length ? base.reduce((a, b) => a + b, 0) / base.length : null;
  return futuros.map(f => { const v = f.orc ?? media; return { periodo: f.periodo, valor: v, min: v === null ? null : v * pess, max: v === null ? null : v * Math.max(otim, 1) }; });
}

/** Resumo por unidade para o mapa das unidades (C15 · Board) e a Visão da rede (T-008): consultas agrupadas, uma por indicador. */
export async function resumoPorUnidade(ctx: Contexto) {
  const cfg = await getSettings(); const { ini, prox } = limitesPeriodo(ctx.periodo); const h = hoje(); const amanha = addDays(h, 1); const corte = prox < amanha ? prox : amanha;
  const units = ctx.unitIds ?? ctx.units.map(u => u.id); const ano = cfg.matriculas.anoLetivo as number; const internas = cfg.dre.internas as string[];
  const [rec, alunos, ocup, inad, saude, colab, chamados, casos, nps] = await Promise.all([
    sql<{ unit_id: number; receita: number; despesa: number }[]>`SELECT unit_id, coalesce(sum(valor) FILTER (WHERE tipo='ENTRADA'), 0)::float AS receita, coalesce(sum(valor) FILTER (WHERE tipo='SAIDA'), 0)::float AS despesa FROM cash_entries WHERE data >= ${ini}::date AND data < ${corte}::date AND tipo IN ('ENTRADA','SAIDA') AND NOT (categoria = ANY(${internas})) AND unit_id = ANY(${units}) GROUP BY 1`,
    sql<{ unit_id: number; n: number }[]>`SELECT unit_atual_id AS unit_id, count(*)::int AS n FROM students WHERE aluno_atual AND unit_atual_id = ANY(${units}) GROUP BY 1`,
    sql<{ unit_id: number; vagas: number; ocupadas: number }[]>`SELECT c.unit_id, sum(c.vagas)::int AS vagas, (SELECT count(*) FROM enrollments e JOIN classes c2 ON c2.id=e.class_id WHERE c2.unit_id=c.unit_id AND c2.ano=${ano} AND c2.modalidade='REGULAR' AND e.status IN ('CONFIRMADA','RESERVADA'))::int AS ocupadas FROM classes c WHERE c.ano=${ano} AND c.modalidade='REGULAR' AND c.unit_id = ANY(${units}) GROUP BY 1`,
    sql<{ unit_id: number; num: number; den: number; valor: number }[]>`SELECT unit_id, coalesce(sum(valor) FILTER (WHERE vencimento < ${corte}::date - 31 AND NOT (status='PAGO' AND pago_em < ${corte}::date)), 0)::float AS num, sum(valor)::float AS den, coalesce(sum(valor) FILTER (WHERE status='ABERTO' AND vencimento < ${h}::date), 0)::float AS valor FROM receivables WHERE status <> 'CANCELADO' AND vencimento >= ${corte}::date - 366 AND vencimento < ${corte}::date AND unit_id = ANY(${units}) GROUP BY 1`,
    sql<{ unit_id: number; geral: number; data: string }[]>`SELECT DISTINCT ON (unit_id) unit_id, geral, data::text FROM health_snapshots WHERE unit_id = ANY(${units}) ORDER BY unit_id, data DESC`,
    sql<{ unit_id: number; n: number }[]>`SELECT unit_id, count(*)::int AS n FROM employees WHERE situacao IN ('ATIVO','FERIAS','AFASTADO') AND unit_id = ANY(${units}) GROUP BY 1`,
    sql<{ unit_id: number; n: number }[]>`SELECT unit_id, count(*)::int AS n FROM work_orders WHERE status NOT IN ('CONCLUIDO','CANCELADO') AND unit_id = ANY(${units}) GROUP BY 1`,
    sql<{ unit_id: number; n: number; atrasados: number }[]>`SELECT unit_id, count(*)::int AS n, count(*) FILTER (WHERE sla_ate < now())::int AS atrasados FROM cases WHERE status NOT IN ('RESOLVIDO','FECHADO','CANCELADO') AND unit_id = ANY(${units}) GROUP BY 1`,
    sql<{ unit_id: number; nps: number | null; n: number }[]>`SELECT unit_id, (100.0 * (count(*) FILTER (WHERE nota >= 9) - count(*) FILTER (WHERE nota <= 6)) / nullif(count(*), 0))::float AS nps, count(*)::int AS n FROM surveys WHERE tipo='NPS' AND data >= ${h}::date - 180 AND unit_id = ANY(${units}) GROUP BY 1`,
  ]);
  return ctx.units.filter(u => units.includes(u.id)).map(u => {
    const r = rec.find(x => x.unit_id === u.id); const o = ocup.find(x => x.unit_id === u.id); const i = inad.find(x => x.unit_id === u.id); const k = casos.find(x => x.unit_id === u.id); const p = nps.find(x => x.unit_id === u.id);
    return { id: u.id, nome: u.nome, codigo: u.codigo, receita: r?.receita ?? null, despesa: r?.despesa ?? null, alunos: alunos.find(x => x.unit_id === u.id)?.n ?? 0, vagas: o?.vagas ?? 0, ocupadas: o?.ocupadas ?? 0, ocupacaoPct: o?.vagas ? (100 * o.ocupadas) / o.vagas : null,
      inad30: i?.den ? (100 * i.num) / i.den : null, vencido: i?.valor ?? null, saude: saude.find(x => x.unit_id === u.id)?.geral ?? null, colaboradores: colab.find(x => x.unit_id === u.id)?.n ?? 0, chamados: chamados.find(x => x.unit_id === u.id)?.n ?? 0, casos: k?.n ?? 0, casosAtrasados: k?.atrasados ?? 0, nps: p?.n ? p.nps : null };
  });
}
export type ResumoUnidade = Awaited<ReturnType<typeof resumoPorUnidade>>[number];
