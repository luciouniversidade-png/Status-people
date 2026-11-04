// v31 · arquivo de agenda (.ics) de uma 1:1 — só para as duas pessoas da conversa. Nenhum serviço externo: o arquivo é baixado e aberto no calendário.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { umAUm, participa, icsUmAUm } from "@/lib/conversas";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession(); if (!s) return NextResponse.json({ erro: "Entre no sistema." }, { status: 401 });
  const { id } = await params; const o = await umAUm(Number(id));
  if (!o || !participa(s, o)) return NextResponse.json({ erro: "1:1 não encontrada." }, { status: 404 });
  const base = new URL(req.url).origin;
  return new NextResponse(icsUmAUm(o, base), { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="1a1-${o.data}.ics"`, "Cache-Control": "no-store" } });
}
