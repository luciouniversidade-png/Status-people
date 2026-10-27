/**
 * v27 · Geração de parcelas de contas a pagar (funções puras — rodam no navegador e no servidor).
 * - Mensal/bimestral/trimestral/semestral/anual ancorados no dia do 1º vencimento: 30/01 → 28 ou 29/02 → 30/03 (não “gruda” no 29).
 * - Semanal, quinzenal ou a cada N dias.
 * - Ajuste opcional para o próximo dia útil bancário (fim de semana, feriados nacionais, de MS e de Campo Grande, Carnaval e Corpus Christi).
 * - Parcelado: o valor total é dividido e os centavos que sobram vão para a 1ª parcela (a soma bate exatamente).
 * - Recorrente: cada parcela tem o valor informado (ex.: aluguel de R$ 1.500,00 por 12 meses = R$ 18.000,00 de compromisso).
 */
export type Intervalo = "MENSAL" | "BIMESTRAL" | "TRIMESTRAL" | "SEMESTRAL" | "ANUAL" | "SEMANAL" | "QUINZENAL" | "DIAS";
export const INTERVALO_LABEL: Record<Intervalo, string> = { MENSAL: "Mensal", BIMESTRAL: "Bimestral", TRIMESTRAL: "Trimestral", SEMESTRAL: "Semestral", ANUAL: "Anual", SEMANAL: "Semanal", QUINZENAL: "Quinzenal (15 dias)", DIAS: "A cada N dias" };
const MESES: Partial<Record<Intervalo, number>> = { MENSAL: 1, BIMESTRAL: 2, TRIMESTRAL: 3, SEMESTRAL: 6, ANUAL: 12 };
export type ParcelaGerada = { parcela: number; emissao: string; vencimento: string; vencimentoOriginal: string; valor: number; ajustada: boolean };
export type OpcoesFeriado = { locais?: string[]; carnaval?: boolean; corpusChristi?: boolean };

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const ultimoDia = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export function addDias(d: string, n: number) { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
/** Soma meses mantendo o dia-âncora (limitado ao último dia do mês). */
export function addMesesAncorado(d: string, meses: number, diaAncora?: number) {
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)), dia = diaAncora ?? Number(d.slice(8, 10));
  const tot = (m - 1) + meses; const ny = y + Math.floor(tot / 12); const nm = ((tot % 12) + 12) % 12 + 1;
  return iso(ny, nm, Math.min(dia, ultimoDia(ny, nm)));
}
function pascoa(y: number) { // algoritmo de Meeus/Jones/Butcher
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1; return iso(y, mes, dia);
}
/** Dias sem expediente bancário no ano: feriados nacionais (Lei 14.759/2023 incluiu 20/11), Sexta-feira Santa, locais (MM-DD), Carnaval e Corpus Christi opcionais. */
export function feriadosDoAno(y: number, o: OpcoesFeriado = {}) {
  const s = new Set(["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25", ...(o.locais ?? [])].map(md => `${y}-${md}`));
  const p = pascoa(y); s.add(addDias(p, -2));
  if (o.carnaval !== false) { s.add(addDias(p, -48)); s.add(addDias(p, -47)); }
  if (o.corpusChristi !== false) s.add(addDias(p, 60));
  return s;
}
export function ehDiaUtil(d: string, o: OpcoesFeriado = {}, cache = new Map<number, Set<string>>()) {
  const wd = new Date(d + "T12:00:00Z").getUTCDay(); if (wd === 0 || wd === 6) return false;
  const y = Number(d.slice(0, 4)); if (!cache.has(y)) cache.set(y, feriadosDoAno(y, o)); return !cache.get(y)!.has(d);
}
export function proximoDiaUtil(d: string, o: OpcoesFeriado = {}) { const c = new Map<number, Set<string>>(); let x = d; for (let i = 0; i < 15 && !ehDiaUtil(x, o, c); i++) x = addDias(x, 1); return x; }
/** Divide em centavos inteiros; a sobra vai para a 1ª parcela. */
export function distribuir(total: number, n: number) {
  const c = Math.round(total * 100); const base = Math.floor(c / n); const resto = c - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i === 0 ? resto : 0)) / 100);
}
export function gerarParcelas(o: { valor: number; parcelas: number; recorrente: boolean; primeiroVencimento: string; emissao: string; intervalo: Intervalo; dias?: number; ajustarDiaUtil?: boolean; feriados?: OpcoesFeriado }): ParcelaGerada[] {
  const n = Math.max(1, Math.min(240, Math.floor(o.parcelas || 1))); if (!/^\d{4}-\d{2}-\d{2}$/.test(o.primeiroVencimento) || !(o.valor > 0)) return [];
  const valores = o.recorrente ? Array.from({ length: n }, () => Math.round(o.valor * 100) / 100) : distribuir(o.valor, n);
  const meses = MESES[o.intervalo]; const passoDias = o.intervalo === "SEMANAL" ? 7 : o.intervalo === "QUINZENAL" ? 15 : Math.max(1, Math.floor(o.dias ?? 30));
  const ancora = Number(o.primeiroVencimento.slice(8, 10)); const ancoraEm = Number((o.emissao || o.primeiroVencimento).slice(8, 10));
  const c = new Map<number, Set<string>>();
  return valores.map((valor, i) => {
    const orig = meses ? addMesesAncorado(o.primeiroVencimento, meses * i, ancora) : addDias(o.primeiroVencimento, passoDias * i);
    let venc = orig; if (o.ajustarDiaUtil) { for (let k = 0; k < 15 && !ehDiaUtil(venc, o.feriados, c); k++) venc = addDias(venc, 1); }
    const emissao = !o.emissao ? orig : o.recorrente ? (meses ? addMesesAncorado(o.emissao, meses * i, ancoraEm) : addDias(o.emissao, passoDias * i)) : o.emissao;
    return { parcela: i + 1, emissao, vencimento: venc, vencimentoOriginal: orig, valor, ajustada: venc !== orig };
  });
}
export const somaCentavos = (v: number[]) => Math.round(v.reduce((a, b) => a + Math.round(b * 100), 0)) / 100;
/** Lê valor em reais digitado no padrão brasileiro: "1.500,00", "1500,5", "R$ 1.500", "1500.00". */
export function lerValorBr(v: string | null | undefined): number {
  const t = String(v ?? "").replace(/R\$|\s/g, ""); if (!t) return NaN;
  const n = t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : /^\d{1,3}(\.\d{3})+$/.test(t) ? Number(t.replace(/\./g, "")) : Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
export const fmtBr = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const fmtDataBr = (d: string) => d ? d.slice(0, 10).split("-").reverse().join("/") : "—";
const DIA_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
export const diaDaSemana = (d: string) => DIA_SEMANA[new Date(d + "T12:00:00Z").getUTCDay()];
/** Por que a data mudou no ajuste para dia útil (fim de semana ou feriado bancário). */
export function motivoAjuste(orig: string, o: OpcoesFeriado = {}): string {
  const wd = new Date(orig + "T12:00:00Z").getUTCDay(); if (wd === 0 || wd === 6) return diaDaSemana(orig);
  return feriadosDoAno(Number(orig.slice(0, 4)), o).has(orig) ? "feriado" : "dia sem expediente";
}
