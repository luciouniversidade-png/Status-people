import { NextResponse } from "next/server";
import { runMigrations, seedBase } from "@/db/setup";
import { getSession } from "@/lib/auth";
import { sql } from "@/db";

// Instalação: /api/setup?token=SEU_SETUP_TOKEN.
// Primeira execução (sem usuários): só o token. Depois disso: token + sessão de Direção/RH (a rota deixa de ser pública).
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!process.env.SETUP_TOKEN || process.env.SETUP_TOKEN.length < 16 || token !== process.env.SETUP_TOKEN) return NextResponse.json({ erro: "Token inválido." }, { status: 403 });
  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) return NextResponse.json({ erro: "AUTH_SECRET ausente ou curto (mínimo 32 caracteres)." }, { status: 500 });
  try {
    let instalado = false;
    try { const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM users`; instalado = n > 0; } catch { instalado = false; }
    if (instalado) {
      const s = await getSession();
      if (!s || !["DIRECAO", "RH"].includes(s.role)) return NextResponse.json({ erro: "Sistema já instalado: entre como Direção ou RH e abra esta URL de novo para aplicar atualizações." }, { status: 403 });
    } else if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 10) {
      return NextResponse.json({ erro: "ADMIN_PASSWORD ausente ou curta (mínimo 10 caracteres). Defina a variável antes da instalação." }, { status: 500 });
    }
    await runMigrations();
    const log = await seedBase(process.env.ADMIN_PASSWORD ?? "");
    return NextResponse.json({ ok: true, mensagens: [...log, instalado ? "Atualização aplicada." : "Instalação concluída. Acesse /login."] });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
