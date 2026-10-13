import { sql } from "@/db";
import { hoje, getSettings, fmtData, ORIGEM_LABEL } from "./utils";
import { okrs, portfolio, metricasSistema, ATIVOS_PROJ } from "./estrategia";
import { MENSAIS, metricaMensal, resumoAcoes, resumoRituais, funilPorOrigem, type RitualResumo } from "./metricas-extra";
import { farol, medicaoEmDia, razao, periodoDe, somaMeses, diasEntre, nomePeriodo, saudeEstrategicaCalc, pctDe, nivelMaturidade, pctMaturidade, perspectivaDoObjetivo, indicadoresFunil, FAROL_LABEL, type ConfigIndicador, type Direcao, type Farol, type Componente, type Perspectiva } from "./gestao-calc";

export const TIPO_IND: Record<string, string> = { MANUAL: "Registrado manualmente", SISTEMA: "Lido do sistema", CALCULADO: "Calculado (razão entre indicadores)" };
export const ACAO_STATUS: Record<string, string> = { A_FAZER: "A fazer", EM_ANDAMENTO: "Em andamento", BLOQUEADA: "Bloqueada (aguardando apoio)", CONCLUIDA: "Concluída", CANCELADA: "Cancelada" };
export const ACAO_ABERTAS = ["A_FAZER", "EM_ANDAMENTO", "BLOQUEADA"];
export const ORIGEM_FUNIL_LABEL: Record<string, string> = { ...ORIGEM_LABEL, NAO_INFORMADA: "Origem não informada" };
export const fmtNum = (v: number | null | undefined, casas = 1) => v === null || v === undefined || Number.isNaN(v) ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: casas });
export const fmtValor = (v: number | null | undefined, unidade: string | null) => v === null || v === undefined || Number.isNaN(v) ? "—" : unidade === "R$" ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : `${fmtNum(v, 2)}${unidade === "%" ? "%" : unidade ? ` ${unidade}` : ""}`;

/** Meta por extenso em uma linha (“≥ 85%”, “entre 22 e 28 alunos”, “sem meta”). */
export const metaTexto = (c: ConfigIndicador, unidade: string | null) => c.direcao === "FAIXA" ? (c.faixaMin === null || c.faixaMax === null ? "sem meta" : `entre ${fmtValor(c.faixaMin, unidade)} e ${fmtValor(c.faixaMax, unidade)}`) : c.meta === null ? "sem meta" : `${c.direcao === "MAIOR_MELHOR" ? "≥" : "≤"} ${fmtValor(c.meta, unidade)}`;

export type IndRow = { id: number; codigo: string | null; nome: string; descricao: string | null; perspectiva: string | null; area: string | null; unit_id: number | null; unidade: string | null; unidade_medida: string | null; direcao: Direcao; meta: number | null; alerta: number | null; faixa_min: number | null; faixa_max: number | null; tipo: string; fonte: string | null; numerador_id: number | null; denominador_id: number | null; fator: number | null; frequencia: string; funil: string | null; canal: string | null; objective_id: number | null; objetivo: string | null; responsavel_user_id: number | null; responsavel: string | null; ativo: boolean; ordem: number };
export type IndView = IndRow & { serie: Record<string, number | null>; motivos: Record<string, string>; ultimoPeriodo: string | null; ultimoValor: number | null; farol: Farol; emDia: boolean; config: ConfigIndicador; temMeta: boolean };

export const configDe = (i: Pick<IndRow, "direcao" | "meta" | "alerta" | "faixa_min" | "faixa_max">): ConfigIndicador => ({ direcao: i.direcao, meta: i.meta, alerta: i.alerta, faixaMin: i.faixa_min, faixaMax: i.faixa_max });
const temMetaDe = (c: ConfigIndicador) => c.direcao === "FAIXA" ? c.faixaMin !== null && c.faixaMax !== null : c.meta !== null;

/** Indicadores visíveis no escopo, com a série dos últimos meses, último valor, farol e situação da medição. */
export async function listarIndicadores(unitId: number | null, opts: { ids?: number[]; meses?: number; ate?: string; incluirInativos?: boolean } = {}): Promise<IndView[]> {
  const h = hoje(); const ate = opts.ate ?? periodoDe(h); const meses = Math.max(13, opts.meses ?? 13); const desde = somaMeses(ate, -(meses - 1));
  const rows = await sql<IndRow[]>`SELECT i.id, i.codigo, i.nome, i.descricao, i.perspectiva, i.area, i.unit_id, un.nome AS unidade, i.unidade_medida, i.direcao, i.meta::float, i.alerta::float, i.faixa_min::float, i.faixa_max::float, i.tipo, i.fonte, i.numerador_id, i.denominador_id, i.fator::float, i.frequencia, i.funil, i.canal, i.objective_id, o.titulo AS objetivo, i.responsavel_user_id, us.nome AS responsavel, i.ativo, i.ordem
    FROM indicators i LEFT JOIN units un ON un.id=i.unit_id LEFT JOIN users us ON us.id=i.responsavel_user_id LEFT JOIN objectives o ON o.id=i.objective_id
    WHERE ${opts.incluirInativos ? sql`true` : sql`i.ativo`} ${unitId === null ? sql`` : sql`AND (i.unit_id IS NULL OR i.unit_id=${unitId})`} ${opts.ids ? sql`AND i.id = ANY(${opts.ids.length ? opts.ids : [0]})` : sql``}
    ORDER BY i.perspectiva NULLS LAST, i.area NULLS LAST, i.ordem, i.nome`;
  const ids = [...new Set(rows.flatMap(r => [r.id, r.numerador_id, r.denominador_id]).filter((x): x is number => !!x))];
  const vals = ids.length ? await sql<{ indicator_id: number; periodo: string; valor: number | null }[]>`SELECT indicator_id, periodo, valor::float FROM indicator_values WHERE indicator_id = ANY(${ids}) AND periodo >= ${desde} AND periodo <= ${ate}` : [];
  const serieDe = (id: number) => { const m: Record<string, number | null> = {}; vals.filter(v => v.indicator_id === id).forEach(v => { m[v.periodo] = v.valor; }); return m; };
  return rows.map(r => {
    let serie: Record<string, number | null> = {}; const motivos: Record<string, string> = {};
    if (r.tipo === "CALCULADO" && r.numerador_id && r.denominador_id) {
      const sn = serieDe(r.numerador_id), sd = serieDe(r.denominador_id);
      for (const p of [...new Set([...Object.keys(sn), ...Object.keys(sd)])].sort()) { const q = razao(sn[p], sd[p], r.fator ?? 1); serie[p] = q.valor; if (q.motivo) motivos[p] = q.motivo; }
    } else serie = serieDe(r.id);
    const comValor = Object.keys(serie).filter(p => serie[p] !== null && serie[p] !== undefined).sort();
    const ultimoPeriodo = comValor.length ? comValor[comValor.length - 1] : null; const ultimoValor = ultimoPeriodo ? serie[ultimoPeriodo] : null;
    const config = configDe(r);
    return { ...r, serie, motivos, ultimoPeriodo, ultimoValor, farol: farol(ultimoValor, config), emDia: medicaoEmDia(ultimoPeriodo, r.frequencia, h), config, temMeta: temMetaDe(config) };
  });
}

/**
 * Grava a medição dos indicadores lidos do sistema: mês atual (retrato) e, para contagens mensais, também o mês anterior fechado.
 * Sem `forcar`, não recalcula se a última leitura do mês tem menos de 60 minutos (a tela continua rápida).
 */
export async function atualizarIndicadoresSistema(unitId: number | null, forcar = false) {
  const h = hoje(); const per = periodoDe(h); const ant = somaMeses(per, -1);
  const inds = await sql<{ id: number; unit_id: number | null; fonte: string | null }[]>`SELECT id, unit_id, fonte FROM indicators WHERE ativo AND tipo='SISTEMA' AND fonte IS NOT NULL ${unitId === null ? sql`` : sql`AND (unit_id IS NULL OR unit_id=${unitId})`}`;
  if (!inds.length) return 0;
  // Última leitura registrada por escopo (rede ou unidade): vale mesmo quando todas as métricas estão sem base (nenhum valor gravado).
  const escopo = String(unitId ?? "rede");
  if (!forcar) { const [r] = await sql<{ em: string | null }[]>`SELECT value->>${escopo} AS em FROM settings WHERE key='leitura_sistema'`; if (r?.em && Date.now() - Date.parse(r.em) < 60 * 60 * 1000) return 0; }
  await sql`INSERT INTO settings (key, value) VALUES ('leitura_sistema', jsonb_build_object(${escopo}::text, ${new Date().toISOString()}::text)) ON CONFLICT (key) DO UPDATE SET value = settings.value || EXCLUDED.value`;
  const cache = new Map<string, Record<string, number | null>>(); let n = 0;
  for (const i of inds) {
    const k = String(i.unit_id ?? "rede"); if (!cache.has(k)) cache.set(k, await metricasSistema(i.unit_id));
    const atual = cache.get(k)![i.fonte!]; const grava = async (p: string, v: number | null | undefined) => { if (v === null || v === undefined || Number.isNaN(v)) return; await sql`INSERT INTO indicator_values (indicator_id, periodo, valor, origem, user_nome) VALUES (${i.id}, ${p}, ${v}, 'SISTEMA', 'sistema') ON CONFLICT (indicator_id, periodo) DO UPDATE SET valor=EXCLUDED.valor, origem='SISTEMA', updated_at=now()`; n++; };
    await grava(per, atual);
    if (MENSAIS.has(i.fonte!)) await grava(ant, await metricaMensal(i.fonte!, ant, i.unit_id));
  }
  return n;
}

/** Identidade institucional: versão vigente e rascunho em edição. */
export type Identidade = { id: number; versao: number; status: string; missao: string | null; visao: string | null; proposito: string | null; valores: { nome: string; pratica: string }[] | null; proposta_valor: string | null; posicionamento: string | null; horizonte: string | null; vigencia_inicio: string | null; aprovado_em: string | null; aprovador: string | null };
export async function identidadeAtual() {
  const rows = await sql<Identidade[]>`SELECT i.id, i.versao, i.status, i.missao, i.visao, i.proposito, i.valores, i.proposta_valor, i.posicionamento, i.horizonte, i.vigencia_inicio::text, i.aprovado_em::text, u.nome AS aprovador FROM strategy_identity i LEFT JOIN users u ON u.id=i.aprovado_por ORDER BY i.versao DESC`;
  return { vigente: rows.find(r => r.status === "VIGENTE") ?? null, rascunho: rows.find(r => r.status === "RASCUNHO") ?? null, historico: rows.filter(r => r.status === "ARQUIVADO") };
}

/** Maturidade dos processos (POPs): nível cumulativo 1–5 e percentual de critérios por POP, por área e geral. */
export async function maturidadeProcessos(unitId: number | null) {
  const h = hoje();
  const [usuarios] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM users WHERE ativo AND role <> 'LEITURA'`;
  const pops = await sql<{ id: number; codigo: string; titulo: string; area: string; status: string; tem_dono: boolean; revisao_em_dia: boolean; tem_indicador: boolean; controle_em_dia: boolean; acks: number }[]>`SELECT p.id, p.codigo, p.titulo, p.area, p.status, p.owner_user_id IS NOT NULL AS tem_dono, (p.revisar_em IS NULL OR p.revisar_em >= ${h}) AS revisao_em_dia, coalesce(length(trim(p.indicadores)), 0) > 0 AS tem_indicador,
      EXISTS (SELECT 1 FROM controls c WHERE c.procedure_id=p.id AND c.ativo AND (c.proxima_em IS NULL OR c.proxima_em >= ${h})) AS controle_em_dia,
      (SELECT count(*) FROM procedure_acks a WHERE a.procedure_id=p.id AND a.versao=p.versao)::int AS acks
    FROM procedures p WHERE p.status <> 'OBSOLETO' ${unitId === null ? sql`` : sql`AND (p.unit_id IS NULL OR p.unit_id=${unitId})`} ORDER BY p.area, p.codigo`;
  const itens = pops.map(p => { const m = { vigente: p.status === "VIGENTE", temDono: p.tem_dono, cienciaCompleta: usuarios.n > 0 && p.acks >= usuarios.n, temIndicador: p.tem_indicador, controleEmDia: p.controle_em_dia, revisaoEmDia: p.revisao_em_dia }; return { ...p, criterios: m, nivel: nivelMaturidade(m), pct: pctMaturidade(m) }; });
  const areas = [...new Set(itens.map(i => i.area))].map(a => { const xs = itens.filter(i => i.area === a); return { area: a, pops: xs.length, pct: xs.reduce((s, i) => s + i.pct, 0) / xs.length }; });
  const porNivel = [1, 2, 3, 4, 5].map(n => itens.filter(i => i.nivel === n).length);
  return { itens, areas, porNivel, pct: itens.length ? itens.reduce((s, i) => s + i.pct, 0) / itens.length : null };
}

export type Alerta = { nivel: "ALTO" | "MEDIO"; texto: string; href: string };

/** Tudo o que o painel da gestão estratégica precisa, calculado uma vez (painel, Command Center, relatório, TV). */
export async function painelGestao(unitId: number | null, ciclo?: string) {
  const cfg = await getSettings(); const h = hoje(); const c = ciclo ?? cfg.estrategia.cicloAtual;
  await atualizarIndicadoresSistema(unitId).catch(() => 0);
  const [ok, pf, inds, ac, rit, mat, ident, krsParados, objSemKR] = await Promise.all([okrs(c, unitId), portfolio(unitId), listarIndicadores(unitId), resumoAcoes(unitId), resumoRituais(unitId), maturidadeProcessos(unitId), identidadeAtual(),
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM key_results k JOIN objectives o ON o.id=k.objective_id WHERE o.ciclo=${c} AND o.status='ATIVO' AND k.fonte IS NULL ${unitId === null ? sql`` : sql`AND (o.unit_id IS NULL OR o.unit_id=${unitId})`} AND NOT EXISTS (SELECT 1 FROM kr_checkins ck WHERE ck.key_result_id=k.id AND ck.data >= ${h}::date - 30)`,
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM objectives o WHERE o.ciclo=${c} AND o.status='ATIVO' ${unitId === null ? sql`` : sql`AND (o.unit_id IS NULL OR o.unit_id=${unitId})`} AND NOT EXISTS (SELECT 1 FROM key_results k WHERE k.objective_id=o.id)`]);
  // Indicador nunca medido fica fora da conta (sem base — vira alerta, não zero); medição antiga conta como fora do alvo (precisa estar em dia).
  const comMeta = inds.filter(i => i.temMeta && i.ultimoValor !== null); const nuncaMedidos = inds.filter(i => i.temMeta && i.ultimoValor === null).length;
  const noAlvo = comMeta.filter(i => i.farol === "VERDE" && i.emDia); const semMedicao = inds.filter(i => !i.emDia);
  const ativosProj = pf.rows.filter(r => ATIVOS_PROJ.includes(r.status)); const projOk = ativosProj.filter(r => r.saude !== "VERMELHO" && r.marcos_atrasados === 0);
  const krsComMed = ok.objetivos.flatMap(o => o.krs).filter(k => k.progresso !== null).length;
  const pesos = cfg.estrategia.pesosSaude as Record<string, number>;
  const comps: Componente[] = [
    { chave: "okrs", nome: "Progresso dos OKRs", peso: pesos.okrs ?? 0, valor: ok.progressoCiclo, detalhe: ok.progressoCiclo === null ? "nenhum KR com medição" : `média de ${krsComMed} KR(s) com medição (${ok.totalKRs} no ciclo ${c})` },
    { chave: "indicadores", nome: "Indicadores no alvo e com medição em dia", peso: pesos.indicadores ?? 0, valor: pctDe(noAlvo.length, comMeta.length), num: noAlvo.length, den: comMeta.length, detalhe: comMeta.length ? `${noAlvo.length} de ${comMeta.length} indicador(es) com meta e medição${nuncaMedidos ? ` · ${nuncaMedidos} ainda sem medição, fora da conta` : ""}` : nuncaMedidos ? `${nuncaMedidos} indicador(es) com meta, nenhum medido ainda` : "nenhum indicador com meta" },
    { chave: "projetos", nome: "Projetos sem risco alto e sem marco atrasado", peso: pesos.projetos ?? 0, valor: pctDe(projOk.length, ativosProj.length), num: projOk.length, den: ativosProj.length, detalhe: ativosProj.length ? `${projOk.length} de ${ativosProj.length} projeto(s) ativo(s)` : "nenhum projeto ativo" },
    { chave: "acoes", nome: "Ações do plano em dia", peso: pesos.acoes ?? 0, valor: pctDe(ac.em_dia, ac.abertas), num: ac.em_dia, den: ac.abertas, detalhe: ac.abertas ? `${ac.em_dia} de ${ac.abertas} ação(ões) aberta(s) · ${ac.vencidas} vencida(s) · ${ac.bloqueadas} bloqueada(s)` : "nenhuma ação aberta" },
    { chave: "rituais", nome: "Rituais de gestão em dia", peso: pesos.rituais ?? 0, valor: pctDe(rit.emDia, rit.ativos), num: rit.emDia, den: rit.ativos, detalhe: rit.ativos ? `${rit.emDia} de ${rit.ativos} ritual(is) ativo(s)` : "nenhum ritual ativo" },
  ];
  const saude = saudeEstrategicaCalc(comps, cfg.estrategia.faixasSaude as [number, number]);
  // Perspectivas do mapa
  const persp = cfg.estrategia.perspectivas as Perspectiva[]; const mapa = cfg.estrategia.perspectivaDoPilar as Record<string, string>;
  const objsAtivos = ok.objetivos.filter(o => o.status === "ATIVO").map(o => ({ ...o, persp: perspectivaDoObjetivo(o.perspectiva, o.pilar, mapa) }));
  const perspectivas = persp.map(p => { const os = objsAtivos.filter(o => o.persp === p.chave); const com = os.filter(o => o.progresso !== null); const is = inds.filter(i => i.perspectiva === p.chave && i.temMeta && i.ultimoValor !== null); return { ...p, objetivos: os.length, progresso: com.length ? Math.round(com.reduce((a, o) => a + (o.progresso ?? 0), 0) / com.length) : null, indicadores: is.length, indicadoresNoAlvo: is.filter(i => i.farol === "VERDE" && i.emDia).length }; });
  // Alertas explicáveis (regras, não “inteligência”)
  const alertas: Alerta[] = [];
  rit.atrasados.forEach(r => alertas.push({ nivel: "ALTO", texto: `Ritual “${r.nome}” atrasado (previsto para ${fmtData(r.proxima_data)})`, href: `/estrategia/rituais/${r.id}` }));
  if (rit.atasPendentes) alertas.push({ nivel: "MEDIO", texto: `${rit.atasPendentes} reunião(ões) de ritual sem ata registrada`, href: "/estrategia/rituais" });
  if (ac.vencidas) alertas.push({ nivel: "ALTO", texto: `${ac.vencidas} ação(ões) do plano vencida(s)`, href: "/estrategia/acoes?situacao=VENCIDAS" });
  if (ac.bloqueadas) alertas.push({ nivel: "MEDIO", texto: `${ac.bloqueadas} ação(ões) bloqueada(s) aguardando apoio`, href: "/estrategia/acoes?situacao=BLOQUEADA" });
  inds.filter(i => i.temMeta && i.farol === "VERMELHO" && i.emDia).slice(0, 5).forEach(i => alertas.push({ nivel: "ALTO", texto: `Indicador fora do alvo: ${i.nome} (${fmtValor(i.ultimoValor, i.unidade_medida)})`, href: `/estrategia/indicadores/${i.id}` }));
  if (semMedicao.length) alertas.push({ nivel: "MEDIO", texto: `${semMedicao.length} indicador(es) sem medição no período da frequência`, href: "/estrategia/indicadores?situacao=SEM_MEDICAO" });
  if (krsParados[0].n) alertas.push({ nivel: "MEDIO", texto: `${krsParados[0].n} KR(s) manual(is) sem check-in nos últimos 30 dias`, href: "/estrategia/okrs" });
  if (objSemKR[0].n) alertas.push({ nivel: "MEDIO", texto: `${objSemKR[0].n} objetivo(s) do ciclo ${c} sem resultado-chave`, href: "/estrategia/okrs" });
  if (!ident.vigente) alertas.push({ nivel: "MEDIO", texto: "Identidade institucional (missão, visão e valores) ainda não publicada", href: "/estrategia/identidade" });
  const semObjetivo = perspectivas.filter(p => p.objetivos === 0); if (objsAtivos.length && semObjetivo.length) alertas.push({ nivel: "MEDIO", texto: `Perspectiva(s) sem objetivo no ciclo ${c}: ${semObjetivo.map(p => p.nome).join(", ")}`, href: "/estrategia/mapa" });
  return { ciclo: c, ok, pf, inds, ac, rit, mat, ident, saude, comps, perspectivas, alertas, objsAtivos, noAlvo: noAlvo.length, comMeta: comMeta.length, semMedicao: semMedicao.length };
}

/** Pauta automática do próximo encontro do ritual: encaminhamentos abertos, indicadores, objetivos, decisões a revisar e pauta padrão. */
export async function pautaAutomatica(r: RitualResumo, viewer: number | null = null) {
  // Quem enxerga só a própria unidade não vê, num ritual da rede, dados de outras unidades
  const h = hoje(); const itens: { titulo: string; linhas: string[] }[] = []; const esc = viewer ?? r.unit_id;
  const enc = await sql<{ id: number; titulo: string; status: string; prazo: string | null; responsavel: string | null; data: string }[]>`SELECT a.id, a.titulo, a.status, a.prazo::text, u.nome AS responsavel, m.data::text FROM action_plans a JOIN ritual_meetings m ON m.id=a.ritual_meeting_id LEFT JOIN users u ON u.id=a.responsavel_user_id WHERE m.ritual_id=${r.id} AND a.status = ANY(${ACAO_ABERTAS}) ${viewer === null ? sql`` : sql`AND (a.unit_id IS NULL OR a.unit_id=${viewer})`} ORDER BY a.prazo NULLS LAST`;
  if (enc.length) itens.push({ titulo: "Encaminhamentos em aberto", linhas: enc.map(a => `${a.titulo} — ${a.responsavel ?? "sem responsável"} — ${a.status === "BLOQUEADA" ? "bloqueada" : a.prazo && a.prazo < h ? `VENCIDA em ${fmtData(a.prazo)}` : a.prazo ? `prazo ${fmtData(a.prazo)}` : "sem prazo"} (reunião de ${fmtData(a.data)})`) });
  if (r.indicadores?.length) { const is = await listarIndicadores(esc, { ids: r.indicadores }); if (is.length) itens.push({ titulo: "Indicadores do ritual", linhas: is.map(i => `${i.nome}: ${fmtValor(i.ultimoValor, i.unidade_medida)}${i.ultimoPeriodo ? ` (${nomePeriodo(i.ultimoPeriodo)})` : ""} — ${FAROL_LABEL[i.farol]}${i.emDia ? "" : " · medição atrasada"}`) }); }
  if (r.objetivos?.length) {
    const os = await sql<{ id: number; titulo: string; ciclo: string }[]>`SELECT id, titulo, ciclo FROM objectives WHERE id = ANY(${r.objetivos}) ${esc === null ? sql`` : sql`AND (unit_id IS NULL OR unit_id=${esc})`}`;
    for (const o of os) { const k = await okrs(o.ciclo, esc); const obj = k.objetivos.find(x => x.id === o.id); if (obj) itens.push({ titulo: `Objetivo: ${obj.titulo} — ${obj.progresso === null ? "sem medição" : `${obj.progresso}%`}`, linhas: obj.krs.map(kr => `${kr.titulo}: ${fmtValor(kr.valor_atual, kr.metrica)} de ${fmtValor(kr.valor_meta, kr.metrica)} (${kr.progresso === null ? "sem medição" : `${kr.progresso}% do caminho`})`) }); }
  }
  const dec = await sql<{ titulo: string; revisar_em: string }[]>`SELECT titulo, revisar_em::text FROM decisions WHERE status='VIGENTE' AND revisar_em IS NOT NULL AND revisar_em <= ${h}::date + 30 ${esc === null ? sql`` : sql`AND (unit_id IS NULL OR unit_id=${esc})`} ORDER BY revisar_em LIMIT 8`;
  if (dec.length) itens.push({ titulo: "Decisões com revisão prevista", linhas: dec.map(d => `${d.titulo} — revisar até ${fmtData(d.revisar_em)}`) });
  const padrao = (r.pauta_padrao ?? "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (padrao.length) itens.push({ titulo: "Pauta padrão", linhas: padrao });
  const texto = itens.map(i => `${i.titulo}\n${i.linhas.map(l => `- ${l}`).join("\n")}`).join("\n\n");
  return { itens, texto };
}

/** Marketing e captação: investimento (manual, por canal) × funil do cadastro de Matrículas (automático, por origem). */
export async function painelMarketing(unitId: number | null, periodo: string, meses = 6) {
  const inds = await listarIndicadores(unitId, { ate: periodo, meses: Math.max(13, meses) });
  // Na visão de uma unidade só vale o investimento registrado para ela: o da rede dividido pelos candidatos de uma unidade daria um custo falso.
  const invest = inds.filter(i => i.funil === "INVESTIMENTO" && (unitId === null || i.unit_id === unitId));
  const investSoRede = unitId !== null && !invest.length && inds.some(i => i.funil === "INVESTIMENTO");
  const periodos = Array.from({ length: meses }, (_, k) => somaMeses(periodo, k - meses + 1));
  const investDe = (p: string, canal?: string | null) => { const xs = invest.filter(i => canal === undefined || (i.canal ?? null) === canal); const vs = xs.map(i => i.serie[p]).filter((v): v is number => v !== null && v !== undefined); return vs.length ? vs.reduce((a, v) => a + v, 0) : null; };
  const funis = await Promise.all(periodos.map(p => funilPorOrigem(p, unitId)));
  const tendencia = periodos.map((p, k) => { const f = funis[k].total; const inv = investDe(p); return { periodo: p, investimento: inv, ...f, ...indicadoresFunil({ investimento: inv, candidatos: f.candidatos, reservas: f.reservas, matriculas: f.matriculas }) }; });
  const atual = funis[funis.length - 1];
  const canais = atual.porOrigem.map(o => { const inv = investDe(periodo, o.origem); return { ...o, investimento: inv, ...indicadoresFunil({ investimento: inv, candidatos: o.candidatos, reservas: o.reservas, matriculas: o.matriculas }) }; });
  const semCanal = investDe(periodo, null);
  const outros = inds.filter(i => i.area === "Matrículas e marketing" && i.funil !== "INVESTIMENTO");
  return { periodo, periodos, tendencia, atual: tendencia[tendencia.length - 1], canais, semCanal, invest, investSoRede, outros };
}

/** Plano de ação (5W2H) no escopo, com vínculos e atraso calculado. Bloqueada não conta como atraso do responsável. */
export type AcaoRow = { id: number; titulo: string; porque: string | null; unit_id: number | null; unidade: string | null; local: string | null; inicio: string | null; prazo: string | null; responsavel_user_id: number | null; responsavel: string | null; como: string | null; custo_previsto: number | null; custo_real: number | null; status: string; bloqueio: string | null; bloqueio_desde: string | null; evidencia: string | null; concluida_em: string | null; cancel_justificativa: string | null; objective_id: number | null; objetivo: string | null; indicator_id: number | null; indicador: string | null; project_id: number | null; projeto: string | null; ritual_meeting_id: number | null; ritual: string | null; reuniao_data: string | null; origem: string | null; created_by: number | null; criador: string | null; vencida: boolean; dias_atraso: number | null };
export const SITUACAO_ACAO: Record<string, string> = { ABERTAS: "Abertas", ATENCAO: "Vencidas ou bloqueadas", VENCIDAS: "Vencidas", BLOQUEADA: "Bloqueadas", CONCLUIDA: "Concluídas", CANCELADA: "Canceladas", TODAS: "Todas" };
export async function listarAcoes(unitId: number | null, f: { id?: number; situacao?: string; responsavel?: number | null; q?: string | null; meetingId?: number; indicatorId?: number; objectiveId?: number; projectId?: number; concluidasDesde?: string; limite?: number } = {}): Promise<AcaoRow[]> {
  const h = hoje(); const sit = f.situacao ?? "ABERTAS";
  const filtroSit = sit === "ABERTAS" ? sql`AND a.status IN ('A_FAZER','EM_ANDAMENTO','BLOQUEADA')` : sit === "VENCIDAS" ? sql`AND a.status IN ('A_FAZER','EM_ANDAMENTO') AND a.prazo < ${h}` : sit === "ATENCAO" ? sql`AND ((a.status IN ('A_FAZER','EM_ANDAMENTO') AND a.prazo < ${h}) OR a.status='BLOQUEADA')` : ["BLOQUEADA", "CONCLUIDA", "CANCELADA", "A_FAZER", "EM_ANDAMENTO"].includes(sit) ? sql`AND a.status=${sit}` : sql``;
  const rows = await sql<Omit<AcaoRow, "vencida" | "dias_atraso">[]>`SELECT a.id, a.titulo, a.porque, a.unit_id, un.nome AS unidade, a.local, a.inicio::text, a.prazo::text, a.responsavel_user_id, ur.nome AS responsavel, a.como, a.custo_previsto::float, a.custo_real::float, a.status, a.bloqueio, a.bloqueio_desde::text, a.evidencia, a.concluida_em::text, a.cancel_justificativa,
      a.objective_id, o.titulo AS objetivo, a.indicator_id, i.nome AS indicador, a.project_id, p.nome AS projeto, a.ritual_meeting_id, r.nome AS ritual, m.data::text AS reuniao_data, a.origem, a.created_by, uc.nome AS criador
    FROM action_plans a LEFT JOIN units un ON un.id=a.unit_id LEFT JOIN users ur ON ur.id=a.responsavel_user_id LEFT JOIN users uc ON uc.id=a.created_by LEFT JOIN objectives o ON o.id=a.objective_id LEFT JOIN indicators i ON i.id=a.indicator_id LEFT JOIN projects p ON p.id=a.project_id
      LEFT JOIN ritual_meetings m ON m.id=a.ritual_meeting_id LEFT JOIN rituals r ON r.id=m.ritual_id
    WHERE 1=1 ${f.id ? sql`AND a.id=${f.id}` : sql``} ${filtroSit} ${unitId === null ? sql`` : sql`AND (a.unit_id IS NULL OR a.unit_id=${unitId})`} ${f.responsavel ? sql`AND a.responsavel_user_id=${f.responsavel}` : sql``}
      ${f.q ? sql`AND (a.titulo ILIKE ${"%" + f.q + "%"} OR coalesce(a.porque,'') ILIKE ${"%" + f.q + "%"} OR coalesce(a.origem,'') ILIKE ${"%" + f.q + "%"})` : sql``}
      ${f.meetingId ? sql`AND a.ritual_meeting_id=${f.meetingId}` : sql``} ${f.indicatorId ? sql`AND a.indicator_id=${f.indicatorId}` : sql``} ${f.objectiveId ? sql`AND a.objective_id=${f.objectiveId}` : sql``} ${f.projectId ? sql`AND a.project_id=${f.projectId}` : sql``}
      ${f.concluidasDesde ? sql`AND a.concluida_em >= ${f.concluidasDesde}` : sql``}
    ORDER BY (a.status IN ('A_FAZER','EM_ANDAMENTO','BLOQUEADA')) DESC, a.prazo NULLS LAST, a.id DESC LIMIT ${f.limite ?? 500}`;
  return rows.map(a => { const vencida = ["A_FAZER", "EM_ANDAMENTO"].includes(a.status) && !!a.prazo && a.prazo < h; return { ...a, vencida, dias_atraso: vencida ? diasEntre(a.prazo!, h) : null }; });
}
