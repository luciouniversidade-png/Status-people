"use server";
// v34 · estoque: locais, itens (com mínimo e validade, ligados ao EPI), movimentações e inventário.
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit } from "@/lib/auth";
import { audit, str, int, num, getSettings } from "@/lib/utils";
import { comMensagem } from "@/lib/redirecionar";
import * as K from "@/lib/estoque";

const go = (b: string, k: "ok" | "erro", m: string) => comMensagem(b, k, m);
const msgErro = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado.");
const ehData = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

async function localPermitido(sId: Awaited<ReturnType<typeof requireSession>>, locationId: number) {
  const [l] = await sql<{ unit_id: number; ativo: boolean }[]>`SELECT unit_id, ativo FROM stock_locations WHERE id=${locationId}`; assert(!!l && l.ativo, "Local não encontrado.");
  const u = scopeUnit(sId); assert(u === null || u === l!.unit_id, "Local de outra unidade.");
}

export async function salvarLocal(fd: FormData) {
  const s = await requireSession(); const volta = "/operacoes/estoque?aba=itens";
  try {
    assert(K.podeEstoque(s), "Sem permissão."); const nome = str(fd, "nome").slice(0, 60); assert(nome.length >= 3, "Dê um nome ao local (ex.: Almoxarifado).");
    const unitId = int(fd, "unitId") ?? 0; const u = scopeUnit(s); assert(unitId > 0 && (u === null || u === unitId), "Escolha a unidade.");
    await sql`INSERT INTO stock_locations (unit_id, nome) VALUES (${unitId}, ${nome})`; await audit(s, "criar local de estoque", "stock_locations", null, null, { nome, unitId });
  } catch (e) { redirect(go(volta, "erro", msgErro(e))); }
  redirect(go(volta, "ok", "Local criado."));
}

export async function salvarItem(fd: FormData) {
  const s = await requireSession(); const volta = "/operacoes/estoque?aba=itens"; const id = int(fd, "id");
  try {
    assert(K.podeEstoque(s), "Sem permissão."); const cfg = await getSettings();
    const nome = str(fd, "nome").slice(0, 120); assert(nome.length >= 3, "Informe o item.");
    const categoria = str(fd, "categoria"); assert((cfg.estoque.categorias as string[]).includes(categoria), "Escolha a categoria.");
    const um = K.UNIDADES_MEDIDA.includes(str(fd, "um")) ? str(fd, "um") : "un"; const minimo = Math.max(0, num(fd, "minimo") ?? 0);
    const epiId = int(fd, "epiId") || null; const validade = str(fd, "validade") === "1";
    const locais = fd.getAll("locais").map(Number).filter(n => n > 0);
    await sql.begin(async tx => {
      let iid = id ?? 0;
      if (id) await tx`UPDATE stock_items SET nome=${nome}, categoria=${categoria}, unidade_medida=${um}, minimo_padrao=${minimo}, epi_id=${epiId}, controla_validade=${validade}, ativo=${str(fd, "ativo") !== "0"} WHERE id=${id}`;
      else { const [r] = await tx<{ id: number }[]>`INSERT INTO stock_items (nome, categoria, unidade_medida, minimo_padrao, epi_id, controla_validade) VALUES (${nome}, ${categoria}, ${um}, ${minimo}, ${epiId}, ${validade}) RETURNING id`; iid = r.id; }
      for (const l of locais) await tx`INSERT INTO stock_levels (item_id, location_id, saldo) VALUES (${iid}, ${l}, 0) ON CONFLICT DO NOTHING`;
    });
    await audit(s, id ? "editar item de estoque" : "criar item de estoque", "stock_items", id ?? null, null, { nome, categoria, minimo, epiId });
  } catch (e) { redirect(go(volta, "erro", msgErro(e))); }
  redirect(go(volta, "ok", "Item salvo."));
}

/** Mínimo de um item num local (substitui o mínimo padrão do item). */
export async function salvarMinimo(fd: FormData) {
  const s = await requireSession(); const volta = "/operacoes/estoque?aba=saldos";
  try {
    assert(K.podeEstoque(s), "Sem permissão."); const itemId = int(fd, "itemId") ?? 0, locationId = int(fd, "locationId") ?? 0; await localPermitido(s, locationId);
    const v = str(fd, "minimo"); const minimo = v === "" ? null : Math.max(0, Number(v.replace(",", "."))); assert(minimo === null || Number.isFinite(minimo), "Mínimo inválido.");
    await sql`UPDATE stock_levels SET minimo=${minimo} WHERE item_id=${itemId} AND location_id=${locationId}`;
  } catch (e) { redirect(go(volta, "erro", msgErro(e))); }
  redirect(go(volta, "ok", "Mínimo atualizado."));
}

export async function movimentarEstoque(fd: FormData) {
  const s = await requireSession(); const volta = str(fd, "voltar") || "/operacoes/estoque?aba=movimentar"; let msg = "";
  try {
    assert(K.podeEstoque(s), "Sem permissão."); const tipo = str(fd, "tipo"); assert(["ENTRADA", "SAIDA", "TRANSFERENCIA", "PERDA"].includes(tipo), "Escolha o tipo.");
    const itemId = int(fd, "itemId") ?? 0, locationId = int(fd, "locationId") ?? 0; await localPermitido(s, locationId);
    const quantidade = num(fd, "quantidade") ?? 0; assert(quantidade > 0 && quantidade <= 100000, "Quantidade inválida.");
    const destino = tipo === "TRANSFERENCIA" ? int(fd, "destinoId") : null; if (tipo === "TRANSFERENCIA") { assert(!!destino && destino !== locationId, "Escolha o local de destino."); await localPermitido(s, destino!); }
    const validade = str(fd, "validade"); assert(!validade || ehData(validade), "Validade inválida.");
    const motivo = str(fd, "motivo").slice(0, 300) || null; if (tipo === "PERDA") assert(!!motivo, "Explique a perda (vencido, avariado…).");
    await sql.begin(async tx => { await K.movimentar(tx as unknown as typeof sql, s, { itemId, locationId, tipo, quantidade, custoUnit: tipo === "ENTRADA" ? num(fd, "custo") : null, lote: str(fd, "lote") || null, validade: validade || null, destinoLocationId: destino, employeeId: int(fd, "employeeId") || null, supplierId: int(fd, "supplierId") || null, motivo }); });
    await audit(s, "movimentar estoque", "stock_items", itemId, null, { tipo, quantidade, locationId, destino });
    msg = `${K.TIPO_MOV[tipo]} registrada.`;
  } catch (e) { redirect(go(volta, "erro", msgErro(e))); }
  redirect(go(volta, "ok", msg));
}

/** Inventário: a contagem de cada item do local; diferenças viram ajuste com o motivo. */
export async function registrarInventario(fd: FormData) {
  const s = await requireSession(); const locationId = int(fd, "locationId") ?? 0; const volta = `/operacoes/estoque?aba=inventario&local=${locationId}`; let n = 0;
  try {
    assert(K.podeEstoque(s), "Sem permissão."); await localPermitido(s, locationId);
    const motivo = str(fd, "motivo").slice(0, 200) || "Inventário";
    const itens = await sql<{ item_id: number; saldo: number }[]>`SELECT item_id, saldo::float FROM stock_levels WHERE location_id=${locationId}`;
    await sql.begin(async tx => {
      for (const it of itens) {
        const v = str(fd, `q_${it.item_id}`); if (v === "") continue; const contado = Number(v.replace(",", ".")); if (!Number.isFinite(contado) || contado < 0) throw new Error("Contagem inválida.");
        const dif = Math.round((contado - it.saldo) * 100) / 100; if (dif === 0) continue;
        await K.movimentar(tx as unknown as typeof sql, s, { itemId: it.item_id, locationId, tipo: "AJUSTE", sinalAjuste: dif > 0 ? 1 : -1, quantidade: Math.abs(dif), motivo }); n++;
      }
    });
    await audit(s, "inventário de estoque", "stock_locations", locationId, null, { ajustes: n });
  } catch (e) { redirect(go(volta, "erro", msgErro(e))); }
  redirect(go(volta, "ok", n ? `Inventário registrado: ${n} item(ns) ajustado(s).` : "Inventário conferido: nenhuma diferença."));
}
