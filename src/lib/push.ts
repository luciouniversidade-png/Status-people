import webpush from "web-push";
import { cookies } from "next/headers";
import { sql } from "@/db";

type Vapid = { publicKey: string; privateKey: string; subject: string };
let cache: Vapid | null = null;
/**
 * Chaves VAPID do servidor de notificações: VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY no ambiente; na falta, são geradas uma vez e guardadas no banco
 * (nunca aparecem em tela nem em exportação). Trocar as chaves invalida as assinaturas: cada aparelho precisa ativar de novo.
 */
export async function vapid(): Promise<Vapid> {
  if (cache) return cache;
  // Contato exigido pelos serviços de push (a Apple recusa endereço mal formado): VAPID_SUBJECT, ou o e-mail de MAIL_FROM, ou o endereço https do sistema
  const mail = (process.env.MAIL_FROM ?? "").match(/<([^>]+)>/)?.[1] ?? (process.env.MAIL_FROM ?? "").trim();
  const subject = process.env.VAPID_SUBJECT || (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(mail) ? `mailto:${mail}` : (process.env.APP_URL ?? "").startsWith("https://") ? process.env.APP_URL! : "mailto:contato@colegiostatus.com.br");
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return (cache = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, subject });
  const [r] = await sql<{ value: { publicKey: string; privateKey: string } }[]>`SELECT value FROM settings WHERE key='push_vapid'`;
  if (r?.value?.publicKey) return (cache = { ...r.value, subject });
  const k = webpush.generateVAPIDKeys();
  await sql`INSERT INTO settings (key, value) VALUES ('push_vapid', ${JSON.stringify(k)}::jsonb) ON CONFLICT (key) DO NOTHING`;
  const [x] = await sql<{ value: { publicKey: string; privateKey: string } }[]>`SELECT value FROM settings WHERE key='push_vapid'`;
  return (cache = { ...x.value, subject });
}

/** Cookie (só do servidor) com o endereço de push deste aparelho: ao sair do sistema, o aparelho para de receber os avisos de quem saiu. */
export const PUSH_COOKIE = "rh_push";
/** Serviços de push dos navegadores (Chrome/Android/Edge/Samsung → Google; Firefox → Mozilla; Edge → Windows; Safari/iPhone → Apple). */
const HOSTS_PUSH = ["fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com", "notify.windows.com", "push.apple.com"];
/** O servidor só envia para serviços de push conhecidos (nunca para um endereço qualquer). PUSH_HOSTS_EXTRA (separados por vírgula) só para testes. */
export function enderecoPushValido(endpoint: string) {
  let u: URL; try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== "https:" || endpoint.length > 1000 || u.username || u.password) return false;
  const extra = (process.env.PUSH_HOSTS_EXTRA ?? "").split(",").map(h => h.trim().toLowerCase()).filter(Boolean);
  return [...HOSTS_PUSH, ...extra].some(h => u.hostname === h || u.hostname.endsWith("." + h));
}
const B64 = /^[A-Za-z0-9_\-]+={0,2}$/;
/** Assinatura recebida do navegador (PushSubscription.toJSON): endereço de serviço conhecido e chaves no formato esperado. */
export function lerAssinatura(sub: unknown): { endpoint: string; p256dh: string; auth: string } | null {
  const o = (sub ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof o.endpoint === "string" ? o.endpoint : ""; const p256dh = typeof o.keys?.p256dh === "string" ? o.keys.p256dh : ""; const auth = typeof o.keys?.auth === "string" ? o.keys.auth : "";
  if (!enderecoPushValido(endpoint) || !B64.test(p256dh) || p256dh.length < 60 || p256dh.length > 120 || !B64.test(auth) || auth.length < 16 || auth.length > 40) return null;
  return { endpoint, p256dh, auth };
}
/** Grava (ou transfere para este usuário) a assinatura do aparelho e marca o aparelho no cookie. Retorna se é nova e a preferência atual. */
export async function gravarAssinatura(userId: number, a: { endpoint: string; p256dh: string; auth: string }, userAgent: string, tiposDe?: string | null) {
  const [r] = await sql<{ novo: boolean; tipos: string }[]>`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, tipos) VALUES (${userId}, ${a.endpoint}, ${a.p256dh}, ${a.auth}, ${userAgent.slice(0, 300)}, ${tiposDe ?? "ACAO_ALERTA"})
    ON CONFLICT (endpoint) DO UPDATE SET user_id=EXCLUDED.user_id, p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth, user_agent=EXCLUDED.user_agent, falhas=0,
      tipos=CASE WHEN push_subscriptions.user_id=EXCLUDED.user_id THEN push_subscriptions.tipos ELSE EXCLUDED.tipos END
    RETURNING (xmax = 0) AS novo, tipos`;
  try { (await cookies()).set(PUSH_COOKIE, a.endpoint, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 400 * 24 * 3600 }); } catch { /* fora de requisição */ }
  return r;
}
/** Ao sair: este aparelho deixa de receber os avisos do usuário (a permissão do navegador continua; ao entrar de novo, basta ativar). */
export async function esquecerAparelho(userId: number | null) {
  try {
    const jar = await cookies(); const ep = jar.get(PUSH_COOKIE)?.value; if (!ep) return;
    await (userId === null ? sql`DELETE FROM push_subscriptions WHERE endpoint=${ep}` : sql`DELETE FROM push_subscriptions WHERE endpoint=${ep} AND user_id=${userId}`);
  } catch { /* nunca impede a saída */ }
}

export type Payload = { titulo: string; texto?: string | null; link?: string | null; tipo?: string; tag?: string };
/**
 * Envia a notificação aos aparelhos dos usuários ativos. Preferência por aparelho: TODOS ou só ACAO/ALERTA (padrão).
 * Assinatura expirada (404/410) é apagada; outras falhas contam e, depois de 5 seguidas, a assinatura sai. Nunca derruba quem chamou.
 */
export async function enviarPush(userIds: number[], p: Payload): Promise<{ enviados: number; falhas: number }> {
  const ids = [...new Set(userIds.filter(Boolean))]; if (!ids.length) return { enviados: 0, falhas: 0 };
  let subs: { id: number; endpoint: string; p256dh: string; auth: string; tipos: string }[] = [];
  try { subs = await sql`SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth, ps.tipos FROM push_subscriptions ps JOIN users u ON u.id=ps.user_id AND u.ativo WHERE ps.user_id = ANY(${ids})`; } catch { return { enviados: 0, falhas: 0 }; }
  subs = subs.filter(s => (s.tipos === "TODOS" || (p.tipo ?? "INFO") !== "INFO") && enderecoPushValido(s.endpoint)); if (!subs.length) return { enviados: 0, falhas: 0 };
  const v = await vapid(); const link = p.link && p.link.startsWith("/") && !p.link.startsWith("//") ? p.link : "/notificacoes";
  const corpo = JSON.stringify({ titulo: p.titulo.slice(0, 120), texto: (p.texto ?? "").slice(0, 240), link, tipo: p.tipo ?? "INFO", tag: p.tag });
  let enviados = 0, falhas = 0;
  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, corpo, { vapidDetails: v, TTL: 60 * 60 * 24, urgency: p.tipo === "ALERTA" ? "high" : "normal", timeout: 5000 });
      enviados++; await sql`UPDATE push_subscriptions SET falhas=0, ultimo_envio=now() WHERE id=${s.id}`;
    } catch (e) {
      falhas++; const st = (e as { statusCode?: number }).statusCode;
      try {
        if (st === 404 || st === 410) await sql`DELETE FROM push_subscriptions WHERE id=${s.id}`;
        else { await sql`UPDATE push_subscriptions SET falhas=falhas+1 WHERE id=${s.id}`; await sql`DELETE FROM push_subscriptions WHERE id=${s.id} AND falhas >= 5`; }
      } catch { /* segue */ }
    }
  }));
  return { enviados, falhas };
}
