/**
 * v34 · Termômetro de humor (pulso semanal anônimo): “como foi a sua semana?” de 1 a 5, com até 3 fatores. O banco guarda só
 * contadores por semana × unidade × liderança × nota — nenhuma resposta individual — e a tela mostra um grupo apenas quando ele
 * tem o mínimo de respostas da semana (configurável; padrão 5). Grupo abaixo do mínimo aparece como “poucas respostas”.
 */
import { sql } from "@/db";
import type { Session } from "./auth";
import { scopeUnit } from "./auth";

export const NOTAS: [number, string, string][] = [[1, "😣", "Muito difícil"], [2, "😕", "Difícil"], [3, "😐", "Normal"], [4, "🙂", "Boa"], [5, "😄", "Ótima"]];
/** Segunda-feira da semana da data (as respostas se agrupam por semana). */
export function semanaDe(data: string): string { const d = new Date(`${data}T12:00:00Z`); const dow = d.getUTCDay(); d.setUTCDate(d.getUTCDate() - ((dow + 6) % 7)); return d.toISOString().slice(0, 10); }
export const semanaTxt = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;

/** Quem vê o termômetro: RH e Direção (tudo), direção da unidade (a unidade), gestor(a) (a própria equipe) — sempre agregado. */
export const veHumor = (s: Session) => ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role);
export function filtroHumor(s: Session) {
  if (["RH", "DIRECAO"].includes(s.role)) return sql`true`;
  const u = scopeUnit(s); if (s.role === "DIRETOR_UNIDADE" && u !== null) return sql`c.unit_id=${u}`;
  return sql`c.gestor_id=${s.employeeId ?? -1}`;
}

export type Grupo = { chave: string; nome: string; n: number; media: number | null; dist: number[]; fatoresBaixos: [string, number][]; visivel: boolean; motivo?: string };
/**
 * Agrega uma semana por unidade ou por liderança, escondendo grupos abaixo do mínimo. Na visão por liderança, uma equipe também
 * fica oculta quando o resto da mesma unidade teria menos que o mínimo (senão daria para descobrir as poucas respostas por diferença).
 * A média geral usa só os grupos exibidos, pelo mesmo motivo.
 */
export async function resultadoSemana(s: Session, semana: string, por: "unidade" | "lideranca", minimo: number): Promise<{ grupos: Grupo[]; total: number; mediaGeral: number | null }> {
  const rows = await sql<{ unit_id: number; gestor_id: number; nota: number; n: number }[]>`SELECT c.unit_id, c.gestor_id, c.nota, sum(c.n)::int AS n FROM mood_counts c WHERE c.semana=${semana} AND ${filtroHumor(s)} GROUP BY 1, 2, 3`;
  const fat = await sql<{ unit_id: number; gestor_id: number; fator: string; n: number }[]>`SELECT c.unit_id, c.gestor_id, c.fator, sum(c.n)::int AS n FROM mood_factor_counts c WHERE c.semana=${semana} AND c.nota <= 2 AND ${filtroHumor(s)} GROUP BY 1, 2, 3`;
  const chave = (r: { unit_id: number; gestor_id: number }) => (por === "unidade" ? r.unit_id : r.gestor_id);
  const ids = [...new Set(rows.map(chave))];
  const nomes = new Map<number, string>(por === "unidade"
    ? (await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units WHERE id = ANY(${ids})`).map(r => [r.id, r.nome])
    : (await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM employees WHERE id = ANY(${ids})`).map(r => [r.id, `Equipe de ${r.nome}`]));
  const totUnid = new Map<number, number>(); for (const r of rows) totUnid.set(r.unit_id, (totUnid.get(r.unit_id) ?? 0) + r.n);
  const grupos: Grupo[] = ids.map(k => {
    const rs = rows.filter(r => chave(r) === k); const n = rs.reduce((a, r) => a + r.n, 0); const dist = [1, 2, 3, 4, 5].map(v => rs.filter(r => r.nota === v).reduce((a, r) => a + r.n, 0));
    let visivel = n >= minimo; let motivo = visivel ? undefined : "poucas respostas";
    if (visivel && por === "lideranca") for (const u of new Set(rs.map(r => r.unit_id))) { const resto = (totUnid.get(u) ?? 0) - rs.filter(r => r.unit_id === u).reduce((a, r) => a + r.n, 0); if (resto > 0 && resto < minimo) { visivel = false; motivo = "o resto da unidade tem poucas respostas"; } }
    return { chave: String(k), nome: nomes.get(k) ?? (k === 0 ? (por === "unidade" ? "Sem unidade" : "Sem liderança na ficha") : "—"), n, media: visivel ? rs.reduce((a, r) => a + r.nota * r.n, 0) / n : null, dist: visivel ? dist : [],
      fatoresBaixos: visivel ? Object.entries(fat.filter(f => chave(f) === k).reduce<Record<string, number>>((a, f) => { a[f.fator] = (a[f.fator] ?? 0) + f.n; return a; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 3) : [], visivel, motivo };
  }).sort((a, b) => (a.media ?? 9) - (b.media ?? 9));
  const total = rows.reduce((a, r) => a + r.n, 0); const vis = grupos.filter(g => g.visivel); const nVis = vis.reduce((a, g) => a + g.n, 0);
  return { grupos, total, mediaGeral: nVis >= minimo ? vis.reduce((a, g) => a + (g.media ?? 0) * g.n, 0) / nVis : null };
}

/** Série semanal (últimas N semanas) do escopo da pessoa: só entram as unidades que atingiram o mínimo na semana (sem como deduzir as pequenas). */
export async function serieHumor(s: Session, semanas: number, minimo: number) {
  const porUnidade = s.role !== "GESTOR";
  const rows = await sql<{ semana: string; u: number; n: number; soma: number }[]>`SELECT c.semana::text, ${porUnidade ? sql`c.unit_id` : sql`0`} AS u, sum(c.n)::int AS n, sum(c.n * c.nota)::int AS soma FROM mood_counts c WHERE c.semana >= (current_date - ${semanas * 7}::int) AND ${filtroHumor(s)} GROUP BY 1, 2 ORDER BY 1`;
  const out: { semana: string; n: number; media: number | null }[] = [];
  for (const sem of [...new Set(rows.map(r => r.semana))]) { const ok = rows.filter(r => r.semana === sem && r.n >= minimo); const n = ok.reduce((a, r) => a + r.n, 0); out.push({ semana: sem, n: rows.filter(r => r.semana === sem).reduce((a, r) => a + r.n, 0), media: n >= minimo ? ok.reduce((a, r) => a + r.soma, 0) / n : null }); }
  return out;
}
