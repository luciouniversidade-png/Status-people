// Notificações por e-mail (opcional). Ativa quando RESEND_API_KEY e MAIL_FROM estão definidos; sem eles, não faz nada.
// Nunca interrompe o fluxo: falhas de envio são apenas registradas no log do servidor.
import { sql } from "@/db";

export async function enviarEmail(para: string[], assunto: string, texto: string) {
  const key = process.env.RESEND_API_KEY; const from = process.env.MAIL_FROM;
  const dest = para.filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  if (!key || !from || dest.length === 0) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: dest, subject: assunto, text: texto }) });
    if (!r.ok) console.error("[notify] falha ao enviar e-mail:", r.status, await r.text());
    return r.ok;
  } catch (e) { console.error("[notify] erro:", e); return false; }
}

/** E-mails dos usuários ativos com os perfis informados (limitados à unidade, quando dada). */
export async function emailsPorPerfil(roles: string[], unitId: number | null) {
  const rows = await sql<{ email: string }[]>`SELECT email FROM users WHERE ativo AND role = ANY(${roles}) AND (unit_id IS NULL OR ${unitId}::int IS NULL OR unit_id = ${unitId})`;
  return rows.map(r => r.email);
}

export async function emailDoUsuario(userId: number | null) {
  if (!userId) return [];
  const rows = await sql<{ email: string }[]>`SELECT email FROM users WHERE id=${userId} AND ativo`;
  return rows.map(r => r.email);
}
