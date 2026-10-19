import { sql } from "@/db";
import { hoje } from "./utils";

/**
 * T-044 · Demografia por recortes + T-067 · Risco de saída por área — regra do grupo mínimo (CRQ-PEO-V3-04): nenhum recorte mostra
 * grupo com menos de 5 pessoas; os pequenos somam em "outros" e o detalhe de um grupo pequeno devolve o agregado maior, com a regra explicada.
 */
export const GRUPO_MINIMO = 5;
export type Grupo = { rotulo: string; n: number };
/** Junta os grupos abaixo do mínimo em "Outros (grupos com menos de N)"; se "outros" também ficar abaixo do mínimo, ele some (vira só o total). */
export function grupoMinimo(grupos: Grupo[], min = GRUPO_MINIMO) {
  const visiveis = grupos.filter(g => g.n >= min).sort((a, b) => b.n - a.n); const pequenos = grupos.filter(g => g.n > 0 && g.n < min);
  const somaPeq = pequenos.reduce((a, g) => a + g.n, 0); const total = grupos.reduce((a, g) => a + g.n, 0);
  const outros = pequenos.length ? (somaPeq >= min ? { rotulo: `Outros (${pequenos.length} grupo(s) com menos de ${min})`, n: somaPeq } : null) : null;
  return { visiveis: outros ? [...visiveis, outros] : visiveis, ocultos: pequenos.length, ocultosPessoas: outros ? 0 : somaPeq, total };
}
export const DIMENSOES: Record<string, string> = { unidade: "Unidade", area: "Área", vinculo: "Vínculo", turno: "Turno", idade: "Faixa etária", casa: "Tempo de casa", regime: "Regime" };
const FAIXA_IDADE = (n: string | null, h: string) => { if (!n) return "Sem data de nascimento"; const a = (Date.parse(h) - Date.parse(n)) / (365.25 * 86400000); return a < 25 ? "até 24" : a < 35 ? "25 a 34" : a < 45 ? "35 a 44" : a < 55 ? "45 a 54" : "55+"; };
const FAIXA_CASA = (adm: string, h: string) => { const a = (Date.parse(h) - Date.parse(adm)) / (365.25 * 86400000); return a < 1 ? "< 1 ano" : a < 3 ? "1 a 3 anos" : a < 5 ? "3 a 5 anos" : a < 10 ? "5 a 10 anos" : "10+ anos"; };
export type PessoaRecorte = { unidade: string; area: string; vinculo: string; turno: string; idade: string; casa: string; regime: string };
export async function quadroParaRecortes(unitId: number | null): Promise<PessoaRecorte[]> {
  const h = hoje();
  const r = await sql<{ unidade: string; area: string | null; vinculo: string; turno: string | null; nasc: string | null; admissao: string; regime: string }[]>`SELECT u.nome AS unidade, p.area, e.vinculo, e.turno, e.data_nascimento::text AS nasc, e.admissao::text, e.regime FROM employees e JOIN units u ON u.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id WHERE e.situacao IN ('ATIVO','FERIAS','AFASTADO') ${unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`}`;
  return r.map(x => ({ unidade: x.unidade, area: x.area ?? "Sem área", vinculo: x.vinculo, turno: x.turno ?? "Sem turno", idade: FAIXA_IDADE(x.nasc, h), casa: FAIXA_CASA(x.admissao, h), regime: x.regime }));
}
/** Distribuição por uma dimensão, com grupo mínimo. `filtro` aplica o detalhe (dim=valor) antes — se o grupo filtrado é pequeno, volta ao agregado maior. */
export function recorte(pessoas: PessoaRecorte[], dim: keyof PessoaRecorte, filtro: { dim: keyof PessoaRecorte; valor: string } | null, min = GRUPO_MINIMO) {
  let base = pessoas; let bloqueado: { valor: string; n: number } | null = null;
  if (filtro) { const sub = pessoas.filter(p => p[filtro.dim] === filtro.valor); if (sub.length < min) bloqueado = { valor: filtro.valor, n: sub.length }; else base = sub; }
  const m = new Map<string, number>(); for (const p of base) m.set(p[dim], (m.get(p[dim]) ?? 0) + 1);
  return { ...grupoMinimo([...m.entries()].map(([rotulo, n]) => ({ rotulo, n })), min), bloqueado, base: base.length };
}

/** Ações sugeridas por fator de risco (assistivas; a decisão é da gestão). */
export const ACAO_FATOR: [RegExp, string][] = [[/salário/, "revisão de faixa salarial"], [/reajuste/, "revisão de remuneração do alto desempenho"], [/faltas/, "conversa de acolhimento e acompanhamento"], [/banco de horas/, "plano de compensação do banco"], [/PDI/, "retomar o PDI com o gestor"], [/treinamento/, "agendar a reciclagem obrigatória"], [/6 meses/, "reforçar o onboarding e o buddy"], [/1:1/, "agendar conversa 1:1"], [/desempenho baixo/, "plano de desenvolvimento com metas claras"], [/talent review/, "conversa de carreira"], [/talento estratégico/, "plano de retenção do talento-chave"]];
export function acaoParaFator(texto: string) { return ACAO_FATOR.find(([re]) => re.test(texto))?.[1] ?? "conversa com a liderança"; }

/** Risco por área (agregado): pessoas, alto/médio, média de pontos e os fatores mais frequentes (% das pessoas da área). Áreas pequenas somam em "outras". */
export function riscoPorArea(pessoas: { area: string | null; nivel: string; pontos: number; fatores: { peso: number; texto: string }[] }[], min = GRUPO_MINIMO) {
  const areas = new Map<string, typeof pessoas>(); for (const p of pessoas) { const k = p.area ?? "Sem área"; areas.set(k, [...(areas.get(k) ?? []), p]); }
  const resumo = (rotulo: string, xs: typeof pessoas) => { const fat = new Map<string, number>(); for (const p of xs) for (const f of p.fatores) { const k = f.texto.replace(/^\d+ /, "N "); fat.set(k, (fat.get(k) ?? 0) + 1); }
    const top = [...fat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([texto, n]) => ({ texto, pct: Math.round((100 * n) / xs.length), acao: acaoParaFator(texto) }));
    const alto = xs.filter(p => p.nivel === "ALTO").length, medio = xs.filter(p => p.nivel === "MEDIO").length; const media = xs.reduce((a, p) => a + p.pontos, 0) / xs.length;
    return { area: rotulo, pessoas: xs.length, alto, medio, media: Math.round(media), nivel: media >= 40 || alto / xs.length >= 0.3 ? "ALTO" : media >= 20 || (alto + medio) / xs.length >= 0.4 ? "MEDIO" : "BAIXO", fatores: top }; };
  const grandes = [...areas.entries()].filter(([, xs]) => xs.length >= min).map(([k, xs]) => resumo(k, xs)); const peq = [...areas.entries()].filter(([, xs]) => xs.length < min).flatMap(([, xs]) => xs);
  if (peq.length >= min) grandes.push(resumo(`Outras áreas (menos de ${min} pessoas cada)`, peq));
  return { areas: grandes.sort((a, b) => b.media - a.media), ocultas: peq.length < min ? peq.length : 0 };
}
