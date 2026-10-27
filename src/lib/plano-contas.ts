import { sql } from "@/db";
import type { Session } from "./auth";
import { getSettings, hoje, addDays, audit } from "./utils";
import { competenciaFechada } from "./conciliacao";
import { analiticas, ehAnalitica, macrogrupo, normalizar, ordenarContas, sugerir, SIGLA_SEGMENTO, type Conta, type Centro, type Regra, type ContextoSugestao, type Sugestao } from "./plano-contas-calc";

/**
 * v28 · Plano de contas gerencial, centros de custo e classificação dos lançamentos (catálogo “Plano de contas, centros de custo e
 * orçamento”): natureza (conta hierárquica), centro de custo, comportamento e tipo econômico em campos distintos; a categoria do
 * caixa/DRE/orçamento acompanha a conta (categoria-ponte), então tudo o que já existia continua valendo. Classificar fica na trilha.
 */
type Cfg = Awaited<ReturnType<typeof getSettings>>;
export const vePlano = (s: Session) => ["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE"].includes(s.role);
export const editaPlano = (cfg: Cfg, s: Session) => (cfg.alcadas.financeiro as string[]).includes(s.role);
export const aprovaRateio = (s: Session) => s.role === "DIRECAO";

export async function listarContas(): Promise<Conta[]> {
  const cs = await sql<Conta[]>`SELECT id, codigo, nome, nivel, pai_id, tipo, categoria, tipo_economico, comportamento, recorrencia, controlavel, custo, indice, driver, centro_padrao, generica, palavras, descricao, ativo FROM chart_accounts`;
  return ordenarContas(cs);
}
export type CentroCompleto = Centro & { unidade: string | null; responsavel_user_id: number | null; responsavel: string | null; inicio: string | null; fim: string | null; orcamento: number | null; obs: string | null };
export async function listarCentros(): Promise<CentroCompleto[]> {
  await garantirCentrosPadrao();
  return sql<CentroCompleto[]>`SELECT c.id, c.codigo, c.nome, c.tipo, c.unit_id, c.segmento, c.ativo, u.nome AS unidade, c.responsavel_user_id, us.nome AS responsavel, c.inicio::text, c.fim::text, c.orcamento::float, c.obs
    FROM cost_centers c LEFT JOIN units u ON u.id=c.unit_id LEFT JOIN users us ON us.id=c.responsavel_user_id
    ORDER BY (c.tipo='CORPORATIVO') DESC, u.nome NULLS FIRST, (c.tipo='UNIDADE') DESC, c.tipo, c.codigo`;
}

/**
 * Centros padrão (idempotente): corporativo da rede, o “geral” de cada unidade e um por segmento que a unidade oferece
 * (pelas turmas do ano letivo). Áreas e projetos são criados na tela.
 */
let garantidoEm = 0;
export async function garantirCentrosPadrao() {
  if (Date.now() - garantidoEm < 60_000) return; garantidoEm = Date.now();
  await sql`INSERT INTO cost_centers (codigo, nome, tipo) SELECT 'CORP', 'Corporativo (rede)', 'CORPORATIVO' WHERE NOT EXISTS (SELECT 1 FROM cost_centers WHERE tipo='CORPORATIVO')`;
  await sql`INSERT INTO cost_centers (codigo, nome, tipo, unit_id) SELECT u.codigo, u.nome || ' — Geral', 'UNIDADE', u.id FROM units u
    WHERE NOT EXISTS (SELECT 1 FROM cost_centers c WHERE c.tipo='UNIDADE' AND c.unit_id=u.id) AND NOT EXISTS (SELECT 1 FROM cost_centers c WHERE c.codigo=u.codigo)`;
  const segs = await sql<{ unit_id: number; codigo: string; nome: string; segmento: string }[]>`SELECT DISTINCT c.unit_id, u.codigo, u.nome, g.segmento FROM classes c JOIN units u ON u.id=c.unit_id JOIN grades g ON g.id=c.grade_id
    WHERE c.ano >= ${Number(hoje().slice(0, 4))}`;
  for (const s of segs) {
    const sigla = SIGLA_SEGMENTO[s.segmento] ?? normalizar(s.segmento).split(" ").map(w => w[0]?.toUpperCase() ?? "").join("").slice(0, 3);
    await sql`INSERT INTO cost_centers (codigo, nome, tipo, unit_id, segmento) SELECT ${`${s.codigo}.${sigla}`}, ${`${s.nome} — ${s.segmento}`}, 'SEGMENTO', ${s.unit_id}, ${s.segmento}
      WHERE NOT EXISTS (SELECT 1 FROM cost_centers WHERE tipo='SEGMENTO' AND unit_id=${s.unit_id} AND segmento=${s.segmento}) AND NOT EXISTS (SELECT 1 FROM cost_centers WHERE codigo=${`${s.codigo}.${sigla}`})`;
  }
}

/** Tudo o que a sugestão precisa: contas, centros, regras ativas, unidades e o histórico de cada contraparte já classificada. */
export async function contextoSugestao(): Promise<ContextoSugestao> {
  await garantirCentrosPadrao();
  const [contas, centros, regras, unidades, hist] = await Promise.all([
    listarContas(),
    sql<Centro[]>`SELECT id, codigo, nome, tipo, unit_id, segmento, ativo FROM cost_centers`,
    sql<Regra[]>`SELECT id, padrao, conta_id, cost_center_id, unit_id FROM classification_rules WHERE ativo`,
    sql<{ id: number; codigo: string }[]>`SELECT id, codigo FROM units`,
    sql<{ contraparte: string; conta_id: number; cost_center_id: number | null; n: number }[]>`SELECT contraparte, conta_id, mode() WITHIN GROUP (ORDER BY cost_center_id) AS cost_center_id, count(*)::int AS n
      FROM cash_entries WHERE conta_id IS NOT NULL AND contraparte IS NOT NULL AND data > ${addDays(hoje(), -730)}::date GROUP BY contraparte, conta_id`,
  ]);
  const historico = new Map<string, { contaId: number; centroId: number | null; n: number }[]>();
  for (const h of hist) {
    const k = normalizar(h.contraparte); if (k.length < 3) continue;
    const l = historico.get(k) ?? []; const ja = l.find(x => x.contaId === h.conta_id);
    if (ja) ja.n += h.n; else l.push({ contaId: h.conta_id, centroId: h.cost_center_id, n: h.n });
    historico.set(k, l);
  }
  return { contas, centros, regras, historico, unidades };
}

export type ItemFila = { id: number; unit_id: number; unidade: string; data: string; tipo: string; categoria: string; descricao: string | null; contraparte: string | null; valor: number; forma: string | null; conta_id: number | null; sugestao: Sugestao | null };
/** Fila de classificação: lançamentos sem conta na janela (ou num período) — e, se pedido, os que estão em conta genérica —, com a sugestão de cada um. */
export async function filaClassificacao(f: { unitIds: number[] | null; de: string; ate: string; tipo?: string | null; categoria?: string | null; q?: string | null; limite?: number; generica?: boolean }) {
  const ctx = await contextoSugestao();
  const termo = f.q ? `%${f.q.replace(/[%_]/g, "")}%` : null;
  const filtro = sql`${f.generica ? sql`(c.conta_id IS NULL OR c.conta_id IN (SELECT id FROM chart_accounts WHERE generica))` : sql`c.conta_id IS NULL`} AND c.data >= ${f.de}::date AND c.data <= ${f.ate}::date ${f.unitIds === null ? sql`` : sql`AND c.unit_id = ANY(${f.unitIds}::int[])`}
    ${f.tipo ? sql`AND c.tipo=${f.tipo}` : sql``} ${f.categoria ? sql`AND c.categoria=${f.categoria}` : sql``} ${termo ? sql`AND (coalesce(c.contraparte,'') ILIKE ${termo} OR coalesce(c.descricao,'') ILIKE ${termo})` : sql``}`;
  const [rows, [tot]] = await Promise.all([
    sql<Omit<ItemFila, "sugestao">[]>`SELECT c.id, c.unit_id, u.nome AS unidade, c.data::text, c.tipo, c.categoria, c.descricao, c.contraparte, c.valor::float, c.forma, c.conta_id FROM cash_entries c JOIN units u ON u.id=c.unit_id
      WHERE ${filtro} ORDER BY c.valor DESC, c.data DESC LIMIT ${f.limite ?? 200}`,
    sql<{ n: number; v: number | null }[]>`SELECT count(*)::int AS n, sum(c.valor)::float AS v FROM cash_entries c WHERE ${filtro}`,
  ]);
  // já em conta genérica: sugerir a mesma conta não ajuda — sem sugestão, a pessoa escolhe
  const itens: ItemFila[] = rows.map(r => { const sg = sugerir(r, ctx); return { ...r, sugestao: sg && r.conta_id && sg.contaId === r.conta_id ? null : sg }; });
  return { itens, total: tot?.n ?? 0, valor: tot?.v ?? 0, ctx };
}

export type ResultadoClassificacao = { ok: number; mesmas: number; travados: number; erros: string[] };
/**
 * Classifica lançamentos de caixa com conta (e centro): valida conta analítica ativa e compatível com o tipo, centro ativo e a
 * competência — trocar de categoria em mês fechado é bloqueado; detalhar a conta dentro da mesma categoria (ou o centro) não muda a
 * DRE e é permitido. Antes e depois na auditoria.
 */
export async function classificarLancamentos(s: Session, itens: { id: number; contaId: number; centroId: number | null }[], origem: "MANUAL" | "REGRA" | "SUGESTAO" | "CONTAS_A_PAGAR", motivo: string | null): Promise<ResultadoClassificacao> {
  const cfg = await getSettings(); const r: ResultadoClassificacao = { ok: 0, mesmas: 0, travados: 0, erros: [] };
  if (!itens.length) return r;
  const contas = await listarContas(); const porId = new Map(contas.map(c => [c.id, c]));
  const centros = await sql<Centro[]>`SELECT id, codigo, nome, tipo, unit_id, segmento, ativo FROM cost_centers`; const cPorId = new Map(centros.map(c => [c.id, c]));
  const internas = cfg.dre.internas as string[];
  const ids = itens.map(i => i.id);
  const atuais = await sql<{ id: number; unit_id: number; data: string; tipo: string; categoria: string; conta_id: number | null; cost_center_id: number | null }[]>`SELECT id, unit_id, data::text, tipo, categoria, conta_id, cost_center_id FROM cash_entries WHERE id = ANY(${ids}::int[])`;
  const escopo = ["DIRETOR_UNIDADE", "GESTOR", "COLABORADOR"].includes(s.role) ? s.unitId : null;
  const travas = new Map<string, boolean>();
  for (const it of itens) {
    const l = atuais.find(a => a.id === it.id); if (!l) { r.erros.push(`#${it.id}: lançamento não encontrado.`); continue; }
    if (escopo !== null && l.unit_id !== escopo) { r.erros.push(`#${it.id}: lançamento de outra unidade.`); continue; }
    const c = porId.get(it.contaId);
    if (!c || !c.ativo || !ehAnalitica(c, contas)) { r.erros.push(`#${it.id}: escolha uma conta analítica ativa.`); continue; }
    // entrada não vira despesa (e vice-versa); transferência pode virar entrada/saída e qualquer uma pode virar transferência
    const ehTransf = c.tipo_economico === "TRANSFERENCIA";
    if (!ehTransf && l.tipo === "ENTRADA" && c.tipo !== "ENTRADA") { r.erros.push(`#${it.id}: entrada não vai para conta de despesa.`); continue; }
    if (!ehTransf && l.tipo === "SAIDA" && c.tipo !== "SAIDA") { r.erros.push(`#${it.id}: saída não vai para conta de receita.`); continue; }
    const cc = it.centroId ? cPorId.get(it.centroId) : null;
    if (it.centroId && (!cc || !cc.ativo)) { r.erros.push(`#${it.id}: centro de custo inativo ou inexistente.`); continue; }
    if (cfg.planoContas?.exigirCentroCusto && !it.centroId) { r.erros.push(`#${it.id}: informe o centro de custo.`); continue; }
    const novaCat = c.categoria ?? l.categoria; const novoTipo = ehTransf || internas.includes(novaCat) ? "TRANSFERENCIA" : l.tipo === "TRANSFERENCIA" ? c.tipo : l.tipo;
    if (l.conta_id === c.id && (l.cost_center_id ?? null) === (it.centroId ?? null)) { r.mesmas++; continue; }
    const mudaCat = novaCat !== l.categoria || novoTipo !== l.tipo;
    if (mudaCat) {
      const comp = `${l.data.slice(0, 7)}|${l.unit_id}`;
      if (!travas.has(comp)) travas.set(comp, !!(await competenciaFechada(l.data, l.unit_id)));
      if (travas.get(comp)) { r.travados++; continue; }
    }
    await sql`UPDATE cash_entries SET conta_id=${c.id}, cost_center_id=${it.centroId ?? null}, categoria=${novaCat}, tipo=${novoTipo}, classificado_por=${s.id}, classificado_em=now(), classificacao_origem=${origem}${mudaCat ? sql`, reclassificado_em=now()` : sql``} WHERE id=${l.id}`;
    await audit(s, "classificar lançamento (plano de contas)", "cash_entries", l.id, { conta_id: l.conta_id, cost_center_id: l.cost_center_id, categoria: l.categoria, tipo: l.tipo }, { conta: `${c.codigo} ${c.nome}`, centro: cc?.codigo ?? null, categoria: novaCat, tipo: novoTipo, origem, motivo });
    r.ok++;
  }
  return r;
}

/** Conta e centro de um título de contas a pagar propagados ao lançamento de caixa da baixa (sem mexer na categoria, que já veio do título). */
export async function classificarPelaBaixa(s: Session, cashEntryId: number, contaId: number | null, centroId: number | null) {
  if (!contaId) return;
  await sql`UPDATE cash_entries SET conta_id=${contaId}, cost_center_id=${centroId}, classificado_por=${s.id}, classificado_em=now(), classificacao_origem='CONTAS_A_PAGAR' WHERE id=${cashEntryId}`;
}

export type Qualidade = { saidas: number; n: number; semConta: number; nSemConta: number; generica: number; nGenerica: number; semCentro: number; pctSemConta: number | null; pctGenerica: number | null; pctSemCentro: number | null; meta: number;
  porMacrogrupo: { id: number; codigo: string; nome: string; valor: number; n: number }[]; contrapartes: { contraparte: string; valor: number; n: number }[] };
/** Qualidade da classificação das saídas (sem conta, em conta genérica, sem centro) e o peso de cada macrogrupo. */
export async function qualidadeClassificacao(unitIds: number[] | null, de: string, ate: string): Promise<Qualidade> {
  const cfg = await getSettings(); const internas = [...(cfg.dre.internas as string[])];
  const fu = unitIds === null ? sql`` : sql`AND c.unit_id = ANY(${unitIds}::int[])`;
  const base = sql`c.tipo='SAIDA' AND c.data >= ${de}::date AND c.data <= ${ate}::date AND NOT (c.categoria = ANY(${internas})) ${fu}`;
  const [[t], porConta, contrap, contas] = await Promise.all([
    sql<{ v: number | null; n: number; sem: number | null; nsem: number; gen: number | null; ngen: number; semcc: number | null }[]>`SELECT sum(c.valor)::float AS v, count(*)::int AS n,
        sum(c.valor) FILTER (WHERE c.conta_id IS NULL)::float AS sem, count(*) FILTER (WHERE c.conta_id IS NULL)::int AS nsem,
        sum(c.valor) FILTER (WHERE a.generica)::float AS gen, count(*) FILTER (WHERE a.generica)::int AS ngen, sum(c.valor) FILTER (WHERE c.cost_center_id IS NULL)::float AS semcc
      FROM cash_entries c LEFT JOIN chart_accounts a ON a.id=c.conta_id WHERE ${base}`,
    sql<{ conta_id: number; v: number; n: number }[]>`SELECT c.conta_id, sum(c.valor)::float AS v, count(*)::int AS n FROM cash_entries c WHERE ${base} AND c.conta_id IS NOT NULL GROUP BY 1`,
    sql<{ contraparte: string; valor: number; n: number }[]>`SELECT coalesce(nullif(c.contraparte,''), c.descricao, '(sem contraparte)') AS contraparte, sum(c.valor)::float AS valor, count(*)::int AS n FROM cash_entries c WHERE ${base} AND c.conta_id IS NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
    listarContas(),
  ]);
  const porId = new Map(contas.map(c => [c.id, c])); const mg = new Map<number, { id: number; codigo: string; nome: string; valor: number; n: number }>();
  for (const x of porConta) { const c = porId.get(x.conta_id); if (!c) continue; const g = macrogrupo(c, porId); const m = mg.get(g.id) ?? { id: g.id, codigo: g.codigo, nome: g.nome, valor: 0, n: 0 }; m.valor += x.v; m.n += x.n; mg.set(g.id, m); }
  const v = t?.v ?? 0; const pct = (x: number | null) => v > 0 ? (100 * (x ?? 0)) / v : null;
  return { saidas: v, n: t?.n ?? 0, semConta: t?.sem ?? 0, nSemConta: t?.nsem ?? 0, generica: t?.gen ?? 0, nGenerica: t?.ngen ?? 0, semCentro: t?.semcc ?? 0, pctSemConta: pct(t?.sem ?? 0), pctGenerica: pct(t?.gen ?? 0), pctSemCentro: pct(t?.semcc ?? 0),
    meta: Number(cfg.planoContas?.metaGenericaPct ?? 5), porMacrogrupo: ordenarContas([...mg.values()]), contrapartes: contrap };
}

/** Uso de cada conta (12 meses): lançamentos de caixa e títulos de contas a pagar — base para a árvore e para inativar com segurança. */
export async function usoDasContas(unitIds: number[] | null) {
  const fu = unitIds === null ? sql`` : sql`AND unit_id = ANY(${unitIds}::int[])`;
  const [caixa, cp, regras] = await Promise.all([
    sql<{ conta_id: number; n: number; v: number }[]>`SELECT conta_id, count(*)::int AS n, sum(valor)::float AS v FROM cash_entries WHERE conta_id IS NOT NULL AND data > ${addDays(hoje(), -365)}::date ${fu} GROUP BY 1`,
    sql<{ conta_id: number; n: number }[]>`SELECT conta_id, count(*)::int AS n FROM payables WHERE conta_id IS NOT NULL AND status NOT IN ('REJEITADO','CANCELADO') ${fu} GROUP BY 1`,
    sql<{ conta_id: number; n: number }[]>`SELECT conta_id, count(*)::int AS n FROM classification_rules WHERE ativo GROUP BY 1`,
  ]);
  return { caixa: new Map(caixa.map(x => [x.conta_id, x])), cp: new Map(cp.map(x => [x.conta_id, x.n])), regras: new Map(regras.map(x => [x.conta_id, x.n])) };
}

/** Conta analítica válida para lançar (usada por contas a pagar e pelas telas): devolve a conta ou o motivo. */
export async function contaParaLancar(contaId: number, tipo: "SAIDA" | "ENTRADA"): Promise<{ conta: Conta } | { erro: string }> {
  const contas = await listarContas(); const c = contas.find(x => x.id === contaId);
  if (!c) return { erro: "Conta do plano não encontrada." };
  if (!c.ativo) return { erro: `A conta ${c.codigo} está inativa.` };
  if (!ehAnalitica(c, contas)) return { erro: `${c.codigo} ${c.nome} é um grupo: escolha uma conta analítica.` };
  if (c.tipo !== tipo) return { erro: tipo === "SAIDA" ? "Escolha uma conta de despesa." : "Escolha uma conta de receita." };
  if (!c.categoria) return { erro: `A conta ${c.codigo} não tem categoria-ponte.` };
  return { conta: c };
}

/** Opções do seletor de conta (analíticas ativas do tipo), agrupadas pelo macrogrupo. */
export function opcoesConta(contas: Conta[], tipo: "SAIDA" | "ENTRADA") {
  const porId = new Map(contas.map(c => [c.id, c]));
  const an = analiticas(contas.filter(c => c.ativo)).filter(c => c.tipo === tipo && (tipo === "ENTRADA" || c.tipo_economico !== "TRANSFERENCIA"));
  const grupos = new Map<string, { grupo: string; contas: { id: number; codigo: string; nome: string; categoria: string | null; economico: string; centro: string; generica: boolean }[] }>();
  for (const c of an) { const g = macrogrupo(c, porId); const k = `${g.codigo} ${g.nome}`; const x = grupos.get(k) ?? { grupo: k, contas: [] }; x.contas.push({ id: c.id, codigo: c.codigo, nome: c.nome, categoria: c.categoria, economico: c.tipo_economico, centro: c.centro_padrao, generica: c.generica }); grupos.set(k, x); }
  return [...grupos.values()];
}
