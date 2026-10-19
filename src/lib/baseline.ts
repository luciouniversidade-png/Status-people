import { sql } from "@/db";

/**
 * T-077 · Gantt com baseline (CRQ-PRJ-V3-01/02): a baseline é o plano aprovado (prazos dos marcos e do projeto) congelado numa versão.
 * Replanejar um marco muda só a data atual — o desvio contra a baseline continua visível — e exige motivo registrado.
 * Uma NOVA baseline só nasce de uma decisão registrada no Decision Log (a primeira é o plano inicial).
 */
export const desvioDias = (baseline: string | null, atual: string | null) => !baseline || !atual ? null : Math.round((Date.parse(`${atual}T00:00:00Z`) - Date.parse(`${baseline}T00:00:00Z`)) / 86400000);
export type MarcoBase = { id: number; titulo: string; prazo: string; baseline_prazo: string | null; concluido_em: string | null; depende_de: number | null; responsavel: string | null; ordem: number };
export async function marcosDoProjeto(projectId: number) {
  return sql<MarcoBase[]>`SELECT m.id, m.titulo, m.prazo::text, m.baseline_prazo::text, m.concluido_em::text, m.depende_de, u.nome AS responsavel, m.ordem FROM milestones m LEFT JOIN users u ON u.id=m.responsavel_user_id WHERE m.project_id=${projectId} ORDER BY m.prazo, m.ordem, m.id`;
}
/** Conflito de dependência: o marco termina antes daquele de que depende. */
export function conflitoDependencia(m: MarcoBase, todos: MarcoBase[]) { const d = m.depende_de ? todos.find(x => x.id === m.depende_de) : null; return d && d.prazo > m.prazo ? d : null; }
/** Início implícito de cada marco no Gantt do projeto: fim do marco de que depende, senão o marco anterior, senão o início do projeto. */
export function inicioDoMarco(m: MarcoBase, todos: MarcoBase[], inicioProjeto: string | null, campo: "prazo" | "baseline_prazo" = "prazo") {
  const dep = m.depende_de ? todos.find(x => x.id === m.depende_de) : null; if (dep && dep[campo]) return dep[campo]!;
  // marcos que dependem deste não servem de início dele (evita a barra começar depois de quem espera por ela)
  const anteriores = todos.filter(x => x.id !== m.id && x.depende_de !== m.id && x[campo] && x[campo]! < (m[campo] ?? m.prazo)).map(x => x[campo]!).sort();
  return anteriores.length ? anteriores[anteriores.length - 1] : inicioProjeto ?? m[campo] ?? m.prazo;
}
export type Baseline = { id: number; versao: number; motivo: string; decision_id: number | null; decisao: string | null; marcos: { inicio: string | null; fim: string | null; itens: { id: number; titulo: string; prazo: string }[] }; user_nome: string | null; created_at: Date };
export async function baselinesDoProjeto(projectId: number) {
  return sql<Baseline[]>`SELECT b.id, b.versao, b.motivo, b.decision_id, d.titulo AS decisao, b.marcos, b.user_nome, b.created_at FROM project_baselines b LEFT JOIN decisions d ON d.id=b.decision_id WHERE b.project_id=${projectId} ORDER BY b.versao DESC`;
}
/** Motivo do último replanejamento de cada marco (trilha de auditoria). */
export async function motivosReplanejamento(ids: number[]) {
  if (!ids.length) return new Map<number, { motivo: string; quem: string | null; em: Date }>();
  const rows = await sql<{ entidade_id: number; depois: { motivo?: string } | null; user_nome: string | null; at: Date }[]>`SELECT DISTINCT ON (entidade_id) entidade_id, depois, user_nome, at FROM audit_log WHERE entidade='milestones' AND acao='replanejar marco' AND entidade_id = ANY(${ids}) ORDER BY entidade_id, at DESC`;
  return new Map(rows.map(r => [r.entidade_id, { motivo: r.depois?.motivo ?? "—", quem: r.user_nome, em: r.at }]));
}
