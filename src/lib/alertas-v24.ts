import { sql } from "@/db";
import { getSettings, hoje, addDays } from "./utils";
import type { Alerta } from "./command-center";

/**
 * Alertas dos módulos da v24 (Nova Arquitetura) para o Command Center, a Central de alertas e a TV.
 * Só contagens e prazos — nunca nome, dado clínico ou conteúdo sensível. SST só entra quando `sensiveis` (Direção/RH; nunca na TV).
 * Cada regra é isolada: tabela ausente (banco desatualizado) não derruba o painel.
 */
export async function alertasV24(unitId: number | null, sensiveis = false): Promise<Alerta[]> {
  const a: Alerta[] = []; const h = hoje(); const mes = h.slice(0, 7); const cfg = await getSettings();
  const tenta = async (f: () => Promise<void>) => { try { await f(); } catch { /* módulo indisponível */ } };
  const uf = (col: string) => unitId === null ? sql`` : sql`AND ${sql(col)} = ${unitId}`;
  // Caixa: semana negativa projetada nas próximas 13 semanas (T-027 · KPI-11)
  await tenta(async () => {
    const { caixaProjetado } = await import("./fpa"); const p = await caixaProjetado(unitId);
    const neg = p.semanas.find(s => s.saldo !== null && s.saldo < 0);
    if (neg) a.push({ nivel: "ALTO", texto: `Financeiro: saldo projetado negativo na semana até ${neg.ate.split("-").reverse().join("/")} (${Math.round(neg.saldo!).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })})`, href: "/financeiro/projecao" });
    // v27 · reserva mínima (rede): cenário pessimista abaixo dela, sem chegar a negativo
    else if (p.abaixoReserva) a.push({ nivel: "MEDIO", texto: `Financeiro: caixa projetado abaixo da reserva mínima (${Math.round(p.reserva).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}) na semana até ${p.abaixoReserva.ate.split("-").reverse().join("/")} no cenário pessimista`, href: "/financeiro/projecao" });
  });
  // Orçado × real: centro acima do teto da banda aguardando explicação (T-025)
  await tenta(async () => {
    const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM budget_explain_requests WHERE status='ABERTA' ${unitId === null ? sql`` : sql`AND escopo=${unitId}`}`;
    if (r.n) a.push({ nivel: "MEDIO", texto: `Financeiro: ${r.n} categoria(s) acima de ${cfg.orcamento.faixaMaxPct}% do orçado aguardando explicação do responsável`, href: "/financeiro/orcamento" });
  });
  // v28 · plano de contas e rateio: conta genérica acima da meta, saídas sem conta, corporativo sem critério de rateio aprovado e o orçamento do próximo ano
  await tenta(async () => {
    const fora = [...(cfg.dre.internas as string[]), ...((cfg.dre.naoDespesa ?? []) as string[])]; const meta = Number(cfg.planoContas?.metaGenericaPct ?? 5);
    const [r] = await sql<{ v: number | null; gen: number | null; sem: number | null; nsem: number }[]>`SELECT sum(c.valor)::float AS v, sum(c.valor) FILTER (WHERE a.generica)::float AS gen, sum(c.valor) FILTER (WHERE c.conta_id IS NULL)::float AS sem, count(*) FILTER (WHERE c.conta_id IS NULL)::int AS nsem
      FROM cash_entries c LEFT JOIN chart_accounts a ON a.id=c.conta_id WHERE c.tipo='SAIDA' AND c.data >= ${addDays(h, -90)}::date AND NOT (c.categoria = ANY(${fora})) ${uf("c.unit_id")}`;
    const v = r?.v ?? 0;
    if (v > 0 && (100 * (r.gen ?? 0)) / v > meta) a.push({ nivel: "MEDIO", texto: `Plano de contas: ${((100 * (r.gen ?? 0)) / v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% das saídas dos últimos 90 dias em conta genérica (meta até ${meta}%)`, href: "/financeiro/plano-de-contas?aba=classificacao" });
    if (v > 0 && (100 * (r.sem ?? 0)) / v >= 20) a.push({ nivel: "MEDIO", texto: `Plano de contas: ${r.nsem} saída(s) dos últimos 90 dias sem conta (${Math.round((100 * (r.sem ?? 0)) / v)}% do valor) — o resultado por unidade e o orçamento perdem precisão`, href: "/financeiro/plano-de-contas?aba=classificacao" });
    if (unitId === null) {
      const [c] = await sql<{ n: number; regra: number }[]>`SELECT (SELECT count(*) FROM cash_entries ce JOIN cost_centers cc ON cc.id=ce.cost_center_id WHERE cc.tipo='CORPORATIVO' AND ce.tipo='SAIDA' AND ce.data >= ${`${h.slice(0, 4)}-01-01`}::date)::int AS n, (SELECT count(*) FROM allocation_rules WHERE status='APROVADA' AND desde <= ${mes})::int AS regra`;
      if (c.n && !c.regra) a.push({ nivel: "MEDIO", texto: `Rateio: ${c.n} saída(s) do corporativo em ${h.slice(0, 4)} rateadas provisoriamente por alunos — falta o critério aprovado pela Direção`, href: "/financeiro/rateio#regras" });
      const prox = Number(h.slice(0, 4)) + 1;
      if (h.slice(5) >= "11-15") { const [b] = await sql<{ status: string }[]>`SELECT status FROM budget_plans WHERE ano=${prox}`; if (!b || b.status !== "APLICADO") a.push({ nivel: h.slice(5) >= "12-10" ? "ALTO" : "MEDIO", texto: `Orçamento: ${prox} ainda não aplicado — o orçado × realizado de janeiro começa sem meta`, href: `/financeiro/orcamento/historico?ano=${prox}` }); }
    }
  });
  // v27 · Contas a pagar: vencidas sem baixa, vencendo sem programação, programadas e não pagas, retidas, aguardando aprovação há mais de 2 dias (só contagens)
  await tenta(async () => {
    const j = Number(cfg.contasPagar?.alertaDias ?? 3);
    const [r] = await sql<{ vencidas: number; vencendo: number; prog: number; retidas: number; aprov: number }[]>`SELECT
        count(*) FILTER (WHERE i.status='A_PAGAR' AND p.status='ATIVO' AND i.vencimento < ${h}::date)::int AS vencidas,
        count(*) FILTER (WHERE i.status='A_PAGAR' AND p.status='ATIVO' AND NOT i.retida AND i.programado_para IS NULL AND i.vencimento BETWEEN ${h}::date AND ${addDays(h, j)}::date)::int AS vencendo,
        count(*) FILTER (WHERE i.status='A_PAGAR' AND p.status='ATIVO' AND i.programado_para < ${h}::date)::int AS prog,
        count(*) FILTER (WHERE i.status='A_PAGAR' AND p.status='ATIVO' AND i.retida)::int AS retidas,
        count(DISTINCT p.id) FILTER (WHERE p.status='AGUARDANDO_APROVACAO' AND p.created_at < now() - interval '2 days')::int AS aprov
      FROM payable_installments i JOIN payables p ON p.id=i.payable_id WHERE true ${uf("p.unit_id")}`;
    if (r.vencidas) a.push({ nivel: "ALTO", texto: `Financeiro: ${r.vencidas} parcela(s) de contas a pagar vencida(s) sem baixa`, href: "/financeiro/contas-a-pagar?sit=vencidas" });
    if (r.vencendo) a.push({ nivel: "MEDIO", texto: `Financeiro: ${r.vencendo} parcela(s) de contas a pagar vencendo em até ${j} dia(s) sem programação de pagamento`, href: "/financeiro/contas-a-pagar?sit=aprogramar" });
    if (r.prog) a.push({ nivel: "MEDIO", texto: `Financeiro: ${r.prog} pagamento(s) programado(s) que passaram da data sem baixa pelo extrato`, href: "/financeiro/contas-a-pagar?aba=programacao" });
    if (r.aprov) a.push({ nivel: "MEDIO", texto: `Financeiro: ${r.aprov} conta(s) a pagar aguardando aprovação há mais de 2 dias`, href: "/financeiro/contas-a-pagar?sit=aprovacao" });
    if (r.retidas) a.push({ nivel: "MEDIO", texto: `Financeiro: ${r.retidas} parcela(s) retida(s) em contestação com fornecedor`, href: "/financeiro/contas-a-pagar?sit=retidas" });
  });
  // v27 · RH: contratos com prazo (experiência, estágio, temporário) — só contagens
  await tenta(async () => {
    const { prazosContratuais } = await import("./contratos-prazo"); const ps = await prazosContratuais({ unitId });
    const venc = ps.filter(p => p.situacao === "VENCIDO").length, logo = ps.filter(p => p.situacao === "VENCENDO").length, semData = ps.filter(p => p.situacao === "SEM_DATA").length;
    if (venc) a.push({ nivel: "ALTO", texto: `Pessoas: ${venc} contrato(s) com prazo (experiência, estágio ou temporário) venceram sem decisão registrada`, href: "/contratos-prazo" });
    if (logo) a.push({ nivel: ps.some(p => p.situacao === "VENCENDO" && p.dias <= 3) ? "ALTO" : "MEDIO", texto: `Pessoas: ${logo} contrato(s) com prazo vencendo em até ${cfg.contratosPrazo?.avisoDias ?? 10} dias — decidir prorrogar, efetivar ou encerrar`, href: "/contratos-prazo" });
    if (semData) a.push({ nivel: "MEDIO", texto: `Pessoas: ${semData} estagiário(s) sem término do TCE cadastrado`, href: "/contratos-prazo?tipo=ESTAGIO" });
  });
  // Obrigações fiscais: vencidas e vencendo em até 3 dias (T-031)
  await tenta(async () => {
    const [r] = await sql<{ vencidas: number; vencendo: number; sem_comprovante: number }[]>`SELECT count(*) FILTER (WHERE status IN ('PENDENTE','AGUARDA_COMPROVANTE') AND vencimento < ${h})::int AS vencidas, count(*) FILTER (WHERE status='PENDENTE' AND vencimento BETWEEN ${h} AND ${addDays(h, 3)})::int AS vencendo, count(*) FILTER (WHERE status='AGUARDA_COMPROVANTE')::int AS sem_comprovante FROM obligations WHERE true ${uf("unit_id")}`;
    if (r.vencidas) a.push({ nivel: "ALTO", texto: `Financeiro: ${r.vencidas} obrigação(ões) fiscal(is) vencida(s) sem baixa comprovada`, href: "/financeiro/obrigacoes" });
    if (r.vencendo) a.push({ nivel: "MEDIO", texto: `Financeiro: ${r.vencendo} obrigação(ões) fiscal(is) vencendo em até 3 dias`, href: "/financeiro/obrigacoes" });
    const [f] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM fiscal_case_events e JOIN fiscal_cases c ON c.id=e.case_id WHERE c.status='ABERTO' AND e.prazo IS NOT NULL AND e.cumprido_em IS NULL AND e.prazo <= ${addDays(h, 5)}`;
    if (f.n) a.push({ nivel: "ALTO", texto: `Financeiro: ${f.n} prazo(s) de fiscalização vencendo em até 5 dias`, href: "/financeiro/obrigacoes" });
  });
  // Folha: resultado do mês anterior ainda não aceito depois do dia 10 (Payroll Bridge)
  await tenta(async () => {
    if (Number(h.slice(8, 10)) <= 10) return;
    const [y, m] = mes.split("-").map(Number); const ant = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    const [r] = await sql<{ n: number }[]>`SELECT count(DISTINCT e.company_id)::int AS n FROM employees e WHERE e.company_id IS NOT NULL AND e.situacao IN ('ATIVO','FERIAS','AFASTADO') ${uf("e.unit_id")} AND NOT EXISTS (SELECT 1 FROM payroll_cycles c WHERE c.company_id=e.company_id AND c.competencia=${ant} AND c.aceito_em IS NOT NULL)`;
    if (r.n) a.push({ nivel: "MEDIO", texto: `Folha: resultado de ${ant.split("-").reverse().join("/")} ainda não aceito em ${r.n} entidade(s) — o custo de pessoal fica sem fonte REAL`, href: `/folha?mes=${ant}` });
  });
  // Onboarding: marcos vencidos (T-072)
  await tenta(async () => {
    const [r] = await sql<{ n: number; pessoas: number }[]>`SELECT count(*)::int AS n, count(DISTINCT p.id)::int AS pessoas FROM onboarding_items i JOIN onboarding_plans p ON p.id=i.plan_id JOIN employees e ON e.id=p.employee_id WHERE p.status='EM_ANDAMENTO' AND i.concluido_em IS NULL AND i.prazo < ${h} ${uf("e.unit_id")}`;
    if (r.n) a.push({ nivel: r.pessoas >= 3 ? "ALTO" : "MEDIO", texto: `Pessoas: ${r.n} marco(s) de onboarding atrasado(s) em ${r.pessoas} novato(s)`, href: "/onboarding" });
  });
  // Ciclo de avaliação: etapa com janela vencida e não encerrada (T-058/T-059)
  await tenta(async () => {
    const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM perf_cycle_stages st JOIN perf_cycles c ON c.id=st.cycle_id WHERE st.status IN ('PLANEJADA','ABERTA') AND st.fim < ${h} AND c.status <> 'ENCERRADO' ${unitId === null ? sql`` : sql`AND (c.unit_id IS NULL OR c.unit_id=${unitId})`}`;
    if (r.n) a.push({ nivel: "MEDIO", texto: `Pessoas: ${r.n} etapa(s) do ciclo de avaliação com a janela vencida`, href: "/desempenho" });
  });
  // Governança: auditorias atrasadas e CAPA vencida (T-080)
  await tenta(async () => {
    const [r] = await sql<{ aud: number; capa: number }[]>`SELECT (SELECT count(*) FROM audits WHERE status IN ('PLANEJADA','EM_ANDAMENTO') AND planejada_para < ${h} ${uf("unit_id")})::int AS aud,
      (SELECT count(*) FROM nonconformities WHERE status NOT IN ('ENCERRADA','CANCELADA') AND prazo < ${h} ${uf("unit_id")})::int AS capa`;
    if (r.aud) a.push({ nivel: "MEDIO", texto: `Processos: ${r.aud} auditoria(s) planejada(s) com data vencida`, href: "/governanca/auditorias" });
    if (r.capa) a.push({ nivel: r.capa >= 3 ? "ALTO" : "MEDIO", texto: `Processos: ${r.capa} não conformidade(s) com ação corretiva (CAPA) vencida`, href: "/governanca/auditorias" });
  });
  // Ponto: mês anterior aberto depois do dia 5 (trava a folha)
  await tenta(async () => {
    if (Number(h.slice(8, 10)) <= 5) return;
    const [y, m] = mes.split("-").map(Number); const ant = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM units u WHERE true ${uf("u.id")} AND EXISTS (SELECT 1 FROM employees e WHERE e.unit_id=u.id AND e.situacao IN ('ATIVO','FERIAS','AFASTADO')) AND NOT EXISTS (SELECT 1 FROM timesheet_locks l WHERE l.unit_id=u.id AND l.mes=${ant} AND l.status='FECHADO')`;
    if (r.n) a.push({ nivel: "MEDIO", texto: `Pessoas: ponto de ${ant.split("-").reverse().join("/")} ainda aberto em ${r.n} unidade(s) — o pacote da folha não sai`, href: `/ponto?mes=${ant}#fechamento` });
  });
  if (sensiveis) {
    // SST: ASO vencido, CAT fora do prazo, investigação atrasada, EPI com troca vencida (T-101…T-103) — só contagens
    await tenta(async () => {
      const { resumoSst } = await import("./sst"); const r = await resumoSst(unitId);
      if (r.asoVencidos) a.push({ nivel: "ALTO", texto: `SST: ${r.asoVencidos} colaborador(es) com exame ocupacional (ASO) vencido ou sem admissional`, href: "/sst" });
      if (r.catAtrasadas) a.push({ nivel: "ALTO", texto: `SST: ${r.catAtrasadas} CAT com prazo legal vencido`, href: "/sst/incidentes" });
      if (r.investigacoesAtrasadas) a.push({ nivel: "MEDIO", texto: `SST: ${r.investigacoesAtrasadas} investigação(ões) de incidente atrasada(s)`, href: "/sst/incidentes" });
      if (r.epiVencidos) a.push({ nivel: "MEDIO", texto: `SST: ${r.epiVencidos} entrega(s) de EPI com troca vencida`, href: "/sst/conformidade" });
      if (r.nrVencidos) a.push({ nivel: "MEDIO", texto: `SST: ${r.nrVencidos} treinamento(s) obrigatório(s) de segurança vencido(s) ou pendente(s)`, href: "/sst/conformidade" });
    });
  }
  return a;
}
