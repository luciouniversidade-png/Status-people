import { sql } from "@/db";
import { getSettings, hoje, addDays } from "./utils";
import { compromissosAprovados } from "./despesas";

/**
 * FP&A (v23): orçado × realizado mês a mês e acumulado, ano anterior, previsão de fechamento, desvios explicados,
 * cascata do resultado e caixa projetado para 30/60/90 dias. Realizado = caixa (entradas e saídas importadas ou lançadas).
 * O orçamento do mês vem de budget_months; sem ele, do valor mensal fixo de budgets.
 */
export type TipoFpa = "ENTRADA" | "SAIDA";
type Mapa12 = Map<string, (number | null)[]>; // `${tipo}|${categoria}` → 12 meses
const vazio12 = () => Array<number | null>(12).fill(null);

export async function orcamentoAnual(ano: number, unitId: number | null): Promise<Mapa12> {
  const rows = await sql<{ tipo: string; categoria: string; mes: number; valor: number }[]>`WITH cats AS (SELECT DISTINCT unit_id, tipo, categoria FROM budgets WHERE ano=${ano} UNION SELECT DISTINCT unit_id, tipo, categoria FROM budget_months WHERE ano=${ano})
    SELECT c.tipo, c.categoria, ms.mes, sum(coalesce(bm.valor, b.valor_mensal))::float AS valor FROM cats c CROSS JOIN generate_series(1, 12) AS ms(mes)
      LEFT JOIN budget_months bm ON bm.ano=${ano} AND bm.unit_id=c.unit_id AND bm.tipo=c.tipo AND bm.categoria=c.categoria AND bm.mes=ms.mes
      LEFT JOIN budgets b ON b.ano=${ano} AND b.unit_id=c.unit_id AND b.tipo=c.tipo AND b.categoria=c.categoria
    WHERE (${unitId}::int IS NULL OR c.unit_id=${unitId}) AND coalesce(bm.valor, b.valor_mensal) IS NOT NULL GROUP BY 1, 2, 3`;
  const m: Mapa12 = new Map();
  for (const r of rows) { const k = `${r.tipo}|${r.categoria}`; if (!m.has(k)) m.set(k, vazio12()); m.get(k)![r.mes - 1] = r.valor; }
  return m;
}

export async function realizadoAnual(ano: number, unitId: number | null, ate?: string): Promise<Mapa12> {
  const rows = await sql<{ tipo: string; categoria: string; mes: number; valor: number }[]>`SELECT tipo, categoria, extract(month FROM data)::int AS mes, sum(valor)::float AS valor FROM cash_entries
    WHERE tipo IN ('ENTRADA','SAIDA') AND data >= ${`${ano}-01-01`}::date AND data < ${`${ano + 1}-01-01`}::date ${ate ? sql`AND data <= ${ate}::date` : sql``} ${unitId === null ? sql`` : sql`AND unit_id=${unitId}`} GROUP BY 1, 2, 3`;
  const m: Mapa12 = new Map();
  for (const r of rows) { const k = `${r.tipo}|${r.categoria}`; if (!m.has(k)) m.set(k, vazio12()); m.get(k)![r.mes - 1] = r.valor; }
  return m;
}

const soma = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
const media = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

export type LinhaFpa = {
  tipo: TipoFpa; categoria: string; orc: (number | null)[]; real: (number | null)[]; ant: (number | null)[];
  orcMes: number | null; realMes: number | null; antMes: number | null; orcAcum: number | null; realAcum: number | null; antAcum: number | null;
  orcAno: number | null; previsao: number | null; comentarios: number;
};
/** Variação "boa" ou "ruim": receita abaixo do orçado e despesa acima são desfavoráveis. */
export function desvio(tipo: TipoFpa, orcado: number | null, real: number | null) {
  if (orcado === null || real === null) return null;
  const abs = real - orcado; const pct = orcado !== 0 ? (100 * abs) / Math.abs(orcado) : null;
  const favoravel = tipo === "ENTRADA" ? abs >= 0 : abs <= 0;
  const tom: "bom" | "atencao" | "ruim" = favoravel ? "bom" : pct !== null && Math.abs(pct) <= 5 ? "atencao" : "ruim";
  return { abs, pct, favoravel, tom };
}

/**
 * Previsão de fechamento do ano por categoria: realizado até o mês de referência + orçado dos meses seguintes
 * (sem orçamento no mês, a média dos três últimos meses realizados).
 */
export function previsaoAno(real: (number | null)[], orc: (number | null)[], mesRef: number) {
  const feito = soma(real.slice(0, mesRef)); const base = media(real.slice(Math.max(0, mesRef - 3), mesRef));
  let resto = 0; let algum = false;
  for (let m = mesRef; m < 12; m++) { const v = orc[m] ?? base; if (v !== null) { resto += v; algum = true; } }
  if (feito === null && !algum) return null;
  return (feito ?? 0) + resto;
}

export async function fpa(ano: number, unitId: number | null, mesRef: number) {
  const cfg = await getSettings(); const h = hoje();
  const [orc, real, ant, coments] = await Promise.all([orcamentoAnual(ano, unitId), realizadoAnual(ano, unitId, h), realizadoAnual(ano - 1, unitId),
    sql<{ tipo: string; categoria: string; mes: number; n: number }[]>`SELECT tipo, categoria, mes, count(*)::int AS n FROM budget_comments WHERE ano=${ano} ${unitId === null ? sql`` : sql`AND (unit_id=${unitId} OR unit_id IS NULL)`} GROUP BY 1, 2, 3`]);
  const ordem = [...(cfg.financeiro.categoriasEntrada as string[]).map(c => `ENTRADA|${c}`), ...(cfg.financeiro.categoriasSaida as string[]).map(c => `SAIDA|${c}`)];
  const chaves = [...new Set([...ordem, ...orc.keys(), ...real.keys(), ...ant.keys()])].filter(k => orc.has(k) || real.has(k) || ant.has(k));
  chaves.sort((a, b) => (a.startsWith("ENTRADA") ? 0 : 1) - (b.startsWith("ENTRADA") ? 0 : 1) || (ordem.indexOf(a) < 0 ? 999 : ordem.indexOf(a)) - (ordem.indexOf(b) < 0 ? 999 : ordem.indexOf(b)) || a.localeCompare(b));
  // sem nenhum lançamento de caixa no ano, o realizado fica vazio (o caixa não foi importado) — nunca vira zero
  const temRealizado = real.size > 0;
  const linhas: LinhaFpa[] = chaves.map(k => {
    const [tipo, categoria] = k.split("|") as [TipoFpa, string]; const o = orc.get(k) ?? vazio12(); const r = real.get(k) ?? vazio12(); const a = ant.get(k) ?? vazio12();
    const rz = r.map((x, i) => x ?? (temRealizado && i < mesRef ? 0 : null)); // mês decorrido sem lançamento na categoria = zero realizado
    return { tipo, categoria, orc: o, real: rz, ant: a, orcMes: o[mesRef - 1], realMes: rz[mesRef - 1], antMes: a[mesRef - 1], orcAcum: soma(o.slice(0, mesRef)), realAcum: soma(rz.slice(0, mesRef)), antAcum: soma(a.slice(0, mesRef)), orcAno: soma(o), previsao: previsaoAno(rz, o, mesRef), comentarios: coments.filter(c => c.tipo === tipo && c.categoria === categoria).reduce((x, c) => x + c.n, 0) };
  });
  const total = (tipo: TipoFpa, campo: keyof Pick<LinhaFpa, "orcMes" | "realMes" | "antMes" | "orcAcum" | "realAcum" | "antAcum" | "orcAno" | "previsao">) => soma(linhas.filter(l => l.tipo === tipo).map(l => l[campo]));
  const campos = ["orcMes", "realMes", "antMes", "orcAcum", "realAcum", "antAcum", "orcAno", "previsao"] as const;
  const tot = Object.fromEntries(campos.map(c => [c, { ENTRADA: total("ENTRADA", c), SAIDA: total("SAIDA", c) }])) as Record<typeof campos[number], { ENTRADA: number | null; SAIDA: number | null }>;
  const res = (c: typeof campos[number]) => tot[c].ENTRADA === null && tot[c].SAIDA === null ? null : (tot[c].ENTRADA ?? 0) - (tot[c].SAIDA ?? 0);
  const mesesSerie = (fonte: "orc" | "real" | "ant", tipo: TipoFpa) => Array.from({ length: 12 }, (_, i) => soma(linhas.filter(l => l.tipo === tipo).map(l => l[fonte][i])));
  return {
    linhas, tot, resultado: Object.fromEntries(campos.map(c => [c, res(c)])) as Record<typeof campos[number], number | null>,
    serie: { realEnt: mesesSerie("real", "ENTRADA"), realSai: mesesSerie("real", "SAIDA"), orcEnt: mesesSerie("orc", "ENTRADA"), orcSai: mesesSerie("orc", "SAIDA"), antEnt: mesesSerie("ant", "ENTRADA"), antSai: mesesSerie("ant", "SAIDA") },
    temOrcamento: linhas.some(l => l.orc.some(x => x !== null)), temRealizado,
  };
}
export type Fpa = Awaited<ReturnType<typeof fpa>>;

/** Passos da cascata do resultado (orçado → desvios por categoria → realizado). As maiores variações aparecem; o resto vira "demais". */
export function passosCascata(f: Fpa, visao: "mes" | "acumulado", max = 4) {
  const oc = visao === "mes" ? "orcMes" : "orcAcum"; const rc = visao === "mes" ? "realMes" : "realAcum";
  const orcado = f.resultado[oc]; const realizado = f.resultado[rc];
  if (orcado === null || realizado === null) return [];
  const impacto = f.linhas.filter(l => l[oc] !== null || l[rc] !== null).map(l => ({ rotulo: l.categoria, tipo: l.tipo, v: l.tipo === "ENTRADA" ? (l[rc] ?? 0) - (l[oc] ?? 0) : -((l[rc] ?? 0) - (l[oc] ?? 0)) })).filter(x => Math.abs(x.v) >= 0.5);
  impacto.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const top = impacto.slice(0, max); const resto = impacto.slice(max).reduce((a, x) => a + x.v, 0);
  return [{ rotulo: "Resultado orçado", valor: orcado, tipo: "total" as const }, ...top.map(x => ({ rotulo: `${x.tipo === "ENTRADA" ? "Receita" : "Despesa"}: ${x.rotulo}`, valor: x.v, tipo: "delta" as const })), ...(Math.abs(resto) >= 0.5 ? [{ rotulo: "Demais categorias", valor: resto, tipo: "delta" as const }] : []), { rotulo: "Resultado realizado", valor: realizado, tipo: "total" as const }];
}

/** Orçado × realizado por unidade (mês ou acumulado). */
export async function porUnidade(ano: number, mesRef: number, visao: "mes" | "acumulado") {
  const units = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`;
  return Promise.all(units.map(async u => {
    const f = await fpa(ano, u.id, mesRef); const oc = visao === "mes" ? "orcMes" : "orcAcum"; const rc = visao === "mes" ? "realMes" : "realAcum";
    return { id: u.id, nome: u.nome, recOrc: f.tot[oc].ENTRADA, recReal: f.tot[rc].ENTRADA, desOrc: f.tot[oc].SAIDA, desReal: f.tot[rc].SAIDA, resOrc: f.resultado[oc], resReal: f.resultado[rc] };
  }));
}

/**
 * Caixa projetado (30/60/90 dias): saldo de hoje (saldo inicial do mês + movimentos até hoje) + entradas previstas − saídas previstas.
 * Entradas: títulos em aberto a vencer × taxa de recebimento dos últimos 6 meses (cenários: pessimista e otimista nas configurações);
 * sem títulos importados para o período, a média das entradas dos últimos 3 meses. Outras receitas (eventos, outras) pela média.
 * Saídas: orçamento de despesas dos meses seguintes (rateado por dia); sem orçamento na categoria, a média dos últimos 3 meses.
 */
export async function caixaProjetado(unitId: number | null, dias = 91) {
  const cfg = await getSettings(); const h = hoje(); const mes = h.slice(0, 7); const fim = addDays(h, dias);
  const units = await sql<{ id: number }[]>`SELECT id FROM units ${unitId === null ? sql`` : sql`WHERE id=${unitId}`}`;
  const saldos = await sql<{ unit_id: number; saldo_inicial: number }[]>`SELECT unit_id, saldo_inicial::float FROM cash_balances WHERE mes=${mes} ${unitId === null ? sql`` : sql`AND unit_id=${unitId}`}`;
  const semSaldo = units.filter(u => !saldos.some(s => s.unit_id === u.id)).map(u => u.id);
  const [mov] = await sql<{ v: number | null }[]>`SELECT sum(CASE WHEN tipo='ENTRADA' THEN valor WHEN tipo='SAIDA' THEN -valor ELSE 0 END)::float AS v FROM cash_entries WHERE data >= ${`${mes}-01`}::date AND data <= ${h}::date ${unitId === null ? sql`` : sql`AND unit_id=${unitId}`}`;
  const saldoHoje = semSaldo.length ? null : saldos.reduce((a, s) => a + s.saldo_inicial, 0) + (mov?.v ?? 0);
  // taxa de recebimento: média das últimas 6 medições fechadas da base de indicadores (rede ou unidade); sem base, 90%
  const taxas = await sql<{ valor: number }[]>`SELECT valor::float FROM kpi_series WHERE chave='financeiro.recebimento' AND unit_id=${unitId ?? 0} AND valor IS NOT NULL AND periodo < ${mes} ORDER BY periodo DESC LIMIT 6`;
  const taxa = taxas.length ? taxas.reduce((a, t) => a + t.valor, 0) / taxas.length / 100 : 0.9;
  const titulos = await sql<{ data: string; valor: number }[]>`SELECT vencimento::text AS data, sum(valor)::float AS valor FROM receivables WHERE status='ABERTO' AND vencimento > ${h}::date AND vencimento <= ${fim}::date ${unitId === null ? sql`` : sql`AND unit_id=${unitId}`} GROUP BY 1`;
  const ini3 = `${addDays(`${mes}-01`, -92).slice(0, 7)}-01`;
  const medias = await sql<{ tipo: string; categoria: string; valor: number }[]>`SELECT tipo, categoria, (sum(valor) / 3)::float AS valor FROM cash_entries WHERE tipo IN ('ENTRADA','SAIDA') AND data >= ${ini3}::date AND data < ${`${mes}-01`}::date ${unitId === null ? sql`` : sql`AND unit_id=${unitId}`} GROUP BY 1, 2`;
  const usaTitulos = titulos.some(t => t.data <= addDays(h, 35));
  const cobertasPorTitulos = new Set(["Mensalidades", "Integral", "Material e taxas"]);
  const anos = [...new Set([h.slice(0, 4), fim.slice(0, 4)])].map(Number);
  const orcs = new Map<number, Mapa12>(); for (const a of anos) orcs.set(a, await orcamentoAnual(a, unitId));
  const diasNoMes = (iso: string) => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)).getUTCDate();
  const pess = Number(cfg.fpa?.cenarioPessimistaPct ?? 85) / 100, otim = Number(cfg.fpa?.cenarioOtimistaPct ?? 100) / 100;
  // T-029: despesas aprovadas a pagar entram na data programada; o orçamento da categoria no mês é abatido delas (sem contar duas vezes)
  const comp = await compromissosAprovados(unitId); const compMes = new Map<string, number>(); const compDia = new Map<string, number>();
  for (const c of comp) { const k = `${c.categoria}|${c.data.slice(0, 7)}`; compMes.set(k, (compMes.get(k) ?? 0) + c.valor); compDia.set(c.data, (compDia.get(c.data) ?? 0) + c.valor); }
  const pontos: { data: string; entradas: number; entradasMin: number; entradasMax: number; saidas: number }[] = [];
  for (let d = addDays(h, 1); d <= fim; d = addDays(d, 1)) {
    const dm = diasNoMes(d); const orc = orcs.get(Number(d.slice(0, 4)))!; const m = Number(d.slice(5, 7)) - 1;
    let ent = 0, entTit = 0;
    if (usaTitulos) { entTit = titulos.filter(t => t.data === d).reduce((a, t) => a + t.valor, 0); for (const x of medias.filter(x => x.tipo === "ENTRADA" && !cobertasPorTitulos.has(x.categoria))) ent += x.valor / dm; }
    else for (const x of medias.filter(x => x.tipo === "ENTRADA")) ent += x.valor / dm;
    let sai = compDia.get(d) ?? 0; const catsSai = new Set([...medias.filter(x => x.tipo === "SAIDA").map(x => x.categoria), ...[...orc.keys()].filter(k => k.startsWith("SAIDA|")).map(k => k.slice(6))]);
    for (const c of catsSai) { const o = orc.get(`SAIDA|${c}`)?.[m]; const v = o ?? medias.find(x => x.tipo === "SAIDA" && x.categoria === c)?.valor ?? 0; sai += Math.max(0, v - (compMes.get(`${c}|${d.slice(0, 7)}`) ?? 0)) / dm; }
    pontos.push({ data: d, entradas: ent + entTit * taxa, entradasMin: ent * pess + entTit * taxa * pess, entradasMax: ent * otim + entTit * Math.min(1, otim), saidas: sai });
  }
  const acum = (n: number, campo: "entradas" | "entradasMin" | "entradasMax" | "saidas") => pontos.slice(0, n).reduce((a, p) => a + p[campo], 0);
  const marcos = [30, 60, 90].map(n => ({ dias: n, ate: addDays(h, n), entradas: acum(n, "entradas"), saidas: acum(n, "saidas"), saldo: saldoHoje === null ? null : saldoHoje + acum(n, "entradas") - acum(n, "saidas"), saldoMin: saldoHoje === null ? null : saldoHoje + acum(n, "entradasMin") - acum(n, "saidas"), saldoMax: saldoHoje === null ? null : saldoHoje + acum(n, "entradasMax") - acum(n, "saidas") }));
  const semanas = Array.from({ length: Math.floor(pontos.length / 7) }, (_, i) => { const n = (i + 1) * 7; return { ate: pontos[n - 1].data, saldo: saldoHoje === null ? null : saldoHoje + acum(n, "entradas") - acum(n, "saidas"), min: saldoHoje === null ? null : saldoHoje + acum(n, "entradasMin") - acum(n, "saidas"), max: saldoHoje === null ? null : saldoHoje + acum(n, "entradasMax") - acum(n, "saidas"), entradas: pontos.slice(n - 7, n).reduce((a, p) => a + p.entradas, 0), saidas: pontos.slice(n - 7, n).reduce((a, p) => a + p.saidas, 0) }; });
  const menor = semanas.reduce<{ ate: string; min: number } | null>((acc, s) => s.min === null ? acc : !acc || s.min < acc.min ? { ate: s.ate, min: s.min } : acc, null);
  const noHorizonte = comp.filter(c => c.data <= fim);
  return { saldoHoje, semSaldo, taxa, usaTitulos, titulos90: titulos.reduce((a, t) => a + t.valor, 0), marcos, semanas, menor, pess, otim, compromissos: { n: noHorizonte.length, total: noHorizonte.reduce((a, c) => a + c.valor, 0), programadas: noHorizonte.filter(c => c.programada).length } };
}
