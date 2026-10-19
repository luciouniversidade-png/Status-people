import { sql } from "@/db";
import type { Session } from "./auth";
import { scopeUnit } from "./auth";
import { getSettings, hoje } from "./utils";
import { notificar, usuariosPorPerfil } from "./comunicacao";
import { MESES_LONGOS, fmtPct } from "./formato";

/**
 * T-025 · Estouro pede explicação (aceite da T-025 · KPI-15): quando um mês fecha, cada categoria de despesa de uma unidade acima da banda
 * (padrão 105% do orçado do mês) gera um pedido de explicação ao responsável — dono da categoria em Configurações, senão a direção
 * da unidade, senão o Financeiro. A explicação registrada em Orçado × real fecha o pedido e fica anexada ao período.
 */
export type Estouro = { unit_id: number; unidade: string; categoria: string; real: number; orc: number; pct: number };

export async function estourosDoMes(ano: number, mes: number, unitIds: number[] | null = null): Promise<Estouro[]> {
  const cfg = await getSettings(); const internas = cfg.dre.internas as string[]; const max = Number(cfg.orcamento.faixaMaxPct) || 105;
  const ini = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const rows = await sql<Omit<Estouro, "pct">[]>`WITH cats AS (SELECT DISTINCT unit_id, categoria FROM budgets WHERE ano=${ano} AND tipo='SAIDA' UNION SELECT DISTINCT unit_id, categoria FROM budget_months WHERE ano=${ano} AND tipo='SAIDA'),
      o AS (SELECT c.unit_id, c.categoria, coalesce(bm.valor, b.valor_mensal)::float AS v FROM cats c LEFT JOIN budget_months bm ON bm.ano=${ano} AND bm.unit_id=c.unit_id AND bm.tipo='SAIDA' AND bm.categoria=c.categoria AND bm.mes=${mes} LEFT JOIN budgets b ON b.ano=${ano} AND b.unit_id=c.unit_id AND b.tipo='SAIDA' AND b.categoria=c.categoria),
      r AS (SELECT unit_id, categoria, sum(valor)::float AS v FROM cash_entries WHERE tipo='SAIDA' AND data >= ${ini}::date AND data < (${ini}::date + interval '1 month') GROUP BY 1, 2)
    SELECT o.unit_id, u.nome AS unidade, o.categoria, r.v AS real, o.v AS orc FROM o JOIN r ON r.unit_id=o.unit_id AND r.categoria=o.categoria JOIN units u ON u.id=o.unit_id
    WHERE o.v > 0 ${unitIds === null ? sql`` : sql`AND o.unit_id = ANY(${unitIds})`} ORDER BY u.nome, o.categoria`;
  return rows.filter(r => !internas.includes(r.categoria)).map(r => ({ ...r, pct: (100 * r.real) / r.orc })).filter(r => r.pct > max);
}

/** Responsável pela explicação: dono da categoria (Configurações › Orçamento) → direção da unidade → Financeiro → Direção. */
export async function responsavelCategoria(categoria: string, unitId: number): Promise<number | null> {
  const cfg = await getSettings(); const donos = (cfg.orcamento.donosCategoria ?? {}) as Record<string, number | string>;
  const fixo = Number(donos[categoria]); if (fixo) { const [u] = await sql<{ id: number }[]>`SELECT id FROM users WHERE id=${fixo} AND ativo`; if (u) return u.id; }
  for (const papel of [["DIRETOR_UNIDADE"], ["FINANCEIRO"], ["DIRECAO"]]) { const ids = await usuariosPorPerfil(papel, papel[0] === "DIRETOR_UNIDADE" ? unitId : null); if (ids.length) return ids[0]; }
  return null;
}

/** Gera os pedidos do mês (idempotente: um por ano × mês × unidade × categoria). Só para meses já encerrados. */
export async function gerarPedidosExplicacao(ano: number, mes: number) {
  const h = hoje(); const atual = h.slice(0, 7); const alvo = `${ano}-${String(mes).padStart(2, "0")}`;
  if (alvo >= atual) return { criados: 0, estouros: 0, aberto: true };
  const est = await estourosDoMes(ano, mes); let criados = 0;
  for (const e of est) {
    const resp = await responsavelCategoria(e.categoria, e.unit_id);
    const [r] = await sql<{ id: number }[]>`INSERT INTO budget_explain_requests (ano, mes, escopo, categoria, executado_pct, responsavel_user_id) VALUES (${ano}, ${mes}, ${e.unit_id}, ${e.categoria}, ${Math.round(e.pct * 100) / 100}, ${resp}) ON CONFLICT (ano, mes, escopo, categoria) DO NOTHING RETURNING id`;
    if (!r) continue; criados++;
    // já explicado antes do pedido (explicação espontânea no mesmo período) → nasce respondido
    const [ja] = await sql`SELECT 1 FROM budget_comments WHERE ano=${ano} AND mes=${mes} AND unit_id=${e.unit_id} AND tipo='SAIDA' AND categoria=${e.categoria} LIMIT 1`;
    if (ja) { await sql`UPDATE budget_explain_requests SET status='RESPONDIDA', respondida_em=now() WHERE id=${r.id}`; continue; }
    if (resp) await notificar([resp], `Explique o desvio: ${e.categoria} em ${e.unidade}`, `${fmtPct(e.pct, 0)} do orçado em ${MESES_LONGOS[mes - 1]} de ${ano}. Registre o que explica e o que será feito.`, `/financeiro/orcamento?ano=${ano}&mes=${mes}&visao=mes&unidade=${e.unit_id}#explicacoes`, "ACAO", `orcexp:${r.id}`);
  }
  return { criados, estouros: est.length, aberto: false };
}

/** A explicação registrada fecha o pedido do mesmo período/categoria/unidade. */
export async function fecharPedido(ano: number, mes: number, unitId: number | null, categoria: string) {
  await sql`UPDATE budget_explain_requests SET status='RESPONDIDA', respondida_em=now() WHERE ano=${ano} AND mes=${mes} AND categoria=${categoria} AND status='ABERTA' AND ${unitId === null ? sql`true` : sql`escopo=${unitId}`}`;
}

export type PedidoExplicacao = { id: number; ano: number; mes: number; escopo: number; unidade: string | null; categoria: string; executado_pct: number | null; responsavel_user_id: number | null; responsavel: string | null; status: string; created_at: Date; respondida_em: Date | null };
export async function pedidosExplicacao(s: Session, filtro: { ano?: number; status?: string; meus?: boolean } = {}) {
  const escopo = scopeUnit(s);
  return sql<PedidoExplicacao[]>`SELECT p.id, p.ano, p.mes, p.escopo, u.nome AS unidade, p.categoria, p.executado_pct::float, p.responsavel_user_id, us.nome AS responsavel, p.status, p.created_at, p.respondida_em
    FROM budget_explain_requests p LEFT JOIN units u ON u.id=p.escopo LEFT JOIN users us ON us.id=p.responsavel_user_id
    WHERE true ${filtro.ano ? sql`AND p.ano=${filtro.ano}` : sql``} ${filtro.status ? sql`AND p.status=${filtro.status}` : sql``} ${filtro.meus ? sql`AND p.responsavel_user_id=${s.id}` : sql``} ${escopo === null ? sql`` : sql`AND p.escopo=${escopo}`}
    ORDER BY (p.status='ABERTA') DESC, p.ano DESC, p.mes DESC, p.executado_pct DESC NULLS LAST LIMIT 200`;
}
