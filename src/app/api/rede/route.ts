import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { lerContexto } from "@/lib/contexto";
import { visaoRede } from "@/lib/rede";
import { audit } from "@/lib/utils";

/** Export da Visão da rede (cartões + linha de totais), com o contexto declarado. Indicadores agregados, sem nomes. */
export async function GET(req: Request) {
  const s = await getSession(); if (!s) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  if (s.role === "COLABORADOR") return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries()); const ctx = await lerContexto(s, sp); const v = await visaoRede(s, ctx);
  const n = (x: number | null | undefined, d = 0) => x === null || x === undefined ? "" : x.toFixed(d).replace(".", ",");
  const out = [`Visão da rede;Contexto: ${ctx.carimbo};Gerado em ${new Date().toISOString()}`, "Unidade;Alunos;Turmas;Vagas;Ocupadas;Ocupação %;Pendências;Chamados;Casos;Reservas 48h;Colaboradores;Saúde;NPS;Receita do mês;Inadimplência 30+ %",
    ...v.cartoes.map(c => [`"${c.nome}"`, c.alunos, c.turmas, c.vagas, c.ocupadas, n(c.ocupacaoPct, 1), c.pendencias, c.chamados, c.casos, c.reservasVencendo, c.colaboradores, n(c.saude), n(c.nps), c.financeiro ? n(c.receita, 2) : "", c.financeiro ? n(c.inad30, 1) : ""].join(";")),
    ["TOTAL (soma dos cartões)", v.totais.alunos, v.totais.turmas, v.totais.vagas, v.totais.ocupadas, n(v.totais.ocupacaoPct, 1), v.totais.pendencias, v.totais.chamados, v.totais.casos, v.totais.reservasVencendo, v.totais.colaboradores, "", "", n(v.totais.receita, 2), ""].join(";"),
    ...v.avisos.map(a => `Aviso;"${a.replace(/"/g, '""')}"`)];
  await audit(s, "exportar visão da rede", "units", null, null, { contexto: ctx.carimbo });
  return new NextResponse("﻿" + out.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="visao_rede_${ctx.periodo}.csv"`, "Cache-Control": "private, no-store" } });
}
