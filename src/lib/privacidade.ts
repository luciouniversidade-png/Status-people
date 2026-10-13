import { randomBytes } from "crypto";
import { sql } from "@/db";
import type { Session } from "./auth";
import { hoje, addDays, getSettings } from "./utils";
import { hashToken } from "./reset";

export const PEDIDO_TIPO: Record<string, string> = { CONFIRMACAO_ACESSO: "Confirmação e acesso aos dados", CORRECAO: "Correção de dados", ANONIMIZACAO_ELIMINACAO: "Anonimização, bloqueio ou eliminação", PORTABILIDADE: "Portabilidade", COMPARTILHAMENTO: "Com quem os dados são compartilhados", REVOGACAO_CONSENTIMENTO: "Revogação de consentimento", OPOSICAO: "Oposição a um tratamento", OUTRO: "Outro" };
export const TITULAR_TIPO: Record<string, string> = { RESPONSAVEL: "Responsável por aluno", ALUNO: "Aluno maior de idade ou ex-aluno", COLABORADOR: "Colaborador", EX_COLABORADOR: "Ex-colaborador", CANDIDATO: "Candidato a vaga", OUTRO: "Outro" };
export const PEDIDO_STATUS: Record<string, string> = { RECEBIDA: "Recebido", EM_ANALISE: "Em análise", AGUARDANDO_TITULAR: "Aguardando o titular", RESPONDIDA: "Respondido", INDEFERIDA: "Não atendido (justificado)" };
export const PEDIDO_ABERTO = ["RECEBIDA", "EM_ANALISE", "AGUARDANDO_TITULAR"];
export const CONSENT_STATUS: Record<string, string> = { CONCEDIDO: "Autorizado", NEGADO: "Não autorizado", REVOGADO: "Revogado", SEM_REGISTRO: "Sem registro" };
export const CONSENT_ORIGEM: Record<string, string> = { REMATRICULA_LINK: "Link de rematrícula", SECRETARIA: "Secretaria", PEDIDO_TITULAR: "Pedido do titular" };
export const INC_RISCO: Record<string, string> = { EM_AVALIACAO: "Em avaliação", BAIXO: "Sem risco relevante", RELEVANTE: "Risco ou dano relevante" };
export const INC_STATUS: Record<string, string> = { ABERTO: "Aberto", CONTIDO: "Contido", ENCERRADO: "Encerrado" };
export const CATEGORIAS_DADOS = ["Dados cadastrais de alunos", "Dados de responsáveis", "Dados de colaboradores", "Dados financeiros", "Notas e vida escolar", "Saúde", "Imagens e vídeos", "Credenciais de acesso", "Outros"];
/** Pedidos em que a resposta entrega ou apaga dados: exigem identidade conferida antes de responder. */
export const EXIGE_IDENTIDADE = ["CONFIRMACAO_ACESSO", "PORTABILIDADE", "ANONIMIZACAO_ELIMINACAO", "CORRECAO"];

export async function podePrivacidade(s: Session) { const cfg = await getSettings(); return (cfg.privacidade.perfis as string[]).includes(s.role) || (cfg.privacidade.dpoUserId !== null && cfg.privacidade.dpoUserId === s.id); }

/** Protocolo legível e sequencial por ano (LGPD-2026-0001). Código secreto separado para o titular acompanhar (só o hash fica guardado). */
export async function novoProtocolo(prefixo: string, tabela: "privacy_requests" | "privacy_incidents", coluna: "protocolo" | "codigo") {
  const ano = hoje().slice(0, 4);
  const [{ n }] = await sql<{ n: number }[]>`SELECT coalesce(max(substring(${sql(coluna)} from '[0-9]+$')::int), 0)::int AS n FROM ${sql(tabela)} WHERE ${sql(coluna)} LIKE ${`${prefixo}-${ano}-%`}`;
  return `${prefixo}-${ano}-${String(n + 1).padStart(4, "0")}`;
}
export const novoCodigo = () => { const a = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; const b = randomBytes(12); return Array.from(b, x => a[x % a.length]).join("").replace(/(.{4})(?=.)/g, "$1-"); };
export const hashCodigo = (c: string) => hashToken(c.replace(/[^A-Z0-9]/gi, "").toUpperCase());

/** Soma dias úteis (seg–sex, sem feriados da rede) a partir do dia seguinte à data. */
export async function somaDiasUteis(inicio: string, n: number) {
  const fer = new Set((await sql<{ d: string }[]>`SELECT data::text AS d FROM calendar_days WHERE tipo='FERIADO' AND unit_id IS NULL AND data BETWEEN ${inicio} AND ${addDays(inicio, n * 3 + 30)}`).map(x => x.d));
  let d = inicio, c = 0;
  while (c < n) { d = addDays(d, 1); const w = new Date(d + "T12:00:00Z").getUTCDay(); if (w !== 0 && w !== 6 && !fer.has(d)) c++; }
  return d;
}
/** Prazo de comunicação do incidente à ANPD e aos titulares: dias úteis da ciência; em dobro para agente de pequeno porte. */
export async function prazoIncidente(cienciaIso: string) {
  const cfg = await getSettings(); const n = (cfg.privacidade.prazoIncidenteDiasUteis as number) * (cfg.privacidade.pequenoPorte ? 2 : 1);
  return somaDiasUteis(cienciaIso.slice(0, 10), n);
}

export type ConsentAtual = { student_id: number; purpose_id: number; status: string; versao: number; em: string; origem: string; titular_nome: string | null };
/** Situação vigente (registro mais recente) por aluno e finalidade. */
export async function consentimentosAtuais(studentIds: number[]) {
  if (!studentIds.length) return new Map<string, ConsentAtual>();
  const rows = await sql<ConsentAtual[]>`SELECT DISTINCT ON (student_id, purpose_id) student_id, purpose_id, status, versao, created_at::text AS em, origem, titular_nome FROM consents WHERE student_id = ANY(${studentIds}) ORDER BY student_id, purpose_id, id DESC`;
  return new Map(rows.map(r => [`${r.student_id}:${r.purpose_id}`, r]));
}
export async function finalidades(ativas = true) {
  return sql<{ id: number; codigo: string; titulo: string; texto: string; versao: number; ativo: boolean; na_rematricula: boolean; ordem: number }[]>`SELECT id, codigo, titulo, texto, versao, ativo, na_rematricula, ordem FROM consent_purposes ${ativas ? sql`WHERE ativo` : sql``} ORDER BY ordem, id`;
}

/** Cobertura de consentimentos dos alunos atuais por finalidade (escopo da unidade). */
export async function coberturaConsentimentos(unitId: number | null) {
  const fins = await finalidades();
  const rows = await sql<{ purpose_id: number; status: string; n: number }[]>`SELECT c.purpose_id, c.status, count(*)::int AS n FROM (SELECT DISTINCT ON (student_id, purpose_id) student_id, purpose_id, status FROM consents ORDER BY student_id, purpose_id, id DESC) c JOIN students st ON st.id=c.student_id WHERE st.aluno_atual ${unitId === null ? sql`` : sql`AND st.unit_atual_id=${unitId}`} GROUP BY c.purpose_id, c.status`;
  const [{ total }] = await sql<{ total: number }[]>`SELECT count(*)::int AS total FROM students WHERE aluno_atual ${unitId === null ? sql`` : sql`AND unit_atual_id=${unitId}`}`;
  return { total, porFinalidade: fins.map(f => { const n = (st: string) => rows.find(r => r.purpose_id === f.id && r.status === st)?.n ?? 0; const reg = n("CONCEDIDO") + n("NEGADO") + n("REVOGADO"); return { ...f, concedido: n("CONCEDIDO"), negado: n("NEGADO"), revogado: n("REVOGADO"), semRegistro: Math.max(total - reg, 0) }; }) };
}

/** Pedidos de titulares e incidentes que pedem atenção (Command Center e rotina). */
export async function pendenciasPrivacidade() {
  const h = hoje();
  const [ped] = await sql<{ vencidos: number; vencendo: number; abertos: number }[]>`SELECT count(*) FILTER (WHERE prazo < ${h})::int AS vencidos, count(*) FILTER (WHERE prazo BETWEEN ${h} AND ${addDays(h, 3)})::int AS vencendo, count(*)::int AS abertos FROM privacy_requests WHERE status = ANY(${PEDIDO_ABERTO})`;
  const [inc] = await sql<{ pendentes: number; vencidos: number }[]>`SELECT count(*) FILTER (WHERE comunicar IS NULL OR (comunicar AND comunicado_anpd_em IS NULL))::int AS pendentes, count(*) FILTER (WHERE prazo_anpd < ${h} AND (comunicar IS NULL OR (comunicar AND comunicado_anpd_em IS NULL)))::int AS vencidos FROM privacy_incidents WHERE status <> 'ENCERRADO'`;
  return { pedidos: ped, incidentes: inc };
}
