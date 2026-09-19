import { sql } from "@/db";
import { hoje, getSettings } from "./utils";

export const CASE_TIPOS = ["SOLICITACAO", "DUVIDA", "RECLAMACAO", "ELOGIO", "FINANCEIRO", "PEDAGOGICO", "SAIDA", "OUTRO"] as const;
export const CASE_TIPO_LABEL: Record<string, string> = { SOLICITACAO: "Solicitação", DUVIDA: "Dúvida", RECLAMACAO: "Reclamação", ELOGIO: "Elogio", FINANCEIRO: "Financeiro", PEDAGOGICO: "Pedagógico", SAIDA: "Pedido de saída / transferência", OUTRO: "Outro" };
export const CASE_STATUS: Record<string, string> = { ABERTO: "Aberto", EM_ATENDIMENTO: "Em atendimento", AGUARDANDO_FAMILIA: "Aguardando família", RESOLVIDO: "Resolvido", FECHADO: "Fechado", REABERTO: "Reaberto" };
export const CASE_PRIO: Record<string, string> = { BAIXA: "Baixa", NORMAL: "Normal", ALTA: "Alta", URGENTE: "Urgente" };
export const CANAIS = ["WHATSAPP", "TELEFONE", "PRESENCIAL", "EMAIL", "PORTAL", "REDES"] as const;
export const CANAL_LABEL: Record<string, string> = { WHATSAPP: "WhatsApp", TELEFONE: "Telefone", PRESENCIAL: "Presencial", EMAIL: "E-mail", PORTAL: "Portal/app", REDES: "Redes sociais" };
export const ABERTOS = ["ABERTO", "EM_ATENDIMENTO", "AGUARDANDO_FAMILIA", "REABERTO"];

export async function slaAte(prioridade: string, from = new Date()) {
  const cfg = await getSettings(); const h = (cfg.atendimento.slaHoras as Record<string, number>)[prioridade] ?? 48;
  return new Date(from.getTime() + h * 3600000);
}

/** Escala automaticamente os casos abertos com SLA vencido (marca escalado_em uma única vez). */
export async function escalarVencidos() {
  const rows = await sql<{ id: number }[]>`UPDATE cases SET escalado_em=now(), updated_at=now() WHERE status = ANY(${ABERTOS}) AND sla_ate < now() AND escalado_em IS NULL RETURNING id`;
  for (const r of rows) await sql`INSERT INTO case_events (case_id, user_nome, tipo, texto) VALUES (${r.id}, 'sistema', 'ESCALONAMENTO', 'SLA vencido — caso escalado ao diretor da unidade')`;
  return rows.length;
}

export async function estatisticas(unitId: number | null, ini: string, fim: string) {
  const uf = unitId === null ? sql`` : sql`AND c.unit_id=${unitId}`;
  const [[cas], porTipo, porCat, [nps], [csat], [ret]] = await Promise.all([
    sql<{ abertos: number; atrasados: number; escalados: number; resolvidos_periodo: number; tempo_medio_h: number | null; reabertos: number }[]>`SELECT
        count(*) FILTER (WHERE c.status = ANY(${ABERTOS}))::int AS abertos,
        count(*) FILTER (WHERE c.status = ANY(${ABERTOS}) AND c.sla_ate < now())::int AS atrasados,
        count(*) FILTER (WHERE c.status = ANY(${ABERTOS}) AND c.escalado_em IS NOT NULL)::int AS escalados,
        count(*) FILTER (WHERE c.resolvido_em::date BETWEEN ${ini} AND ${fim})::int AS resolvidos_periodo,
        (avg(EXTRACT(EPOCH FROM (c.resolvido_em - c.created_at))/3600) FILTER (WHERE c.resolvido_em::date BETWEEN ${ini} AND ${fim}))::numeric(10,1)::float AS tempo_medio_h,
        count(*) FILTER (WHERE c.status='REABERTO')::int AS reabertos
      FROM cases c WHERE 1=1 ${uf}`,
    sql<{ tipo: string; n: number; abertos: number }[]>`SELECT c.tipo, count(*)::int AS n, count(*) FILTER (WHERE c.status = ANY(${ABERTOS}))::int AS abertos FROM cases c WHERE c.created_at::date BETWEEN ${ini} AND ${fim} ${uf} GROUP BY c.tipo ORDER BY n DESC`,
    sql<{ categoria: string; n: number; graves: number }[]>`SELECT coalesce(c.categoria,'(sem categoria)') AS categoria, count(*)::int AS n, count(*) FILTER (WHERE c.gravidade=3)::int AS graves FROM cases c WHERE c.tipo='RECLAMACAO' AND c.created_at::date BETWEEN ${ini} AND ${fim} ${uf} GROUP BY 1 ORDER BY n DESC`,
    sql<{ n: number; promotores: number; detratores: number; nps: number | null }[]>`SELECT count(*)::int AS n, count(*) FILTER (WHERE s.nota >= 9)::int AS promotores, count(*) FILTER (WHERE s.nota <= 6)::int AS detratores,
        CASE WHEN count(*)>0 THEN round(100.0*(count(*) FILTER (WHERE s.nota >= 9) - count(*) FILTER (WHERE s.nota <= 6))/count(*)) ELSE NULL END::int AS nps
      FROM surveys s WHERE s.tipo='NPS' AND s.data BETWEEN ${ini} AND ${fim} ${unitId === null ? sql`` : sql`AND s.unit_id=${unitId}`}`,
    sql<{ n: number; media: number | null }[]>`SELECT count(*)::int AS n, round(avg(s.nota),2)::float AS media FROM surveys s WHERE s.tipo='CSAT' AND s.data BETWEEN ${ini} AND ${fim} ${unitId === null ? sql`` : sql`AND s.unit_id=${unitId}`}`,
    sql<{ abertos: number; retidos: number; perdidos: number }[]>`SELECT count(*) FILTER (WHERE c.status = ANY(${ABERTOS}))::int AS abertos, count(*) FILTER (WHERE c.resultado='RETIDO' AND c.updated_at::date BETWEEN ${ini} AND ${fim})::int AS retidos, count(*) FILTER (WHERE c.resultado='PERDIDO' AND c.updated_at::date BETWEEN ${ini} AND ${fim})::int AS perdidos FROM cases c WHERE c.tipo='SAIDA' ${uf}`,
  ]);
  return { cas, porTipo, porCat, nps, csat, ret };
}

export type Fator = { peso: number; texto: string };
export type Risco = { studentId: number; nome: string; unidade: string; unitId: number; serie: string | null; responsavel: string | null; telefone: string | null; pontos: number; nivel: "ALTO" | "MEDIO" | "BAIXO"; fatores: Fator[] };

/** Score de risco de saída — regras explícitas (cada ponto tem um motivo). Só alunos da rede. */
export async function riscoFamilias(unitId: number | null): Promise<Risco[]> {
  const cfg = await getSettings(); const h = hoje(); const ano = cfg.matriculas.anoLetivo; const aposRematricula = h >= cfg.atendimento.riscoRematriculaApos;
  const rows = await sql<{ id: number; nome: string; unidade: string; unit_id: number; serie: string | null; responsavel: string | null; telefone: string | null; inadimplente: boolean; risco_obs: string | null;
    saida_aberta: number; recl_abertas: number; recl_graves_90: number; casos_atrasados: number; nps_detrator: number; nps_ultima: number | null; sem_rematricula: boolean; elogios_90: number }[]>`
    SELECT st.id, st.nome, u.nome AS unidade, st.unit_atual_id AS unit_id, g.nome AS serie, st.responsavel, st.telefone, st.inadimplente, st.risco_obs,
      (SELECT count(*) FROM cases c WHERE c.student_id=st.id AND c.tipo='SAIDA' AND c.status = ANY(${ABERTOS}))::int AS saida_aberta,
      (SELECT count(*) FROM cases c WHERE c.student_id=st.id AND c.tipo='RECLAMACAO' AND c.status = ANY(${ABERTOS}))::int AS recl_abertas,
      (SELECT count(*) FROM cases c WHERE c.student_id=st.id AND c.tipo='RECLAMACAO' AND c.gravidade=3 AND c.created_at > now() - interval '90 days')::int AS recl_graves_90,
      (SELECT count(*) FROM cases c WHERE c.student_id=st.id AND c.status = ANY(${ABERTOS}) AND c.sla_ate < now())::int AS casos_atrasados,
      (SELECT count(*) FROM surveys s WHERE s.student_id=st.id AND s.tipo='NPS' AND s.nota <= 6 AND s.data > ${h}::date - 180)::int AS nps_detrator,
      (SELECT s.nota FROM surveys s WHERE s.student_id=st.id AND s.tipo='NPS' ORDER BY s.data DESC LIMIT 1) AS nps_ultima,
      NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id=st.id AND e.ano=${ano} AND e.modalidade='REGULAR' AND (e.status='CONFIRMADA' OR (e.status='RESERVADA' AND e.reserva_ate >= ${h}))) AS sem_rematricula,
      (SELECT count(*) FROM cases c WHERE c.student_id=st.id AND c.tipo='ELOGIO' AND c.created_at > now() - interval '90 days')::int AS elogios_90
    FROM students st LEFT JOIN units u ON u.id=st.unit_atual_id LEFT JOIN grades g ON g.id=st.serie_atual_id
    WHERE st.aluno_atual ${unitId === null ? sql`` : sql`AND st.unit_atual_id=${unitId}`}`;
  const out: Risco[] = [];
  for (const r of rows) {
    const f: Fator[] = [];
    if (r.saida_aberta) f.push({ peso: 50, texto: "pedido de saída em aberto" });
    if (r.recl_abertas) f.push({ peso: 30, texto: `${r.recl_abertas} reclamação(ões) em aberto` });
    if (r.recl_graves_90) f.push({ peso: 15, texto: "reclamação grave nos últimos 90 dias" });
    if (r.casos_atrasados) f.push({ peso: 20, texto: `${r.casos_atrasados} caso(s) com SLA vencido` });
    if (r.nps_detrator) f.push({ peso: 25, texto: `NPS detrator (nota ${r.nps_ultima})` });
    if (r.inadimplente) f.push({ peso: 25, texto: "inadimplência registrada" });
    if (aposRematricula && r.sem_rematricula) f.push({ peso: 20, texto: `sem reserva/matrícula ${ano}` });
    if (r.risco_obs) f.push({ peso: 15, texto: `observação: ${r.risco_obs}` });
    if (r.elogios_90) f.push({ peso: -10, texto: "elogio recente" });
    const pontos = Math.max(0, f.reduce((a, x) => a + x.peso, 0));
    if (pontos === 0) continue;
    out.push({ studentId: r.id, nome: r.nome, unidade: r.unidade ?? "—", unitId: r.unit_id, serie: r.serie, responsavel: r.responsavel, telefone: r.telefone, pontos, nivel: pontos >= 50 ? "ALTO" : pontos >= 25 ? "MEDIO" : "BAIXO", fatores: f });
  }
  return out.sort((a, b) => b.pontos - a.pontos);
}
