/**
 * Formatação de números para painéis (v23). Funções puras — podem ser usadas em qualquer componente.
 * Padrão pt-BR: vírgula decimal, "mil" / "mi" / "bi" no formato compacto, "p.p." para variação de percentuais.
 */
export type UnidadeKpi = "%" | "R$" | "n" | "pts" | "dias" | "h" | "x" | "nota";

const vazio = (v: number | null | undefined): v is null | undefined => v === null || v === undefined || Number.isNaN(v) || !Number.isFinite(v);

export function fmtNumero(v: number | null | undefined, casas = 0): string {
  if (vazio(v)) return "—";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/** 1.234 → "1,2 mil"; 3.400.000 → "3,4 mi". Abaixo de mil mostra o número inteiro (ou com 1 casa se for fracionário). */
export function fmtCompacto(v: number | null | undefined): string {
  if (vazio(v)) return "—";
  const a = Math.abs(v);
  const corta = (x: number) => x.toLocaleString("pt-BR", { maximumFractionDigits: x >= 100 ? 0 : 1 });
  if (a >= 1e9) return `${corta(v / 1e9)} bi`;
  if (a >= 1e6) return `${corta(v / 1e6)} mi`;
  if (a >= 1e4) return `${corta(v / 1e3)} mil`;
  return v.toLocaleString("pt-BR", { maximumFractionDigits: Number.isInteger(v) ? 0 : 1 });
}

export function fmtReais(v: number | null | undefined, compacto = false): string {
  if (vazio(v)) return "—";
  if (compacto && Math.abs(v) >= 1e4) return `${v < 0 ? "−" : ""}R$ ${fmtCompacto(Math.abs(v))}`;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 });
}

export function fmtPct(v: number | null | undefined, casas = 1): string {
  if (vazio(v)) return "—";
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: casas })}%`;
}

/** Valor de um indicador na unidade de medida dele. `compacto` encurta moeda e contagens grandes (cartões e eixos). */
export function fmtKpi(v: number | null | undefined, unidade: UnidadeKpi, compacto = false): string {
  if (vazio(v)) return "—";
  switch (unidade) {
    case "%": return fmtPct(v, 1);
    case "R$": return fmtReais(v, compacto);
    case "pts": return fmtNumero(v, 0);
    case "dias": return `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${Math.abs(v) === 1 ? "dia" : "dias"}`;
    case "h": return `${v.toLocaleString("pt-BR", { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 1 })} h`;
    case "x": return v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
    case "nota": return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    default: return compacto ? fmtCompacto(v) : v.toLocaleString("pt-BR", { maximumFractionDigits: Number.isInteger(v) ? 0 : 1 });
  }
}

/** Rótulo curto para eixos: compacto e sem "R$" repetido. */
export function fmtEixo(unidade: UnidadeKpi) {
  // percentuais quebrados (90,5%) mantêm a casa decimal para os rótulos do eixo não se repetirem
  return (v: number) => unidade === "%" ? fmtPct(v, Number.isInteger(Math.round(v * 100) / 100) ? 0 : 1) : unidade === "nota" ? v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : fmtCompacto(v);
}

export type Variacao = { abs: number; rel: number | null; texto: string; sentido: 1 | -1 | 0 };

/**
 * Variação entre dois valores. Percentuais, pontos e notas variam em valor absoluto ("+0,4 p.p.", "+3 pts");
 * contagens e moeda variam em percentual ("+3,2%"), ou em valor absoluto quando a base é zero.
 */
export function variacao(atual: number | null | undefined, anterior: number | null | undefined, unidade: UnidadeKpi): Variacao | null {
  if (vazio(atual) || vazio(anterior)) return null;
  const abs = atual - anterior;
  // diferença que some no arredondamento da exibição conta como estável (nada de "−0 p.p.")
  const casas = unidade === "pts" ? 0 : unidade === "nota" ? 2 : unidade === "%" ? 1 : unidade === "n" && Number.isInteger(atual) && Number.isInteger(anterior) ? 0 : 1;
  const relAbs = anterior !== 0 ? Math.abs(abs / anterior) : null;
  const some = ["%", "pts", "nota"].includes(unidade) || relAbs === null || (unidade === "n" && Math.abs(anterior) < 20) ? Math.abs(abs) < 0.5 * 10 ** -casas : relAbs < 0.0005;
  const sentido = some ? 0 : abs > 0 ? 1 : -1; const sinal = sentido > 0 ? "+" : sentido < 0 ? "−" : "";
  const rel = anterior !== 0 ? abs / Math.abs(anterior) : null;
  if (unidade === "%") return { abs, rel, sentido, texto: sentido === 0 ? "estável" : `${sinal}${Math.abs(abs).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p.` };
  if (unidade === "pts") return { abs, rel, sentido, texto: sentido === 0 ? "estável" : `${sinal}${Math.abs(abs).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} pts` };
  if (unidade === "nota") return { abs, rel, sentido, texto: sentido === 0 ? "estável" : `${sinal}${Math.abs(abs).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}` };
  // contagens pequenas variam em número, não em percentual ("+12", e não "+1.200%")
  if (rel === null || (unidade === "n" && Math.abs(anterior) < 20)) return { abs, rel, sentido, texto: sentido === 0 ? "estável" : `${sinal}${fmtKpi(Math.abs(abs), unidade, true)}` };
  return { abs, rel, sentido, texto: sentido === 0 ? "estável" : `${sinal}${Math.abs(rel * 100).toLocaleString("pt-BR", { maximumFractionDigits: Math.abs(rel) < 0.1 ? 1 : 0 })}%` };
}

export const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const MESES_LONGOS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
/** "2026-10" → "out/26" (ou "out" sem o ano). */
export function rotuloMes(periodo: string, comAno = true): string {
  const [y, m] = periodo.split("-"); const nome = MESES_CURTOS[Number(m) - 1] ?? periodo;
  return comAno ? `${nome}/${y.slice(2)}` : nome;
}
/** "2026-10" → "outubro de 2026". */
export function mesPorExtenso(periodo: string): string {
  const [y, m] = periodo.split("-"); return `${MESES_LONGOS[Number(m) - 1] ?? periodo} de ${y}`;
}
