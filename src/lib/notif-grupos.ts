/**
 * Notificações agrupadas (Cap. 16 · Ap. J): mais de 3 do mesmo tipo viram um item só ("5 × Pedido de férias aguardando aprovação"),
 * com a lista sob demanda e "marcar o grupo como lido". O tipo é o começo do título (antes de ":", "·" ou "—"), sem números.
 */
export type Notif = { id: number; tipo: string; titulo: string; texto: string | null; link: string | null; lida_em: Date | string | null; created_at: Date | string };
export const chaveGrupo = (n: Pick<Notif, "tipo" | "titulo">) => `${n.tipo}|${n.titulo.split(/[:·—]/)[0].replace(/\d+([.,]\d+)?/g, "N").replace(/\s+/g, " ").trim().toLowerCase()}`;
export const rotuloGrupo = (n: Pick<Notif, "titulo">) => n.titulo.split(/[:·—]/)[0].trim();
export type ItemNotif = { tipo: "UNICA"; n: Notif } | { tipo: "GRUPO"; chave: string; rotulo: string; itens: Notif[]; maisRecente: Notif };
/** Agrupa as não lidas (mais de `limite` do mesmo tipo); as lidas ficam individuais. Mantém a ordem pelo item mais recente. */
export function agruparNotificacoes(rows: Notif[], limite = 3): ItemNotif[] {
  const naoLidas = rows.filter(r => !r.lida_em); const cont = new Map<string, Notif[]>();
  for (const r of naoLidas) { const k = chaveGrupo(r); cont.set(k, [...(cont.get(k) ?? []), r]); }
  const out: ItemNotif[] = []; const feitos = new Set<string>();
  for (const r of rows) {
    if (r.lida_em) { out.push({ tipo: "UNICA", n: r }); continue; }
    const k = chaveGrupo(r); const g = cont.get(k)!;
    if (g.length > limite) { if (!feitos.has(k)) { feitos.add(k); out.push({ tipo: "GRUPO", chave: k, rotulo: rotuloGrupo(r), itens: g, maisRecente: g[0] }); } }
    else out.push({ tipo: "UNICA", n: r });
  }
  return out;
}
