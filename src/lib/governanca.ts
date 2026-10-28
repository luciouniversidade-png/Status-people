import { usuariosQueAprovam } from "./acesso";
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

/** Níveis de autonomia de agentes de IA (inventário de Governança). */
export const NIVEIS_IA: Record<string, string> = { N0: "N0 · Consulta (responde, não produz entregável)", N1: "N1 · Rascunho (pessoa revisa antes de usar)", N2: "N2 · Executa com aprovação caso a caso", N3: "N3 · Rotina autônoma com log e auditoria" };

// ------------------------------------------------------------ v25 · CRQ-PRJ-V3-03: exceção repetida revisa o POP
/** Exceções iguais (mesmo POP — ou a mesma regra escrita — e o mesmo motivo) na janela: a partir do limiar, abre a revisão do POP com as evidências e prazo. */
export async function verificarRevisaoPop(procedureId: number | null, regra: string, motivo: string) {
  const { getSettings } = await import("./utils"); const { notificar, usuariosPorPerfil } = await import("./comunicacao");
  const cfg = await getSettings(); const g = cfg.governanca as { excecaoRecorrenteLimiar?: number; excecaoJanelaDias?: number; revisaoPopPrazoDias?: number };
  const limiar = Number(g.excecaoRecorrenteLimiar ?? 3), janela = Number(g.excecaoJanelaDias ?? 90), prazoDias = Number(g.revisaoPopPrazoDias ?? 30);
  const chave = `${procedureId ?? `regra:${regra.trim().toLowerCase()}`}|${motivo}`;
  const evid = await sql<{ id: number }[]>`SELECT id FROM exceptions WHERE motivo=${motivo} AND ${procedureId ? sql`procedure_id=${procedureId}` : sql`procedure_id IS NULL AND lower(trim(regra))=${regra.trim().toLowerCase()}`} AND status IN ('APROVADA','EXPIRADA','REVISADA') AND created_at > now() - make_interval(days => ${janela}) ORDER BY id`;
  if (evid.length < limiar) return null;
  const [ja] = await sql<{ id: number }[]>`SELECT id FROM procedure_reviews WHERE chave=${chave} AND status='ABERTA'`;
  if (ja) { await sql`UPDATE procedure_reviews SET evidencias=${JSON.stringify(evid.map(e => e.id))}::jsonb WHERE id=${ja.id}`; return ja.id; }
  const [p] = procedureId ? await sql<{ owner_user_id: number | null; codigo: string; titulo: string }[]>`SELECT owner_user_id, codigo, titulo FROM procedures WHERE id=${procedureId}` : [];
  const prazo = new Date(Date.now() + prazoDias * 86400000).toISOString().slice(0, 10);
  const [r] = await sql<{ id: number }[]>`INSERT INTO procedure_reviews (chave, procedure_id, regra, motivo, evidencias, prazo, dono_user_id) VALUES (${chave}, ${procedureId}, ${regra}, ${motivo}, ${JSON.stringify(evid.map(e => e.id))}::jsonb, ${prazo}, ${p?.owner_user_id ?? null}) ON CONFLICT DO NOTHING RETURNING id`;
  if (!r) return null;
  const dest = p?.owner_user_id ? [p.owner_user_id] : await usuariosQueAprovam("pops");
  await notificar(dest, `Revisão de POP aberta: ${p ? `${p.codigo} ${p.titulo}` : regra}`, `${evid.length} exceções iguais (${motivo}) em ${janela} dias — revisar até ${prazo.split("-").reverse().join("/")}.`, procedureId ? `/governanca/pops/${procedureId}#revisao` : "/governanca/excecoes#revisoes", "ACAO", `poprev:${r.id}`);
  return r.id;
}
/** Revisões abertas (para o painel de governança e a página do POP). */
export async function revisoesPop(filtro: { procedureId?: number; abertas?: boolean } = {}) {
  return sql<{ id: number; procedure_id: number | null; codigo: string | null; titulo: string | null; regra: string; motivo: string; evidencias: number[]; prazo: string; dono: string | null; status: string; desfecho: string | null; desfecho_obs: string | null; versao_publicada: number | null; created_at: string; concluida_em: string | null }[]>`
    SELECT r.id, r.procedure_id, p.codigo, p.titulo, r.regra, r.motivo, r.evidencias, r.prazo::text, u.nome AS dono, r.status, r.desfecho, r.desfecho_obs, r.versao_publicada, r.created_at::text, r.concluida_em::text
    FROM procedure_reviews r LEFT JOIN procedures p ON p.id=r.procedure_id LEFT JOIN users u ON u.id=r.dono_user_id WHERE true ${filtro.procedureId ? sql`AND r.procedure_id=${filtro.procedureId}` : sql``} ${filtro.abertas ? sql`AND r.status='ABERTA'` : sql``} ORDER BY (r.status='ABERTA') DESC, r.prazo`;
}
/** Rotina: abre revisões que faltarem (exceções aprovadas por outros caminhos) e escala as vencidas à Direção. */
export async function rotinaRevisaoPop() {
  const { notificar, usuariosPorPerfil } = await import("./comunicacao");
  const grupos = await sql<{ procedure_id: number | null; regra: string; motivo: string }[]>`SELECT procedure_id, min(regra) AS regra, motivo FROM exceptions WHERE status IN ('APROVADA','EXPIRADA','REVISADA') AND created_at > now() - interval '120 days' GROUP BY procedure_id, CASE WHEN procedure_id IS NULL THEN lower(trim(regra)) END, motivo HAVING count(*) >= 2`;
  let abertas = 0; for (const g of grupos) if (await verificarRevisaoPop(g.procedure_id, g.regra, g.motivo)) abertas++;
  const vencidas = await sql<{ id: number }[]>`UPDATE procedure_reviews SET escalada_em=now() WHERE status='ABERTA' AND prazo < current_date AND escalada_em IS NULL RETURNING id`;
  if (vencidas.length) await notificar(await usuariosPorPerfil(["DIRECAO"]), "Revisão de POP vencida", `${vencidas.length} revisão(ões) por exceção repetida passaram do prazo.`, "/governanca/excecoes#revisoes", "ALERTA", `poprevvenc:${new Date().toISOString().slice(0, 10)}`);
  return { abertas, escaladas: vencidas.length };
}
