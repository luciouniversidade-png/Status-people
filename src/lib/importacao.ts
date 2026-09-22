import * as XLSX from "xlsx";

/** Converte um arquivo enviado (xlsx/xls/xlsm/csv/txt) ou o texto colado em texto tabular (TAB como separador para planilhas). */
export async function textoImportacao(fd: FormData, campoTexto = "csv", campoArquivo = "arquivo"): Promise<string> {
  const arq = fd.get(campoArquivo);
  if (arq && typeof arq === "object" && "arrayBuffer" in arq && (arq as File).size > 0) {
    const f = arq as File; const buf = Buffer.from(await f.arrayBuffer()); const nome = (f.name || "").toLowerCase();
    if (/\.(xlsx|xlsm|xls|ods)$/.test(nome) || buf.subarray(0, 2).toString("hex") === "504b" || buf.subarray(0, 4).toString("hex") === "d0cf11e0") return planilhaParaTexto(buf);
    return decodificar(buf);
  }
  const t = fd.get(campoTexto); return typeof t === "string" ? t.trim() : "";
}

function decodificar(buf: Buffer) {
  let s = buf.toString("utf8");
  if (s.includes("\uFFFD")) { try { s = new TextDecoder("windows-1252").decode(buf); } catch { /* mantém utf8 */ } }
  return s.replace(/^\uFEFF/, "").trim();
}

/** Primeira aba da planilha → linhas separadas por TAB; datas viram DD/MM/AAAA; números mantêm o valor. */
export function planilhaParaTexto(buf: Buffer): string {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false, cellNF: true });
  const ws = wb.Sheets[wb.SheetNames[0]]; if (!ws || !ws["!ref"]) return "";
  const range = XLSX.utils.decode_range(ws["!ref"]); const linhas: string[] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cels: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (!cell || cell.v === undefined || cell.v === null) { cels.push(""); continue; }
      if (cell.t === "d" && cell.v instanceof Date) { const d = cell.v; cels.push(`${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`); continue; }
      if (cell.t === "n" && cell.z && XLSX.SSF.is_date(String(cell.z))) { const p = XLSX.SSF.parse_date_code(cell.v as number); if (p) { cels.push(`${String(p.d).padStart(2, "0")}/${String(p.m).padStart(2, "0")}/${p.y}`); continue; } }
      if (cell.t === "n") { const v = cell.v as number; cels.push(Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100).replace(".", ",")); continue; }
      cels.push(String(cell.w ?? cell.v).replace(/[\t\r\n]+/g, " ").trim());
    }
    if (cels.some(x => x !== "")) linhas.push(cels.join("\t"));
  }
  return linhas.join("\n");
}
