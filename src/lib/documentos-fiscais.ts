/**
 * v27 · Leitura de documentos de cobrança e fiscais (funções puras — rodam no navegador e no servidor).
 * - Boleto bancário: linha digitável (47 dígitos) ou código de barras (44). Confere os 3 DVs dos campos (módulo 10) e o DV geral
 *   (módulo 11), devolve banco, valor e vencimento (fator de vencimento, inclusive o novo ciclo iniciado em 22/02/2025).
 * - Arrecadação/concessionária (água, luz, telefone, tributos): 48 dígitos (ou 44 do código de barras) começando com 8; DVs em
 *   módulo 10 ou 11 conforme o identificador de valor; valor quando o identificador indica valor efetivo.
 * - Chave de acesso de NF-e/NFC-e/CT-e (44 posições): confere o DV (módulo 11) e devolve UF, ano/mês, CNPJ do emitente (aceita
 *   CNPJ alfanumérico), modelo, série e número.
 * Só aritmética dos dígitos: não consulta banco nem SEFAZ — garante que o código foi digitado/colado certo e evita pagar duas vezes.
 */
const so = (s: string) => s.replace(/[^0-9]/g, "");
export function mod10(num: string): number {
  let soma = 0, peso = 2;
  for (let i = num.length - 1; i >= 0; i--) { let p = Number(num[i]) * peso; if (p > 9) p = Math.floor(p / 10) + (p % 10); soma += p; peso = peso === 2 ? 1 : 2; }
  const r = soma % 10; return r === 0 ? 0 : 10 - r;
}
function somaPesos(num: string, valor: (c: string) => number = c => Number(c)) { let soma = 0, peso = 2; for (let i = num.length - 1; i >= 0; i--) { soma += valor(num[i]) * peso; peso = peso === 9 ? 2 : peso + 1; } return soma; }
/** DV geral do boleto bancário: 0, 10 e 11 viram 1. */
export function mod11Banco(num: string): number { const dv = 11 - (somaPesos(num) % 11); return dv === 0 || dv === 10 || dv === 11 ? 1 : dv; }
/** Módulo 11 da arrecadação: resto 0 ou 1 → 0. */
export function mod11Arrecadacao(num: string): number { const r = somaPesos(num) % 11; return r === 0 || r === 1 ? 0 : 11 - r; }

export const BANCOS: Record<string, string> = {
  "001": "Banco do Brasil", "004": "Banco do Nordeste", "021": "Banestes", "033": "Santander", "037": "Banpará", "041": "Banrisul", "047": "Banese", "070": "BRB", "077": "Inter", "085": "Ailos", "097": "Credisis",
  "104": "Caixa", "133": "Cresol", "136": "Unicred", "208": "BTG Pactual", "212": "Original", "237": "Bradesco", "260": "Nubank", "290": "PagBank", "323": "Mercado Pago", "336": "C6 Bank", "341": "Itaú", "380": "PicPay",
  "389": "Mercantil do Brasil", "422": "Safra", "633": "Rendimento", "655": "Votorantim", "707": "Daycoval", "745": "Citibank", "746": "Modal", "748": "Sicredi", "756": "Sicoob",
};
const SEGMENTO: Record<string, string> = { "1": "Prefeitura", "2": "Saneamento", "3": "Energia elétrica e gás", "4": "Telecomunicações", "5": "Órgão governamental", "6": "Carnê/assemelhado", "7": "Multa de trânsito", "9": "Uso do banco" };

const addDiasIso = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diffDias = (a: string, b: string) => Math.round((Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / 86400000);
/**
 * Fator de vencimento → data. Ciclo 1: 1000 = 03/07/2000 … 9999 = 21/02/2025. Ciclo 2 (FEBRABAN): 1000 = 22/02/2025.
 * Entre as datas possíveis, fica a mais próxima da data de referência (hoje). Fator 0000 = boleto sem vencimento.
 */
export function vencimentoDoFator(fator: number, referencia: string): string | null {
  if (!fator) return null;
  const c1 = addDiasIso("1997-10-07", fator); const c2 = fator >= 1000 ? addDiasIso("2025-02-22", fator - 1000) : null;
  if (!c2) return c1; return Math.abs(diffDias(c2, referencia)) <= Math.abs(diffDias(c1, referencia)) ? c2 : c1;
}

export type Boleto = { ok: true; tipo: "BANCARIO" | "ARRECADACAO"; codigoBarras: string; linha: string; linhaFormatada: string; banco: string | null; bancoNome: string | null; segmento: string | null; valor: number | null; vencimento: string | null };
export type Falha = { ok: false; erro: string };

function formatarLinhaBancaria(l: string) { return `${l.slice(0, 5)}.${l.slice(5, 10)} ${l.slice(10, 15)}.${l.slice(15, 21)} ${l.slice(21, 26)}.${l.slice(26, 32)} ${l[32]} ${l.slice(33)}`; }
function formatarLinhaArrecadacao(l: string) { return [0, 1, 2, 3].map(i => `${l.slice(i * 12, i * 12 + 11)}-${l[i * 12 + 11]}`).join(" "); }

function bancarioDoCodigo(cb: string, referencia: string): Boleto | Falha {
  if (cb.length !== 44) return { ok: false, erro: "Código de barras deve ter 44 dígitos." };
  if (mod11Banco(cb.slice(0, 4) + cb.slice(5)) !== Number(cb[4])) return { ok: false, erro: "Dígito verificador geral não confere — confira o código." };
  const c1 = cb.slice(0, 4) + cb.slice(19, 24), c2 = cb.slice(24, 34), c3 = cb.slice(34, 44);
  const linha = `${c1}${mod10(c1)}${c2}${mod10(c2)}${c3}${mod10(c3)}${cb[4]}${cb.slice(5, 19)}`;
  const fator = Number(cb.slice(5, 9)); const valor = Number(cb.slice(9, 19)) / 100; const banco = cb.slice(0, 3);
  return { ok: true, tipo: "BANCARIO", codigoBarras: cb, linha, linhaFormatada: formatarLinhaBancaria(linha), banco, bancoNome: BANCOS[banco] ?? null, segmento: null, valor: valor > 0 ? valor : null, vencimento: vencimentoDoFator(fator, referencia) };
}
function arrecadacaoDoCodigo(cb: string): Boleto | Falha {
  if (cb.length !== 44 || cb[0] !== "8") return { ok: false, erro: "Código de arrecadação deve ter 44 dígitos e começar com 8." };
  const id = cb[2]; if (!"6789".includes(id)) return { ok: false, erro: "Identificador de valor inválido na arrecadação." };
  const modulo = id === "6" || id === "7" ? mod10 : mod11Arrecadacao;
  if (modulo(cb.slice(0, 3) + cb.slice(4)) !== Number(cb[3])) return { ok: false, erro: "Dígito verificador geral não confere — confira o código." };
  const blocos = [0, 1, 2, 3].map(i => cb.slice(i * 11, i * 11 + 11)); const linha = blocos.map(b => `${b}${modulo(b)}`).join("");
  const valor = id === "6" || id === "8" ? Number(cb.slice(4, 15)) / 100 : null;
  return { ok: true, tipo: "ARRECADACAO", codigoBarras: cb, linha, linhaFormatada: formatarLinhaArrecadacao(linha), banco: null, bancoNome: null, segmento: SEGMENTO[cb[1]] ?? null, valor: valor && valor > 0 ? valor : null, vencimento: null };
}

/** Lê linha digitável (47 ou 48 dígitos) ou código de barras (44). `referencia` = hoje (AAAA-MM-DD), para escolher o ciclo do fator. */
export function lerBoleto(entrada: string, referencia: string): Boleto | Falha {
  const d = so(entrada ?? "");
  if (!d) return { ok: false, erro: "Cole a linha digitável do boleto." };
  if (d.length === 47) {
    if (mod10(d.slice(0, 9)) !== Number(d[9])) return { ok: false, erro: "1º campo da linha digitável não confere (dígito verificador)." };
    if (mod10(d.slice(10, 20)) !== Number(d[20])) return { ok: false, erro: "2º campo da linha digitável não confere (dígito verificador)." };
    if (mod10(d.slice(21, 31)) !== Number(d[31])) return { ok: false, erro: "3º campo da linha digitável não confere (dígito verificador)." };
    const cb = d.slice(0, 4) + d[32] + d.slice(33, 47) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31);
    return bancarioDoCodigo(cb, referencia);
  }
  if (d.length === 48) {
    if (d[0] !== "8") return { ok: false, erro: "Linha de 48 dígitos é de arrecadação e começa com 8." };
    const id = d[2]; if (!"6789".includes(id)) return { ok: false, erro: "Identificador de valor inválido na arrecadação." };
    const modulo = id === "6" || id === "7" ? mod10 : mod11Arrecadacao;
    for (let i = 0; i < 4; i++) { const b = d.slice(i * 12, i * 12 + 11); if (modulo(b) !== Number(d[i * 12 + 11])) return { ok: false, erro: `${i + 1}º bloco da linha não confere (dígito verificador).` }; }
    return arrecadacaoDoCodigo([0, 1, 2, 3].map(i => d.slice(i * 12, i * 12 + 11)).join(""));
  }
  if (d.length === 44) return d[0] === "8" ? arrecadacaoDoCodigo(d) : bancarioDoCodigo(d, referencia);
  return { ok: false, erro: `A linha digitável tem 47 dígitos (boleto) ou 48 (conta de consumo/tributo); vieram ${d.length}.` };
}

export type ChaveNFe = { ok: true; chave: string; chaveFormatada: string; uf: string; anoMes: string; cnpj: string; cnpjFormatado: string; modelo: string; modeloNome: string; serie: number; numero: number };
const UF: Record<string, string> = { "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO", "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL", "28": "SE", "29": "BA", "31": "MG", "32": "ES", "33": "RJ", "35": "SP", "41": "PR", "42": "SC", "43": "RS", "50": "MS", "51": "MT", "52": "GO", "53": "DF" };
const MODELO: Record<string, string> = { "55": "NF-e", "65": "NFC-e", "57": "CT-e", "67": "CT-e OS", "58": "MDF-e", "59": "CF-e SAT" };
/** Valor do caractere no cálculo do DV (regra do CNPJ alfanumérico: código ASCII − 48; para dígitos, o próprio dígito). */
const valorChar = (c: string) => c.charCodeAt(0) - 48;
/** Chave de acesso (44 posições): DV em módulo 11 sobre as 43 primeiras; resto 0 ou 1 → DV 0. */
export function lerChaveNFe(entrada: string): ChaveNFe | Falha {
  const k = (entrada ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (!k) return { ok: false, erro: "Cole a chave de acesso." };
  if (k.length !== 44) return { ok: false, erro: `A chave de acesso tem 44 posições; vieram ${k.length}.` };
  if (!/^\d{6}[0-9A-Z]{12}\d{2}\d{24}$/.test(k)) return { ok: false, erro: "Chave com caracteres inválidos (só o CNPJ pode ter letras)." };
  const r = somaPesos(k.slice(0, 43), valorChar) % 11; const dv = r === 0 || r === 1 ? 0 : 11 - r;
  if (dv !== Number(k[43])) return { ok: false, erro: "Dígito verificador da chave não confere — confira a chave." };
  const uf = UF[k.slice(0, 2)]; if (!uf) return { ok: false, erro: "Código de UF inválido na chave." };
  const mes = Number(k.slice(4, 6)); if (mes < 1 || mes > 12) return { ok: false, erro: "Mês de emissão inválido na chave." };
  const cnpj = k.slice(6, 20); const modelo = k.slice(20, 22);
  return { ok: true, chave: k, chaveFormatada: k.replace(/(.{4})/g, "$1 ").trim(), uf, anoMes: `20${k.slice(2, 4)}-${k.slice(4, 6)}`, cnpj, cnpjFormatado: `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`, modelo, modeloNome: MODELO[modelo] ?? `modelo ${modelo}`, serie: Number(k.slice(22, 25)), numero: Number(k.slice(25, 34)) };
}
/** Para testes e demonstração: monta uma chave válida a partir das 43 primeiras posições. */
export function completarChave(k43: string) { const r = somaPesos(k43, valorChar) % 11; return k43 + String(r === 0 || r === 1 ? 0 : 11 - r); }
/** Para testes e demonstração: monta a linha digitável de um boleto bancário (banco, fator, valor em centavos, campo livre de 25 dígitos). */
export function montarBoleto(banco: string, fator: number, centavos: number, campoLivre: string) {
  const sem = `${banco}9${String(fator).padStart(4, "0")}${String(centavos).padStart(10, "0")}${campoLivre}`; const dv = mod11Banco(sem);
  const cb = sem.slice(0, 4) + dv + sem.slice(4); const r = bancarioDoCodigo(cb, "2026-10-27"); return r.ok ? r.linha : "";
}
/** Fator de vencimento (ciclo atual) de uma data — para testes e demonstração. */
export const fatorDe = (iso: string) => 1000 + diffDias(iso, "2025-02-22");
