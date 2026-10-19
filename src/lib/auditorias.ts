import { sql } from "@/db";
import { hoje } from "./utils";

/**
 * T-080 · Auditorias & NC/CAPA (CRQ-PRJ-V3-03/04): auditoria como processo — agenda com auditor-líder e prazos (no prazo / vencida),
 * achados que viram NC → causa raiz → CAPA com prazo → verificação de eficácia (só fecha com evidência); reincidência reabre a NC
 * com gravidade maior.
 */
export const STATUS_AUDITORIA: Record<string, string> = { PLANEJADA: "Planejada", EM_EXECUCAO: "Em execução", RELATORIO: "Relatório em elaboração", CONCLUIDA: "Concluída", CANCELADA: "Cancelada" };
export const TIPOS_AUDITORIA: Record<string, string> = { INTERNA: "Interna (processos e POPs)", LGPD: "Privacidade (LGPD)", SST: "Segurança e saúde (SST)", FINANCEIRA: "Financeira / controles", PEDAGOGICA: "Pedagógica", FORNECEDOR: "Fornecedor / terceiro", EXTERNA: "Externa (certificação, órgão)" };
export const GRAVIDADE_NC: Record<number, string> = { 1: "Leve", 2: "Moderada", 3: "Grave", 4: "Crítica (reincidente)" };
export type SituacaoAuditoria = "NO_PRAZO" | "EXECUCAO_VENCIDA" | "RELATORIO_VENCIDO" | "CONCLUIDA" | "CANCELADA";
/** No prazo × vencida: a execução vence na data planejada; o relatório, no prazo do relatório. */
export function situacaoAuditoria(a: { status: string; planejada_para: string; realizada_em: string | null; prazo_relatorio: string | null }, h: string): SituacaoAuditoria {
  if (a.status === "CONCLUIDA") return "CONCLUIDA"; if (a.status === "CANCELADA") return "CANCELADA";
  if (!a.realizada_em && a.planejada_para < h) return "EXECUCAO_VENCIDA";
  if (a.prazo_relatorio && a.prazo_relatorio < h) return "RELATORIO_VENCIDO";
  return "NO_PRAZO";
}
/** Reincidência: gravidade sobe um nível (máx. 4). */
export const gravidadeReincidente = (g: number) => Math.min(4, Math.max(1, g) + 1);
/** Faixa de aging das CAPAs em aberto: dias de atraso contra o prazo (antes do prazo = "no prazo"). */
export function faixaAging(prazo: string | null, h: string): "SEM_PRAZO" | "NO_PRAZO" | "ATE30" | "ATE60" | "ATE90" | "MAIS90" {
  if (!prazo) return "SEM_PRAZO"; const d = Math.round((Date.parse(`${h}T00:00:00Z`) - Date.parse(`${prazo}T00:00:00Z`)) / 86400000);
  return d <= 0 ? "NO_PRAZO" : d <= 30 ? "ATE30" : d <= 60 ? "ATE60" : d <= 90 ? "ATE90" : "MAIS90";
}
export const FAIXAS_AGING: Record<string, string> = { NO_PRAZO: "No prazo", ATE30: "1–30 dias de atraso", ATE60: "31–60 dias", ATE90: "61–90 dias", MAIS90: "mais de 90 dias", SEM_PRAZO: "sem prazo" };

export type Auditoria = { id: number; titulo: string; tipo: string; area: string | null; unit_id: number | null; unidade: string | null; lead_user_id: number | null; lider: string | null; planejada_para: string; realizada_em: string | null; prazo_relatorio: string | null; status: string; escopo: string | null; conclusao: string | null; achados: number; abertos: number };
export async function listarAuditorias(unitId: number | null, ano: number | null) {
  return sql<Auditoria[]>`SELECT a.id, a.titulo, a.tipo, a.area, a.unit_id, u.nome AS unidade, a.lead_user_id, l.nome AS lider, a.planejada_para::text, a.realizada_em::text, a.prazo_relatorio::text, a.status, a.escopo, a.conclusao,
      (SELECT count(*) FROM nonconformities n WHERE n.audit_id=a.id)::int AS achados, (SELECT count(*) FROM nonconformities n WHERE n.audit_id=a.id AND n.status <> 'ENCERRADA')::int AS abertos
    FROM audits a LEFT JOIN units u ON u.id=a.unit_id LEFT JOIN users l ON l.id=a.lead_user_id
    WHERE true ${unitId === null ? sql`` : sql`AND (a.unit_id IS NULL OR a.unit_id=${unitId})`} ${ano ? sql`AND extract(year FROM a.planejada_para)=${ano}` : sql``} ORDER BY a.planejada_para DESC, a.id DESC`;
}
export type NcCapa = { id: number; titulo: string; origem: string; gravidade: number; status: string; prazo: string | null; audit_id: number | null; auditoria: string | null; unidade: string | null; responsavel_user_id: number | null; responsavel: string | null; causa_raiz: string | null; acao_corretiva: string | null; acao_preventiva: string | null; descricao: string | null; eficacia_evidencia: string | null; eficacia_em: string | null; reincidencias: number; evidencias: number; created_at: Date };
export async function listarNcs(unitId: number | null, f: { auditId?: number | null; abertas?: boolean } = {}) {
  return sql<NcCapa[]>`SELECT n.id, n.titulo, n.origem, n.gravidade, n.status, n.prazo::text, n.audit_id, a.titulo AS auditoria, un.nome AS unidade, n.responsavel_user_id, us.nome AS responsavel, n.causa_raiz, n.acao_corretiva, n.acao_preventiva, n.descricao, n.eficacia_evidencia, n.eficacia_em::text, n.reincidencias,
      (SELECT count(*) FROM attachments x WHERE x.entidade='nonconformity' AND x.entidade_id=n.id)::int AS evidencias, n.created_at
    FROM nonconformities n LEFT JOIN audits a ON a.id=n.audit_id LEFT JOIN units un ON un.id=n.unit_id LEFT JOIN users us ON us.id=n.responsavel_user_id
    WHERE true ${unitId === null ? sql`` : sql`AND (n.unit_id IS NULL OR n.unit_id=${unitId})`} ${f.auditId ? sql`AND n.audit_id=${f.auditId}` : sql``} ${f.abertas ? sql`AND n.status <> 'ENCERRADA'` : sql``}
    ORDER BY (n.status <> 'ENCERRADA') DESC, n.gravidade DESC, n.prazo NULLS LAST LIMIT 300`;
}
export const hojeAud = () => hoje();
