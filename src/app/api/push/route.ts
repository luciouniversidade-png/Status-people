import { NextResponse } from "next/server";
import { sql } from "@/db";
import { getSession } from "@/lib/auth";
import { vapid, lerAssinatura, gravarAssinatura } from "@/lib/push";

export const dynamic = "force-dynamic";
const mesmaOrigem = (req: Request) => { const o = req.headers.get("origin"); if (!o) return true; try { return new URL(o).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host")); } catch { return false; } };

/** Chave pública do servidor de notificações (o service worker usa ao renovar a assinatura). */
export async function GET() {
  const s = await getSession(); if (!s) return NextResponse.json({ erro: "sessão" }, { status: 401 });
  return NextResponse.json({ publicKey: (await vapid()).publicKey }, { headers: { "cache-control": "no-store" } });
}

/**
 * O navegador trocou a assinatura deste aparelho (evento pushsubscriptionchange no service worker): grava a nova no lugar da antiga.
 * Com sessão, vale o usuário logado; sem sessão, a assinatura antiga (endereço secreto que só o aparelho e o servidor conhecem) prova de quem é.
 */
export async function POST(req: Request) {
  if (!mesmaOrigem(req) || !(req.headers.get("content-type") ?? "").includes("application/json")) return NextResponse.json({ erro: "origem" }, { status: 403 });
  let body: { antigo?: unknown; sub?: unknown }; try { body = await req.json(); } catch { return NextResponse.json({ erro: "json" }, { status: 400 }); }
  const nova = lerAssinatura(body.sub); if (!nova) return NextResponse.json({ erro: "assinatura" }, { status: 400 });
  const antigo = typeof body.antigo === "string" ? body.antigo.slice(0, 1000) : null;
  const [ant] = antigo ? await sql<{ user_id: number; tipos: string }[]>`SELECT user_id, tipos FROM push_subscriptions WHERE endpoint=${antigo}` : [];
  const s = await getSession(); const userId = s?.id ?? ant?.user_id; if (!userId) return NextResponse.json({ erro: "sessão" }, { status: 401 });
  if (antigo && antigo !== nova.endpoint) await sql`DELETE FROM push_subscriptions WHERE endpoint=${antigo} AND user_id=${userId}`;
  await gravarAssinatura(userId, nova, req.headers.get("user-agent") ?? "", ant && ant.user_id === userId ? ant.tipos : null);
  return NextResponse.json({ ok: true });
}
