import { sql } from "@/db";
import { getSettings, hoje, addDays, type Settings } from "./utils";
import { scopeUnit, type Session } from "./auth";
import { podePrivacidade } from "./privacidade";
import { CALCS, type Linha, type Ctx } from "./kpi-calc";
import {
  CATALOGO, CATALOGO_VERSAO, KPI, agregar, preenche, porUnidade, acumulado, ultimaMedicao, farolKpi, nomeKpi, razaoPonto,
  type KpiDef, type AreaKpi, type Ponto, type VisaoKpi,
} from "./kpi-catalogo";
import { somaMeses, ultimosPeriodos } from "./gestao-calc";

/**
 * Base de indicadores (v23): calcula, guarda e lê a série mensal de cada indicador do catálogo, por unidade e rede.
 * - Reconstruídos: recalculados dos registros (24 meses) quando a base é criada ou o catálogo muda; depois, todo dia, o mês atual e o anterior.
 * - Retratos: a foto do dia é guardada no mês corrente (o último dia do mês fica como valor do mês).
 * A leitura nunca inventa número: mês sem medição fica vazio (e aparece em branco nos gráficos).
 */

const LOCK = 2026101701;
export type EstadoBase = { versao: string; completoEm: string | null; recenteEm: string | null; falhas: string[]; duracaoMs?: number };

// ------------------------------------------------------------------ permissões
const TODAS: AreaKpi[] = ["pessoas", "matriculas", "financeiro", "operacoes", "estrategia"];
export const AREAS_POR_PERFIL: Record<string, AreaKpi[]> = {
  DIRECAO: TODAS, RH: TODAS, DIRETOR_UNIDADE: TODAS, GESTOR: ["pessoas", "matriculas", "operacoes", "estrategia"], FINANCEIRO: ["financeiro", "matriculas", "operacoes", "estrategia"],
  OPERACOES: ["operacoes", "estrategia"], COMERCIAL: ["matriculas", "estrategia"], LEITURA: ["pessoas", "matriculas", "operacoes", "estrategia"], COLABORADOR: [],
};
export const vePainelExecutivo = (s: Session) => (AREAS_POR_PERFIL[s.role] ?? []).length > 0;

/** Indicadores que o perfil enxerga: pela área, pelas restrições (salarial, privacidade) e, para quem tem escopo de unidade, só os que têm quebra por unidade. */
export async function kpisVisiveis(s: Session): Promise<KpiDef[]> {
  const areas = new Set(AREAS_POR_PERFIL[s.role] ?? []); let priv = ["DIRECAO", "RH"].includes(s.role);
  if (!priv) priv = await podePrivacidade(s).catch(() => false);
  const escopo = scopeUnit(s);
  return CATALOGO.filter(k => areas.has(k.area) && (k.restricao !== "SALARIAL" || ["DIRECAO", "RH", "FINANCEIRO"].includes(s.role)) && (k.restricao !== "PRIVACIDADE" || priv) && (escopo === null || porUnidade(k)));
}
export const podeEditarMeta = (s: Session, k: KpiDef) => s.role === "DIRECAO" || (s.role === "RH" && k.area !== "financeiro") || (s.role === "FINANCEIRO" && k.area === "financeiro");
export const podeComentar = (s: Session) => !["LEITURA", "COLABORADOR"].includes(s.role);
/** Recalcular a base inteira: Direção e RH. */
export const podeRecalcular = (s: Session) => ["DIRECAO", "RH"].includes(s.role);

// ------------------------------------------------------------------ cálculo e gravação
async function unidades(): Promise<{ id: number; nome: string; codigo: string }[]> { return sql`SELECT id, nome, codigo FROM units ORDER BY nome`; }

/** Corte do período: 1º dia do mês seguinte — no mês corrente, amanhã. */
const fimDoPeriodo = (p: string, amanha: string) => { const f = `${somaMeses(p, 1)}-01`; return f > amanha ? amanha : f; };

/** Monta a grade completa (cada período × cada unidade + rede) a partir das linhas calculadas e grava. Devolve o número de linhas gravadas. */
export function montarGrade(k: KpiDef, linhas: Linha[], periodos: string[], units: number[], inicio: string | null, temInicio: boolean, amanha: string, minimo: number | null) {
  const mapa = new Map<string, Linha>();
  for (const l of linhas) {
    const chave = `${l.periodo}|${l.unit_id ?? 0}`; const x = mapa.get(chave);
    if (!x) { mapa.set(chave, { ...l, unit_id: l.unit_id ?? 0 }); continue; }
    const soma = (a?: number | null, b?: number | null) => (a === null || a === undefined) && (b === null || b === undefined) ? null : (a ?? 0) + (b ?? 0);
    x.valor = soma(x.valor, l.valor); x.num = soma(x.num, l.num); x.den = soma(x.den, l.den);
  }
  const fator = k.fator ?? 1; const vazio: Ponto = { valor: null, num: null, den: null };
  const ponto = (l: Linha | undefined): Ponto => {
    if (!l) return vazio;
    if (k.agregacao === "TAXA") { const num = l.num ?? null, den = l.den ?? null; return { num, den, valor: razaoPonto(num, den, fator) }; }
    return { valor: l.valor ?? null, num: null, den: null };
  };
  const sup = (p: Ponto): Ponto => minimo !== null && p.den !== null && p.den < minimo ? vazio : p;
  const out: { chave: string; periodo: string; unit_id: number; valor: number | null; num: number | null; den: number | null; origem: string }[] = [];
  for (const per of periodos) {
    const semDados = (temInicio && inicio === null) || (inicio !== null && fimDoPeriodo(per, amanha) <= inicio);
    const pts = units.map(u => { if (semDados) return vazio; const l = mapa.get(`${per}|${u}`); if (l) return ponto(l); return preenche(k) && temInicio ? { valor: 0, num: null, den: null } : vazio; });
    const extra = semDados || k.redeDireta ? null : mapa.get(`${per}|0`);
    const rede = semDados ? vazio : k.redeDireta ? ponto(mapa.get(`${per}|0`)) : agregar(k, extra ? [...pts, ponto(extra)] : pts, k.chave === "financeiro.caixa");
    const origem = k.historico === "RETRATO" ? "RETRATO" : "CALCULADO";
    if (porUnidade(k)) units.forEach((u, i) => { const p = sup(pts[i]); out.push({ chave: k.chave, periodo: per, unit_id: u, valor: p.valor, num: p.num, den: p.den, origem }); });
    const r = sup(rede); out.push({ chave: k.chave, periodo: per, unit_id: 0, valor: r.valor, num: r.num, den: r.den, origem });
  }
  return out;
}

async function calcularKpi(k: KpiDef, ctx: Ctx, periodos: string[]) {
  const c = CALCS[k.chave]; if (!c) return 0;
  const [linhas, inicio] = await Promise.all([c.calc(ctx), c.inicio ? c.inicio(ctx) : Promise.resolve(null)]);
  const grade = montarGrade(k, linhas, periodos, ctx.units, inicio, !!c.inicio, ctx.amanha, k.minimoDen ? k.minimoDen(ctx.cfg) : null);
  for (let i = 0; i < grade.length; i += 500) {
    const lote = grade.slice(i, i + 500);
    await sql`INSERT INTO kpi_series ${sql(lote, "chave", "periodo", "unit_id", "valor", "num", "den", "origem")} ON CONFLICT (chave, periodo, unit_id) DO UPDATE SET valor=EXCLUDED.valor, num=EXCLUDED.num, den=EXCLUDED.den, origem=EXCLUDED.origem, calculado_em=now()`;
  }
  return grade.length;
}

/** Recalcula a base: "todos" = histórico inteiro (24 meses); "recentes" = mês atual e anterior. Retratos sempre só no mês atual. */
export async function atualizarKpis(modo: "todos" | "recentes", chaves?: string[]) {
  const t0 = Date.now(); const cfg = await getSettings(); const h = hoje(); const atual = h.slice(0, 7); const n = Math.max(13, Math.min(36, Number(cfg.insights?.mesesHistorico) || 24));
  const periodos = ultimosPeriodos(atual, modo === "todos" ? n : 2); const units = (await unidades()).map(u => u.id); const amanha = addDays(h, 1);
  const falhas: string[] = []; let linhas = 0;
  const fila = CATALOGO.filter(k => !chaves || chaves.includes(k.chave));
  // três cálculos por vez: o banco tem 5 conexões e uma pode estar reservada para a trava
  const trabalhador = async () => { for (let k = fila.shift(); k; k = fila.shift()) {
    const ps = k.historico === "RETRATO" ? [atual] : periodos;
    try { const n = await calcularKpi(k, { de: ps[0], ate: ps[ps.length - 1], amanha, hoje: h, cfg, units }, ps); linhas += n; }
    catch (e) { falhas.push(`${k.chave}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300)); }
  } };
  await Promise.all([trabalhador(), trabalhador(), trabalhador()]);
  if (!chaves) {
    const [ant] = await sql<{ value: EstadoBase }[]>`SELECT value FROM settings WHERE key='kpi_base'`;
    const estado: EstadoBase = { versao: CATALOGO_VERSAO, completoEm: modo === "todos" ? new Date().toISOString() : ant?.value?.completoEm ?? null, recenteEm: h, falhas, duracaoMs: Date.now() - t0 };
    await sql`INSERT INTO settings (key, value) VALUES ('kpi_base', ${JSON.stringify(estado)}::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`;
  }
  return { linhas, falhas, duracaoMs: Date.now() - t0 };
}

export async function estadoBase(): Promise<EstadoBase | null> {
  const [r] = await sql<{ value: EstadoBase }[]>`SELECT value FROM settings WHERE key='kpi_base'`.catch(() => [] as { value: EstadoBase }[]); return r?.value ?? null;
}

/**
 * Garante a base em dia antes de uma leitura: na primeira vez (ou quando o catálogo muda) reconstrói tudo; depois, uma vez por dia, só os meses recentes.
 * Só um cálculo por vez (trava no banco): quem chega durante a primeira construção espera ela terminar; depois disso, usa o que já existe.
 */
export async function garantirKpis(forcar: "todos" | null = null) {
  const e = await estadoBase(); const h = hoje();
  const precisaTodos = forcar === "todos" || !e || e.versao !== CATALOGO_VERSAO || !e.completoEm;
  if (!precisaTodos && e!.recenteEm === h) return { calculou: false };
  const r = await sql.reserve();
  try {
    const [{ ok }] = await r<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(${LOCK}) AS ok`;
    if (!ok) {
      if (!precisaTodos || forcar) return { calculou: false, ocupado: true };
      await r`SELECT pg_advisory_lock(${LOCK})`; await r`SELECT pg_advisory_unlock(${LOCK})`; return { calculou: false };
    }
    try {
      const de2 = await estadoBase(); // pode ter sido atualizada enquanto esperava a trava
      const aindaTodos = forcar === "todos" || !de2 || de2.versao !== CATALOGO_VERSAO || !de2.completoEm;
      if (!aindaTodos && de2!.recenteEm === h) return { calculou: false };
      const res = await atualizarKpis(aindaTodos ? "todos" : "recentes"); return { calculou: true, ...res };
    } finally { await r`SELECT pg_advisory_unlock(${LOCK})`; }
  } finally { r.release(); }
}

// ------------------------------------------------------------------ leitura
export type MapaSeries = Map<string, Map<string, Ponto>>; // `${chave}|${unit}` → período → ponto
export async function lerSeries(chaves: string[], unitIds: number[], de: string, ate: string): Promise<MapaSeries> {
  const out: MapaSeries = new Map(); if (!chaves.length || !unitIds.length) return out;
  const rows = await sql<{ chave: string; periodo: string; unit_id: number; valor: number | null; num: number | null; den: number | null }[]>`SELECT chave, periodo, unit_id, valor::float, num::float, den::float FROM kpi_series WHERE chave = ANY(${chaves}) AND unit_id = ANY(${unitIds}) AND periodo >= ${de} AND periodo <= ${ate}`;
  for (const r of rows) { const k = `${r.chave}|${r.unit_id}`; if (!out.has(k)) out.set(k, new Map()); out.get(k)!.set(r.periodo, { valor: r.valor, num: r.num, den: r.den }); }
  return out;
}

export type Meta = { meta: number; alerta: number | null; periodicidade: "MENSAL" | "ANUAL"; unit_id: number; obs: string | null; user_nome: string | null };
export async function metasDoAno(ano: number): Promise<Map<string, Meta>> {
  const rows = await sql<(Meta & { chave: string })[]>`SELECT chave, unit_id, meta::float, alerta::float, periodicidade, obs, user_nome FROM kpi_targets WHERE ano=${ano}`;
  return new Map(rows.map(r => [`${r.chave}|${r.unit_id}`, r]));
}

/** Orçamento do mês por unidade (0 = rede): mês a mês quando cadastrado, senão o valor mensal fixo do ano. */
export async function orcamentoMensal(ano: number, unitId: number): Promise<Map<number, { ENTRADA: number | null; SAIDA: number | null }>> {
  const rows = await sql<{ mes: number; tipo: string; valor: number }[]>`WITH cats AS (SELECT DISTINCT unit_id, tipo, categoria FROM budgets WHERE ano=${ano} UNION SELECT DISTINCT unit_id, tipo, categoria FROM budget_months WHERE ano=${ano}),
      meses AS (SELECT generate_series(1, 12) AS mes)
    SELECT ms.mes, c.tipo, sum(coalesce(bm.valor, b.valor_mensal))::float AS valor FROM cats c CROSS JOIN meses ms
      LEFT JOIN budget_months bm ON bm.ano=${ano} AND bm.unit_id=c.unit_id AND bm.tipo=c.tipo AND bm.categoria=c.categoria AND bm.mes=ms.mes
      LEFT JOIN budgets b ON b.ano=${ano} AND b.unit_id=c.unit_id AND b.tipo=c.tipo AND b.categoria=c.categoria
    WHERE (${unitId}::int = 0 OR c.unit_id=${unitId}) AND coalesce(bm.valor, b.valor_mensal) IS NOT NULL GROUP BY 1, 2`;
  const m = new Map<number, { ENTRADA: number | null; SAIDA: number | null }>();
  for (const r of rows) { const x = m.get(r.mes) ?? { ENTRADA: null, SAIDA: null }; if (r.tipo === "ENTRADA" || r.tipo === "SAIDA") x[r.tipo] = r.valor; m.set(r.mes, x); }
  return m;
}

export function metaDe(k: KpiDef, metas: Map<string, Meta>, unitId: number, cfg: Settings, orc: Map<number, { ENTRADA: number | null; SAIDA: number | null }> | null, periodo: string) {
  // a meta da rede vale para a unidade só em razões (%, pontos, médias); contagens e valores da rede não servem de meta para uma unidade
  const cad = metas.get(`${k.chave}|${unitId}`) ?? (unitId !== 0 && k.agregacao === "TAXA" ? metas.get(`${k.chave}|0`) : undefined);
  if (cad) return { meta: cad.meta, alerta: cad.alerta, periodicidade: (k.agregacao === "SOMA" ? cad.periodicidade : "MENSAL") as "MENSAL" | "ANUAL", fonte: "CADASTRADA" as const, herdada: cad.unit_id !== unitId };
  if (k.metaOrcamento && orc) { const o = orc.get(Number(periodo.slice(5, 7))); const v = !o ? null : k.metaOrcamento === "RESULTADO" ? (o.ENTRADA !== null || o.SAIDA !== null ? (o.ENTRADA ?? 0) - (o.SAIDA ?? 0) : null) : o[k.metaOrcamento]; if (v !== null && v !== undefined) return { meta: v, alerta: null, periodicidade: "MENSAL" as const, fonte: "ORCAMENTO" as const, herdada: false }; }
  const p = k.agregacao === "TAXA" ? k.metaPadrao?.(cfg) : null; if (p !== null && p !== undefined && Number.isFinite(p)) return { meta: p, alerta: null, periodicidade: "MENSAL" as const, fonte: "PADRAO" as const, herdada: false };
  return null;
}

/** Monta a visão de cada indicador para o período e a unidade (0 = rede): valor, comparações, acumulado, meta e farol. */
export async function visoes(defs: KpiDef[], periodo: string, unitId: number, meses = 24): Promise<VisaoKpi[]> {
  if (!defs.length) return [];
  const cfg = await getSettings(); const de = somaMeses(periodo, -(Math.max(meses, 24) - 1));
  const [series, metas, orc] = await Promise.all([lerSeries(defs.map(d => d.chave), [unitId], de, periodo), metasDoAno(Number(periodo.slice(0, 4))),
    defs.some(d => d.metaOrcamento) ? orcamentoMensal(Number(periodo.slice(0, 4)), unitId) : Promise.resolve(null)]);
  const tol = Number(cfg.insights?.toleranciaPct ?? 10); const anoLetivo = cfg.matriculas.anoLetivo as number;
  return defs.map(k => {
    const s = series.get(`${k.chave}|${unitId}`) ?? new Map<string, Ponto>();
    const ev = k.historico === "EVENTO" ? ultimaMedicao(s, periodo) : null;
    const valor = k.historico === "EVENTO" ? ev?.valor ?? null : s.get(periodo)?.valor ?? null;
    const refAnt = k.historico === "EVENTO" && ev ? ultimaMedicao(s, somaMeses(ev.periodo, -1)) : null;
    const anterior = k.historico === "EVENTO" ? refAnt?.valor ?? null : s.get(somaMeses(periodo, -1))?.valor ?? null;
    const anoAnterior = s.get(somaMeses(periodo, -12))?.valor ?? null;
    const m = metaDe(k, metas, unitId, cfg, orc, periodo);
    const acc = acumulado(k, s, periodo); const accAnt = acumulado(k, s, somaMeses(periodo, -12));
    const mesAno = Number(periodo.slice(5, 7));
    const far = !m ? farolKpi(valor, null, null, k.sentido, tol) : m.periodicidade === "ANUAL" ? farolKpi(acc, m.meta * mesAno / 12, m.alerta === null ? null : m.alerta * mesAno / 12, k.sentido, tol) : farolKpi(valor, m.meta, m.alerta, k.sentido, tol);
    return {
      def: k, nome: nomeKpi(k, anoLetivo), periodo, valor, medidoEm: ev?.periodo ?? null, den: s.get(ev?.periodo ?? periodo)?.den ?? null, anterior, anoAnterior, acumulado: acc, acumuladoAnoAnterior: accAnt,
      meta: m?.meta ?? null, alerta: m?.alerta ?? null, metaFonte: m?.fonte ?? null, periodicidade: m?.periodicidade ?? "MENSAL", farol: far,
      serie: ultimosPeriodos(periodo, meses).map(p => ({ periodo: p, valor: s.get(p)?.valor ?? null })),
    };
  });
}

/** Valores por unidade (e rede) no período, com o farol de cada célula contra a meta da própria unidade (ou da rede). */
export async function comparativoUnidades(defs: KpiDef[], periodo: string) {
  const cfg = await getSettings(); const us = await unidades(); const ids = [...us.map(u => u.id), 0];
  const [series, metas] = await Promise.all([lerSeries(defs.map(d => d.chave), ids, somaMeses(periodo, -12), periodo), metasDoAno(Number(periodo.slice(0, 4)))]);
  const orcs = new Map<number, Map<number, { ENTRADA: number | null; SAIDA: number | null }>>();
  if (defs.some(d => d.metaOrcamento)) for (const id of ids) orcs.set(id, await orcamentoMensal(Number(periodo.slice(0, 4)), id));
  const tol = Number(cfg.insights?.toleranciaPct ?? 10);
  const celulas = new Map<string, { valor: number | null; farol: ReturnType<typeof farolKpi>; medidoEm: string | null; meta: number | null }>();
  for (const k of defs) for (const id of ids) {
    const s = series.get(`${k.chave}|${id}`) ?? new Map<string, Ponto>(); const ev = k.historico === "EVENTO" ? ultimaMedicao(s, periodo, 13) : null;
    const valor = k.historico === "EVENTO" ? ev?.valor ?? null : s.get(periodo)?.valor ?? null;
    const m = metaDe(k, metas, id, cfg, orcs.get(id) ?? null, periodo); const mesAno = Number(periodo.slice(5, 7));
    const far = !m ? farolKpi(valor, null, null, k.sentido, tol) : m.periodicidade === "ANUAL" ? farolKpi(acumulado(k, s, periodo), m.meta * mesAno / 12, m.alerta === null ? null : m.alerta * mesAno / 12, k.sentido, tol) : farolKpi(valor, m.meta, m.alerta, k.sentido, tol);
    celulas.set(`${k.chave}|${id}`, { valor, farol: far, medidoEm: ev?.periodo ?? null, meta: m?.meta ?? null });
  }
  return { unidades: us, celulas };
}

/** Comentários da gestão: na rede (sem escopo), todos; numa unidade, os dela e os da rede. */
export async function comentarios(chave: string, unitId: number, todos = false) {
  return sql<{ id: number; periodo: string; unit_id: number; unidade: string | null; texto: string; user_id: number | null; user_nome: string | null; created_at: Date }[]>`SELECT c.id, c.periodo, c.unit_id, u.nome AS unidade, c.texto, c.user_id, c.user_nome, c.created_at FROM kpi_comments c LEFT JOIN units u ON u.id=c.unit_id WHERE c.chave=${chave} AND (${todos} OR c.unit_id=${unitId} OR c.unit_id=0) ORDER BY c.periodo DESC, c.id DESC LIMIT 200`;
}

/** Período padrão do painel: o último mês fechado (até o dia 5, o anterior a ele não muda mais). */
export function periodoPadrao(h = hoje()) { return somaMeses(h.slice(0, 7), -1); }
export const periodoValido = (p: string | undefined | null, h = hoje()) => !!p && /^\d{4}-(0[1-9]|1[0-2])$/.test(p) && p <= h.slice(0, 7) && p >= somaMeses(h.slice(0, 7), -35);

export { KPI, CATALOGO };
