import { sql } from "@/db";
import type { Settings } from "./utils";
import { periodosFerias, addDays } from "./utils";
import { matrizTreinamento } from "./clima-academy";
import { estatisticasGov } from "./governanca";
import { contatoRecente } from "./metricas-extra";
import { progressoKR } from "./estrategia";
import { somaMeses } from "./gestao-calc";

/**
 * Cálculo de cada indicador do catálogo (kpi-catalogo.ts), mês a mês, em consultas de conjunto: uma consulta por indicador
 * cobre todos os meses e todas as unidades. Cada linha traz o período 'YYYY-MM', a unidade (0 = registro sem unidade, que só conta
 * na rede) e o valor — ou numerador e denominador, quando é uma razão.
 * "corte" é o fim do mês (1º dia do mês seguinte) — no mês corrente, amanhã: nada do futuro entra na conta.
 */
export type Linha = { periodo: string; unit_id: number; valor?: number | null; num?: number | null; den?: number | null };
export type Ctx = { de: string; ate: string; amanha: string; hoje: string; cfg: Settings; units: number[] };
type Calc = { calc: (c: Ctx) => Promise<Linha[]>; inicio?: (c: Ctx) => Promise<string | null> };

const M = (c: Ctx) => sql`m AS (SELECT to_char(d, 'YYYY-MM') AS periodo, d::date AS ini, least((d + interval '1 month')::date, ${c.amanha}::date) AS corte FROM generate_series(${c.de + "-01"}::date, ${c.ate + "-01"}::date, interval '1 month') d)`;
/** Colaborador ativo no corte (admitido antes, não desligado até ele, fora quem ainda está em admissão). */
const ATIVO = sql`e.admissao < m.corte AND e.situacao <> 'EM_ADMISSAO' AND (e.desligamento >= m.corte OR (e.desligamento IS NULL AND e.situacao <> 'DESLIGADO'))`;
const primeiro = (q: Promise<{ d: string | null }[]>) => q.then(r => r[0]?.d ?? null);
/** Captação (mesma regra de Estratégia → Marketing): não é rematrícula declarada e, se já é aluno, teve a origem informada. */
const CAPTACAO = sql`(st.origem IS DISTINCT FROM 'REMATRICULA' AND (NOT st.aluno_atual OR st.origem IS NOT NULL))`;
const UNID_CANDIDATO = sql`coalesce(st.unit_atual_id, (SELECT c2.unit_id FROM enrollments e2 JOIN classes c2 ON c2.id=e2.class_id WHERE e2.student_id=st.id ORDER BY e2.id DESC LIMIT 1), (SELECT w.unit_id FROM waitlist w WHERE w.student_id=st.id ORDER BY w.id DESC LIMIT 1), 0)`;
/** Matrícula ativa no corte: confirmada até ele, ou reserva criada antes e válida até o último dia do mês (canceladas e transferidas ficam fora). */
const MATRICULA_ATIVA = sql`(e.created_at < m.corte AND e.status IN ('CONFIRMADA','RESERVADA','EXPIRADA') AND ((e.status='CONFIRMADA' AND e.confirmada_em < m.corte) OR (e.reserva_ate >= m.corte - 1 AND (e.confirmada_em IS NULL OR e.confirmada_em >= m.corte))))`;

export const CALCS: Record<string, Calc> = {
  // ------------------------------------------------------------------ Pessoas
  "pessoas.quadro": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, e.unit_id, count(*)::float AS valor FROM m JOIN employees e ON ${ATIVO} GROUP BY 1, 2`,
    inicio: () => primeiro(sql`SELECT min(admissao)::text AS d FROM employees`),
  },
  "pessoas.admissoes": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, e.unit_id, count(*)::float AS valor FROM m JOIN employees e ON e.admissao >= m.ini AND e.admissao < m.corte GROUP BY 1, 2`,
    inicio: () => primeiro(sql`SELECT min(admissao)::text AS d FROM employees`),
  },
  "pessoas.desligamentos": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, e.unit_id, count(*)::float AS valor FROM m JOIN employees e ON e.desligamento >= m.ini AND e.desligamento < m.corte GROUP BY 1, 2`,
    inicio: () => primeiro(sql`SELECT min(admissao)::text AS d FROM employees`),
  },
  "pessoas.turnover": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, e.unit_id, count(*) FILTER (WHERE e.desligamento >= m.corte - 366 AND e.desligamento < m.corte)::float AS num, count(*) FILTER (WHERE ${ATIVO})::float AS den FROM m CROSS JOIN employees e GROUP BY 1, 2`,
    inicio: () => primeiro(sql`SELECT min(admissao)::text AS d FROM employees`),
  },
  "pessoas.absenteismo": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, e.unit_id, count(*) FILTER (WHERE t.status='FALTA')::float AS num, count(*) FILTER (WHERE t.esperado_min > 0)::float AS den FROM m JOIN timesheet_days t ON t.data >= m.ini AND t.data < m.corte JOIN employees e ON e.id=t.employee_id GROUP BY 1, 2`,
  },
  "pessoas.horas_extras": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, e.unit_id, (sum(h.minutos) / 60.0)::float AS valor FROM m JOIN hour_entries h ON h.data >= m.ini AND h.data < m.corte AND h.tipo='EXTRA' AND h.status='APROVADO' JOIN employees e ON e.id=h.employee_id GROUP BY 1, 2`,
    inicio: () => primeiro(sql`SELECT min(data)::text AS d FROM hour_entries`),
  },
  "pessoas.banco_horas": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, e.unit_id, (sum(h.minutos) / 60.0)::float AS valor FROM m JOIN employees e ON ${ATIVO} JOIN hour_entries h ON h.employee_id=e.id AND h.status='APROVADO' AND h.data < m.corte GROUP BY 1, 2`,
    inicio: () => primeiro(sql`SELECT min(data)::text AS d FROM hour_entries`),
  },
  "pessoas.enps": {
    calc: c => sql<Linha[]>`SELECT to_char(sv.fim, 'YYYY-MM') AS periodo, coalesce(r.unit_id, 0) AS unit_id,
        (count(*) FILTER (WHERE (r.respostas->>'enps')::int >= 9) - count(*) FILTER (WHERE (r.respostas->>'enps')::int <= 6))::float AS num, count(*)::float AS den
      FROM climate_surveys sv JOIN climate_responses r ON r.survey_id=sv.id AND r.respostas ? 'enps'
      WHERE sv.status='ENCERRADA' AND sv.fim >= ${c.de + "-01"}::date AND sv.fim < ${c.amanha}::date GROUP BY 1, 2`,
  },
  "pessoas.desempenho": {
    calc: c => sql<Linha[]>`SELECT to_char(pc.fim, 'YYYY-MM') AS periodo, e.unit_id, sum(r.nota_final)::float AS num, count(r.nota_final)::float AS den
      FROM perf_cycles pc JOIN perf_reviews r ON r.cycle_id=pc.id AND r.nota_final IS NOT NULL JOIN employees e ON e.id=r.employee_id
      WHERE pc.status='ENCERRADO' AND pc.fim >= ${c.de + "-01"}::date AND pc.fim < ${c.amanha}::date GROUP BY 1, 2`,
  },
  "pessoas.treinamento": {
    calc: async c => Promise.all(c.units.map(async u => { const m = await matrizTreinamento(u); const den = m.linhas.reduce((a, l) => a + l.total, 0); return { periodo: c.ate, unit_id: u, num: den ? m.linhas.reduce((a, l) => a + l.ok, 0) : null, den: den || null }; })),
  },
  "pessoas.vagas_abertas": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, r.unit_id, sum(r.quantidade)::float AS valor FROM m JOIN requisitions r ON r.aberta_em < m.corte AND (r.fechada_em IS NULL OR r.fechada_em >= m.corte) AND (r.status IN ('ABERTA','PREENCHIDA') OR (r.status='CANCELADA' AND r.fechada_em IS NOT NULL)) GROUP BY 1, 2`,
    inicio: () => primeiro(sql`SELECT min(aberta_em)::text AS d FROM requisitions`),
  },
  "pessoas.tempo_contratacao": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, r.unit_id, sum(r.fechada_em - r.aberta_em)::float AS num, count(*)::float AS den FROM m JOIN requisitions r ON r.status='PREENCHIDA' AND r.aberta_em IS NOT NULL AND r.fechada_em >= m.ini AND r.fechada_em < m.corte GROUP BY 1, 2`,
  },
  "pessoas.cobertura_aulas": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, a.unit_id, count(*) FILTER (WHERE a.status IN ('CONFIRMADA','REALIZADA'))::float AS num, count(*)::float AS den FROM m JOIN cover_assignments a ON a.data >= m.ini AND a.data < m.corte AND a.status <> 'CANCELADA' GROUP BY 1, 2`,
  },
  "pessoas.alunos_professor": {
    calc: c => sql<Linha[]>`SELECT ${c.ate}::text AS periodo, u.id AS unit_id, (SELECT count(*) FROM students st WHERE st.aluno_atual AND st.unit_atual_id=u.id)::float AS num, nullif((SELECT count(*) FROM employees e WHERE e.situacao='ATIVO' AND e.regime='DOCENTE' AND e.unit_id=u.id), 0)::float AS den FROM units u`,
  },

  // ------------------------------------------------------------------ Matrículas e famílias
  "matriculas.ocupacao": {
    calc: c => sql<Linha[]>`WITH ${M(c)}, vagas AS (SELECT cl.unit_id, sum(cl.vagas)::float AS v FROM classes cl WHERE cl.ano=${c.cfg.matriculas.anoLetivo} AND cl.modalidade='REGULAR' GROUP BY 1)
      SELECT m.periodo, vg.unit_id, (SELECT count(*) FROM enrollments e JOIN classes cl ON cl.id=e.class_id WHERE cl.ano=${c.cfg.matriculas.anoLetivo} AND cl.modalidade='REGULAR' AND cl.unit_id=vg.unit_id AND ${MATRICULA_ATIVA})::float AS num, vg.v AS den
      FROM m CROSS JOIN vagas vg`,
    inicio: c => primeiro(sql`SELECT min(e.created_at)::date::text AS d FROM enrollments e JOIN classes cl ON cl.id=e.class_id WHERE cl.ano=${c.cfg.matriculas.anoLetivo}`),
  },
  "matriculas.rematricula": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, st.unit_atual_id AS unit_id,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM enrollments e JOIN classes cl ON cl.id=e.class_id WHERE e.student_id=st.id AND cl.ano=${c.cfg.matriculas.anoLetivo} AND cl.modalidade='REGULAR' AND ${MATRICULA_ATIVA}))::float AS num, count(*)::float AS den
      FROM m CROSS JOIN students st WHERE st.aluno_atual AND st.unit_atual_id IS NOT NULL GROUP BY 1, 2`,
    inicio: c => primeiro(sql`SELECT least((SELECT min(created_at) FROM rematricula_links WHERE ano=${c.cfg.matriculas.anoLetivo}), (SELECT min(e.created_at) FROM enrollments e JOIN students st ON st.id=e.student_id JOIN classes cl ON cl.id=e.class_id WHERE st.aluno_atual AND cl.ano=${c.cfg.matriculas.anoLetivo}))::date::text AS d`),
  },
  "matriculas.alunos": {
    calc: c => sql<Linha[]>`SELECT ${c.ate}::text AS periodo, u.id AS unit_id, (SELECT count(*) FROM students st WHERE st.aluno_atual AND st.unit_atual_id=u.id)::float AS valor FROM units u`,
  },
  "matriculas.novas": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, cl.unit_id, count(DISTINCT e.student_id)::float AS valor
      FROM m JOIN enrollments e ON e.status='CONFIRMADA' AND e.confirmada_em >= m.ini AND e.confirmada_em < m.corte JOIN students st ON st.id=e.student_id JOIN classes cl ON cl.id=e.class_id
      WHERE ${CAPTACAO} AND NOT EXISTS (SELECT 1 FROM enrollments e0 WHERE e0.student_id=e.student_id AND e0.id <> e.id AND e0.status='CONFIRMADA' AND e0.confirmada_em < e.confirmada_em) GROUP BY 1, 2`,
    inicio: () => primeiro(sql`SELECT min(created_at)::date::text AS d FROM enrollments`),
  },
  "matriculas.candidatos": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, ${UNID_CANDIDATO} AS unit_id, count(*)::float AS valor FROM m JOIN students st ON st.created_at >= m.ini AND st.created_at < m.corte WHERE ${CAPTACAO} GROUP BY 1, 2`,
    inicio: () => primeiro(sql`SELECT min(created_at)::date::text AS d FROM students`),
  },
  "matriculas.lista_espera": {
    calc: c => sql<Linha[]>`SELECT ${c.ate}::text AS periodo, u.id AS unit_id, (SELECT count(*) FROM waitlist w WHERE w.unit_id=u.id AND w.status IN ('AGUARDANDO','OFERTADA'))::float AS valor FROM units u`,
  },
  "matriculas.cancelamentos": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, cl.unit_id, count(*)::float AS valor FROM m JOIN enrollments e ON e.status='CANCELADA' AND e.updated_at >= m.ini AND e.updated_at < m.corte JOIN classes cl ON cl.id=e.class_id GROUP BY 1, 2`,
    inicio: () => primeiro(sql`SELECT min(created_at)::date::text AS d FROM enrollments`),
  },
  "familias.nps": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, s.unit_id, (count(*) FILTER (WHERE s.nota >= 9) - count(*) FILTER (WHERE s.nota <= 6))::float AS num, count(*)::float AS den FROM m JOIN surveys s ON s.tipo='NPS' AND s.data >= m.ini AND s.data < m.corte GROUP BY 1, 2`,
  },
  "familias.reclamacoes": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, k.unit_id, count(*)::float AS valor FROM m JOIN cases k ON k.tipo='RECLAMACAO' AND k.created_at >= m.ini AND k.created_at < m.corte GROUP BY 1, 2`,
    inicio: () => primeiro(sql`SELECT min(created_at)::date::text AS d FROM cases`),
  },
  "familias.casos_prazo": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, k.unit_id, count(*) FILTER (WHERE k.resolvido_em <= k.sla_ate)::float AS num, count(*)::float AS den FROM m JOIN cases k ON k.resolvido_em >= m.ini AND k.resolvido_em < m.corte AND k.sla_ate IS NOT NULL GROUP BY 1, 2`,
  },
  "familias.retencao": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, k.unit_id, count(*) FILTER (WHERE k.resultado='RETIDO')::float AS num, count(*)::float AS den FROM m JOIN cases k ON k.tipo='SAIDA' AND k.resultado IN ('RETIDO','PERDIDO') AND coalesce(k.fechado_em, k.resolvido_em, k.updated_at) >= m.ini AND coalesce(k.fechado_em, k.resolvido_em, k.updated_at) < m.corte GROUP BY 1, 2`,
  },
  "familias.saidas": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, k.unit_id, count(*)::float AS valor FROM m JOIN cases k ON k.tipo='SAIDA' AND k.created_at >= m.ini AND k.created_at < m.corte GROUP BY 1, 2`,
    inicio: () => primeiro(sql`SELECT min(created_at)::date::text AS d FROM cases`),
  },
  "familias.contato": {
    calc: async c => Promise.all(c.units.map(async u => { const r = await contatoRecente(u); return { periodo: c.ate, unit_id: u, num: r.total ? r.com : null, den: r.total || null }; })),
  },

  // ------------------------------------------------------------------ Financeiro
  "financeiro.receita": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, ce.unit_id, sum(ce.valor)::float AS valor FROM m JOIN cash_entries ce ON ce.tipo='ENTRADA' AND ce.data >= m.ini AND ce.data < m.corte GROUP BY 1, 2`,
    inicio: () => primeiro(sql`SELECT min(data)::text AS d FROM cash_entries`),
  },
  "financeiro.despesa": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, ce.unit_id, sum(ce.valor)::float AS valor FROM m JOIN cash_entries ce ON ce.tipo='SAIDA' AND ce.data >= m.ini AND ce.data < m.corte GROUP BY 1, 2`,
    inicio: () => primeiro(sql`SELECT min(data)::text AS d FROM cash_entries`),
  },
  "financeiro.resultado": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, ce.unit_id, (coalesce(sum(ce.valor) FILTER (WHERE ce.tipo='ENTRADA'), 0) - coalesce(sum(ce.valor) FILTER (WHERE ce.tipo='SAIDA'), 0))::float AS valor FROM m JOIN cash_entries ce ON ce.tipo IN ('ENTRADA','SAIDA') AND ce.data >= m.ini AND ce.data < m.corte GROUP BY 1, 2`,
    inicio: () => primeiro(sql`SELECT min(data)::text AS d FROM cash_entries`),
  },
  "financeiro.margem": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, ce.unit_id, (coalesce(sum(ce.valor) FILTER (WHERE ce.tipo='ENTRADA'), 0) - coalesce(sum(ce.valor) FILTER (WHERE ce.tipo='SAIDA'), 0))::float AS num, nullif(coalesce(sum(ce.valor) FILTER (WHERE ce.tipo='ENTRADA'), 0), 0)::float AS den FROM m JOIN cash_entries ce ON ce.tipo IN ('ENTRADA','SAIDA') AND ce.data >= m.ini AND ce.data < m.corte GROUP BY 1, 2`,
  },
  "financeiro.emitido": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, r.unit_id, sum(r.valor)::float AS valor FROM m JOIN receivables r ON r.status <> 'CANCELADO' AND r.vencimento >= m.ini AND r.vencimento < (m.ini + interval '1 month')::date GROUP BY 1, 2`,
    inicio: () => primeiro(sql`SELECT min(vencimento)::text AS d FROM receivables`),
  },
  "financeiro.recebimento": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, r.unit_id, coalesce(sum(r.valor) FILTER (WHERE r.status='PAGO' AND r.pago_em < m.corte), 0)::float AS num, sum(r.valor)::float AS den FROM m JOIN receivables r ON r.status <> 'CANCELADO' AND r.vencimento >= m.ini AND r.vencimento < m.corte GROUP BY 1, 2`,
  },
  "financeiro.inadimplencia": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, r.unit_id, coalesce(sum(r.valor) FILTER (WHERE NOT (r.status='PAGO' AND r.pago_em < m.corte)), 0)::float AS num, sum(r.valor)::float AS den FROM m JOIN receivables r ON r.status <> 'CANCELADO' AND r.vencimento >= m.corte - 91 AND r.vencimento < m.corte GROUP BY 1, 2`,
  },
  "financeiro.em_atraso": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, r.unit_id, sum(r.valor)::float AS valor FROM m JOIN receivables r ON r.vencimento < m.corte - 1 AND (r.status='ABERTO' OR (r.status='PAGO' AND r.pago_em >= m.corte)) GROUP BY 1, 2`,
    inicio: () => primeiro(sql`SELECT min(vencimento)::text AS d FROM receivables`),
  },
  "financeiro.ticket": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, r.unit_id, sum(r.valor)::float AS num, count(*)::float AS den FROM m JOIN receivables r ON r.tipo='MENSALIDADE' AND r.status <> 'CANCELADO' AND r.vencimento >= m.ini AND r.vencimento < (m.ini + interval '1 month')::date GROUP BY 1, 2`,
  },
  "financeiro.recuperado": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, a.unit_id, sum(ai.valor)::float AS valor FROM m JOIN agreement_installments ai ON ai.pago_em >= m.ini AND ai.pago_em < m.corte JOIN agreements a ON a.id=ai.agreement_id GROUP BY 1, 2`,
    inicio: () => primeiro(sql`SELECT min(created_at)::date::text AS d FROM agreements`),
  },
  "financeiro.caixa": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, b.unit_id, (b.saldo_inicial + coalesce((SELECT sum(CASE WHEN ce.tipo='ENTRADA' THEN ce.valor WHEN ce.tipo='SAIDA' THEN -ce.valor ELSE 0 END) FROM cash_entries ce WHERE ce.unit_id=b.unit_id AND ce.data >= m.ini AND ce.data < m.corte), 0))::float AS valor FROM m JOIN cash_balances b ON b.mes=m.periodo`,
  },
  "financeiro.custo_pessoal": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, e.unit_id, (sum(coalesce(
        (SELECT sh.salario FROM salary_history sh WHERE sh.employee_id=e.id AND sh.data < m.corte ORDER BY sh.data DESC, sh.id DESC LIMIT 1),
        (SELECT sh.salario_anterior FROM salary_history sh WHERE sh.employee_id=e.id AND sh.data >= m.corte ORDER BY sh.data, sh.id LIMIT 1),
        e.salario)) * (1 + ${c.cfg.financeiro.encargosPct}::numeric / 100))::float AS valor
      FROM m JOIN employees e ON ${ATIVO} GROUP BY 1, 2`,
    inicio: () => primeiro(sql`SELECT min(admissao)::text AS d FROM employees WHERE salario IS NOT NULL`),
  },

  // v24 · dicionário da Nova Arquitetura (Cap. 34)
  "financeiro.inadimplencia30": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, r.unit_id, coalesce(sum(r.valor) FILTER (WHERE r.vencimento < m.corte - 31 AND NOT (r.status='PAGO' AND r.pago_em < m.corte)), 0)::float AS num, sum(r.valor)::float AS den
      FROM m JOIN receivables r ON r.status <> 'CANCELADO' AND r.vencimento >= m.corte - 366 AND r.vencimento < m.corte GROUP BY 1, 2`,
  },
  "financeiro.recuperacao_regua": {
    calc: c => sql<Linha[]>`WITH ${M(c)}, primeira AS (SELECT a.receivable_id, min(a.at)::date AS d FROM collection_actions a GROUP BY 1)
      SELECT m.periodo, r.unit_id, count(*) FILTER (WHERE r.status='PAGO' AND r.pago_em < m.corte)::float AS num, count(*)::float AS den
      FROM m JOIN primeira p ON p.d >= m.ini AND p.d < m.corte JOIN receivables r ON r.id=p.receivable_id GROUP BY 1, 2`,
  },
  "financeiro.ebitda": {
    calc: c => { const fin = ((c.cfg as unknown as { dre?: { financeiras?: string[] } }).dre?.financeiras ?? ["Financeiras"]); return sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, ce.unit_id, (coalesce(sum(ce.valor) FILTER (WHERE ce.tipo='ENTRADA'), 0) - coalesce(sum(ce.valor) FILTER (WHERE ce.tipo='SAIDA' AND NOT (ce.categoria = ANY(${fin}))), 0))::float AS valor FROM m JOIN cash_entries ce ON ce.tipo IN ('ENTRADA','SAIDA') AND ce.data >= m.ini AND ce.data < m.corte GROUP BY 1, 2`; },
    inicio: () => primeiro(sql`SELECT min(data)::text AS d FROM cash_entries`),
  },
  "financeiro.folha_receita": {
    calc: c => sql<Linha[]>`WITH ${M(c)}, folha AS (SELECT pc.competencia AS periodo, coalesce(r.unit_id, 0) AS unit_id, sum(r.salarios + r.inss + r.fgts + r.provisao_13 + r.provisao_ferias + r.beneficios + r.rescisoes + r.outros)::float AS v FROM payroll_cycles pc JOIN payroll_results r ON r.cycle_id=pc.id WHERE pc.aceito_em IS NOT NULL GROUP BY 1, 2),
      rec AS (SELECT m.periodo, ce.unit_id, sum(ce.valor)::float AS v FROM m JOIN cash_entries ce ON ce.tipo='ENTRADA' AND ce.data >= m.ini AND ce.data < m.corte GROUP BY 1, 2)
      SELECT f.periodo, f.unit_id, f.v AS num, rec.v AS den FROM folha f JOIN m ON m.periodo=f.periodo LEFT JOIN rec ON rec.periodo=f.periodo AND rec.unit_id=f.unit_id`,
  },
  "financeiro.receita_aluno": {
    calc: c => sql<Linha[]>`SELECT ${c.ate}::text AS periodo, u.id AS unit_id, (SELECT sum(valor) FROM cash_entries ce WHERE ce.unit_id=u.id AND ce.tipo='ENTRADA' AND ce.data >= ${c.ate + "-01"}::date AND ce.data < ${c.amanha}::date)::float AS num, nullif((SELECT count(*) FROM students st WHERE st.aluno_atual AND st.unit_atual_id=u.id), 0)::float AS den FROM units u`,
  },
  "financeiro.custo_aluno": {
    calc: c => sql<Linha[]>`SELECT ${c.ate}::text AS periodo, u.id AS unit_id, (SELECT sum(valor) FROM cash_entries ce WHERE ce.unit_id=u.id AND ce.tipo='SAIDA' AND ce.data >= ${c.ate + "-01"}::date AND ce.data < ${c.amanha}::date)::float AS num, nullif((SELECT count(*) FROM students st WHERE st.aluno_atual AND st.unit_atual_id=u.id), 0)::float AS den FROM units u`,
  },
  "financeiro.orcamento_executado": {
    calc: c => sql<Linha[]>`WITH ${M(c)},
      orc AS (SELECT x.ano, x.unit_id, ms.mes, sum(coalesce(bm.valor, b.valor_mensal))::float AS v
        FROM (SELECT DISTINCT ano, unit_id, categoria FROM budgets WHERE tipo='SAIDA' UNION SELECT DISTINCT ano, unit_id, categoria FROM budget_months WHERE tipo='SAIDA') x CROSS JOIN generate_series(1, 12) AS ms(mes)
        LEFT JOIN budget_months bm ON bm.ano=x.ano AND bm.unit_id=x.unit_id AND bm.tipo='SAIDA' AND bm.categoria=x.categoria AND bm.mes=ms.mes
        LEFT JOIN budgets b ON b.ano=x.ano AND b.unit_id=x.unit_id AND b.tipo='SAIDA' AND b.categoria=x.categoria
        WHERE coalesce(bm.valor, b.valor_mensal) IS NOT NULL GROUP BY 1, 2, 3),
      real AS (SELECT m.periodo, ce.unit_id, sum(ce.valor)::float AS v FROM m JOIN cash_entries ce ON ce.tipo='SAIDA' AND ce.data >= m.ini AND ce.data < m.corte GROUP BY 1, 2)
      SELECT m.periodo, o.unit_id, coalesce(real.v, 0)::float AS num, o.v AS den FROM m JOIN orc o ON o.ano = extract(year FROM m.ini)::int AND o.mes = extract(month FROM m.ini)::int LEFT JOIN real ON real.periodo=m.periodo AND real.unit_id=o.unit_id`,
  },
  // v25 · KPI-09 e KPI-39
  "financeiro.conciliado": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, r.unit_id, coalesce(sum(coalesce(r.valor_pago, r.valor)) FILTER (WHERE r.conciliado_em IS NOT NULL AND r.conciliado_em < m.corte + interval '10 days'), 0)::float AS num, sum(coalesce(r.valor_pago, r.valor))::float AS den
      FROM m JOIN receivables r ON r.status='PAGO' AND r.pago_em >= m.ini AND r.pago_em < m.corte GROUP BY 1, 2`,
    inicio: () => primeiro(sql`SELECT min(data)::text AS d FROM bank_lines`),
  },
  "financeiro.divergencias": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, coalesce(i.unit_id, 0) AS unit_id, count(*)::float AS valor FROM m JOIN recon_issues i ON i.created_at < m.corte AND (i.status='ABERTA' OR i.resolvido_em >= m.corte) GROUP BY 1, 2`,
    inicio: () => primeiro(sql`SELECT min(created_at)::date::text AS d FROM recon_issues`),
  },
  "financeiro.semana_critica": {
    calc: async c => { const { caixaProjetado } = await import("./fpa"); const out: Linha[] = [];
      for (const u of [...c.units, null]) { try { const p = await caixaProjetado(u); const sal = p.semanas.map(x => x.saldo).filter((x): x is number => x !== null); out.push({ periodo: c.ate, unit_id: u ?? 0, valor: sal.length ? Math.min(...sal) : null }); } catch { /* unidade sem dados de caixa */ } }
      return out; },
  },
  "pessoas.fte": {
    calc: c => { const plena = Number((c.cfg as unknown as { quadro?: { jornadaPlenaMin?: number } }).quadro?.jornadaPlenaMin ?? 528) || 528; return sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, e.unit_id, (sum(coalesce(e.jornada_min_dia, ${plena})) / ${plena}::float)::float AS valor FROM m JOIN employees e ON ${ATIVO} GROUP BY 1, 2`; },
    inicio: () => primeiro(sql`SELECT min(admissao)::text AS d FROM employees`),
  },
  "pessoas.turnover90": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, e.unit_id, count(*) FILTER (WHERE e.desligamento >= m.corte - 366 AND e.desligamento < m.corte AND e.desligamento - e.admissao < 90)::float AS num, count(*) FILTER (WHERE e.admissao >= m.corte - 366 AND e.admissao < m.corte)::float AS den FROM m CROSS JOIN employees e GROUP BY 1, 2`,
  },
  "pessoas.ferias_vencendo": {
    calc: async c => {
      const emps = await sql<{ id: number; unit_id: number; admissao: string; quitadas: string | null }[]>`SELECT id, unit_id, admissao::text, ferias_quitadas_ate::text AS quitadas FROM employees WHERE situacao IN ('ATIVO','FERIAS','AFASTADO') AND vinculo IN ('CLT','HORISTA')`;
      const lv = await sql<{ employee_id: number; periodo_ref: string | null; dias: number }[]>`SELECT employee_id, periodo_ref::text, dias FROM leave_requests WHERE tipo='FERIAS' AND status='APROVADA' AND employee_id = ANY(${emps.map(e => e.id).concat(0)})`;
      const lim = addDays(c.hoje, 60); const acc = new Map<number, number>(c.units.map(u => [u, 0]));
      for (const e of emps) { const n = periodosFerias(e.admissao, lv.filter(l => l.employee_id === e.id).map(l => ({ periodoRef: l.periodo_ref, dias: l.dias })), c.hoje, e.quitadas).filter(p => p.status === "VENCIDO" || (p.status === "ABERTO" && p.concessivoAte <= lim)).length; if (n) acc.set(e.unit_id, (acc.get(e.unit_id) ?? 0) + n); }
      return [...acc].map(([u, v]) => ({ periodo: c.ate, unit_id: u, valor: v }));
    },
  },
  "pessoas.admissoes_prazo": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, e.unit_id, count(*) FILTER (WHERE p.concluido_em::date <= p.prazo)::float AS num, count(*)::float AS den FROM m JOIN processes p ON p.tipo='ADMISSAO' AND p.status='CONCLUIDO' AND p.prazo IS NOT NULL AND p.concluido_em >= m.ini AND p.concluido_em < m.corte JOIN employees e ON e.id=p.employee_id GROUP BY 1, 2`,
  },
  "pessoas.ciclo_prazo": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, 0 AS unit_id, count(*) FILTER (WHERE st.fechada_em IS NOT NULL AND st.fechada_em::date <= st.fim)::float AS num, count(*)::float AS den FROM m JOIN perf_cycle_stages st ON st.fim >= m.ini AND st.fim < m.corte GROUP BY 1, 2`,
  },
  "pessoas.sucessao": {
    calc: c => sql<Linha[]>`SELECT ${c.ate}::text AS periodo, coalesce(cp.unit_id, 0) AS unit_id, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM successors sc WHERE sc.critical_position_id=cp.id AND sc.ativo AND sc.prontidao IN ('PRONTO','UM_DOIS_ANOS')))::float AS num, count(*)::float AS den FROM critical_positions cp GROUP BY 1, 2`,
  },
  "estrategia.okrs_on_track": {
    calc: c => sql<Linha[]>`SELECT ${c.ate}::text AS periodo, coalesce(o.unit_id, 0) AS unit_id, count(*) FILTER (WHERE k.confianca >= 2)::float AS num, count(*) FILTER (WHERE k.confianca IS NOT NULL)::float AS den FROM key_results k JOIN objectives o ON o.id=k.objective_id WHERE o.ciclo=${c.cfg.estrategia.cicloAtual} AND o.status <> 'CANCELADO' GROUP BY 1, 2`,
  },

  // ------------------------------------------------------------------ Operações
  "operacoes.chamados": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, w.unit_id, count(*)::float AS valor FROM m JOIN work_orders w ON w.created_at >= m.ini AND w.created_at < m.corte GROUP BY 1, 2`,
    inicio: () => primeiro(sql`SELECT min(created_at)::date::text AS d FROM work_orders`),
  },
  "operacoes.sla": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, w.unit_id, count(*) FILTER (WHERE w.concluido_em <= w.sla_ate)::float AS num, count(*)::float AS den FROM m JOIN work_orders w ON w.status='CONCLUIDO' AND w.sla_ate IS NOT NULL AND w.concluido_em >= m.ini AND w.concluido_em < m.corte GROUP BY 1, 2`,
  },
  "operacoes.tempo_resolucao": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, w.unit_id, (sum(extract(epoch FROM (w.concluido_em - w.created_at))) / 86400.0)::float AS num, count(*)::float AS den FROM m JOIN work_orders w ON w.status='CONCLUIDO' AND w.concluido_em >= m.ini AND w.concluido_em < m.corte GROUP BY 1, 2`,
  },
  "operacoes.backlog": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, w.unit_id, count(*)::float AS valor FROM m JOIN work_orders w ON w.status <> 'CANCELADO' AND w.created_at < m.corte AND (w.concluido_em IS NULL OR w.concluido_em >= m.corte) GROUP BY 1, 2`,
    inicio: () => primeiro(sql`SELECT min(created_at)::date::text AS d FROM work_orders`),
  },
  "operacoes.vistorias": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, i.unit_id, sum(i.conformes)::float AS num, nullif(sum(i.total), 0)::float AS den FROM m JOIN inspections i ON i.data >= m.ini AND i.data < m.corte GROUP BY 1, 2`,
  },
  "operacoes.custo_manutencao": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, w.unit_id, coalesce(sum(w.custo_real), 0)::float AS valor FROM m JOIN work_orders w ON w.status='CONCLUIDO' AND w.concluido_em >= m.ini AND w.concluido_em < m.corte GROUP BY 1, 2`,
    inicio: () => primeiro(sql`SELECT min(created_at)::date::text AS d FROM work_orders`),
  },
  "operacoes.aprovacoes_prazo": {
    calc: c => sql<Linha[]>`WITH ${M(c)}, ev AS (SELECT re.request_id, re.tipo, re.created_at, lag(re.created_at) OVER (PARTITION BY re.request_id ORDER BY re.created_at, re.id) AS desde FROM request_events re WHERE re.tipo IN ('CRIADA','REENVIADA','APROVADA','REJEITADA','DEVOLVIDA'))
      SELECT m.periodo, coalesce(r.unit_id, 0) AS unit_id, count(*) FILTER (WHERE (ev.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Campo_Grande')::date <= (ev.desde AT TIME ZONE 'UTC' AT TIME ZONE 'America/Campo_Grande')::date + t.prazo_dias)::float AS num, count(*)::float AS den
      FROM m JOIN ev ON ev.tipo IN ('APROVADA','REJEITADA','DEVOLVIDA') AND ev.desde IS NOT NULL AND ev.created_at >= m.ini AND ev.created_at < m.corte JOIN requests r ON r.id=ev.request_id JOIN request_types t ON t.id=r.type_id GROUP BY 1, 2`,
  },

  // ------------------------------------------------------------------ Estratégia e governança
  "estrategia.okrs": {
    calc: async c => {
      const ciclo = c.cfg.estrategia.cicloAtual;
      const objs = await sql<{ id: number; unit_id: number | null; criado: string }[]>`SELECT id, unit_id, created_at::date::text AS criado FROM objectives WHERE ciclo=${ciclo} AND status <> 'CANCELADO'`;
      if (!objs.length) return [];
      const krs = await sql<{ id: number; objective_id: number; inicial: number; meta: number; atual: number | null; direcao: string }[]>`SELECT id, objective_id, valor_inicial::float AS inicial, valor_meta::float AS meta, valor_atual::float AS atual, direcao FROM key_results WHERE objective_id = ANY(${objs.map(o => o.id)})`;
      const cks = await sql<{ key_result_id: number; data: string; valor: number }[]>`SELECT key_result_id, data::text, valor::float FROM kr_checkins WHERE key_result_id = ANY(${krs.map(k => k.id).concat(0)}) AND valor IS NOT NULL ORDER BY data, id`;
      const out: Linha[] = [];
      for (let p = c.de; p <= c.ate; p = somaMeses(p, 1)) {
        const corte = p === c.ate && c.ate === c.hoje.slice(0, 7) ? c.amanha : `${somaMeses(p, 1)}-01`; const atual = corte === c.amanha;
        const acc = new Map<number, { num: number; den: number }>();
        for (const o of objs.filter(o => o.criado < corte)) {
          const ps = krs.filter(k => k.objective_id === o.id).map(k => { const ck = cks.filter(x => x.key_result_id === k.id && x.data < corte).pop(); const v = atual && k.atual !== null ? k.atual : ck ? ck.valor : k.inicial; return progressoKR(k.inicial, k.meta, v, k.direcao); }).filter((x): x is number => x !== null);
          if (!ps.length) continue; const u = o.unit_id ?? 0; const a = acc.get(u) ?? { num: 0, den: 0 }; a.num += ps.reduce((x, y) => x + y, 0) / ps.length; a.den += 1; acc.set(u, a);
        }
        for (const [u, a] of acc) out.push({ periodo: p, unit_id: u, num: a.num, den: a.den });
      }
      return out;
    },
  },
  "estrategia.acoes_em_dia": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, coalesce(a.unit_id, 0) AS unit_id, count(*) FILTER (WHERE (a.prazo IS NULL OR a.prazo >= m.corte - 1) AND a.status <> 'BLOQUEADA')::float AS num, count(*)::float AS den FROM m JOIN action_plans a ON a.status <> 'CANCELADA' AND a.created_at < m.corte AND (a.concluida_em IS NULL OR a.concluida_em >= m.corte) GROUP BY 1, 2`,
  },
  "estrategia.acoes_concluidas": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, coalesce(a.unit_id, 0) AS unit_id, count(*)::float AS valor FROM m JOIN action_plans a ON a.status='CONCLUIDA' AND a.concluida_em >= m.ini AND a.concluida_em < m.corte GROUP BY 1, 2`,
    inicio: () => primeiro(sql`SELECT min(created_at)::date::text AS d FROM action_plans`),
  },
  "estrategia.marcos_prazo": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, coalesce(p.unit_id, 0) AS unit_id, count(*) FILTER (WHERE mi.concluido_em <= mi.prazo)::float AS num, count(*)::float AS den FROM m JOIN milestones mi ON mi.prazo IS NOT NULL AND mi.concluido_em >= m.ini AND mi.concluido_em < m.corte JOIN projects p ON p.id=mi.project_id GROUP BY 1, 2`,
  },
  "estrategia.reunioes": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, coalesce(r.unit_id, 0) AS unit_id, count(*)::float AS valor FROM m JOIN ritual_meetings rm ON rm.status='REALIZADA' AND rm.data >= m.ini AND rm.data < m.corte JOIN rituals r ON r.id=rm.ritual_id GROUP BY 1, 2`,
    inicio: () => primeiro(sql`SELECT min(created_at)::date::text AS d FROM rituals`),
  },
  "gestao.saude": {
    calc: c => sql<Linha[]>`SELECT DISTINCT ON (to_char(hs.data, 'YYYY-MM'), coalesce(hs.unit_id, 0)) to_char(hs.data, 'YYYY-MM') AS periodo, coalesce(hs.unit_id, 0) AS unit_id, hs.geral::float AS valor
      FROM health_snapshots hs WHERE hs.data >= ${c.de + "-01"}::date AND hs.data < ${c.amanha}::date ORDER BY 1, 2, hs.data DESC, hs.id DESC`,
  },
  "governanca.nc_abertas": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, coalesce(n.unit_id, 0) AS unit_id, count(*)::float AS valor FROM m JOIN nonconformities n ON n.created_at < m.corte AND (n.encerrada_em IS NULL OR n.encerrada_em >= m.corte) GROUP BY 1, 2`,
    inicio: () => primeiro(sql`SELECT min(created_at)::date::text AS d FROM nonconformities`),
  },
  "governanca.nc_prazo": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, coalesce(n.unit_id, 0) AS unit_id, count(*) FILTER (WHERE n.encerrada_em::date <= n.prazo)::float AS num, count(*)::float AS den FROM m JOIN nonconformities n ON n.prazo IS NOT NULL AND n.encerrada_em >= m.ini AND n.encerrada_em < m.corte GROUP BY 1, 2`,
  },
  "governanca.excecoes": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, coalesce(x.unit_id, 0) AS unit_id, count(*)::float AS valor FROM m JOIN exceptions x ON x.status IN ('APROVADA','EXPIRADA','REVISADA') AND x.decidido_em >= m.ini AND x.decidido_em < m.corte GROUP BY 1, 2`,
    inicio: () => primeiro(sql`SELECT min(created_at)::date::text AS d FROM exceptions`),
  },
  "governanca.processos": {
    calc: async c => { const rows: Linha[] = []; for (const u of [...c.units, 0]) { const g = await estatisticasGov(u || null); rows.push({ periodo: c.ate, unit_id: u, valor: g.score }); } return rows; },
  },
  "governanca.lgpd_prazo": {
    calc: c => sql<Linha[]>`WITH ${M(c)} SELECT m.periodo, 0 AS unit_id, count(*) FILTER (WHERE (p.respondida_em AT TIME ZONE 'UTC' AT TIME ZONE 'America/Campo_Grande')::date <= p.prazo)::float AS num, count(*)::float AS den FROM m JOIN privacy_requests p ON p.prazo IS NOT NULL AND p.respondida_em >= m.ini AND p.respondida_em < m.corte GROUP BY 1, 2`,
  },
};
