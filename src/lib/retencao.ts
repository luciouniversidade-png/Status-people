// v27 · Movimentação e retenção: saídas por motivo (período × anterior), por gestor e tempo de casa, saídas no 1º ano,
// crescimento do quadro por unidade/área, estrutura de liderança (liderados por gestor) e desenvolvimento (PDI).
import { sql } from "@/db";
import { hoje } from "@/lib/utils";

const DIA = 86400000;
const faixaCasa = (dias: number) => dias < 90 ? "até 3 meses" : dias < 180 ? "3 a 6 meses" : dias < 365 ? "6 a 12 meses" : dias < 3 * 365 ? "1 a 3 anos" : dias < 5 * 365 ? "3 a 5 anos" : dias < 10 * 365 ? "5 a 10 anos" : "10+ anos";
export const FAIXAS_CASA = ["até 3 meses", "3 a 6 meses", "6 a 12 meses", "1 a 3 anos", "3 a 5 anos", "5 a 10 anos", "10+ anos"];
const normMotivo = (m: string | null) => { const t = (m ?? "").trim().replace(/\s+/g, " "); return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : "Sem motivo registrado"; };
const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function movimentacaoRetencao(unitId: number | null, meses: number) {
  const uf = unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`;
  const h = hoje(); const fim = new Date(h + "T12:00:00Z"); const ini = new Date(fim); ini.setUTCMonth(ini.getUTCMonth() - meses); const iniAnt = new Date(ini); iniAnt.setUTCMonth(iniAnt.getUTCMonth() - meses);
  const [pessoas, pdi] = await Promise.all([
    sql<{ id: number; nome: string; unidade: string; area: string | null; cargo: string | null; admissao: string; desligamento: string | null; motivo: string | null; situacao: string; gestor_id: number | null; gestor: string | null }[]>`SELECT e.id, e.nome, u.nome AS unidade, p.area, p.nome AS cargo, e.admissao::text, e.desligamento::text, e.motivo_desligamento AS motivo, e.situacao, e.gestor_id, g.nome AS gestor
      FROM employees e JOIN units u ON u.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id LEFT JOIN employees g ON g.id=e.gestor_id WHERE e.situacao <> 'EM_ADMISSAO' ${uf}`,
    sql<{ employee_id: number; planos: number; acoes: number; concluidas: number; atrasadas: number; paradas: number }[]>`SELECT p.employee_id, count(DISTINCT p.id)::int AS planos, count(a.id)::int AS acoes, count(a.id) FILTER (WHERE a.status='CONCLUIDA')::int AS concluidas,
      count(a.id) FILTER (WHERE a.status NOT IN ('CONCLUIDA','CANCELADA') AND a.prazo < current_date)::int AS atrasadas,
      count(a.id) FILTER (WHERE a.status = 'NAO_INICIADA' AND a.created_at < now() - interval '60 days')::int AS paradas
      FROM pdi_plans p JOIN employees e ON e.id=p.employee_id LEFT JOIN pdi_actions a ON a.plan_id=p.id AND a.status <> 'CANCELADA' WHERE p.status='ATIVO' AND e.situacao IN ('ATIVO','FERIAS','AFASTADO') ${uf} GROUP BY p.employee_id`,
  ]);
  const ativoEm = (p: typeof pessoas[number], d: string) => p.admissao <= d && (!p.desligamento || p.desligamento > d);
  const ativos = pessoas.filter(p => !p.desligamento && ["ATIVO", "FERIAS", "AFASTADO"].includes(p.situacao));
  const saiuEntre = (p: typeof pessoas[number], a: string, b: string) => !!p.desligamento && p.desligamento > a && p.desligamento <= b;
  const sP = pessoas.filter(p => saiuEntre(p, iso(ini), h)); const sA = pessoas.filter(p => saiuEntre(p, iso(iniAnt), iso(ini)));
  const admP = pessoas.filter(p => p.admissao > iso(ini) && p.admissao <= h);
  // mês a mês: quadro no fim do mês, entradas, saídas e taxa de rotação mensal (saídas ÷ quadro médio)
  const mensal: { mes: string; quadro: number; entradas: number; saidas: number; taxa: number | null }[] = [];
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(fim.getUTCFullYear(), fim.getUTCMonth() - i, 1)); const mes = iso(d).slice(0, 7); const prox = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)); const ultimo = iso(new Date(prox.getTime() - DIA)); const corte = ultimo > h ? h : ultimo;
    const qIni = pessoas.filter(p => ativoEm(p, iso(new Date(d.getTime() - DIA)))).length; const qFim = pessoas.filter(p => ativoEm(p, corte)).length;
    const saidas = pessoas.filter(p => p.desligamento && p.desligamento.slice(0, 7) === mes).length; const entradas = pessoas.filter(p => p.admissao.slice(0, 7) === mes).length;
    const medio = (qIni + qFim) / 2; mensal.push({ mes, quadro: qFim, entradas, saidas, taxa: medio ? saidas / medio : null });
  }
  const quadroMedio = mensal.length ? mensal.reduce((s, m) => s + m.quadro, 0) / mensal.length : 0;
  // motivos: período × período anterior
  const motivos = [...new Set([...sP, ...sA].map(p => normMotivo(p.motivo)))].map(m => { const a = sP.filter(p => normMotivo(p.motivo) === m).length, b = sA.filter(p => normMotivo(p.motivo) === m).length; return { motivo: m, atual: a, anterior: b, dif: b ? (a - b) / b : a ? null : 0 }; }).sort((x, y) => y.atual - x.atual || y.anterior - x.anterior);
  const porGestor = [...new Set(sP.map(p => p.gestor ?? "Sem gestor definido"))].map(g => { const saidas = sP.filter(p => (p.gestor ?? "Sem gestor definido") === g).length; const equipe = pessoas.filter(p => (p.gestor ?? "Sem gestor definido") === g && (ativoEm(p, iso(ini)) || p.admissao > iso(ini))).length; return { gestor: g, saidas, equipe, taxa: equipe ? saidas / equipe : null }; }).sort((x, y) => y.saidas - x.saidas);
  const porCasa = FAIXAS_CASA.map(f => ({ faixa: f, saidas: sP.filter(p => faixaCasa((Date.parse(p.desligamento!) - Date.parse(p.admissao)) / DIA) === f).length }));
  const primeiroAno = sP.filter(p => (Date.parse(p.desligamento!) - Date.parse(p.admissao)) / DIA < 365);
  // retenção 12 meses: de quem estava ativo há 12 meses, quantos seguem
  const ha12 = iso(new Date(fim.getTime() - 365 * DIA)); const base12 = pessoas.filter(p => ativoEm(p, ha12)); const ficaram12 = base12.filter(p => ativoEm(p, h)).length;
  // contratados há 12–24 meses: quantos completaram 1 ano
  const coorte = pessoas.filter(p => p.admissao > iso(new Date(fim.getTime() - 730 * DIA)) && p.admissao <= ha12); const completaram = coorte.filter(p => !p.desligamento || (Date.parse(p.desligamento) - Date.parse(p.admissao)) / DIA >= 365).length;
  // crescimento por unidade e por área (hoje × início do período)
  const cresce = (chave: (p: typeof pessoas[number]) => string) => [...new Set(pessoas.map(chave))].map(k => { const antes = pessoas.filter(p => chave(p) === k && ativoEm(p, iso(ini))).length; const agora = ativos.filter(p => chave(p) === k).length; return { nome: k, antes, agora, dif: agora - antes, pct: antes ? (agora - antes) / antes : null }; }).filter(x => x.antes || x.agora).sort((a, b) => b.dif - a.dif || b.agora - a.agora);
  // liderança: liderados diretos por gestor (ativos)
  const gestores = [...new Set(ativos.map(p => p.gestor_id).filter((x): x is number => !!x))].map(gid => { const g = pessoas.find(p => p.id === gid); const eq = ativos.filter(p => p.gestor_id === gid); return { id: gid, nome: g?.nome ?? `#${gid}`, cargo: g?.cargo ?? null, unidade: g?.unidade ?? "", ativo: !!g && !g.desligamento, liderados: eq.length, saidas: sP.filter(p => p.gestor_id === gid).length }; }).sort((a, b) => b.liderados - a.liderados);
  const semGestor = ativos.filter(p => !p.gestor_id).length; const ativosSet = new Set(ativos.map(p => p.id));
  const gestorInativo = gestores.filter(g => !g.ativo || !ativosSet.has(g.id));
  // desenvolvimento (PDI)
  const comPdi = pdi.length; const acoes = pdi.reduce((s, x) => s + x.acoes, 0); const concl = pdi.reduce((s, x) => s + x.concluidas, 0);
  const desenv = { ativos: ativos.length, comPdi, pctComPdi: ativos.length ? comPdi / ativos.length : null, acoes, concluidas: concl, pctConcl: acoes ? concl / acoes : null, atrasadas: pdi.reduce((s, x) => s + x.atrasadas, 0), paradas: pdi.reduce((s, x) => s + x.paradas, 0), pessoasAtrasadas: pdi.filter(x => x.atrasadas > 0).length };
  return {
    inicio: iso(ini), inicioAnterior: iso(iniAnt), mensal, motivos, porGestor, porCasa, primeiroAno: primeiroAno.map(p => ({ id: p.id, nome: p.nome, unidade: p.unidade, cargo: p.cargo, admissao: p.admissao, desligamento: p.desligamento!, motivo: normMotivo(p.motivo), dias: Math.round((Date.parse(p.desligamento!) - Date.parse(p.admissao)) / DIA) })),
    porUnidade: cresce(p => p.unidade), porArea: cresce(p => p.area ?? "Sem área"), gestores, semGestor, gestorInativo,
    kpi: { ativos: ativos.length, entradas: admP.length, saidas: sP.length, saidasAnt: sA.length, turnover: quadroMedio ? sP.length / quadroMedio : null, mediaMensal: mensal.length ? mensal.reduce((s, m) => s + (m.taxa ?? 0), 0) / mensal.length : null, retencao12: base12.length ? ficaram12 / base12.length : null, base12: base12.length, coorte: coorte.length, completaram1ano: coorte.length ? completaram / coorte.length : null, crescimento: (() => { const a = pessoas.filter(p => ativoEm(p, iso(ini))).length; return a ? (ativos.length - a) / a : null; })(), quadroInicio: pessoas.filter(p => ativoEm(p, iso(ini))).length,
      mediaLiderados: gestores.length ? gestores.reduce((s, g) => s + g.liderados, 0) / gestores.length : null, gestores: gestores.length },
    desenv,
  };
}

/** Pontos quentes por unidade (estilo "hot spots"): cruza clima (última pesquisa encerrada), saídas, saídas no 1º ano e PDI atrasado. */
export async function pontosQuentes(unitId: number | null, meses: number) {
  const [sv] = await sql<{ id: number; nome: string; perguntas: { id: string; dimensao: string; tipo: string }[]; minimo: number; fim: string }[]>`SELECT id, nome, perguntas, minimo_anonimato AS minimo, fim::text FROM climate_surveys WHERE status='ENCERRADA' AND tipo <> 'ENPS' ORDER BY fim DESC LIMIT 1`;
  const units = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ${unitId === null ? sql`` : sql`WHERE id=${unitId}`} ORDER BY nome`;
  const resp = sv ? await sql<{ unit_id: number | null; respostas: Record<string, number> }[]>`SELECT unit_id, respostas FROM climate_responses WHERE survey_id=${sv.id}` : [];
  const mov = await sql<{ unit_id: number; ativos: number; saidas: number; primeiro_ano: number; pdi_atrasado: number }[]>`SELECT u.id AS unit_id,
      (SELECT count(*) FROM employees e WHERE e.unit_id=u.id AND e.situacao IN ('ATIVO','FERIAS','AFASTADO'))::int AS ativos,
      (SELECT count(*) FROM employees e WHERE e.unit_id=u.id AND e.desligamento > current_date - (${meses} * interval '1 month'))::int AS saidas,
      (SELECT count(*) FROM employees e WHERE e.unit_id=u.id AND e.desligamento > current_date - (${meses} * interval '1 month') AND e.desligamento - e.admissao < 365)::int AS primeiro_ano,
      (SELECT count(DISTINCT p.employee_id) FROM pdi_plans p JOIN pdi_actions a ON a.plan_id=p.id JOIN employees e ON e.id=p.employee_id WHERE e.unit_id=u.id AND p.status='ATIVO' AND a.status NOT IN ('CONCLUIDA','CANCELADA') AND a.prazo < current_date)::int AS pdi_atrasado
    FROM units u ${unitId === null ? sql`` : sql`WHERE u.id=${unitId}`}`;
  const escala = sv ? sv.perguntas.filter(q => q.tipo === "ESCALA") : []; const dims = [...new Set(escala.map(q => q.dimensao))];
  const tTotal = mov.reduce((s, m) => s + m.saidas, 0) / Math.max(1, mov.reduce((s, m) => s + m.ativos, 0));
  return { pesquisa: sv ? { nome: sv.nome, fim: sv.fim } : null, linhas: units.map(u => {
    const rs = resp.filter(r => r.unit_id === u.id); const m = mov.find(x => x.unit_id === u.id)!;
    const fav = dims.map(d => { const v = rs.flatMap(r => escala.filter(q => q.dimensao === d).map(q => Number(r.respostas[q.id]))).filter(n => n >= 1); return { dimensao: d, n: rs.length, fav: rs.length >= (sv?.minimo ?? 5) && v.length ? v.filter(n => n >= 4).length / v.length : null }; });
    const alertas: { tipo: string; texto: string; acao: string }[] = [];
    for (const f of fav) if (f.fav !== null && f.fav < 0.6) alertas.push({ tipo: "Clima", texto: `${f.dimensao}: ${Math.round(f.fav * 100)}% favorável`, acao: "Conversa do líder com a equipe sobre este tema e uma ação no plano de ação do clima" });
    const taxa = m.ativos ? m.saidas / m.ativos : 0;
    if (m.saidas >= 2 && taxa > tTotal * 1.3) alertas.push({ tipo: "Saídas", texto: `${m.saidas} saídas (${Math.round(taxa * 100)}% do quadro) — acima da média da rede`, acao: "Entrevistas de desligamento e revisão dos motivos por gestor" });
    if (m.primeiro_ano > 0) alertas.push({ tipo: "1º ano", texto: `${m.primeiro_ano} saída(s) antes de completar 1 ano`, acao: "Rever integração (onboarding) e a origem dessas contratações" });
    if (m.pdi_atrasado > 0) alertas.push({ tipo: "Desenvolvimento", texto: `${m.pdi_atrasado} pessoa(s) com ação de PDI atrasada`, acao: "Check-in de PDI com o líder nas próximas 2 semanas" });
    return { unidade: u.nome, unitId: u.id, ativos: m.ativos, saidas: m.saidas, fav, alertas };
  }) };
}

/**
 * v27 · Fatores associados às saídas (ideia do “drivers of resignation” do Visier): taxa de saída de cada grupo (unidade, área, vínculo,
 * turno, regime, tempo de casa, idade, PDI e última avaliação) contra a taxa geral do período. Só grupos com pelo menos `minimo`
 * pessoas expostas entram — nada que identifique alguém. Associação, não causa: serve para saber onde conversar primeiro.
 */
export async function fatoresSaida(unitId: number | null, meses: number, minimo = 5) {
  const uf = unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`;
  const h = hoje(); const d = new Date(h + "T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() - meses); const ini = iso(d);
  const rows = await sql<{ id: number; unidade: string; area: string; vinculo: string; turno: string; regime: string; admissao: string; desligamento: string | null; nasc: string | null; tem_pdi: boolean; nota: number | null }[]>`SELECT e.id, u.nome AS unidade, coalesce(p.area, 'Sem cargo definido') AS area, e.vinculo, coalesce(nullif(e.turno, ''), 'Sem turno') AS turno, e.regime, e.admissao::text, e.desligamento::text, e.data_nascimento::text AS nasc,
      EXISTS (SELECT 1 FROM pdi_plans pp WHERE pp.employee_id=e.id) AS tem_pdi, (SELECT r.nota_final::float FROM perf_reviews r WHERE r.employee_id=e.id AND r.nota_final IS NOT NULL ORDER BY r.id DESC LIMIT 1) AS nota
    FROM employees e JOIN units u ON u.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id
    WHERE e.situacao <> 'EM_ADMISSAO' AND e.admissao <= ${h}::date AND (e.desligamento IS NULL OR e.desligamento > ${ini}::date) ${uf}`;
  const saiu = (r: typeof rows[number]) => !!r.desligamento && r.desligamento > ini && r.desligamento <= h;
  const total = rows.length; const saidas = rows.filter(saiu).length; const geral = total ? (100 * saidas) / total : null;
  const VINC: Record<string, string> = { CLT: "CLT", HORISTA: "Horista", ESTAGIARIO: "Estágio", PJ: "PJ", TEMPORARIO: "Temporário" };
  const idade = (n: string | null) => { if (!n) return null; const a = Math.floor((Date.parse(h) - Date.parse(n)) / (365.25 * DIA)); return a < 25 ? "até 24 anos" : a < 35 ? "25 a 34 anos" : a < 45 ? "35 a 44 anos" : a < 55 ? "45 a 54 anos" : "55 anos ou mais"; };
  const casa = (r: typeof rows[number]) => { if (r.admissao > ini) return "contratados no período"; const dd = (Date.parse(ini) - Date.parse(r.admissao)) / DIA; return dd < 365 ? "menos de 1 ano" : dd < 3 * 365 ? "1 a 3 anos" : dd < 5 * 365 ? "3 a 5 anos" : "5 anos ou mais"; };
  const nota = (v: number | null) => v === null ? "sem avaliação" : v < 3 ? "abaixo de 3" : v < 4 ? "de 3 a 4" : "4 ou mais";
  const dims: { dim: string; de: (r: typeof rows[number]) => string | null }[] = [
    { dim: "Unidade", de: r => r.unidade }, { dim: "Área", de: r => r.area }, { dim: "Vínculo", de: r => VINC[r.vinculo] ?? r.vinculo }, { dim: "Turno", de: r => r.turno },
    { dim: "Regime", de: r => r.regime === "DOCENTE" ? "Docentes" : "Administrativo e apoio" }, { dim: "Tempo de casa", de: casa }, { dim: "Idade", de: r => idade(r.nasc) },
    { dim: "PDI", de: r => r.tem_pdi ? "com PDI" : "sem PDI" }, { dim: "Última avaliação", de: r => nota(r.nota) },
  ];
  const grupos: { dim: string; grupo: string; n: number; saidas: number; taxa: number; delta: number }[] = [];
  if (geral !== null) for (const { dim, de } of dims) {
    const m = new Map<string, { n: number; s: number }>(); for (const r of rows) { const g = de(r); if (!g) continue; const x = m.get(g) ?? { n: 0, s: 0 }; x.n++; if (saiu(r)) x.s++; m.set(g, x); }
    if (m.size < 2) continue; // um grupo só não compara nada
    for (const [g, x] of m) if (x.n >= minimo) { const taxa = (100 * x.s) / x.n; grupos.push({ dim, grupo: g, n: x.n, saidas: x.s, taxa, delta: taxa - geral }); }
  }
  grupos.sort((a, b) => b.delta - a.delta);
  return { geral, total, saidas, minimo, aumentam: grupos.filter(g => g.delta > 0.05).slice(0, 8), diminuem: grupos.filter(g => g.delta < -0.05).slice(-6).reverse() };
}
