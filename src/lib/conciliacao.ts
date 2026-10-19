/**
 * v25 · Cobrança & Recebimentos (Nova Arquitetura, Cap. 21 · T-026, T-033…T-035, T-039 · KPI-09/10/39 · CRQ-COB-V3-01…04)
 * A conciliação como máquina de estados: cada recebimento baixado no ActiveSoft (fonte oficial da quitação) é casado com
 * o crédito do extrato (PIX, boleto, TED, depósito) ou com a venda e o repasse da Cielo (cartão). O que não bate vira
 * pendência tipificada, com dono, prazo e escalonamento em 15/30 dias. A quitação continua sendo do ActiveSoft:
 * o sistema nunca dá baixa em título — aponta o crédito sem baixa para a secretaria registrar na fonte.
 */
import { sql } from "@/db";
import { getSettings, hoje, addDays, type Settings } from "./utils";
import { notificar, usuariosPorPerfil } from "./comunicacao";
import type { Session } from "./auth";

// ---------------------------------------------------------------- rótulos
export const NATUREZA = { CREDITO: "Crédito", DEBITO: "Débito" } as const;
export const FORMA_LINHA: Record<string, string> = { PIX: "PIX", BOLETO: "Boleto", CARTAO: "Cartão (repasse)", TED: "TED/DOC", DEPOSITO: "Depósito", TARIFA: "Tarifa/encargo", TRANSFERENCIA: "Transferência/aplicação", OUTRO: "Outro" };
/** Formas de recebimento dos títulos (coluna "forma" da importação do ActiveSoft). */
export const FORMAS_RECEB = ["PIX", "CARTAO", "BOLETO", "OUTROS"] as const;
export type FormaReceb = typeof FORMAS_RECEB[number];
export const FORMA_RECEB_LABEL: Record<FormaReceb, string> = { PIX: "PIX", CARTAO: "Cartão", BOLETO: "Boleto", OUTROS: "Outros (dinheiro, TED, depósito)" };
export function formaRecebDe(v: string | null | undefined): FormaReceb | null {
  if (!v) return null; const t = v.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  if (/PIX/.test(t)) return "PIX"; if (/CART|CRED|DEB|CIELO|VISA|MASTER|ELO/.test(t)) return "CARTAO"; if (/BOLET|COBRAN/.test(t)) return "BOLETO";
  return "OUTROS";
}
export const LINHA_STATUS: Record<string, { rotulo: string; tom: string }> = {
  PENDENTE: { rotulo: "A conciliar", tom: "PENDENTE" }, SUGERIDO: { rotulo: "Par sugerido", tom: "PENDENTE" }, CONCILIADO: { rotulo: "Conciliado", tom: "APROVADA" },
  SEM_BAIXA: { rotulo: "Sem baixa no ActiveSoft", tom: "REJEITADA" }, NAO_IDENTIFICADO: { rotulo: "Não identificado", tom: "REJEITADA" }, SEM_PAR: { rotulo: "Sem par", tom: "REJEITADA" },
  DIVERGENTE: { rotulo: "Divergência", tom: "REJEITADA" }, IGNORADO: { rotulo: "Não é recebimento", tom: "CANCELADA" },
};
/** Venda de cartão em duas pontas: o título (secretaria) e o repasse (banco). */
export const VENDA_STATUS: Record<string, { rotulo: string; tom: string }> = {
  PENDENTE: { rotulo: "Sem título", tom: "REJEITADA" }, SUGERIDO: { rotulo: "Par sugerido", tom: "PENDENTE" }, CASADA: { rotulo: "Casada com o título", tom: "APROVADA" }, IGNORADO: { rotulo: "Desconsiderada", tom: "CANCELADA" },
};
export const REPASSE_STATUS: Record<string, { rotulo: string; tom: string }> = { A_RECEBER: { rotulo: "A receber", tom: "PENDENTE" }, CREDITADA: { rotulo: "Creditada no banco", tom: "APROVADA" } };
export const ISSUE_TIPO: Record<string, string> = {
  NAO_IDENTIFICADO: "PIX não identificado", SEM_BAIXA: "Crédito sem baixa no ActiveSoft", SEM_PAR_CREDITO: "Crédito sem título correspondente", SEM_PAR_BAIXA: "Baixa sem crédito no banco",
  SEM_PAR_VENDA: "Venda de cartão sem repasse", SEM_PAR_REPASSE: "Repasse da Cielo sem vendas", VENDA_SEM_TITULO: "Venda de cartão sem título baixado", VALOR: "Divergência de valor",
  TAXA: "Taxa de cartão acima do contrato", CENTAVOS: "Centavos sistemáticos",
};
/** Quem cuida de cada tipo por padrão: secretaria identifica pagador e registra baixa; o resto é do financeiro. */
export const DONO_PADRAO: Record<string, "COMERCIAL" | "FINANCEIRO"> = { NAO_IDENTIFICADO: "COMERCIAL", SEM_BAIXA: "COMERCIAL" };
export const DESFECHOS: Record<string, { rotulo: string; evidencia: "ARQUIVO" | "TEXTO" }> = {
  IDENTIFICADO: { rotulo: "Pagador identificado e vinculado", evidencia: "TEXTO" },
  BAIXA_REGISTRADA: { rotulo: "Baixa registrada no ActiveSoft", evidencia: "TEXTO" },
  LANCAMENTO_CORRIGIDO: { rotulo: "Lançamento corrigido na fonte", evidencia: "TEXTO" },
  TAXA_RECUPERADA: { rotulo: "Taxa contestada e recuperada", evidencia: "ARQUIVO" },
  ESTORNO: { rotulo: "Estorno / devolução ao pagador", evidencia: "ARQUIVO" },
  PERDA_ASSUMIDA: { rotulo: "Perda assumida (com alçada)", evidencia: "ARQUIVO" },
  NAO_PROCEDE: { rotulo: "Não procede (explicado)", evidencia: "TEXTO" },
  CONCILIADO_AUTO: { rotulo: "Par encontrado numa nova conciliação", evidencia: "TEXTO" },
};
export const CLASSES_IGNORA: Record<string, string> = { TRANSFERENCIA: "Transferência entre contas do grupo", APLICACAO: "Aplicação / resgate / rendimento", OUTRA_RECEITA: "Outra receita (não é título de família)", ESTORNO: "Estorno / devolução", OUTRO: "Outro (explicado)" };

export const OPERA = ["DIRECAO", "FINANCEIRO"];
export const podeOperar = (s: Session) => OPERA.includes(s.role);
/** Secretaria (perfil Comercial) faz a triagem dos PIX não identificados e registra baixas pendentes. */
export const podeTriar = (s: Session) => OPERA.includes(s.role) || s.role === "COMERCIAL";
/** Leitura: Direção, Financeiro, RH (consulta) e diretor de unidade (só a sua unidade). */
export const podeVer = (s: Session) => [...OPERA, "RH", "DIRETOR_UNIDADE", "LEITURA"].includes(s.role) || s.role === "COMERCIAL";

// ---------------------------------------------------------------- utilidades
const r2 = (v: number) => Math.round(v * 100) / 100;
export const semAcento = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "");
const STOP = new Set(["de", "da", "do", "das", "dos", "e", "pix", "recebido", "rec", "transf", "ted", "doc", "pagamento", "pagto", "pgto", "ltda", "me", "sa", "responsavel", "cpf", "cnpj"]);
export function tokens(v: string | null | undefined): string[] {
  if (!v) return [];
  return [...new Set(semAcento(v).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(t => t.length >= 2 && !STOP.has(t)))];
}
/** Semelhança de nomes (0–1): fração dos termos do nome mais curto presentes no outro (tolera nome abreviado no extrato). */
export function semelhanca(a: string | null | undefined, b: string | null | undefined): number {
  const x = tokens(a), y = tokens(b); if (!x.length || !y.length) return 0;
  const ys = new Set(y); const comuns = x.filter(t => ys.has(t) || [...ys].some(u => u.length >= 4 && t.length >= 4 && (u.startsWith(t) || t.startsWith(u)))).length;
  return comuns / Math.min(x.length, y.length);
}
const dias = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
export function lerValor(v: string): number {
  let t = (v ?? "").trim().replace(/[R$\s]/g, ""); if (!t) return NaN;
  let neg = false; if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); } if (/D$/i.test(t)) { neg = true; t = t.slice(0, -1); } if (/C$/i.test(t)) t = t.slice(0, -1);
  if (t.startsWith("-")) { neg = !neg; t = t.slice(1); } else if (t.endsWith("-")) { neg = !neg; t = t.slice(0, -1); }
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, "").replace(",", "."); else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");
  const n = Number(t); return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}
export function lerData(v: string): string | null {
  const t = (v ?? "").trim(); let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`; m = t.match(/^(\d{4})(\d{2})(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

// ---------------------------------------------------------------- leitura dos arquivos
export type LinhaExtrato = { data: string; valor: number; descricao: string; documento: string | null; pagador: string | null; pagadorDoc: string | null; chave: string };
/** OFX 1.x (SGML, sem fechamento de tags) ou 2.x (XML): um <STMTTRN> por lançamento. */
export function lerOFX(texto: string): LinhaExtrato[] {
  const out: LinhaExtrato[] = []; const blocos = texto.split(/<STMTTRN>/i).slice(1);
  const tag = (b: string, t: string) => { const m = b.match(new RegExp(`<${t}>([^<\\r\\n]*)`, "i")); return m ? m[1].trim() : ""; };
  for (const b0 of blocos) {
    const b = b0.split(/<\/STMTTRN>/i)[0]; const data = lerData(tag(b, "DTPOSTED")); const valor = lerValor(tag(b, "TRNAMT").replace(".", ","));
    if (!data || !Number.isFinite(valor) || valor === 0) continue;
    const nome = tag(b, "NAME"); const memo = tag(b, "MEMO"); const fitid = tag(b, "FITID") || tag(b, "CHECKNUM") || tag(b, "REFNUM");
    const descricao = [memo, nome].filter(Boolean).join(" · ") || "Lançamento";
    out.push({ data, valor: r2(valor), descricao, documento: fitid || null, pagador: nome || null, pagadorDoc: null, chave: fitid ? `fitid:${fitid}` : `h:${data}|${valor.toFixed(2)}|${descricao}` });
  }
  return out;
}
/** CSV/planilha de extrato: data;descricao;valor (negativo = débito) — ou colunas credito/debito; opcionais documento, pagador, cpf_cnpj. */
export function lerExtratoCSV(texto: string, sepDe: (l: string) => string, cab: (h: string) => string): LinhaExtrato[] {
  const linhas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean); if (linhas.length < 2) throw new Error("O extrato precisa de cabeçalho e ao menos uma linha.");
  const sep = sepDe(linhas[0]); const head = linhas[0].split(sep).map(cab);
  const ix = (...ks: string[]) => { for (const k of ks) { const i = head.indexOf(k); if (i >= 0) return i; } return -1; };
  const iData = ix("data", "data_lancamento", "dt", "data_movimento"); const iDesc = ix("descricao", "historico", "lancamento", "memo"); const iValor = ix("valor", "valor_r", "montante");
  const iCred = ix("credito", "entrada"); const iDeb = ix("debito", "saida"); const iDoc = ix("documento", "doc", "id", "fitid", "identificador"); const iPag = ix("pagador", "nome", "favorecido", "contraparte"); const iCpf = ix("cpf_cnpj", "cpf", "cnpj", "documento_pagador");
  if (iData < 0 || (iValor < 0 && iCred < 0 && iDeb < 0)) throw new Error("Cabeçalho do extrato precisa de data e valor (ou credito/debito). Opcionais: descricao, documento, pagador, cpf_cnpj.");
  const out: LinhaExtrato[] = [];
  for (const l of linhas.slice(1)) {
    const c = l.split(sep).map(x => x.trim().replace(/^"(.*)"$/, "$1")); const data = lerData(c[iData] ?? ""); if (!data) continue;
    let valor = iValor >= 0 ? lerValor(c[iValor] ?? "") : NaN;
    if (!Number.isFinite(valor)) { const cr = iCred >= 0 ? lerValor(c[iCred] ?? "") : NaN, db = iDeb >= 0 ? lerValor(c[iDeb] ?? "") : NaN; valor = Number.isFinite(cr) && cr !== 0 ? Math.abs(cr) : Number.isFinite(db) && db !== 0 ? -Math.abs(db) : NaN; }
    if (!Number.isFinite(valor) || valor === 0) continue;
    const descricao = (iDesc >= 0 ? c[iDesc] : "") || "Lançamento"; const documento = iDoc >= 0 ? c[iDoc] || null : null; const pagador = iPag >= 0 ? c[iPag] || null : null;
    out.push({ data, valor: r2(valor), descricao, documento, pagador, pagadorDoc: iCpf >= 0 ? (c[iCpf] || null) : null, chave: documento ? `doc:${documento}` : `h:${data}|${valor.toFixed(2)}|${descricao}|${pagador ?? ""}` });
  }
  return out;
}
export type LinhaCielo = { dataVenda: string; dataPagamento: string | null; bandeira: string; produto: string; parcelas: number; parcela: number; nsu: string | null; autorizacao: string | null; bruto: number; taxa: number; liquido: number; antecipado: boolean; unidade: string | null; chave: string };
/** Relatório de vendas/recebíveis da Cielo exportado em CSV/planilha. Aceita os nomes de coluna do portal (com ou sem acento). */
export function lerCielo(texto: string, sepDe: (l: string) => string, cab: (h: string) => string): LinhaCielo[] {
  const linhas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean); if (linhas.length < 2) throw new Error("O relatório precisa de cabeçalho e ao menos uma venda.");
  const sep = sepDe(linhas[0]); const head = linhas[0].split(sep).map(cab);
  const ix = (...ks: string[]) => { for (const k of ks) { const i = head.indexOf(k); if (i >= 0) return i; } return -1; };
  const i = { venda: ix("data_venda", "data_da_venda", "data"), pag: ix("data_pagamento", "data_prevista_de_pagamento", "previsao_de_pagamento", "data_prevista", "data_de_pagamento"), band: ix("bandeira"),
    prod: ix("produto", "forma_de_pagamento", "tipo", "modalidade"), parc: ix("parcelas", "quantidade_de_parcelas", "qtd_parcelas"), nparc: ix("parcela", "numero_da_parcela"), nsu: ix("nsu", "nsu_doc", "nsu/doc", "doc"),
    aut: ix("autorizacao", "codigo_de_autorizacao", "cod_autorizacao"), bruto: ix("valor_bruto", "valor_da_venda", "valor"), taxa: ix("taxa", "valor_da_taxa", "taxa_tarifa", "mdr", "desconto"), liq: ix("valor_liquido", "liquido"),
    ant: ix("antecipacao", "antecipado"), un: ix("unidade", "estabelecimento") };
  if (i.venda < 0 || i.band < 0 || i.bruto < 0) throw new Error("Cabeçalho do relatório da Cielo precisa de data_venda, bandeira e valor_bruto (opcionais: data_pagamento, produto, parcelas, parcela, nsu, autorizacao, taxa, valor_liquido, antecipacao, unidade).");
  const out: LinhaCielo[] = [];
  for (const l of linhas.slice(1)) {
    const c = l.split(sep).map(x => x.trim().replace(/^"(.*)"$/, "$1")); const g = (k: number) => (k >= 0 ? c[k] ?? "" : "");
    const dataVenda = lerData(g(i.venda)); const bruto = Math.abs(lerValor(g(i.bruto))); if (!dataVenda || !Number.isFinite(bruto) || bruto === 0) continue;
    let liquido = i.liq >= 0 ? Math.abs(lerValor(g(i.liq))) : NaN; let taxa = i.taxa >= 0 ? Math.abs(lerValor(g(i.taxa))) : NaN;
    if (Number.isFinite(taxa) && /%/.test(g(i.taxa))) taxa = r2(bruto * taxa / 100);
    if (!Number.isFinite(liquido) && Number.isFinite(taxa)) liquido = r2(bruto - taxa); if (!Number.isFinite(taxa) && Number.isFinite(liquido)) taxa = r2(bruto - liquido); if (!Number.isFinite(liquido)) { liquido = bruto; taxa = 0; }
    const parcelas = Math.max(1, Number(g(i.parc).replace(/\D/g, "")) || 1); const parcela = Math.max(1, Number(g(i.nparc).split(/\D/)[0]) || 1);
    const nsu = g(i.nsu) || null; const bandeira = g(i.band) || "—"; const produto = g(i.prod) || (parcelas > 1 ? "Crédito parcelado" : "Crédito à vista");
    out.push({ dataVenda, dataPagamento: lerData(g(i.pag)), bandeira, produto, parcelas, parcela, nsu, autorizacao: g(i.aut) || null, bruto: r2(bruto), taxa: r2(taxa), liquido: r2(liquido), antecipado: /^(s|sim|y|yes|1|true|x)$/i.test(g(i.ant)), unidade: g(i.un) || null,
      chave: nsu ? `nsu:${nsu}|${parcela}|${dataVenda}` : `h:${dataVenda}|${bandeira}|${bruto.toFixed(2)}|${g(i.aut)}|${parcela}` });
  }
  return out;
}

/** Forma do lançamento pelo histórico do banco (palavras-chave configuráveis). */
export function classificarLinha(descricao: string, valor: number, cfg: Settings): string {
  const t = semAcento(descricao).toUpperCase(); const k = cfg.conciliacao.palavras as Record<string, string[]>;
  const tem = (xs: string[] | undefined) => (xs ?? []).some(p => t.includes(p.toUpperCase()));
  if (tem(k.transferencia)) return "TRANSFERENCIA";
  if (valor < 0 && tem(k.tarifa)) return "TARIFA";
  if (tem(k.cartao)) return "CARTAO";
  if (tem(k.pix)) return "PIX";
  if (tem(k.boleto)) return "BOLETO";
  if (tem(k.ted)) return "TED";
  if (tem(k.deposito)) return "DEPOSITO";
  return "OUTRO";
}
/** Categoria do fluxo de caixa sugerida para o lançamento do extrato (reclassificável, com trilha). */
export function categoriaCaixa(forma: string, valor: number): { tipo: string; categoria: string } {
  if (forma === "TRANSFERENCIA") return { tipo: "TRANSFERENCIA", categoria: "Transferências internas" };
  if (valor > 0) return { tipo: "ENTRADA", categoria: ["PIX", "BOLETO", "CARTAO", "TED", "DEPOSITO"].includes(forma) ? "Mensalidades" : "Outras receitas" };
  return { tipo: "SAIDA", categoria: forma === "TARIFA" ? "Financeiras" : "Outras despesas" };
}
/** Categoria da taxa contratada: débito, crédito à vista, parcelado 2–6 ou 7–12. */
export function categoriaCartao(produto: string, parcelas: number): string {
  const p = semAcento(produto).toUpperCase(); if (/DEBIT/.test(p)) return "Débito"; if (parcelas >= 7) return "Crédito parcelado 7–12x"; if (parcelas >= 2 || /PARCEL/.test(p)) return "Crédito parcelado 2–6x"; return "Crédito à vista";
}
export function taxaContratada(cfg: Settings, bandeira: string, categoria: string): number | null {
  const tab = cfg.conciliacao.taxasCartao as { bandeira: string; categoria: string; taxa: number }[];
  const b = semAcento(bandeira).toUpperCase();
  const t = tab.find(x => semAcento(x.bandeira).toUpperCase() === b && x.categoria === categoria) ?? tab.find(x => x.bandeira === "*" && x.categoria === categoria);
  return t ? t.taxa : null;
}

// ---------------------------------------------------------------- motor de conciliação
type Conta = { id: number; unit_id: number | null; company_id: number | null };
type LinhaDb = { id: number; bank_account_id: number; data: string; valor: number; forma: string; descricao: string | null; pagador: string | null; status: string; student_id: number | null };
type RecDb = { id: number; unit_id: number; aluno_nome: string; responsavel: string | null; student_id: number | null; valor: number; valor_pago: number; pago_em: string; forma: string | null };
type AbertoDb = { id: number; unit_id: number; aluno_nome: string; responsavel: string | null; student_id: number | null; valor: number; vencimento: string };
type VendaDb = { id: number; unit_id: number | null; data_venda: string; data_pagamento: string | null; bandeira: string; produto: string; parcelas: number; nsu: string | null; chave: string; valor_bruto: number; valor_taxa: number; valor_liquido: number; antecipado: boolean; status: string; repasse: string };
export type ResumoConciliacao = { creditos: number; conciliadosAuto: number; sugeridos: number; semBaixa: number; naoIdentificados: number; semPar: number; boletosAgrupados: number; vendas: number; vendasCasadas: number; repassesConciliados: number; pendenciasAbertas: number; resolvidasAuto: number };

const BANDEIRAS = ["VISA", "MASTER", "ELO", "AMEX", "HIPER", "DINERS", "CABAL"];
const bandeiraDe = (t: string) => { const u = semAcento(t).toUpperCase(); return BANDEIRAS.find(b => u.includes(b)) ?? null; };

async function donosPadrao() {
  const us = await sql<{ id: number; role: string }[]>`SELECT id, role FROM users WHERE ativo AND role IN ('COMERCIAL','FINANCEIRO','DIRECAO') ORDER BY id`;
  const de = (r: string) => us.find(u => u.role === r)?.id ?? null;
  return { COMERCIAL: de("COMERCIAL") ?? de("FINANCEIRO") ?? de("DIRECAO"), FINANCEIRO: de("FINANCEIRO") ?? de("DIRECAO") };
}

type Emissao = { chave: string; tipo: string; origem: string; unitId: number | null; valor: number | null; descricao: string; bankLineId?: number | null; cardSaleId?: number | null; receivableId?: number | null; referencia: string };
/** Registra (ou atualiza, se ainda aberta) a pendência; nunca reabre uma pendência resolvida por uma pessoa. */
async function emitir(e: Emissao, donos: { COMERCIAL: number | null; FINANCEIRO: number | null }, cfg: Settings) {
  const dono = donos[DONO_PADRAO[e.tipo] ?? "FINANCEIRO"]; const prazo = addDays(hoje(), (cfg.conciliacao.escalonamentoDias as number[])[0] ?? 15);
  await sql`INSERT INTO recon_issues (chave, tipo, origem, unit_id, valor, descricao, bank_line_id, card_sale_id, receivable_id, referencia, dono_user_id, prazo)
    VALUES (${e.chave}, ${e.tipo}, ${e.origem}, ${e.unitId}, ${e.valor === null ? null : r2(e.valor)}, ${e.descricao}, ${e.bankLineId ?? null}, ${e.cardSaleId ?? null}, ${e.receivableId ?? null}, ${e.referencia}, ${dono}, ${prazo})
    ON CONFLICT (chave) DO UPDATE SET valor=EXCLUDED.valor, descricao=EXCLUDED.descricao, unit_id=EXCLUDED.unit_id, updated_at=now() WHERE recon_issues.status='ABERTA'`;
}

/**
 * Concilia o período [de, ate] (datas dos créditos e das baixas): PIX/TED/depósito um a um, boletos um a um ou pelo
 * total do dia, cartão em duas pontas (venda × título e repasse × banco), taxa × contrato e centavos sistemáticos.
 * Idempotente: refaz só as sugestões; pares confirmados, classificações e pendências tratadas por pessoas ficam.
 */
export async function processarConciliacao(de: string, ate: string, s?: Session | null): Promise<ResumoConciliacao> {
  const cfg = await getSettings(); const c = cfg.conciliacao; const janela = c.janelaDias as number; const janelaCartao = c.janelaCartaoDias as number; const limiar = c.limiarAuto as number; const tolC = c.toleranciaCentavos as number;
  const donos = await donosPadrao(); const emitidas = new Set<string>(); const res: ResumoConciliacao = { creditos: 0, conciliadosAuto: 0, sugeridos: 0, semBaixa: 0, naoIdentificados: 0, semPar: 0, boletosAgrupados: 0, vendas: 0, vendasCasadas: 0, repassesConciliados: 0, pendenciasAbertas: 0, resolvidasAuto: 0 };
  const emite = async (e: Emissao) => { emitidas.add(e.chave); await emitir(e, donos, cfg); };
  const contas = await sql<Conta[]>`SELECT id, unit_id, company_id FROM bank_accounts`;
  const units = await sql<{ id: number; company_id: number | null }[]>`SELECT id, company_id FROM units`;
  const unidadesDaConta = (id: number): number[] | null => { const a = contas.find(x => x.id === id); if (!a) return null; if (a.unit_id) return [a.unit_id]; if (a.company_id) return units.filter(u => u.company_id === a.company_id).map(u => u.id); return null; };
  const unidadeDaConta = (id: number) => { const u = unidadesDaConta(id); return u && u.length === 1 ? u[0] : null; };
  const lote = `auto-${Date.now().toString(36)}`; const quem = s?.nome ?? "sistema";

  // ---------- 1. créditos do extrato (exceto repasse de cartão) ----------
  const linhas = await sql<LinhaDb[]>`SELECT id, bank_account_id, data::text, valor::float, forma, descricao, pagador, status, student_id FROM bank_lines
    WHERE valor > 0 AND data BETWEEN ${de} AND ${ate} AND forma IN ('PIX','BOLETO','TED','DEPOSITO','OUTRO') AND status IN ('PENDENTE','SUGERIDO','SEM_BAIXA','NAO_IDENTIFICADO','SEM_PAR','DIVERGENTE') ORDER BY data, id`;
  res.creditos = linhas.length;
  if (linhas.length) await sql`DELETE FROM recon_matches WHERE status='SUGERIDO' AND bank_line_id = ANY(${linhas.map(l => l.id)})`;
  const recs = await sql<RecDb[]>`SELECT id, unit_id, aluno_nome, responsavel, student_id, valor::float, coalesce(valor_pago, valor)::float AS valor_pago, pago_em::text, forma_pagamento AS forma FROM receivables
    WHERE status='PAGO' AND conciliado_em IS NULL AND pago_em BETWEEN ${addDays(de, -janela - 3)} AND ${addDays(ate, janela)} AND coalesce(forma_pagamento,'') <> 'CARTAO'`;
  const usados = new Set<number>();
  const abertos = await sql<AbertoDb[]>`SELECT id, unit_id, aluno_nome, responsavel, student_id, valor::float, vencimento::text FROM receivables WHERE status='ABERTO' AND vencimento BETWEEN ${addDays(de, -75)} AND ${addDays(ate, 20)}`;
  const familias = await sql<{ id: number; nome: string; responsavel: string | null; unit_atual_id: number | null }[]>`SELECT id, nome, responsavel, unit_atual_id FROM students WHERE aluno_atual OR id IN (SELECT student_id FROM receivables WHERE student_id IS NOT NULL AND vencimento >= ${addDays(de, -400)})`;

  const confirmar = async (linha: LinhaDb, itens: RecDb[], conf: number, motivo: string, metodo: "AUTO" | "HUMANO") => {
    const grupo = `${lote}-${linha.id}`;
    for (const r of itens) { await sql`INSERT INTO recon_matches (tipo, grupo, receivable_id, bank_line_id, valor, confianca, metodo, status, motivo, user_id, user_nome, confirmado_em) VALUES (${linha.forma}, ${grupo}, ${r.id}, ${linha.id}, ${r.valor_pago}, ${conf}, ${metodo}, 'CONFIRMADO', ${motivo}, ${s?.id ?? null}, ${quem}, now())`; usados.add(r.id); }
    await sql`UPDATE receivables SET conciliado_em=now() WHERE id = ANY(${itens.map(r => r.id)})`;
    await sql`UPDATE bank_lines SET status='CONCILIADO', student_id=coalesce(student_id, ${itens[0]?.student_id ?? null}) WHERE id=${linha.id}`;
  };
  const sugerir = async (linha: LinhaDb, itens: RecDb[], conf: number, motivo: string) => {
    const grupo = `${lote}-${linha.id}`;
    for (const r of itens) await sql`INSERT INTO recon_matches (tipo, grupo, receivable_id, bank_line_id, valor, confianca, metodo, status, motivo, user_nome) VALUES (${linha.forma}, ${grupo}, ${r.id}, ${linha.id}, ${r.valor_pago}, ${conf}, 'AUTO', 'SUGERIDO', ${motivo}, ${quem})`;
    await sql`UPDATE bank_lines SET status='SUGERIDO' WHERE id=${linha.id}`;
  };

  type Cand = { itens: RecDb[]; conf: number; motivo: string };
  const pontuar = (linha: LinhaDb, itens: RecDb[], nCands: number): Cand => {
    const d = Math.min(...itens.map(r => Math.abs(dias(r.pago_em, linha.data)))); const nome = Math.max(...itens.map(r => Math.max(semelhanca(linha.pagador ?? linha.descricao, r.responsavel), semelhanca(linha.pagador ?? linha.descricao, r.aluno_nome))));
    const forma = itens.every(r => r.forma && (r.forma === linha.forma || (r.forma === "OUTROS" && ["TED", "DEPOSITO", "OUTRO"].includes(linha.forma))));
    let conf = 40 + (d === 0 ? 25 : d <= 1 ? 20 : 10) + (nome >= 0.8 ? 25 : nome >= 0.5 ? 15 : nome > 0 ? 5 : 0) + (nCands === 1 ? 10 : -5 * (nCands - 1)) + (forma ? 5 : 0) + (linha.student_id && itens.every(r => r.student_id === linha.student_id) ? 20 : 0) - (itens.length > 1 ? 5 : 0);
    conf = Math.max(1, Math.min(99, conf));
    const motivo = [`valor exato${itens.length > 1 ? ` (${itens.length} títulos da mesma família)` : ""}`, d === 0 ? "mesmo dia da baixa" : `${d} dia(s) da baixa`, nome > 0 ? `nome ${Math.round(nome * 100)}%` : "sem nome do pagador", nCands === 1 ? "único candidato" : `${nCands} candidatos`, ...(forma ? ["forma confere"] : [])].join(" · ");
    return { itens, conf, motivo };
  };
  const compativel = (linha: LinhaDb, r: RecDb) => {
    if (usados.has(r.id)) return false; const us = unidadesDaConta(linha.bank_account_id); if (us && !us.includes(r.unit_id)) return false;
    if (Math.abs(dias(r.pago_em, linha.data)) > janela + (linha.forma === "BOLETO" ? 3 : 0)) return false;
    if (!r.forma) return true; if (linha.forma === "PIX") return r.forma === "PIX"; if (linha.forma === "BOLETO") return r.forma === "BOLETO"; return r.forma === "OUTROS" || r.forma === "PIX";
  };

  const restantesBoleto: LinhaDb[] = [];
  for (const linha of linhas) {
    // candidatos de um título só, com valor exato
    const um = recs.filter(r => compativel(linha, r) && Math.abs(r.valor_pago - linha.valor) < 0.005 && (!linha.student_id || r.student_id === linha.student_id));
    let cands: Cand[] = um.map(r => pontuar(linha, [r], um.length));
    // família pagando vários títulos num crédito só (irmãos, mês + material): 2 a 4 títulos do mesmo responsável que somam o valor exato
    if (!cands.length && linha.forma !== "BOLETO") {
      const porResp = new Map<string, RecDb[]>();
      for (const r of recs) if (compativel(linha, r)) { const k = (r.student_id && linha.student_id) ? `s${r.student_id}` : semAcento((r.responsavel ?? r.aluno_nome).toLowerCase()); porResp.set(k, [...(porResp.get(k) ?? []), r]); }
      for (const grupo of porResp.values()) {
        if (grupo.length < 2 || grupo.length > 8) continue;
        const n = grupo.length; let achou: RecDb[] | null = null;
        for (let mask = 1; mask < 1 << n && !achou; mask++) { const bits = [...Array(n).keys()].filter(i => mask & (1 << i)); if (bits.length < 2 || bits.length > 4) continue; const sum = bits.reduce((a, i) => a + grupo[i].valor_pago, 0); if (Math.abs(sum - linha.valor) < 0.005) achou = bits.map(i => grupo[i]); }
        if (achou) cands.push(pontuar(linha, achou, 1));
      }
      if (cands.length > 1) cands = cands.map(cd => pontuar(linha, cd.itens, cands.length));
    }
    cands.sort((a, b) => b.conf - a.conf);
    if (cands.length) {
      const [melhor, segundo] = cands;
      if (melhor.conf >= limiar && (!segundo || melhor.conf - segundo.conf >= 10)) { await confirmar(linha, melhor.itens, melhor.conf, melhor.motivo, "AUTO"); res.conciliadosAuto++; }
      else { await sugerir(linha, melhor.itens, melhor.conf, melhor.motivo); for (const r of melhor.itens) usados.add(r.id); res.sugeridos++; }
      continue;
    }
    if (linha.forma === "BOLETO") { restantesBoleto.push(linha); continue; }
    // sem título baixado: o crédito bate com um título em aberto da mesma família? → baixa a registrar no ActiveSoft (a quitação é da fonte oficial)
    const us = unidadesDaConta(linha.bank_account_id);
    const ab = abertos.filter(a => Math.abs(a.valor - linha.valor) < 0.005 && (!us || us.includes(a.unit_id)) && (linha.student_id ? a.student_id === linha.student_id : Math.max(semelhanca(linha.pagador ?? linha.descricao, a.responsavel), semelhanca(linha.pagador ?? linha.descricao, a.aluno_nome)) >= 0.5));
    if (ab.length) {
      const a = ab.sort((x, y) => Math.abs(dias(x.vencimento, linha.data)) - Math.abs(dias(y.vencimento, linha.data)))[0];
      await sql`UPDATE bank_lines SET status='SEM_BAIXA', student_id=coalesce(student_id, ${a.student_id}) WHERE id=${linha.id}`; res.semBaixa++;
      await emite({ chave: `sbx:${linha.id}`, tipo: "SEM_BAIXA", origem: linha.forma, unitId: a.unit_id, valor: linha.valor, bankLineId: linha.id, receivableId: a.id, referencia: linha.data,
        descricao: `Crédito ${FORMA_LINHA[linha.forma] ?? linha.forma} de ${(linha.pagador ?? "pagador não informado")} em ${linha.data.split("-").reverse().join("/")} bate com o título em aberto de ${a.aluno_nome} (venc. ${a.vencimento.split("-").reverse().join("/")}) — registre a baixa no ActiveSoft e reimporte os títulos.` });
      continue;
    }
    // pagador conhecido (família da rede) sem título correspondente; ou não identificado
    const fam = linha.student_id ? familias.find(f => f.id === linha.student_id) : familias.map(f => ({ f, sc: Math.max(semelhanca(linha.pagador ?? "", f.responsavel), semelhanca(linha.pagador ?? "", f.nome)) })).filter(x => x.sc >= 0.75).sort((a, b) => b.sc - a.sc)[0]?.f;
    if (fam && linha.forma !== "OUTRO") {
      await sql`UPDATE bank_lines SET status='SEM_PAR', student_id=coalesce(student_id, ${fam.id}) WHERE id=${linha.id}`; res.semPar++;
      await emite({ chave: `spc:${linha.id}`, tipo: "SEM_PAR_CREDITO", origem: linha.forma, unitId: fam.unit_atual_id ?? unidadeDaConta(linha.bank_account_id), valor: linha.valor, bankLineId: linha.id, referencia: linha.data,
        descricao: `Crédito de ${linha.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} da família de ${fam.nome} em ${linha.data.split("-").reverse().join("/")} sem título com esse valor (adiantamento, pagamento parcial ou valor errado).` });
    } else if (linha.forma === "PIX" || linha.forma === "TED" || linha.forma === "DEPOSITO") {
      await sql`UPDATE bank_lines SET status='NAO_IDENTIFICADO' WHERE id=${linha.id}`; res.naoIdentificados++;
      await emite({ chave: `nid:${linha.id}`, tipo: "NAO_IDENTIFICADO", origem: linha.forma, unitId: unidadeDaConta(linha.bank_account_id), valor: linha.valor, bankLineId: linha.id, referencia: linha.data,
        descricao: `${FORMA_LINHA[linha.forma]} de ${linha.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} em ${linha.data.split("-").reverse().join("/")}${linha.pagador ? ` (pagador: ${linha.pagador})` : " sem nome do pagador"} — identifique a família.` });
    } else { await sql`UPDATE bank_lines SET status='PENDENTE' WHERE id=${linha.id}`; }
  }

  // ---------- 2. boletos pelo total do dia (o banco credita a liquidação agrupada, D+1 a D+3) ----------
  const centavos = new Map<string, { n: number; soma: number; unit: number | null; mes: string; origem: string; rotulo: string }>();
  for (const linha of restantesBoleto) {
    const us = unidadesDaConta(linha.bank_account_id); let melhor: { dia: string; itens: RecDb[]; dif: number } | null = null;
    for (let k = 0; k <= 3; k++) {
      const dia = addDays(linha.data, -k); const itens = recs.filter(r => !usados.has(r.id) && r.pago_em === dia && (r.forma === "BOLETO" || !r.forma) && (!us || us.includes(r.unit_id)));
      if (!itens.length) continue; const dif = r2(linha.valor - itens.reduce((a, r) => a + r.valor_pago, 0));
      if (!melhor || Math.abs(dif) < Math.abs(melhor.dif)) melhor = { dia, itens, dif };
    }
    if (melhor && Math.abs(melhor.dif) < 0.005) { await confirmar(linha, melhor.itens, 95, `total do dia ${melhor.dia.split("-").reverse().join("/")}: ${melhor.itens.length} boleto(s) somam o crédito`, "AUTO"); res.boletosAgrupados++; res.conciliadosAuto++; }
    else if (melhor && Math.abs(melhor.dif) <= tolC * melhor.itens.length) {
      await confirmar(linha, melhor.itens, 85, `total do dia ${melhor.dia.split("-").reverse().join("/")} com diferença de ${melhor.dif.toFixed(2).replace(".", ",")} (centavos)`, "AUTO"); res.boletosAgrupados++; res.conciliadosAuto++;
      const k = `cent:BOLETO|${linha.data.slice(0, 7)}|${linha.bank_account_id}`; const a = centavos.get(k) ?? { n: 0, soma: 0, unit: unidadeDaConta(linha.bank_account_id), mes: linha.data.slice(0, 7), origem: "BOLETO", rotulo: "liquidação de boletos" }; a.n++; a.soma = r2(a.soma + melhor.dif); centavos.set(k, a);
    } else if (melhor) {
      await sql`UPDATE bank_lines SET status='DIVERGENTE' WHERE id=${linha.id}`;
      await emite({ chave: `val:${linha.id}`, tipo: "VALOR", origem: "BOLETO", unitId: unidadeDaConta(linha.bank_account_id), valor: melhor.dif, bankLineId: linha.id, referencia: linha.data,
        descricao: `Liquidação de boletos de ${linha.data.split("-").reverse().join("/")}: banco creditou ${linha.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}; os ${melhor.itens.length} boleto(s) baixados em ${melhor.dia.split("-").reverse().join("/")} somam ${(linha.valor - melhor.dif).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} (diferença ${melhor.dif.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}).` });
    } else {
      await sql`UPDATE bank_lines SET status='SEM_PAR' WHERE id=${linha.id}`; res.semPar++;
      await emite({ chave: `spc:${linha.id}`, tipo: "SEM_PAR_CREDITO", origem: "BOLETO", unitId: unidadeDaConta(linha.bank_account_id), valor: linha.valor, bankLineId: linha.id, referencia: linha.data,
        descricao: `Crédito de boletos de ${linha.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} em ${linha.data.split("-").reverse().join("/")} sem boletos baixados nos 3 dias anteriores — confira a baixa no ActiveSoft.` });
    }
  }

  // ---------- 3. cartão: venda × título (ponta da secretaria) ----------
  const vendas = await sql<VendaDb[]>`SELECT id, unit_id, data_venda::text, data_pagamento::text, bandeira, produto, parcelas, nsu, chave, valor_bruto::float, valor_taxa::float, valor_liquido::float, antecipado, status, repasse FROM card_sales
    WHERE data_venda BETWEEN ${addDays(de, -janelaCartao)} AND ${ate} ORDER BY data_venda, id`;
  const chaveVenda = (v: VendaDb) => v.nsu ? `${v.nsu}|${v.data_venda}` : v.chave.replace(/\|\d+$/, "");
  const porVenda = new Map<string, VendaDb[]>(); for (const v of vendas) porVenda.set(chaveVenda(v), [...(porVenda.get(chaveVenda(v)) ?? []), v]);
  res.vendas = porVenda.size;
  const pend = [...porVenda.values()].filter(vs => vs.every(v => ["PENDENTE", "SUGERIDO"].includes(v.status)));
  if (pend.length) await sql`DELETE FROM recon_matches WHERE status='SUGERIDO' AND card_sale_id = ANY(${pend.flat().map(v => v.id)})`;
  const recsCartao = await sql<RecDb[]>`SELECT id, unit_id, aluno_nome, responsavel, student_id, valor::float, coalesce(valor_pago, valor)::float AS valor_pago, pago_em::text, forma_pagamento AS forma FROM receivables
    WHERE status='PAGO' AND conciliado_em IS NULL AND pago_em BETWEEN ${addDays(de, -janelaCartao)} AND ${addDays(ate, janelaCartao)} AND (forma_pagamento='CARTAO' OR forma_pagamento IS NULL)`;
  const usadosC = new Set<number>();
  for (const vs of pend) {
    const v0 = vs[0]; const bruto = r2(vs.reduce((a, v) => a + v.valor_bruto, 0));
    const cands = recsCartao.filter(r => !usadosC.has(r.id) && !usados.has(r.id) && Math.abs(r.valor_pago - bruto) < 0.005 && Math.abs(dias(r.pago_em, v0.data_venda)) <= janelaCartao && (!v0.unit_id || r.unit_id === v0.unit_id));
    if (!cands.length) {
      await sql`UPDATE card_sales SET status='PENDENTE' WHERE id = ANY(${vs.map(v => v.id)})`;
      if (dias(v0.data_venda, hoje()) > janelaCartao) await emite({ chave: `vst:${v0.id}`, tipo: "VENDA_SEM_TITULO", origem: "CARTAO", unitId: v0.unit_id, valor: bruto, cardSaleId: v0.id, referencia: v0.data_venda,
        descricao: `Venda ${v0.bandeira} ${v0.produto} de ${bruto.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} em ${v0.data_venda.split("-").reverse().join("/")}${v0.nsu ? ` (NSU ${v0.nsu})` : ""} sem título baixado por cartão — registre a baixa no ActiveSoft.` });
      continue;
    }
    const sc = cands.map(r => { const d = Math.abs(dias(r.pago_em, v0.data_venda)); let conf = 50 + (d === 0 ? 30 : d === 1 ? 20 : 10) + (cands.length === 1 ? 10 : -5 * (cands.length - 1)) + (v0.unit_id && r.unit_id === v0.unit_id ? 5 : 0) + (r.forma === "CARTAO" ? 5 : 0); conf = Math.max(1, Math.min(99, conf));
      return { r, conf, motivo: [`valor bruto exato`, d === 0 ? "mesmo dia da venda" : `${d} dia(s) da venda`, cands.length === 1 ? "único candidato" : `${cands.length} candidatos`].join(" · ") }; }).sort((a, b) => b.conf - a.conf);
    const m = sc[0]; const auto = m.conf >= limiar && (!sc[1] || m.conf - sc[1].conf >= 10); const grupo = `${lote}-v${v0.id}`;
    await sql`INSERT INTO recon_matches (tipo, grupo, receivable_id, card_sale_id, valor, confianca, metodo, status, motivo, user_nome, confirmado_em) VALUES ('CARTAO', ${grupo}, ${m.r.id}, ${v0.id}, ${bruto}, ${m.conf}, 'AUTO', ${auto ? "CONFIRMADO" : "SUGERIDO"}, ${m.motivo}, ${quem}, CASE WHEN ${auto}::boolean THEN now() END)`;
    await sql`UPDATE card_sales SET status=${auto ? "CASADA" : "SUGERIDO"} WHERE id = ANY(${vs.map(v => v.id)})`; usadosC.add(m.r.id);
    if (auto) { await sql`UPDATE receivables SET conciliado_em=now() WHERE id=${m.r.id}`; res.vendasCasadas++; }
  }

  // ---------- 4. cartão: repasse da Cielo × crédito no banco ----------
  const repasses = await sql<LinhaDb[]>`SELECT id, bank_account_id, data::text, valor::float, forma, descricao, pagador, status, student_id FROM bank_lines WHERE valor > 0 AND forma='CARTAO' AND data BETWEEN ${de} AND ${addDays(ate, 5)} AND status IN ('PENDENTE','DIVERGENTE','SEM_PAR') ORDER BY data, id`;
  const aCreditar = await sql<VendaDb[]>`SELECT id, unit_id, data_venda::text, data_pagamento::text, bandeira, produto, parcelas, nsu, chave, valor_bruto::float, valor_taxa::float, valor_liquido::float, antecipado, status, repasse FROM card_sales
    WHERE data_pagamento BETWEEN ${addDays(de, -3)} AND ${addDays(ate, 5)} AND repasse <> 'CREDITADA' AND status <> 'IGNORADO'`;
  const creditadas = new Set<number>();
  for (const linha of repasses) {
    const b = bandeiraDe(`${linha.descricao ?? ""} ${linha.pagador ?? ""}`); let melhor: { vs: VendaDb[]; dif: number; dia: string } | null = null;
    for (const k of [0, 1, -1]) { const dia = addDays(linha.data, -k); const vs = aCreditar.filter(v => !creditadas.has(v.id) && v.data_pagamento === dia && (!b || bandeiraDe(v.bandeira) === b)); if (!vs.length) continue;
      const dif = r2(linha.valor - vs.reduce((a, v) => a + v.valor_liquido, 0)); if (!melhor || Math.abs(dif) < Math.abs(melhor.dif)) melhor = { vs, dif, dia }; }
    if (melhor && Math.abs(melhor.dif) <= Math.max(0.005, tolC * melhor.vs.length)) {
      for (const v of melhor.vs) creditadas.add(v.id);
      await sql`UPDATE card_sales SET repasse='CREDITADA' WHERE id = ANY(${melhor.vs.map(v => v.id)})`; await sql`UPDATE bank_lines SET status='CONCILIADO' WHERE id=${linha.id}`;
      await sql`INSERT INTO recon_matches (tipo, grupo, bank_line_id, card_sale_id, valor, confianca, metodo, status, motivo, user_nome, confirmado_em) VALUES ('REPASSE', ${`${lote}-r${linha.id}`}, ${linha.id}, ${melhor.vs[0].id}, ${linha.valor}, ${Math.abs(melhor.dif) < 0.005 ? 98 : 88}, 'AUTO', 'CONFIRMADO', ${`repasse de ${melhor.vs.length} venda(s) ${b ?? ""} previsto para ${melhor.dia.split("-").reverse().join("/")}`.replace("  ", " ")}, ${quem}, now())`;
      res.repassesConciliados++;
      if (Math.abs(melhor.dif) >= 0.005) { const k = `cent:CARTAO|${b ?? "TODAS"}|${linha.data.slice(0, 7)}`; const a = centavos.get(k) ?? { n: 0, soma: 0, unit: unidadeDaConta(linha.bank_account_id), mes: linha.data.slice(0, 7), origem: "CARTAO", rotulo: `repasses ${b ?? "da Cielo"}` }; a.n++; a.soma = r2(a.soma + melhor.dif); centavos.set(k, a); }
    } else if (melhor) {
      await sql`UPDATE bank_lines SET status='DIVERGENTE' WHERE id=${linha.id}`;
      await emite({ chave: `vrp:${linha.id}`, tipo: "VALOR", origem: "CARTAO", unitId: unidadeDaConta(linha.bank_account_id), valor: melhor.dif, bankLineId: linha.id, referencia: linha.data,
        descricao: `Repasse ${b ?? "da Cielo"} de ${linha.data.split("-").reverse().join("/")}: banco creditou ${linha.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}; as ${melhor.vs.length} venda(s) previstas somam ${(linha.valor - melhor.dif).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} líquidos (diferença ${melhor.dif.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}).` });
    } else {
      await sql`UPDATE bank_lines SET status='SEM_PAR' WHERE id=${linha.id}`;
      await emite({ chave: `spr:${linha.id}`, tipo: "SEM_PAR_REPASSE", origem: "CARTAO", unitId: unidadeDaConta(linha.bank_account_id), valor: linha.valor, bankLineId: linha.id, referencia: linha.data,
        descricao: `Crédito de cartão de ${linha.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} em ${linha.data.split("-").reverse().join("/")} sem vendas previstas para a data — importe o relatório da Cielo do período ou confira antecipação.` });
    }
  }
  // venda com pagamento previsto já coberto pelo extrato e sem crédito: repasse em falta (um achado por dia e bandeira)
  const [cob] = await sql<{ d: string | null }[]>`SELECT max(data)::text AS d FROM bank_lines`;
  if (cob?.d) {
    const faltas = new Map<string, VendaDb[]>();
    for (const v of aCreditar) if (!creditadas.has(v.id) && v.data_pagamento && v.data_pagamento <= addDays(cob.d, -2) && v.data_pagamento >= de && v.data_pagamento <= ate) { const k = `${v.data_pagamento}|${bandeiraDe(v.bandeira) ?? v.bandeira}`; faltas.set(k, [...(faltas.get(k) ?? []), v]); }
    for (const [k, vs] of faltas) { const [dia, band] = k.split("|"); const soma = r2(vs.reduce((a, v) => a + v.valor_liquido, 0));
      await emite({ chave: `spv:${k}`, tipo: "SEM_PAR_VENDA", origem: "CARTAO", unitId: vs[0].unit_id, valor: soma, cardSaleId: vs[0].id, referencia: dia,
        descricao: `${vs.length} venda(s) ${band} com repasse previsto para ${dia.split("-").reverse().join("/")} (${soma.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} líquidos) sem crédito no extrato — confira com a operadora.` }); }
  }

  // ---------- 5. taxa praticada × contratada (um achado por bandeira, categoria e mês) ----------
  const tolT = c.toleranciaTaxaPp as number; const taxas = new Map<string, { n: number; excesso: number; contratada: number; bruto: number; taxa: number; unit: number | null; exemplos: string[] }>();
  for (const v of vendas) {
    if (v.antecipado || v.data_venda < de || v.data_venda > ate || !v.valor_bruto) continue;
    const cat = categoriaCartao(v.produto, v.parcelas); const contr = taxaContratada(cfg, v.bandeira, cat); if (contr === null) continue;
    const prat = (100 * v.valor_taxa) / v.valor_bruto; if (prat <= contr + tolT) continue;
    const k = `${bandeiraDe(v.bandeira) ?? v.bandeira}|${cat}|${v.data_venda.slice(0, 7)}`; const a = taxas.get(k) ?? { n: 0, excesso: 0, contratada: contr, bruto: 0, taxa: 0, unit: v.unit_id, exemplos: [] };
    a.n++; a.bruto += v.valor_bruto; a.taxa += v.valor_taxa; a.excesso = r2(a.excesso + v.valor_bruto * (prat - contr) / 100); if (a.exemplos.length < 3 && v.nsu) a.exemplos.push(v.nsu); taxas.set(k, a);
  }
  for (const [k, a] of taxas) { const [band, cat, mes] = k.split("|");
    await emite({ chave: `tax:${k}`, tipo: "TAXA", origem: "CARTAO", unitId: a.unit, valor: a.excesso, referencia: `${mes}-01`,
      descricao: `${band} · ${cat} em ${mes.split("-").reverse().join("/")}: taxa praticada média de ${((100 * a.taxa) / a.bruto).toFixed(2).replace(".", ",")}% contra ${a.contratada.toFixed(2).replace(".", ",")}% contratada em ${a.n} venda(s) — ${a.excesso.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} a contestar${a.exemplos.length ? ` (ex.: NSU ${a.exemplos.join(", ")})` : ""}.` }); }
  for (const [k, a] of centavos) if (a.n >= (c.centavosMinOcorrencias as number)) await emite({ chave: k, tipo: "CENTAVOS", origem: a.origem, unitId: a.unit, valor: a.soma, referencia: `${a.mes}-01`,
    descricao: `Diferenças de centavos em ${a.n} ${a.rotulo} de ${a.mes.split("-").reverse().join("/")} (soma ${a.soma.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}) — padrão sistemático: confira o arredondamento com o banco/operadora.` });

  // ---------- 6. baixa sem crédito: título baixado, extrato do período já importado e nenhum par ----------
  const cobertura = new Map<number, string>(); for (const r of await sql<{ unit_id: number; d: string }[]>`SELECT coalesce(a.unit_id, u.id) AS unit_id, max(l.data)::text AS d FROM bank_lines l JOIN bank_accounts a ON a.id=l.bank_account_id LEFT JOIN units u ON a.unit_id IS NULL AND (a.company_id IS NULL OR u.company_id=a.company_id) GROUP BY 1`) cobertura.set(r.unit_id, r.d);
  const [cobCielo] = await sql<{ d: string | null }[]>`SELECT max(data_venda)::text AS d FROM card_sales`;
  const semCredito = await sql<RecDb[]>`SELECT id, unit_id, aluno_nome, responsavel, student_id, valor::float, coalesce(valor_pago, valor)::float AS valor_pago, pago_em::text, forma_pagamento AS forma FROM receivables
    WHERE status='PAGO' AND conciliado_em IS NULL AND pago_em BETWEEN ${de} AND ${ate} AND forma_pagamento IS NOT NULL AND NOT EXISTS (SELECT 1 FROM recon_matches m WHERE m.receivable_id=receivables.id AND m.status='SUGERIDO')`;
  for (const r of semCredito) {
    const lim = r.forma === "CARTAO" ? cobCielo?.d ?? null : cobertura.get(r.unit_id) ?? null; const jan = r.forma === "CARTAO" ? janelaCartao : janela + (r.forma === "BOLETO" ? 3 : 0);
    if (!lim || addDays(r.pago_em, jan) > lim) continue;
    await emite({ chave: `spb:${r.id}`, tipo: "SEM_PAR_BAIXA", origem: r.forma ?? "OUTROS", unitId: r.unit_id, valor: r.valor_pago, receivableId: r.id, referencia: r.pago_em,
      descricao: `Título de ${r.aluno_nome} baixado como ${FORMA_RECEB_LABEL[(r.forma ?? "OUTROS") as FormaReceb] ?? r.forma} em ${r.pago_em.split("-").reverse().join("/")} (${r.valor_pago.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}) sem ${r.forma === "CARTAO" ? "venda na Cielo" : "crédito no extrato"} — confira a baixa no ActiveSoft.` });
  }

  // ---------- 7. o que deixou de existir resolve sozinho (com trilha) — só o que foi reavaliado neste período ----------
  const abertas = await sql<{ id: number; chave: string }[]>`SELECT id, chave FROM recon_issues WHERE status='ABERTA' AND referencia BETWEEN ${de} AND ${ate} AND tipo <> 'TAXA'`;
  for (const a of abertas) if (!emitidas.has(a.chave)) {
    await sql`UPDATE recon_issues SET status='RESOLVIDA', desfecho='CONCILIADO_AUTO', desfecho_obs=${`Par encontrado na conciliação de ${hoje().split("-").reverse().join("/")}`}, resolvido_em=now(), updated_at=now() WHERE id=${a.id}`; res.resolvidasAuto++;
  }
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM recon_issues WHERE status='ABERTA'`; res.pendenciasAbertas = n;
  return res;
}

// ---------------------------------------------------------------- competência: painel, trava e fechamento
const limites = (periodo: string) => { const [a, m] = periodo.split("-").map(Number); return { ini: `${periodo}-01`, prox: m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01` }; };
export type LinhaForma = { forma: string; recebido: number; conciliado: number; n: number; nConciliados: number };

/** Recebimentos do mês por forma (T-033): previsto × recebido × conciliado, por unidade, com o que foi explicado com alçada. */
export async function painelRecebimentos(periodo: string, unitIds: number[] | null) {
  const { ini, prox } = limites(periodo); const uf = unitIds === null ? sql`` : sql`AND r.unit_id = ANY(${unitIds})`; const ufi = unitIds === null ? sql`` : sql`AND (i.unit_id = ANY(${unitIds}))`;
  const [[prev], porForma, porUnidade, [expl], pend, cobertura, [cielo]] = await Promise.all([
    sql<{ previsto: number; n: number }[]>`SELECT coalesce(sum(r.valor),0)::float AS previsto, count(*)::int AS n FROM receivables r WHERE r.status <> 'CANCELADO' AND r.vencimento >= ${ini} AND r.vencimento < ${prox} ${uf}`,
    sql<LinhaForma[]>`SELECT coalesce(r.forma_pagamento,'SEM') AS forma, sum(coalesce(r.valor_pago, r.valor))::float AS recebido, coalesce(sum(coalesce(r.valor_pago, r.valor)) FILTER (WHERE r.conciliado_em IS NOT NULL),0)::float AS conciliado,
      count(*)::int AS n, count(*) FILTER (WHERE r.conciliado_em IS NOT NULL)::int AS "nConciliados" FROM receivables r WHERE r.status='PAGO' AND r.pago_em >= ${ini} AND r.pago_em < ${prox} ${uf} GROUP BY 1`,
    sql<(LinhaForma & { unit_id: number; unidade: string })[]>`SELECT r.unit_id, u.nome AS unidade, coalesce(r.forma_pagamento,'SEM') AS forma, sum(coalesce(r.valor_pago, r.valor))::float AS recebido, coalesce(sum(coalesce(r.valor_pago, r.valor)) FILTER (WHERE r.conciliado_em IS NOT NULL),0)::float AS conciliado,
      count(*)::int AS n, count(*) FILTER (WHERE r.conciliado_em IS NOT NULL)::int AS "nConciliados" FROM receivables r JOIN units u ON u.id=r.unit_id WHERE r.status='PAGO' AND r.pago_em >= ${ini} AND r.pago_em < ${prox} ${uf} GROUP BY 1, 2, 3 ORDER BY u.nome`,
    sql<{ v: number }[]>`SELECT coalesce(sum(coalesce(r.valor_pago, r.valor)),0)::float AS v FROM receivables r WHERE r.status='PAGO' AND r.conciliado_em IS NULL AND r.pago_em >= ${ini} AND r.pago_em < ${prox} ${uf}
      AND EXISTS (SELECT 1 FROM recon_issues i WHERE i.receivable_id=r.id AND i.status='RESOLVIDA' AND i.desfecho IN ('PERDA_ASSUMIDA','NAO_PROCEDE','LANCAMENTO_CORRIGIDO'))`,
    sql<{ id: number; tipo: string; origem: string; valor: number | null; descricao: string; dono: string | null; prazo: string | null; idade: number; escalonamento: number }[]>`SELECT i.id, i.tipo, i.origem, i.valor::float, i.descricao, u.nome AS dono, i.prazo::text, (current_date - i.created_at::date)::int AS idade, i.escalonamento
      FROM recon_issues i LEFT JOIN users u ON u.id=i.dono_user_id WHERE i.status='ABERTA' AND i.referencia >= ${ini} AND i.referencia < ${prox} ${ufi} ORDER BY i.escalonamento DESC, i.created_at`,
    sql<{ unit_id: number; ate: string | null }[]>`SELECT un.id AS unit_id, (SELECT max(l.data) FROM bank_lines l JOIN bank_accounts a ON a.id=l.bank_account_id WHERE a.unit_id=un.id OR (a.unit_id IS NULL AND (a.company_id IS NULL OR a.company_id=un.company_id)))::text AS ate FROM units un ${unitIds === null ? sql`` : sql`WHERE un.id = ANY(${unitIds})`}`,
    sql<{ ate: string | null }[]>`SELECT max(data_venda)::text AS ate FROM card_sales`,
  ]);
  const tot = porForma.reduce((a, f) => ({ recebido: a.recebido + f.recebido, conciliado: a.conciliado + f.conciliado, n: a.n + f.n }), { recebido: 0, conciliado: 0, n: 0 });
  return { previsto: prev.previsto, nPrevisto: prev.n, porForma, porUnidade, recebido: tot.recebido, conciliado: tot.conciliado, explicado: expl.v, nRecebidos: tot.n, pendencias: pend, cobertura, coberturaCielo: cielo?.ate ?? null,
    pct: tot.recebido ? (100 * tot.conciliado) / tot.recebido : null, pctComExplicado: tot.recebido ? (100 * (tot.conciliado + expl.v)) / tot.recebido : null };
}

export type Fechamento = { id: number; competencia: string; company_id: number | null; status: string; pct: number | null; fechado_em: string; por: string | null; motivo_reabertura: string | null };
export async function fechamentoDe(competencia: string, companyId: number | null): Promise<Fechamento | null> {
  const [f] = await sql<Fechamento[]>`SELECT f.id, f.competencia, f.company_id, f.status, f.pct::float, f.fechado_em::text, u.nome AS por, f.motivo_reabertura FROM recon_closings f LEFT JOIN users u ON u.id=f.fechado_por
    WHERE f.competencia=${competencia} AND f.company_id IS NOT DISTINCT FROM ${companyId} ORDER BY f.id DESC LIMIT 1`;
  return f ?? null;
}
/** Trava mensal (CRQ-FIN-V3-04): a data cai numa competência fechada — no consolidado ou na entidade da unidade? */
export async function competenciaFechada(dataIso: string, unitId: number | null): Promise<{ competencia: string; fechado_em: string; por: string | null } | null> {
  const comp = dataIso.slice(0, 7);
  const [f] = await sql<{ competencia: string; fechado_em: string; por: string | null }[]>`SELECT f.competencia, f.fechado_em::text, u.nome AS por FROM recon_closings f LEFT JOIN users u ON u.id=f.fechado_por
    WHERE f.competencia=${comp} AND f.status='FECHADA' AND (f.company_id IS NULL OR f.company_id = (SELECT company_id FROM units WHERE id=${unitId})) ORDER BY f.id DESC LIMIT 1`;
  return f ?? null;
}
export const mensagemTrava = (f: { competencia: string; fechado_em: string; por: string | null }) => `Competência ${f.competencia.split("-").reverse().join("/")} fechada em ${f.fechado_em.slice(0, 10).split("-").reverse().join("/")}${f.por ? ` por ${f.por}` : ""}: para alterar, a Direção reabre com justificativa.`;

/** Fechar a competência exige conciliado (+ explicado com alçada) ÷ recebido ≥ meta (KPI-09). */
export async function gateFechamento(competencia: string, companyId: number | null) {
  const cfg = await getSettings(); const meta = cfg.conciliacao.metaConciliadoPct as number;
  const unitIds = companyId === null ? null : (await sql<{ id: number }[]>`SELECT id FROM units WHERE company_id=${companyId}`).map(u => u.id);
  const p = await painelRecebimentos(competencia, unitIds);
  const pct = p.pctComExplicado; const ok = pct !== null && pct >= meta - 1e-9;
  return { ...p, meta, ok, pctGate: pct };
}

// ---------------------------------------------------------------- rotina diária: reconcilia o mês e escala o que envelheceu
export async function rotinaConciliacao(h: string) {
  const cfg = await getSettings(); const [d15, d30] = cfg.conciliacao.escalonamentoDias as number[];
  const [a, m] = h.split("-").map(Number); const de = m === 1 ? `${a - 1}-12-01` : `${a}-${String(m - 1).padStart(2, "0")}-01`;
  let proc: ResumoConciliacao | null = null; const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM bank_lines`;
  if (n > 0) proc = await processarConciliacao(de, h, null);
  const a30 = await sql<{ id: number }[]>`UPDATE recon_issues SET escalonamento=2, updated_at=now() WHERE status='ABERTA' AND escalonamento < 2 AND created_at::date <= ${h}::date - ${d30}::int RETURNING id`;
  const a15 = await sql<{ id: number; dono_user_id: number | null }[]>`UPDATE recon_issues SET escalonamento=1, updated_at=now() WHERE status='ABERTA' AND escalonamento < 1 AND created_at::date <= ${h}::date - ${d15}::int RETURNING id, dono_user_id`;
  if (a15.length) { const fin = await usuariosPorPerfil(["FINANCEIRO"]); const donos = a15.map(x => x.dono_user_id).filter((x): x is number => !!x);
    await notificar([...new Set([...fin, ...donos])], `${a15.length} divergência(s) da conciliação passaram de ${d15} dias`, "Escalonadas ao gestor financeiro (CRQ-COB-V3-02). Resolva com desfecho e evidência.", "/financeiro/divergencias?idade=15", "ALERTA", `div15:${h}`); }
  if (a30.length) await notificar(await usuariosPorPerfil(["DIRECAO"]), `${a30.length} divergência(s) da conciliação passaram de ${d30} dias`, "Escalonadas à Direção (CRQ-COB-V3-02).", "/financeiro/divergencias?idade=30", "ALERTA", `div30:${h}`);
  return { processado: proc, escaladas15: a15.length, escaladas30: a30.length };
}

/** Período a reconciliar depois de uma importação: os meses inteiros tocados pelo arquivo (baixas do começo do mês ganham cobertura), até hoje. */
export function mesesInteiros(datas: string[]): [string, string] {
  const ord = [...datas].sort(); const ini = `${ord[0].slice(0, 7)}-01`; const [a, m] = ord[ord.length - 1].slice(0, 7).split("-").map(Number);
  const fim = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10); const h = hoje(); return [ini, fim > h ? h : fim];
}
