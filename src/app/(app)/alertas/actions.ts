"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert } from "@/lib/auth";
import { audit, str, int, caminhoSeguro, hoje, addDays } from "@/lib/utils";
import { varrerAlertas, escopoDo, modulosDoPerfil, MODULOS_SENSIVEIS } from "@/lib/alertas";
import { notificar } from "@/lib/comunicacao";

const go = (b: string, k: "ok" | "erro", msg: string) => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}`;
const erro = (e: unknown) => e instanceof Error ? e.message : "Erro inesperado.";

/** Quem mexe num alerta: Direção e RH em qualquer um; os demais, no que é deles ou do próprio domínio (nunca Leitura). */
async function carregar(id: number, s: Awaited<ReturnType<typeof requireSession>>) {
  const [a] = await sql<{ id: number; escopo: number; modulo: string; titulo: string; status: string; dono_user_id: number | null }[]>`SELECT id, escopo, modulo, titulo, status, dono_user_id FROM alerts WHERE id=${id}`;
  assert(!!a, "Alerta não encontrado."); assert(s.role !== "LEITURA", "Perfil somente leitura.");
  const mods = modulosDoPerfil(s.role); const sens = ["DIRECAO", "RH"].includes(s.role);
  assert(sens || !MODULOS_SENSIVEIS.includes(a.modulo), "Alerta restrito à Direção e ao RH.");
  assert(["DIRECAO", "RH"].includes(s.role) || a.dono_user_id === s.id || (mods !== null && mods.includes(a.modulo)) || (s.role === "DIRETOR_UNIDADE" && a.escopo === escopoDo(s)), "Este alerta é de outro responsável.");
  return a;
}
const evento = (id: number, s: { id: number; nome: string }, tipo: string, texto: string) => sql`INSERT INTO alert_events (alert_id, user_id, user_nome, tipo, texto) VALUES (${id}, ${s.id}, ${s.nome}, ${tipo}, ${texto})`;

export async function tratarAlerta(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const voltar = caminhoSeguro(str(fd, "voltar"), "/alertas");
  try { const a = await carregar(id, s); const desfecho = str(fd, "desfecho"); assert(desfecho.length >= 10, "Tratar exige o desfecho: o que foi feito (mínimo 10 caracteres).");
    await sql`UPDATE alerts SET status='TRATADO', desfecho=${desfecho}, tratado_em=now(), tratado_por=${s.id}, updated_at=now() WHERE id=${id}`; await evento(id, s, "TRATADO", desfecho); await audit(s, "tratar alerta", "alerts", id, { status: a.status }, { status: "TRATADO" }); }
  catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Alerta tratado. Se a condição persistir, ele reabre sozinho."));
}
export async function delegarAlerta(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const voltar = caminhoSeguro(str(fd, "voltar"), "/alertas");
  try { const a = await carregar(id, s); const dono = int(fd, "donoId") ?? 0; const [u] = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM users WHERE id=${dono} AND ativo`; assert(!!u, "Escolha um usuário ativo."); assert(u.id !== a.dono_user_id, "Este já é o dono.");
    await sql`UPDATE alerts SET dono_user_id=${u.id}, defeito=NULL, updated_at=now() WHERE id=${id}`; await evento(id, s, "DELEGADO", `Delegado a ${u.nome}${str(fd, "obs") ? `: ${str(fd, "obs")}` : ""}`);
    await notificar([u.id], "Alerta delegado a você", a.titulo, `/alertas?id=${id}`, "ACAO"); await audit(s, "delegar alerta", "alerts", id, { dono: a.dono_user_id }, { dono: u.id }); }
  catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Alerta delegado e o novo dono foi avisado."));
}
export async function silenciarAlerta(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const voltar = caminhoSeguro(str(fd, "voltar"), "/alertas");
  try { const a = await carregar(id, s); const ate = str(fd, "ate"); const motivo = str(fd, "motivo"); assert(/^\d{4}-\d{2}-\d{2}$/.test(ate) && ate > hoje() && ate <= addDays(hoje(), 90), "Silenciar exige validade (até 90 dias)."); assert(motivo.length >= 10, "Silenciar exige motivo (mínimo 10 caracteres).");
    await sql`UPDATE alerts SET status='SILENCIADO', silenciado_ate=${ate}, motivo_silencio=${motivo}, updated_at=now() WHERE id=${id}`; await evento(id, s, "SILENCIADO", `Até ${ate.split("-").reverse().join("/")}: ${motivo}`); await audit(s, "silenciar alerta", "alerts", id, { status: a.status }, { status: "SILENCIADO", ate }); }
  catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Alerta silenciado até a data — depois, se a condição persistir, ele volta."));
}
export async function reabrirAlerta(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const voltar = caminhoSeguro(str(fd, "voltar"), "/alertas");
  try { const a = await carregar(id, s); assert(["TRATADO", "SILENCIADO"].includes(a.status), "Só reabre o que foi tratado ou silenciado."); await sql`UPDATE alerts SET status='ABERTO', updated_at=now() WHERE id=${id}`; await evento(id, s, "REABERTO", "Reaberto manualmente."); }
  catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Alerta reaberto."));
}
export async function varrerAgora(fd: FormData) {
  const s = await requireSession(); const voltar = caminhoSeguro(str(fd, "voltar"), "/alertas"); let msg = "";
  try { assert(s.role !== "LEITURA" && s.role !== "COLABORADOR", "Sem permissão."); const r = await varrerAlertas(escopoDo(s), { forcar: true }); msg = r.varreu ? `Varredura feita: ${r.novos} novo(s), ${r.reabertos} reaberto(s), ${r.resolvidos} resolvido(s).` : "Varredura recente."; }
  catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", msg));
}
