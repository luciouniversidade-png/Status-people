import { headers } from "next/headers";

/** Endereço público do sistema (APP_URL ou, na falta, o host da requisição) — usado nos links enviados às famílias. */
export async function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  const h = await headers(); const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"; const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
/** IP e navegador de quem enviou o formulário (evidência de aceite). */
export async function origemRequisicao() {
  const h = await headers();
  return { ip: (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null, userAgent: (h.get("user-agent") ?? "").slice(0, 300) || null };
}
