import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { lerContexto } from "@/lib/contexto";
import { dadosDre, type DimDre, type VisaoDre } from "@/lib/dre";
import { LINHAS_DRE, valorModo, type Modo } from "@/lib/dre-calc";
import { audit } from "@/lib/utils";

/** Export da DRE com os filtros declarados (contexto, dimensão, visão e modo) no cabeçalho. */
export async function GET(req: Request) {
  const s = await getSession(); if (!s) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  if (!["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE", "RH"].includes(s.role)) return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries()); const ctx = await lerContexto(s, sp);
  const dim: DimDre = sp.dim === "entidade" || sp.dim === "mes" ? sp.dim : "unidade"; const visao: VisaoDre = sp.visao === "acumulado" ? "acumulado" : "mes";
  const modo: Modo = ["real", "orcado", "delta", "ah", "av"].includes(sp.modo) ? sp.modo as Modo : "real";
  const { dre, cols } = await dadosDre(ctx, dim, visao);
  const n = (v: number | null) => v === null ? "" : v.toFixed(2).replace(".", ",");
  const out = [`DRE gerencial;Contexto: ${ctx.carimbo};Dimensão: ${dim};Visão: ${visao};Modo: ${modo};Regime de caixa gerencial (pessoal = folha aceita quando existe)`, ["linha", "conta", ...cols.map(c => c.rotulo)].join(";")];
  for (const l of LINHAS_DRE) {
    out.push([`"${l.nome}"`, "", ...cols.map(c => n(valorModo(dre.linha(l.codigo, c.chave), modo, dre.linha("LIQUIDA", c.chave).real)))].join(";"));
    if (!l.total) for (const k of dre.contas.filter(k => k.linha === l.codigo)) out.push(["", `"${k.nome.replace(/"/g, '""')}"`, ...cols.map(c => n(valorModo(dre.celula(k.chave, c.chave), modo, dre.linha("LIQUIDA", c.chave).real)))].join(";"));
  }
  await audit(s, "exportar DRE", "cash_entries", null, null, { contexto: ctx.carimbo, dim, visao, modo });
  return new NextResponse("﻿" + out.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="dre_${ctx.periodo}_${dim}_${modo}.csv"`, "Cache-Control": "private, no-store" } });
}
