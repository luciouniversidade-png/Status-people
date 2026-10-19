import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { lerContexto } from "@/lib/contexto";
import { painelFinanceiro, execucaoPorCategoria, tesouraria } from "@/lib/cockpit";
import { audit } from "@/lib/utils";

/** Export do Cockpit do CFO: série de 13 meses, os indicadores do mês e a execução por área, com o contexto no cabeçalho. Sem dados nominais. */
export async function GET(req: Request) {
  const s = await getSession(); if (!s) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  if (!["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE"].includes(s.role)) return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries()); const ctx = await lerContexto(s, sp);
  const pf = await painelFinanceiro(ctx); const [exec, tes] = await Promise.all([execucaoPorCategoria(ctx), tesouraria(ctx, pf.caixa.saldo)]);
  const n = (v: number | null | undefined, d = 2) => v === null || v === undefined ? "" : v.toFixed(d).replace(".", ",");
  const out = [`Cockpit do CFO;Contexto: ${ctx.carimbo};Gerado em ${new Date().toISOString()};Regime de caixa gerencial`, "", "Indicador;Valor",
    `Receita do mês;${n(pf.receita.real)}`, `Receita orçada;${n(pf.receita.orc)}`, `Despesa do mês;${n(pf.despesa.real)}`, `EBITDA;${n(pf.ebitda)}`, `Margem EBITDA %;${n(pf.margem, 1)}`,
    ...(pf.parcial ? [`Mês em andamento: dados até;${pf.parcial.ate}`, `Receita orçada proporcional (${pf.parcial.base === "perfil" ? "perfil do ano anterior" : "dias corridos"});${n(pf.parcial.orcReceita)}`, `Despesa orçada proporcional;${n(pf.parcial.orcDespesa)}`, `Receita do mês anterior até o mesmo dia;${n(pf.parcial.anterior?.receita)}`, `Receita do ano anterior até o mesmo dia;${n(pf.parcial.anoAnterior?.receita)}`, `EBITDA do ano anterior até o mesmo dia;${n(pf.parcial.anoAnterior?.ebitda)}`] : []),
    `Caixa disponível;${n(pf.caixa.saldo)}`, `Caixa: dados até;${pf.caixa.dadosAte ?? ""}`, `Inadimplência 30+ %;${n(pf.inad30?.pct, 1)}`, `Folha ÷ receita % (REAL);${n(pf.folhaReceita?.pct, 1)}`, `Folha ÷ receita: competência;${pf.folhaReceita?.competencia ?? ""}`, `Folha ÷ receita: unidades cobertas;${pf.folhaReceita ? `${pf.folhaReceita.unidades} de ${pf.folhaReceita.total}` : ""}`,
    `Dias de cobertura;${n(tes.coberturaDias, 1)}`, `Média diária de saídas (90 d);${n(tes.mediaSaidasDia)}`, `PMR (dias);${n(tes.pmrDias, 1)}`, `Saídas previstas 30 d;${n(tes.projecao?.saidas30)}`, `Saídas previstas 60 d;${n(tes.projecao?.saidas60)}`,
    "", "Mês;Receita;Despesa;EBITDA;Receita orçada;Despesa orçada", ...pf.serie13.map(x => [x.periodo, n(x.receita), n(x.despesa), n(x.ebitda), n(x.orcReceita), n(x.orcDespesa)].join(";")),
    "", `Categoria de despesa;Realizado no ano;Orçado no ano;% executado (banda ${exec.faixa[0]}–${exec.faixa[1]})`, ...exec.itens.map(i => [`"${i.categoria.replace(/"/g, '""')}"`, n(i.real), n(i.orc), n(i.pct, 1)].join(";"))];
  await audit(s, "exportar cockpit do CFO", "cash_entries", null, null, { contexto: ctx.carimbo });
  return new NextResponse("﻿" + out.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="cockpit_cfo_${ctx.periodo}.csv"`, "Cache-Control": "private, no-store" } });
}
