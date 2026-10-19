import { sql } from "@/db";
import { hoje, addDays } from "./utils";

/**
 * T-058 · Painel do ciclo + T-059 · Timeline do ciclo (CRQ-PRF-V3): as etapas com janelas de data — nominação → auto → pares → gestor →
 * calibração → publicação — com estado, % de conclusão, pendências nominais e lembretes (máx. 2 por pessoa e etapa; o 2º escala).
 * Mover janela exige motivo e notifica os participantes; fechar etapa e encerrar o ciclo ficam registrados.
 */
export const ETAPAS_CICLO = [
  { chave: "NOMINACAO", nome: "Nominação", descricao: "gestor indica quem contribui (pares, alunos/famílias, outros)" },
  { chave: "AUTO", nome: "Autoavaliação", descricao: "cada colaborador registra a própria avaliação" },
  { chave: "PARES", nome: "Pares e contribuições", descricao: "contribuições convidadas respondidas" },
  { chave: "GESTOR", nome: "Avaliação do gestor", descricao: "avaliação enviada pelo gestor" },
  { chave: "CALIBRACAO", nome: "Calibração", descricao: "comitê calibra e publica" },
  { chave: "PUBLICACAO", nome: "Publicação e ciência", descricao: "colaborador dá ciência do resultado" },
] as const;
export type ChaveEtapa = (typeof ETAPAS_CICLO)[number]["chave"];
export const NOME_ETAPA: Record<string, string> = Object.fromEntries(ETAPAS_CICLO.map(e => [e.chave, e.nome]));
export type EstadoEtapa = "PLANEJADA" | "ABERTA" | "VENCIDA" | "FECHADA";
export const ESTADO_ETAPA: Record<EstadoEtapa, string> = { PLANEJADA: "Planejada", ABERTA: "Aberta", VENCIDA: "Janela vencida", FECHADA: "Fechada" };

/** Estado da etapa no dia: fechada vence tudo; antes do início, planejada; dentro da janela, aberta; depois do fim, vencida. */
export function estadoEtapa(e: { status: string; inicio: string; fim: string }, h: string): EstadoEtapa {
  if (e.status === "FECHADA") return "FECHADA"; if (h < e.inicio) return "PLANEJADA"; if (h <= e.fim) return "ABERTA"; return "VENCIDA";
}
/**
 * Janelas-padrão a partir das datas do ciclo: a fase de avaliação (do início ao prazo de avaliação) é dividida entre nominação, auto,
 * pares e gestor; calibração vai até o prazo de feedback (ou +14 dias); publicação até o fim do ciclo (ou +14 dias).
 */
export function janelasPadrao(c: { inicio: string; fim: string; prazo_avaliacao: string | null; prazo_feedback: string | null }) {
  const h = hoje(); const ini = c.inicio > h ? c.inicio : h; const ava = c.prazo_avaliacao && c.prazo_avaliacao >= ini ? c.prazo_avaliacao : addDays(ini, 28);
  const dias = Math.max(4, Math.round((Date.parse(ava) - Date.parse(ini)) / 86400000)); const q = Math.max(1, Math.floor(dias / 4));
  const nomFim = addDays(ini, q - 1), autoFim = addDays(ini, 2 * q - 1), paresFim = addDays(ini, 3 * q - 1);
  const cal = c.prazo_feedback && c.prazo_feedback > ava ? c.prazo_feedback : addDays(ava, 14); const pub = c.fim > cal ? c.fim : addDays(cal, 14);
  return [
    { etapa: "NOMINACAO", inicio: ini, fim: nomFim }, { etapa: "AUTO", inicio: addDays(nomFim, 1), fim: autoFim }, { etapa: "PARES", inicio: addDays(nomFim, 1), fim: paresFim },
    { etapa: "GESTOR", inicio: addDays(autoFim, 1), fim: ava }, { etapa: "CALIBRACAO", inicio: addDays(ava, 1), fim: cal }, { etapa: "PUBLICACAO", inicio: addDays(cal, 1), fim: pub },
  ];
}
export async function garantirEtapas(cycleId: number) {
  const [c] = await sql<{ inicio: string; fim: string; prazo_avaliacao: string | null; prazo_feedback: string | null }[]>`SELECT inicio::text, fim::text, prazo_avaliacao::text, prazo_feedback::text FROM perf_cycles WHERE id=${cycleId}`; if (!c) return;
  const js = janelasPadrao(c);
  for (const [i, j] of js.entries()) await sql`INSERT INTO perf_cycle_stages (cycle_id, etapa, inicio, fim, ordem) VALUES (${cycleId}, ${j.etapa}, ${j.inicio}, ${j.fim}, ${i}) ON CONFLICT (cycle_id, etapa) DO NOTHING`;
}
export type Etapa = { id: number; cycle_id: number; etapa: string; inicio: string; fim: string; status: string; fechada_em: Date | null; fechada_por: string | null; ordem: number; mudancas: number };
export async function etapasDoCiclo(cycleId: number): Promise<Etapa[]> {
  return sql<Etapa[]>`SELECT s.id, s.cycle_id, s.etapa, s.inicio::text, s.fim::text, s.status, s.fechada_em, u.nome AS fechada_por, s.ordem, (SELECT count(*) FROM perf_stage_changes c WHERE c.stage_id=s.id)::int AS mudancas FROM perf_cycle_stages s LEFT JOIN users u ON u.id=s.fechada_por WHERE s.cycle_id=${cycleId} ORDER BY s.ordem, s.id`;
}

/** Item nominal de uma etapa: quem é avaliado, quem precisa agir e se já fez. */
export type ItemEtapa = { review_id: number; employee_id: number; nome: string; unidade: string | null; unit_id: number | null; area: string | null; responsavel_user_id: number | null; responsavel: string | null; feito: boolean; lembretes: number; escalado: boolean };
const ENVIADA = ["ENVIADA", "EM_CALIBRACAO", "PUBLICADA", "CONTESTADA", "INCONCLUSIVA"];

/** Progresso nominal de todas as etapas do ciclo (uma consulta por etapa, no escopo da unidade quando houver). */
export async function progressoEtapas(cycleId: number, unitId: number | null) {
  const uf = unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`;
  const rem = await sql<{ etapa: string; employee_id: number; n: number; escalado: boolean }[]>`SELECT etapa, employee_id, n, escalado FROM perf_reminders WHERE cycle_id=${cycleId}`;
  const lem = (etapa: string, emp: number) => rem.find(r => r.etapa === etapa && r.employee_id === emp);
  const base = await sql<{ review_id: number; employee_id: number; nome: string; unidade: string | null; unit_id: number | null; area: string | null; avaliador_user_id: number | null; avaliador: string | null; colab_user_id: number | null; colab_user: string | null; estado: string; auto_ok: boolean; raters: number; ciencia: boolean; calibrada: boolean }[]>`
    SELECT r.id AS review_id, e.id AS employee_id, e.nome, un.nome AS unidade, e.unit_id, p.area, r.avaliador_user_id, ua.nome AS avaliador, uc.id AS colab_user_id, uc.nome AS colab_user, r.estado,
      (coalesce(r.auto_criterios->'notas', '{}'::jsonb) <> '{}'::jsonb) AS auto_ok, (SELECT count(*) FROM review_raters rr WHERE rr.review_id=r.id)::int AS raters, (r.ciencia_em IS NOT NULL) AS ciencia, (r.estado IN ('PUBLICADA','CONTESTADA') OR r.calibrado_por IS NOT NULL) AS calibrada
    FROM perf_reviews r JOIN employees e ON e.id=r.employee_id LEFT JOIN units un ON un.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id LEFT JOIN users ua ON ua.id=r.avaliador_user_id LEFT JOIN users uc ON uc.employee_id=e.id AND uc.ativo
    WHERE r.cycle_id=${cycleId} ${uf} ORDER BY e.nome`;
  const pares = await sql<{ review_id: number; employee_id: number; rater_id: number; user_id: number; rater: string; status: string; nome: string; unidade: string | null; unit_id: number | null; area: string | null }[]>`
    SELECT rr.review_id, e.id AS employee_id, rr.id AS rater_id, rr.user_id, u.nome AS rater, rr.status, e.nome, un.nome AS unidade, e.unit_id, p.area FROM review_raters rr JOIN perf_reviews r ON r.id=rr.review_id JOIN employees e ON e.id=r.employee_id JOIN users u ON u.id=rr.user_id LEFT JOIN units un ON un.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id
    WHERE r.cycle_id=${cycleId} ${uf} ORDER BY e.nome, u.nome`;
  const item = (etapa: string, b: (typeof base)[number], resp: number | null, respNome: string | null, feito: boolean): ItemEtapa => { const l = lem(etapa, b.employee_id); return { review_id: b.review_id, employee_id: b.employee_id, nome: b.nome, unidade: b.unidade, unit_id: b.unit_id, area: b.area, responsavel_user_id: resp, responsavel: respNome, feito, lembretes: l?.n ?? 0, escalado: l?.escalado ?? false }; };
  const por: Record<string, ItemEtapa[]> = {
    NOMINACAO: base.map(b => item("NOMINACAO", b, b.avaliador_user_id, b.avaliador, b.raters > 0)),
    AUTO: base.map(b => item("AUTO", b, b.colab_user_id, b.colab_user, b.auto_ok || ENVIADA.includes(b.estado))),
    PARES: pares.map(p => { const l = lem("PARES", p.employee_id); return { review_id: p.review_id, employee_id: p.employee_id, nome: p.nome, unidade: p.unidade, unit_id: p.unit_id, area: p.area, responsavel_user_id: p.user_id, responsavel: p.rater, feito: p.status !== "CONVIDADO", lembretes: l?.n ?? 0, escalado: l?.escalado ?? false }; }),
    GESTOR: base.map(b => item("GESTOR", b, b.avaliador_user_id, b.avaliador, ENVIADA.includes(b.estado))),
    CALIBRACAO: base.filter(b => ENVIADA.includes(b.estado)).map(b => item("CALIBRACAO", b, null, "Comitê de calibração", b.calibrada)),
    PUBLICACAO: base.filter(b => ["PUBLICADA", "CONTESTADA"].includes(b.estado) || b.calibrada).map(b => item("PUBLICACAO", b, b.colab_user_id, b.colab_user, b.ciencia)),
  };
  const resumo = ETAPAS_CICLO.map(e => { const xs = por[e.chave]; const feitos = xs.filter(x => x.feito).length; return { chave: e.chave, nome: e.nome, total: xs.length, feitos, pendentes: xs.length - feitos, pct: xs.length ? (100 * feitos) / xs.length : null }; });
  const estados = { aIniciar: base.filter(b => b.estado === "RASCUNHO" && !b.auto_ok && b.raters === 0).length, andamento: base.filter(b => !["PUBLICADA", "CONTESTADA"].includes(b.estado) && !(b.estado === "RASCUNHO" && !b.auto_ok && b.raters === 0)).length, finalizadas: base.filter(b => ["PUBLICADA", "CONTESTADA"].includes(b.estado)).length, total: base.length };
  return { por, resumo, estados };
}
/** Quebra por unidade/área da etapa (feitos ÷ total). */
export function quebraEtapa(xs: ItemEtapa[], por: "unidade" | "area") {
  const chaves = [...new Set(xs.map(x => (por === "unidade" ? x.unidade : x.area) ?? "—"))];
  return chaves.map(k => { const g = xs.filter(x => ((por === "unidade" ? x.unidade : x.area) ?? "—") === k); const f = g.filter(x => x.feito).length; return { chave: k, feitos: f, total: g.length, pct: g.length ? (100 * f) / g.length : 0 }; }).sort((a, b) => a.pct - b.pct);
}
/** Regra do lembrete (aceite T-058): até 2 por pessoa e etapa; o 2º registra escalonamento ao diretor da área. */
export function proximoLembrete(enviados: number): { permitido: boolean; escala: boolean; n: number } { return { permitido: enviados < 2, escala: enviados + 1 >= 2, n: enviados + 1 }; }
