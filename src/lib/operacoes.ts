import { sql } from "@/db";
import { hoje, getSettings } from "./utils";

export const OS_TIPO: Record<string, string> = { CORRETIVA: "Corretiva", PREVENTIVA: "Preventiva", MELHORIA: "Melhoria", LIMPEZA: "Limpeza", TI: "TI e sistemas", SEGURANCA: "Segurança" };
export const OS_STATUS: Record<string, string> = { ABERTO: "Aberto", EM_EXECUCAO: "Em execução", AGUARDANDO: "Aguardando peça/fornecedor", CONCLUIDO: "Concluído", CANCELADO: "Cancelado" };
export const OS_PRIO: Record<string, string> = { BAIXA: "Baixa", NORMAL: "Normal", ALTA: "Alta", URGENTE: "Urgente (segurança)" };
export const ATIVO_STATUS: Record<string, string> = { EM_USO: "Em uso", MANUTENCAO: "Em manutenção", BAIXADO: "Baixado" };
export const ABERTAS = ["ABERTO", "EM_EXECUCAO", "AGUARDANDO"];
export const brl = (v: number | string | null | undefined) => v === null || v === undefined || v === "" ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export async function slaOs(prioridade: string, from = new Date()) { const cfg = await getSettings(); const h = (cfg.operacoes.slaHoras as Record<string, number>)[prioridade] ?? 72; return new Date(from.getTime() + h * 3600000); }

export async function painelOperacoes(unitId: number | null) {
  const h = hoje(); const uf = unitId === null ? sql`` : sql`AND w.unit_id=${unitId}`;
  const [[os], porTipo, porUnidade, preventivas, [vist], [custo], [aval], garantias] = await Promise.all([
    sql<{ abertas: number; atrasadas: number; urgentes: number; concluidas_30: number; tempo_medio_h: number | null }[]>`SELECT count(*) FILTER (WHERE w.status = ANY(${ABERTAS}))::int AS abertas, count(*) FILTER (WHERE w.status = ANY(${ABERTAS}) AND w.sla_ate < now())::int AS atrasadas, count(*) FILTER (WHERE w.status = ANY(${ABERTAS}) AND w.prioridade='URGENTE')::int AS urgentes, count(*) FILTER (WHERE w.concluido_em >= now() - interval '30 days')::int AS concluidas_30, (avg(EXTRACT(EPOCH FROM (w.concluido_em - w.created_at))/3600) FILTER (WHERE w.concluido_em >= now() - interval '90 days'))::numeric(10,1)::float AS tempo_medio_h FROM work_orders w WHERE 1=1 ${uf}`,
    sql<{ tipo: string; abertas: number; mes: number }[]>`SELECT w.tipo, count(*) FILTER (WHERE w.status = ANY(${ABERTAS}))::int AS abertas, count(*) FILTER (WHERE w.created_at >= date_trunc('month', now()))::int AS mes FROM work_orders w WHERE 1=1 ${uf} GROUP BY w.tipo ORDER BY abertas DESC`,
    sql<{ unidade: string; abertas: number; atrasadas: number; custo_mes: number }[]>`SELECT u.nome AS unidade, count(*) FILTER (WHERE w.status = ANY(${ABERTAS}))::int AS abertas, count(*) FILTER (WHERE w.status = ANY(${ABERTAS}) AND w.sla_ate < now())::int AS atrasadas, coalesce(sum(w.custo_real) FILTER (WHERE w.concluido_em >= date_trunc('month', now())),0)::float AS custo_mes FROM units u LEFT JOIN work_orders w ON w.unit_id=u.id ${unitId === null ? sql`` : sql`WHERE u.id=${unitId}`} GROUP BY u.nome ORDER BY u.nome`,
    sql<{ id: number; nome: string; unidade: string; ambiente: string | null; proxima: string; dias: number }[]>`SELECT a.id, a.nome, u.nome AS unidade, a.ambiente, (coalesce(a.ultima_preventiva, a.aquisicao, a.created_at::date) + a.preventiva_dias)::text AS proxima, (${h}::date - (coalesce(a.ultima_preventiva, a.aquisicao, a.created_at::date) + a.preventiva_dias))::int AS dias FROM assets a JOIN units u ON u.id=a.unit_id WHERE a.status <> 'BAIXADO' AND a.preventiva_dias IS NOT NULL AND coalesce(a.ultima_preventiva, a.aquisicao, a.created_at::date) + a.preventiva_dias <= ${h}::date + 15 ${unitId === null ? sql`` : sql`AND a.unit_id=${unitId}`} ORDER BY proxima`,
    sql<{ mes: number; media: number | null; ncs: number }[]>`SELECT count(*) FILTER (WHERE i.data >= date_trunc('month', now()))::int AS mes, (avg(100.0*i.conformes/nullif(i.total,0)) FILTER (WHERE i.data >= now() - interval '90 days'))::numeric(5,1)::float AS media, coalesce(sum(i.total - i.conformes) FILTER (WHERE i.data >= now() - interval '30 days'),0)::int AS ncs FROM inspections i WHERE 1=1 ${unitId === null ? sql`` : sql`AND i.unit_id=${unitId}`}`,
    sql<{ mes: number; ano: number }[]>`SELECT coalesce(sum(w.custo_real) FILTER (WHERE w.concluido_em >= date_trunc('month', now())),0)::float AS mes, coalesce(sum(w.custo_real) FILTER (WHERE w.concluido_em >= date_trunc('year', now())),0)::float AS ano FROM work_orders w WHERE 1=1 ${uf}`,
    sql<{ media: number | null; n: number }[]>`SELECT avg(w.avaliacao)::numeric(3,2)::float AS media, count(w.avaliacao)::int AS n FROM work_orders w WHERE w.concluido_em >= now() - interval '90 days' ${uf}`,
    sql<{ nome: string; unidade: string; garantia_ate: string }[]>`SELECT a.nome, u.nome AS unidade, a.garantia_ate::text FROM assets a JOIN units u ON u.id=a.unit_id WHERE a.garantia_ate BETWEEN ${h} AND ${h}::date + 60 ${unitId === null ? sql`` : sql`AND a.unit_id=${unitId}`} ORDER BY a.garantia_ate`,
  ]);
  return { os, porTipo, porUnidade, preventivas, vist, custo, aval, garantias };
}
