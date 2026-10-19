/**
 * Narrativa executiva determinística (C3 · Board do dono e Cockpit do CFO): frases curtas montadas só com números de fonte declarada,
 * cada uma com chips de ação (aprovar, delegar, abrir plano). Sem IA e sem nomes de pessoas (CRQ-CMD-V3-02/03 · CRQ-IA-V3-01).
 */
import { fmtReais, fmtPct, rotuloMes } from "./formato";

export type Chip = { rotulo: string; href: string };
export type FraseC3 = { tom: "bom" | "atencao" | "ruim" | "neutro"; texto: string; chips: Chip[]; peso: number };

/** Mês em andamento: o realizado vai até `ate` e é comparado com o orçado proporcional e com o mesmo período do ano anterior. */
export type ParcialNarrativa = { ate: string; orc: number | null; anoAnterior: number | null; base: "perfil" | "linear" };
const ddmm = (iso: string) => iso.slice(5, 10).split("-").reverse().join("/");
const baseTxt = (b: "perfil" | "linear") => b === "perfil" ? "pelo perfil do mesmo mês do ano anterior" : "por dias corridos";

export type EntradaNarrativa = {
  periodo: string;
  receita: { real: number | null; orc: number | null; anoAnterior: number | null; parcial?: ParcialNarrativa | null };
  folhaCompetencia?: string | null;
  caixa: { saldo: number | null; dadosAte: string | null };
  semanaCritica: { ate: string; min: number } | null;
  inad30: { pct: number; familias: number } | null; metaInad: number;
  folhaReceita: number | null;
  funil: { ponderado: number; vagas: number; ocupacaoPct: number | null; reservasVencendo: number };
  alertas: { criticos: number; atrasados: number };
  aprovacoes: number;
  ebitda: number | null;
};

/** Monta de 3 a 6 frases, do mais grave ao mais tranquilo; sem fonte, a frase diz que falta a fonte (nunca inventa número). */
export function narrativaBoard(e: EntradaNarrativa): FraseC3[] {
  const f: FraseC3[] = []; const mes = rotuloMes(e.periodo);
  const pr = e.receita.parcial ?? null;
  if (e.receita.real === null) f.push({ tom: "neutro", peso: 1, texto: `Receita de ${mes} sem fonte: importe o extrato ou os lançamentos de caixa.`, chips: [{ rotulo: "Importar caixa", href: "/financeiro/caixa" }] });
  else if (pr) {
    // mês em andamento: nunca o parcial contra o mês cheio — orçado proporcional e o mesmo período do ano anterior
    const pct = pr.orc ? (100 * e.receita.real) / pr.orc : null; const tom = pct === null ? "neutro" : pct >= 100 ? "bom" : pct >= 90 ? "atencao" : "ruim";
    f.push({ tom, peso: tom === "ruim" ? 9 : tom === "atencao" ? 5 : 2, texto: `Receita de ${mes} até ${ddmm(pr.ate)} (mês em andamento): ${fmtReais(e.receita.real, true)}${pct !== null ? `, ${fmtPct(pct, 0)} do orçado proporcional ao período (${baseTxt(pr.base)})` : ""}${pr.anoAnterior ? `${pct !== null ? " e" : ","} ${e.receita.real >= pr.anoAnterior ? "acima" : "abaixo"} do mesmo período do ano passado (${fmtReais(pr.anoAnterior, true)})` : ""}.`, chips: [{ rotulo: "Ver DRE", href: "/financeiro/dre" }, ...(tom === "ruim" || tom === "atencao" ? [{ rotulo: "Explicar desvio", href: "/financeiro/orcamento" }] : [])] });
  } else if (e.receita.orc) {
    const pct = (100 * e.receita.real) / e.receita.orc; const tom = pct >= 100 ? "bom" : pct >= 90 ? "atencao" : "ruim";
    f.push({ tom, peso: tom === "ruim" ? 9 : tom === "atencao" ? 5 : 2, texto: `Receita de ${mes}: ${fmtReais(e.receita.real, true)}, ${fmtPct(pct, 0)} do orçado${e.receita.anoAnterior ? ` e ${e.receita.real >= e.receita.anoAnterior ? "acima" : "abaixo"} do mesmo mês do ano passado (${fmtReais(e.receita.anoAnterior, true)})` : ""}.`, chips: [{ rotulo: "Ver DRE", href: "/financeiro/dre" }, ...(tom !== "bom" ? [{ rotulo: "Explicar desvio", href: "/financeiro/orcamento" }] : [])] });
  } else f.push({ tom: "neutro", peso: 1, texto: `Receita de ${mes}: ${fmtReais(e.receita.real, true)} (sem orçamento cadastrado para comparar).`, chips: [{ rotulo: "Cadastrar orçamento", href: "/financeiro/orcamento/planilha" }] });
  if (e.semanaCritica && e.semanaCritica.min < 0) f.push({ tom: "ruim", peso: 10, texto: `Caixa: a projeção fica negativa na semana até ${e.semanaCritica.ate.split("-").reverse().join("/")} (${fmtReais(e.semanaCritica.min, true)}). Antecipe recebíveis ou adie saídas.`, chips: [{ rotulo: "Ver projeção", href: "/financeiro/projecao" }, { rotulo: "Abrir plano", href: "/estrategia/acoes?novo=caixa" }] });
  else if (e.caixa.saldo !== null) f.push({ tom: "neutro", peso: 1, texto: `Caixa consolidado: ${fmtReais(e.caixa.saldo, true)}${e.caixa.dadosAte ? ` (dados até ${e.caixa.dadosAte.split("-").reverse().join("/")})` : ""}${e.semanaCritica ? `; menor saldo projetado em 13 semanas: ${fmtReais(e.semanaCritica.min, true)}` : ""}.`, chips: [{ rotulo: "Tesouraria", href: "/financeiro/cockpit#tesouraria" }] });
  if (e.inad30) { const tom = e.inad30.pct > e.metaInad * 1.5 ? "ruim" : e.inad30.pct > e.metaInad ? "atencao" : "bom"; f.push({ tom, peso: tom === "ruim" ? 8 : tom === "atencao" ? 6 : 1, texto: `Inadimplência 30+: ${fmtPct(e.inad30.pct)} (meta ${fmtPct(e.metaInad, 0)}), ${e.inad30.familias} família(s) com título vencido há mais de 30 dias.`, chips: tom === "bom" ? [] : [{ rotulo: "Abrir cobrança", href: "/financeiro/inadimplencia" }, { rotulo: "Delegar", href: "/alertas?modulo=Financeiro" }] }); }
  if (e.funil.vagas) { const oc = e.funil.ocupacaoPct ?? 0; const tom = oc >= 85 ? "bom" : oc >= 70 ? "atencao" : "ruim"; f.push({ tom, peso: tom === "ruim" ? 7 : tom === "atencao" ? 4 : 1, texto: `Matrículas: funil ponderado de ${e.funil.ponderado.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} para ${e.funil.vagas} vagas (ocupação ${fmtPct(oc, 0)})${e.funil.reservasVencendo ? `; ${e.funil.reservasVencendo} reserva(s) vencendo em 48 h` : ""}.`, chips: [{ rotulo: "Metas e previsão", href: "/matriculas/metas" }, ...(e.funil.reservasVencendo ? [{ rotulo: "Converter reservas", href: "/matriculas/reservas" }] : [])] }); }
  if (e.folhaReceita !== null) { const tom = e.folhaReceita > 60 ? "ruim" : e.folhaReceita > 50 ? "atencao" : "bom"; f.push({ tom, peso: tom === "ruim" ? 6 : 2, texto: `Folha ÷ receita (REAL${e.folhaCompetencia && e.folhaCompetencia !== e.periodo ? `, última folha aceita: ${rotuloMes(e.folhaCompetencia)}` : ""}): ${fmtPct(e.folhaReceita)}.`, chips: [{ rotulo: "Custo de folha", href: "/folha/custo" }] }); }
  else f.push({ tom: "neutro", peso: 0, texto: "Folha ÷ receita sem fonte REAL: aceite o resultado da folha do mês na Payroll Bridge.", chips: [{ rotulo: "Ciclo da folha", href: "/folha" }] });
  if (e.alertas.criticos || e.alertas.atrasados) f.push({ tom: e.alertas.atrasados ? "ruim" : "atencao", peso: e.alertas.atrasados ? 8 : 5, texto: `${e.alertas.criticos} alerta(s) crítico(s) abertos${e.alertas.atrasados ? `, ${e.alertas.atrasados} com prazo estourado` : ""}.`, chips: [{ rotulo: "Tratar alertas", href: "/alertas" }] });
  if (e.aprovacoes) f.push({ tom: "atencao", peso: 3, texto: `${e.aprovacoes} pedido(s) aguardam sua aprovação.`, chips: [{ rotulo: "Aprovar em lote", href: "/aprovacoes" }] });
  return f.sort((a, b) => b.peso - a.peso).slice(0, 6);
}

export type EntradaCfo = {
  periodo: string; parcial?: { ate: string; orcReceita: number | null; orcDespesa: number | null; base: "perfil" | "linear" } | null; folhaCompetencia?: string | null;
  receita: { real: number | null; orc: number | null }; despesa: { real: number | null; orc: number | null };
  ebitda: number | null; margem: number | null;
  caixa: { saldo: number | null; dadosAte: string | null; coberturaDias: number | null };
  inad30: { pct: number; familias: number; valor: number } | null; metaInad: number; acoesCobranca: number;
  folhaReceita: number | null;
  estouros: { categoria: string; pct: number }[]; faixaMax: number; explicacoesAbertas: number;
};

/** Narrativa do mês do Cockpit do CFO (C3): o que aconteceu, onde desviou e o que fazer — com os números e o link de cada fonte. */
export function narrativaCfo(e: EntradaCfo): FraseC3[] {
  const f: FraseC3[] = []; const mes = rotuloMes(e.periodo);
  const pr = e.parcial ?? null;
  if (pr && e.receita.real !== null && e.despesa.real !== null) {
    // mês em andamento: a régua é o orçado proporcional ao período; o resultado do mês só fecha no fim do mês
    const tom = e.ebitda === null ? "neutro" : e.ebitda < 0 ? "atencao" : "neutro";
    f.push({ tom, peso: tom === "atencao" ? 5 : 2, texto: `${mes} até ${ddmm(pr.ate)} (mês em andamento): receita ${fmtReais(e.receita.real, true)}${pr.orcReceita ? ` (${fmtPct((100 * e.receita.real) / pr.orcReceita, 0)} do orçado proporcional)` : ""}, despesa ${fmtReais(e.despesa.real, true)}${pr.orcDespesa ? ` (${fmtPct((100 * e.despesa.real) / pr.orcDespesa, 0)} do orçado proporcional)` : ""}; EBITDA parcial ${e.ebitda === null ? "sem fonte" : fmtReais(e.ebitda, true)}. Proporção ${baseTxt(pr.base)}.`, chips: [{ rotulo: "DRE", href: "/financeiro/dre" }] });
  } else if (e.receita.real !== null && e.despesa.real !== null) {
    const tom = e.ebitda === null ? "neutro" : e.ebitda < 0 ? "ruim" : e.margem !== null && e.margem < 10 ? "atencao" : "bom";
    f.push({ tom, peso: tom === "ruim" ? 9 : tom === "atencao" ? 5 : 2, texto: `${mes}: receita ${fmtReais(e.receita.real, true)}${e.receita.orc ? ` (${fmtPct((100 * e.receita.real) / e.receita.orc, 0)} do orçado)` : ""}, despesa ${fmtReais(e.despesa.real, true)}${e.despesa.orc ? ` (${fmtPct((100 * e.despesa.real) / e.despesa.orc, 0)} do orçado)` : ""}; EBITDA ${e.ebitda === null ? "sem fonte" : fmtReais(e.ebitda, true)}${e.margem !== null ? `, margem ${fmtPct(e.margem)}` : ""}.`, chips: [{ rotulo: "DRE", href: "/financeiro/dre" }] });
  } else f.push({ tom: "neutro", peso: 1, texto: `${mes} sem caixa importado: o resultado do mês aparece quando o extrato ou os lançamentos entrarem.`, chips: [{ rotulo: "Importar caixa", href: "/financeiro/importar" }] });
  if (e.estouros.length) f.push({ tom: "ruim", peso: 8, texto: `${e.estouros.length} categoria(s) acima de ${fmtPct(e.faixaMax, 0)} do orçado no acumulado: ${e.estouros.slice(0, 3).map(x => `${x.categoria} ${fmtPct(x.pct, 0)}`).join(", ")}${e.estouros.length > 3 ? "…" : ""}.${e.explicacoesAbertas ? ` ${e.explicacoesAbertas} pedido(s) de explicação em aberto.` : ""}`, chips: [{ rotulo: "Orçado × real", href: "/financeiro/orcamento" }, { rotulo: "Pedir explicação", href: "/financeiro/orcamento#explicacoes" }] });
  if (e.caixa.saldo !== null) { const c = e.caixa.coberturaDias; const tom = c === null ? "neutro" : c < 15 ? "ruim" : c < 30 ? "atencao" : "bom"; f.push({ tom, peso: tom === "ruim" ? 10 : tom === "atencao" ? 6 : 1, texto: `Caixa disponível ${fmtReais(e.caixa.saldo, true)}${e.caixa.dadosAte ? ` (dados até ${e.caixa.dadosAte.split("-").reverse().join("/")})` : ""}${c !== null ? `: cobre ${Math.floor(c)} dia(s) de saídas` : ""}.`, chips: [{ rotulo: "Tesouraria", href: "#tesouraria" }, { rotulo: "Projeção 13 semanas", href: "/financeiro/projecao" }] }); }
  else f.push({ tom: "neutro", peso: 1, texto: "Caixa sem saldo inicial do mês: informe o saldo por unidade para a cobertura em dias aparecer.", chips: [{ rotulo: "Saldo inicial", href: "/financeiro/caixa" }] });
  if (e.inad30) { const tom = e.inad30.pct > e.metaInad * 1.5 ? "ruim" : e.inad30.pct > e.metaInad ? "atencao" : "bom"; f.push({ tom, peso: tom === "ruim" ? 8 : tom === "atencao" ? 5 : 1, texto: `Inadimplência 30+ em ${fmtPct(e.inad30.pct)} (meta ${fmtPct(e.metaInad, 0)}): ${fmtReais(e.inad30.valor, true)} de ${e.inad30.familias} família(s)${e.acoesCobranca ? `; ${e.acoesCobranca} título(s) sem a ação que a régua pede` : ""}.`, chips: [{ rotulo: "Régua de cobrança", href: "/financeiro/inadimplencia" }] }); }
  if (e.folhaReceita !== null) f.push({ tom: e.folhaReceita > 60 ? "ruim" : e.folhaReceita > 50 ? "atencao" : "bom", peso: e.folhaReceita > 60 ? 6 : 1, texto: `Folha (resultado aceito) consome ${fmtPct(e.folhaReceita)} da receita ${e.folhaCompetencia && e.folhaCompetencia !== e.periodo ? `de ${rotuloMes(e.folhaCompetencia)} (última competência aceita)` : "do mês"}.`, chips: [{ rotulo: "Custo de folha", href: "/folha/custo" }] });
  return f.sort((a, b) => b.peso - a.peso).slice(0, 5);
}
