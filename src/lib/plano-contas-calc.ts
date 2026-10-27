/**
 * v28 · Plano de contas gerencial — funções puras (rodam no servidor e no navegador, sem banco):
 * ordem dos códigos, árvore, contas analíticas, macrogrupo, próximo código, normalização de texto e a sugestão de conta e
 * centro de custo para um lançamento (regra → histórico da contraparte → palavras da conta → categoria).
 */
export type Conta = {
  id: number; codigo: string; nome: string; nivel: number; pai_id: number | null; tipo: "SAIDA" | "ENTRADA"; categoria: string | null;
  tipo_economico: string; comportamento: string; recorrencia: string; controlavel: boolean; custo: string; indice: string; driver: string;
  centro_padrao: string; generica: boolean; palavras: string | null; descricao: string | null; ativo: boolean;
};
export type Centro = { id: number; codigo: string; nome: string; tipo: string; unit_id: number | null; segmento: string | null; ativo: boolean };
export type Regra = { id: number; padrao: string; conta_id: number; cost_center_id: number | null; unit_id: number | null };

export const ROTULO_ECONOMICO: Record<string, string> = { OPEX: "Operacional (OPEX)", CAPEX: "Investimento (CAPEX)", DIVIDA: "Serviço da dívida", TRANSFERENCIA: "Transferência", ADIANTAMENTO: "Adiantamento", RECEITA: "Receita" };
export const ROTULO_COMPORTAMENTO: Record<string, string> = { FIXO: "Fixo", VARIAVEL: "Variável" };
export const ROTULO_RECORRENCIA: Record<string, string> = { RECORRENTE: "Recorrente", EVENTUAL: "Eventual" };
export const ROTULO_CUSTO: Record<string, string> = { DIRETO: "Direto (turma/segmento)", INDIRETO: "Indireto (compartilhado)" };
export const ROTULO_INDICE: Record<string, string> = { IPCA: "IPCA", DISSIDIO: "Dissídio", MENSALIDADE: "Reajuste da mensalidade", NENHUM: "Sem reajuste" };
export const ROTULO_DRIVER: Record<string, string> = { ALUNOS: "Nº de alunos", RECEITA: "Receita", NENHUM: "Não varia com o volume" };
export const ROTULO_CENTRO_PADRAO: Record<string, string> = { UNIDADE: "Unidade que paga", CORPORATIVO: "Corporativo (vai para o rateio)" };
export const ROTULO_TIPO_CENTRO: Record<string, string> = { UNIDADE: "Unidade (geral)", SEGMENTO: "Segmento", AREA: "Área", PROJETO: "Projeto", CORPORATIVO: "Corporativo" };
export const SIGLA_SEGMENTO: Record<string, string> = { "Educação Infantil": "EI", "Fundamental I": "F1", "Fundamental II": "F2", "Ensino Médio": "EM" };

/** Chave de ordenação natural do código: 1.2 < 1.10 < 2 < … < 9 < R. */
export const chaveCodigo = (c: string) => c.split(".").map(p => /^\d+$/.test(p) ? p.padStart(5, "0") : `~${p}`).join(".");
export const ordenarContas = <T extends { codigo: string }>(cs: T[]) => [...cs].sort((a, b) => chaveCodigo(a.codigo) < chaveCodigo(b.codigo) ? -1 : chaveCodigo(a.codigo) > chaveCodigo(b.codigo) ? 1 : 0);

/** Analítica = recebe lançamento: do 3º nível para baixo e sem contas filhas. */
export function analiticas<T extends Conta>(cs: T[]): T[] {
  const temFilho = new Set(cs.filter(c => c.pai_id !== null).map(c => c.pai_id));
  return cs.filter(c => c.nivel >= 3 && !temFilho.has(c.id));
}
export function ehAnalitica(c: Conta, todas: Conta[]) { return c.nivel >= 3 && !todas.some(x => x.pai_id === c.id); }

/** Macrogrupo (nível 1) de uma conta. */
export function macrogrupo<T extends Conta>(c: T, porId: Map<number, T>): T {
  let x = c; let guarda = 0;
  while (x.pai_id !== null && porId.has(x.pai_id) && guarda++ < 10) x = porId.get(x.pai_id)!;
  return x;
}
/** Caminho “Ocupação › Utilidades › Energia elétrica”. */
export function caminho<T extends Conta>(c: T, porId: Map<number, T>): string {
  const partes: string[] = []; let x: T | undefined = c; let guarda = 0;
  while (x && guarda++ < 10) { partes.unshift(x.nome); x = x.pai_id !== null ? porId.get(x.pai_id) : undefined; }
  return partes.join(" › ");
}

/** Próximo código livre debaixo do pai: subgrupo 1.5, conta 1.5.01, subconta 1.5.01.001. */
export function proximoCodigo(pai: { codigo: string; nivel: number }, irmaos: { codigo: string }[]): string {
  const nums = irmaos.map(i => Number(i.codigo.split(".").pop())).filter(n => Number.isFinite(n));
  const n = (nums.length ? Math.max(...nums) : 0) + 1;
  const largura = pai.nivel === 1 ? 1 : pai.nivel === 2 ? 2 : 3;
  return `${pai.codigo}.${String(n).padStart(largura, "0")}`;
}

/** Texto comparável: minúsculo, sem acento, sem pontuação, espaços simples. */
export function normalizar(t: string | null | undefined): string {
  return (t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
/** Palavra (ou expressão) inteira dentro do texto normalizado. */
export function contemExpressao(textoNorm: string, expr: string): boolean {
  const e = normalizar(expr); if (!e) return false;
  return ` ${textoNorm} `.includes(` ${e} `);
}

export type Sugestao = { contaId: number; centroId: number | null; fonte: "REGRA" | "HISTORICO" | "PALAVRA" | "CATEGORIA"; confianca: "ALTA" | "MEDIA" | "BAIXA"; motivo: string; mudaCategoria: boolean };
export type EntradaSugestao = { tipo: string; categoria: string; contraparte: string | null; descricao: string | null; unit_id: number };
export type ContextoSugestao = {
  contas: Conta[]; regras: Regra[]; centros: Centro[];
  /** contraparte normalizada → contas já usadas nela (com quantas vezes e o centro mais usado) */
  historico: Map<string, { contaId: number; centroId: number | null; n: number }[]>;
  unidades: { id: number; codigo: string }[];
};

/** Contas que aceitam o tipo do lançamento (transferência só em conta de transferência). */
export function contasCompativeis(tipo: string, analit: Conta[]): Conta[] {
  if (tipo === "TRANSFERENCIA") return analit.filter(c => c.tipo_economico === "TRANSFERENCIA");
  return analit.filter(c => c.tipo === tipo);
}

/** Centro padrão de uma conta numa unidade: corporativo (rateio) ou o “geral” da unidade. */
export function centroPadrao(conta: Conta | undefined, unitId: number, ctx: Pick<ContextoSugestao, "centros" | "unidades">): number | null {
  if (!conta) return null;
  if (conta.centro_padrao === "CORPORATIVO") return ctx.centros.find(c => c.tipo === "CORPORATIVO" && c.ativo)?.id ?? null;
  const u = ctx.unidades.find(x => x.id === unitId); if (!u) return null;
  return ctx.centros.find(c => c.tipo === "UNIDADE" && c.unit_id === unitId && c.ativo)?.id ?? null;
}

/**
 * Sugestão de conta (e centro) para um lançamento, da mais forte para a mais fraca:
 * 1) regra cadastrada (contraparte/descrição contém o padrão) · 2) o que já foi usado nesta contraparte · 3) palavras-chave da conta
 * (preferindo contas da mesma categoria) · 4) a conta da categoria. Nunca devolve conta inativa ou sintética.
 */
export function sugerir(e: EntradaSugestao, ctx: ContextoSugestao): Sugestao | null {
  // centro aprendido (regra ou histórico) só vale se não for de outra unidade: a mesma contraparte paga por outra unidade fica no centro dela
  const centroOk = (id: number | null) => { if (!id) return null; const c = ctx.centros.find(x => x.id === id); return c && c.ativo && (c.unit_id === null || c.unit_id === e.unit_id) ? id : null; };
  const analit = contasCompativeis(e.tipo, analiticas(ctx.contas.filter(c => c.ativo)));
  const porId = new Map(analit.map(c => [c.id, c]));
  const texto = normalizar(`${e.contraparte ?? ""} ${e.descricao ?? ""}`);
  const muda = (c: Conta) => (c.categoria ?? "") !== e.categoria;
  // 1) regras (a mais específica: padrão mais longo; regra da unidade antes da regra da rede)
  const regras = ctx.regras.filter(r => (r.unit_id === null || r.unit_id === e.unit_id) && porId.has(r.conta_id) && normalizar(r.padrao).length >= 3 && texto.includes(normalizar(r.padrao)))
    .sort((a, b) => normalizar(b.padrao).length - normalizar(a.padrao).length || (b.unit_id === null ? 0 : 1) - (a.unit_id === null ? 0 : 1));
  if (regras.length) { const r = regras[0]; const c = porId.get(r.conta_id)!; return { contaId: c.id, centroId: centroOk(r.cost_center_id) ?? centroPadrao(c, e.unit_id, ctx), fonte: "REGRA", confianca: "ALTA", motivo: `Regra: contém “${r.padrao}”`, mudaCategoria: muda(c) }; }
  // 2) histórico da contraparte
  const cp = normalizar(e.contraparte);
  if (cp.length >= 3) {
    const hs = (ctx.historico.get(cp) ?? []).filter(h => porId.has(h.contaId)).sort((a, b) => b.n - a.n);
    if (hs.length) { const h = hs[0]; const c = porId.get(h.contaId)!; const unanime = hs.length === 1;
      return { contaId: c.id, centroId: centroOk(h.centroId) ?? centroPadrao(c, e.unit_id, ctx), fonte: "HISTORICO", confianca: unanime && h.n >= 2 ? "ALTA" : "MEDIA", motivo: `Já classificado ${h.n}× para esta contraparte${unanime ? "" : ` (há ${hs.length} contas usadas)`}`, mudaCategoria: muda(c) }; }
  }
  // 3) palavras-chave das contas
  if (texto) {
    let melhor: { c: Conta; tam: number; palavra: string } | null = null;
    for (const c of analit) for (const p of (c.palavras ?? "").split(",").map(x => x.trim()).filter(Boolean)) {
      if (!contemExpressao(texto, p)) continue; const tam = normalizar(p).length + (muda(c) ? 0 : 100); // mesma categoria vence
      if (!melhor || tam > melhor.tam) melhor = { c, tam, palavra: p };
    }
    if (melhor) return { contaId: melhor.c.id, centroId: centroPadrao(melhor.c, e.unit_id, ctx), fonte: "PALAVRA", confianca: muda(melhor.c) ? "BAIXA" : "MEDIA", motivo: `Palavra “${melhor.palavra}”${muda(melhor.c) ? ` — muda a categoria para ${melhor.c.categoria}` : ""}`, mudaCategoria: muda(melhor.c) };
  }
  // 4) pela categoria: a única conta da categoria (média) ou a primeira não genérica (baixa)
  const daCat = ordenarContas(analit.filter(c => c.categoria === e.categoria));
  if (daCat.length) { const c = daCat.find(x => !x.generica) ?? daCat[0];
    return { contaId: c.id, centroId: centroPadrao(c, e.unit_id, ctx), fonte: "CATEGORIA", confianca: daCat.length === 1 ? "MEDIA" : "BAIXA", motivo: daCat.length === 1 ? "Única conta da categoria" : `Pela categoria (${daCat.length} contas possíveis)`, mudaCategoria: false }; }
  return null;
}
