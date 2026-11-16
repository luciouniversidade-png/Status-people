/**
 * v34 · PDFs gerados pelo ONE (espelho do ponto para conferência, termo de entrega de EPI, comprovante de assinaturas) e
 * leitura de PDFs recebidos (texto por página para dividir a folha por pessoa). Só bibliotecas em JavaScript puro (pdf-lib e
 * unpdf): nada a instalar na hospedagem.
 */
import { createHash } from "crypto";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export const sha256 = (b: Uint8Array | Buffer) => createHash("sha256").update(b).digest("hex");

// As fontes-padrão do PDF (Helvetica) usam a codificação WinAnsi: acentos do português passam; símbolos fora dela viram um equivalente.
const WINANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".split(""));
const TROCA: Record<string, string> = { "→": "->", "←": "<-", "≥": ">=", "≤": "<=", "✓": "OK", "✔": "OK", "✕": "x", "✗": "x", "×": "x", "−": "-", " ": " ", " ": " ", " ": " ", "…": "..." };
export function winAnsi(t: string): string {
  let out = "";
  for (const ch of t.normalize("NFC")) {
    if (TROCA[ch] !== undefined) { out += TROCA[ch]; continue; }
    const c = ch.codePointAt(0)!;
    if (ch === "\n" || ch === "\t") { out += " "; continue; }
    if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.has(ch)) out += ch; else out += "?";
  }
  return out;
}

/** Escritor simples de PDF A4: margens, quebra de linha pela largura, quebra de página e tabela de colunas fixas. */
export class Escritor {
  doc!: PDFDocument; font!: PDFFont; bold!: PDFFont; page!: PDFPage; y = 0; readonly W = 595.28; readonly H = 841.89; readonly M = 40;
  rodape = "";
  static async criar(rodape = "") { const e = new Escritor(); e.doc = await PDFDocument.create(); e.font = await e.doc.embedFont(StandardFonts.Helvetica); e.bold = await e.doc.embedFont(StandardFonts.HelveticaBold); e.rodape = rodape; e.novaPagina(); return e; }
  static async sobre(doc: PDFDocument, rodape = "") { const e = new Escritor(); e.doc = doc; e.font = await doc.embedFont(StandardFonts.Helvetica); e.bold = await doc.embedFont(StandardFonts.HelveticaBold); e.rodape = rodape; e.novaPagina(); return e; }
  novaPagina() { this.page = this.doc.addPage([this.W, this.H]); this.y = this.H - this.M; if (this.rodape) this.page.drawText(winAnsi(this.rodape), { x: this.M, y: 22, size: 7, font: this.font, color: rgb(0.45, 0.45, 0.5) }); }
  garantir(h: number) { if (this.y - h < this.M + 14) this.novaPagina(); }
  linhas(texto: string, size: number, largura: number, f: PDFFont = this.font): string[] {
    const out: string[] = [];
    for (const par of winAnsi(texto).split(/\r?\n/)) {
      let atual = "";
      for (const w of par.split(/\s+/).filter(Boolean)) {
        const t = atual ? `${atual} ${w}` : w;
        if (f.widthOfTextAtSize(t, size) <= largura) { atual = t; continue; }
        if (atual) out.push(atual);
        // palavra maior que a linha (hash, endereço): corta em pedaços
        let resto = w; while (f.widthOfTextAtSize(resto, size) > largura) { let k = resto.length; while (k > 1 && f.widthOfTextAtSize(resto.slice(0, k), size) > largura) k--; out.push(resto.slice(0, k)); resto = resto.slice(k); }
        atual = resto;
      }
      out.push(atual);
    }
    return out;
  }
  texto(t: string, o: { size?: number; bold?: boolean; cor?: [number, number, number]; antes?: number; depois?: number; x?: number; largura?: number } = {}) {
    const size = o.size ?? 9.5; const f = o.bold ? this.bold : this.font; const x = o.x ?? this.M; const larg = o.largura ?? this.W - x - this.M; const lh = size * 1.32;
    this.y -= o.antes ?? 0;
    for (const l of this.linhas(t, size, larg, f)) { this.garantir(lh); this.page.drawText(l, { x, y: this.y - size, size, font: f, color: rgb(...(o.cor ?? [0.08, 0.12, 0.22])) }); this.y -= lh; }
    this.y -= o.depois ?? 2;
  }
  regua(espaco = 6) { this.garantir(espaco * 2); this.y -= espaco; this.page.drawLine({ start: { x: this.M, y: this.y }, end: { x: this.W - this.M, y: this.y }, thickness: 0.6, color: rgb(0.8, 0.82, 0.86) }); this.y -= espaco; }
  /** Tabela: larguras em pontos; a primeira linha é o cabeçalho (negrito, fundo cinza). */
  tabela(larguras: number[], linhas: string[][], size = 8) {
    const lh = size * 1.3; const pad = 3;
    linhas.forEach((ln, i) => {
      const cel = ln.map((c, j) => this.linhas(c ?? "", size, larguras[j] - pad * 2, i === 0 ? this.bold : this.font));
      const alt = Math.max(...cel.map(c => c.length)) * lh + pad * 2;
      this.garantir(alt);
      if (i === 0) this.page.drawRectangle({ x: this.M, y: this.y - alt, width: larguras.reduce((a, b) => a + b, 0), height: alt, color: rgb(0.93, 0.94, 0.96) });
      let x = this.M;
      cel.forEach((ls, j) => { ls.forEach((l, k) => this.page.drawText(l, { x: x + pad, y: this.y - pad - size - k * lh + 1, size, font: i === 0 ? this.bold : this.font, color: rgb(0.08, 0.12, 0.22) })); x += larguras[j]; });
      this.y -= alt; this.page.drawLine({ start: { x: this.M, y: this.y }, end: { x: this.M + larguras.reduce((a, b) => a + b, 0), y: this.y }, thickness: 0.4, color: rgb(0.85, 0.86, 0.9) });
    });
    this.y -= 4;
  }
  async salvar() { return await this.doc.save(); }
}

/** Abre um PDF recebido; falha clara para arquivo protegido por senha ou corrompido. */
export async function abrirPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try { return await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); throw new Error(/encrypt/i.test(m) ? "O PDF está protegido por senha: gere o arquivo sem senha e envie de novo." : "Não foi possível ler o PDF (arquivo corrompido ou não é PDF)."); }
}

/** Texto de cada página (para achar o dono de cada holerite ou informe). */
export async function textoPorPagina(bytes: Uint8Array): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).map(t => String(t ?? ""));
}

/** Um PDF novo só com as páginas pedidas (base 1, na ordem dada). */
export async function extrairPaginas(origem: PDFDocument, paginas: number[]): Promise<Uint8Array> {
  const novo = await PDFDocument.create();
  const copias = await novo.copyPages(origem, paginas.map(p => p - 1));
  for (const c of copias) novo.addPage(c);
  return await novo.save();
}
