/**
 * v34 · Estoque de materiais e EPIs por unidade e local (almoxarifado, cozinha, limpeza, portaria): saldo, mínimo por local,
 * lotes com validade (sai primeiro o que vence primeiro), custo médio, entradas, saídas, transferências, inventário (ajuste
 * com motivo) e a baixa automática na entrega de EPI. Saldo nunca fica negativo.
 */
import { sql } from "@/db";
import type { Session } from "./auth";
import { scopeUnit } from "./auth";

export const TIPO_MOV: Record<string, string> = { ENTRADA: "Entrada (compra ou doação)", SAIDA: "Saída (consumo / requisição)", TRANSFERENCIA: "Transferência entre locais", TRANSF_ENTRADA: "Transferência recebida", AJUSTE: "Ajuste de inventário", ENTREGA_EPI: "Entrega de EPI", PERDA: "Perda (vencido, avariado)" };
export const UNIDADES_MEDIDA = ["un", "cx", "pct", "kg", "g", "L", "mL", "m", "par", "rolo", "fardo", "galão"];
export const veEstoque = (s: Session) => ["RH", "DIRECAO", "DIRETOR_UNIDADE", "OPERACOES", "FINANCEIRO", "GESTOR"].includes(s.role);
export const podeEstoque = (s: Session) => ["RH", "DIRECAO", "DIRETOR_UNIDADE", "OPERACOES"].includes(s.role);
/** Locais que a pessoa movimenta (direção da unidade: só a própria). */
export function filtroLocais(s: Session) { const u = scopeUnit(s); return u === null ? sql`true` : sql`l.unit_id=${u}`; }

type Tx = typeof sql;
export type Mov = { itemId: number; locationId: number; tipo: string; quantidade: number; custoUnit?: number | null; lote?: string | null; validade?: string | null; destinoLocationId?: number | null; employeeId?: number | null; epiDeliveryId?: number | null; supplierId?: number | null; motivo?: string | null; sinalAjuste?: 1 | -1 };

/** Uma movimentação, numa transação já aberta. Lança erro se o saldo ficaria negativo. */
export async function movimentar(tx: Tx, s: { id: number | null; nome: string }, m: Mov): Promise<number> {
  if (!(m.quantidade > 0)) throw new Error("Quantidade precisa ser maior que zero.");
  const [it] = await tx<{ id: number; nome: string; controla_validade: boolean; custo_medio: number }[]>`SELECT id, nome, controla_validade, custo_medio::float FROM stock_items WHERE id=${m.itemId} AND ativo`;
  if (!it) throw new Error("Item não encontrado.");
  const entra = m.tipo === "ENTRADA" || m.tipo === "TRANSF_ENTRADA" || (m.tipo === "AJUSTE" && m.sinalAjuste === 1);
  const sinal = entra ? 1 : -1;
  await tx`INSERT INTO stock_levels (item_id, location_id, saldo) VALUES (${m.itemId}, ${m.locationId}, 0) ON CONFLICT DO NOTHING`;
  const [nv] = await tx<{ saldo: number }[]>`SELECT saldo::float FROM stock_levels WHERE item_id=${m.itemId} AND location_id=${m.locationId} FOR UPDATE`;
  const novo = Math.round((nv.saldo + sinal * m.quantidade) * 100) / 100;
  if (novo < 0) throw new Error(`Saldo insuficiente de ${it.nome}: há ${nv.saldo} no local.`);
  if (m.tipo === "ENTRADA" && m.custoUnit && m.custoUnit > 0) {
    // custo médio ponderado da rede (todas as unidades)
    const [{ total }] = await tx<{ total: number }[]>`SELECT coalesce(sum(saldo),0)::float AS total FROM stock_levels WHERE item_id=${m.itemId}`;
    const cm = total > 0 ? (total * it.custo_medio + m.quantidade * m.custoUnit) / (total + m.quantidade) : m.custoUnit;
    await tx`UPDATE stock_items SET custo_medio=${Math.round(cm * 10000) / 10000} WHERE id=${m.itemId}`;
  }
  await tx`UPDATE stock_levels SET saldo=${novo} WHERE item_id=${m.itemId} AND location_id=${m.locationId}`;
  let lotId: number | null = null;
  if (it.controla_validade) {
    if (entra) {
      if (m.tipo === "ENTRADA" && !m.validade) throw new Error(`${it.nome} controla validade: informe a validade do lote.`);
      const [l] = await tx<{ id: number }[]>`INSERT INTO stock_lots (item_id, location_id, lote, validade, saldo) VALUES (${m.itemId}, ${m.locationId}, ${m.lote ?? null}, ${m.validade ?? null}, ${m.quantidade}) RETURNING id`; lotId = l.id;
    } else {
      // sai primeiro o lote que vence primeiro (PVPS / FEFO)
      let resta = m.quantidade;
      for (const l of await tx<{ id: number; saldo: number }[]>`SELECT id, saldo::float FROM stock_lots WHERE item_id=${m.itemId} AND location_id=${m.locationId} AND saldo > 0 ORDER BY validade NULLS LAST, id FOR UPDATE`) {
        if (resta <= 0) break; const usa = Math.min(resta, l.saldo); await tx`UPDATE stock_lots SET saldo=saldo-${usa} WHERE id=${l.id}`; resta = Math.round((resta - usa) * 100) / 100; lotId = lotId ?? l.id;
      }
    }
  }
  const [mv] = await tx<{ id: number }[]>`INSERT INTO stock_moves (item_id, location_id, tipo, quantidade, sinal, custo_unit, lot_id, destino_location_id, employee_id, epi_delivery_id, supplier_id, motivo, saldo_apos, user_id, user_nome)
    VALUES (${m.itemId}, ${m.locationId}, ${m.tipo}, ${m.quantidade}, ${sinal}, ${m.custoUnit ?? (m.tipo === "ENTRADA" ? null : it.custo_medio)}, ${lotId}, ${m.destinoLocationId ?? null}, ${m.employeeId ?? null}, ${m.epiDeliveryId ?? null}, ${m.supplierId ?? null}, ${m.motivo ?? null}, ${novo}, ${s.id}, ${s.nome}) RETURNING id`;
  if (m.tipo === "TRANSFERENCIA" && m.destinoLocationId) {
    // a outra ponta da transferência entra no destino (mesmo lote/validade, quando houver)
    const [lt] = lotId ? await tx<{ lote: string | null; validade: string | null }[]>`SELECT lote, validade::text FROM stock_lots WHERE id=${lotId}` : [];
    await movimentar(tx, s, { itemId: m.itemId, locationId: m.destinoLocationId, tipo: "TRANSF_ENTRADA", quantidade: m.quantidade, lote: lt?.lote ?? null, validade: lt?.validade ?? null, motivo: `Vinda de outro local (mov. ${mv.id})` });
  }
  return mv.id;
}

export type LinhaSaldo = { item_id: number; nome: string; categoria: string; unidade_medida: string; location_id: number; local: string; unidade: string; saldo: number; minimo: number; custo_medio: number; vence: string | null; epi: string | null };
export async function saldos(s: Session, o: { locationId?: number | null; categoria?: string | null; q?: string | null } = {}): Promise<LinhaSaldo[]> {
  return sql<LinhaSaldo[]>`SELECT i.id AS item_id, i.nome, i.categoria, i.unidade_medida, l.id AS location_id, l.nome AS local, u.nome AS unidade, coalesce(v.saldo,0)::float AS saldo, coalesce(v.minimo, i.minimo_padrao)::float AS minimo, i.custo_medio::float,
      (SELECT min(t.validade)::text FROM stock_lots t WHERE t.item_id=i.id AND t.location_id=l.id AND t.saldo > 0) AS vence, ep.nome AS epi
    FROM stock_levels v JOIN stock_items i ON i.id=v.item_id JOIN stock_locations l ON l.id=v.location_id JOIN units u ON u.id=l.unit_id LEFT JOIN epi_items ep ON ep.id=i.epi_id
    WHERE i.ativo AND l.ativo AND ${filtroLocais(s)}
      ${o.locationId ? sql`AND l.id=${o.locationId}` : sql``} ${o.categoria ? sql`AND i.categoria=${o.categoria}` : sql``} ${o.q ? sql`AND i.nome ILIKE ${"%" + o.q + "%"}` : sql``}
    ORDER BY u.nome, l.nome, i.categoria, i.nome`;
}
