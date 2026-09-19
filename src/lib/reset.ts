import { randomBytes, createHash } from "crypto";
import bcrypt from "bcryptjs";
import { sql } from "@/db";
import { enviarEmail } from "./notify";

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
export function senhaTemporaria() { const a = "ABCDEFGHJKLMNPQRSTUVWXYZ", n = "23456789"; const pick = (s: string) => s[randomBytes(1)[0] % s.length]; return `${pick(a)}${pick(a)}${pick(a)}${pick(a)}-${pick(n)}${pick(n)}${pick(n)}${pick(n)}`; }

/** Pedido "esqueci minha senha": com e-mail configurado, envia link de 1 hora; sem e-mail, deixa o pedido visível ao RH. Resposta sempre neutra. */
export async function pedirRedefinicao(email: string, appUrl: string) {
  const e = email.trim().toLowerCase(); const [u] = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM users WHERE email=${e} AND ativo`;
  if (!u) return { existe: false, enviado: false };
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM password_resets WHERE user_id=${u.id} AND created_at > now() - interval '15 minutes'`; if (n >= 3) return { existe: true, enviado: false }; // anti-abuso
  const podeEmail = !!process.env.RESEND_API_KEY && !!process.env.MAIL_FROM && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
  if (podeEmail) {
    const token = randomBytes(24).toString("hex");
    await sql`INSERT INTO password_resets (user_id, token_hash, expira_em, via_email) VALUES (${u.id}, ${hashToken(token)}, now() + interval '1 hour', true)`;
    const ok = await enviarEmail([e], "STATUS ONE — redefinição de senha", `Olá, ${u.nome}.\n\nPara criar uma nova senha, abra o link abaixo em até 1 hora:\n${appUrl}/login/redefinir?token=${token}\n\nSe você não pediu isso, ignore esta mensagem; sua senha continua a mesma.`);
    return { existe: true, enviado: ok };
  }
  await sql`INSERT INTO password_resets (user_id, expira_em, via_email) VALUES (${u.id}, now() + interval '7 days', false)`;
  return { existe: true, enviado: false };
}

export async function redefinirPorToken(token: string, novaSenha: string) {
  const [r] = await sql<{ id: number; user_id: number }[]>`SELECT id, user_id FROM password_resets WHERE token_hash=${hashToken(token)} AND usado_em IS NULL AND expira_em > now()`;
  if (!r) return null;
  await sql`UPDATE users SET senha_hash=${await bcrypt.hash(novaSenha, 10)}, trocar_senha=false WHERE id=${r.user_id}`;
  await sql`UPDATE password_resets SET usado_em=now() WHERE id=${r.id}`; await sql`UPDATE password_resets SET usado_em=now() WHERE user_id=${r.user_id} AND usado_em IS NULL`;
  return r.user_id;
}

/** RH gera senha temporária: o usuário entra e é obrigado a trocar. */
export async function gerarSenhaTemporaria(userId: number, atendidoPor: number) {
  const temp = senhaTemporaria();
  await sql`UPDATE users SET senha_hash=${await bcrypt.hash(temp, 10)}, trocar_senha=true WHERE id=${userId}`;
  await sql`UPDATE password_resets SET usado_em=now(), atendido_por=${atendidoPor} WHERE user_id=${userId} AND usado_em IS NULL`;
  return temp;
}
