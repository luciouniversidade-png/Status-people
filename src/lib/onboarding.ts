import { sql } from "@/db";
import type { Session } from "./auth";
import { getSettings, hoje, addDays, audit } from "./utils";

/**
 * Onboarding 30-60-90 (T-072 · Nova Arquitetura / Bíblia do RH): plano por pessoa a partir do modelo do cargo (Configurações → onboarding),
 * marcos de 7/30/60/90 dias com responsável, buddy, trilha da Academy e a pesquisa do novato — atraso visível antes de virar frustração.
 */
export const MARCOS = [7, 30, 60, 90] as const;
export const RESP_ONB: Record<string, string> = { RH: "RH", GESTOR: "Gestor", BUDDY: "Buddy", NOVATO: "Novato" };
export const TIPO_ONB: Record<string, string> = { TAREFA: "Tarefa", TRILHA: "Trilha", CHECKIN: "Check-in", PESQUISA: "Pesquisa do novato" };

/** Progresso do plano (itens concluídos ÷ itens) e atraso (itens vencidos não concluídos). */
export function progressoPlano(itens: { prazo: string; concluido_em: string | null }[], h: string) {
  const total = itens.length, ok = itens.filter(i => i.concluido_em).length; const atrasados = itens.filter(i => !i.concluido_em && i.prazo < h).length;
  const proximo = itens.filter(i => !i.concluido_em).sort((a, b) => a.prazo.localeCompare(b.prazo))[0] ?? null;
  return { total, ok, pct: total ? Math.round((100 * ok) / total) : null, atrasados, proximo };
}
/** Estado de cada marco (para a linha do tempo C13). */
export function estadoMarcos(itens: { marco: number; prazo: string; concluido_em: string | null }[], h: string) {
  return MARCOS.map(m => { const xs = itens.filter(i => i.marco === m); const feitos = xs.every(i => i.concluido_em); const vencido = xs.some(i => !i.concluido_em && i.prazo < h); const prazo = xs[0]?.prazo ?? null; return { marco: m, total: xs.length, feitos: xs.filter(i => i.concluido_em).length, estado: (xs.length && feitos ? "COMPLETED" : vencido ? "LATE" : prazo && prazo <= addDays(h, 7) ? "CURRENT" : "PENDING") as "COMPLETED" | "LATE" | "CURRENT" | "PENDING", prazo }; });
}

/** Cria o plano do novato a partir do modelo (idempotente: se já existe, devolve o existente). */
export async function criarPlanoOnboarding(employeeId: number, s: Session | null) {
  const [ja] = await sql<{ id: number }[]>`SELECT id FROM onboarding_plans WHERE employee_id=${employeeId}`; if (ja) return ja.id;
  const [e] = await sql<{ admissao: string; unit_id: number; gestor_id: number | null }[]>`SELECT admissao::text, unit_id, gestor_id FROM employees WHERE id=${employeeId}`; if (!e) throw new Error("Colaborador não encontrado.");
  const cfg = await getSettings();
  const [g] = e.gestor_id ? await sql<{ id: number }[]>`SELECT id FROM users WHERE employee_id=${e.gestor_id} AND ativo LIMIT 1` : [];
  const [d] = g ? [g] : await sql<{ id: number }[]>`SELECT id FROM users WHERE ativo AND role='DIRETOR_UNIDADE' AND unit_id=${e.unit_id} ORDER BY id LIMIT 1`;
  const [p] = await sql<{ id: number }[]>`INSERT INTO onboarding_plans (employee_id, inicio, gestor_user_id, created_by) VALUES (${employeeId}, ${e.admissao}, ${d?.id ?? null}, ${s?.id ?? null}) ON CONFLICT (employee_id) DO NOTHING RETURNING id`;
  if (!p) { const [x] = await sql<{ id: number }[]>`SELECT id FROM onboarding_plans WHERE employee_id=${employeeId}`; return x.id; }
  let ordem = 0;
  for (const it of cfg.onboarding.modelo as { marco: number; titulo: string; tipo: string; responsavel: string }[]) await sql`INSERT INTO onboarding_items (plan_id, marco, titulo, tipo, responsavel, prazo, ordem) VALUES (${p.id}, ${it.marco}, ${it.titulo}, ${it.tipo}, ${it.responsavel}, ${addDays(e.admissao, it.marco)}, ${ordem++})`;
  await audit(s, "criar plano de onboarding", "onboarding_plans", p.id, null, { employeeId });
  return p.id;
}

export type PlanoRow = { id: number; employee_id: number; nome: string; unidade: string; unit_id: number; cargo: string | null; area: string | null; inicio: string; status: string; gestor: string | null; buddy: string | null; total: number; ok: number; atrasados: number; proximo_prazo: string | null; proximo_titulo: string | null; nota_media: number | null };
export async function planosOnboarding(unitId: number | null, incluirConcluidos = false) {
  const h = hoje();
  return sql<PlanoRow[]>`SELECT p.id, p.employee_id, e.nome, u.nome AS unidade, e.unit_id, po.nome AS cargo, po.area, p.inicio::text, p.status, ug.nome AS gestor, b.nome AS buddy,
      (SELECT count(*) FROM onboarding_items i WHERE i.plan_id=p.id)::int AS total, (SELECT count(*) FROM onboarding_items i WHERE i.plan_id=p.id AND i.concluido_em IS NOT NULL)::int AS ok,
      (SELECT count(*) FROM onboarding_items i WHERE i.plan_id=p.id AND i.concluido_em IS NULL AND i.prazo < ${h})::int AS atrasados,
      (SELECT i.prazo::text FROM onboarding_items i WHERE i.plan_id=p.id AND i.concluido_em IS NULL ORDER BY i.prazo, i.ordem LIMIT 1) AS proximo_prazo,
      (SELECT i.titulo FROM onboarding_items i WHERE i.plan_id=p.id AND i.concluido_em IS NULL ORDER BY i.prazo, i.ordem LIMIT 1) AS proximo_titulo,
      (SELECT avg(nota)::float FROM onboarding_surveys s WHERE s.plan_id=p.id) AS nota_media
    FROM onboarding_plans p JOIN employees e ON e.id=p.employee_id JOIN units u ON u.id=e.unit_id LEFT JOIN positions po ON po.id=e.position_id LEFT JOIN users ug ON ug.id=p.gestor_user_id LEFT JOIN employees b ON b.id=p.buddy_employee_id
    WHERE ${incluirConcluidos ? sql`true` : sql`p.status='EM_ANDAMENTO'`} ${unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`} ORDER BY (SELECT count(*) FROM onboarding_items i WHERE i.plan_id=p.id AND i.concluido_em IS NULL AND i.prazo < ${h}) DESC, p.inicio DESC`;
}
/** Quem pode mexer no plano: RH/Direção; o gestor do plano; o diretor da unidade; o buddy e o novato só nos itens deles. */
export async function papelNoPlano(s: Session, planId: number) {
  const [p] = await sql<{ employee_id: number; gestor_user_id: number | null; buddy_employee_id: number | null; unit_id: number }[]>`SELECT p.employee_id, p.gestor_user_id, p.buddy_employee_id, e.unit_id FROM onboarding_plans p JOIN employees e ON e.id=p.employee_id WHERE p.id=${planId}`;
  if (!p) return null;
  const papeis = new Set<string>();
  if (["RH", "DIRECAO"].includes(s.role)) papeis.add("RH");
  if (p.gestor_user_id === s.id || (s.role === "DIRETOR_UNIDADE" && s.unitId === p.unit_id)) papeis.add("GESTOR");
  if (s.employeeId && s.employeeId === p.buddy_employee_id) papeis.add("BUDDY");
  if (s.employeeId && s.employeeId === p.employee_id) papeis.add("NOVATO");
  return { ...p, papeis };
}
