// v31 · Conversas: 1:1 marcadas (agenda do líder e do liderado) e feedback contínuo (qualquer colega manda ou pede).
// Privacidade: o conteúdo de uma 1:1 (pauta) e de um feedback privado fica entre as duas pessoas; a gestão vê contagens e cadência.
import { sql } from "@/db";
import { scopeUnit, type Session } from "./auth";
import { addDays, hoje, localParaUtc } from "./utils";

export const STATUS_1A1: Record<string, string> = { MARCADA: "Marcada", REALIZADA: "Realizada", CANCELADA: "Cancelada" };
export const TOM_1A1: Record<string, string> = { MARCADA: "EM_ADMISSAO", REALIZADA: "APROVADA", CANCELADA: "CANCELADA" };
export const RECORRENCIA: Record<string, string> = { NENHUMA: "Não se repete", SEMANAL: "Toda semana", QUINZENAL: "A cada 15 dias", MENSAL: "Todo mês" };
const PASSO: Record<string, number> = { SEMANAL: 7, QUINZENAL: 14, MENSAL: 28 };
/** Próxima data da série (mensal = 4 semanas, para cair no mesmo dia da semana). */
export const proximaData = (data: string, recorrencia: string) => (PASSO[recorrencia] ? addDays(data, PASSO[recorrencia]) : null);

export const FORMATO_FB: Record<string, { rotulo: string; dica: string }> = {
  LIVRE: { rotulo: "Feedback livre", dica: "Escreva aqui seu feedback. Não se esqueça de fornecer o contexto e as consequências do comportamento em questão." },
  SCI: { rotulo: "Situação · comportamento · impacto", dica: "Descreva a situação, o que a pessoa fez (fato observável) e o efeito que isso teve." },
  ELOGIO: { rotulo: "Elogio (reconhecer algo bem feito)", dica: "Conte o que a pessoa fez e por que fez diferença — elogio específico vale mais que “parabéns”." },
  SUGESTAO: { rotulo: "Sugestão para a próxima vez", dica: "Olhe para a frente: o que a pessoa pode tentar da próxima vez e por quê." },
};
export const VISIBILIDADE_FB: Record<string, string> = { PRIVADO: "Só a pessoa", GESTOR: "A pessoa e o gestor direto dela", GESTAO: "Registrado no painel do colaborador (gestão)" };
export const STATUS_PEDIDO: Record<string, string> = { PENDENTE: "Aguardando", RESPONDIDO: "Respondido", RECUSADO: "Recusado", CANCELADO: "Cancelado" };
export const TOM_PEDIDO: Record<string, string> = { PENDENTE: "PENDENTE", RESPONDIDO: "APROVADA", RECUSADO: "REJEITADA", CANCELADO: "CANCELADA" };

export type Colega = { id: number; nome: string; unidade: string; cargo: string | null; user_id: number | null; relacao: "EQUIPE" | "GESTOR" | "COLEGA" };
/**
 * Com quem a pessoa conversa (1:1 e feedback): a equipe direta, o próprio gestor e os colegas da unidade (perfis de rede: a rede toda).
 * Quem não tem acesso ao ONE aparece também — a 1:1 fica na agenda de quem marcou e o feedback do gestor vai para o painel.
 */
export async function colegasConversa(s: Session): Promise<Colega[]> {
  const u = scopeUnit(s) ?? (["COLABORADOR", "COMERCIAL", "FINANCEIRO", "OPERACOES"].includes(s.role) ? s.unitId : null); const eu = s.employeeId ?? null;
  const [me] = eu ? await sql<{ gestor_id: number | null; unit_id: number }[]>`SELECT gestor_id, unit_id FROM employees WHERE id=${eu}` : [];
  const unidade = u ?? (me && !["RH", "DIRECAO", "LEITURA"].includes(s.role) ? me.unit_id : null);
  return sql<Colega[]>`SELECT e.id, e.nome, un.nome AS unidade, p.nome AS cargo, (SELECT us.id FROM users us WHERE us.employee_id=e.id AND us.ativo ORDER BY us.id LIMIT 1) AS user_id,
      CASE WHEN e.gestor_id IS NOT NULL AND e.gestor_id=${eu} THEN 'EQUIPE' WHEN e.id=${me?.gestor_id ?? null} THEN 'GESTOR' ELSE 'COLEGA' END AS relacao
    FROM employees e JOIN units un ON un.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id
    WHERE e.situacao IN ('ATIVO','FERIAS','AFASTADO') AND e.id IS DISTINCT FROM ${eu}
      ${unidade === null ? sql`` : sql`AND (e.unit_id=${unidade} OR e.gestor_id=${eu} OR e.id=${me?.gestor_id ?? null})`}
    ORDER BY (e.gestor_id IS NOT NULL AND e.gestor_id=${eu}) DESC, e.id=${me?.gestor_id ?? null} DESC, e.nome`;
}
export const rotuloColega = (c: Colega) => `${c.nome}${c.relacao === "EQUIPE" ? " · sua equipe" : c.relacao === "GESTOR" ? " · seu gestor(a)" : ""}${c.cargo ? ` — ${c.cargo}` : ""} (${c.unidade})${c.user_id ? "" : " · sem acesso ao ONE"}`;

/** Participante da 1:1: quem marcou ou a pessoa convidada (pelo acesso vinculado à ficha). */
export const participa = (s: Session, o: { organizador_user_id: number; employee_id: number }) => o.organizador_user_id === s.id || (!!s.employeeId && o.employee_id === s.employeeId);

export type UmAUm = { id: number; organizador_user_id: number; organizador_nome: string | null; organizador_employee_id: number | null; employee_id: number; nome: string; convidado_user_id: number | null; data: string; inicio: string; fim: string; titulo: string; temas: string[]; recorrencia: string; status: string; pauta: ItemPauta[]; checkin_id: number | null; motivo_cancelamento: string | null; anterior_id: number | null; realizada_em: Date | null };
export type ItemPauta = { id: string; texto: string; autor: string; autorId?: number; em: string; feito: boolean };
export async function umAUm(id: number): Promise<UmAUm | null> {
  const [r] = await sql<UmAUm[]>`SELECT o.id, o.organizador_user_id, o.organizador_nome, o.organizador_employee_id, o.employee_id, e.nome, (SELECT us.id FROM users us WHERE us.employee_id=e.id AND us.ativo ORDER BY us.id LIMIT 1) AS convidado_user_id,
    o.data::text, o.inicio, o.fim, o.titulo, o.temas, o.recorrencia, o.status, o.pauta, o.checkin_id, o.motivo_cancelamento, o.anterior_id, o.realizada_em FROM one_on_ones o JOIN employees e ON e.id=o.employee_id WHERE o.id=${id}`;
  return r ?? null;
}

/** Arquivo de agenda (.ics) da 1:1 — horário da escola convertido para UTC; o calendário de cada pessoa mostra no fuso dela. */
export function icsUmAUm(o: { id: number; data: string; inicio: string; fim: string; titulo: string; temas: string[]; organizador_nome: string | null; nome: string; status: string }, base: string) {
  const z = (d: string, h: string) => { const u = localParaUtc(`${d} ${h}`); return `${u.slice(0, 10).replace(/-/g, "")}T${u.slice(11, 19).replace(/:/g, "")}Z`; }; // AAAAMMDDTHHMMSSZ
  const esc = (t: string) => t.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const agora = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Colegio Status//STATUS ONE//PT-BR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:um-a-um-${o.id}@status-one`, `DTSTAMP:${agora}`, `DTSTART:${z(o.data, o.inicio)}`, `DTEND:${z(o.data, o.fim)}`,
    `SUMMARY:${esc(`1:1 · ${o.titulo}`)}`, `DESCRIPTION:${esc(`${o.organizador_nome ?? ""} e ${o.nome}${o.temas.length ? `\nTemas: ${o.temas.join(", ")}` : ""}\nPauta: ${base}/um-a-um/${o.id}`)}`,
    `STATUS:${o.status === "CANCELADA" ? "CANCELLED" : "CONFIRMED"}`, "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
}

/** Cadência: dias desde a última 1:1 realizada (ou do último acompanhamento registrado) e a próxima marcada, por pessoa. */
export async function cadencia(employeeIds: number[]) {
  if (!employeeIds.length) return new Map<number, { ultima: string | null; proxima: string | null; proximaId: number | null; proximaHora: string | null }>();
  const rows = await sql<{ employee_id: number; ultima: string | null; proxima: string | null; proxima_id: number | null; proxima_hora: string | null }[]>`SELECT e.id AS employee_id,
      greatest((SELECT max(o.data) FROM one_on_ones o WHERE o.employee_id=e.id AND o.status='REALIZADA'), (SELECT max(c.data) FROM perf_checkins c WHERE c.employee_id=e.id AND c.tipo='REUNIAO'))::text AS ultima,
      x.data::text AS proxima, x.id AS proxima_id, x.inicio AS proxima_hora
    FROM employees e LEFT JOIN LATERAL (SELECT o.id, o.data, o.inicio FROM one_on_ones o WHERE o.employee_id=e.id AND o.status='MARCADA' AND o.data >= ${hoje()} ORDER BY o.data, o.inicio LIMIT 1) x ON true
    WHERE e.id = ANY(${employeeIds}::int[])`;
  return new Map(rows.map(r => [r.employee_id, { ultima: r.ultima, proxima: r.proxima, proximaId: r.proxima_id, proximaHora: r.proxima_hora }]));
}
export const diasDesde = (d: string | null, h = hoje()) => (d ? Math.round((Date.parse(h) - Date.parse(d)) / 86400000) : null);

/** Feedbacks que esta pessoa pode ler sobre um colaborador (painel): o próprio vê os enviados a ele; a gestão vê os de gestão e os compartilhados com o gestor direto. */
export function filtroVisibilidade(s: Session, alvo: { id: number; gestorId: number | null }) {
  if (s.employeeId === alvo.id) return (f: { status: string; visibilidade: string; autorUserId: number | null }) => f.status === "ENVIADO";
  const gestorDireto = !!s.employeeId && alvo.gestorId === s.employeeId;
  return (f: { status: string; visibilidade: string; autorUserId: number | null }) => f.status === "ENVIADO" && (f.visibilidade === "GESTAO" || f.autorUserId === s.id || (f.visibilidade === "GESTOR" && gestorDireto));
}
