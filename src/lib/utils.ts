import { db, schema, sql } from "@/db";

import type { Session } from "./auth";
import { DEFAULT_SETTINGS } from "@/db/setup";

// ---------- Rótulos ----------
export const VINCULOS = ["CLT", "HORISTA", "ESTAGIARIO", "PJ", "TEMPORARIO"] as const;
export const VINCULO_LABEL: Record<string, string> = { CLT: "CLT", HORISTA: "Horista", ESTAGIARIO: "Estagiário", PJ: "PJ", TEMPORARIO: "Temporário" };
export const NIVEIS = ["Júnior", "Pleno", "Sênior"];
export const TURNOS = ["Matutino", "Vespertino", "Integral", "Noturno", "Variável"];
export const SITUACAO_LABEL: Record<string, string> = { EM_ADMISSAO: "Em admissão", ATIVO: "Ativo", DESLIGADO: "Desligado", FERIAS: "Em férias", AFASTADO: "Afastado" };
export const LEAVE_TIPOS = ["FERIAS", "AFASTAMENTO_SAUDE", "LICENCA", "FOLGA_BANCO", "OUTRO"] as const;
export const LEAVE_LABEL: Record<string, string> = { FERIAS: "Férias", AFASTAMENTO_SAUDE: "Afastamento por saúde", LICENCA: "Licença", FOLGA_BANCO: "Folga do banco de horas", OUTRO: "Outro" };
export const LEAVE_STATUS: Record<string, string> = { SOLICITADA: "Aguardando aprovação", APROVADA: "Aprovada", REJEITADA: "Rejeitada", CANCELADA: "Cancelada" };
export const HOUR_TIPOS = ["EXTRA", "ATRASO", "FALTA", "COMPENSACAO", "AJUSTE"] as const;
export const HOUR_LABEL: Record<string, string> = { EXTRA: "Hora extra", ATRASO: "Atraso", FALTA: "Falta", COMPENSACAO: "Compensação (folga)", AJUSTE: "Ajuste" };
export const HOUR_STATUS: Record<string, string> = { PENDENTE: "Pendente", APROVADO: "Aprovado", REJEITADO: "Rejeitado" };
export const ENR_STATUS: Record<string, string> = { RESERVADA: "Reservada", CONFIRMADA: "Matriculada", EXPIRADA: "Reserva expirada", CANCELADA: "Cancelada", TRANSFERIDA: "Transferida" };
export const WL_STATUS: Record<string, string> = { AGUARDANDO: "Aguardando", OFERTADA: "Vaga ofertada", CONVERTIDA: "Convertida", DESISTIU: "Desistiu" };
export const ORIGENS = ["REMATRICULA", "INDICACAO", "SITE", "REDES", "VISITA", "OUTRO"] as const;
export const ORIGEM_LABEL: Record<string, string> = { REMATRICULA: "Rematrícula", INDICACAO: "Indicação", SITE: "Site", REDES: "Redes sociais", VISITA: "Visita espontânea", OUTRO: "Outro" };
export const MOTIVOS_PERDA = ["Preço / condição financeira", "Mudança de cidade", "Escolheu outra escola", "Turno indisponível", "Vaga indisponível", "Desistência sem motivo informado", "Transferência interna", "Outro"];
export const PROC_LABEL: Record<string, string> = { ADMISSAO: "Admissão", DESLIGAMENTO: "Desligamento" };
export const PROC_STATUS: Record<string, string> = { ABERTO: "Em andamento", CONCLUIDO: "Concluído", CANCELADO: "Cancelado" };

// ---------- Datas ----------
// Data civil de hoje no fuso de Campo Grande (evita virar o dia às 20h locais).
export const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Campo_Grande" });
export function fmtData(d: string | Date | null | undefined) {
  if (!d) return "—";
  const s = typeof d === "string" ? d : d.toISOString().slice(0, 10);
  const [y, m, day] = s.split("-");
  return `${day}/${m}/${y}`;
}
export function fmtDataHora(d: Date | string | null | undefined) {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d.replace(" ", "T").replace(/(\.\d+)?$/, "") + "Z") : d;
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleString("pt-BR", { timeZone: "America/Campo_Grande", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
export function addDays(iso: string, n: number) { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function addMonths(iso: string, n: number) { const d = new Date(iso + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); }
export function diasEntre(a: string, b: string) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000) + 1; }
export function fmtMin(min: number) {
  const s = min < 0 ? "−" : min > 0 ? "+" : "";
  const a = Math.abs(min); return `${s}${Math.floor(a / 60)}h${String(a % 60).padStart(2, "0")}`;
}
export function fmtMoeda(v: string | number | null | undefined) {
  if (v === null || v === undefined || v === "") return "—";
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
export function idade(nasc: string | null) {
  if (!nasc) return null; const d = new Date(nasc + "T00:00:00Z"), n = new Date();
  let a = n.getUTCFullYear() - d.getUTCFullYear(); if (n.getUTCMonth() < d.getUTCMonth() || (n.getUTCMonth() === d.getUTCMonth() && n.getUTCDate() < d.getUTCDate())) a--; return a;
}

// ---------- Férias: períodos aquisitivos (CLT: 12 meses → 30 dias; concessivo nos 12 meses seguintes) ----------
export type Periodo = { inicio: string; fim: string; concessivoAte: string; direito: number; usados: number; saldo: number; status: "EM_AQUISICAO" | "ABERTO" | "VENCIDO" | "QUITADO" };
export function periodosFerias(admissao: string, aprovadas: { periodoRef: string | null; dias: number }[], ate = hoje()): Periodo[] {
  const out: Periodo[] = [];
  let ini = admissao;
  for (let i = 0; i < 40; i++) {
    const fim = addDays(addMonths(ini, 12), -1);
    if (ini > ate) break;
    const usados = aprovadas.filter(a => a.periodoRef === ini).reduce((s, a) => s + a.dias, 0);
    const direito = 30; const saldo = Math.max(direito - usados, 0);
    const concessivoAte = addDays(addMonths(fim, 12), 0);
    let status: Periodo["status"] = fim >= ate ? "EM_AQUISICAO" : saldo === 0 ? "QUITADO" : concessivoAte < ate ? "VENCIDO" : "ABERTO";
    out.push({ inicio: ini, fim, concessivoAte, direito, usados, saldo, status });
    ini = addDays(fim, 1);
  }
  return out;
}

// ---------- Situação derivada (férias/afastamento vigentes) ----------
export function situacaoDerivada(base: string, leavesHoje: { tipo: string }[]) {
  if (base !== "ATIVO") return base;
  if (leavesHoje.some(l => l.tipo === "FERIAS")) return "FERIAS";
  if (leavesHoje.some(l => l.tipo === "AFASTAMENTO_SAUDE" || l.tipo === "LICENCA")) return "AFASTADO";
  return "ATIVO";
}

// ---------- Configurações ----------
export type Settings = typeof DEFAULT_SETTINGS;
export async function getSettings(): Promise<Settings> {
  const rows = await db.select().from(schema.settings);
  const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    // objetos de configuração recebem as chaves novas do padrão (ex.: alçadas criadas depois da instalação)
    const base = (DEFAULT_SETTINGS as Record<string, unknown>)[r.key];
    s[r.key] = base && typeof base === "object" && !Array.isArray(base) && r.value && typeof r.value === "object" && !Array.isArray(r.value) ? { ...(base as object), ...(r.value as object) } : r.value;
  }
  return s as Settings;
}

// ---------- Auditoria ----------
// Campos sensíveis nunca entram em claro na trilha de auditoria (a trilha registra QUE mudou, não o valor).
const SENSIVEIS = new Set(["cpf", "cpfResponsavel", "cpf_responsavel", "salario", "salarioAnterior", "salario_anterior", "senha", "senhaHash", "senha_hash", "totpSecret", "totp_secret", "backupCodes", "backup_codes", "dataNascimento", "data_nascimento", "justificativa"]);
export function mascarar(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(mascarar);
  if (v && typeof v === "object" && !(v instanceof Date)) return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SENSIVEIS.has(k) ? (x === null || x === undefined || x === "" ? x : "***") : mascarar(x)]));
  return v;
}
export async function audit(s: Session | null, acao: string, entidade: string, entidadeId: number | null, antes?: unknown, depois?: unknown) {
  await db.insert(schema.auditLog).values({ userId: s?.id ?? null, userNome: s?.nome ?? "sistema", acao, entidade, entidadeId, antes: mascarar(antes ?? null), depois: mascarar(depois ?? null) });
}

// ---------- Helpers de formulário ----------
export const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" ? v.trim() : ""; };
export const strOrNull = (fd: FormData, k: string) => str(fd, k) || null;
export const num = (fd: FormData, k: string) => { const v = str(fd, k); return v === "" ? null : Number(v.replace(",", ".")); };
export const int = (fd: FormData, k: string) => { const v = num(fd, k); return v === null ? null : Math.round(v); };

// ---------- Consultas compartilhadas ----------
export async function leavesVigentes(employeeIds: number[]) {
  if (employeeIds.length === 0) return new Map<number, { tipo: string }[]>();
  const h = hoje();
  const full = await sql<{ employee_id: number; tipo: string }[]>`SELECT employee_id, tipo FROM leave_requests WHERE status='APROVADA' AND inicio <= ${h} AND fim >= ${h} AND employee_id = ANY(${employeeIds})`;
  const m = new Map<number, { tipo: string }[]>();
  for (const r of full) m.set(r.employee_id, [...(m.get(r.employee_id) ?? []), { tipo: r.tipo }]);
  return m;
}

export async function saldosBanco(employeeIds: number[]) {
  const m = new Map<number, number>();
  if (employeeIds.length === 0) return m;
  const rows = await sql<{ employee_id: number; saldo: number }[]>`SELECT employee_id, coalesce(sum(minutos),0)::int AS saldo FROM hour_entries WHERE status='APROVADO' AND employee_id = ANY(${employeeIds}) GROUP BY employee_id`;
  for (const r of rows) m.set(r.employee_id, r.saldo);
  return m;
}

/** Mensagem de erro amigável para redirecionar com ?erro= */
export function erroMsg(e: unknown) { return encodeURIComponent(e instanceof Error ? e.message : "Erro inesperado."); }

// ---------- Importação de planilhas coladas ----------
/** Detecta o separador da primeira linha: tabulação (cópia direta do Excel), ponto e vírgula (CSV brasileiro) ou vírgula. */
export function detectarSeparador(linha: string) { return linha.includes("\t") ? "\t" : linha.includes(";") ? ";" : ","; }
/** Normaliza um título de coluna: sem BOM, sem acento, minúsculo, espaços → _ (aceita "Admissão", "jornada min dia", "E-mail"…). */
const ALIAS_CABECALHO: Record<string, string> = { e_mail: "email", mail: "email", celular: "telefone", fone: "telefone", whatsapp: "telefone", data_de_admissao: "admissao", data_admissao: "admissao", dt_admissao: "admissao", funcao: "cargo", setor: "area", jornada: "jornada_min_dia", jornada_min: "jornada_min_dia", jornada_minutos: "jornada_min_dia", minutos_dia: "jornada_min_dia", periodo: "turno", cnpj_empregador: "empresa", empregador: "empresa", tipo_vinculo: "vinculo", aluno_a: "aluno", responsavel_financeiro: "responsavel", valor_rs: "valor", vencto: "vencimento", data_vencimento: "vencimento", competencia_mm_aaaa: "competencia", numero_titulo: "titulo", n_titulo: "titulo", nro_titulo: "titulo" };
export function normalizarCabecalho(h: string) { const k = h.replace(/^\uFEFF/, "").replace(/^"|"$/g, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[\s\-\/.]+/g, "_").replace(/[()]/g, "").replace(/_+$/, ""); return ALIAS_CABECALHO[k] ?? k; }
/** Limpa uma célula: aspas de CSV e espaços. */
export function celula(v: string | undefined) { return (v ?? "").trim().replace(/^"(.*)"$/, "$1").trim(); }

/** Lê um arquivo enviado (.xlsx/.xls/.csv/.txt) e devolve texto tabulado (primeira aba). Decodifica CSV em UTF-8 ou Windows-1252 (Excel brasileiro). */
export async function arquivoParaTexto(file: File): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer()); const nome = file.name.toLowerCase();
  if (/\.(xlsx|xlsm|xls)$/.test(nome) || buf.subarray(0, 2).toString("hex") === "504b") {
    const XLSX = await import("xlsx"); const wb = XLSX.read(buf, { type: "buffer", cellDates: true, raw: false });
    const ws = wb.Sheets[wb.SheetNames[0]]; return XLSX.utils.sheet_to_csv(ws, { FS: "\t", blankrows: false, dateNF: "dd/mm/yyyy" });
  }
  let t = buf.toString("utf8"); if (t.includes("\uFFFD")) t = new TextDecoder("windows-1252").decode(buf);
  return t.replace(/^\uFEFF/, "");
}
