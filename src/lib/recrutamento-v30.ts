/**
 * v30 · Recrutamento: avaliadores com notas independentes (cada um envia antes de ver os outros), saúde das vagas (0–100, explicável),
 * projeção do próximo mês, propostas (aceite e motivos de recusa), experiência do candidato (anônima) e o índice de qualidade da
 * contratação (retenção + gestor aos 90 dias + 1ª avaliação). O sistema mede e sugere; quem decide é a pessoa.
 */
import { sql } from "@/db";
import { hoje, addDays } from "./utils";

export const RECOMENDACAO: Record<string, string> = { FORTE_SIM: "Forte sim", SIM: "Sim", NAO: "Não", FORTE_NAO: "Forte não" };
export const RECOMENDACAO_TOM: Record<string, string> = { FORTE_SIM: "APROVADA", SIM: "ATIVO", NAO: "PENDENTE", FORTE_NAO: "REJEITADA" };
export const PROPOSTA_RESPOSTA: Record<string, string> = { ACEITA: "Aceita", RECUSADA: "Recusada", RETIRADA: "Retirada pela escola" };
const DIA = 86400000;
const media = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// ------------------------------------------------------------------ avaliadores
export type Feedback = { id: number; application_id: number; etapa: string; avaliador_user_id: number; avaliador: string; prazo: string | null; notas: Record<string, number> | null; recomendacao: string | null; pontos_fortes: string | null; pontos_atencao: string | null; enviado_em: string | null; cancelado_em: string | null };
/** Consolida as notas ENVIADAS de uma etapa: média por critério, divergência (diferença ≥ 2 entre avaliadores) e as recomendações. */
export function consolidar(fs: Feedback[], criterios: string[]) {
  const env = fs.filter(f => f.enviado_em && !f.cancelado_em); const conv = fs.filter(f => !f.cancelado_em);
  const porCriterio = criterios.map(c => { const v = env.map(f => f.notas?.[c]).filter((n): n is number => typeof n === "number" && n >= 1 && n <= 5); return { criterio: c, media: media(v), n: v.length, divergente: v.length >= 2 && Math.max(...v) - Math.min(...v) >= 2 }; });
  const todas = env.flatMap(f => Object.values(f.notas ?? {}).filter((n): n is number => typeof n === "number"));
  const recs = Object.keys(RECOMENDACAO).map(k => ({ k, n: env.filter(f => f.recomendacao === k).length })).filter(x => x.n);
  return { convidados: conv.length, enviados: env.length, media: media(todas), porCriterio, divergentes: porCriterio.filter(p => p.divergente).map(p => p.criterio), recomendacoes: recs, completo: conv.length > 0 && env.length === conv.length };
}
export async function feedbacksDaVaga(rid: number): Promise<Feedback[]> {
  return sql<Feedback[]>`SELECT f.id, f.application_id, f.etapa, f.avaliador_user_id, u.nome AS avaliador, f.prazo::text, f.notas, f.recomendacao, f.pontos_fortes, f.pontos_atencao, f.enviado_em::text, f.cancelado_em::text
    FROM interview_feedback f JOIN users u ON u.id=f.avaliador_user_id JOIN applications a ON a.id=f.application_id WHERE a.requisition_id=${rid} ORDER BY f.application_id, f.etapa, f.id`;
}

// ------------------------------------------------------------------ saúde das vagas
export type SaudeVaga = { id: number; titulo: string; unidade: string; score: number; motivos: string[]; ativos: number; quantidade: number };
/**
 * Saúde de cada vaga aberta (100 = tudo em ordem). Desconta: poucas candidaturas ativas para as posições (até 30), ninguém além da
 * triagem depois de 10 dias aberta (15), candidaturas paradas além do prazo da etapa (até 20), vaga fora do prazo (20) e notas de
 * avaliadores atrasadas (até 15). Cada desconto vira um motivo legível.
 */
export function pontuarVaga(v: { diasAberta: number; ativos: number; quantidade: number; alemTriagem: number; parados: number; atrasada: boolean; notasAtrasadas: number }, candidatosPorVaga: number) {
  let score = 100; const motivos: string[] = [];
  const alvo = Math.max(1, candidatosPorVaga * v.quantidade);
  if (v.ativos < alvo) { const d = Math.round(30 * (1 - v.ativos / alvo)); score -= d; motivos.push(v.ativos === 0 ? "nenhuma candidatura ativa" : `${v.ativos} candidatura(s) ativa(s) para ${v.quantidade} posição(ões) — o ideal é ${alvo}`); }
  if (v.diasAberta > 10 && v.alemTriagem === 0) { score -= 15; motivos.push(`aberta há ${v.diasAberta} dias e ninguém passou da triagem`); }
  if (v.parados > 0) { score -= Math.min(20, 7 * v.parados); motivos.push(`${v.parados} candidatura(s) parada(s) além do prazo da etapa`); }
  if (v.atrasada) { score -= 20; motivos.push("fora do prazo da vaga"); }
  if (v.notasAtrasadas > 0) { score -= Math.min(15, 5 * v.notasAtrasadas); motivos.push(`${v.notasAtrasadas} avaliação(ões) de entrevista atrasada(s)`); }
  return { score: Math.max(0, score), motivos };
}
export async function saudeVagas(unitId: number | null, cfg: { slaTriagemDias: number; slaVagaDias: number; candidatosPorVaga: number; slaEtapaDias?: number }): Promise<SaudeVaga[]> {
  const uf = unitId === null ? sql`` : sql`AND r.unit_id=${unitId}`; const h = hoje();
  const vagas = await sql<{ id: number; titulo: string; unidade: string; quantidade: number; aberta_em: string | null; created_at: string; prazo: string | null; dias_pausada: number; ativos: number; alem: number; notas_atrasadas: number }[]>`
    SELECT r.id, r.titulo, u.nome AS unidade, r.quantidade, r.aberta_em::text, r.created_at::date::text, r.prazo::text, r.dias_pausada,
      (SELECT count(*) FROM applications a WHERE a.requisition_id=r.id AND a.etapa NOT IN ('REPROVADO','DESISTIU','CONTRATADO') AND a.retirada_em IS NULL)::int AS ativos,
      (SELECT count(*) FROM applications a WHERE a.requisition_id=r.id AND a.etapa NOT IN ('TRIAGEM','REPROVADO','DESISTIU'))::int AS alem,
      (SELECT count(*) FROM interview_feedback f JOIN applications a ON a.id=f.application_id WHERE a.requisition_id=r.id AND f.enviado_em IS NULL AND f.cancelado_em IS NULL AND f.prazo < ${h}::date AND a.etapa NOT IN ('REPROVADO','DESISTIU','CONTRATADO'))::int AS notas_atrasadas
    FROM requisitions r JOIN units u ON u.id=r.unit_id WHERE r.status='ABERTA' ${uf} ORDER BY r.id`;
  if (!vagas.length) return [];
  const apps = await sql<{ requisition_id: number; etapa: string; desde: string }[]>`SELECT a.requisition_id, a.etapa, coalesce(a.etapa_desde, (SELECT max(e.at) FROM application_events e WHERE e.application_id=a.id), a.created_at)::text AS desde
    FROM applications a WHERE a.requisition_id = ANY(${vagas.map(v => v.id)}::int[]) AND a.etapa NOT IN ('REPROVADO','DESISTIU','CONTRATADO') AND a.retirada_em IS NULL`;
  return vagas.map(v => {
    const desde = v.aberta_em ?? v.created_at; const diasAberta = Math.max(0, Math.floor((Date.parse(h) - Date.parse(desde)) / DIA) - (v.dias_pausada ?? 0));
    const limite = v.prazo ?? addDays(desde, cfg.slaVagaDias + (v.dias_pausada ?? 0));
    const parados = apps.filter(a => a.requisition_id === v.id && diasDesde(a.desde) > (a.etapa === "TRIAGEM" ? cfg.slaTriagemDias : cfg.slaEtapaDias ?? 7)).length;
    const p = pontuarVaga({ diasAberta, ativos: v.ativos, quantidade: v.quantidade, alemTriagem: v.alem, parados, atrasada: h > limite, notasAtrasadas: v.notas_atrasadas }, cfg.candidatosPorVaga);
    return { id: v.id, titulo: v.titulo, unidade: v.unidade, ativos: v.ativos, quantidade: v.quantidade, ...p };
  });
}
export const tomSaude = (n: number) => (n >= 80 ? "bom" : n >= 60 ? "atencao" : "ruim") as "bom" | "atencao" | "ruim";

// ------------------------------------------------------------------ projeção do próximo mês
/** Faixa para o próximo mês pela média e pela variação dos últimos meses (até 6, só os que têm movimento). Confiança pela regularidade. */
export function projetar(valores: number[]) {
  const xs = valores.slice(-6); if (xs.length < 3) return null;
  const m = media(xs)!; const dp = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length); const cv = m > 0 ? dp / m : xs.every(x => x === 0) ? 0 : 1;
  return { min: Math.max(0, Math.floor(m - dp)), max: Math.ceil(m + dp), media: m, confianca: (xs.length >= 4 && cv < 0.35 ? "alta" : cv < 0.7 ? "média" : "baixa") as "alta" | "média" | "baixa", meses: xs.length };
}

// ------------------------------------------------------------------ tempo para preencher por unidade e por cargo
export async function tempoParaPreencher(unitId: number | null, meses = 24) {
  const uf = unitId === null ? sql`` : sql`AND r.unit_id=${unitId}`;
  const rows = await sql<{ unidade: string; cargo: string | null; dias: number }[]>`SELECT u.nome AS unidade, p.nome AS cargo, greatest(0, (r.fechada_em - r.aberta_em) - r.dias_pausada)::int AS dias
    FROM requisitions r JOIN units u ON u.id=r.unit_id LEFT JOIN positions p ON p.id=r.position_id WHERE r.status='PREENCHIDA' AND r.aberta_em IS NOT NULL AND r.fechada_em IS NOT NULL AND r.fechada_em >= current_date - (${meses} * interval '1 month') ${uf}`;
  const agrupar = (k: (r: typeof rows[number]) => string) => [...new Set(rows.map(k))].map(g => { const ds = rows.filter(r => k(r) === g).map(r => r.dias); return { grupo: g, vagas: ds.length, media: media(ds)!, max: Math.max(...ds) }; }).sort((a, b) => b.media - a.media);
  return { porUnidade: agrupar(r => r.unidade), porCargo: agrupar(r => r.cargo ?? "Sem cargo"), total: rows.length };
}

// ------------------------------------------------------------------ propostas
export async function propostas(unitId: number | null, meses: number) {
  const uf = unitId === null ? sql`` : sql`AND r.unit_id=${unitId}`;
  const rows = await sql<{ resposta: string | null; motivo: string | null; enviada: string; dias: number | null }[]>`SELECT a.proposta_resposta AS resposta, a.proposta_motivo AS motivo, a.proposta_enviada_em::text AS enviada, (a.proposta_resposta_em - a.proposta_enviada_em)::int AS dias
    FROM applications a JOIN requisitions r ON r.id=a.requisition_id WHERE a.proposta_enviada_em IS NOT NULL AND a.proposta_enviada_em >= current_date - (${meses} * interval '1 month') ${uf}`;
  const decididas = rows.filter(r => r.resposta === "ACEITA" || r.resposta === "RECUSADA"); const aceitas = rows.filter(r => r.resposta === "ACEITA").length;
  const motivos = Object.entries(rows.filter(r => r.resposta === "RECUSADA").reduce<Record<string, number>>((o, r) => { const k = r.motivo ?? "Sem motivo registrado"; o[k] = (o[k] ?? 0) + 1; return o; }, {})).map(([motivo, n]) => ({ motivo, n })).sort((a, b) => b.n - a.n);
  return { enviadas: rows.length, aguardando: rows.filter(r => !r.resposta).length, aceitas, recusadas: rows.filter(r => r.resposta === "RECUSADA").length, retiradas: rows.filter(r => r.resposta === "RETIRADA").length, aceite: decididas.length ? aceitas / decididas.length : null, diasResposta: media(rows.filter(r => r.dias !== null).map(r => r.dias!)), motivos };
}

// ------------------------------------------------------------------ experiência do candidato (anônima)
export async function experienciaCandidato(unitId: number | null, meses: number, minimo: number) {
  const rows = await sql<{ desfecho: string | null; nota_processo: number | null; nota_clareza: number | null; nota_respeito: number | null; recomendaria: number | null; comentario: string | null }[]>`SELECT desfecho, nota_processo, nota_clareza, nota_respeito, recomendaria, comentario FROM candidate_experience
    WHERE created_at >= now() - (${meses} * interval '1 month') ${unitId === null ? sql`` : sql`AND unit_id=${unitId}`}`;
  const n = rows.length; if (n < minimo) return { n, minimo, liberado: false as const };
  const m = (k: "nota_processo" | "nota_clareza" | "nota_respeito") => media(rows.map(r => r[k]).filter((x): x is number => x !== null));
  const rec = rows.map(r => r.recomendaria).filter((x): x is number => x !== null);
  const nps = rec.length ? Math.round((100 * (rec.filter(x => x >= 9).length - rec.filter(x => x <= 6).length)) / rec.length) : null;
  const porDesfecho = ["CONTRATADO", "REPROVADO", "OUTRO"].map(d => { const l = rows.filter(r => (r.desfecho === "CONTRATADO" || r.desfecho === "REPROVADO" ? r.desfecho : "OUTRO") === d); return { desfecho: d, n: l.length, processo: l.length >= minimo ? media(l.map(r => r.nota_processo).filter((x): x is number => x !== null)) : null }; });
  return { n, minimo, liberado: true as const, processo: m("nota_processo"), clareza: m("nota_clareza"), respeito: m("nota_respeito"), nps, porDesfecho, comentarios: rows.map(r => r.comentario).filter((c): c is string => !!c && c.trim().length > 3).slice(-8) };
}

// ------------------------------------------------------------------ índice de qualidade da contratação
export type ContratacaoQ = { application_id: number; employee_id: number; nome: string; vaga: string; origem: string; admissao: string; desligamento: string | null; retencao: number | null; gestor: number | null; desempenho: number | null; indice: number | null; contrataria: boolean | null };
/**
 * Por contratação (até 24 meses): retenção (ficou o prazo = 100; saiu antes = 0; ainda no prazo = sem nota), gestor aos 90 dias
 * (nota 1–5 → 0–100) e 1ª avaliação de desempenho (1–5 → 0–100). Índice = média dos componentes disponíveis (pelo menos 2).
 */
export function indiceContratacao(c: { admissao: string; desligamento: string | null; notaGestor: number | null; nota1: number | null }, retencaoDias: number, h: string) {
  const fim = c.desligamento ?? h; const dias = (Date.parse(fim) - Date.parse(c.admissao)) / DIA;
  const retencao = c.desligamento && dias < retencaoDias ? 0 : dias >= retencaoDias ? 100 : null;
  const gestor = c.notaGestor ? ((c.notaGestor - 1) / 4) * 100 : null; const desempenho = c.nota1 ? ((Math.min(5, Math.max(1, c.nota1)) - 1) / 4) * 100 : null;
  const comps = [retencao, gestor, desempenho].filter((x): x is number => x !== null);
  return { retencao, gestor, desempenho, indice: comps.length >= 2 ? Math.round(comps.reduce((a, b) => a + b, 0) / comps.length) : null };
}
export async function qualidadeContratacoes(unitId: number | null, retencaoDias: number) {
  const h = hoje(); const uf = unitId === null ? sql`` : sql`AND r.unit_id=${unitId}`;
  const rows = await sql<{ application_id: number; employee_id: number; nome: string; vaga: string; origem: string; admissao: string; desligamento: string | null; nota_gestor: number | null; contrataria: boolean | null; nota1: number | null }[]>`
    SELECT a.id AS application_id, e.id AS employee_id, e.nome, r.titulo AS vaga, coalesce(c.origem,'OUTRO') AS origem, e.admissao::text, e.desligamento::text, f.nota AS nota_gestor, f.contrataria,
      (SELECT coalesce((pr.calc->>'N')::numeric, pr.nota_final)::float FROM perf_reviews pr WHERE pr.employee_id=e.id AND coalesce((pr.calc->>'N')::numeric, pr.nota_final) IS NOT NULL ORDER BY pr.id LIMIT 1) AS nota1
    FROM applications a JOIN employees e ON e.id=a.employee_id JOIN candidates c ON c.id=a.candidate_id JOIN requisitions r ON r.id=a.requisition_id LEFT JOIN hire_feedback f ON f.employee_id=e.id AND f.respondido_em IS NOT NULL
    WHERE a.etapa='CONTRATADO' AND e.situacao <> 'EM_ADMISSAO' AND e.admissao >= current_date - interval '24 months' ${uf} ORDER BY e.admissao DESC`;
  const lista: ContratacaoQ[] = rows.map(r => ({ application_id: r.application_id, employee_id: r.employee_id, nome: r.nome, vaga: r.vaga, origem: r.origem, admissao: r.admissao, desligamento: r.desligamento, contrataria: r.contrataria, ...indiceContratacao({ admissao: r.admissao, desligamento: r.desligamento, notaGestor: r.nota_gestor, nota1: r.nota1 }, retencaoDias, h) }));
  const comIndice = lista.filter(l => l.indice !== null);
  const porOrigem = [...new Set(lista.map(l => l.origem))].map(o => { const l = comIndice.filter(x => x.origem === o); return { origem: o, n: lista.filter(x => x.origem === o).length, comIndice: l.length, indice: media(l.map(x => x.indice!)) }; }).sort((a, b) => b.n - a.n);
  const respondidas = rows.filter(r => r.nota_gestor !== null);
  return { lista, indice: media(comIndice.map(x => x.indice!)), comIndice: comIndice.length, porOrigem, satisfacao: media(respondidas.map(r => r.nota_gestor!)), contratariaPct: respondidas.length ? respondidas.filter(r => r.contrataria).length / respondidas.length : null, respondidas: respondidas.length };
}

/** Texto da etapa para o quadro: há quantos dias a candidatura está nela. */
export const diasDesde = (iso: string | null | undefined) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso.includes("T") || iso.includes(" ") ? iso.replace(" ", "T") + (/[+Z]/.test(iso.slice(10)) ? "" : "Z") : `${iso}T12:00:00Z`)) / DIA)) : 0);
