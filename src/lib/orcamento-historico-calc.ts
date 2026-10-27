/**
 * v28 · Orçamento pelo histórico — cálculo puro (sem banco). Catálogo “Plano de contas, centros de custo e orçamento”, p. 30:
 *  1. Higienizar a base — duplicidades, estornos, parcelas de gastos extraordinários, transferências e dívida saem (com decisão humana
 *     onde há dúvida) e os picos fora do padrão podem ser normalizados pela mediana da conta;
 *  2. Classificar e ratear — feito no plano de contas e no rateio (aqui só se mede a qualidade);
 *  3. Projetar — volume × preço × calendário: base de 12 meses limpa, nivelada a preços de hoje (reajustes que aconteceram dentro da
 *     base), reajuste do ano (dissídio, mensalidade, IPCA proporcional ao tempo), volume pelas matrículas (alunos) ou pela receita
 *     (tributos e taxas de cartão), sazonalidade do próprio histórico, meses sem histórico estimados pela média com o calendário escolar
 *     e piso dos contratos e títulos já assumidos para o ano;
 *  4. Governar — versões base, otimista e estresse; a Direção aplica uma versão ao orçamento mês a mês.
 * O orçamento oficial continua na categoria (budget_months); a conta do plano é a memória do cálculo.
 */
import { normalizar } from "./plano-contas-calc";

export type Versao = "BASE" | "OTIMISTA" | "ESTRESSE";
export const VERSOES: Versao[] = ["BASE", "OTIMISTA", "ESTRESSE"];
export const ROTULO_VERSAO: Record<Versao, string> = { BASE: "Base", OTIMISTA: "Otimista", ESTRESSE: "Estresse" };

export type Sinal = "ESTORNO" | "DUPLICADO" | "INVESTIMENTO" | "EXTRAORDINARIO" | "FORA_DO_PADRAO" | "EVENTO";
export const SINAIS: Sinal[] = ["DUPLICADO", "ESTORNO", "INVESTIMENTO", "EXTRAORDINARIO", "FORA_DO_PADRAO", "EVENTO"];
export const ROTULO_SINAL: Record<Sinal, { rotulo: string; dica: string }> = {
  DUPLICADO: { rotulo: "Provável duplicidade", dica: "mesmo valor, mesma contraparte, mesma unidade e mesmo tipo em até 3 dias" },
  ESTORNO: { rotulo: "Estorno ou devolução", dica: "saída e entrada do mesmo valor que se anulam (até 30 dias)" },
  INVESTIMENTO: { rotulo: "Investimento (CAPEX)", dica: "obra, equipamento, mobiliário: vai para o plano de investimentos, não para o custeio" },
  EXTRAORDINARIO: { rotulo: "Gasto extraordinário", dica: "título lançado como extraordinário em contas a pagar (inclusive as parcelas): não se repete" },
  FORA_DO_PADRAO: { rotulo: "Fora do padrão", dica: "muito acima da mediana da conta e sem igual no mesmo mês do ano anterior" },
  EVENTO: { rotulo: "Evento de conta eventual", dica: "gasto alto de conta eventual: confirme se repete no ano do orçamento" },
};
export type Decisao = "MANTER" | "FORA" | "NORMALIZAR";
export const DECISOES: Decisao[] = ["MANTER", "FORA", "NORMALIZAR"];
export const ROTULO_DECISAO: Record<Decisao, string> = { MANTER: "Manter na base", FORA: "Tirar da base", NORMALIZAR: "Normalizar pela mediana" };

export type MovHist = {
  id: number; unit_id: number; data: string; tipo: "ENTRADA" | "SAIDA" | "TRANSFERENCIA"; categoria: string; valor: number; contraparte: string | null; descricao: string | null;
  conta_id: number | null; installment_id: number | null; parcela: number | null; parcelas: number | null; natureza: string | null;
};
export type ContaAttr = { id: number; codigo: string; nome: string; tipo: "ENTRADA" | "SAIDA"; categoria: string | null; tipo_economico: string; comportamento: string; recorrencia: string; indice: string; driver: string; custo: string; ativo: boolean };
export type AttrConta = { indice: string; driver: string; comportamento: string; recorrencia: string; economico: string; custo: string };
export type Delta = { alunosPct: number; ipcaPp: number; dissidioPp: number; mensalidadePp: number };
export type ParamsHist = {
  anoAlvo: number; fimBase: string;
  ipcaPct: number; dissidioPct: number; reajusteMensalidadePct: number; mesDissidio: number; mesReajusteMensalidade: number;
  nivelIpcaPct: number; nivelDissidioPct: number; nivelMensalidadePct: number;
  fatorFerias: number; mesesFerias: number[]; outlierFator: number; outlierMinimo: number; eventoMinimo: number; usarContratos: boolean;
  alunosAlvo: Record<string, number>; otimista: Delta; estresse: Delta;
};

// ---------------------------------------------------------------- meses
const pad = (n: number) => String(n).padStart(2, "0");
export const ym = (a: number, m: number) => `${a}-${pad(m)}`;
export function addMes(mes: string, n: number): string { const [a, m] = mes.split("-").map(Number); const t = a * 12 + (m - 1) + n; return ym(Math.floor(t / 12), (t % 12) + 1); }
export function mesesEntre(de: string, ate: string): number { const [a1, m1] = de.split("-").map(Number); const [a2, m2] = ate.split("-").map(Number); return (a2 * 12 + m2) - (a1 * 12 + m1); }
/** Os 12 meses da base (do mais antigo ao mais novo) terminando em fimBase. */
export function mesesDaBase(fimBase: string): string[] { return Array.from({ length: 12 }, (_, i) => addMes(fimBase, i - 11)); }
const MES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const rotuloMes = (mes: string) => `${MES_CURTO[Number(mes.slice(5, 7)) - 1]}/${mes.slice(2, 4)}`;
const r2 = (v: number) => Math.round(v * 100) / 100;
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dias = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
function mediana(xs: number[]): number { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const h = Math.floor(s.length / 2); return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; }

// ---------------------------------------------------------------- atributos
export const ATTR_PADRAO = (tipo: "ENTRADA" | "SAIDA"): AttrConta => ({ indice: "IPCA", driver: "NENHUM", comportamento: "FIXO", recorrencia: "RECORRENTE", economico: tipo === "ENTRADA" ? "RECEITA" : "OPEX", custo: "INDIRETO" });
export const attrDaConta = (c: ContaAttr): AttrConta => ({ indice: c.indice, driver: c.driver, comportamento: c.comportamento, recorrencia: c.recorrencia, economico: c.tipo_economico, custo: c.custo });
/** Lançamento sem conta: os atributos mais comuns das contas analíticas que apontam para a mesma categoria (empate: o valor padrão). */
export function atributosPorCategoria(contas: ContaAttr[]): Map<string, AttrConta> {
  const grupos = new Map<string, ContaAttr[]>();
  for (const c of contas) { if (!c.categoria || !c.ativo || ["CAPEX", "TRANSFERENCIA", "ADIANTAMENTO"].includes(c.tipo_economico)) continue; const k = `${c.tipo}|${c.categoria}`; grupos.set(k, [...(grupos.get(k) ?? []), c]); }
  const out = new Map<string, AttrConta>();
  for (const [k, cs] of grupos) {
    const padrao = ATTR_PADRAO(cs[0].tipo);
    // o valor mais comum entre as contas da categoria; empate: o da primeira conta na ordem do plano (Encargos seguem a folha, por exemplo)
    const moda = (f: (c: ContaAttr) => string, def: string) => { const n = new Map<string, number>(); for (const c of cs) n.set(f(c), (n.get(f(c)) ?? 0) + 1); let best = cs.length ? f(cs[0]) : def, bn = n.get(best) ?? 0; for (const [v, q] of n) if (q > bn) { best = v; bn = q; } return best; };
    out.set(k, { indice: moda(c => c.indice, padrao.indice), driver: moda(c => c.driver, padrao.driver), comportamento: moda(c => c.comportamento, padrao.comportamento), recorrencia: moda(c => c.recorrencia, padrao.recorrencia), economico: padrao.economico, custo: moda(c => c.custo, padrao.custo) });
  }
  return out;
}
export function attrDoMov(m: { conta_id: number | null; tipo: string; categoria: string }, contas: Map<number, ContaAttr>, porCat: Map<string, AttrConta>): AttrConta {
  const c = m.conta_id ? contas.get(m.conta_id) : undefined; if (c) return attrDaConta(c);
  const t = m.tipo === "ENTRADA" ? "ENTRADA" : "SAIDA"; return porCat.get(`${t}|${m.categoria}`) ?? ATTR_PADRAO(t);
}

// ---------------------------------------------------------------- 1. higienizar
export type Flag = { sinal: Sinal; sugestao: Decisao; motivo: string; par: number | null; mediana: number | null };
export type OpcoesSinais = { iniBase: string; fimBaseExcl: string; anoAlvo: number; contas: Map<number, ContaAttr>; porCat: Map<string, AttrConta>; internas: string[]; naoDespesa: string[]; outlierFator: number; outlierMinimo: number; eventoMinimo: number };

/** Fora da base sem decisão: transferências, movimentos internos e saídas que não são despesa (principal de dívida, adiantamentos). */
export function foraAutomatico(m: MovHist, o: Pick<OpcoesSinais, "contas" | "internas" | "naoDespesa">): string | null {
  if (m.tipo === "TRANSFERENCIA") return "Transferência";
  if (o.internas.includes(m.categoria)) return "Movimento interno (entre unidades ou contas)";
  if (o.naoDespesa.includes(m.categoria)) return "Não é despesa (principal de dívida ou adiantamento)";
  const c = m.conta_id ? o.contas.get(m.conta_id) : undefined;
  if (c && c.tipo_economico === "TRANSFERENCIA") return "Transferência";
  if (c && c.tipo_economico === "ADIANTAMENTO") return "Não é despesa (adiantamento)";
  return null;
}
const chaveTexto = (m: MovHist) => normalizar(m.contraparte) || normalizar(m.descricao);
const RX_ESTORNO = /estorn|devolu|reembols|cancelament/;
/** Grupo da conta: a conta do plano, ou a categoria quando o lançamento ainda não tem conta. */
export const chaveGrupo = (m: { unit_id: number; conta_id: number | null; tipo: string; categoria: string }) => m.conta_id ? `${m.unit_id}|c${m.conta_id}` : `${m.unit_id}|k${m.tipo === "ENTRADA" ? "ENTRADA" : "SAIDA"}|${m.categoria}`;

/** Sinais da base (só lançamentos dentro da base; os 12 meses anteriores ajudam a ver pares e sazonalidade). */
export function detectarSinais(movs: MovHist[], o: OpcoesSinais): { flags: Map<number, Flag>; auto: Map<number, string> } {
  const naBase = (m: MovHist) => m.data >= o.iniBase && m.data < o.fimBaseExcl;
  const auto = new Map<number, string>(); const flags = new Map<number, Flag>();
  const validos: MovHist[] = [];
  for (const m of movs) { const a = foraAutomatico(m, o); if (a) { auto.set(m.id, a); continue; } validos.push(m); }
  const ord = [...validos].sort((a, b) => a.data.localeCompare(b.data) || a.id - b.id);
  const usados = new Set<number>();
  const marca = (m: MovHist, f: Flag) => { if (naBase(m) && !flags.has(m.id)) flags.set(m.id, f); };
  // estornos: saída e entrada do mesmo valor e unidade em até 30 dias, mesma contraparte ou histórico de estorno/devolução
  const entradas = new Map<string, MovHist[]>();
  for (const m of ord) if (m.tipo === "ENTRADA") { const k = `${m.unit_id}|${m.valor.toFixed(2)}`; entradas.set(k, [...(entradas.get(k) ?? []), m]); }
  for (const x of ord) {
    if (x.tipo !== "SAIDA" || usados.has(x.id)) continue; const kx = chaveTexto(x); const ex = RX_ESTORNO.test(normalizar(`${x.descricao ?? ""} ${x.contraparte ?? ""}`));
    let melhor: MovHist | null = null; let md = 99;
    for (const y of entradas.get(`${x.unit_id}|${x.valor.toFixed(2)}`) ?? []) {
      if (usados.has(y.id)) continue; const d = Math.abs(dias(x.data, y.data)); if (d > 30) continue;
      const ky = chaveTexto(y); const ey = RX_ESTORNO.test(normalizar(`${y.descricao ?? ""} ${y.contraparte ?? ""}`));
      if (!((kx && kx === ky) || ex || ey)) continue; if (d < md) { md = d; melhor = y; }
    }
    if (melhor) { usados.add(x.id); usados.add(melhor.id);
      marca(x, { sinal: "ESTORNO", sugestao: "FORA", motivo: `Anulado pela entrada de ${brl(melhor.valor)} em ${melhor.data.split("-").reverse().join("/")} (#${melhor.id})`, par: melhor.id, mediana: null });
      marca(melhor, { sinal: "ESTORNO", sugestao: "FORA", motivo: `Devolve a saída de ${brl(x.valor)} de ${x.data.split("-").reverse().join("/")} (#${x.id})`, par: x.id, mediana: null }); }
  }
  // duplicidades: mesmo tipo, unidade, valor e contraparte (ou, sem contraparte, o mesmo histórico) em até 3 dias — entradas só com a
  // mesma contraparte; parcelas diferentes do mesmo título não contam; valores pequenos (tarifas do dia a dia) ficam de fora
  const grupos = new Map<string, MovHist[]>();
  for (const m of ord) {
    if (usados.has(m.id) || m.valor < 50) continue; const cp = normalizar(m.contraparte); const ds = normalizar(m.descricao);
    const k = cp ? `cp:${cp}` : m.tipo === "SAIDA" && ds.length >= 6 ? `ds:${ds}` : ""; if (!k) continue;
    const g = `${m.unit_id}|${m.tipo}|${m.valor.toFixed(2)}|${k}`; grupos.set(g, [...(grupos.get(g) ?? []), m]);
  }
  for (const g of grupos.values()) for (let i = 1; i < g.length; i++) {
    const a = g[i - 1], b = g[i]; if (dias(a.data, b.data) > 3) continue; if (a.installment_id && b.installment_id && a.installment_id !== b.installment_id) continue;
    marca(b, { sinal: "DUPLICADO", sugestao: "FORA", motivo: `Igual ao #${a.id} de ${a.data.split("-").reverse().join("/")} (${dias(a.data, b.data)} dia(s) antes)`, par: a.id, mediana: null });
  }
  // investimento e gasto extraordinário (natureza do título em contas a pagar ou conta CAPEX)
  for (const m of ord) {
    if (m.tipo !== "SAIDA" || flags.has(m.id) || !naBase(m)) continue; const c = m.conta_id ? o.contas.get(m.conta_id) : undefined;
    const parc = m.parcelas && m.parcelas > 1 ? ` — parcela ${m.parcela ?? "?"}/${m.parcelas}` : "";
    if ((c && c.tipo_economico === "CAPEX") || m.natureza === "INVESTIMENTO") marca(m, { sinal: "INVESTIMENTO", sugestao: "FORA", motivo: `${c ? `${c.codigo} ${c.nome}` : "Título de investimento"}${parc}: entra no plano de investimentos`, par: null, mediana: null });
    else if (m.natureza === "EXTRAORDINARIA") marca(m, { sinal: "EXTRAORDINARIO", sugestao: "FORA", motivo: `Título extraordinário em contas a pagar${parc}: não se repete como custo do dia a dia`, par: null, mediana: null });
  }
  // fora do padrão: muito acima da mediana da conta na base e sem igual no mesmo mês do ano anterior. Sem conta, compara dentro da
  // mesma contraparte (a categoria sem conta mistura fornecedores). O ano anterior é olhado pela conta e pela contraparte — a
  // classificação pode ter começado no meio do caminho.
  const grupoPico = (m: MovHist) => m.conta_id ? chaveGrupo(m) : `${chaveGrupo(m)}|${normalizar(m.contraparte)}`;
  const chavesAnt = (m: MovHist) => { const mm = m.data.slice(5, 7); const cp = normalizar(m.contraparte); return [`${chaveGrupo(m)}|${mm}`, ...(cp ? [`${m.unit_id}|cp|${m.categoria}|${cp}|${mm}`] : [])]; };
  const porGrupo = new Map<string, MovHist[]>(); const anterior = new Map<string, number>();
  for (const m of ord) {
    if (m.tipo === "TRANSFERENCIA") continue;
    if (naBase(m)) { if (!(flags.get(m.id)?.sugestao === "FORA")) { const g = grupoPico(m); porGrupo.set(g, [...(porGrupo.get(g) ?? []), m]); } }
    else if (m.data < o.iniBase) for (const k of chavesAnt(m)) anterior.set(k, (anterior.get(k) ?? 0) + m.valor);
  }
  const sazonal = (m: MovHist) => chavesAnt(m).some(k => (anterior.get(k) ?? 0) >= 0.5 * m.valor); // o mesmo mês do ano anterior teve valor parecido
  for (const [, ms] of porGrupo) {
    if (ms.length < 4) continue; const med = mediana(ms.map(m => m.valor)); if (med <= 0) continue;
    for (const m of ms) {
      if (flags.has(m.id) || m.valor <= o.outlierFator * med || m.valor - med < o.outlierMinimo) continue;
      if (sazonal(m)) continue;
      marca(m, { sinal: "FORA_DO_PADRAO", sugestao: "NORMALIZAR", motivo: `${(m.valor / med).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}× a mediana da conta (${brl(med)}) e sem igual no mesmo mês do ano anterior`, par: null, mediana: r2(med) });
    }
  }
  // eventos de contas eventuais (custos): confirmar se repetem — receitas de eventos (festas, formaturas) voltam todo ano e não entram
  for (const m of ord) {
    if (m.tipo !== "SAIDA" || !naBase(m) || flags.has(m.id) || m.valor < o.eventoMinimo) continue; const a = attrDoMov(m, o.contas, o.porCat); if (a.recorrencia !== "EVENTUAL") continue;
    if (sazonal(m)) continue; // aconteceu também no mesmo mês do ano anterior: é do calendário
    const c = m.conta_id ? o.contas.get(m.conta_id) : undefined;
    marca(m, { sinal: "EVENTO", sugestao: "MANTER", motivo: `${c ? `${c.codigo} ${c.nome}` : m.categoria} é eventual: repete em ${o.anoAlvo}?`, par: null, mediana: null });
  }
  return { flags, auto };
}

export type Tratamento = { decisao: Decisao; origem: "AUTO" | "DECIDIDO" | "SUGESTAO" | "PADRAO" };
export function tratamento(id: number, flags: Map<number, Flag>, auto: Map<number, string>, decisoes: Map<number, Decisao>): Tratamento {
  if (auto.has(id)) return { decisao: "FORA", origem: "AUTO" };
  const f = flags.get(id); const d = decisoes.get(id);
  if (f && d) return { decisao: d === "NORMALIZAR" && f.mediana === null ? "MANTER" : d, origem: "DECIDIDO" };
  if (f) return { decisao: f.sugestao, origem: "SUGESTAO" };
  return { decisao: "MANTER", origem: "PADRAO" };
}

// ---------------------------------------------------------------- base limpa e nivelada
export type Grupo = {
  chave: string; unit_id: number; tipo: "ENTRADA" | "SAIDA"; categoria: string; conta_id: number | null; attr: AttrConta;
  bruto: number[]; limpo: number[]; nivelado: number[]; estimados: number[]; temAnterior: boolean; ultimoIdx: number; n: number; removido: number; normalizado: number; avisos: string[];
};
export type OpcoesBase = { fimBase: string; anoAlvo: number; contas: Map<number, ContaAttr>; porCat: Map<string, AttrConta>; nivelIpcaPct: number; nivelDissidioPct: number; nivelMensalidadePct: number; mesDissidio: number; mesReajusteMensalidade: number; fatorFerias: number; mesesFerias: number[] };

/** Fator que leva um mês da base ao nível de preços do fim da base (reajustes que aconteceram dentro dela). */
export function fatorNivel(indice: string, mes: string, o: Pick<OpcoesBase, "fimBase" | "anoAlvo" | "nivelIpcaPct" | "nivelDissidioPct" | "nivelMensalidadePct" | "mesDissidio" | "mesReajusteMensalidade">): number {
  if (indice === "MENSALIDADE") return mes < ym(o.anoAlvo - 1, o.mesReajusteMensalidade) ? 1 + o.nivelMensalidadePct / 100 : 1;
  if (indice === "DISSIDIO") return mes < ym(o.anoAlvo - 1, o.mesDissidio) ? 1 + o.nivelDissidioPct / 100 : 1;
  if (indice === "IPCA") return Math.pow(1 + o.nivelIpcaPct / 100, Math.max(0, mesesEntre(mes, o.fimBase)) / 12);
  return 1;
}

export function montarBase(movs: MovHist[], flags: Map<number, Flag>, auto: Map<number, string>, decisoes: Map<number, Decisao>, o: OpcoesBase) {
  const meses = mesesDaBase(o.fimBase); const idx = new Map(meses.map((m, i) => [m, i])); const iniBase = `${meses[0]}-01`;
  const grupos = new Map<string, Grupo>();
  const novo = (m: MovHist): Grupo => { const t = m.tipo === "ENTRADA" ? "ENTRADA" : "SAIDA"; const c = m.conta_id ? o.contas.get(m.conta_id) : undefined;
    return { chave: chaveGrupo(m), unit_id: m.unit_id, tipo: t, categoria: c?.categoria ?? m.categoria, conta_id: c ? c.id : null, attr: attrDoMov(m, o.contas, o.porCat), bruto: Array(12).fill(0), limpo: Array(12).fill(0), nivelado: Array(12).fill(0), estimados: [], temAnterior: false, ultimoIdx: -1, n: 0, removido: 0, normalizado: 0, avisos: [] }; };
  let fora = 0, normal = 0, nAuto = 0, vAuto = 0; const anteriores = new Set<string>();
  for (const m of movs) {
    const k = idx.get(m.data.slice(0, 7));
    if (k === undefined) { if (m.data < iniBase && !auto.has(m.id)) anteriores.add(chaveGrupo(m)); continue; }
    if (auto.has(m.id) || m.tipo === "TRANSFERENCIA") { nAuto++; vAuto += m.valor; continue; }
    const g = grupos.get(chaveGrupo(m)) ?? novo(m); grupos.set(g.chave, g);
    const t = tratamento(m.id, flags, auto, decisoes); const f = flags.get(m.id);
    g.bruto[k] += m.valor; g.n++;
    const v = t.decisao === "FORA" ? 0 : t.decisao === "NORMALIZAR" && f?.mediana !== null && f?.mediana !== undefined ? Math.min(m.valor, f.mediana) : m.valor;
    g.limpo[k] += v; if (v !== m.valor) { if (t.decisao === "FORA") { g.removido += m.valor; fora += m.valor; } else { g.normalizado += m.valor - v; normal += m.valor - v; } }
    if (v > 0) g.ultimoIdx = Math.max(g.ultimoIdx, k);
  }
  for (const g of grupos.values()) {
    g.temAnterior = anteriores.has(g.chave);
    g.nivelado = g.limpo.map((v, k) => v * fatorNivel(g.attr.indice, meses[k], o));
    // conta que começou dentro da base (sem histórico antes): meses anteriores ao primeiro lançamento estimados pela média, com o calendário escolar —
    // a não ser que esses meses estejam na mesma categoria sem conta (a classificação começou depois): aí eles já estão lá e não se contam duas vezes
    const primeiro = g.limpo.findIndex(v => v > 0);
    const semConta = g.conta_id ? grupos.get(`${g.unit_id}|k${g.tipo}|${g.categoria}`) : undefined;
    const cobertos = !!semConta && semConta.limpo.slice(0, Math.max(0, primeiro)).some(v => v > 0);
    if (cobertos && primeiro > 0) g.avisos.push(`conta classificada a partir de ${rotuloMes(meses[primeiro])}: os meses anteriores estão na categoria sem conta`);
    // (lançamentos ainda sem conta são resíduo da classificação — nunca se estimam meses para eles)
    if (g.conta_id && !g.temAnterior && !cobertos && primeiro > 0 && g.attr.recorrencia === "RECORRENTE") {
      const obs = g.nivelado.slice(primeiro); const media = obs.reduce((a, b) => a + b, 0) / obs.length;
      for (let k = 0; k < primeiro; k++) { const mesCal = Number(meses[k].slice(5, 7)); g.nivelado[k] = media * (g.attr.comportamento === "VARIAVEL" && o.mesesFerias.includes(mesCal) ? o.fatorFerias : 1); g.estimados.push(k); }
    }
  }
  return { meses, grupos: [...grupos.values()], resumo: { foraDecidido: r2(fora), normalizado: r2(normal), nAuto, vAuto: r2(vAuto) } };
}

// ---------------------------------------------------------------- 3. projetar
export type ParamsVersao = { versao: Versao; ipcaPct: number; dissidioPct: number; mensalidadePct: number; alunosAlvo: Map<number, number> };
export function paramsDaVersao(p: ParamsHist, v: Versao, unidades: number[], alunosAtuais: Map<number, number>): ParamsVersao {
  const d: Delta = v === "OTIMISTA" ? p.otimista : v === "ESTRESSE" ? p.estresse : { alunosPct: 0, ipcaPp: 0, dissidioPp: 0, mensalidadePp: 0 };
  const alvo = new Map(unidades.map(u => { const base = Number.isFinite(p.alunosAlvo[String(u)]) ? p.alunosAlvo[String(u)] : alunosAtuais.get(u) ?? 0; return [u, Math.max(0, Math.round(base * (1 + d.alunosPct / 100)))]; }));
  return { versao: v, ipcaPct: p.ipcaPct + d.ipcaPp, dissidioPct: p.dissidioPct + d.dissidioPp, mensalidadePct: p.reajusteMensalidadePct + d.mensalidadePp, alunosAlvo: alvo };
}
/** Reajuste de preço do mês do ano do orçamento sobre o nível do fim da base. */
export function fatorPreco(indice: string, mesCal: number, o: { anoAlvo: number; fimBase: string; mesDissidio: number; mesReajusteMensalidade: number }, v: Pick<ParamsVersao, "ipcaPct" | "dissidioPct" | "mensalidadePct">): number {
  if (indice === "MENSALIDADE") return mesCal >= o.mesReajusteMensalidade ? 1 + v.mensalidadePct / 100 : 1;
  if (indice === "DISSIDIO") return mesCal >= o.mesDissidio ? 1 + v.dissidioPct / 100 : 1;
  if (indice === "IPCA") return Math.pow(1 + v.ipcaPct / 100, Math.max(0, mesesEntre(o.fimBase, ym(o.anoAlvo, mesCal))) / 12);
  return 1;
}

export type Piso = { meses: number[]; origem: string[] };
export type LinhaProj = {
  chave: string; unit_id: number; tipo: "ENTRADA" | "SAIDA"; categoria: string; conta_id: number | null; attr: AttrConta;
  meses: number[]; total: number; bruto: number; limpo: number; nivelado: number; fatorPreco: number; fatorVolume: number; acrescimoPiso: number; piso: Piso | null; estimados: number; removido: number; normalizado: number; avisos: string[];
};
export type TotUnidade = { receita: number; despesa: number; resultado: number; alunos: number; custoAlunoMes: number | null; margem: number | null; receitaBase: number; despesaBase: number };

/**
 * Projeção de uma versão: ENTRADAS primeiro (a razão receita projetada ÷ receita da base move os custos que seguem a receita),
 * depois as SAÍDAS; piso dos contratos e títulos do ano por mês; centavos arredondados.
 */
export function projetar(grupos: Grupo[], meses: string[], o: { anoAlvo: number; fimBase: string; mesDissidio: number; mesReajusteMensalidade: number }, v: ParamsVersao, alunosAtuais: Map<number, number>, pisos: Map<string, Piso & { tipo: "ENTRADA" | "SAIDA"; categoria: string; unit_id: number; conta_id: number | null; attr: AttrConta }>) {
  const kDoMes = new Map(meses.map((m, k) => [Number(m.slice(5, 7)), k]));
  const linhas: LinhaProj[] = [];
  const volAlunos = (u: number) => { const a = alunosAtuais.get(u) ?? 0; const b = v.alunosAlvo.get(u) ?? a; return a > 0 ? b / a : 1; };
  const usados = new Set<string>();
  const umaLinha = (g: Grupo, volume: number): LinhaProj => {
    const out = Array(12).fill(0) as number[]; let somaN = 0, somaP = 0;
    for (let mes = 1; mes <= 12; mes++) { const k = kDoMes.get(mes)!; const base = g.nivelado[k]; const fp = fatorPreco(g.attr.indice, mes, o, v); out[mes - 1] = base * fp * volume; somaN += base; somaP += base * fp; }
    const piso = pisos.get(g.chave) ?? null; let acrescimo = 0;
    if (piso) { usados.add(g.chave); for (let i = 0; i < 12; i++) if (piso.meses[i] > out[i]) { acrescimo += piso.meses[i] - out[i]; out[i] = piso.meses[i]; } }
    const ms = out.map(r2); const avisos: string[] = [...g.avisos];
    if (g.estimados.length) avisos.push(`${g.estimados.length} mês(es) sem histórico estimados pela média`);
    if (g.attr.recorrencia === "RECORRENTE" && g.ultimoIdx >= 0 && g.ultimoIdx < 8) avisos.push(`sem lançamento desde ${rotuloMes(meses[g.ultimoIdx])} — ainda existe?`);
    return { chave: g.chave, unit_id: g.unit_id, tipo: g.tipo, categoria: g.categoria, conta_id: g.conta_id, attr: g.attr, meses: ms, total: r2(ms.reduce((a, b) => a + b, 0)), bruto: r2(g.bruto.reduce((a, b) => a + b, 0)), limpo: r2(g.limpo.reduce((a, b) => a + b, 0)),
      nivelado: r2(somaN), fatorPreco: somaN > 0 ? somaP / somaN : 1, fatorVolume: volume, acrescimoPiso: r2(acrescimo), piso, estimados: g.estimados.length, removido: r2(g.removido), normalizado: r2(g.normalizado), avisos };
  };
  const receitaBase = new Map<number, number>(); const receitaProj = new Map<number, number>();
  for (const g of grupos.filter(x => x.tipo === "ENTRADA")) {
    const l = umaLinha(g, g.attr.driver === "ALUNOS" ? volAlunos(g.unit_id) : 1); linhas.push(l);
    receitaBase.set(g.unit_id, (receitaBase.get(g.unit_id) ?? 0) + l.limpo); receitaProj.set(g.unit_id, (receitaProj.get(g.unit_id) ?? 0) + l.total);
  }
  const volReceita = (u: number) => { const b = receitaBase.get(u) ?? 0; return b > 0 ? (receitaProj.get(u) ?? 0) / b : 1; };
  for (const g of grupos.filter(x => x.tipo === "SAIDA")) linhas.push(umaLinha(g, g.attr.driver === "ALUNOS" ? volAlunos(g.unit_id) : g.attr.driver === "RECEITA" ? volReceita(g.unit_id) : 1));
  // contrato ou título do ano sem histórico na conta (nem na categoria sem conta): linha nova, só com o piso
  for (const [k, p] of pisos) {
    if (usados.has(k)) continue; const ms = p.meses.map(r2);
    linhas.push({ chave: k, unit_id: p.unit_id, tipo: p.tipo, categoria: p.categoria, conta_id: p.conta_id, attr: p.attr, meses: ms, total: r2(ms.reduce((a, b) => a + b, 0)), bruto: 0, limpo: 0, nivelado: 0, fatorPreco: 1, fatorVolume: 1,
      acrescimoPiso: r2(ms.reduce((a, b) => a + b, 0)), piso: p, estimados: 0, removido: 0, normalizado: 0, avisos: ["sem histórico: só o que já está contratado"] });
  }
  return linhas;
}

export function totais(linhas: LinhaProj[], unidades: number[], alunosAlvo: Map<number, number>) {
  const por = new Map<number, TotUnidade>(unidades.map(u => [u, { receita: 0, despesa: 0, resultado: 0, alunos: alunosAlvo.get(u) ?? 0, custoAlunoMes: null, margem: null, receitaBase: 0, despesaBase: 0 }]));
  for (const l of linhas) { const t = por.get(l.unit_id); if (!t) continue; if (l.tipo === "ENTRADA") { t.receita += l.total; t.receitaBase += l.limpo; } else { t.despesa += l.total; t.despesaBase += l.limpo; } }
  const fecha = (t: TotUnidade): TotUnidade => { const x = { ...t, receita: r2(t.receita), despesa: r2(t.despesa), receitaBase: r2(t.receitaBase), despesaBase: r2(t.despesaBase) }; x.resultado = r2(x.receita - x.despesa); x.margem = x.receita > 0 ? (100 * x.resultado) / x.receita : null; x.custoAlunoMes = x.alunos > 0 ? x.despesa / x.alunos / 12 : null; return x; };
  const lista = [...por.entries()].map(([u, t]) => [u, fecha(t)] as const);
  const rede = fecha([...por.values()].reduce((a, t) => ({ ...a, receita: a.receita + t.receita, despesa: a.despesa + t.despesa, alunos: a.alunos + t.alunos, receitaBase: a.receitaBase + t.receitaBase, despesaBase: a.despesaBase + t.despesaBase }), { receita: 0, despesa: 0, resultado: 0, alunos: 0, custoAlunoMes: null, margem: null, receitaBase: 0, despesaBase: 0 } as TotUnidade));
  return { porUnidade: new Map(lista), rede };
}

/** O que vai para o orçamento oficial: unidade × tipo × categoria × mês (só valores positivos). */
export function porCategoria(linhas: LinhaProj[]) {
  const m = new Map<string, { unit_id: number; tipo: "ENTRADA" | "SAIDA"; categoria: string; meses: number[] }>();
  for (const l of linhas) { const k = `${l.unit_id}|${l.tipo}|${l.categoria}`; const x = m.get(k) ?? { unit_id: l.unit_id, tipo: l.tipo, categoria: l.categoria, meses: Array(12).fill(0) }; l.meses.forEach((v, i) => { x.meses[i] += v; }); m.set(k, x); }
  return [...m.values()].map(x => ({ ...x, meses: x.meses.map(r2) })).filter(x => x.meses.some(v => v > 0)).sort((a, b) => a.unit_id - b.unit_id || a.tipo.localeCompare(b.tipo) || a.categoria.localeCompare(b.categoria));
}
