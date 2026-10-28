// v26 · Indicadores de recrutamento: tempo, prazo (SLA), conversão por etapa, origem, qualidade e retenção das contratações
import { sql } from "@/db";

type Ev = { application_id: number; at: Date; texto: string };
const DIA = 86400000;
const etapaDoEvento = (t: string) => { const m = t.match(/^(?:Shortlist: avançou )?→ ([A-Z_]+)/); if (m) return m[1]; if (/^Reprovado|^Shortlist: reprovado/.test(t)) return "REPROVADO"; if (/^Desistiu/.test(t)) return "DESISTIU"; return null; };

export async function indicadoresRecrutamento(unitId: number | null, meses: number, cfg: { etapas: string[]; slaTriagemDias: number; slaVagaDias: number; retencaoDias: number }) {
  const uf = unitId === null ? sql`` : sql`AND r.unit_id=${unitId}`;
  const inicio = new Date(); inicio.setMonth(inicio.getMonth() - meses); inicio.setDate(1); inicio.setHours(0, 0, 0, 0); const ini = inicio.toISOString().slice(0, 10);
  const [apps, evs, vagas, decisoes, contratados] = await Promise.all([
    sql<{ id: number; requisition_id: number; etapa: string; created_at: Date; updated_at: Date; origem: string | null; motivo: string | null; score: number | null; sugerido_calc: boolean | null; nome: string; candidate_id: number; vaga: string }[]>`SELECT a.id, a.requisition_id, a.etapa, a.created_at, a.updated_at, coalesce(c.origem,'OUTRO') AS origem, a.motivo_reprovacao AS motivo, f.score, (f.obrigatorios_faltando = 0) AS sugerido_calc, c.nome, c.id AS candidate_id, r.titulo AS vaga
      FROM applications a JOIN candidates c ON c.id=a.candidate_id JOIN requisitions r ON r.id=a.requisition_id LEFT JOIN application_fit f ON f.application_id=a.id
      WHERE (a.created_at >= ${ini} OR a.etapa NOT IN ('REPROVADO','DESISTIU','CONTRATADO')) ${uf}`,
    sql<Ev[]>`SELECT e.application_id, e.at, e.texto FROM application_events e JOIN applications a ON a.id=e.application_id JOIN requisitions r ON r.id=a.requisition_id WHERE (a.created_at >= ${ini} OR a.etapa NOT IN ('REPROVADO','DESISTIU','CONTRATADO')) ${uf} ORDER BY e.application_id, e.at`,
    sql<{ id: number; titulo: string; unidade: string; status: string; aberta_em: string | null; fechada_em: string | null; prazo: string | null; created_at: Date; ativos: number; total: number; ultima: Date | null }[]>`SELECT r.id, r.titulo, u.nome AS unidade, r.status, r.aberta_em::text, r.fechada_em::text, r.prazo::text, r.created_at,
      (SELECT count(*) FROM applications a WHERE a.requisition_id=r.id AND a.etapa NOT IN ('REPROVADO','DESISTIU','CONTRATADO'))::int AS ativos, (SELECT count(*) FROM applications a WHERE a.requisition_id=r.id)::int AS total,
      (SELECT max(e.at) FROM application_events e JOIN applications a ON a.id=e.application_id WHERE a.requisition_id=r.id) AS ultima
      FROM requisitions r JOIN units u ON u.id=r.unit_id WHERE (r.status IN ('ABERTA','SOLICITADA','APROVADA','PAUSADA') OR r.fechada_em >= ${ini} OR r.created_at >= ${ini}) ${uf} ORDER BY r.created_at`,
    sql<{ decisao: string; divergiu: boolean; decidido_nome: string | null; score: number | null }[]>`SELECT d.decisao, d.divergiu, d.decidido_nome, d.score_no_momento AS score FROM shortlist_decisions d JOIN applications a ON a.id=d.application_id JOIN requisitions r ON r.id=a.requisition_id WHERE d.decidido_em >= ${ini} ${uf}`,
    sql<{ application_id: number; nome: string; vaga: string; origem: string | null; admissao: string | null; desligamento: string | null; employee_id: number; score: number | null }[]>`SELECT a.id AS application_id, e.nome, r.titulo AS vaga, coalesce(c.origem,'OUTRO') AS origem, e.admissao::text, e.desligamento::text, e.id AS employee_id, f.score
      FROM applications a JOIN employees e ON e.id=a.employee_id JOIN candidates c ON c.id=a.candidate_id JOIN requisitions r ON r.id=a.requisition_id LEFT JOIN application_fit f ON f.application_id=a.id WHERE a.etapa='CONTRATADO' AND e.admissao >= ${ini} ${uf} ORDER BY e.admissao DESC`,
  ]);
  const agora = Date.now(); const porApp = new Map<number, Ev[]>(); for (const e of evs) { const l = porApp.get(e.application_id) ?? []; l.push(e); porApp.set(e.application_id, l); }
  // tempo em cada etapa (entrada → saída), conversão e paradas
  const ordem = cfg.etapas; const tempo: Record<string, number[]> = {}; const alcancou: Record<string, number> = {}; const parados: { id: number; nome: string; candidate_id: number; vaga: string; requisition_id: number; etapa: string; dias: number }[] = [];
  for (const a of apps) {
    let etapa = ordem[0]; let desde = new Date(a.created_at).getTime(); let maxIdx = 0;
    for (const e of porApp.get(a.id) ?? []) { const nova = etapaDoEvento(e.texto); if (!nova || nova === etapa) continue; (tempo[etapa] ??= []).push((new Date(e.at).getTime() - desde) / DIA); etapa = nova; desde = new Date(e.at).getTime(); const i = ordem.indexOf(nova); if (i > maxIdx) maxIdx = i; }
    const atual = ordem.indexOf(a.etapa); if (atual > maxIdx) maxIdx = atual;
    if (new Date(a.created_at) >= inicio) for (let i = 0; i <= maxIdx; i++) alcancou[ordem[i]] = (alcancou[ordem[i]] ?? 0) + 1;
    if (!["REPROVADO", "DESISTIU", "CONTRATADO"].includes(a.etapa)) { const dias = (agora - desde) / DIA; const lim = a.etapa === ordem[0] ? cfg.slaTriagemDias : 7; if (dias > lim) parados.push({ id: a.id, nome: a.nome, candidate_id: a.candidate_id, vaga: a.vaga, requisition_id: a.requisition_id, etapa: a.etapa, dias: Math.floor(dias) }); }
  }
  const med = (v: number[]) => v.length ? v.reduce((x, y) => x + y, 0) / v.length : null;
  const mediana = (v: number[]) => { if (!v.length) return null; const s = [...v].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const porEtapa = ordem.filter(e => e !== "CONTRATADO").map(e => ({ etapa: e, n: tempo[e]?.length ?? 0, media: med(tempo[e] ?? []), mediana: mediana(tempo[e] ?? []) }));
  const funil = ordem.map((e, i) => ({ etapa: e, n: alcancou[e] ?? 0, conv: i === 0 ? null : (alcancou[ordem[i - 1]] ? (alcancou[e] ?? 0) / alcancou[ordem[i - 1]] : null) }));
  // vagas: tempo para preencher, prazo e projeção
  const fechadas = vagas.filter(v => v.status === "PREENCHIDA" && v.aberta_em && v.fechada_em && v.fechada_em >= ini);
  const diasFech = fechadas.map(v => (new Date(v.fechada_em!).getTime() - new Date(v.aberta_em!).getTime()) / DIA);
  const tMedio = med(diasFech); const noPrazo = fechadas.filter(v => v.prazo ? v.fechada_em! <= v.prazo : (new Date(v.fechada_em!).getTime() - new Date(v.aberta_em!).getTime()) / DIA <= cfg.slaVagaDias).length;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const abertas = vagas.filter(v => v.status === "ABERTA").map(v => { const desde = v.aberta_em ? new Date(v.aberta_em) : new Date(v.created_at); const dias = Math.floor((hoje.getTime() - desde.getTime()) / DIA); const limite = v.prazo ? new Date(v.prazo) : new Date(desde.getTime() + cfg.slaVagaDias * DIA); const previsao = new Date(desde.getTime() + (tMedio ?? cfg.slaVagaDias) * DIA);
    return { ...v, dias, atrasada: hoje > limite, limite: limite.toISOString().slice(0, 10), previsao: (previsao < hoje ? hoje : previsao).toISOString().slice(0, 10), parada: v.ultima ? Math.floor((agora - new Date(v.ultima).getTime()) / DIA) : dias }; });
  // mensal
  const mesesLista: string[] = []; for (let d = new Date(inicio); d <= new Date(); d.setMonth(d.getMonth() + 1)) mesesLista.push(d.toISOString().slice(0, 7));
  const contratEv = evs.filter(e => etapaDoEvento(e.texto) === "CONTRATADO");
  const mensal = mesesLista.map(m => ({ mes: m, candidaturas: apps.filter(a => new Date(a.created_at).toISOString().slice(0, 7) === m).length, contratacoes: contratEv.filter(e => new Date(e.at).toISOString().slice(0, 7) === m).length, abertas: vagas.filter(v => (v.aberta_em ?? "").slice(0, 7) === m).length, preenchidas: vagas.filter(v => v.status === "PREENCHIDA" && (v.fechada_em ?? "").slice(0, 7) === m).length }));
  // origem e qualidade
  const noPeriodo = apps.filter(a => new Date(a.created_at) >= inicio);
  const origens = [...new Set(noPeriodo.map(a => a.origem ?? "OUTRO"))].map(o => { const l = noPeriodo.filter(a => a.origem === o); const ct = contratados.filter(c => c.origem === o); return { origem: o, candidaturas: l.length, contratados: l.filter(a => a.etapa === "CONTRATADO").length, naoFicaram: ct.filter(c => c.desligamento && c.admissao && (new Date(c.desligamento).getTime() - new Date(c.admissao).getTime()) / DIA <= cfg.retencaoDias).length }; }).sort((x, y) => y.candidaturas - x.candidaturas);
  const grupo = (f: (a: typeof apps[number]) => boolean) => { const l = noPeriodo.filter(a => f(a) && a.score !== null).map(a => a.score as number); return { n: l.length, media: med(l) }; };
  const qualidade = { contratados: grupo(a => a.etapa === "CONTRATADO"), reprovados: grupo(a => a.etapa === "REPROVADO"), emProcesso: grupo(a => !["REPROVADO", "DESISTIU", "CONTRATADO"].includes(a.etapa)) };
  const motivos = Object.entries(noPeriodo.filter(a => a.etapa === "REPROVADO").reduce<Record<string, number>>((acc, a) => { const k = (a.motivo ?? "sem motivo registrado").trim().toLowerCase().replace(/^./, c => c.toUpperCase()); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {})).sort((x, y) => y[1] - x[1]).slice(0, 8);
  const naoFicaram = contratados.filter(c => c.desligamento && c.admissao && (new Date(c.desligamento).getTime() - new Date(c.admissao).getTime()) / DIA <= cfg.retencaoDias).map(c => ({ ...c, dias: Math.round((new Date(c.desligamento!).getTime() - new Date(c.admissao!).getTime()) / DIA) }));
  // base: quem já completou o prazo ou já saiu dentro dele (quem entrou há pouco e segue ativo ainda não conta)
  const maduros = contratados.filter(c => c.admissao && ((agora - new Date(c.admissao).getTime()) / DIA >= cfg.retencaoDias || naoFicaram.some(n => n.application_id === c.application_id)));
  const retencao = maduros.length ? maduros.filter(c => !naoFicaram.some(n => n.application_id === c.application_id)).length / maduros.length : null;
  const dec = { total: decisoes.length, divergiu: decisoes.filter(d => d.divergiu).length, porDecisao: ["AVANCAR", "RESERVAR", "REPROVAR"].map(k => ({ k, n: decisoes.filter(d => d.decisao === k).length })) };
  const encerradas = noPeriodo.filter(a => ["REPROVADO", "DESISTIU", "CONTRATADO"].includes(a.etapa)).length;
  const vagasPeriodo = vagas.filter(v => new Date(v.created_at) >= inicio);
  return {
    inicio: ini, mensal, porEtapa, funil, abertas, parados: parados.sort((x, y) => y.dias - x.dias), origens, qualidade, motivos, naoFicaram, retencao, dec, contratadosLista: contratados,
    kpi: { abertas: abertas.length, atrasadas: abertas.filter(a => a.atrasada).length, contratacoes: contratEv.filter(e => new Date(e.at) >= inicio).length, tempoMedio: tMedio, tempoMediano: mediana(diasFech), preenchidas: fechadas.length, noPrazo: fechadas.length ? noPrazo / fechadas.length : null,
      candidaturas: noPeriodo.length, porVaga: vagasPeriodo.length ? vagasPeriodo.reduce((s, v) => s + v.total, 0) / vagasPeriodo.length : null, aproveitamento: encerradas ? noPeriodo.filter(a => a.etapa === "CONTRATADO").length / encerradas : null, parados: parados.length },
  };
}

/** v27 · Qualidade da contratação: contratados nos últimos 24 meses — quantos seguem ativos e como foram na 1ª avaliação de desempenho. */
export async function qualidadeContratacao(unitId: number | null) {
  const uf = unitId === null ? sql`` : sql`AND r.unit_id=${unitId}`;
  const rows = await sql<{ origem: string; ativo: boolean; nota1: number | null }[]>`SELECT coalesce(c.origem,'OUTRO') AS origem, (e.desligamento IS NULL AND e.situacao <> 'DESLIGADO') AS ativo,
      (SELECT pr.nota_final::float FROM perf_reviews pr WHERE pr.employee_id=e.id AND pr.nota_final IS NOT NULL ORDER BY pr.id LIMIT 1) AS nota1
    FROM applications a JOIN employees e ON e.id=a.employee_id JOIN candidates c ON c.id=a.candidate_id JOIN requisitions r ON r.id=a.requisition_id
    WHERE a.etapa='CONTRATADO' AND e.admissao >= current_date - interval '24 months' ${uf}`;
  const [{ media }] = await sql<{ media: number | null }[]>`SELECT avg(x.n)::float AS media FROM (SELECT DISTINCT ON (pr.employee_id) pr.nota_final::float AS n FROM perf_reviews pr JOIN employees e ON e.id=pr.employee_id WHERE pr.nota_final IS NOT NULL ${unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`} ORDER BY pr.employee_id, pr.id DESC) x`;
  const av = rows.filter(r => r.nota1 != null).map(r => r.nota1 as number); const m = (v: number[]) => v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  const origens = [...new Set(rows.map(r => r.origem))].map(o => { const l = rows.filter(r => r.origem === o); const n = l.filter(r => r.nota1 != null).map(r => r.nota1 as number); return { origem: o, contratados: l.length, ativos: l.filter(r => r.ativo).length, nota: m(n), avaliados: n.length }; }).sort((a, b) => b.contratados - a.contratados);
  return { contratados: rows.length, ativos: rows.filter(r => r.ativo).length, avaliados: av.length, nota1: m(av), mediaCasa: media, origens };
}

/** v27 · Funil de uma vaga: quantos chegaram a cada etapa, quantos saíram em cada uma e o tempo médio nela. */
export async function funilVaga(rid: number, etapas: string[]) {
  const apps = await sql<{ id: number; etapa: string; created_at: Date }[]>`SELECT id, etapa, created_at FROM applications WHERE requisition_id=${rid}`;
  const evs = apps.length ? await sql<Ev[]>`SELECT application_id, at, texto FROM application_events WHERE application_id = ANY(${apps.map(a => a.id)}::int[]) ORDER BY application_id, at` : [];
  const chegou: Record<string, number> = {}; const saiu: Record<string, number> = {}; const tempo: Record<string, number[]> = {}; const agora = Date.now();
  for (const a of apps) {
    let etapa = etapas[0]; let desde = new Date(a.created_at).getTime(); const passou = new Set([etapa]);
    for (const e of evs.filter(x => x.application_id === a.id)) { const nova = etapaDoEvento(e.texto); if (!nova || nova === etapa) continue; (tempo[etapa] ??= []).push((new Date(e.at).getTime() - desde) / DIA); if (["REPROVADO", "DESISTIU"].includes(nova)) { saiu[etapa] = (saiu[etapa] ?? 0) + 1; } else { const i = etapas.indexOf(nova); for (let k = 0; k <= i; k++) passou.add(etapas[k]); } etapa = nova; desde = new Date(e.at).getTime(); }
    const i = etapas.indexOf(a.etapa); for (let k = 0; k <= i; k++) passou.add(etapas[k]);
    if (!["REPROVADO", "DESISTIU", "CONTRATADO"].includes(a.etapa)) (tempo[a.etapa] ??= []).push((agora - desde) / DIA);
    passou.forEach(p => { chegou[p] = (chegou[p] ?? 0) + 1; });
  }
  const total = apps.length;
  return { total, etapas: etapas.map(e => ({ etapa: e, chegou: chegou[e] ?? 0, pct: total ? (chegou[e] ?? 0) / total : 0, saiu: saiu[e] ?? 0, dias: tempo[e]?.length ? tempo[e].reduce((x, y) => x + y, 0) / tempo[e].length : null })) };
}
