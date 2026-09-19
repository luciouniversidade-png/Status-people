import { sql } from "@/db";
import { hoje, getSettings } from "./utils";
import { peopleHealth } from "./talentos-analytics";
import { estatisticasGov } from "./governanca";
import { ocupacao } from "./matriculas";
import { estatisticas as estatAtend } from "./atendimento";
import { inadimplencia } from "./financeiro";
import { mapaSucessao } from "./talentos-analytics";
import { matrizTreinamento } from "./clima-academy";
import { mesRef } from "./relatorio";

export const PROJ_STATUS: Record<string, string> = { IDEIA: "Ideia", PLANEJADO: "Planejado", EM_ANDAMENTO: "Em andamento", PAUSADO: "Pausado", CONCLUIDO: "Concluído", CANCELADO: "Cancelado" };
export const SAUDE: Record<string, string> = { VERDE: "No rumo", AMARELO: "Atenção", VERMELHO: "Em risco" };
export const OBJ_STATUS: Record<string, string> = { ATIVO: "Ativo", CONCLUIDO: "Concluído", CANCELADO: "Cancelado" };
export const CONFIANCA: Record<number, string> = { 1: "baixa", 2: "média", 3: "alta" };
export const RISCO_STATUS: Record<string, string> = { ABERTO: "Aberto", MITIGADO: "Mitigado", OCORREU: "Ocorreu" };
export const ATIVOS_PROJ = ["PLANEJADO", "EM_ANDAMENTO", "PAUSADO"];

/** Métricas que o sistema já mede e podem alimentar um KR automaticamente. */
export const FONTES: Record<string, { nome: string; metrica: string }> = {
  "matriculas.ocupacao": { nome: "Ocupação das vagas regulares do ano letivo", metrica: "%" },
  "atendimento.nps": { nome: "NPS das famílias (mês)", metrica: "pontos" },
  "atendimento.retencao": { nome: "Retenção nos pedidos de saída (mês)", metrica: "%" },
  "financeiro.inadimplencia": { nome: "Inadimplência 90 dias", metrica: "%" },
  "financeiro.regua_pendente": { nome: "Títulos vencidos sem ação da régua", metrica: "títulos" },
  "pessoas.turnover": { nome: "Turnover 12 meses", metrica: "%" },
  "pessoas.enps": { nome: "eNPS (última pesquisa encerrada)", metrica: "pontos" },
  "pessoas.absenteismo": { nome: "Absenteísmo 90 dias", metrica: "%" },
  "academy.conformidade": { nome: "Treinamentos obrigatórios em dia", metrica: "%" },
  "sucessao.bench": { nome: "Bench strength (posições críticas com sucessor pronto)", metrica: "%" },
  "governanca.process_health": { nome: "Process Health Score", metrica: "pontos" },
  "governanca.ciencia": { nome: "POPs vigentes com ciência completa", metrica: "%" },
  "operacoes.sla": { nome: "Chamados concluídos dentro do SLA (90 dias)", metrica: "%" },
  "operacoes.vistorias": { nome: "Conformidade média das vistorias (90 dias)", metrica: "%" },
};

export async function metricasSistema(unitId: number | null): Promise<Record<string, number | null>> {
  const cfg = await getSettings(); const h = hoje(); const m = mesRef(h.slice(0, 7));
  const [ph, gov, oc, at, inad, suc, mat, [sla], [vist], [cien]] = await Promise.all([peopleHealth(unitId), estatisticasGov(unitId), ocupacao(cfg.matriculas.anoLetivo, unitId, "REGULAR"), estatAtend(unitId, m.ini, m.fim), inadimplencia(unitId), mapaSucessao(unitId), matrizTreinamento(unitId),
    sql<{ pct: number | null }[]>`SELECT (100.0 * count(*) FILTER (WHERE w.concluido_em <= w.sla_ate) / nullif(count(*),0))::numeric(5,1)::float AS pct FROM work_orders w WHERE w.status='CONCLUIDO' AND w.concluido_em >= now() - interval '90 days' ${unitId === null ? sql`` : sql`AND w.unit_id=${unitId}`}`,
    sql<{ pct: number | null }[]>`SELECT (avg(100.0*i.conformes/nullif(i.total,0)))::numeric(5,1)::float AS pct FROM inspections i WHERE i.data >= now() - interval '90 days' ${unitId === null ? sql`` : sql`AND i.unit_id=${unitId}`}`,
    sql<{ pct: number | null }[]>`SELECT (100.0 * count(*) FILTER (WHERE (SELECT count(*) FROM users u WHERE u.ativo AND u.role <> 'LEITURA') <= (SELECT count(*) FROM procedure_acks a WHERE a.procedure_id=p.id AND a.versao=p.versao)) / nullif(count(*),0))::numeric(5,1)::float AS pct FROM procedures p WHERE p.status='VIGENTE'`]);
  const vagas = oc.reduce((a, r) => a + r.vagas, 0); const ocup = vagas ? Math.round(1000 * oc.reduce((a, r) => a + r.confirmadas + r.reservadas, 0) / vagas) / 10 : null;
  const ret = at.ret.retidos + at.ret.perdidos ? Math.round(100 * at.ret.retidos / (at.ret.retidos + at.ret.perdidos)) : null;
  return { "matriculas.ocupacao": ocup, "atendimento.nps": at.nps.nps, "atendimento.retencao": ret, "financeiro.inadimplencia": inad.taxa90, "financeiro.regua_pendente": inad.acoesPendentes, "pessoas.turnover": ph.turnover, "pessoas.enps": ph.enps, "pessoas.absenteismo": ph.absenteismo, "academy.conformidade": mat.conformidade, "sucessao.bench": suc.bench, "governanca.process_health": gov.score, "governanca.ciencia": cien.pct, "operacoes.sla": sla.pct, "operacoes.vistorias": vist.pct };
}

export function progressoKR(inicial: number, meta: number, atual: number | null, direcao: string) {
  if (atual === null || atual === undefined) return null; if (meta === inicial) return atual === meta ? 100 : 0;
  const p = direcao === "DESCER" ? (inicial - atual) / (inicial - meta) : (atual - inicial) / (meta - inicial);
  return Math.max(0, Math.min(100, Math.round(100 * p)));
}

export type KRRow = { id: number; objective_id: number; titulo: string; metrica: string | null; valor_inicial: number; valor_meta: number; valor_atual: number | null; direcao: string; fonte: string | null; owner: string | null; owner_user_id: number | null; prazo: string | null; confianca: number | null; atualizado_em: Date | string | null; progresso: number | null };

/** Objetivos do ciclo com KRs; KRs com fonte de sistema recebem o valor atual calculado agora (e gravado). */
export async function okrs(ciclo: string, unitId: number | null) {
  const objs = await sql<{ id: number; pilar: string | null; titulo: string; descricao: string | null; owner: string | null; owner_user_id: number | null; unidade: string | null; unit_id: number | null; status: string; ordem: number; projetos: number }[]>`SELECT o.id, o.pilar, o.titulo, o.descricao, u.nome AS owner, o.owner_user_id, un.nome AS unidade, o.unit_id, o.status, o.ordem, (SELECT count(*) FROM projects p WHERE p.objective_id=o.id AND p.status <> 'CANCELADO')::int AS projetos FROM objectives o LEFT JOIN users u ON u.id=o.owner_user_id LEFT JOIN units un ON un.id=o.unit_id WHERE o.ciclo=${ciclo} ${unitId === null ? sql`` : sql`AND (o.unit_id IS NULL OR o.unit_id=${unitId})`} ORDER BY o.status='ATIVO' DESC, o.ordem, o.id`;
  const krs = await sql<Omit<KRRow, "progresso">[]>`SELECT k.id, k.objective_id, k.titulo, k.metrica, k.valor_inicial::float, k.valor_meta::float, k.valor_atual::float, k.direcao, k.fonte, u.nome AS owner, k.owner_user_id, k.prazo::text, k.confianca, k.atualizado_em FROM key_results k LEFT JOIN users u ON u.id=k.owner_user_id WHERE k.objective_id IN (SELECT id FROM objectives WHERE ciclo=${ciclo}) ORDER BY k.id`;
  const precisa = krs.some(k => k.fonte?.startsWith("SISTEMA:")); const met = precisa ? await metricasSistema(unitId) : {};
  const rows: KRRow[] = [];
  for (const k of krs) {
    let atual = k.valor_atual;
    if (k.fonte?.startsWith("SISTEMA:")) { const v = met[k.fonte.slice(8)]; if (v !== null && v !== undefined && !Number.isNaN(v)) { atual = v; if (k.valor_atual !== v) await sql`UPDATE key_results SET valor_atual=${v}, atualizado_em=now() WHERE id=${k.id}`; } }
    rows.push({ ...k, valor_atual: atual, progresso: progressoKR(k.valor_inicial, k.valor_meta, atual, k.direcao) });
  }
  const objetivos = objs.map(o => { const ks = rows.filter(k => k.objective_id === o.id); const com = ks.filter(k => k.progresso !== null); return { ...o, krs: ks, progresso: com.length ? Math.round(com.reduce((a, k) => a + (k.progresso ?? 0), 0) / com.length) : null }; });
  const ativos = objetivos.filter(o => o.status === "ATIVO"); const com = ativos.filter(o => o.progresso !== null);
  return { objetivos, progressoCiclo: com.length ? Math.round(com.reduce((a, o) => a + (o.progresso ?? 0), 0) / com.length) : null, totalKRs: rows.length, krsSemMedicao: rows.filter(k => k.progresso === null).length, krsBaixaConfianca: rows.filter(k => k.confianca === 1).length };
}

export async function portfolio(unitId: number | null) {
  const cfg = await getSettings(); const h = hoje();
  const rows = await sql<{ id: number; nome: string; status: string; prioridade: string; saude: string; owner: string | null; unidade: string | null; objetivo: string | null; inicio: string | null; fim: string | null; orcamento: number | null; gasto: number | null; marcos: number; marcos_ok: number; marcos_atrasados: number; proximo_marco: string | null; proximo_prazo: string | null; ultima_atualizacao: string | null; riscos_altos: number }[]>`
    SELECT p.id, p.nome, p.status, p.prioridade, p.saude, u.nome AS owner, un.nome AS unidade, o.titulo AS objetivo, p.inicio::text, p.fim::text, p.orcamento::float, p.gasto::float,
      (SELECT count(*) FROM milestones m WHERE m.project_id=p.id)::int AS marcos, (SELECT count(*) FROM milestones m WHERE m.project_id=p.id AND m.concluido_em IS NOT NULL)::int AS marcos_ok, (SELECT count(*) FROM milestones m WHERE m.project_id=p.id AND m.concluido_em IS NULL AND m.prazo < ${h})::int AS marcos_atrasados,
      (SELECT m.titulo FROM milestones m WHERE m.project_id=p.id AND m.concluido_em IS NULL ORDER BY m.prazo LIMIT 1) AS proximo_marco, (SELECT m.prazo::text FROM milestones m WHERE m.project_id=p.id AND m.concluido_em IS NULL ORDER BY m.prazo LIMIT 1) AS proximo_prazo,
      (SELECT max(pu.data)::text FROM project_updates pu WHERE pu.project_id=p.id) AS ultima_atualizacao, (SELECT count(*) FROM project_risks r WHERE r.project_id=p.id AND r.status='ABERTO' AND r.probabilidade*r.impacto >= 6)::int AS riscos_altos
    FROM projects p LEFT JOIN users u ON u.id=p.owner_user_id LEFT JOIN units un ON un.id=p.unit_id LEFT JOIN objectives o ON o.id=p.objective_id
    WHERE 1=1 ${unitId === null ? sql`` : sql`AND (p.unit_id IS NULL OR p.unit_id=${unitId})`} ORDER BY (p.status = ANY(${ATIVOS_PROJ})) DESC, p.saude='VERMELHO' DESC, p.saude='AMARELO' DESC, p.prioridade='ALTA' DESC, p.fim NULLS LAST`;
  const dias = cfg.estrategia.atualizacaoProjetoDias; const lim = new Date(Date.parse(h) - dias * 86400000).toISOString().slice(0, 10);
  const ativos = rows.filter(r => ATIVOS_PROJ.includes(r.status));
  return { rows, ativos: ativos.length, vermelhos: ativos.filter(r => r.saude === "VERMELHO").length, amarelos: ativos.filter(r => r.saude === "AMARELO").length, marcosAtrasados: ativos.reduce((a, r) => a + r.marcos_atrasados, 0), semAtualizacao: ativos.filter(r => r.status === "EM_ANDAMENTO" && (!r.ultima_atualizacao || r.ultima_atualizacao < lim)), estourados: ativos.filter(r => r.orcamento && r.gasto && r.gasto > r.orcamento).length, orcamento: ativos.reduce((a, r) => a + (r.orcamento ?? 0), 0), gasto: ativos.reduce((a, r) => a + (r.gasto ?? 0), 0) };
}
