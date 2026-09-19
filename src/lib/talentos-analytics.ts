import { sql } from "@/db";
import { hoje, addDays, getSettings } from "./utils";
import { matrizTreinamento } from "./clima-academy";

export const PRONTIDAO: Record<string, string> = { PRONTO: "Pronto agora", UM_DOIS_ANOS: "Pronto em 1–2 anos", EM_DESENVOLVIMENTO: "Em desenvolvimento" };
export const CLASSIF: Record<string, string> = { TALENTO_CHAVE: "Talento-chave", ALTO_POTENCIAL: "Alto potencial", SOLIDO: "Sólido", ATENCAO: "Atenção" };
export const NIVEL3: Record<string, string> = { BAIXO: "Baixo", MEDIO: "Médio", ALTO: "Alto" };

// ---------------- SUCESSÃO ----------------
export async function mapaSucessao(unitId: number | null) {
  const posicoes = await sql<{ id: number; cargo: string; position_id: number; unidade: string | null; unit_id: number | null; titular: string | null; titular_id: number | null; criticidade: number; risco_saida: string; motivo: string | null; contingencia: string | null; sucessores: { id: number; nome: string; employee_id: number; prontidao: string; plano: string | null }[] }[]>`
    SELECT cp.id, p.nome AS cargo, cp.position_id, un.nome AS unidade, cp.unit_id, e.nome AS titular, cp.titular_employee_id AS titular_id, cp.criticidade, cp.risco_saida, cp.motivo, cp.contingencia,
      coalesce((SELECT json_agg(json_build_object('id', s.id, 'nome', se.nome, 'employee_id', s.employee_id, 'prontidao', s.prontidao, 'plano', s.plano) ORDER BY s.prontidao='PRONTO' DESC, s.prontidao='UM_DOIS_ANOS' DESC) FROM successors s JOIN employees se ON se.id=s.employee_id WHERE s.critical_position_id=cp.id AND s.ativo AND se.situacao <> 'DESLIGADO'), '[]'::json) AS sucessores
    FROM critical_positions cp JOIN positions p ON p.id=cp.position_id LEFT JOIN units un ON un.id=cp.unit_id LEFT JOIN employees e ON e.id=cp.titular_employee_id
    WHERE 1=1 ${unitId === null ? sql`` : sql`AND (cp.unit_id IS NULL OR cp.unit_id=${unitId})`} ORDER BY cp.criticidade DESC, p.ordem`;
  const comPronto = posicoes.filter(p => p.sucessores.some(s => s.prontidao === "PRONTO")).length; const semSucessor = posicoes.filter(p => p.sucessores.length === 0).length;
  return { posicoes, bench: posicoes.length ? Math.round(100 * comPronto / posicoes.length) : null, comPronto, semSucessor };
}

/** Bus factor: dependências de uma única pessoa. */
export async function busFactor(unitId: number | null) {
  const [pops, controles, unicos, semSuc] = await Promise.all([
    sql<{ nome: string; n: number; itens: string }[]>`SELECT u.nome, count(*)::int AS n, string_agg(p.codigo, ', ' ORDER BY p.codigo) AS itens FROM procedures p JOIN users u ON u.id=p.owner_user_id WHERE p.status='VIGENTE' GROUP BY u.nome HAVING count(*) >= 3 ORDER BY n DESC`,
    sql<{ nome: string; n: number }[]>`SELECT u.nome, count(*)::int AS n FROM controls c JOIN users u ON u.id=c.responsavel_user_id WHERE c.ativo GROUP BY u.nome HAVING count(*) >= 3 ORDER BY n DESC`,
    sql<{ cargo: string; unidade: string; nome: string; employee_id: number }[]>`SELECT p.nome AS cargo, un.nome AS unidade, e.nome, e.id AS employee_id FROM employees e JOIN positions p ON p.id=e.position_id JOIN units un ON un.id=e.unit_id WHERE e.situacao='ATIVO' AND p.area IN ('Direção','Administrativa') ${unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`} AND (SELECT count(*) FROM employees e2 WHERE e2.position_id=e.position_id AND e2.unit_id=e.unit_id AND e2.situacao='ATIVO')=1 ORDER BY p.ordem`,
    sql<{ cargo: string; unidade: string | null }[]>`SELECT p.nome AS cargo, un.nome AS unidade FROM critical_positions cp JOIN positions p ON p.id=cp.position_id LEFT JOIN units un ON un.id=cp.unit_id WHERE NOT EXISTS (SELECT 1 FROM successors s WHERE s.critical_position_id=cp.id AND s.ativo) ${unitId === null ? sql`` : sql`AND (cp.unit_id IS NULL OR cp.unit_id=${unitId})`}`,
  ]);
  return { pops, controles, unicos, semSuc };
}

/** Sinais por colaborador para o talent review e o People Risk Center. */
export async function sinaisPessoas(unitId: number | null) {
  const cfg = await getSettings(); const h = hoje();
  const rows = await sql<{ id: number; nome: string; unidade: string; cargo: string | null; nivel: string | null; admissao: string; salario: number | null; g_min: number | null; g_medio: number | null; g_max: number | null; nota: number | null; potencial: number | null; desempenho: number | null; ultimo_reajuste: string | null; faltas_90: number; saldo_banco: number; pdi_atrasado: number; venc_trein: number; ultimo_1a1: string | null; classificacao: string | null }[]>`
    SELECT e.id, e.nome, un.nome AS unidade, p.nome AS cargo, e.nivel, e.admissao::text, e.salario::float, g.minimo::float AS g_min, g.medio::float AS g_medio, g.maximo::float AS g_max,
      r.nota_final::float AS nota, r.potencial, r.desempenho_nivel AS desempenho,
      (SELECT max(data)::text FROM salary_history sh WHERE sh.employee_id=e.id AND sh.motivo <> 'ADMISSAO') AS ultimo_reajuste,
      (SELECT count(*) FROM timesheet_days t WHERE t.employee_id=e.id AND t.status='FALTA' AND t.data >= ${h}::date - 90)::int AS faltas_90,
      coalesce((SELECT sum(minutos) FROM hour_entries hh WHERE hh.employee_id=e.id AND hh.status='APROVADO'),0)::int AS saldo_banco,
      coalesce((SELECT count(*) FROM perf_reviews pr, jsonb_array_elements(coalesce(pr.pdi,'[]'::jsonb)) it WHERE pr.employee_id=e.id AND it->>'status'<>'CONCLUIDA' AND (it->>'prazo') IS NOT NULL AND (it->>'prazo') <> '' AND (it->>'prazo')::date < ${h}),0)::int AS pdi_atrasado,
      (SELECT count(*) FROM training_progress tp WHERE tp.employee_id=e.id AND tp.status='CONCLUIDO' AND tp.valido_ate < ${h})::int AS venc_trein,
      (SELECT max(data)::text FROM perf_checkins k WHERE k.employee_id=e.id) AS ultimo_1a1,
      (SELECT ti.classificacao FROM talent_review_items ti JOIN talent_reviews tr ON tr.id=ti.review_id WHERE ti.employee_id=e.id ORDER BY tr.data DESC LIMIT 1) AS classificacao
    FROM employees e JOIN units un ON un.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id LEFT JOIN salary_grades g ON g.id=p.grade_id
    LEFT JOIN LATERAL (SELECT pr.nota_final, pr.potencial, pr.desempenho_nivel FROM perf_reviews pr JOIN perf_cycles pc ON pc.id=pr.cycle_id WHERE pr.employee_id=e.id AND pc.status='ENCERRADO' ORDER BY pc.fim DESC LIMIT 1) r ON true
    WHERE e.situacao='ATIVO' ${unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`} ORDER BY un.nome, e.nome`;
  const doisAnos = addDays(h, -730), umAno = addDays(h, -365), seisMeses = addDays(h, -180), noventa = addDays(h, -90);
  return rows.map(r => {
    const f: { peso: number; texto: string }[] = [];
    if (r.salario !== null && r.g_min !== null && r.salario < r.g_min) f.push({ peso: 30, texto: "salário abaixo do mínimo da faixa" });
    else if (r.salario !== null && r.g_medio !== null && r.salario < 0.9 * r.g_medio) f.push({ peso: 15, texto: "salário abaixo de 90% do ponto médio" });
    if ((r.desempenho ?? 0) === 3 && (!r.ultimo_reajuste || r.ultimo_reajuste < umAno) && r.admissao < umAno) f.push({ peso: 20, texto: "alto desempenho sem reajuste há mais de 1 ano" });
    if ((r.potencial ?? 0) === 3 && (r.desempenho ?? 0) === 3) f.push({ peso: 10, texto: "talento estratégico (alta demanda no mercado)" });
    if (r.faltas_90 >= 3) f.push({ peso: 20, texto: `${r.faltas_90} faltas em 90 dias` });
    if (r.saldo_banco < -20 * 60) f.push({ peso: 10, texto: "débito de banco de horas acima de 20 h" });
    if (r.pdi_atrasado) f.push({ peso: 10, texto: "PDI com ações atrasadas" });
    if (r.venc_trein) f.push({ peso: 10, texto: "treinamento obrigatório vencido" });
    if (r.admissao > seisMeses) f.push({ peso: 10, texto: "menos de 6 meses de casa" });
    if (!r.ultimo_1a1 || r.ultimo_1a1 < noventa) f.push({ peso: 10, texto: "sem conversa 1:1 nos últimos 90 dias" });
    if ((r.desempenho ?? 0) === 1) f.push({ peso: 15, texto: "desempenho baixo no último ciclo" });
    if (r.classificacao === "ATENCAO") f.push({ peso: 10, texto: "classificado como atenção no talent review" });
    const pontos = f.reduce((a, x) => a + x.peso, 0);
    const sugestao = (r.potencial ?? 0) === 3 && (r.desempenho ?? 0) === 3 ? "TALENTO_CHAVE" : (r.potencial ?? 0) === 3 ? "ALTO_POTENCIAL" : (r.desempenho ?? 0) === 1 ? "ATENCAO" : "SOLIDO";
    return { ...r, tempoCasaAnos: Math.floor((Date.parse(h) - Date.parse(r.admissao)) / (365.25 * 86400000)), fatores: f, pontos, nivel: pontos >= 40 ? "ALTO" : pontos >= 20 ? "MEDIO" : "BAIXO", sugestao, antigo: r.admissao < doisAnos };
  });
}

// ---------------- PEOPLE ANALYTICS ----------------
export async function peopleHealth(unitId: number | null) {
  const cfg = await getSettings(); const h = hoje(); const uf = unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`;
  const [[hc], [tv], [abs], [banco], [enps], [des], [vagas], meses, [custo], porCargo] = await Promise.all([
    sql<{ ativos: number; admitidos_12: number }[]>`SELECT count(*) FILTER (WHERE e.situacao='ATIVO')::int AS ativos, count(*) FILTER (WHERE e.admissao >= ${h}::date - 365)::int AS admitidos_12 FROM employees e WHERE 1=1 ${uf}`,
    sql<{ desligados_12: number }[]>`SELECT count(*)::int AS desligados_12 FROM employees e WHERE e.situacao='DESLIGADO' AND e.desligamento >= ${h}::date - 365 ${uf}`,
    sql<{ faltas: number; esperados: number }[]>`SELECT count(*) FILTER (WHERE t.status='FALTA')::int AS faltas, count(*) FILTER (WHERE t.esperado_min > 0)::int AS esperados FROM timesheet_days t JOIN employees e ON e.id=t.employee_id WHERE t.data >= ${h}::date - 90 ${uf}`,
    sql<{ debito_medio: number | null; devedores: number }[]>`SELECT avg(x.saldo) FILTER (WHERE x.saldo < 0)::float AS debito_medio, count(*) FILTER (WHERE x.saldo < -20*60)::int AS devedores FROM (SELECT e.id, coalesce(sum(hh.minutos),0) AS saldo FROM employees e LEFT JOIN hour_entries hh ON hh.employee_id=e.id AND hh.status='APROVADO' WHERE e.situacao='ATIVO' ${uf} GROUP BY e.id) x`,
    sql<{ enps: number | null; nome: string | null }[]>`SELECT (CASE WHEN count(*) >= sv.minimo_anonimato THEN round(100.0*(count(*) FILTER (WHERE (r.respostas->>'enps')::int >= 9) - count(*) FILTER (WHERE (r.respostas->>'enps')::int <= 6))/count(*)) END)::int AS enps, sv.nome FROM climate_surveys sv LEFT JOIN climate_responses r ON r.survey_id=sv.id AND r.respostas ? 'enps' ${unitId === null ? sql`` : sql`AND r.unit_id=${unitId}`} WHERE sv.status='ENCERRADA' GROUP BY sv.id ORDER BY sv.fim DESC LIMIT 1`,
    sql<{ media: number | null; ciclo: string | null }[]>`SELECT avg(r.nota_final)::float AS media, pc.nome AS ciclo FROM perf_reviews r JOIN perf_cycles pc ON pc.id=r.cycle_id JOIN employees e ON e.id=r.employee_id WHERE pc.status='ENCERRADO' ${uf} GROUP BY pc.id ORDER BY pc.fim DESC LIMIT 1`,
    sql<{ abertas: number }[]>`SELECT coalesce(sum(r.quantidade),0)::int AS abertas FROM requisitions r WHERE r.status='ABERTA' ${unitId === null ? sql`` : sql`AND r.unit_id=${unitId}`}`,
    sql<{ mes: string; admissoes: number; desligamentos: number }[]>`SELECT m.mes, (SELECT count(*) FROM employees e WHERE to_char(e.admissao,'YYYY-MM')=m.mes ${uf})::int AS admissoes, (SELECT count(*) FROM employees e WHERE e.situacao='DESLIGADO' AND to_char(e.desligamento,'YYYY-MM')=m.mes ${uf})::int AS desligamentos FROM (SELECT to_char(generate_series(date_trunc('month', ${h}::date) - interval '11 months', date_trunc('month', ${h}::date), interval '1 month'),'YYYY-MM') AS mes) m ORDER BY m.mes`,
    sql<{ folha: number | null; media: number | null; com_salario: number }[]>`SELECT sum(e.salario)::float AS folha, avg(e.salario)::float AS media, count(e.salario)::int AS com_salario FROM employees e WHERE e.situacao='ATIVO' ${uf}`,
    sql<{ cargo: string; n: number; folha: number | null }[]>`SELECT coalesce(p.nome,'(sem cargo)') AS cargo, count(*)::int AS n, sum(e.salario)::float AS folha FROM employees e LEFT JOIN positions p ON p.id=e.position_id WHERE e.situacao='ATIVO' ${uf} GROUP BY 1 ORDER BY 3 DESC NULLS LAST LIMIT 12`,
  ]);
  const { pesos, metas } = cfg.analytics; const m = await matrizTreinamento(unitId);
  const turnover = hc.ativos ? Math.round(1000 * tv.desligados_12 / hc.ativos) / 10 : null;
  const absenteismo = abs.esperados ? Math.round(1000 * abs.faltas / abs.esperados) / 10 : null;
  const debitoH = banco.debito_medio ? Math.round(-banco.debito_medio / 60 * 10) / 10 : 0;
  const fatores: { peso: number; texto: string }[] = [];
  const desconta = (peso: number, ratio: number, texto: string) => { const d = Math.round(Math.min(1, Math.max(0, ratio)) * peso); if (d > 0) fatores.push({ peso: -d, texto }); };
  if (turnover !== null && turnover > metas.turnoverAnualPct) desconta(pesos.turnover, (turnover - metas.turnoverAnualPct) / metas.turnoverAnualPct, `turnover 12 meses ${turnover}% (meta ≤ ${metas.turnoverAnualPct}%)`);
  if (absenteismo !== null && absenteismo > metas.absenteismoPct) desconta(pesos.absenteismo, (absenteismo - metas.absenteismoPct) / metas.absenteismoPct, `absenteísmo ${absenteismo}% (meta ≤ ${metas.absenteismoPct}%)`);
  if (debitoH > metas.debitoMedioHoras) desconta(pesos.bancoHoras, (debitoH - metas.debitoMedioHoras) / metas.debitoMedioHoras, `débito médio no banco ${debitoH} h (meta ≤ ${metas.debitoMedioHoras} h)`);
  if (enps?.enps !== null && enps?.enps !== undefined && enps.enps < metas.enps) desconta(pesos.enps, (metas.enps - enps.enps) / 50, `eNPS ${enps.enps} (meta ≥ ${metas.enps})`);
  if (des?.media && des.media < metas.desempenho) desconta(pesos.desempenho, (metas.desempenho - des.media) / 1.5, `desempenho médio ${des.media.toFixed(2)} (meta ≥ ${metas.desempenho})`);
  if (m.conformidade !== null && m.conformidade < metas.treinamentoPct) desconta(pesos.treinamento, (metas.treinamentoPct - m.conformidade) / metas.treinamentoPct, `treinamentos obrigatórios ${m.conformidade}% (meta ≥ ${metas.treinamentoPct}%)`);
  const vagasPct = hc.ativos ? Math.round(1000 * vagas.abertas / hc.ativos) / 10 : 0;
  if (vagasPct > metas.vagasAbertasPct) desconta(pesos.vagas, (vagasPct - metas.vagasAbertasPct) / metas.vagasAbertasPct, `vagas abertas ${vagasPct}% do quadro (meta ≤ ${metas.vagasAbertasPct}%)`);
  const score = Math.max(0, 100 + fatores.reduce((a, f) => a + f.peso, 0));
  return { score, fatores, hc, turnover, desligados12: tv.desligados_12, absenteismo, faltas90: abs.faltas, debitoH, devedores: banco.devedores, enps: enps?.enps ?? null, enpsNome: enps?.nome ?? null, desempenho: des?.media ?? null, ciclo: des?.ciclo ?? null, treinamento: m.conformidade, vagas: vagas.abertas, vagasPct, meses, custo, porCargo, custoReposicao: custo.media ? Math.round(custo.media * cfg.analytics.custoReposicaoSalarios) : null, semMedicao: { turnover: turnover === null, absenteismo: absenteismo === null, enps: enps?.enps === null || enps?.enps === undefined, desempenho: !des?.media, treinamento: m.conformidade === null } };
}

// ---------------- PEOPLE AI ----------------
export async function contextoIA(unitId: number | null) {
  const [ph, suc, bus] = await Promise.all([peopleHealth(unitId), mapaSucessao(unitId), busFactor(unitId)]);
  const risco = (await sinaisPessoas(unitId)).filter(x => x.nivel !== "BAIXO");
  // contexto agregado e anonimizado: sem nomes, sem salários individuais
  return {
    unidade: unitId ?? "rede",
    people_health: { score: ph.score, fatores: ph.fatores.map(f => f.texto), ativos: ph.hc.ativos, admitidos_12m: ph.hc.admitidos_12, desligados_12m: ph.desligados12, turnover_pct: ph.turnover, absenteismo_pct_90d: ph.absenteismo, debito_medio_banco_h: ph.debitoH, colaboradores_com_debito_alto: ph.devedores, enps: ph.enps, desempenho_medio: ph.desempenho, conformidade_treinamento_pct: ph.treinamento, vagas_abertas: ph.vagas, folha_mensal_estimada: ph.custo.folha ? Math.round(ph.custo.folha) : null, custo_reposicao_estimado_por_pessoa: ph.custoReposicao },
    movimentacao_por_mes: ph.meses,
    // k-anonimato: cargos com menos de 3 pessoas são agregados em "outros" para não expor salário individual
    folha_por_cargo: [...ph.porCargo.filter(c => c.n >= 3).map(c => ({ cargo: c.cargo, pessoas: c.n, folha: c.folha ? Math.round(c.folha) : null })), ...(ph.porCargo.some(c => c.n < 3) ? [{ cargo: "outros (cargos com menos de 3 pessoas)", pessoas: ph.porCargo.filter(c => c.n < 3).reduce((a, c) => a + c.n, 0), folha: Math.round(ph.porCargo.filter(c => c.n < 3).reduce((a, c) => a + (c.folha ?? 0), 0)) }] : [])],
    sucessao: { posicoes_criticas: suc.posicoes.length, bench_strength_pct: suc.bench, sem_sucessor: suc.semSucessor, dependencias_unica_pessoa: bus.unicos.length },
    risco_de_saida: { pessoas_em_risco: risco.length, alto: risco.filter(r => r.nivel === "ALTO").length, fatores_mais_comuns: Object.entries(risco.flatMap(r => r.fatores.map(f => f.texto)).reduce<Record<string, number>>((a, t) => { a[t] = (a[t] ?? 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6) },
  };
}

export const PROMPT_SISTEMA = `Você é o People AI do STATUS ONE, assistente de gestão de pessoas do Colégio Status (rede de escolas em Campo Grande/MS). Responda em português do Brasil, de forma direta, para RH e Direção.
Regras inegociáveis:
- Use apenas os dados do contexto. Se não houver dado, diga que não há.
- Estruture toda resposta analítica em: FATO (o que os dados mostram) · ASSOCIAÇÃO (correlações observadas) · HIPÓTESE (explicações possíveis, marcadas como hipótese) · CONFIANÇA (alta/média/baixa e por quê) · PRÓXIMOS PASSOS (o que um humano pode verificar ou fazer).
- Correlação nunca vira causa. Não rotule pessoas; fale de sinais e de grupos.
- Decisões sobre pessoas (desligar, reajustar, promover) são humanas: sugira, não decida.
- Não invente números. Cite os valores do contexto quando usar.`;

export async function perguntarIA(pergunta: string, contexto: unknown): Promise<{ resposta: string; modelo: string; tokensEntrada: number; tokensSaida: number }> {
  const key = process.env.AI_API_KEY; const modelo = process.env.AI_MODEL ?? "claude-sonnet-4-5";
  if (!key) throw new Error("O assistente de IA não está configurado. Defina AI_API_KEY (chave da Anthropic) e, opcionalmente, AI_MODEL nas variáveis do servidor.");
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: modelo, max_tokens: 1200, system: PROMPT_SISTEMA, messages: [{ role: "user", content: `CONTEXTO (dados agregados e anonimizados, JSON):\n${JSON.stringify(contexto)}\n\nPERGUNTA: ${pergunta}` }] }) });
  if (!r.ok) throw new Error(`Provedor de IA respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json() as { content: { type: string; text?: string }[]; usage?: { input_tokens: number; output_tokens: number }; model?: string };
  return { resposta: j.content.filter(c => c.type === "text").map(c => c.text).join("\n"), modelo: j.model ?? modelo, tokensEntrada: j.usage?.input_tokens ?? 0, tokensSaida: j.usage?.output_tokens ?? 0 };
}
