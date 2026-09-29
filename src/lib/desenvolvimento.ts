import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { scopeUnit, type Session } from "@/lib/auth";

export const GESTAO_ROLES = ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR"];
export const RH_ROLES = ["DIRECAO", "RH"];
/** Acesso para ações de desenvolvimento: o próprio (quando permitido); RH/Direção e diretor no escopo; gestor só na equipe vinculada. Validado no servidor. */
export async function acessoColaborador(s: Session, employeeId: number, permitirProprio = false) {
  const [e] = await db.select().from(schema.employees).where(eq(schema.employees.id, employeeId)); if (!e) throw new Error("Colaborador não encontrado.");
  if (s.employeeId === employeeId) { if (!permitirProprio) throw new Error("Esta ação cabe à gestão, não ao próprio colaborador."); return { e, proprio: true }; }
  if (!GESTAO_ROLES.includes(s.role)) throw new Error("Sem permissão para este colaborador.");
  const u = scopeUnit(s); if (u !== null && u !== e.unitId) throw new Error("Colaborador fora do seu escopo de unidade.");
  if (s.role === "GESTOR" && e.gestorId !== s.employeeId) throw new Error("Gestor atua apenas na equipe vinculada a ele.");
  return { e, proprio: false };
}
export type PerfilCargo = { id: number; titulo: string; versao: number; status: string; nivel: string | null; familia: string | null; position_id: number | null; vigencia_inicio: string | null; vigencia_fim: string | null; finalidade: string | null; responsabilidades: string[] | null; entregas: string[] | null; competencias: { nome: string; nivel: number; descricao: string | null }[] | null; comportamentos: string[] | null; evidencias: string[] | null; condicoes: string[] | null };
/** Perfil de expectativas vigente para o cargo (específico do cargo tem precedência sobre o da família). */
export async function perfilVigente(positionId: number | null): Promise<PerfilCargo | null> {
  if (!positionId) return null;
  const [r] = await sql<PerfilCargo[]>`SELECT rp.id, rp.titulo, rp.versao, rp.status, rp.nivel, rp.familia, rp.position_id, rp.vigencia_inicio::text, rp.vigencia_fim::text, rp.finalidade, rp.responsabilidades, rp.entregas, rp.competencias, rp.comportamentos, rp.evidencias, rp.condicoes FROM role_profiles rp, positions p WHERE p.id=${positionId} AND rp.status='VIGENTE' AND (rp.position_id=p.id OR (rp.position_id IS NULL AND rp.familia=p.familia)) ORDER BY (rp.position_id IS NOT NULL) DESC, rp.versao DESC LIMIT 1`;
  return r ?? null;
}

/** Alertas diários do desempenho (idempotentes por chave diária). Espera institucional nunca é tratada como atraso. */
export async function alertasDesempenho(hojeIso: string) {
  const { notificar } = await import("@/lib/comunicacao"); let n = 0; const d = hojeIso;
  const prazos = await sql<{ id: number; user_id: number; nome: string; ciclo: string; prazo: string }[]>`SELECT r.id, r.avaliador_user_id AS user_id, e.nome, c.nome AS ciclo, c.prazo_avaliacao::text AS prazo FROM perf_reviews r JOIN perf_cycles c ON c.id=r.cycle_id JOIN employees e ON e.id=r.employee_id WHERE c.fase='AVALIACAO' AND r.estado='RASCUNHO' AND r.avaliador_user_id IS NOT NULL AND c.prazo_avaliacao IS NOT NULL AND c.prazo_avaliacao - ${d}::date BETWEEN 0 AND 3`;
  for (const p of prazos) { await notificar([p.user_id], `Prazo da avaliação de ${p.nome} em ${p.prazo.split("-").reverse().join("/")}`, p.ciclo, `/desempenho/avaliacoes/${p.id}`, "ACAO", `prazo-av:${p.id}:${d}`); n++; }
  const atrasadas = await sql<{ id: number; resp: number | null; gestor: number | null; employee_id: number; descricao: string }[]>`SELECT a.id, a.responsavel_user_id AS resp, ug.id AS gestor, p.employee_id, a.descricao FROM pdi_actions a JOIN pdi_plans p ON p.id=a.plan_id AND p.status='ATIVO' JOIN employees e ON e.id=p.employee_id LEFT JOIN users ug ON ug.employee_id=e.gestor_id AND ug.ativo WHERE a.status IN ('NAO_INICIADA','EM_ANDAMENTO') AND a.prazo < ${d}`;
  for (const a of atrasadas) { await notificar([a.resp ?? 0, a.gestor ?? 0], "Ação de PDI passou do prazo", a.descricao, `/colaboradores/${a.employee_id}/painel?aba=pdi`, "ALERTA", `pdi-atraso:${a.id}:${d.slice(0, 7)}`); n++; }
  const validar = await sql<{ id: number; gestor: number | null; employee_id: number; descricao: string }[]>`SELECT a.id, coalesce(p.validado_por, ug.id) AS gestor, p.employee_id, a.descricao FROM pdi_actions a JOIN pdi_plans p ON p.id=a.plan_id JOIN employees e ON e.id=p.employee_id LEFT JOIN users ug ON ug.employee_id=e.gestor_id AND ug.ativo WHERE a.status='AGUARDANDO_VALIDACAO'`;
  for (const a of validar) { await notificar([a.gestor ?? 0], "Ação de PDI aguardando sua validação", a.descricao, `/colaboradores/${a.employee_id}/painel?aba=pdi`, "ACAO", `pdi-validar:${a.id}:${d.slice(0, 7)}`); n++; }
  const semCiencia = await sql<{ id: number; user_id: number; employee_id: number; ciclo: string }[]>`SELECT r.id, u.id AS user_id, r.employee_id, c.nome AS ciclo FROM perf_reviews r JOIN perf_cycles c ON c.id=r.cycle_id JOIN users u ON u.employee_id=r.employee_id AND u.ativo WHERE r.estado='PUBLICADA' AND r.ciencia_em IS NULL AND r.publicada_em < now() - interval '7 days'`;
  for (const r of semCiencia) { await notificar([r.user_id], "Seu resultado de desempenho está publicado", `Ciclo ${r.ciclo}: veja e registre ciência (ciência não é concordância).`, `/colaboradores/${r.employee_id}/painel?aba=avaliacoes`, "ACAO", `ciencia:${r.id}`); n++; }
  const comp = await sql<{ id: number; employee_id: number; uc: number | null; ug: number | null }[]>`SELECT k.id, k.employee_id, uc.id AS uc, ug.id AS ug FROM perf_checkins k JOIN employees e ON e.id=k.employee_id LEFT JOIN users uc ON uc.employee_id=e.id AND uc.ativo LEFT JOIN users ug ON ug.employee_id=e.gestor_id AND ug.ativo WHERE k.compromisso_prazo < ${d} AND k.compromisso_cumprido IS NULL`;
  for (const k of comp) { await notificar([k.uc ?? 0, k.ug ?? 0], "Compromisso de acompanhamento vencido", "Registre se foi cumprido.", `/colaboradores/${k.employee_id}/painel?aba=acompanhamento`, "ACAO", `comp:${k.id}`); n++; }
  const needs = await sql<{ id: number; resp: number | null; acao: string | null }[]>`SELECT id, responsavel_user_id AS resp, acao FROM dev_needs WHERE status IN ('ABERTO','EM_ANDAMENTO') AND prazo < ${d}`;
  for (const x of needs) { await notificar([x.resp ?? 0], "Encaminhamento de desenvolvimento atrasado", x.acao, "/desempenho/lideranca#encaminhamentos", "ALERTA", `need-atraso:${x.id}:${d.slice(0, 7)}`); n++; }
  return { alertasDesempenho: n };
}
