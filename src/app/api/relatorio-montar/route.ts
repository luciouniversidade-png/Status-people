import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { veTela } from "@/lib/acesso";
import { podeRelatoriosRh } from "@/lib/relatorios-rh";
import { lerDefinicao, executar, csvResultado, FONTE } from "@/lib/relatorio-montar";
import { audit } from "@/lib/utils";
import { sql } from "@/db";

/** v30 · CSV do relatório sob medida — a mesma definição da tela (e as mesmas regras de acesso), com o carimbo de escopo e filtros. */
export async function GET(req: Request) {
  const s = await getSession(); if (!s) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  if (!veTela(s, "/relatorios/montar") || !podeRelatoriosRh(s)) return NextResponse.json({ erro: "Tela fora do acesso do seu cargo." }, { status: 403 });
  const d = lerDefinicao(s, new URL(req.url).searchParams); if ("erro" in d) return NextResponse.json({ erro: d.erro }, { status: 400 });
  const r = await executar(s, d, 50000);
  const [u] = d.unidade ? await sql<{ nome: string }[]>`SELECT nome FROM units WHERE id=${d.unidade}` : [{ nome: "Rede" }];
  await audit(s, "exportar relatório sob medida", "custom_reports", null, null, { fonte: d.fonte, colunas: d.colunas, linhas: d.linhas, colunasPor: d.colunasPor, metrica: d.metrica, n: r.tabela.linhas.length });
  const nome = `Relatório sob medida · ${FONTE[d.fonte].nome}`;
  return new NextResponse(csvResultado(r, nome, `${u?.nome ?? "Rede"} · gerado em ${new Date().toISOString()} por ${s.nome}`), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="relatorio_${d.fonte}.csv"`, "Cache-Control": "private, no-store" } });
}
