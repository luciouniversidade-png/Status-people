import { veTela } from "@/lib/acesso";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { responder } from "@/lib/pergunte";
import { excedeu, registrarEnvio } from "@/lib/limite";
import { audit } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Pergunte ao Status (T-099): resposta determinística com número, fonte, período e link — no escopo do perfil. */
export async function GET(req: Request) {
  const s = await getSession(); if (!s) return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  const chave = `pergunta:${s.id}`; if (excedeu(chave, 30, 60_000)) return NextResponse.json({ erro: "Muitas perguntas seguidas. Aguarde um instante." }, { status: 429 });
  registrarEnvio(chave, 60_000);
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 200);
  if (q.trim().length < 3) return NextResponse.json({ erro: "Escreva a pergunta." }, { status: 400 });
  if (!veTela(s, "/executivo")) return NextResponse.json({ ok: false, recusa: "A base de indicadores (Painel Executivo) não faz parte do acesso do seu cargo.", sugestoes: [], interpretacao: null }, { headers: { "Cache-Control": "no-store" } });
  const r = await responder(s, q).catch(e => ({ ok: false as const, recusa: e instanceof Error ? `Não consegui responder agora (${e.message}).` : "Não consegui responder agora.", sugestoes: [], interpretacao: null }));
  await audit(s, "pergunte ao status", "kpi_series", null, null, { pergunta: q, ok: r.ok, kpi: r.interpretacao?.kpi ?? null }).catch(() => null);
  return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
}
