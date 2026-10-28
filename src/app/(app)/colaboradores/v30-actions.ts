"use server";
// v30 · ficha completa: histórico funcional (lançamento manual), formação e qualificações, itens sob responsabilidade
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, can, assert, assertScope } from "@/lib/auth";
import { audit, str, strOrNull, num, int, hoje, caminhoSeguro } from "@/lib/utils";
import { comMensagem } from "@/lib/redirecionar";
import { MOV_MANUAIS, QUALIF_TIPO, ITEM_TIPO, podeItens } from "@/lib/pessoas-v30";
import { notificar } from "@/lib/comunicacao";

const go = (b: string, k: "ok" | "erro", msg: string, hash = "") => comMensagem(b, k, msg, hash);
const msgErro = (e: unknown) => (e instanceof Error ? e.message : "Erro");
type Emp = { id: number; unit_id: number; admissao: string; nome: string; situacao: string };
async function ficha(id: number): Promise<Emp> {
  const [e] = await sql<Emp[]>`SELECT id, unit_id, admissao::text, nome, situacao FROM employees WHERE id=${id}`; if (!e) throw new Error("Colaborador não encontrado."); return e;
}
async function loginDa(employeeId: number) { const [u] = await sql<{ id: number }[]>`SELECT id FROM users WHERE employee_id=${employeeId} AND ativo LIMIT 1`; return u?.id ?? null; }

// ------------------------------------------------------------------ histórico funcional
/** Fato passado (antes do sistema, ou esquecido na edição): RH e Direção lançam à mão, com data e descrição. A ficha não muda. */
export async function registrarMovManual(fd: FormData) {
  const s = await requireSession(); const employeeId = Number(fd.get("employeeId")); const b = `/colaboradores/${employeeId}`;
  try {
    assert(can.editar(s), "Só RH e Direção lançam movimentações."); const e = await ficha(employeeId);
    const tipo = str(fd, "tipo"); if (!MOV_MANUAIS.includes(tipo)) throw new Error("Escolha o tipo da movimentação.");
    const data = str(fd, "data"); if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error("Informe a data.");
    if (data < e.admissao) throw new Error("A data não pode ser anterior à admissão."); if (data > hoje()) throw new Error("Movimentação futura: registre quando acontecer (edite a ficha na data).");
    const descricao = str(fd, "descricao"); if (descricao.length < 5) throw new Error("Descreva a movimentação (de onde para onde).");
    const [r] = await sql<{ id: number }[]>`INSERT INTO employee_moves (employee_id, data, tipo, motivo, para, obs, origem, user_id, user_nome) VALUES (${employeeId}, ${data}, ${tipo}, ${strOrNull(fd, "motivo")}, ${JSON.stringify({ descricao })}::jsonb, ${strOrNull(fd, "obs")}, 'MANUAL', ${s.id}, ${s.nome}) RETURNING id`;
    await audit(s, "lançar movimentação", "employee_moves", r.id, null, { employeeId, tipo, data });
  } catch (e) { redirect(go(b, "erro", msgErro(e), "#historico")); }
  redirect(go(b, "ok", "Movimentação registrada no histórico funcional.", "#historico"));
}
export async function excluirMov(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const employeeId = Number(fd.get("employeeId")); const b = `/colaboradores/${employeeId}`;
  try {
    assert(can.editar(s)); const [m] = await sql<{ id: number; tipo: string; origem: string; data: string; employee_id: number }[]>`SELECT id, tipo, origem, data::text, employee_id FROM employee_moves WHERE id=${id} AND employee_id=${employeeId}`;
    if (!m) throw new Error("Movimentação não encontrada."); if (["ADMISSAO", "DESLIGAMENTO"].includes(m.tipo) && m.origem !== "MANUAL") throw new Error("Admissão e desligamento acompanham a ficha (corrija a data na ficha).");
    const motivo = str(fd, "motivo"); if (motivo.length < 5) throw new Error("Diga por que a movimentação sai do histórico.");
    await sql`DELETE FROM employee_moves WHERE id=${id}`; await audit(s, "excluir movimentação", "employee_moves", id, m, { motivo });
  } catch (e) { redirect(go(b, "erro", msgErro(e), "#historico")); }
  redirect(go(b, "ok", "Movimentação excluída (fica na auditoria).", "#historico"));
}

// ------------------------------------------------------------------ formação e qualificações
/** RH/Direção registram já validada; o próprio colaborador propõe (fica “aguardando validação” do RH). */
export async function salvarQualificacao(fd: FormData) {
  const s = await requireSession(); const employeeId = Number(fd.get("employeeId")); const b = caminhoSeguro(str(fd, "voltar"), `/colaboradores/${employeeId}`);
  try {
    const proprio = s.employeeId === employeeId; assert(can.editar(s) || proprio, "Sem permissão para esta ficha."); await ficha(employeeId);
    const tipo = str(fd, "tipo"); if (!QUALIF_TIPO[tipo]) throw new Error("Escolha o tipo de formação."); const curso = str(fd, "curso"); if (!curso) throw new Error("Informe o curso (ex.: Pedagogia, Letras — Inglês, Excel avançado).");
    const emAndamento = str(fd, "emAndamento") === "1"; const conclusao = strOrNull(fd, "conclusao"); if (conclusao && conclusao > hoje() && !emAndamento) throw new Error("Conclusão no futuro: marque “em andamento”.");
    const status = can.editar(s) ? "VALIDADA" : "PENDENTE";
    const [r] = await sql<{ id: number }[]>`INSERT INTO employee_qualifications (employee_id, tipo, curso, instituicao, area, conclusao, em_andamento, carga_horas, registro, status, validado_por, validado_em, criado_por) VALUES (${employeeId}, ${tipo}, ${curso}, ${strOrNull(fd, "instituicao")}, ${strOrNull(fd, "area")}, ${conclusao}, ${emAndamento}, ${num(fd, "cargaHoras")}, ${strOrNull(fd, "registro")}, ${status}, ${status === "VALIDADA" ? s.id : null}, ${status === "VALIDADA" ? sql`now()` : sql`NULL`}, ${s.id}) RETURNING id`;
    await audit(s, "registrar formação", "employee_qualifications", r.id, null, { employeeId, tipo, curso, status });
    if (status === "PENDENTE") { const rh = await sql<{ id: number }[]>`SELECT id FROM users WHERE ativo AND role IN ('RH','DIRECAO')`; await notificar(rh.map(x => x.id), "Formação para validar", "1 formação informada pelo colaborador aguarda validação.", `/colaboradores/${employeeId}#formacao`, "ACAO"); }
  } catch (e) { redirect(go(b.split("#")[0], "erro", msgErro(e), "#formacao")); }
  redirect(go(b.split("#")[0], "ok", can.editar(s) ? "Formação registrada." : "Formação enviada — o RH valida com o comprovante.", "#formacao"));
}
export async function validarQualificacao(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const employeeId = Number(fd.get("employeeId")); const b = `/colaboradores/${employeeId}`;
  try {
    assert(can.editar(s), "Só RH e Direção validam formação."); const decisao = str(fd, "decisao"); if (!["VALIDADA", "RECUSADA"].includes(decisao)) throw new Error("Decisão inválida.");
    const motivo = strOrNull(fd, "motivo"); if (decisao === "RECUSADA" && (!motivo || motivo.length < 5)) throw new Error("Diga o motivo (ex.: falta o comprovante).");
    const r = await sql`UPDATE employee_qualifications SET status=${decisao}, motivo_recusa=${motivo}, validado_por=${s.id}, validado_em=now() WHERE id=${id} AND employee_id=${employeeId} AND status='PENDENTE'`; if (!r.count) throw new Error("Formação já decidida.");
    await audit(s, decisao === "VALIDADA" ? "validar formação" : "recusar formação", "employee_qualifications", id, null, { decisao, motivo });
    const uid = await loginDa(employeeId); if (uid) await notificar([uid], decisao === "VALIDADA" ? "Formação validada" : "Formação não validada", decisao === "VALIDADA" ? "Sua formação foi validada pelo RH." : `Motivo: ${motivo}`, "/eu#formacao", "INFO");
  } catch (e) { redirect(go(b, "erro", msgErro(e), "#formacao")); }
  redirect(go(b, "ok", "Decisão registrada.", "#formacao"));
}
export async function excluirQualificacao(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const employeeId = Number(fd.get("employeeId")); const b = caminhoSeguro(str(fd, "voltar"), `/colaboradores/${employeeId}`);
  try {
    const [q] = await sql<{ status: string; employee_id: number }[]>`SELECT status, employee_id FROM employee_qualifications WHERE id=${id}`; if (!q || q.employee_id !== employeeId) throw new Error("Formação não encontrada.");
    assert(can.editar(s) || (s.employeeId === employeeId && q.status !== "VALIDADA"), "A formação validada só sai pelo RH.");
    await sql`DELETE FROM employee_qualifications WHERE id=${id}`; await audit(s, "excluir formação", "employee_qualifications", id, q, null);
  } catch (e) { redirect(go(b.split("#")[0], "erro", msgErro(e), "#formacao")); }
  redirect(go(b.split("#")[0], "ok", "Formação excluída.", "#formacao"));
}

// ------------------------------------------------------------------ itens sob responsabilidade
export async function entregarItem(fd: FormData) {
  const s = await requireSession(); const employeeId = Number(fd.get("employeeId")); const b = caminhoSeguro(str(fd, "voltar"), `/colaboradores/${employeeId}`).split("#")[0];
  try {
    assert(podeItens(s), "Sem permissão para registrar itens."); const e = await ficha(employeeId); assertScope(s, e.unit_id); if (e.situacao === "DESLIGADO") throw new Error("Colaborador desligado.");
    const tipo = str(fd, "tipo"); if (!ITEM_TIPO[tipo]) throw new Error("Escolha o tipo do item."); const descricao = str(fd, "descricao") || ITEM_TIPO[tipo];
    const entregue = str(fd, "entregueEm") || hoje(); const assetId = int(fd, "assetId");
    if (assetId) { const [a] = await sql<{ unit_id: number; nome: string }[]>`SELECT unit_id, nome FROM assets WHERE id=${assetId}`; if (!a) throw new Error("Patrimônio não encontrado."); assertScope(s, a.unit_id);
      const [com] = await sql<{ nome: string }[]>`SELECT e.nome FROM employee_items i JOIN employees e ON e.id=i.employee_id WHERE i.asset_id=${assetId} AND i.status='COM_COLABORADOR'`; if (com) throw new Error(`Este patrimônio já está com ${com.nome}. Registre a devolução antes.`); }
    const [r] = await sql<{ id: number }[]>`INSERT INTO employee_items (employee_id, tipo, descricao, identificacao, asset_id, valor, entregue_em, entregue_por, devolver_ate, obs) VALUES (${employeeId}, ${tipo}, ${descricao}, ${strOrNull(fd, "identificacao")}, ${assetId}, ${num(fd, "valor")}, ${entregue}, ${s.id}, ${strOrNull(fd, "devolverAte")}, ${strOrNull(fd, "obs")}) RETURNING id`;
    await audit(s, "entregar item", "employee_items", r.id, null, { employeeId, tipo, descricao, assetId });
    const uid = await loginDa(employeeId); if (uid) await notificar([uid], "Item sob sua responsabilidade", "1 item foi registrado com você — dê ciência no Meu espaço.", "/eu#itens", "ACAO", `item:${r.id}`);
  } catch (e) { redirect(go(b, "erro", msgErro(e), "#itens")); }
  redirect(go(b, "ok", "Item registrado. A pessoa dá ciência pelo Meu espaço.", "#itens"));
}
export async function devolverItem(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const employeeId = Number(fd.get("employeeId")); const b = caminhoSeguro(str(fd, "voltar"), `/colaboradores/${employeeId}`);
  try {
    assert(podeItens(s), "Sem permissão para registrar devoluções."); const e = await ficha(employeeId); assertScope(s, e.unit_id);
    const status = str(fd, "status") || "DEVOLVIDO"; if (!["DEVOLVIDO", "EXTRAVIADO", "BAIXADO"].includes(status)) throw new Error("Situação inválida.");
    const data = str(fd, "data") || hoje(); const obs = strOrNull(fd, "obs"); if (status !== "DEVOLVIDO" && (!obs || obs.length < 5)) throw new Error("Explique o extravio ou a baixa (o que aconteceu e o que foi combinado).");
    const r = await sql`UPDATE employee_items SET status=${status}, devolvido_em=${data}, recebido_por=${s.id}, condicao=${strOrNull(fd, "condicao")}, obs=coalesce(${obs}, obs) WHERE id=${id} AND employee_id=${employeeId} AND status='COM_COLABORADOR'`;
    if (!r.count) throw new Error("Item já devolvido ou baixado.");
    await audit(s, status === "DEVOLVIDO" ? "receber devolução" : status === "EXTRAVIADO" ? "registrar extravio" : "baixar item", "employee_items", id, null, { status, data });
  } catch (e) { redirect(go(b.split("#")[0], "erro", msgErro(e), "#itens")); }
  redirect(go(b.split("#")[0], "ok", "Devolução registrada.", "#itens"));
}
/** O próprio colaborador dá ciência do item (termo de responsabilidade). */
export async function cienciaItem(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id"));
  try {
    assert(!!s.employeeId, "Ciência é do próprio colaborador.");
    const r = await sql`UPDATE employee_items SET ciencia_em=now() WHERE id=${id} AND employee_id=${s.employeeId} AND ciencia_em IS NULL AND status='COM_COLABORADOR'`; if (!r.count) throw new Error("Item não encontrado ou já com ciência.");
    await audit(s, "ciência de item", "employee_items", id, null, { ciencia: true });
  } catch (e) { redirect(go("/eu", "erro", msgErro(e), "#itens")); }
  redirect(go("/eu", "ok", "Ciência registrada. Obrigado!", "#itens"));
}
export async function excluirItem(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const employeeId = Number(fd.get("employeeId")); const b = `/colaboradores/${employeeId}`;
  try {
    assert(can.editar(s), "Só RH e Direção excluem um registro de item (lançamento errado)."); const [i] = await sql`SELECT * FROM employee_items WHERE id=${id} AND employee_id=${employeeId}`; if (!i) throw new Error("Item não encontrado.");
    await sql`DELETE FROM employee_items WHERE id=${id}`; await audit(s, "excluir item", "employee_items", id, i, null);
  } catch (e) { redirect(go(b, "erro", msgErro(e), "#itens")); }
  redirect(go(b, "ok", "Registro excluído (fica na auditoria).", "#itens"));
}
