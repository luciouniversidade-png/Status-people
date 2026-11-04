// v31 · 360°: todos os pares avaliador › avaliado de um ciclo (autoavaliação, líder › liderado, pares, liderados avaliando o líder)
// com progresso e situação; sugestão automática de pares (mesmo gestor e mesma unidade) com teto de convites por avaliador.
import { sql } from "@/db";
import type { Criterio } from "./avaliacao";

export const RELACAO_360: Record<string, string> = { AUTO: "Autoavaliação", GESTOR: "Líder › liderado", PAR: "Pares", LIDERADO: "Liderado › líder", OUTRO: "Outra contribuição" };
export const COR_RELACAO: Record<string, string> = { AUTO: "text-slate-600", GESTOR: "text-erro", PAR: "text-aviso", LIDERADO: "text-acao", OUTRO: "text-slate-600" };
export const SIT_360: Record<string, { rotulo: string; tom: string }> = { NAO_INICIADA: { rotulo: "Não iniciada", tom: "REJEITADA" }, ANDAMENTO: { rotulo: "Em andamento", tom: "PENDENTE" }, ENVIADA: { rotulo: "Enviada", tom: "EM_ADMISSAO" }, COMPLETA: { rotulo: "Completa", tom: "APROVADA" } };

export type Par = { chave: string; review_id: number; rater_id: number | null; relacao: string; avaliador: string; avaliador_user_id: number | null; avaliado: string; employee_id: number; unidade: string | null; unit_id: number | null; progresso: number; situacao: keyof typeof SIT_360; removivel: boolean; motivo: string | null };

const contar = (o: unknown) => { const n = (o ?? {}) as Record<string, { nota?: number | null; naoObservado?: boolean; na?: boolean }>; return Object.values(n).filter(x => x && (typeof x.nota === "number" || x.naoObservado || x.na)).length; };

export async function paresDoCiclo(cid: number, unitId: number | null, soDoGestor: number | null = null): Promise<{ pares: Par[]; criterios: Criterio[]; fontes: Record<string, { peso: number; minimo: number }> | null; fase: string }> {
  const [c] = await sql<{ criterios: Criterio[] | null; fontes: Record<string, { peso: number; minimo: number }> | null; fase: string }[]>`SELECT criterios, fontes, fase FROM perf_cycles WHERE id=${cid}`; if (!c) return { pares: [], criterios: [], fontes: null, fase: "" };
  const crit = c.criterios ?? []; const total = Math.max(1, crit.length); const totalExt = Math.max(1, crit.filter(x => x.eixo !== "TECNICA").length);
  const fu = unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`; const fg = soDoGestor === null ? sql`` : sql`AND (e.gestor_id=${soDoGestor} OR e.id=${soDoGestor})`;
  const revs = await sql<{ review_id: number; employee_id: number; nome: string; unidade: string | null; unit_id: number | null; estado: string; status: string; auto_criterios: { notas?: unknown; em?: string } | null; auto: unknown; notas_criterios: unknown; gestor: unknown; avaliador_user_id: number | null; avaliador: string | null }[]>`
    SELECT r.id AS review_id, e.id AS employee_id, e.nome, un.nome AS unidade, e.unit_id, r.estado, r.status, r.auto_criterios, r.auto, r.notas_criterios, r.gestor, r.avaliador_user_id, ua.nome AS avaliador
    FROM perf_reviews r JOIN employees e ON e.id=r.employee_id LEFT JOIN units un ON un.id=e.unit_id LEFT JOIN users ua ON ua.id=r.avaliador_user_id WHERE r.cycle_id=${cid} ${fu} ${fg} ORDER BY e.nome`;
  const raters = revs.length ? await sql<{ id: number; review_id: number; user_id: number; nome: string; grupo: string; status: string; notas: unknown; motivo: string | null }[]>`SELECT rr.id, rr.review_id, rr.user_id, u.nome, rr.grupo, rr.status, rr.notas, rr.motivo FROM review_raters rr JOIN users u ON u.id=rr.user_id WHERE rr.review_id = ANY(${revs.map(r => r.review_id)}::int[]) ORDER BY rr.grupo, u.nome` : [];
  const porCrit = crit.length > 0; const pares: Par[] = [];
  for (const r of revs) {
    const base = { review_id: r.review_id, employee_id: r.employee_id, avaliado: r.nome, unidade: r.unidade, unit_id: r.unit_id };
    // autoavaliação
    const nA = porCrit ? contar(r.auto_criterios?.notas) : r.auto ? total : 0; const autoOk = porCrit ? !!r.auto_criterios?.em : !!r.auto;
    pares.push({ ...base, chave: `a${r.review_id}`, rater_id: null, relacao: "AUTO", avaliador: r.nome, avaliador_user_id: null, progresso: autoOk ? 100 : Math.min(100, Math.round((100 * nA) / (porCrit ? totalExt : total))), situacao: autoOk ? "ENVIADA" : nA ? "ANDAMENTO" : "NAO_INICIADA", removivel: false, motivo: null });
    // líder › liderado (o avaliador designado)
    const nG = porCrit ? contar(r.notas_criterios) : r.gestor ? total : 0; const fechada = ["PUBLICADA", "CONTESTADA", "INCONCLUSIVA"].includes(r.estado) || r.status === "CONCLUIDA"; const enviada = fechada || ["ENVIADA", "EM_CALIBRACAO"].includes(r.estado) || ["AVALIADA", "CALIBRADA"].includes(r.status);
    pares.push({ ...base, chave: `g${r.review_id}`, rater_id: null, relacao: "GESTOR", avaliador: r.avaliador ?? "sem avaliador designado", avaliador_user_id: r.avaliador_user_id, progresso: enviada ? 100 : Math.min(100, Math.round((100 * nG) / total)), situacao: fechada ? "COMPLETA" : enviada ? "ENVIADA" : nG ? "ANDAMENTO" : "NAO_INICIADA", removivel: false, motivo: null });
    for (const x of raters.filter(y => y.review_id === r.review_id)) {
      const n = contar(x.notas); pares.push({ ...base, chave: `r${x.id}`, rater_id: x.id, relacao: ["PAR", "LIDERADO"].includes(x.grupo) ? x.grupo : "OUTRO", avaliador: x.nome, avaliador_user_id: x.user_id, progresso: x.status === "RESPONDIDO" ? Math.max(1, Math.min(100, Math.round((100 * n) / totalExt))) : 0, situacao: x.status === "RESPONDIDO" ? (fechada ? "COMPLETA" : "ENVIADA") : "NAO_INICIADA", removivel: x.status === "CONVIDADO" && !fechada, motivo: x.motivo });
    }
  }
  return { pares, criterios: crit, fontes: c.fontes, fase: c.fase };
}

export type Sugestao = { review_id: number; employee_id: number; avaliado: string; user_id: number; nome: string; grupo: "PAR" | "LIDERADO"; porque: string };
/**
 * Pares sugeridos (“o 360 sai pronto”): para quem tem menos pares que o alvo, colegas ativos da mesma unidade com acesso ao ONE —
 * primeiro os que têm o mesmo gestor, depois os da mesma área — nunca o próprio gestor nem o avaliador designado, e ninguém acima
 * do teto de convites no ciclo (os com menos convites primeiro). Liderados avaliando o líder, quando o ciclo tem essa fonte.
 */
export async function sugerirPares(cid: number, unitId: number | null, alvo: number, teto: number): Promise<Sugestao[]> {
  const [c] = await sql<{ fontes: Record<string, { peso: number; minimo: number }> | null }[]>`SELECT fontes FROM perf_cycles WHERE id=${cid}`; const f = c?.fontes ?? {};
  const out: Sugestao[] = []; if (!f.PAR && !f.LIDERADO) return out;
  const revs = await sql<{ review_id: number; employee_id: number; nome: string; unit_id: number; gestor_id: number | null; area: string | null; avaliador_user_id: number | null; pares: number }[]>`
    SELECT r.id AS review_id, e.id AS employee_id, e.nome, e.unit_id, e.gestor_id, p.area, r.avaliador_user_id, (SELECT count(*) FROM review_raters rr WHERE rr.review_id=r.id AND rr.grupo='PAR')::int AS pares
    FROM perf_reviews r JOIN employees e ON e.id=r.employee_id LEFT JOIN positions p ON p.id=e.position_id
    WHERE r.cycle_id=${cid} AND r.estado NOT IN ('PUBLICADA','CONTESTADA','INCONCLUSIVA') AND r.status <> 'CONCLUIDA' ${unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`} ORDER BY e.nome`;
  const gente = await sql<{ user_id: number; employee_id: number; nome: string; unit_id: number; gestor_id: number | null; area: string | null }[]>`SELECT DISTINCT ON (e.id) u.id AS user_id, e.id AS employee_id, e.nome, e.unit_id, e.gestor_id, p.area FROM users u JOIN employees e ON e.id=u.employee_id LEFT JOIN positions p ON p.id=e.position_id WHERE u.ativo AND e.situacao IN ('ATIVO','FERIAS') ORDER BY e.id, u.id`;
  const ja = await sql<{ review_id: number; user_id: number }[]>`SELECT rr.review_id, rr.user_id FROM review_raters rr JOIN perf_reviews r ON r.id=rr.review_id WHERE r.cycle_id=${cid}`;
  const carga = new Map<number, number>(); ja.forEach(x => carga.set(x.user_id, (carga.get(x.user_id) ?? 0) + 1));
  const jaTem = (rid: number, uid: number) => ja.some(x => x.review_id === rid && x.user_id === uid) || out.some(x => x.review_id === rid && x.user_id === uid);
  const usar = (s: Sugestao) => { out.push(s); carga.set(s.user_id, (carga.get(s.user_id) ?? 0) + 1); };
  for (const r of revs) {
    if (f.PAR) {
      const falta = Math.max(0, Math.max(alvo, f.PAR.minimo ?? 3) - r.pares);
      const cands = gente.filter(g => g.employee_id !== r.employee_id && g.unit_id === r.unit_id && g.employee_id !== r.gestor_id && g.user_id !== r.avaliador_user_id && g.gestor_id !== r.employee_id && !jaTem(r.review_id, g.user_id) && (carga.get(g.user_id) ?? 0) < teto)
        .map(g => ({ g, peso: (r.gestor_id && g.gestor_id === r.gestor_id ? 0 : 10) + (r.area && g.area === r.area ? 0 : 5) + (carga.get(g.user_id) ?? 0) }))
        .sort((a, b) => a.peso - b.peso || a.g.nome.localeCompare(b.g.nome));
      for (const { g } of cands.slice(0, falta)) usar({ review_id: r.review_id, employee_id: r.employee_id, avaliado: r.nome, user_id: g.user_id, nome: g.nome, grupo: "PAR", porque: r.gestor_id && g.gestor_id === r.gestor_id ? "mesmo gestor" : r.area && g.area === r.area ? "mesma área" : "mesma unidade" });
    }
    if (f.LIDERADO) {
      const lids = gente.filter(g => g.gestor_id === r.employee_id && !jaTem(r.review_id, g.user_id) && (carga.get(g.user_id) ?? 0) < teto).slice(0, 8);
      for (const g of lids) usar({ review_id: r.review_id, employee_id: r.employee_id, avaliado: r.nome, user_id: g.user_id, nome: g.nome, grupo: "LIDERADO", porque: "da equipe direta" });
    }
  }
  return out;
}
