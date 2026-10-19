import { sql } from "@/db";
import { scopeUnit, type Session } from "./auth";
import { hoje, getSettings } from "./utils";
import { garantirKpis, kpisVisiveis, visoes, comparativoUnidades, estadoBase, periodoPadrao, periodoValido } from "./kpi";
import { ORDEM_AREAS, AREAS, leituraDoMes, porUnidade, type AreaKpi, type VisaoKpi } from "./kpi-catalogo";
import { mesPorExtenso, rotuloMes } from "./formato";
import { ultimosPeriodos } from "./gestao-calc";

/** Dados do Painel Executivo e do modo apresentação (v23): o mesmo conteúdo, com o escopo e as áreas do perfil. */
export async function carregarPainel(s: Session, sp: { periodo?: string; unidade?: string }) {
  await garantirKpis().catch(() => null);
  const h = hoje(); const periodo = periodoValido(sp.periodo, h) ? sp.periodo! : periodoPadrao(h);
  const escopo = scopeUnit(s);
  const units = await sql<{ id: number; nome: string; codigo: string }[]>`SELECT id, nome, codigo FROM units ORDER BY nome`;
  const pedido = sp.unidade ? Number(sp.unidade) : 0;
  const unitId = escopo ?? (units.some(u => u.id === pedido) ? pedido : 0);
  const defs = await kpisVisiveis(s);
  const [vs, comparativo, estado, cfg] = await Promise.all([visoes(defs, periodo, unitId), escopo === null && unitId === 0 ? comparativoUnidades(defs.filter(porUnidade), periodo) : Promise.resolve(null), estadoBase(), getSettings()]);
  const areas = ORDEM_AREAS.filter(a => defs.some(d => d.area === a));
  const porArea = Object.fromEntries(areas.map(a => [a, vs.filter(v => v.def.area === a)])) as Record<AreaKpi, VisaoKpi[]>;
  const destaques = vs.filter(v => v.def.destaque).sort((a, b) => (a.def.destaque ?? 99) - (b.def.destaque ?? 99));
  const unidadeNome = unitId === 0 ? "Rede (quatro unidades)" : units.find(u => u.id === unitId)?.nome ?? "Unidade";
  const parcial = periodo === h.slice(0, 7);
  return {
    periodo, unitId, escopo, units, defs, vs, porArea, areas, destaques, comparativo, estado, cfg, unidadeNome, parcial,
    frases: leituraDoMes(vs), titulo: `${mesPorExtenso(periodo)}${parcial ? " (mês em andamento)" : ""}`,
    periodos: ultimosPeriodos(h.slice(0, 7), 24).reverse().map(p => ({ valor: p, rotulo: `${rotuloMes(p)}${p === h.slice(0, 7) ? " (parcial)" : ""}` })),
    nomesArea: AREAS,
  };
}
export type Painel = Awaited<ReturnType<typeof carregarPainel>>;

/** Monta o link do painel preservando os filtros. */
export function linkPainel(base: string, p: { periodo: string; unitId: number }, extra: Record<string, string | number | undefined> = {}) {
  const q = new URLSearchParams(); q.set("periodo", p.periodo); if (p.unitId) q.set("unidade", String(p.unitId));
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== "") q.set(k, String(v));
  return `${base}?${q.toString()}`;
}
