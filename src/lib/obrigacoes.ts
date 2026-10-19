import { sql } from "@/db";
import type { Session } from "./auth";
import { getSettings, hoje, addDays } from "./utils";
import { usuariosPorPerfil } from "./comunicacao";

/**
 * T-031 · Obrigações e compliance fiscal (aceite da T-031 · CRQ-COB-V3-01 “baixa com documento”): a agenda fiscal das entidades com dono, prazo, estado e comprovante.
 * Regra central: guia "paga" sem comprovante anexado NÃO baixa — fica "aguardando comprovante" e o responsável recebe a pendência.
 * O cálculo e a emissão das guias seguem com o contador; aqui é a agenda, a baixa comprovada e o dossiê das fiscalizações.
 */
export const STATUS_OBRIGACAO: Record<string, string> = { PENDENTE: "Pendente", AGUARDA_COMPROVANTE: "Paga — aguardando comprovante", PAGA: "Paga (comprovada)", DISPENSADA: "Dispensada no mês" };
export type SituacaoObr = "PAGA" | "DISPENSADA" | "AGUARDA_COMPROVANTE" | "ATRASADA" | "VENCE_HOJE" | "VENCENDO" | "A_VENCER";
export const SITUACAO_OBR: Record<SituacaoObr, { rotulo: string; tom: "bom" | "atencao" | "ruim" | "neutro" }> = {
  PAGA: { rotulo: "Paga", tom: "bom" }, DISPENSADA: { rotulo: "Dispensada", tom: "neutro" }, AGUARDA_COMPROVANTE: { rotulo: "Sem comprovante", tom: "atencao" },
  ATRASADA: { rotulo: "Atrasada", tom: "ruim" }, VENCE_HOJE: { rotulo: "Vence hoje", tom: "ruim" }, VENCENDO: { rotulo: "Vence em até 7 dias", tom: "atencao" }, A_VENCER: { rotulo: "A vencer", tom: "neutro" },
};
/** Dias corridos de h até a data (0 = hoje; negativo = já passou). */
export const faltamDias = (h: string, data: string) => Math.round((Date.parse(`${data}T00:00:00Z`) - Date.parse(`${h}T00:00:00Z`)) / 86400000);
export function situacaoObrigacao(o: { status: string; vencimento: string }, h: string): SituacaoObr {
  if (o.status === "PAGA") return "PAGA"; if (o.status === "DISPENSADA") return "DISPENSADA";
  if (o.vencimento < h) return "ATRASADA"; if (o.status === "AGUARDA_COMPROVANTE") return "AGUARDA_COMPROVANTE";
  if (o.vencimento === h) return "VENCE_HOJE"; if (faltamDias(h, o.vencimento) <= 7) return "VENCENDO"; return "A_VENCER";
}
export const TIPOS_MOVIMENTO: Record<string, string> = { INTIMACAO: "Intimação / notificação", ENTREGA: "Entrega de documentos", RESPOSTA: "Resposta / defesa", REUNIAO: "Reunião / diligência", DECISAO: "Decisão / auto", OUTRO: "Outro movimento" };

/** Vencimento-modelo: dia D do mês seguinte à competência; sábado e domingo antecipam para a sexta (feriados: confira com o contador). */
export function vencimentoModelo(competencia: string, dia: number): string {
  const [a, m] = competencia.split("-").map(Number); const ano = m === 12 ? a + 1 : a; const mes = m === 12 ? 1 : m + 1;
  const ult = new Date(Date.UTC(ano, mes, 0)).getUTCDate(); const d = new Date(Date.UTC(ano, mes - 1, Math.min(dia, ult)));
  const dow = d.getUTCDay(); if (dow === 6) d.setUTCDate(d.getUTCDate() - 1); if (dow === 0) d.setUTCDate(d.getUTCDate() - 2);
  return d.toISOString().slice(0, 10);
}
/** Aviso D-x: quantos dias faltam, se for um dos dias de aviso configurados (7, 3, 0); senão null. */
export function diaDeAviso(vencimento: string, h: string, avisos: number[]): number | null { const d = faltamDias(h, vencimento); return avisos.includes(d) ? d : null; }

/** Gera a agenda de uma competência para todas as entidades a partir dos modelos (idempotente por entidade × competência × tipo). */
export async function gerarAgenda(competencia: string, s: Session | null) {
  const cfg = await getSettings(); const modelos = (cfg.obrigacoes.modelos ?? []) as { tipo: string; dia: number | null }[];
  const ents = await sql<{ id: number }[]>`SELECT id FROM companies ORDER BY id`; const fin = await usuariosPorPerfil(["FINANCEIRO"]); const resp = fin[0] ?? null;
  let criadas = 0; const semDia: string[] = [];
  for (const m of modelos) {
    if (!m.dia) { semDia.push(m.tipo); continue; }
    for (const e of ents) {
      const [r] = await sql<{ id: number }[]>`INSERT INTO obligations (company_id, tipo, competencia, vencimento, status, responsavel_user_id, origem, created_by)
        SELECT ${e.id}, ${m.tipo}, ${competencia}, ${vencimentoModelo(competencia, m.dia)}, 'PENDENTE', ${resp}, 'MODELO', ${s?.id ?? null}
        WHERE NOT EXISTS (SELECT 1 FROM obligations WHERE company_id=${e.id} AND competencia=${competencia} AND tipo=${m.tipo}) RETURNING id`;
      if (r) criadas++;
    }
  }
  return { criadas, semDia, entidades: ents.length };
}

export type Obrigacao = { id: number; company_id: number | null; entidade: string | null; unit_id: number | null; unidade: string | null; tipo: string; descricao: string | null; competencia: string | null; vencimento: string; valor: number | null; status: string; pago_em: string | null; responsavel_user_id: number | null; responsavel: string | null; origem: string; obs: string | null; comprovantes: number; guia_folha: boolean };
export async function listarObrigacoes(f: { ini: string; fim: string; companyId?: number | null; status?: string | null; abertasAntes?: boolean }) {
  const h = hoje();
  return sql<Obrigacao[]>`SELECT o.id, o.company_id, c.nome AS entidade, o.unit_id, u.nome AS unidade, o.tipo, o.descricao, o.competencia, o.vencimento::text, o.valor::float, o.status, o.pago_em::text, o.responsavel_user_id, us.nome AS responsavel, o.origem, o.obs,
      (SELECT count(*) FROM attachments a WHERE a.entidade='obligation' AND a.entidade_id=o.id)::int AS comprovantes, EXISTS (SELECT 1 FROM payroll_docs d WHERE d.obligation_id=o.id) AS guia_folha
    FROM obligations o LEFT JOIN companies c ON c.id=o.company_id LEFT JOIN units u ON u.id=o.unit_id LEFT JOIN users us ON us.id=o.responsavel_user_id
    WHERE ((o.vencimento >= ${f.ini}::date AND o.vencimento <= ${f.fim}::date) ${f.abertasAntes ? sql`OR (o.vencimento < ${f.ini}::date AND o.status IN ('PENDENTE','AGUARDA_COMPROVANTE') AND o.vencimento < ${h}::date)` : sql``})
      ${f.companyId ? sql`AND o.company_id=${f.companyId}` : sql``} ${f.status ? sql`AND o.status=${f.status}` : sql``}
    ORDER BY o.vencimento, c.nome NULLS LAST, o.tipo`;
}

export type Fiscalizacao = { id: number; titulo: string; orgao: string | null; tipo: string | null; company_ids: number[] | null; abertura: string | null; prazo: string | null; status: string; responsavel_user_id: number | null; responsavel: string | null; descricao: string | null; eventos: number; prazo_aberto: string | null; documentos: number };
export async function listarFiscalizacoes(abertas = true) {
  return sql<Fiscalizacao[]>`SELECT f.id, f.titulo, f.orgao, f.tipo, f.company_ids, f.abertura::text, f.prazo::text, f.status, f.responsavel_user_id, u.nome AS responsavel, f.descricao,
      (SELECT count(*) FROM fiscal_case_events e WHERE e.case_id=f.id)::int AS eventos, (SELECT min(e.prazo)::text FROM fiscal_case_events e WHERE e.case_id=f.id AND e.prazo IS NOT NULL AND e.cumprido_em IS NULL) AS prazo_aberto,
      (SELECT count(*) FROM attachments a WHERE a.entidade='fiscal_case' AND a.entidade_id=f.id)::int AS documentos
    FROM fiscal_cases f LEFT JOIN users u ON u.id=f.responsavel_user_id WHERE ${abertas ? sql`f.status <> 'ENCERRADO'` : sql`true`} ORDER BY (f.status='ENCERRADO'), f.prazo NULLS LAST, f.id DESC`;
}
export async function eventosFiscalizacao(caseId: number) {
  return sql<{ id: number; data: string; tipo: string; texto: string; prazo: string | null; cumprido_em: string | null; user_nome: string | null }[]>`SELECT id, data::text, tipo, texto, prazo::text, cumprido_em::text, user_nome FROM fiscal_case_events WHERE case_id=${caseId} ORDER BY data DESC, id DESC`;
}
/** Notificações D-7/D-3/D0 ao responsável (e ao Financeiro quando não há responsável) — rotina diária, idempotente por obrigação × dia de aviso. */
export async function avisosObrigacoes(notificar: (ids: number[], t: string, x: string | null, l: string | null, tipo: "INFO" | "ACAO" | "ALERTA", chave: string | null) => Promise<void>) {
  const cfg = await getSettings(); const h = hoje(); const avisos = (cfg.obrigacoes.avisosDias ?? [7, 3, 0]) as number[]; const max = Math.max(...avisos, 0);
  const rows = await sql<{ id: number; tipo: string; entidade: string | null; vencimento: string; responsavel_user_id: number | null; status: string }[]>`SELECT o.id, o.tipo, c.nome AS entidade, o.vencimento::text, o.responsavel_user_id, o.status FROM obligations o LEFT JOIN companies c ON c.id=o.company_id WHERE o.status IN ('PENDENTE','AGUARDA_COMPROVANTE') AND o.vencimento <= ${addDays(h, max)}::date`;
  const fin = await usuariosPorPerfil(["FINANCEIRO"]); let n = 0;
  for (const o of rows) {
    const para = o.responsavel_user_id ? [o.responsavel_user_id] : fin;
    if (o.vencimento < h) { await notificar(para, `Obrigação atrasada: ${o.tipo}`, `${o.entidade ?? "entidade"} · venceu em ${o.vencimento.split("-").reverse().join("/")}${o.status === "AGUARDA_COMPROVANTE" ? " · falta o comprovante" : ""}`, "/financeiro/obrigacoes", "ALERTA", `obr:${o.id}:atraso:${h.slice(0, 7)}`); n++; continue; }
    const d = diaDeAviso(o.vencimento, h, avisos); if (d === null) continue;
    await notificar(para, d === 0 ? `Vence hoje: ${o.tipo}` : `Vence em ${d} dia(s): ${o.tipo}`, `${o.entidade ?? "entidade"} · ${o.vencimento.split("-").reverse().join("/")}`, "/financeiro/obrigacoes", d === 0 ? "ALERTA" : "ACAO", `obr:${o.id}:d${d}`); n++;
  }
  return n;
}
