import { sql } from "@/db";
import type { Session } from "./auth";
import { scopeUnit, can, aprovaSoEquipe } from "./auth";
import { getSettings, hoje, periodosFerias, LEAVE_LABEL, HOUR_LABEL } from "./utils";

/**
 * Aprovação em lote com exceção à vista (C10 · Nova Arquitetura, Cap. 16): os itens normais saem num clique com trilha item a item;
 * as exceções (política estourada, conflito de cobertura, quem pediu aprovando o próprio pedido) nunca entram no lote — exigem decisão
 * individual com justificativa (T-054 · T-052 · CRQ-PRJ-V3-04).
 */
export type ItemFila = { id: number; tipo: string; titulo: string; detalhe: string; unidade: string; pessoa: string; employee_id: number; data: string; minutos?: number; dias?: number; excecoes: string[] };

/** Cobertura do cargo na unidade durante o período: quem fica, se este pedido for aprovado. */
export function conflitoCobertura(n: number, foraNoPeriodo: number, minimoPct: number) {
  if (n < 2) return null;
  const ficam = n - foraNoPeriodo - 1; const pct = (100 * ficam) / n;
  if (n === 2 ? ficam <= 0 : pct < minimoPct) return `conflito de cobertura: ${foraNoPeriodo + 1} de ${n} do mesmo cargo na unidade fora no período (ficam ${Math.max(0, ficam)})`;
  return null;
}
/** Hora extra que estoura o limite do mês (somando o que já foi aprovado). */
export function estouraHe(minutosPedido: number, aprovadosNoMes: number, limite: number) { return minutosPedido > 0 && aprovadosNoMes + minutosPedido > limite ? `estoura o limite mensal de HE (${Math.round((aprovadosNoMes + minutosPedido) / 60)} h de ${Math.round(limite / 60)} h)` : null; }

type Ausencia = { employee_id: number; unit_id: number; position_id: number | null; inicio: string; fim: string };
/**
 * Quantas OUTRAS pessoas do mesmo cargo e unidade estarão fora no período do pedido: as já aprovadas e os pedidos anteriores
 * que vão no mesmo lote (o lote nunca aprova junto dois pedidos que, somados, furam a cobertura mínima).
 */
export function foraNoPeriodo(r: Ausencia, aprovadas: Ausencia[], doLote: Ausencia[]) {
  const sobrepoe = (f: Ausencia) => f.unit_id === r.unit_id && f.position_id === r.position_id && f.employee_id !== r.employee_id && f.inicio <= r.fim && f.fim >= r.inicio;
  const ap = new Set(aprovadas.filter(sobrepoe).map(f => f.employee_id)); const todos = new Set([...ap, ...doLote.filter(sobrepoe).map(f => f.employee_id)]);
  return { total: todos.size, soAprovadas: ap.size };
}

export async function filaFerias(s: Session, selecionados?: Set<number>): Promise<ItemFila[]> {
  const cfg = await getSettings(); if (!can.aprovar(s, "ferias")) return [];
  const u = scopeUnit(s); const min = Number(cfg.aprovacoes.feriasMinimoPresentesPct) || 70;
  const rows = await sql<{ id: number; employee_id: number; nome: string; unidade: string; unit_id: number; position_id: number | null; cargo: string | null; tipo: string; inicio: string; fim: string; dias: number; periodo_ref: string | null; solicitado_por: number | null; admissao: string; quitadas: string | null; vinculo: string }[]>`
    SELECT l.id, l.employee_id, e.nome, un.nome AS unidade, e.unit_id, e.position_id, p.nome AS cargo, l.tipo, l.inicio::text, l.fim::text, l.dias, l.periodo_ref::text, l.solicitado_por, e.admissao::text, e.ferias_quitadas_ate::text AS quitadas, e.vinculo
    FROM leave_requests l JOIN employees e ON e.id=l.employee_id JOIN units un ON un.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id
    WHERE l.status='SOLICITADA' ${u === null ? sql`` : sql`AND e.unit_id=${u}`} ${aprovaSoEquipe(s) ? sql`AND e.gestor_id=${s.employeeId ?? 0}` : sql``} ORDER BY l.inicio, l.id`;
  if (!rows.length) return [];
  const ids = [...new Set(rows.map(r => r.employee_id))];
  const [equipe, fora, usadas] = await Promise.all([
    sql<{ unit_id: number; position_id: number; n: number }[]>`SELECT unit_id, position_id, count(*)::int AS n FROM employees WHERE situacao IN ('ATIVO','FERIAS','AFASTADO') AND position_id IS NOT NULL GROUP BY 1, 2`,
    sql<{ employee_id: number; unit_id: number; position_id: number | null; inicio: string; fim: string }[]>`SELECT l.employee_id, e.unit_id, e.position_id, l.inicio::text, l.fim::text FROM leave_requests l JOIN employees e ON e.id=l.employee_id WHERE l.status='APROVADA' AND l.fim >= ${hoje()}`,
    sql<{ employee_id: number; periodo_ref: string | null; dias: number }[]>`SELECT employee_id, periodo_ref::text, dias FROM leave_requests WHERE status='APROVADA' AND tipo='FERIAS' AND employee_id = ANY(${ids})`,
  ]);
  // pedidos normais anteriores na ordem da fila entram como "fora" para os seguintes (só os marcados, quando é o lote sendo aprovado)
  const previstos: Ausencia[] = [];
  return rows.map(r => {
    const exc: string[] = [];
    if (r.solicitado_por === s.id && !can.editar(s)) exc.push("você pediu: outra pessoa da alçada aprova");
    if (!["FERIAS", "FOLGA_BANCO"].includes(r.tipo)) exc.push(`${LEAVE_LABEL[r.tipo] ?? r.tipo}: decisão individual`);
    if (r.position_id) {
      const n = equipe.find(x => x.unit_id === r.unit_id && x.position_id === r.position_id)?.n ?? 1;
      const f = foraNoPeriodo({ employee_id: r.employee_id, unit_id: r.unit_id, position_id: r.position_id, inicio: r.inicio, fim: r.fim }, fora, previstos);
      const c = conflitoCobertura(n, f.total, min);
      if (c) exc.push(f.total > f.soAprovadas && !conflitoCobertura(n, f.soAprovadas, min) ? `${c} — somando os pedidos anteriores desta fila` : c);
    }
    if (r.tipo === "FERIAS" && ["CLT", "HORISTA"].includes(r.vinculo)) {
      const ps = periodosFerias(r.admissao, usadas.filter(x => x.employee_id === r.employee_id).map(x => ({ periodoRef: x.periodo_ref, dias: x.dias })), undefined, r.quitadas);
      const alvo = r.periodo_ref ? ps.find(p => p.inicio === r.periodo_ref) : ps.find(p => p.saldo > 0 && p.status !== "EM_AQUISICAO");
      if (!alvo || alvo.status === "EM_AQUISICAO") exc.push("período aquisitivo ainda não completo");
      else if (r.dias > alvo.saldo) exc.push(`pede ${r.dias} dias e o saldo do período é ${alvo.saldo}`);
    }
    if (r.inicio < hoje()) exc.push("início já passou: confira antes de aprovar");
    if (!exc.length && (!selecionados || selecionados.has(r.id))) previstos.push({ employee_id: r.employee_id, unit_id: r.unit_id, position_id: r.position_id, inicio: r.inicio, fim: r.fim });
    return { id: r.id, tipo: r.tipo, titulo: `${LEAVE_LABEL[r.tipo] ?? r.tipo} · ${r.dias} dia(s)`, detalhe: `${r.inicio.split("-").reverse().join("/")} → ${r.fim.split("-").reverse().join("/")}${r.cargo ? ` · ${r.cargo}` : ""}`, unidade: r.unidade, pessoa: r.nome, employee_id: r.employee_id, data: r.inicio, dias: r.dias, excecoes: exc };
  });
}

export async function filaBanco(s: Session): Promise<ItemFila[]> {
  const cfg = await getSettings(); if (!can.aprovar(s, "banco")) return [];
  const u = scopeUnit(s); const limite = Number(cfg.aprovacoes.limiteHeMensalMin) || 600; const maxL = Number(cfg.aprovacoes.maxLancamentoMin) || 240;
  const rows = await sql<{ id: number; employee_id: number; nome: string; unidade: string; data: string; minutos: number; tipo: string; descricao: string | null; lancado_por: number | null; jornada: number | null; esperado: number | null; fechado: boolean; he_mes: number }[]>`
    SELECT h.id, h.employee_id, e.nome, un.nome AS unidade, h.data::text, h.minutos, h.tipo, h.descricao, h.lancado_por, e.jornada_min_dia AS jornada,
      (SELECT t.esperado_min FROM timesheet_days t WHERE t.employee_id=h.employee_id AND t.data=h.data) AS esperado,
      EXISTS (SELECT 1 FROM timesheet_locks l WHERE l.unit_id=e.unit_id AND l.mes=to_char(h.data, 'YYYY-MM') AND l.status='FECHADO') AS fechado,
      coalesce((SELECT sum(x.minutos) FROM hour_entries x WHERE x.employee_id=h.employee_id AND x.tipo='EXTRA' AND x.status='APROVADO' AND date_trunc('month', x.data)=date_trunc('month', h.data)), 0)::int AS he_mes
    FROM hour_entries h JOIN employees e ON e.id=h.employee_id JOIN units un ON un.id=e.unit_id WHERE h.status='PENDENTE' ${u === null ? sql`` : sql`AND e.unit_id=${u}`} ${aprovaSoEquipe(s) ? sql`AND e.gestor_id=${s.employeeId ?? 0}` : sql``} ORDER BY h.data, h.id`;
  // pedidos pendentes do mesmo mês somam entre si na ordem da fila (o lote nunca estoura o limite)
  const acumulado = new Map<string, number>();
  return rows.map(r => {
    const exc: string[] = []; const k = `${r.employee_id}|${r.data.slice(0, 7)}`;
    if (r.lancado_por === s.id && !can.editar(s)) exc.push("você lançou: outra pessoa da alçada aprova");
    if (r.fechado) exc.push("mês fechado no ponto: reabra para decidir");
    if (r.tipo === "EXTRA") { const ant = acumulado.get(k) ?? r.he_mes; const e = estouraHe(r.minutos, ant, limite); if (e) exc.push(e); acumulado.set(k, ant + r.minutos); }
    if (Math.abs(r.minutos) > maxL) exc.push(`lançamento acima de ${Math.round(maxL / 60)} h`);
    if (r.tipo === "EXTRA" && (r.esperado === 0 || (r.esperado === null && !r.jornada))) exc.push("dia sem jornada prevista");
    const h = Math.abs(r.minutos); const fmt = `${r.minutos < 0 ? "−" : "+"}${Math.floor(h / 60)}h${String(h % 60).padStart(2, "0")}`;
    return { id: r.id, tipo: r.tipo, titulo: `${HOUR_LABEL[r.tipo] ?? r.tipo} ${fmt}`, detalhe: `${r.data.split("-").reverse().join("/")}${r.descricao ? ` · ${r.descricao}` : ""}`, unidade: r.unidade, pessoa: r.nome, employee_id: r.employee_id, data: r.data, minutos: r.minutos, excecoes: exc };
  });
}

/** Ranking de HE aprovada (T-054): sinal de dimensionamento, não troféu — por pessoa e por cargo/unidade, com tendência de 3 meses. */
export async function rankingHe(unitId: number | null, verCusto: boolean) {
  const h = hoje(); const ini3 = `${new Date(Date.UTC(Number(h.slice(0, 4)), Number(h.slice(5, 7)) - 3, 1)).toISOString().slice(0, 7)}-01`;
  const pessoas = await sql<{ employee_id: number; nome: string; unidade: string; cargo: string | null; m0: number; m1: number; m2: number; salario: number | null }[]>`SELECT e.id AS employee_id, e.nome, u.nome AS unidade, p.nome AS cargo,
      coalesce(sum(h.minutos) FILTER (WHERE date_trunc('month', h.data)=date_trunc('month', ${h}::date)), 0)::int AS m0,
      coalesce(sum(h.minutos) FILTER (WHERE date_trunc('month', h.data)=date_trunc('month', ${h}::date) - interval '1 month'), 0)::int AS m1,
      coalesce(sum(h.minutos) FILTER (WHERE date_trunc('month', h.data)=date_trunc('month', ${h}::date) - interval '2 month'), 0)::int AS m2, e.salario::float
    FROM hour_entries h JOIN employees e ON e.id=h.employee_id JOIN units u ON u.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id
    WHERE h.tipo='EXTRA' AND h.status='APROVADO' AND h.data >= ${ini3}::date ${unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`} GROUP BY 1, 2, 3, 4, e.salario ORDER BY (coalesce(sum(h.minutos) FILTER (WHERE date_trunc('month', h.data)=date_trunc('month', ${h}::date)), 0) + coalesce(sum(h.minutos) FILTER (WHERE date_trunc('month', h.data)=date_trunc('month', ${h}::date) - interval '1 month'), 0)) DESC LIMIT 15`;
  // custo estimado: salário ÷ 220 h × 1,5 por hora extra (só Direção, RH e Financeiro; agregado por cargo)
  const custo = (p: { salario: number | null; m0: number }) => p.salario ? (p.salario / 220) * 1.5 * (p.m0 / 60) : null;
  const porCargo = [...new Set(pessoas.map(p => `${p.cargo ?? "Sem cargo"}|${p.unidade}`))].map(k => { const [cargo, unidade] = k.split("|"); const xs = pessoas.filter(p => (p.cargo ?? "Sem cargo") === cargo && p.unidade === unidade); return { cargo, unidade, minutos: xs.reduce((a, p) => a + p.m0 + p.m1 + p.m2, 0), pessoas: xs.length, custoMes: verCusto ? xs.reduce((a, p) => a + (custo(p) ?? 0), 0) : null }; }).sort((a, b) => b.minutos - a.minutos);
  return { pessoas: pessoas.map(p => ({ ...p, salario: undefined, custoMes: verCusto ? custo(p) : null })), porCargo, custoTotalMes: verCusto ? pessoas.reduce((a, p) => a + (custo(p) ?? 0), 0) : null };
}
