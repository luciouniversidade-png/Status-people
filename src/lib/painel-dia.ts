import { sql } from "@/db";
import { hoje, getSettings } from "./utils";
import { rotuloVisivel, type TipoFora } from "./quem-fora";

/**
 * T-048 · Painel do dia (presenças agora): quem está na escola, quem falta e quem atrasou, por unidade — exceções no topo.
 * Fonte: jornada vigente (escala), marcações importadas do relógio (Secullum), férias/afastamentos aprovados, ausências da
 * substituição e o calendário. No-show (escalado sem marcação após a tolerância) vira ação: contato com desfecho que alimenta o dia.
 */
export type Situacao = "SEM_MARCACAO" | "ATRASADO" | "CONTATADO" | "AGUARDANDO" | "PRESENTE" | "FORA" | "FOLGA_DIA";
export const SITUACAO_DIA: Record<Situacao, { rotulo: string; tom: "bom" | "atencao" | "ruim" | "neutro"; ordem: number }> = {
  SEM_MARCACAO: { rotulo: "Sem marcação (no-show)", tom: "ruim", ordem: 0 }, ATRASADO: { rotulo: "Atrasado(a)", tom: "atencao", ordem: 1 }, CONTATADO: { rotulo: "Contato registrado", tom: "neutro", ordem: 2 },
  AGUARDANDO: { rotulo: "Turno ainda não começou", tom: "neutro", ordem: 3 }, PRESENTE: { rotulo: "Presente", tom: "bom", ordem: 4 }, FORA: { rotulo: "Ausência prevista", tom: "neutro", ordem: 5 }, FOLGA_DIA: { rotulo: "Sem jornada hoje", tom: "neutro", ordem: 6 },
};
export const DESFECHOS: Record<string, { rotulo: string; ponto: string | null }> = {
  CHEGOU: { rotulo: "Chegou (atraso combinado)", ponto: null }, A_CAMINHO: { rotulo: "A caminho", ponto: null }, FALTA: { rotulo: "Falta sem aviso", ponto: "FALTA" },
  ATESTADO: { rotulo: "Vai apresentar atestado", ponto: "ATESTADO" }, FOLGA_BANCO: { rotulo: "Folga combinada (banco de horas)", ponto: "FOLGA_BANCO" }, DISPENSA: { rotulo: "Dispensado(a) pela gestão", ponto: "DISPENSA" }, SEM_RESPOSTA: { rotulo: "Sem resposta", ponto: null },
};
const DIAS_TXT = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
const COL_DIA = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;
const hm = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
/** Início do turno do dia a partir do texto livre de horários ("Seg 07:00–12:00 · Ter 13:00–17:48"); sem dia citado, vale o 1º horário; sem nada, o padrão. */
export function inicioDoDia(horarios: string | null, dow: number, padrao: string): string {
  const t = (horarios ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!t.trim()) return padrao;
  const temDia = DIAS_TXT.some(d => new RegExp(`\\b${d}`).test(t));
  if (temDia) { const m = t.match(new RegExp(`\\b${DIAS_TXT[dow]}[a-z.]*[^0-9]{0,12}(\\d{1,2})[:h](\\d{2})`)); if (m) return `${m[1].padStart(2, "0")}:${m[2]}`; const faixa = t.match(new RegExp(`\\bseg[a-z.]*\\s*(?:a|-|–|ate)\\s*sex[a-z.]*[^0-9]{0,12}(\\d{1,2})[:h](\\d{2})`)); if (faixa && dow >= 1 && dow <= 5) return `${faixa[1].padStart(2, "0")}:${faixa[2]}`; return padrao; }
  const m = t.match(/(\d{1,2})[:h](\d{2})/); return m ? `${m[1].padStart(2, "0")}:${m[2]}` : padrao;
}
export const primeiraMarcacao = (marc: string | null) => { const m = (marc ?? "").match(/(\d{1,2}):(\d{2})/); return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null; };
export const turnoDe = (inicio: string) => hm(inicio) < 12 * 60 ? "Manhã" : hm(inicio) < 18 * 60 ? "Tarde" : "Noite";
/** Situação de uma pessoa agora (minutos desde 00:00 no fuso da escola). */
export function situacaoPresenca(p: { esperadoMin: number; fora: boolean; marcacao: string | null; inicio: string; desfecho: string | null }, agoraMin: number, toleranciaMin: number): Situacao {
  if (p.fora) return "FORA"; if (p.esperadoMin <= 0) return "FOLGA_DIA";
  if (p.marcacao) return hm(p.marcacao) > hm(p.inicio) + toleranciaMin ? "ATRASADO" : "PRESENTE";
  if (agoraMin <= hm(p.inicio) + toleranciaMin) return "AGUARDANDO";
  return p.desfecho ? "CONTATADO" : "SEM_MARCACAO";
}
/** Minutos do dia em Campo Grande (UTC−4, sem horário de verão). */
export function agoraLocalMin(d = new Date()) { const t = new Date(d.getTime() - 4 * 3600000); return t.getUTCHours() * 60 + t.getUTCMinutes(); }

export async function painelDia(unitId: number | null, sensivel: boolean) {
  const cfg = await getSettings(); const h = hoje(); const dow = new Date(`${h}T12:00:00Z`).getUTCDay(); const col = COL_DIA[dow];
  const padrao = String(cfg.ponto.inicioPadrao || "07:00"); const tol = Number(cfg.ponto.toleranciaNoShowMin ?? 15);
  const uf = unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`;
  const [pessoas, cal, ult] = await Promise.all([
    sql<{ id: number; nome: string; unit_id: number; unidade: string; cargo: string | null; area: string | null; jornada: number | null; horarios: string | null; licenca: string | null; ausencia: string | null; status: string | null; marcacoes: string | null; desfecho: string | null; contato_em: Date | null; contato_por: string | null }[]>`
      SELECT e.id, e.nome, e.unit_id, u.nome AS unidade, p.nome AS cargo, p.area,
        coalesce(sc.min, CASE WHEN ${dow} BETWEEN 1 AND 5 THEN e.jornada_min_dia ELSE 0 END) AS jornada, sc.horarios,
        (SELECT l.tipo FROM leave_requests l WHERE l.employee_id=e.id AND l.status='APROVADA' AND l.inicio <= ${h}::date AND l.fim >= ${h}::date LIMIT 1) AS licenca,
        (SELECT a.motivo FROM cover_absences a WHERE a.employee_id=e.id AND a.status='ATIVA' AND a.data=${h}::date LIMIT 1) AS ausencia,
        t.status, t.marcacoes, dc.desfecho, dc.created_at AS contato_em, dc.user_nome AS contato_por
      FROM employees e JOIN units u ON u.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id
        LEFT JOIN LATERAL (SELECT ${sql(col)} AS min, horarios FROM schedules s WHERE s.employee_id=e.id AND s.vigencia_inicio <= ${h}::date AND (s.vigencia_fim IS NULL OR s.vigencia_fim >= ${h}::date) ORDER BY s.vigencia_inicio DESC LIMIT 1) sc ON true
        LEFT JOIN timesheet_days t ON t.employee_id=e.id AND t.data=${h}::date
        LEFT JOIN LATERAL (SELECT desfecho, created_at, user_nome FROM daily_contacts d WHERE d.employee_id=e.id AND d.data=${h}::date ORDER BY d.created_at DESC LIMIT 1) dc ON true
      WHERE e.situacao IN ('ATIVO','FERIAS','AFASTADO') AND (e.admissao IS NULL OR e.admissao <= ${h}::date) ${uf} ORDER BY u.nome, p.area NULLS LAST, e.nome`,
    sql<{ tipo: string; unit_id: number | null; publico: string; descricao: string | null }[]>`SELECT tipo, unit_id, publico, descricao FROM calendar_days WHERE data=${h}::date AND tipo IN ('FERIADO','RECESSO','FERIAS_COLETIVAS','NAO_LETIVO')`,
    sql<{ em: Date | null }[]>`SELECT max(updated_at) AS em FROM timesheet_days WHERE origem NOT IN ('MANUAL','AUTO','PAINEL_DIA')`,
  ]);
  const agora = agoraLocalMin();
  const linhas = pessoas.map(p => {
    const folgaCal = cal.find(c => (c.unit_id === null || c.unit_id === p.unit_id) && (c.tipo !== "NAO_LETIVO" || c.publico === "TODOS"));
    const foraTipo: TipoFora | null = p.licenca ? (p.licenca === "FERIAS" ? "FERIAS" : p.licenca === "FOLGA_BANCO" ? "FOLGA" : "AFASTAMENTO") : p.ausencia ? (p.ausencia === "FERIAS" ? "FERIAS" : p.ausencia === "FALTA" ? "FALTA" : p.ausencia === "FORMACAO" ? "FORMACAO" : "OUTRO")
      : p.status && ["FALTA", "ATESTADO", "AFASTADO", "FERIAS", "FOLGA_BANCO", "DISPENSA"].includes(p.status) ? (p.status === "FALTA" ? "FALTA" : p.status === "ATESTADO" ? "ATESTADO" : p.status === "FERIAS" ? "FERIAS" : p.status === "FOLGA_BANCO" ? "FOLGA" : "OUTRO") : null;
    const inicio = inicioDoDia(p.horarios, dow, padrao); const marc = primeiraMarcacao(p.marcacoes);
    const sit = situacaoPresenca({ esperadoMin: folgaCal ? 0 : p.jornada ?? 0, fora: !!foraTipo, marcacao: marc, inicio, desfecho: p.desfecho }, agora, tol);
    return { id: p.id, nome: p.nome, unit_id: p.unit_id, unidade: p.unidade, cargo: p.cargo, area: p.area ?? "Sem área", inicio, turno: turnoDe(inicio), marcacao: marc, marcacoes: p.marcacoes, jornada: p.jornada ?? 0, situacao: sit,
      fora: foraTipo ? rotuloVisivel(foraTipo, sensivel) : null, desfecho: p.desfecho, contatoEm: p.contato_em, contatoPor: p.contato_por, professor: /professor/i.test(p.cargo ?? "") };
  });
  const unidades = [...new Set(linhas.map(l => l.unidade))].map(u => { const xs = linhas.filter(l => l.unidade === u); const n = (k: Situacao) => xs.filter(l => l.situacao === k).length; return { unidade: u, unit_id: xs[0]?.unit_id ?? 0, escalados: xs.filter(l => !["FOLGA_DIA", "FORA"].includes(l.situacao)).length, presentes: n("PRESENTE") + n("ATRASADO"), atrasados: n("ATRASADO"), semMarcacao: n("SEM_MARCACAO"), contatados: n("CONTATADO"), fora: n("FORA"), aguardando: n("AGUARDANDO") }; });
  const ultimas = linhas.filter(l => l.marcacoes).map(l => ({ nome: l.nome, unidade: l.unidade, marcacoes: l.marcacoes!, ultima: (l.marcacoes!.match(/\d{1,2}:\d{2}/g) ?? []).slice(-1)[0] ?? "" })).sort((a, b) => b.ultima.localeCompare(a.ultima)).slice(0, 10);
  return { h, dow, agora, tol, linhas, unidades, ultimas, calendario: cal, dadosAte: ult[0]?.em ?? null };
}
