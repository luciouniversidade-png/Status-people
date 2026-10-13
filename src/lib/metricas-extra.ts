import { sql } from "@/db";
import { hoje, getSettings } from "./utils";
import { etapasJornada, situacaoRitual, somaMeses, type EtapaCfg, type TipoRitual } from "./gestao-calc";

/**
 * Métricas lidas do próprio sistema que alimentam indicadores e KRs (v21).
 * Contagens mensais ("_mes") podem ser calculadas para qualquer mês; as demais são retratos do momento.
 * Funil de captação: números agregados do cadastro de Matrículas — nenhum lead individual (não é CRM).
 */
export const FONTES_EXTRA: Record<string, { nome: string; metrica: string; mensal?: boolean }> = {
  "matriculas.rematricula": { nome: "Alunos atuais com rematrícula para o próximo ano letivo", metrica: "%" },
  "matriculas.candidatos_mes": { nome: "Candidatos cadastrados no mês", metrica: "candidatos", mensal: true },
  "matriculas.reservas_mes": { nome: "Reservas de candidatos feitas no mês", metrica: "reservas", mensal: true },
  "matriculas.novas_mes": { nome: "Matrículas novas confirmadas no mês", metrica: "matrículas", mensal: true },
  "atendimento.jornada": { nome: "Etapas vencidas da jornada da família cumpridas", metrica: "%" },
  "atendimento.contato_recente": { nome: "Famílias com contato registrado no período configurado", metrica: "%" },
  "estrategia.acoes_em_dia": { nome: "Ações do plano em dia", metrica: "%" },
  "estrategia.rituais_em_dia": { nome: "Rituais de gestão em dia", metrica: "%" },
};
export const MENSAIS = new Set(Object.entries(FONTES_EXTRA).filter(([, v]) => v.mensal).map(([k]) => k));
export const ORIGENS_FUNIL = ["INDICACAO", "SITE", "REDES", "VISITA", "OUTRO"];

const intervalo = (periodo: string) => ({ ini: `${periodo}-01`, fim: `${somaMeses(periodo, 1)}-01` });
/** Unidade de um candidato: a atual, senão a da reserva mais recente, senão a da lista de espera. */
const unidadeCandidato = sql`coalesce(st.unit_atual_id, (SELECT c.unit_id FROM enrollments e JOIN classes c ON c.id=e.class_id WHERE e.student_id=st.id ORDER BY e.id DESC LIMIT 1), (SELECT w.unit_id FROM waitlist w WHERE w.student_id=st.id ORDER BY w.id DESC LIMIT 1))`;

/**
 * Quem conta como captação: não é rematrícula declarada e, se já é aluno da rede, teve a origem informada
 * (candidato que virou aluno continua contando no mês em que chegou; alunos importados como rematrícula ficam de fora).
 */
const ehCaptacao = sql`(st.origem IS DISTINCT FROM 'REMATRICULA' AND (NOT st.aluno_atual OR st.origem IS NOT NULL))`;

/**
 * Funil de captação do mês por origem do candidato (Matrículas): candidatos cadastrados, famílias que reservaram e matrículas novas confirmadas.
 * Reserva e matrícula contam o aluno uma vez no mês; quem já tinha matrícula confirmada antes é rematrícula, não captação.
 */
export async function funilPorOrigem(periodo: string, unitId: number | null) {
  const { ini, fim } = intervalo(periodo);
  const [cand, res, mat] = await Promise.all([
    sql<{ origem: string | null; n: number }[]>`SELECT st.origem, count(*)::int AS n FROM students st WHERE ${ehCaptacao} AND st.created_at >= ${ini}::date AND st.created_at < ${fim}::date ${unitId === null ? sql`` : sql`AND ${unidadeCandidato} = ${unitId}`} GROUP BY st.origem`,
    sql<{ origem: string | null; n: number }[]>`SELECT st.origem, count(DISTINCT e.student_id)::int AS n FROM enrollments e JOIN students st ON st.id=e.student_id JOIN classes c ON c.id=e.class_id WHERE ${ehCaptacao} AND e.created_at >= ${ini}::date AND e.created_at < ${fim}::date
      AND NOT EXISTS (SELECT 1 FROM enrollments e0 WHERE e0.student_id=e.student_id AND e0.id <> e.id AND e0.status='CONFIRMADA' AND e0.confirmada_em < e.created_at) ${unitId === null ? sql`` : sql`AND c.unit_id=${unitId}`} GROUP BY st.origem`,
    sql<{ origem: string | null; n: number }[]>`SELECT st.origem, count(DISTINCT e.student_id)::int AS n FROM enrollments e JOIN students st ON st.id=e.student_id JOIN classes c ON c.id=e.class_id WHERE ${ehCaptacao} AND e.status='CONFIRMADA' AND e.confirmada_em >= ${ini}::date AND e.confirmada_em < ${fim}::date
      AND NOT EXISTS (SELECT 1 FROM enrollments e0 WHERE e0.student_id=e.student_id AND e0.id <> e.id AND e0.status='CONFIRMADA' AND e0.confirmada_em < e.confirmada_em) ${unitId === null ? sql`` : sql`AND c.unit_id=${unitId}`} GROUP BY st.origem`,
  ]);
  const chaves = [...new Set([...ORIGENS_FUNIL, ...[...cand, ...res, ...mat].map(r => r.origem ?? "NAO_INFORMADA")])].filter(k => k !== "REMATRICULA");
  const pega = (rows: { origem: string | null; n: number }[], k: string) => rows.filter(r => (r.origem ?? "NAO_INFORMADA") === k).reduce((a, r) => a + r.n, 0);
  const porOrigem = chaves.map(origem => ({ origem, candidatos: pega(cand, origem), reservas: pega(res, origem), matriculas: pega(mat, origem) }));
  const soma = (k: "candidatos" | "reservas" | "matriculas") => porOrigem.reduce((a, r) => a + r[k], 0);
  return { porOrigem, total: { candidatos: soma("candidatos"), reservas: soma("reservas"), matriculas: soma("matriculas") } };
}

/** Uma métrica mensal para qualquer mês (contagens). */
export async function metricaMensal(chave: string, periodo: string, unitId: number | null): Promise<number | null> {
  if (!MENSAIS.has(chave)) return null;
  const f = await funilPorOrigem(periodo, unitId);
  return chave === "matriculas.candidatos_mes" ? f.total.candidatos : chave === "matriculas.reservas_mes" ? f.total.reservas : f.total.matriculas;
}

/** Percentual de alunos atuais com rematrícula (confirmada ou reserva válida) no ano letivo configurado. */
export async function rematricula(unitId: number | null) {
  const cfg = await getSettings(); const h = hoje(); const ano = cfg.matriculas.anoLetivo;
  const [r] = await sql<{ total: number; feitas: number }[]>`SELECT count(*)::int AS total, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id=st.id AND e.ano=${ano} AND e.modalidade='REGULAR' AND (e.status='CONFIRMADA' OR (e.status='RESERVADA' AND e.reserva_ate >= ${h}))))::int AS feitas FROM students st WHERE st.aluno_atual ${unitId === null ? sql`` : sql`AND st.unit_atual_id=${unitId}`}`;
  return { ano, total: r.total, feitas: r.feitas, pct: r.total ? Math.round(1000 * r.feitas / r.total) / 10 : null };
}

/** Jornada da família no ano corrente: etapas já vencidas que foram cumpridas (por família). */
export async function jornadaResumo(unitId: number | null) {
  const cfg = await getSettings(); const h = hoje(); const ano = Number(h.slice(0, 4)); const etapas = cfg.atendimento.jornada as EtapaCfg[];
  const alunos = await sql<{ id: number }[]>`SELECT id FROM students WHERE aluno_atual ${unitId === null ? sql`` : sql`AND unit_atual_id=${unitId}`}`;
  const vencidas = etapasJornada(etapas, ano, new Set(), h).filter(e => e.status === "ATRASADA").map(e => e.chave);
  if (!alunos.length || !vencidas.length) return { ano, esperadas: 0, cumpridas: 0, pct: null as number | null };
  const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM family_journey j WHERE j.ano=${ano} AND j.etapa = ANY(${vencidas}) AND j.student_id = ANY(${alunos.map(a => a.id)})`;
  const esperadas = alunos.length * vencidas.length;
  return { ano, esperadas, cumpridas: r.n, pct: Math.round(1000 * r.n / esperadas) / 10 };
}

export async function contatoRecente(unitId: number | null) {
  const cfg = await getSettings(); const dias = cfg.atendimento.semContatoDias;
  const [r] = await sql<{ total: number; com: number }[]>`SELECT count(*)::int AS total, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM family_contacts fc WHERE fc.student_id=st.id AND fc.data >= ${hoje()}::date - ${dias}::int))::int AS com FROM students st WHERE st.aluno_atual ${unitId === null ? sql`` : sql`AND st.unit_atual_id=${unitId}`}`;
  return { dias, total: r.total, com: r.com, pct: r.total ? Math.round(1000 * r.com / r.total) / 10 : null };
}

/** Ações do plano: abertas, vencidas (só A_FAZER/EM_ANDAMENTO), bloqueadas e em dia. */
export async function resumoAcoes(unitId: number | null) {
  const h = hoje();
  const [r] = await sql<{ abertas: number; vencidas: number; bloqueadas: number; em_dia: number; concluidas_30: number; custo_previsto: number | null; custo_real: number | null }[]>`SELECT
      count(*) FILTER (WHERE status IN ('A_FAZER','EM_ANDAMENTO','BLOQUEADA'))::int AS abertas,
      count(*) FILTER (WHERE status IN ('A_FAZER','EM_ANDAMENTO') AND prazo < ${h})::int AS vencidas,
      count(*) FILTER (WHERE status='BLOQUEADA')::int AS bloqueadas,
      count(*) FILTER (WHERE status IN ('A_FAZER','EM_ANDAMENTO') AND (prazo IS NULL OR prazo >= ${h}))::int AS em_dia,
      count(*) FILTER (WHERE status='CONCLUIDA' AND concluida_em >= ${h}::date - 30)::int AS concluidas_30,
      sum(custo_previsto) FILTER (WHERE status <> 'CANCELADA')::float AS custo_previsto, sum(custo_real) FILTER (WHERE status <> 'CANCELADA')::float AS custo_real
    FROM action_plans WHERE 1=1 ${unitId === null ? sql`` : sql`AND (unit_id IS NULL OR unit_id=${unitId})`}`;
  return { ...r, pct: r.abertas ? Math.round(1000 * r.em_dia / r.abertas) / 10 : null };
}

export type RitualResumo = { id: number; nome: string; tipo: TipoRitual; unit_id: number | null; unidade: string | null; dono: string | null; dono_user_id: number | null; proxima_data: string | null; ultima: string | null; ata_pendente: number; realizadas_janela: number; criado_dias: number; situacao: "EM_DIA" | "ATRASADO" | "SEM_DATA"; participantes: number[] | null; indicadores: number[] | null; objetivos: number[] | null; finalidade: string | null; pauta_padrao: string | null; duracao_min: number | null; ativo: boolean };
export async function resumoRituais(unitId: number | null) {
  const cfg = await getSettings(); const h = hoje();
  const rows = await sql<Omit<RitualResumo, "situacao">[]>`SELECT r.id, r.nome, r.tipo, r.unit_id, un.nome AS unidade, us.nome AS dono, r.dono_user_id, r.proxima_data::text, r.participantes, r.indicadores, r.objetivos, r.finalidade, r.pauta_padrao, r.duracao_min, r.ativo,
      (SELECT max(m.data)::text FROM ritual_meetings m WHERE m.ritual_id=r.id AND m.status='REALIZADA') AS ultima,
      (SELECT count(*) FROM ritual_meetings m WHERE m.ritual_id=r.id AND m.status='REALIZADA' AND coalesce(trim(m.ata),'')='' AND m.data <= ${h}::date - ${cfg.estrategia.ataPendenteDias}::int)::int AS ata_pendente,
      (SELECT count(*) FROM ritual_meetings m WHERE m.ritual_id=r.id AND m.status='REALIZADA' AND m.data >= ${h}::date - greatest(90, CASE r.tipo WHEN 'SEMESTRAL' THEN 182 WHEN 'ANUAL' THEN 365 WHEN 'TRIMESTRAL' THEN 91 ELSE 90 END))::int AS realizadas_janela,
      (${h}::date - r.created_at::date)::int AS criado_dias
    FROM rituals r LEFT JOIN units un ON un.id=r.unit_id LEFT JOIN users us ON us.id=r.dono_user_id
    WHERE 1=1 ${unitId === null ? sql`` : sql`AND (r.unit_id IS NULL OR r.unit_id=${unitId})`} ORDER BY r.ativo DESC, r.proxima_data NULLS LAST, r.nome`;
  const lista: RitualResumo[] = rows.map(r => ({ ...r, situacao: situacaoRitual(r.proxima_data, h, cfg.estrategia.toleranciaRitualDias) }));
  const ativos = lista.filter(r => r.ativo); const emDia = ativos.filter(r => r.situacao === "EM_DIA").length;
  return { lista, ativos: ativos.length, emDia, atrasados: ativos.filter(r => r.situacao === "ATRASADO"), atasPendentes: ativos.reduce((a, r) => a + r.ata_pendente, 0), pct: ativos.length ? Math.round(1000 * emDia / ativos.length) / 10 : null };
}

/** Retratos atuais das métricas extras (para indicadores e KRs). */
export async function metricasExtra(unitId: number | null): Promise<Record<string, number | null>> {
  const per = hoje().slice(0, 7);
  const [rem, jor, cont, ac, rit, fun] = await Promise.all([rematricula(unitId), jornadaResumo(unitId), contatoRecente(unitId), resumoAcoes(unitId), resumoRituais(unitId), funilPorOrigem(per, unitId)]);
  return { "matriculas.rematricula": rem.pct, "matriculas.candidatos_mes": fun.total.candidatos, "matriculas.reservas_mes": fun.total.reservas, "matriculas.novas_mes": fun.total.matriculas, "atendimento.jornada": jor.pct, "atendimento.contato_recente": cont.pct, "estrategia.acoes_em_dia": ac.pct, "estrategia.rituais_em_dia": rit.pct };
}
