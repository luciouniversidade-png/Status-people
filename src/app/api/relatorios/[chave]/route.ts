import { NextResponse } from "next/server";
import { getSession, scopeUnit } from "@/lib/auth";
import { REL, podeRelatoriosRh, csvTabela } from "@/lib/relatorios-rh";
import { audit, hoje } from "@/lib/utils";
import { sql } from "@/db";

/** Export CSV de um relatório padrão do RH com os filtros declarados no cabeçalho (o mesmo conteúdo da tela). */
export async function GET(req: Request, ctx: { params: Promise<{ chave: string }> }) {
  const s = await getSession(); if (!s) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  if (!podeRelatoriosRh(s)) return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  const { chave } = await ctx.params; const def = REL[chave]; if (!def) return NextResponse.json({ erro: "Relatório desconhecido." }, { status: 404 });
  const sp = new URL(req.url).searchParams; const mes = /^\d{4}-\d{2}$/.test(sp.get("mes") ?? "") ? sp.get("mes")! : hoje().slice(0, 7);
  const unitId = scopeUnit(s) ?? (Number(sp.get("unidade")) || null);
  const t = await def.gerar(s, { mes, unitId });
  const [u] = unitId ? await sql<{ nome: string }[]>`SELECT nome FROM units WHERE id=${unitId}` : [{ nome: "Rede" }];
  await audit(s, "exportar relatório padrão", "relatorios", null, null, { chave, mes, unitId, linhas: t.linhas.length });
  return new NextResponse(csvTabela(t, def.nome, `${u?.nome ?? "Rede"} · ${mes.split("-").reverse().join("/")} · gerado em ${new Date().toISOString()}`), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${chave}_${mes}.csv"`, "Cache-Control": "private, no-store" } });
}
