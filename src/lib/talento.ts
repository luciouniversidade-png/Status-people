import { sql } from "@/db";
import { getSettings } from "./utils";

export const MOTIVO_SAL: Record<string, string> = { ADMISSAO: "Admissão", PROMOCAO: "Promoção", MERITO: "Mérito", ENQUADRAMENTO: "Enquadramento na faixa", DISSIDIO: "Dissídio / reajuste coletivo", AJUSTE: "Ajuste" };
export const REV_STATUS: Record<string, string> = { PENDENTE: "Pendente", AUTOAVALIADA: "Autoavaliação feita", AVALIADA: "Avaliada pelo gestor", CALIBRADA: "Calibrada", CONCLUIDA: "Concluída" };
export const CYCLE_STATUS: Record<string, string> = { PLANEJADO: "Planejado", ABERTO: "Aberto", CALIBRACAO: "Em calibração", ENCERRADO: "Encerrado" };
export const GOAL_STATUS: Record<string, string> = { EM_ANDAMENTO: "Em andamento", ATINGIDA: "Atingida", PARCIAL: "Parcial", NAO_ATINGIDA: "Não atingida" };
export const REQ_STATUS: Record<string, string> = { SOLICITADA: "Aguardando aprovação", APROVADA: "Aprovada", ABERTA: "Aberta (em seleção)", PREENCHIDA: "Preenchida", CANCELADA: "Cancelada" };
export const REQ_TIPO: Record<string, string> = { SUBSTITUICAO: "Substituição", AUMENTO_QUADRO: "Aumento de quadro", NOVO_CARGO: "Novo cargo" };
export const ETAPA_LABEL: Record<string, string> = { TRIAGEM: "Triagem", ENTREVISTA_RH: "Entrevista RH", TESTE: "Teste / dinâmica", ENTREVISTA_GESTOR: "Entrevista gestor", PROPOSTA: "Proposta", CONTRATADO: "Contratado", REPROVADO: "Reprovado", DESISTIU: "Desistiu" };
export const ORIGEM_CAND: Record<string, string> = { INDICACAO: "Indicação", SITE: "Site", LINKEDIN: "LinkedIn", BANCO_TALENTOS: "Banco de talentos", OUTRO: "Outro" };
export const NIVEL_LABEL = ["", "Baixo", "Médio", "Alto"];

export const fmtBRL = (v: number | string | null | undefined) => v === null || v === undefined || v === "" ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Tabela de cargos com faixa, ocupação, salário médio, compa-ratio e alertas de equidade. */
export async function tabelaCargos(unitId: number | null) {
  const cfg = await getSettings();
  const rows = await sql<{ id: number; nome: string; area: string; grade: string | null; grade_id: number | null; minimo: number | null; medio: number | null; maximo: number | null; pontos: number | null; ocupantes: number; sal_medio: number | null; sal_min: number | null; sal_max: number | null; abaixo: number; acima: number }[]>`
    SELECT p.id, p.nome, p.area, g.codigo AS grade, p.grade_id, g.minimo::float, g.medio::float, g.maximo::float, p.pontos,
      count(e.id)::int AS ocupantes, avg(e.salario)::float AS sal_medio, min(e.salario)::float AS sal_min, max(e.salario)::float AS sal_max,
      count(e.id) FILTER (WHERE g.id IS NOT NULL AND e.salario < g.minimo)::int AS abaixo, count(e.id) FILTER (WHERE g.id IS NOT NULL AND e.salario > g.maximo)::int AS acima
    FROM positions p LEFT JOIN salary_grades g ON g.id=p.grade_id
    LEFT JOIN employees e ON e.position_id=p.id AND e.situacao <> 'DESLIGADO' AND e.salario IS NOT NULL ${unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`}
    GROUP BY p.id, g.id ORDER BY p.ordem, p.nome`;
  // equidade: mesmo cargo + mesmo nível com dispersão acima do limite
  const disp = await sql<{ position_id: number; nivel: string | null; n: number; min: number; max: number }[]>`SELECT e.position_id, e.nivel, count(*)::int AS n, min(e.salario)::float AS min, max(e.salario)::float AS max FROM employees e WHERE e.situacao <> 'DESLIGADO' AND e.salario IS NOT NULL AND e.position_id IS NOT NULL ${unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`} GROUP BY e.position_id, e.nivel HAVING count(*) > 1`;
  const alertas = disp.filter(d => d.min > 0 && (d.max - d.min) / d.min * 100 > cfg.remuneracao.dispersaoAlertaPct).map(d => ({ positionId: d.position_id, nivel: d.nivel ?? "sem nível", n: d.n, pct: Math.round((d.max - d.min) / d.min * 100) }));
  return { rows: rows.map(r => ({ ...r, compa: r.sal_medio && r.medio ? Math.round(100 * r.sal_medio / r.medio) : null })), alertas, cfg };
}

export function gradeSugerida(pontos: number | null, grades: { id: number; codigo: string; pontosMin: number | null; pontosMax: number | null }[]) {
  if (pontos === null) return null;
  return grades.find(g => g.pontosMin !== null && g.pontosMax !== null && pontos >= g.pontosMin! && pontos <= g.pontosMax!) ?? null;
}

export function nivelDesempenho(nota: number | null, cfg: { limiarAlto: number; limiarMedio: number }) {
  if (nota === null) return null; return nota >= cfg.limiarAlto ? 3 : nota >= cfg.limiarMedio ? 2 : 1;
}
export const mediaNotas = (notas: Record<string, number> | undefined | null) => { const v = Object.values(notas ?? {}).map(Number).filter(n => n > 0); return v.length ? Math.round(100 * v.reduce((a, b) => a + b, 0) / v.length) / 100 : null; };

export async function resumoCiclo(cycleId: number) {
  const [tot] = await sql<{ total: number; pendentes: number; auto: number; avaliadas: number; concluidas: number; media: number | null }[]>`SELECT count(*)::int AS total, count(*) FILTER (WHERE status='PENDENTE')::int AS pendentes, count(*) FILTER (WHERE status='AUTOAVALIADA')::int AS auto, count(*) FILTER (WHERE status IN ('AVALIADA','CALIBRADA'))::int AS avaliadas, count(*) FILTER (WHERE status='CONCLUIDA')::int AS concluidas, avg(nota_final)::float AS media FROM perf_reviews WHERE cycle_id=${cycleId}`;
  const boxes = await sql<{ d: number; p: number; n: number }[]>`SELECT desempenho_nivel AS d, potencial AS p, count(*)::int AS n FROM perf_reviews WHERE cycle_id=${cycleId} AND desempenho_nivel IS NOT NULL AND potencial IS NOT NULL GROUP BY 1, 2`;
  return { tot, boxes };
}

export async function funilVagas(unitId: number | null) {
  const uf = unitId === null ? sql`` : sql`AND r.unit_id=${unitId}`;
  const [[v], etapas, [tempo], origens] = await Promise.all([
    sql<{ abertas: number; solicitadas: number; preenchidas_90: number; candidatos_ativos: number }[]>`SELECT count(*) FILTER (WHERE r.status='ABERTA')::int AS abertas, count(*) FILTER (WHERE r.status='SOLICITADA')::int AS solicitadas, count(*) FILTER (WHERE r.status='PREENCHIDA' AND r.fechada_em >= CURRENT_DATE - 90)::int AS preenchidas_90, (SELECT count(*) FROM applications a JOIN requisitions r2 ON r2.id=a.requisition_id WHERE r2.status='ABERTA' AND a.etapa NOT IN ('REPROVADO','DESISTIU','CONTRATADO') ${unitId === null ? sql`` : sql`AND r2.unit_id=${unitId}`})::int AS candidatos_ativos FROM requisitions r WHERE 1=1 ${uf}`,
    sql<{ etapa: string; n: number }[]>`SELECT a.etapa, count(*)::int AS n FROM applications a JOIN requisitions r ON r.id=a.requisition_id WHERE r.status IN ('ABERTA','PREENCHIDA') ${uf} GROUP BY a.etapa`,
    sql<{ dias: number | null }[]>`SELECT avg(r.fechada_em - r.aberta_em)::float AS dias FROM requisitions r WHERE r.status='PREENCHIDA' AND r.aberta_em IS NOT NULL AND r.fechada_em IS NOT NULL ${uf}`,
    sql<{ origem: string; n: number; contratados: number }[]>`SELECT coalesce(c.origem,'OUTRO') AS origem, count(*)::int AS n, count(*) FILTER (WHERE a.etapa='CONTRATADO')::int AS contratados FROM applications a JOIN candidates c ON c.id=a.candidate_id JOIN requisitions r ON r.id=a.requisition_id WHERE 1=1 ${uf} GROUP BY 1 ORDER BY n DESC`,
  ]);
  return { v, etapas, tempoMedio: tempo.dias, origens };
}
