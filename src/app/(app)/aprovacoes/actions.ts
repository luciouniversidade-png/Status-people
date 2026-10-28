"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert } from "@/lib/auth";
import { audit, str, int, caminhoSeguro, LEAVE_LABEL } from "@/lib/utils";
import { filaFerias, filaBanco } from "@/lib/aprovacoes";
import { notificar } from "@/lib/comunicacao";
import { comMensagem } from "@/lib/redirecionar";

const go = (b: string, k: "ok" | "erro", msg: string) => comMensagem(b, k, msg);
const erro = (e: unknown) => e instanceof Error ? e.message : "Erro inesperado.";

/** Aprova em lote só os itens normais da fila — o servidor recalcula as exceções e nenhuma entra (C10). Trilha individual de cada item. */
export async function aprovarLote(fd: FormData) {
  const s = await requireSession(); const aba = str(fd, "aba") === "banco" ? "banco" : "ferias"; const voltar = caminhoSeguro(str(fd, "voltar"), `/aprovacoes?aba=${aba}`); let msg = "";
  try {
    const marcados = new Set(fd.getAll("ids").map(Number).filter(n => n > 0)); assert(marcados.size > 0, "Nenhum item selecionado.");
    // a fila é recalculada com os itens marcados: pedido que só fura a cobertura somado a outro marcado sai do lote
    const fila = aba === "banco" ? await filaBanco(s) : await filaFerias(s, marcados); assert(fila.length > 0, "Seu acesso não aprova esta fila ou ela está vazia.");
    const normais = fila.filter(i => marcados.has(i.id) && i.excecoes.length === 0); const barrados = fila.filter(i => marcados.has(i.id) && i.excecoes.length > 0);
    assert(normais.length > 0, "Os itens selecionados são exceções: decida um a um, com justificativa.");
    const lote = `L${Date.now().toString(36)}`;
    for (const i of normais) {
      if (aba === "banco") {
        const [r] = await sql<{ id: number; lancado_por: number | null }[]>`UPDATE hour_entries SET status='APROVADO', aprovado_por=${s.id}, decidido_em=now(), lote=${lote} WHERE id=${i.id} AND status='PENDENTE' RETURNING id, lancado_por`;
        if (r) { await audit(s, "aprovar (lote)", "hour_entries", i.id, { status: "PENDENTE" }, { status: "APROVADO", lote }); if (r.lancado_por && r.lancado_por !== s.id) await notificar([r.lancado_por], "Lançamentos do banco aprovados", null, "/banco-de-horas", "INFO", `lote-${lote}-${r.lancado_por}`); }
      } else {
        const [r] = await sql<{ id: number; solicitado_por: number | null; tipo: string }[]>`UPDATE leave_requests SET status='APROVADA', aprovado_por=${s.id}, decidido_em=now(), lote=${lote} WHERE id=${i.id} AND status='SOLICITADA' RETURNING id, solicitado_por, tipo`;
        if (r) { await audit(s, "aprovar (lote)", "leave_requests", i.id, { status: "SOLICITADA" }, { status: "APROVADA", lote }); if (r.solicitado_por && r.solicitado_por !== s.id) await notificar([r.solicitado_por], `${LEAVE_LABEL[r.tipo] ?? "Pedido"} aprovado`, `${i.pessoa} · ${i.detalhe}`, "/ferias", "INFO", `lote-${lote}-${r.solicitado_por}`); }
      }
    }
    msg = `${normais.length} item(ns) aprovado(s) no lote ${lote}, com registro individual.${barrados.length ? ` ${barrados.length} exceção(ões) ficaram fora do lote e pedem decisão própria.` : ""}`;
  } catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", msg));
}

/** Decisão individual de uma exceção: aprovar ou devolver, sempre com justificativa consciente registrada. */
export async function decidirExcecao(fd: FormData) {
  const s = await requireSession(); const aba = str(fd, "aba") === "banco" ? "banco" : "ferias"; const voltar = caminhoSeguro(str(fd, "voltar"), `/aprovacoes?aba=${aba}`); const id = int(fd, "id") ?? 0; const decisao = str(fd, "decisao"); let msg = "";
  try {
    const just = str(fd, "justificativa"); assert(just.length >= 10, "Justifique a decisão (mínimo 10 caracteres) — fica na trilha.");
    const fila = aba === "banco" ? await filaBanco(s) : await filaFerias(s); const item = fila.find(i => i.id === id); assert(!!item, "Item não está na sua fila.");
    assert(!item!.excecoes.some(e => e.startsWith("você ")), "Quem pediu não decide o próprio pedido.");
    assert(!item!.excecoes.some(e => e.startsWith("mês fechado")), "O mês está fechado no ponto: reabra antes de decidir.");
    const aprova = decisao === "APROVAR"; const motivo = `${aprova ? "Exceção aprovada" : "Devolvido"}: ${just} [${item!.excecoes.join("; ")}]`;
    if (aba === "banco") { await sql`UPDATE hour_entries SET status=${aprova ? "APROVADO" : "REJEITADO"}, aprovado_por=${s.id}, decidido_em=now(), motivo_decisao=${motivo} WHERE id=${id} AND status='PENDENTE'`; await audit(s, aprova ? "aprovar exceção" : "rejeitar exceção", "hour_entries", id, { status: "PENDENTE" }, { status: aprova ? "APROVADO" : "REJEITADO", excecoes: item!.excecoes }); }
    else { await sql`UPDATE leave_requests SET status=${aprova ? "APROVADA" : "REJEITADA"}, aprovado_por=${s.id}, decidido_em=now(), motivo_decisao=${motivo} WHERE id=${id} AND status='SOLICITADA'`; await audit(s, aprova ? "aprovar exceção" : "rejeitar exceção", "leave_requests", id, { status: "SOLICITADA" }, { status: aprova ? "APROVADA" : "REJEITADA", excecoes: item!.excecoes }); }
    msg = aprova ? "Exceção aprovada com justificativa registrada." : "Pedido devolvido com o motivo.";
  } catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", msg));
}
