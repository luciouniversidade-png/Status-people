import * as XLSX from "xlsx";

export type DiaLido = { data: string; esperado: number; trabalhado: number; status: string; obs: string | null; diff: number };
export type ArquivoLido = { arquivo: string; nomePlanilha: string; abas: string[]; dias: DiaLido[]; saldoCalculado: number; saldoPlanilha: number | null; avisos: string[]; colunas: Record<string, number> };

const MESES = ["JANEIRO", "FEVEREIRO", "MARCO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];
const norm = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
const num = (v: unknown): number | null => { if (v === null || v === undefined || v === "") return null; if (typeof v === "number") return Number.isFinite(v) ? v : null; const t = String(v).replace(/\s/g, "").replace("−", "-"); const m = t.match(/^(-?)(\d+):(\d{1,2})$/); if (m) return (m[1] ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])); const n = Number(t.replace(",", ".")); return Number.isFinite(n) ? n : null; };

/** Rótulos usados nas planilhas → situação do sistema. */
export function statusDeRotulo(obs: string | null | undefined): string {
  const o = norm(obs);
  if (!o) return "NORMAL";
  if (/FERIAS|FERIADO|DSR|RECESSO|NAO LETIVO|N\.? ?LETIVO|CARNAVAL/.test(o)) return /FERIAS/.test(o) ? "FERIAS" : /RECESSO/.test(o) ? "RECESSO" : /DSR/.test(o) ? "DSR" : /LETIVO|CARNAVAL/.test(o) ? "NAO_LETIVO" : "FERIADO";
  if (/ATEST|INSS|L\.? ?MAT|LICEN|AFAST/.test(o)) return /ATEST/.test(o) ? "ATESTADO" : "AFASTADO";
  if (/BC_?FOLG|FOLGA|COMPENS/.test(o)) return "FOLGA_BANCO";
  if (/DISP|FACULT/.test(o)) return "DISPENSA";
  if (/FALT/.test(o)) return "FALTA";
  return "NORMAL";
}

function excelDate(v: unknown, ano: number, mesIdx: number): string | null {
  if (typeof v === "number" && v > 20000 && v < 80000) { const d = XLSX.SSF.parse_date_code(v); return d ? `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}` : null; }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const t = String(v ?? "").trim();
  let m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/); if (m) { const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : ano; return `${y}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`; }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
  m = t.match(/^(\d{1,2})$/); if (m && mesIdx >= 0) return `${ano}-${String(mesIdx + 1).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
  return null;
}

/** Lê uma planilha de banco de horas (abas mensais) e devolve os dias interpretados — nada é gravado aqui. */
export function lerPlanilhaPonto(buf: Buffer, arquivo: string, ano: number): ArquivoLido {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
  const avisos: string[] = []; const dias: DiaLido[] = []; const abas: string[] = []; let colunas: Record<string, number> = {};
  const nomePlanilha = arquivo.replace(/\.xlsx?$/i, "").replace(/[_-]?REVISADO.*$/i, "").replace(/[_-]?20\d\d.*$/i, "").replace(/_/g, " ").trim();
  for (const nome of wb.SheetNames) {
    const mesIdx = MESES.findIndex(m => norm(nome).startsWith(m)); if (mesIdx < 0) continue;
    const ws = wb.Sheets[nome]; const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    // cabeçalho: linha que contém "CH" e alguma coluna de dia/data ou trabalhados
    let h = -1; for (let i = 0; i < Math.min(rows.length, 15); i++) { const cells = (rows[i] ?? []).map(norm); if (cells.some(c => c === "CH" || c.startsWith("CH ") || c === "CARGA") && cells.some(c => /DIA|DATA|TRAB/.test(c))) { h = i; break; } }
    if (h < 0) { avisos.push(`${nome}: cabeçalho não reconhecido (esperava DATA/DIA, CH, TRABALHADOS…) — aba ignorada.`); continue; }
    const head = (rows[h] ?? []).map(norm);
    const col = (re: RegExp) => head.findIndex(c => re.test(c));
    const cData = col(/^(DATA|DIA)$|^DIA /), cCH = col(/^CH$|^CH |CARGA/), cTrab = col(/TRAB/), cPos = col(/POSIT|EXTRA|CREDIT/), cNeg = col(/NEGAT|ATRAS|DEBIT/), cObs = col(/OBS|OCORR|SITUA|ROTUL/);
    colunas = { data: cData, ch: cCH, trab: cTrab, pos: cPos, neg: cNeg, obs: cObs };
    if (cData < 0 || cCH < 0) { avisos.push(`${nome}: faltam colunas de data ou CH — aba ignorada.`); continue; }
    abas.push(nome.trim()); let lidos = 0;
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i] ?? []; const data = excelDate(r[cData], ano, mesIdx); if (!data) continue;
      if (Number(data.slice(5, 7)) !== mesIdx + 1) continue;
      const ch = num(r[cCH]) ?? 0; const obs = cObs >= 0 && r[cObs] !== null ? String(r[cObs]).trim() : null;
      const status = statusDeRotulo(obs);
      const trabRaw = cTrab >= 0 ? num(r[cTrab]) : null; const pos = cPos >= 0 ? num(r[cPos]) ?? 0 : 0; const negRaw = cNeg >= 0 ? num(r[cNeg]) ?? 0 : 0;
      let esperado = Math.round(ch); let trabalhado = trabRaw === null ? (status === "NORMAL" ? esperado : 0) : Math.round(trabRaw);
      // avulsos (positivo/negativo digitados): só entram quando não são a diferença trabalhado−CH já contida
      const base = trabalhado - esperado; const neg = -Math.abs(negRaw); const avulso = Math.round(pos) + Math.round(neg);
      let diff: number;
      if (["FERIAS", "FERIADO", "DSR", "NAO_LETIVO", "DISPENSA", "ATESTADO", "AFASTADO"].includes(status)) { esperado = status === "ATESTADO" || status === "AFASTADO" ? esperado : 0; trabalhado = 0; diff = 0; }
      else if (status === "FOLGA_BANCO") { trabalhado = 0; diff = -esperado; }
      else if (status === "RECESSO") { diff = trabalhado - esperado + (avulso === base ? 0 : avulso); }
      else { diff = base + (avulso === base ? 0 : avulso); if (avulso !== 0 && avulso !== base) { trabalhado = esperado + diff; } }
      dias.push({ data, esperado, trabalhado, status, obs, diff }); lidos++;
    }
    if (lidos === 0) avisos.push(`${nome}: nenhuma linha com data reconhecida.`);
  }
  // saldo final informado pela própria planilha (aba GERAL, última linha com SALDO)
  let saldoPlanilha: number | null = null;
  const geral = wb.SheetNames.find(n => norm(n).startsWith("GERAL"));
  if (geral) {
    const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[geral], { header: 1, raw: true, defval: null });
    let h = -1, cS = -1; for (let i = 0; i < Math.min(rows.length, 15); i++) { const cells = (rows[i] ?? []).map(norm); const j = cells.findIndex(c => /SALDO/.test(c)); if (j >= 0) { h = i; cS = j; break; } }
    if (h >= 0) { for (let i = rows.length - 1; i > h; i--) { const v = num((rows[i] ?? [])[cS]); if (v !== null) { saldoPlanilha = Math.round(v); break; } } }
  }
  const saldoCalculado = dias.reduce((a, d) => a + d.diff, 0);
  if (dias.length === 0) avisos.push("Nenhum dia lido: verifique se as abas têm os nomes dos meses (JANEIRO…DEZEMBRO).");
  if (saldoPlanilha !== null && saldoPlanilha !== saldoCalculado) avisos.push(`Saldo da planilha (${saldoPlanilha} min) difere do calculado (${saldoCalculado} min): confira antes de aplicar.`);
  return { arquivo, nomePlanilha, abas, dias, saldoCalculado, saldoPlanilha, avisos, colunas };
}
