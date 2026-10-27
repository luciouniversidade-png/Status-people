/**
 * DRE gerencial multidimensional (T-024 · Nova Arquitetura, Cap. 20) — montagem pura, sem banco.
 * Linhas canônicas × colunas comutáveis (unidade, entidade com Consolidado, mês com acumulado) × modos (real, orçado, Δ, AH, AV).
 * Regime gerencial de caixa: o realizado vem dos lançamentos; o custo de pessoal usa o resultado ACEITO da folha (REAL) no
 * mês/unidade em que ele existe — e então as saídas de caixa de pessoal daquele mês/unidade saem da conta (sem contar em dobro).
 * Movimentos internos do grupo (transferências) nunca entram nas linhas: aparecem como memória de eliminação (CRQ-FIN-V3-01).
 */
export type CodigoLinha = "RECEITA" | "DEDUCOES" | "LIQUIDA" | "PESSOAL" | "OPERACIONAIS" | "EBITDA" | "FINANCEIRO" | "RESULTADO";
export const LINHAS_DRE: { codigo: CodigoLinha; nome: string; total: boolean }[] = [
  { codigo: "RECEITA", nome: "Receita bruta", total: false },
  { codigo: "DEDUCOES", nome: "(−) Tributos sobre a receita e taxas", total: false },
  { codigo: "LIQUIDA", nome: "= Receita líquida", total: true },
  { codigo: "PESSOAL", nome: "(−) Custo de pessoal", total: false },
  { codigo: "OPERACIONAIS", nome: "(−) Despesas operacionais", total: false },
  { codigo: "EBITDA", nome: "= EBITDA gerencial", total: true },
  { codigo: "FINANCEIRO", nome: "(−) Resultado financeiro", total: false },
  { codigo: "RESULTADO", nome: "= Resultado do período", total: true },
];
export type MapaDre = { deducoes: string[]; pessoal: string[]; financeiras: string[]; internas: string[]; naoDespesa?: string[] }; // v28 · não despesa: principal de dívida e adiantamentos
export const FOLHA_REAL = "FOLHA|Folha — resultado aceito (REAL)";

/** Em que linha canônica cada lançamento entra (null = movimento interno, fora da DRE). */
export function linhaDaCategoria(tipo: string, categoria: string, m: MapaDre): CodigoLinha | null {
  if (tipo === "TRANSFERENCIA" || m.internas.includes(categoria) || (m.naoDespesa ?? []).includes(categoria)) return null;
  if (tipo === "ENTRADA") return "RECEITA";
  if (m.deducoes.includes(categoria)) return "DEDUCOES";
  if (m.pessoal.includes(categoria)) return "PESSOAL";
  if (m.financeiras.includes(categoria)) return "FINANCEIRO";
  return "OPERACIONAIS";
}

export type Mov = { unit_id: number; mes: number; tipo: string; categoria: string; valor: number };
export type FolhaMes = { unit_id: number; mes: number; custo: number };
export type Coluna = { chave: string; rotulo: string; units: number[]; meses: number[]; consolidado?: boolean };
export type Celula = { real: number | null; orc: number | null; ant: number | null; fonte: "caixa" | "REAL" | "misto" | null };
export type ContaDre = { linha: CodigoLinha; chave: string; nome: string; tipo: string; categoria: string | null };
export type Modo = "real" | "orcado" | "delta" | "ah" | "av";

const add = (a: number | null, b: number) => (a ?? 0) + b;

/**
 * Monta a DRE: valores por conta e por linha em cada coluna, com orçado e ano anterior.
 * `serieMeses` devolve, por conta e linha, o realizado mês a mês das unidades do recorte (mini-tendência).
 */
export function montarDre(p: { cols: Coluna[]; unidadesRecorte: number[]; mov: Mov[]; orc: Mov[]; folha: FolhaMes[]; movAnt: Mov[]; folhaAnt: FolhaMes[]; mapa: MapaDre }) {
  const contas = new Map<string, ContaDre>();
  const cel = new Map<string, Celula>(); // `${chave}|${col}`
  const pegar = (k: string, c: string) => { const x = cel.get(`${k}|${c}`); if (x) return x; const n: Celula = { real: null, orc: null, ant: null, fonte: null }; cel.set(`${k}|${c}`, n); return n; };
  const conta = (linha: CodigoLinha, tipo: string, categoria: string | null, nome: string) => { const chave = categoria === null ? FOLHA_REAL : `${tipo}|${categoria}`; if (!contas.has(chave)) contas.set(chave, { linha, chave, nome, tipo, categoria }); return chave; };
  const realSet = new Set(p.folha.map(f => `${f.unit_id}|${f.mes}`)); const realSetAnt = new Set(p.folhaAnt.map(f => `${f.unit_id}|${f.mes}`));
  const colsDe = (u: number, m: number) => p.cols.filter(c => c.units.includes(u) && c.meses.includes(m));
  const serie = new Map<string, (number | null)[]>(); const somaSerie = (k: string, mes: number, v: number) => { const s = serie.get(k) ?? Array<number | null>(12).fill(null); s[mes - 1] = add(s[mes - 1], v); serie.set(k, s); };
  const internas = new Map<string, { entradas: number; saidas: number; transferencias: number }>();
  const naoDespesa = new Map<string, number>(); // v28 · saídas que não são despesa (fora das linhas, sem eliminação)
  let substituidos = 0;
  for (const r of p.mov) {
    const linha = linhaDaCategoria(r.tipo, r.categoria, p.mapa);
    if (linha === null && r.tipo !== "TRANSFERENCIA" && (p.mapa.naoDespesa ?? []).includes(r.categoria) && !p.mapa.internas.includes(r.categoria)) { for (const c of colsDe(r.unit_id, r.mes)) naoDespesa.set(c.chave, (naoDespesa.get(c.chave) ?? 0) + (r.tipo === "ENTRADA" ? -r.valor : r.valor)); continue; }
    if (linha === null) { for (const c of colsDe(r.unit_id, r.mes)) { const x = internas.get(c.chave) ?? { entradas: 0, saidas: 0, transferencias: 0 }; if (r.tipo === "ENTRADA") x.entradas += r.valor; else if (r.tipo === "SAIDA") x.saidas += r.valor; else x.transferencias += r.valor; internas.set(c.chave, x); } continue; }
    if (linha === "PESSOAL" && realSet.has(`${r.unit_id}|${r.mes}`)) { substituidos += r.valor; continue; }
    const k = conta(linha, r.tipo, r.categoria, r.categoria);
    for (const c of colsDe(r.unit_id, r.mes)) { const x = pegar(k, c.chave); x.real = add(x.real, r.valor); x.fonte = linha === "PESSOAL" ? (x.fonte === "REAL" || x.fonte === "misto" ? "misto" : "caixa") : "caixa"; }
    if (p.unidadesRecorte.includes(r.unit_id)) somaSerie(k, r.mes, r.valor);
  }
  for (const f of p.folha) {
    const k = conta("PESSOAL", "SAIDA", null, "Folha — resultado aceito (REAL)");
    for (const c of colsDe(f.unit_id, f.mes)) { const x = pegar(k, c.chave); x.real = add(x.real, f.custo); x.fonte = "REAL"; }
    if (p.unidadesRecorte.includes(f.unit_id)) somaSerie(k, f.mes, f.custo);
  }
  for (const r of p.orc) { const linha = linhaDaCategoria(r.tipo, r.categoria, p.mapa); if (!linha) continue; const k = conta(linha, r.tipo, r.categoria, r.categoria); for (const c of colsDe(r.unit_id, r.mes)) { const x = pegar(k, c.chave); x.orc = add(x.orc, r.valor); } }
  for (const r of p.movAnt) { const linha = linhaDaCategoria(r.tipo, r.categoria, p.mapa); if (!linha) continue; if (linha === "PESSOAL" && realSetAnt.has(`${r.unit_id}|${r.mes}`)) continue; const k = conta(linha, r.tipo, r.categoria, r.categoria); for (const c of colsDe(r.unit_id, r.mes)) { const x = pegar(k, c.chave); x.ant = add(x.ant, r.valor); } }
  for (const f of p.folhaAnt) { const k = conta("PESSOAL", "SAIDA", null, "Folha — resultado aceito (REAL)"); for (const c of colsDe(f.unit_id, f.mes)) { const x = pegar(k, c.chave); x.ant = add(x.ant, f.custo); } }
  // linhas: grupos somam as contas; totais pela cascata canônica
  const linhas = new Map<string, Celula>();
  const somaLinha = (codigo: CodigoLinha, col: string) => {
    const ks = [...contas.values()].filter(c => c.linha === codigo).map(c => cel.get(`${c.chave}|${col}`)).filter((x): x is Celula => !!x);
    const s = (f: "real" | "orc" | "ant") => ks.some(x => x[f] !== null) ? ks.reduce((a, x) => a + (x[f] ?? 0), 0) : null;
    const fontes = new Set(ks.filter(x => x.real !== null).map(x => x.fonte)); const fonte = fontes.has("misto") || (fontes.has("REAL") && fontes.has("caixa")) ? "misto" : fontes.has("REAL") ? "REAL" : fontes.size ? "caixa" : null;
    return { real: s("real"), orc: s("orc"), ant: s("ant"), fonte } as Celula;
  };
  const menos = (a: Celula, ...bs: Celula[]): Celula => { const f = (k: "real" | "orc" | "ant") => [a, ...bs].every(x => x[k] === null) ? null : (a[k] ?? 0) - bs.reduce((t, b) => t + (b[k] ?? 0), 0); return { real: f("real"), orc: f("orc"), ant: f("ant"), fonte: null }; };
  for (const c of p.cols) {
    const g = Object.fromEntries((["RECEITA", "DEDUCOES", "PESSOAL", "OPERACIONAIS", "FINANCEIRO"] as CodigoLinha[]).map(k => [k, somaLinha(k, c.chave)])) as Record<string, Celula>;
    const liq = menos(g.RECEITA, g.DEDUCOES); const ebitda = menos(liq, g.PESSOAL, g.OPERACIONAIS); const res = menos(ebitda, g.FINANCEIRO);
    for (const [k, v] of Object.entries({ ...g, LIQUIDA: liq, EBITDA: ebitda, RESULTADO: res })) linhas.set(`${k}|${c.chave}`, v);
  }
  // série mensal das linhas no recorte
  const serieLinha = (codigo: CodigoLinha) => { const ks = [...contas.values()].filter(c => c.linha === codigo).map(c => serie.get(c.chave)).filter((x): x is (number | null)[] => !!x); return Array.from({ length: 12 }, (_, i) => ks.some(s => s[i] !== null) ? ks.reduce((a, s) => a + (s[i] ?? 0), 0) : null); };
  const seriesLinhas: Record<string, (number | null)[]> = {};
  for (const l of ["RECEITA", "DEDUCOES", "PESSOAL", "OPERACIONAIS", "FINANCEIRO"] as CodigoLinha[]) seriesLinhas[l] = serieLinha(l);
  const dif = (a: (number | null)[], ...bs: (number | null)[][]) => a.map((v, i) => v === null && bs.every(b => b[i] === null) ? null : (v ?? 0) - bs.reduce((t, b) => t + (b[i] ?? 0), 0));
  seriesLinhas.LIQUIDA = dif(seriesLinhas.RECEITA, seriesLinhas.DEDUCOES); seriesLinhas.EBITDA = dif(seriesLinhas.LIQUIDA, seriesLinhas.PESSOAL, seriesLinhas.OPERACIONAIS); seriesLinhas.RESULTADO = dif(seriesLinhas.EBITDA, seriesLinhas.FINANCEIRO);
  const ordemLinha = (l: CodigoLinha) => LINHAS_DRE.findIndex(x => x.codigo === l);
  const listaContas = [...contas.values()].sort((a, b) => ordemLinha(a.linha) - ordemLinha(b.linha) || (a.categoria === null ? -1 : b.categoria === null ? 1 : a.nome.localeCompare(b.nome)));
  return { contas: listaContas, celula: (k: string, c: string) => cel.get(`${k}|${c}`) ?? { real: null, orc: null, ant: null, fonte: null }, linha: (l: CodigoLinha, c: string) => linhas.get(`${l}|${c}`) ?? { real: null, orc: null, ant: null, fonte: null }, serieConta: (k: string) => serie.get(k) ?? Array<number | null>(12).fill(null), serieLinha: (l: CodigoLinha) => seriesLinhas[l], internas, naoDespesa, substituidos };
}
export type Dre = ReturnType<typeof montarDre>;

/** Valor exibido da célula no modo escolhido. AV usa a receita líquida da coluna; AH compara com o mesmo recorte do ano anterior. */
export function valorModo(c: Celula, modo: Modo, receitaLiquida: number | null): number | null {
  switch (modo) {
    case "real": return c.real;
    case "orcado": return c.orc;
    case "delta": return c.real === null && c.orc === null ? null : (c.real ?? 0) - (c.orc ?? 0);
    case "ah": return c.real === null || c.ant === null || c.ant === 0 ? null : (100 * (c.real - c.ant)) / Math.abs(c.ant);
    case "av": return c.real === null || !receitaLiquida ? null : (100 * c.real) / receitaLiquida;
  }
}
/** Desvio "bom" ou "ruim" do Δ: receita acima do orçado é bom; custo acima é ruim. */
export function tomDelta(linha: CodigoLinha, delta: number | null): "bom" | "ruim" | null {
  if (delta === null || Math.abs(delta) < 0.5) return null;
  const receita = ["RECEITA", "LIQUIDA", "EBITDA", "RESULTADO"].includes(linha);
  return (receita ? delta > 0 : delta < 0) ? "bom" : "ruim";
}
