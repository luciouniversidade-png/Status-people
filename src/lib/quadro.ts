import { sql } from "@/db";
import type { Session } from "./auth";
import { getSettings, hoje, addDays, audit } from "./utils";

/**
 * Posições × FTE (T-043 · Nova Arquitetura): a cadeira separada da pessoa. Cada posição é um assento autorizado de um cargo numa unidade,
 * com a jornada prevista; o ocupante é um colaborador. Base do planejamento do quadro e do gate de reposição (T-069 · CRQ-REC-V3-01).
 */
export type StatusPosicao = "PREENCHIDA" | "VAGA_EM_BREVE" | "PREENCHE_EM_BREVE" | "VAGA" | "NAO_AUTORIZADA";
export const STATUS_POSICAO: Record<StatusPosicao, { rotulo: string; tom: "bom" | "atencao" | "ruim" | "neutro" }> = {
  PREENCHIDA: { rotulo: "Preenchida", tom: "bom" }, VAGA_EM_BREVE: { rotulo: "Vaga em breve", tom: "atencao" }, PREENCHE_EM_BREVE: { rotulo: "Preenche em breve", tom: "neutro" },
  VAGA: { rotulo: "Vaga", tom: "ruim" }, NAO_AUTORIZADA: { rotulo: "Aguardando autorização", tom: "neutro" },
};
export const MOTIVOS_GATE: Record<string, string> = { REPOSICAO: "Reposição (saída de alguém)", AUMENTO: "Aumento de quadro", TEMPORARIA: "Cobertura temporária (licença, afastamento)" };
export const ALTERNATIVAS_GATE: Record<string, string> = { CONTRATAR: "Contratar (buy)", REALOCAR: "Realocar alguém de dentro (make)", TEMPORARIO: "Temporário / estagiário (borrow)", TERCEIRIZAR: "Terceirizar o serviço", REDISTRIBUIR: "Redistribuir tarefas / horas" };

/** FTE de uma jornada diária (528 min = 1,0). */
export const fte = (jornadaMin: number | null | undefined, plena = 528) => jornadaMin && plena ? Math.round((jornadaMin / plena) * 100) / 100 : null;

/** Situação da posição pelo ocupante e pela vaga aberta para ela. */
export function statusPosicao(p: { autorizada: boolean; ocupante: { situacao: string; desligamento: string | null; emDesligamento: boolean } | null; vagaAberta: boolean }, h: string): StatusPosicao {
  if (!p.autorizada && !p.ocupante) return "NAO_AUTORIZADA";
  const o = p.ocupante;
  if (o && o.situacao !== "DESLIGADO" && !(o.desligamento && o.desligamento < h)) {
    if (o.situacao === "EM_ADMISSAO") return "PREENCHE_EM_BREVE";
    if (o.emDesligamento || (o.desligamento && o.desligamento >= h)) return "VAGA_EM_BREVE";
    return "PREENCHIDA";
  }
  return p.vagaAberta ? "PREENCHE_EM_BREVE" : "VAGA";
}

export type Posicao = { id: number; position_id: number; cargo: string; area: string; unit_id: number; unidade: string; jornada_min_dia: number; fte: number | null; autorizada: boolean; employee_id: number | null; ocupante: string | null; situacao_ocupante: string | null; desligamento: string | null; em_desligamento: boolean; vaga_id: number | null; vaga_status: string | null; status: StatusPosicao; prevista_ate: string | null; motivo: string | null };
export async function posicoes(unitId: number | null): Promise<Posicao[]> {
  const cfg = await getSettings(); const plena = Number(cfg.quadro.jornadaPlenaMin) || 528; const h = hoje();
  const rows = await sql<Omit<Posicao, "fte" | "status">[]>`SELECT s.id, s.position_id, p.nome AS cargo, p.area, s.unit_id, u.nome AS unidade, s.jornada_min_dia, s.autorizada, s.employee_id, e.nome AS ocupante, e.situacao AS situacao_ocupante, e.desligamento::text,
      EXISTS (SELECT 1 FROM processes pr WHERE pr.employee_id=e.id AND pr.tipo='DESLIGAMENTO' AND pr.status='ABERTO') AS em_desligamento,
      (SELECT r.id FROM requisitions r WHERE r.slot_id=s.id AND r.status IN ('SOLICITADA','ABERTA','PAUSADA') ORDER BY r.id DESC LIMIT 1) AS vaga_id,
      (SELECT r.status FROM requisitions r WHERE r.slot_id=s.id AND r.status IN ('SOLICITADA','ABERTA','PAUSADA') ORDER BY r.id DESC LIMIT 1) AS vaga_status, s.prevista_ate::text, s.motivo
    FROM position_slots s JOIN positions p ON p.id=s.position_id JOIN units u ON u.id=s.unit_id LEFT JOIN employees e ON e.id=s.employee_id
    WHERE s.ativa ${unitId === null ? sql`` : sql`AND s.unit_id=${unitId}`} ORDER BY u.nome, p.area, p.ordem, p.nome, s.id`;
  return rows.map(r => ({ ...r, fte: fte(r.jornada_min_dia, plena), status: statusPosicao({ autorizada: r.autorizada, ocupante: r.employee_id ? { situacao: r.situacao_ocupante ?? "DESLIGADO", desligamento: r.desligamento, emDesligamento: r.em_desligamento } : null, vagaAberta: r.vaga_status === "ABERTA" }, h) }));
}
/** Colaboradores ativos sem posição (precisam de assento: sincronizar o quadro). */
export async function semPosicao(unitId: number | null) {
  return sql<{ id: number; nome: string; unit_id: number; unidade: string; position_id: number | null; cargo: string | null; jornada_min_dia: number | null }[]>`SELECT e.id, e.nome, e.unit_id, u.nome AS unidade, e.position_id, p.nome AS cargo, e.jornada_min_dia FROM employees e JOIN units u ON u.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id
    WHERE e.situacao IN ('ATIVO','FERIAS','AFASTADO','EM_ADMISSAO') ${unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`} AND NOT EXISTS (SELECT 1 FROM position_slots s WHERE s.employee_id=e.id AND s.ativa) ORDER BY u.nome, e.nome`;
}

/**
 * Sincroniza o quadro com as pessoas: cada colaborador sem posição ocupa uma posição livre do mesmo cargo e unidade; sem posição livre,
 * nasce uma nova (autorizada quando quem sincroniza é a Direção; senão, aguardando autorização). Sem cargo, a pessoa fica de fora (corrija o cadastro).
 */
export async function sincronizarQuadro(s: Session, unitId: number | null) {
  const cfg = await getSettings(); const plena = Number(cfg.quadro.jornadaPlenaMin) || 528; const pessoas = await semPosicao(unitId); const autoriza = s.role === "DIRECAO";
  let vinculadas = 0, criadas = 0, semCargo = 0;
  for (const p of pessoas) {
    if (!p.position_id) { semCargo++; continue; }
    const [livre] = await sql<{ id: number }[]>`SELECT s.id FROM position_slots s LEFT JOIN employees e ON e.id=s.employee_id WHERE s.ativa AND s.position_id=${p.position_id} AND s.unit_id=${p.unit_id} AND (s.employee_id IS NULL OR e.situacao='DESLIGADO') ORDER BY s.autorizada DESC, s.id LIMIT 1`;
    if (livre) { await sql`UPDATE position_slots SET employee_id=${p.id}, updated_at=now() WHERE id=${livre.id}`; vinculadas++; }
    else { await sql`INSERT INTO position_slots (position_id, unit_id, jornada_min_dia, autorizada, autorizada_por, autorizada_em, employee_id, motivo, created_by) VALUES (${p.position_id}, ${p.unit_id}, ${p.jornada_min_dia ?? plena}, ${autoriza}, ${autoriza ? s.id : null}, CASE WHEN ${autoriza}::boolean THEN now() END, ${p.id}, 'Quadro atual (sincronização)', ${s.id})`; criadas++; }
  }
  await audit(s, "sincronizar quadro de posições", "position_slots", null, null, { vinculadas, criadas, semCargo, unitId });
  return { vinculadas, criadas, semCargo };
}

/** Resumo para cartões e gráficos (T-043). */
export function resumoQuadro(ps: Posicao[]) {
  const por = (k: StatusPosicao) => ps.filter(p => p.status === k).length;
  const fteAut = ps.filter(p => p.autorizada).reduce((a, p) => a + (p.fte ?? 0), 0); const fteOc = ps.filter(p => p.status === "PREENCHIDA" || p.status === "VAGA_EM_BREVE").reduce((a, p) => a + (p.fte ?? 0), 0);
  const unidades = [...new Set(ps.map(p => p.unidade))].map(u => ({ unidade: u, preenchidas: ps.filter(p => p.unidade === u && (p.status === "PREENCHIDA" || p.status === "VAGA_EM_BREVE")).length, vagas: ps.filter(p => p.unidade === u && (p.status === "VAGA" || p.status === "PREENCHE_EM_BREVE")).length, pendentes: ps.filter(p => p.unidade === u && p.status === "NAO_AUTORIZADA").length }));
  const areas = [...new Set(ps.map(p => p.area))].map(a => ({ area: a, n: ps.filter(p => p.area === a && p.autorizada).length }));
  return { total: ps.length, autorizadas: ps.filter(p => p.autorizada).length, preenchidas: por("PREENCHIDA"), vagas: por("VAGA"), vagaEmBreve: por("VAGA_EM_BREVE"), preencheEmBreve: por("PREENCHE_EM_BREVE"), naoAutorizadas: por("NAO_AUTORIZADA"), fteAutorizado: Math.round(fteAut * 100) / 100, fteOcupado: Math.round(fteOc * 100) / 100, unidades, areas };
}
/** Posições livres para o gate (vaga ou vaga em breve) no escopo. */
export async function posicoesParaGate(unitId: number | null) {
  return (await posicoes(unitId)).filter(p => p.autorizada && (p.status === "VAGA" || p.status === "VAGA_EM_BREVE") && !p.vaga_id);
}
export async function existeQuadro() { const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM position_slots WHERE ativa`; return r.n > 0; }
export const prazoPadraoGate = () => addDays(hoje(), 30);
