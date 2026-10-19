"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession } from "@/lib/auth";
import { audit, str, caminhoSeguro } from "@/lib/utils";
import { COOKIE_CTX, periodoValido } from "@/lib/contexto";

/** Troca o contexto global (T-100): aplica na sessão, salva como padrão do usuário ou volta ao padrão do papel. */
export async function trocarContexto(fd: FormData) {
  const s = await requireSession();
  const acao = str(fd, "acao") || "aplicar";
  const n = (k: string) => { const v = Number(str(fd, k)); return Number.isFinite(v) && v > 0 ? Math.round(v) : null; };
  const p = str(fd, "p"); const bruto = { e: n("e"), u: n("u"), p: periodoValido(p) ? p : null };
  // o destino volta sem os parâmetros ctx_* (que teriam prioridade sobre a escolha recém-feita)
  let voltar = caminhoSeguro(str(fd, "voltar"), "/");
  try { const u = new URL(voltar, "http://x"); ["ctx_e", "ctx_u", "ctx_p", "ok", "erro"].forEach(k => u.searchParams.delete(k)); voltar = u.pathname + (u.searchParams.toString() ? `?${u.searchParams}` : ""); } catch { voltar = "/"; }
  const jar = await cookies();
  if (acao === "padrao") {
    jar.delete(COOKIE_CTX);
    await sql`UPDATE user_prefs SET contexto=NULL, updated_at=now() WHERE user_id=${s.id}`;
    await audit(s, "contexto: padrão do papel", "user_prefs", s.id, null, null);
  } else {
    jar.set(COOKIE_CTX, encodeURIComponent(JSON.stringify(bruto)), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 365 * 86400 });
    if (acao === "salvar") {
      const padrao = { e: bruto.e, u: bruto.u };
      await sql`INSERT INTO user_prefs (user_id, contexto) VALUES (${s.id}, ${JSON.stringify(padrao)}::jsonb) ON CONFLICT (user_id) DO UPDATE SET contexto=EXCLUDED.contexto, updated_at=now()`;
      await audit(s, "contexto salvo como padrão", "user_prefs", s.id, null, padrao);
    }
  }
  redirect(voltar);
}
