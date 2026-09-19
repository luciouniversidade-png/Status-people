import { sql } from "@/db";
import { hoje, addDays } from "./utils";

export const POP_STATUS: Record<string, string> = { RASCUNHO: "Rascunho", VIGENTE: "Vigente", EM_REVISAO: "Em revisão", OBSOLETO: "Obsoleto" };
export const EXC_STATUS: Record<string, string> = { SOLICITADA: "Aguardando aprovação", APROVADA: "Aprovada (vigente)", REJEITADA: "Rejeitada", EXPIRADA: "Expirada", REVISADA: "Revisada" };
export const FREQ: Record<string, string> = { DIARIO: "Diário", SEMANAL: "Semanal", MENSAL: "Mensal", TRIMESTRAL: "Trimestral", ANUAL: "Anual" };
export const FREQ_DIAS: Record<string, number> = { DIARIO: 1, SEMANAL: 7, MENSAL: 30, TRIMESTRAL: 91, ANUAL: 365 };
export const NC_STATUS: Record<string, string> = { ABERTA: "Aberta", EM_TRATAMENTO: "Em tratamento", VERIFICACAO: "Verificação de eficácia", ENCERRADA: "Encerrada" };
export const NC_ORIGEM: Record<string, string> = { CONTROLE: "Controle", RECLAMACAO: "Reclamação", AUDITORIA: "Auditoria", EXCECAO: "Exceção recorrente", OUTRO: "Outro" };
export const DEC_STATUS: Record<string, string> = { VIGENTE: "Vigente", REVOGADA: "Revogada", SUBSTITUIDA: "Substituída" };

/** Exceções aprovadas com validade vencida passam a EXPIRADA (aguardam revisão de recorrência). */
export async function expirarExcecoes() {
  const r = await sql`UPDATE exceptions SET status='EXPIRADA' WHERE status='APROVADA' AND validade_ate < ${hoje()} RETURNING id`;
  return r.length;
}

export async function estatisticasGov(unitId: number | null) {
  const h = hoje(); const em30 = addDays(h, 30);
  const uf = (col: string) => unitId === null ? sql`` : sql`AND (${sql(col)} IS NULL OR ${sql(col)} = ${unitId})`;
  const [[pops], [exc], [ctl], [nc], [dec], recorrentes, popsVencidos] = await Promise.all([
    sql<{ total: number; vigentes: number; rascunho: number; revisao: number; revisao_vencida: number; sem_owner: number }[]>`SELECT count(*)::int AS total, count(*) FILTER (WHERE status='VIGENTE')::int AS vigentes, count(*) FILTER (WHERE status='RASCUNHO')::int AS rascunho, count(*) FILTER (WHERE status='EM_REVISAO')::int AS revisao, count(*) FILTER (WHERE status='VIGENTE' AND revisar_em < ${h})::int AS revisao_vencida, count(*) FILTER (WHERE status<>'OBSOLETO' AND owner_user_id IS NULL)::int AS sem_owner FROM procedures p WHERE 1=1 ${uf("unit_id")}`,
    sql<{ pendentes: number; vigentes: number; expirando: number; expiradas_sem_revisao: number }[]>`SELECT count(*) FILTER (WHERE status='SOLICITADA')::int AS pendentes, count(*) FILTER (WHERE status='APROVADA')::int AS vigentes, count(*) FILTER (WHERE status='APROVADA' AND validade_ate <= ${em30})::int AS expirando, count(*) FILTER (WHERE status='EXPIRADA')::int AS expiradas_sem_revisao FROM exceptions e WHERE 1=1 ${uf("unit_id")}`,
    sql<{ ativos: number; atrasados: number; nao_conformes_30: number }[]>`SELECT count(*) FILTER (WHERE ativo)::int AS ativos, count(*) FILTER (WHERE ativo AND proxima_em < ${h})::int AS atrasados, (SELECT count(*) FROM control_runs r JOIN controls c2 ON c2.id=r.control_id WHERE r.resultado='NAO_CONFORME' AND r.data >= ${h}::date - 30 ${unitId === null ? sql`` : sql`AND (c2.unit_id IS NULL OR c2.unit_id=${unitId})`})::int AS nao_conformes_30 FROM controls c WHERE 1=1 ${uf("unit_id")}`,
    sql<{ abertas: number; atrasadas: number; graves: number; encerradas_30: number }[]>`SELECT count(*) FILTER (WHERE status<>'ENCERRADA')::int AS abertas, count(*) FILTER (WHERE status<>'ENCERRADA' AND prazo < ${h})::int AS atrasadas, count(*) FILTER (WHERE status<>'ENCERRADA' AND gravidade=3)::int AS graves, count(*) FILTER (WHERE status='ENCERRADA' AND encerrada_em >= now() - interval '30 days')::int AS encerradas_30 FROM nonconformities n WHERE 1=1 ${uf("unit_id")}`,
    sql<{ vigentes: number; revisar: number }[]>`SELECT count(*) FILTER (WHERE status='VIGENTE')::int AS vigentes, count(*) FILTER (WHERE status='VIGENTE' AND revisar_em <= ${em30})::int AS revisar FROM decisions d WHERE 1=1 ${uf("unit_id")}`,
    sql<{ regra: string; motivo: string; n: number }[]>`SELECT regra, motivo, count(*)::int AS n FROM exceptions e WHERE created_at > now() - interval '90 days' AND status IN ('APROVADA','EXPIRADA','REVISADA') ${uf("unit_id")} GROUP BY regra, motivo HAVING count(*) >= 3 ORDER BY n DESC LIMIT 10`,
    sql<{ id: number; codigo: string; titulo: string; revisar_em: string }[]>`SELECT id, codigo, titulo, revisar_em::text FROM procedures p WHERE status='VIGENTE' AND revisar_em < ${h} ${uf("unit_id")} ORDER BY revisar_em LIMIT 10`,
  ]);
  // Process Health Score (explicável): parte de 100 e desconta por pendências
  const fatores: { peso: number; texto: string }[] = [];
  if (pops.total) { const pctVig = pops.vigentes / pops.total; if (pctVig < 0.8) fatores.push({ peso: -Math.round((0.8 - pctVig) * 50), texto: `${Math.round(pctVig * 100)}% dos POPs vigentes` }); }
  if (pops.revisao_vencida) fatores.push({ peso: -Math.min(20, pops.revisao_vencida * 5), texto: `${pops.revisao_vencida} POP(s) com revisão vencida` });
  if (pops.sem_owner) fatores.push({ peso: -Math.min(15, pops.sem_owner * 3), texto: `${pops.sem_owner} POP(s) sem dono` });
  if (exc.expiradas_sem_revisao) fatores.push({ peso: -Math.min(15, exc.expiradas_sem_revisao * 3), texto: `${exc.expiradas_sem_revisao} exceção(ões) expirada(s) sem revisão` });
  if (recorrentes.length) fatores.push({ peso: -Math.min(15, recorrentes.length * 5), texto: `${recorrentes.length} exceção(ões) recorrente(s)` });
  if (ctl.atrasados) fatores.push({ peso: -Math.min(20, ctl.atrasados * 5), texto: `${ctl.atrasados} controle(s) atrasado(s)` });
  if (nc.atrasadas) fatores.push({ peso: -Math.min(20, nc.atrasadas * 5), texto: `${nc.atrasadas} não conformidade(s) fora do prazo` });
  if (nc.graves) fatores.push({ peso: -Math.min(15, nc.graves * 5), texto: `${nc.graves} não conformidade(s) grave(s) aberta(s)` });
  const score = Math.max(0, 100 + fatores.reduce((a, f) => a + f.peso, 0));
  return { pops, exc, ctl, nc, dec, recorrentes, popsVencidos, score, fatores };
}
