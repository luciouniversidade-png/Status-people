import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { buscar } from "@/lib/busca";
import { excedeu, registrarEnvio } from "@/lib/limite";

export const dynamic = "force-dynamic";

/** Busca global (Ctrl+K): exige sessão; resultados no escopo do perfil. Até 60 buscas por minuto por pessoa. */
export async function GET(req: Request) {
  const s = await getSession(); if (!s) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  const chave = `busca:${s.id}`; if (excedeu(chave, 60, 60_000)) return NextResponse.json({ erro: "Muitas buscas seguidas. Aguarde um instante." }, { status: 429 });
  registrarEnvio(chave, 60_000);
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const resultados = await buscar(s, q).catch(() => []);
  return NextResponse.json({ q, resultados }, { headers: { "Cache-Control": "no-store" } });
}
