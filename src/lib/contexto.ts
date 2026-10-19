import { cookies } from "next/headers";
import { sql } from "@/db";
import type { Session } from "./auth";
import { scopeUnit } from "./auth";
import { hoje } from "./utils";
import { rotuloMes } from "./formato";

/**
 * Seletor global (T-100 · Nova Arquitetura): entidade (CNPJ, com Consolidado) · unidade · período num só controle.
 * Ordem de leitura: parâmetros da URL (ctx_e, ctx_u, ctx_p) → escolha da sessão (cookie one_ctx) → padrão salvo do usuário
 * (user_prefs.contexto) → padrão do papel (unidade do escopo; rede; mês corrente). O escopo do papel sempre prevalece:
 * diretor(a) de unidade e gestor(a) só enxergam a própria unidade, qualquer que seja o pedido.
 */
export const COOKIE_CTX = "one_ctx";
export type ContextoBruto = { e?: number | null; u?: number | null; p?: string | null };
export type Unidade = { id: number; nome: string; codigo: string; company_id: number | null };
export type Entidade = { id: number; nome: string; cnpj: string | null };
export type Contexto = {
  entidadeId: number | null; unitId: number | null; periodo: string;
  /** unidades que entram no recorte (null = todas da rede) */
  unitIds: number[] | null;
  units: Unidade[]; entidades: Entidade[];
  travado: boolean; origem: "url" | "sessao" | "salvo" | "papel";
  rotulo: { entidade: string; unidade: string; periodo: string };
  /** carimbo para exportações e retratos: "Consolidado · Rede · out/2026" */
  carimbo: string;
  /** entidade escolhida sem unidade vinculada (recortes por unidade ficam vazios) */
  semVinculo: boolean;
};

export const periodoValido = (p: unknown): p is string => typeof p === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
const idOuNull = (v: unknown) => { const n = Number(v); return v === null || v === undefined || v === "" || !Number.isFinite(n) || n <= 0 ? null : Math.round(n); };

/** Lê o contexto bruto do cookie (JSON curto); ignora qualquer coisa malformada. */
export function lerCookie(valor: string | undefined): ContextoBruto | null {
  if (!valor) return null;
  try { const o = JSON.parse(decodeURIComponent(valor)) as Record<string, unknown>; return { e: idOuNull(o.e), u: idOuNull(o.u), p: periodoValido(o.p) ? o.p : null }; } catch { return null; }
}

/**
 * Resolve o contexto puro (sem banco): aplica o escopo do papel, valida unidade × entidade e monta rótulos e carimbo.
 * Exportada para os testes.
 */
export function resolverContexto(bruto: ContextoBruto, base: { units: Unidade[]; entidades: Entidade[]; escopo: number | null; mesAtual: string; origem: Contexto["origem"] }): Contexto {
  const { units, entidades, escopo } = base;
  let unitId = idOuNull(bruto.u); let entidadeId = idOuNull(bruto.e); const periodo = periodoValido(bruto.p) ? bruto.p : base.mesAtual;
  if (unitId !== null && !units.some(u => u.id === unitId)) unitId = null;
  if (entidadeId !== null && !entidades.some(c => c.id === entidadeId)) entidadeId = null;
  const travado = escopo !== null;
  if (travado) { unitId = escopo; entidadeId = units.find(u => u.id === escopo)?.company_id ?? null; }
  // unidade de outra entidade: a unidade prevalece (é o recorte mais fino) e a entidade passa a ser a dela
  if (unitId !== null) { const un = units.find(u => u.id === unitId); if (entidadeId !== null && un && un.company_id !== null && un.company_id !== entidadeId) entidadeId = un.company_id; }
  const daEntidade = entidadeId === null ? null : units.filter(u => u.company_id === entidadeId).map(u => u.id);
  const unitIds = unitId !== null ? [unitId] : daEntidade;
  const semVinculo = entidadeId !== null && unitId === null && (daEntidade ?? []).length === 0;
  const rotulo = {
    entidade: entidadeId === null ? "Consolidado" : entidades.find(c => c.id === entidadeId)?.nome ?? "Entidade",
    unidade: unitId === null ? (entidadeId === null ? "Rede" : "Todas da entidade") : units.find(u => u.id === unitId)?.nome ?? "Unidade",
    periodo: rotuloMes(periodo),
  };
  return { entidadeId, unitId, periodo, unitIds, units, entidades, travado, origem: base.origem, rotulo, carimbo: `${rotulo.entidade} · ${rotulo.unidade} · ${rotulo.periodo}`, semVinculo };
}

export async function unidadesEEntidades() {
  const [units, entidades] = await Promise.all([
    sql<Unidade[]>`SELECT id, nome, codigo, company_id FROM units ORDER BY nome`,
    sql<Entidade[]>`SELECT id, nome, cnpj FROM companies ORDER BY nome`,
  ]);
  return { units, entidades };
}

/** Contexto da tela: `sp` são os parâmetros da página (ctx_e, ctx_u, ctx_p têm prioridade; `unidade`/`mes` antigos também valem). */
export async function lerContexto(s: Session, sp: Record<string, string | undefined> = {}): Promise<Contexto> {
  const { units, entidades } = await unidadesEEntidades();
  const escopo = scopeUnit(s); const mesAtual = hoje().slice(0, 7);
  const daUrl = sp.ctx_e !== undefined || sp.ctx_u !== undefined || sp.ctx_p !== undefined;
  if (daUrl) return resolverContexto({ e: idOuNull(sp.ctx_e), u: idOuNull(sp.ctx_u), p: sp.ctx_p ?? null }, { units, entidades, escopo, mesAtual, origem: "url" });
  let ck: ContextoBruto | null = null; try { ck = lerCookie((await cookies()).get(COOKIE_CTX)?.value); } catch { ck = null; }
  if (ck) return resolverContexto(ck, { units, entidades, escopo, mesAtual, origem: "sessao" });
  let salvo: ContextoBruto | null = null;
  try { const [r] = await sql<{ contexto: ContextoBruto | null }[]>`SELECT contexto FROM user_prefs WHERE user_id=${s.id}`; salvo = r?.contexto ?? null; } catch { salvo = null; }
  // o padrão salvo guarda entidade e unidade; o período padrão é sempre o mês corrente (salvo se a pessoa fixou um)
  if (salvo) return resolverContexto(salvo, { units, entidades, escopo, mesAtual, origem: "salvo" });
  return resolverContexto({}, { units, entidades, escopo, mesAtual, origem: "papel" });
}

/** Filtro de unidade para SQL: `AND <col> = ANY(...)` quando há recorte; vazio para a rede inteira. */
export function filtroUnidades(ctx: Pick<Contexto, "unitIds">, col: string) {
  if (ctx.unitIds === null) return sql``;
  if (!ctx.unitIds.length) return sql`AND false`;
  return sql`AND ${sql(col)} = ANY(${ctx.unitIds})`;
}

/** Período do contexto em limites de data: primeiro dia, primeiro dia do mês seguinte e o último dia. */
export function limitesPeriodo(periodo: string) {
  const [a, m] = periodo.split("-").map(Number); const ini = `${periodo}-01`;
  const prox = m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`;
  const ult = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  return { ini, prox, ult, ano: a, mes: m };
}

/** Query string que reproduz o contexto (para links de drill que precisam carregar o mesmo filtro em outra tela). */
export function qsContexto(ctx: Pick<Contexto, "entidadeId" | "unitId" | "periodo">) {
  const p = new URLSearchParams(); if (ctx.entidadeId) p.set("ctx_e", String(ctx.entidadeId)); if (ctx.unitId) p.set("ctx_u", String(ctx.unitId)); p.set("ctx_p", ctx.periodo);
  return p.toString();
}
