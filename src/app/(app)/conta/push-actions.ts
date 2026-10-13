"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession } from "@/lib/auth";
import { audit, num } from "@/lib/utils";
import { enviarPush, lerAssinatura, gravarAssinatura, PUSH_COOKIE } from "@/lib/push";

/** Guarda a assinatura de push deste aparelho para o usuário logado (um aparelho = uma assinatura; reassinar atualiza; outro usuário no mesmo aparelho assume). */
export async function salvarAssinaturaPush(sub: unknown, userAgent: string) {
  const s = await requireSession();
  const a = lerAssinatura(sub); if (!a) return { ok: false as const, erro: "Assinatura inválida ou serviço de notificação não reconhecido." };
  const r = await gravarAssinatura(s.id, a, String(userAgent ?? ""));
  if (r?.novo) await audit(s, "ativar notificações no aparelho", "push_subscriptions", null, null, { aparelho: String(userAgent ?? "").slice(0, 80) });
  return { ok: true as const, tipos: r?.tipos ?? "ACAO_ALERTA" };
}
/** Este aparelho (endereço da assinatura do navegador) está ativo para o usuário logado? E com qual preferência. */
export async function estadoAssinaturaPush(endpoint: string) {
  const s = await requireSession();
  const [r] = await sql<{ tipos: string }[]>`SELECT tipos FROM push_subscriptions WHERE user_id=${s.id} AND endpoint=${String(endpoint ?? "")}`;
  return r ? { minha: true, tipos: r.tipos } : { minha: false, tipos: "ACAO_ALERTA" };
}
export async function removerAssinaturaPush(endpoint: string) {
  const s = await requireSession(); await sql`DELETE FROM push_subscriptions WHERE user_id=${s.id} AND endpoint=${String(endpoint ?? "")}`;
  try { (await cookies()).delete(PUSH_COOKIE); } catch { /* segue */ }
  return { ok: true };
}
export async function preferenciaPush(endpoint: string, tipos: string) {
  const s = await requireSession(); if (!["TODOS", "ACAO_ALERTA"].includes(tipos)) return { ok: false };
  const r = await sql`UPDATE push_subscriptions SET tipos=${tipos} WHERE user_id=${s.id} AND endpoint=${String(endpoint ?? "")}`; return { ok: r.count > 0 };
}
export async function testarPush() {
  const s = await requireSession();
  return enviarPush([s.id], { titulo: "STATUS ONE: teste", texto: "Se você está vendo isto, as notificações estão ativas neste aparelho.", link: "/conta", tipo: "ALERTA", tag: "teste" });
}
/** Remove um aparelho da lista (ex.: celular trocado ou perdido) — só os do próprio usuário. */
export async function removerAparelho(fd: FormData) {
  const s = await requireSession(); const id = num(fd, "id");
  const r = id ? await sql`DELETE FROM push_subscriptions WHERE id=${id} AND user_id=${s.id}` : { count: 0 };
  if (r.count) await audit(s, "remover aparelho das notificações", "push_subscriptions", id, null, null);
  redirect(`/conta?${r.count ? "ok=" + encodeURIComponent("Aparelho removido: ele não recebe mais os seus avisos.") : "erro=" + encodeURIComponent("Aparelho não encontrado.")}`);
}
