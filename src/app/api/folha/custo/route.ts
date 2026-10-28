import { veTela } from "@/lib/acesso";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { podeFolha, custosAceitos } from "@/lib/folha";
import { lerContexto } from "@/lib/contexto";
import { competenciaAnterior } from "@/lib/folha-calc";
import { audit } from "@/lib/utils";

/** Export agregado do custo de folha (T-056): uma linha por dimensão × competência, com o carimbo do contexto. Nunca nominal. */
export async function GET(req: Request) {
  const s = await getSession(); if (!s) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  if (!veTela(s, "/folha/custo")) return NextResponse.json({ erro: "Tela fora do acesso do seu cargo." }, { status: 403 }); // v29: tela fora do acesso do cargo
  if (!podeFolha(s) && s.role !== "LEITURA") return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries()); const ctx = await lerContexto(s, sp);
  const dim = sp.dim === "unidade" || sp.dim === "area" ? sp.dim : "entidade";
  const meses = Array.from({ length: 13 }, (_, i) => { let m = ctx.periodo; for (let k = 0; k < 12 - i; k++) m = competenciaAnterior(m); return m; });
  const linhas = await custosAceitos(meses, { companyId: ctx.entidadeId, unitId: ctx.unitId });
  const chave = (l: typeof linhas[number]) => dim === "entidade" ? l.entidade : dim === "unidade" ? l.unidade ?? "Sem unidade" : l.area ?? "Sem área";
  const agg = new Map<string, { custo: number; salarios: number; encargos: number; provisoes: number; beneficios: number; rescisoes: number }>();
  for (const l of linhas) { const k = `${l.competencia}|${chave(l)}`; const a = agg.get(k) ?? { custo: 0, salarios: 0, encargos: 0, provisoes: 0, beneficios: 0, rescisoes: 0 }; a.custo += l.custo; a.salarios += l.salarios; a.encargos += l.encargos; a.provisoes += l.provisao_13 + l.provisao_ferias; a.beneficios += l.beneficios; a.rescisoes += l.rescisoes; agg.set(k, a); }
  const n = (v: number) => v.toFixed(2).replace(".", ",");
  const out = [`Custo de folha por ${dim};Contexto: ${ctx.carimbo};Fonte: resultados aceitos da Payroll Bridge (REAL)`, ["competencia", dim, "custo_total", "proventos", "encargos", "provisoes", "beneficios", "rescisoes"].join(";")];
  for (const [k, a] of [...agg.entries()].sort()) { const [m, g] = k.split("|"); out.push([m, `"${g.replace(/"/g, '""')}"`, n(a.custo), n(a.salarios), n(a.encargos), n(a.provisoes), n(a.beneficios), n(a.rescisoes)].join(";")); }
  await audit(s, "exportar custo de folha (agregado)", "payroll_results", null, null, { contexto: ctx.carimbo, dim, linhas: agg.size });
  return new NextResponse("﻿" + out.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="custo_folha_${ctx.periodo}_${dim}.csv"`, "Cache-Control": "private, no-store" } });
}
