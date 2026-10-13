import { NextResponse } from "next/server";
import { rotinaDiaria } from "@/lib/comunicacao";
import { processarVencimentos } from "@/lib/matriculas";
import { escalarVencidos } from "@/lib/atendimento";
import { expirarExcecoes } from "@/lib/governanca";
import { alertasDesempenho } from "@/lib/desenvolvimento";
import { hoje } from "@/lib/utils";
import { rotinaGestao } from "@/lib/gestao-rotina";
import { rotinaV22 } from "@/lib/rotina-v22";

// Hospedagens serverless (Vercel): a rotina pode passar dos 10 s padrão
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Rotina diária: chame 1x por dia (cron da hospedagem ou serviço externo) — GET /api/tarefas?token=SETUP_TOKEN
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!process.env.SETUP_TOKEN || token !== process.env.SETUP_TOKEN) return NextResponse.json({ erro: "Token inválido." }, { status: 403 });
  try { const r1 = await processarVencimentos().catch(() => null); const r2 = await escalarVencidos().catch(() => null); const r3 = await expirarExcecoes().catch(() => null); const r4 = await alertasDesempenho(hoje()).catch(() => null); const r5 = await rotinaGestao(hoje()).catch(e => ({ gestao: { erro: e instanceof Error ? e.message : String(e) } })); const r6 = await rotinaV22(hoje()).catch(e => ({ falhas: [e instanceof Error ? e.message : String(e)] })); const r = await rotinaDiaria(); return NextResponse.json({ ok: true, desempenho: r4, ...r5, v22: r6, ...r, reservasExpiradas: r1, casosEscalonados: r2, excecoesExpiradas: r3 }); }
  catch (e) { return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
