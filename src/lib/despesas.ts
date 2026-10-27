import { sql } from "@/db";
import { getSettings, hoje, addDays } from "./utils";
import { situacaoContrato } from "./contratos";

/**
 * T-029 · Despesas & fila de aprovação (v25).
 * A política fica embutida: alçada por valor nas etapas do tipo (Central de solicitações), lote só para o normal (C10),
 * exceções item a item (sem documento, acima do lote, categoria bloqueada, orçamento estourado) e "paga" só com o débito
 * conciliado do extrato. Os compromissos aprovados entram na projeção de caixa (T-027) na data programada.
 */
type Cfg = Awaited<ReturnType<typeof getSettings>>;
export type Excecao = { codigo: "SEM_DOCUMENTO" | "ACIMA_LOTE" | "CATEGORIA_BLOQUEADA" | "SEM_ORCAMENTO" | "ORCAMENTO"; texto: string };
export const EXCECAO_ROTULO: Record<Excecao["codigo"], string> = {
  SEM_DOCUMENTO: "Sem documento", ACIMA_LOTE: "Acima do lote", CATEGORIA_BLOQUEADA: "Categoria bloqueada", SEM_ORCAMENTO: "Sem orçamento", ORCAMENTO: "Orçamento estourado",
};
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Categoria do caixa em que a despesa do tipo cai (o débito que paga é reclassificado para ela). */
export function categoriaDoTipo(cfg: Cfg, codigo: string): string {
  return (cfg.despesas.categoriaPorTipo as Record<string, string>)[codigo] ?? "Outras despesas";
}

/** Orçado × realizado × comprometido do mês, por unidade e categoria de saída (só unidades que orçam o ano). */
export async function orcamentoMes(mes: string, units: number[]) {
  const ano = Number(mes.slice(0, 4)), m = Number(mes.slice(5, 7)); const ini = `${mes}-01`; const fim = addDays(`${mes.slice(0, 4)}-${String(m).padStart(2, "0")}-28`, 4).slice(0, 7) + "-01";
  const [orc, real, orcam] = await Promise.all([
    sql<{ unit_id: number; categoria: string; valor: number }[]>`WITH cats AS (SELECT DISTINCT unit_id, categoria FROM budgets WHERE ano=${ano} AND tipo='SAIDA' AND unit_id = ANY(${units}) UNION SELECT DISTINCT unit_id, categoria FROM budget_months WHERE ano=${ano} AND tipo='SAIDA' AND unit_id = ANY(${units}))
      SELECT c.unit_id, c.categoria, coalesce(bm.valor, b.valor_mensal, 0)::float AS valor FROM cats c LEFT JOIN budget_months bm ON bm.ano=${ano} AND bm.unit_id=c.unit_id AND bm.tipo='SAIDA' AND bm.categoria=c.categoria AND bm.mes=${m}
      LEFT JOIN budgets b ON b.ano=${ano} AND b.unit_id=c.unit_id AND b.tipo='SAIDA' AND b.categoria=c.categoria`,
    sql<{ unit_id: number; categoria: string; valor: number }[]>`SELECT unit_id, categoria, sum(valor)::float AS valor FROM cash_entries WHERE tipo='SAIDA' AND data >= ${ini}::date AND data < ${fim}::date AND unit_id = ANY(${units}) GROUP BY 1, 2`,
    sql<{ unit_id: number }[]>`SELECT DISTINCT unit_id FROM budgets WHERE ano=${ano} AND tipo='SAIDA' AND unit_id = ANY(${units}) UNION SELECT DISTINCT unit_id FROM budget_months WHERE ano=${ano} AND tipo='SAIDA' AND unit_id = ANY(${units})`,
  ]);
  const chave = (u: number, c: string) => `${u}|${c}`;
  return { orc: new Map(orc.map(o => [chave(o.unit_id, o.categoria), o.valor])), real: new Map(real.map(r => [chave(r.unit_id, r.categoria), r.valor])), orcam: new Set(orcam.map(o => o.unit_id)), chave };
}

/**
 * Exceções da política (C10): o que nunca entra no lote e pede decisão item a item.
 * O orçamento olha o mês corrente da unidade: realizado no caixa + despesas aprovadas ainda não pagas + esta despesa.
 */
export async function excecoesDespesa(ids: number[]): Promise<Map<number, Excecao[]>> {
  const out = new Map<number, Excecao[]>(); if (!ids.length) return out;
  const cfg = await getSettings(); const d = cfg.despesas;
  const rows = await sql<{ id: number; codigo: string; valor: number | null; unit_id: number | null; anexos: number }[]>`SELECT r.id, t.codigo, r.valor::float, r.unit_id,
    (SELECT count(*) FROM attachments a WHERE a.entidade='request' AND a.entidade_id=r.id)::int AS anexos FROM requests r JOIN request_types t ON t.id=r.type_id WHERE r.id = ANY(${ids})`;
  const units = [...new Set(rows.filter(r => r.unit_id !== null && (r.valor ?? 0) > 0).map(r => r.unit_id!))];
  const mes = hoje().slice(0, 7); const o = units.length && d.excecaoOrcamento ? await orcamentoMes(mes, units) : null;
  const pend = o ? await sql<{ unit_id: number; codigo: string; valor: number }[]>`SELECT r.unit_id, t.codigo, sum(r.valor)::float AS valor FROM requests r JOIN request_types t ON t.id=r.type_id WHERE r.status='APROVADA' AND r.valor > 0 AND r.pago_em IS NULL AND r.unit_id = ANY(${units}) GROUP BY 1, 2` : [];
  const comprometido = new Map<string, number>(); if (o) for (const p of pend) { const k = o.chave(p.unit_id, categoriaDoTipo(cfg, p.codigo)); comprometido.set(k, (comprometido.get(k) ?? 0) + p.valor); }
  // v27 · parcelas de contas a pagar aprovadas que vencem neste mês também comprometem o orçado da categoria
  if (o) { try { const pp = await sql<{ unit_id: number; categoria: string; valor: number }[]>`SELECT p.unit_id, p.categoria, sum(i.valor)::float AS valor FROM payable_installments i JOIN payables p ON p.id=i.payable_id WHERE i.status='A_PAGAR' AND p.status='ATIVO' AND p.unit_id = ANY(${units}) AND to_char(i.vencimento, 'YYYY-MM')=${mes} GROUP BY 1, 2`;
    for (const p of pp) { const k = o.chave(p.unit_id, p.categoria); comprometido.set(k, (comprometido.get(k) ?? 0) + p.valor); } } catch { /* banco anterior à v27 */ } }
  for (const r of rows) {
    const ex: Excecao[] = []; const valor = r.valor ?? 0; const cat = categoriaDoTipo(cfg, r.codigo);
    if (valor > 0) {
      if (d.exigirDocumento && r.anexos === 0) ex.push({ codigo: "SEM_DOCUMENTO", texto: "Despesa sem documento anexado (nota, orçamento ou comprovante)." });
      if (valor > Number(d.loteAte)) ex.push({ codigo: "ACIMA_LOTE", texto: `Valor acima do limite do lote (${brl(Number(d.loteAte))}).` });
      if ((d.categoriasBloqueadas as string[]).includes(cat)) ex.push({ codigo: "CATEGORIA_BLOQUEADA", texto: `“${cat}” sempre pede decisão item a item.` });
      if (o && r.unit_id !== null && o.orcam.has(r.unit_id)) {
        const k = o.chave(r.unit_id, cat); const orcado = o.orc.get(k);
        if (orcado === undefined || orcado <= 0) ex.push({ codigo: "SEM_ORCAMENTO", texto: `“${cat}” não tem orçamento neste mês na unidade.` });
        else { const usado = (o.real.get(k) ?? 0) + (comprometido.get(k) ?? 0); if (usado + valor > orcado + 0.005) ex.push({ codigo: "ORCAMENTO", texto: `“${cat}”: ${brl(usado)} já usados de ${brl(orcado)} no mês — com esta, ${Math.round((100 * (usado + valor)) / orcado)}% do orçado.` }); }
      }
    }
    out.set(r.id, ex);
  }
  return out;
}

/**
 * Compromissos que entram na projeção de caixa (T-027):
 * - despesas aprovadas a pagar (solicitações) na data programada (sem data: amanhã);
 * - v27 · parcelas em aberto das contas a pagar aprovadas, na data programada (senão no vencimento; vencida e não paga: amanhã).
 */
export async function compromissosAprovados(unitId: number | null) {
  const cfg = await getSettings(); const amanha = addDays(hoje(), 1);
  const r = await sql<{ id: number; codigo: string; valor: number; previsto: string | null }[]>`SELECT r.id, t.codigo, r.valor::float, r.pagamento_previsto::text AS previsto FROM requests r JOIN request_types t ON t.id=r.type_id
    WHERE r.status='APROVADA' AND r.valor > 0 AND r.pago_em IS NULL ${unitId === null ? sql`` : sql`AND r.unit_id=${unitId}`}`;
  const solicitacoes = r.map(x => ({ id: x.id, origem: "SOLICITACAO" as const, categoria: categoriaDoTipo(cfg, x.codigo), valor: x.valor, data: !x.previsto || x.previsto < amanha ? amanha : x.previsto, programada: !!x.previsto, vencida: false }));
  let parcelas: { id: number; categoria: string; valor: number; vencimento: string }[] = [];
  try {
    parcelas = await sql<{ id: number; categoria: string; valor: number; vencimento: string }[]>`SELECT i.id, p.categoria, i.valor::float, coalesce(i.programado_para, i.vencimento)::text AS vencimento FROM payable_installments i JOIN payables p ON p.id=i.payable_id
      WHERE i.status='A_PAGAR' AND p.status='ATIVO' ${unitId === null ? sql`` : sql`AND p.unit_id=${unitId}`}`;
  } catch { parcelas = []; /* banco anterior à v27 */ }
  return [...solicitacoes, ...parcelas.map(x => ({ id: x.id, origem: "CONTA_PAGAR" as const, categoria: x.categoria, valor: x.valor, data: x.vencimento < amanha ? amanha : x.vencimento, programada: true, vencida: x.vencimento < hoje() }))];
}

export type LinhaFila = { id: number; numero: string; titulo: string; tipo: string; codigo: string; status: string; valor: number | null; unidade: string | null; solicitante: string | null; etapa: string | null; prazo: string | null; criada: string; concluida: string | null; previsto: string | null; pago_em: string | null; anexos: number };

/** Painel da tela T-029: estados submetido → aprovado → pago, treemap do OPEX, fila com exceções, a pagar e recorrentes. */
export async function painelDespesas(periodo: string, unitIds: number[] | null) {
  const cfg = await getSettings(); const ini = `${periodo}-01`; const [a, m] = periodo.split("-").map(Number); const fim = new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 10);
  const todasU = (await sql<{ id: number }[]>`SELECT id FROM units`).map(u => u.id); const units = unitIds ?? todasU;
  const fu = unitIds === null ? sql`` : sql`AND r.unit_id = ANY(${unitIds})`;
  const internas = cfg.dre.internas as string[];
  const [estados, fila, opex, recorrentes] = await Promise.all([
    sql<{ submetidas: number; vsub: number; aprovadas: number; vapr: number; pagas: number; vpag: number; rejeitadas: number }[]>`SELECT
        count(*) FILTER (WHERE r.created_at >= ${ini}::date AND r.created_at < ${fim}::date)::int AS submetidas, coalesce(sum(r.valor) FILTER (WHERE r.created_at >= ${ini}::date AND r.created_at < ${fim}::date), 0)::float AS vsub,
        count(*) FILTER (WHERE r.status='APROVADA' AND r.concluida_em >= ${ini}::date AND r.concluida_em < ${fim}::date)::int AS aprovadas, coalesce(sum(r.valor) FILTER (WHERE r.status='APROVADA' AND r.concluida_em >= ${ini}::date AND r.concluida_em < ${fim}::date), 0)::float AS vapr,
        count(*) FILTER (WHERE r.pago_em >= ${ini}::date AND r.pago_em < ${fim}::date)::int AS pagas, coalesce(sum(r.valor) FILTER (WHERE r.pago_em >= ${ini}::date AND r.pago_em < ${fim}::date), 0)::float AS vpag,
        count(*) FILTER (WHERE r.status='REJEITADA' AND r.concluida_em >= ${ini}::date AND r.concluida_em < ${fim}::date)::int AS rejeitadas
      FROM requests r WHERE r.valor > 0 ${fu}`,
    sql<LinhaFila[]>`SELECT r.id, r.numero, r.titulo, t.nome AS tipo, t.codigo, r.status, r.valor::float, u.nome AS unidade, r.solicitante_nome AS solicitante, (r.etapas->r.etapa_atual->>'nome') AS etapa, r.prazo_etapa::text AS prazo,
        r.created_at::text AS criada, r.concluida_em::text AS concluida, r.pagamento_previsto::text AS previsto, r.pago_em::text, (SELECT count(*) FROM attachments x WHERE x.entidade='request' AND x.entidade_id=r.id)::int AS anexos
      FROM requests r JOIN request_types t ON t.id=r.type_id LEFT JOIN units u ON u.id=r.unit_id WHERE r.valor > 0 AND (r.status IN ('EM_APROVACAO','DEVOLVIDA') OR (r.status='APROVADA' AND r.pago_em IS NULL)) ${fu} ORDER BY r.created_at`,
    sql<{ categoria: string; valor: number }[]>`SELECT categoria, sum(valor)::float AS valor FROM cash_entries WHERE tipo='SAIDA' AND data >= ${ini}::date AND data < ${fim}::date AND unit_id = ANY(${units}) AND NOT (categoria = ANY(${internas})) GROUP BY 1 ORDER BY 2 DESC`,
    sql<{ id: number; fornecedor: string; objeto: string; unidade: string | null; valor_mensal: number | null; fim: string | null; aviso_previo_dias: number; renovacao: string; proximo_reajuste: string | null; status: string }[]>`SELECT c.id, sp.nome AS fornecedor, c.objeto, u.nome AS unidade, c.valor_mensal::float, c.fim::text, c.aviso_previo_dias, c.renovacao, c.proximo_reajuste::text, c.status
      FROM contracts c JOIN suppliers sp ON sp.id=c.supplier_id LEFT JOIN units u ON u.id=c.unit_id WHERE c.status='VIGENTE' AND c.valor_mensal > 0 ${unitIds === null ? sql`` : sql`AND (c.unit_id IS NULL OR c.unit_id = ANY(${unitIds}))`}`,
  ]);
  // orçado do mês por categoria (para colorir o treemap)
  const ano = a; const orcCat = await sql<{ categoria: string; valor: number }[]>`WITH cats AS (SELECT DISTINCT unit_id, categoria FROM budgets WHERE ano=${ano} AND tipo='SAIDA' AND unit_id = ANY(${units}) UNION SELECT DISTINCT unit_id, categoria FROM budget_months WHERE ano=${ano} AND tipo='SAIDA' AND unit_id = ANY(${units}))
    SELECT c.categoria, sum(coalesce(bm.valor, b.valor_mensal, 0))::float AS valor FROM cats c LEFT JOIN budget_months bm ON bm.ano=${ano} AND bm.unit_id=c.unit_id AND bm.tipo='SAIDA' AND bm.categoria=c.categoria AND bm.mes=${m}
    LEFT JOIN budgets b ON b.ano=${ano} AND b.unit_id=c.unit_id AND b.tipo='SAIDA' AND b.categoria=c.categoria GROUP BY 1`;
  const orcado = new Map(orcCat.map(o => [o.categoria, o.valor]));
  const exc = await excecoesDespesa(fila.filter(f => f.status === "EM_APROVACAO").map(f => f.id));
  const h = hoje(); const avisos = (cfg.contratos?.avisos ?? [60, 30]) as number[];
  const rec = recorrentes.map(c => { const sit = situacaoContrato(c, avisos, h); const proximo = [c.fim ? addDays(c.fim, -c.aviso_previo_dias) : null, c.proximo_reajuste, c.fim].filter((x): x is string => !!x && x >= h).sort()[0] ?? null; return { ...c, sit, proximo }; })
    .sort((x, y) => (x.proximo ?? "9999").localeCompare(y.proximo ?? "9999"));
  const e = estados[0];
  return {
    estados: e, fila, exc, opex, orcado, recorrentes: rec,
    mensalRecorrente: recorrentes.reduce((s, c) => s + (c.valor_mensal ?? 0), 0),
    emAprovacao: fila.filter(f => f.status === "EM_APROVACAO"), devolvidas: fila.filter(f => f.status === "DEVOLVIDA"), aPagar: fila.filter(f => f.status === "APROVADA"),
    atrasoPagamento: Number(cfg.despesas.alertaPagamentoDias),
  };
}
