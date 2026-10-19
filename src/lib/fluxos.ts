import { sql } from "@/db";
import { scopeUnit, type Session } from "./auth";
import { getSettings, hoje, addDays } from "./utils";
import { podePrivacidade } from "./privacidade";
import { vePainel } from "./solicitacoes";
import { CASE_STATUS, ABERTOS as CASOS_ABERTOS } from "./atendimento";
import { OS_STATUS, ABERTAS as OS_ABERTAS } from "./operacoes";
import { NC_STATUS } from "./governanca";

/**
 * Central de fluxos e SLA (v23): cada processo com prazo vira uma "instância" no mesmo formato — solicitações, casos das famílias,
 * chamados, pedidos LGPD, admissões e desligamentos, férias e afastamentos, vagas, descontos, exceções, plano de ação e não conformidades.
 * Situação: no prazo, em risco (resta pouco do prazo), vencido; concluídos no prazo ou fora dele. Prazos de data vencem no fim do dia (Campo Grande).
 * Só entram os fluxos que o perfil já enxerga nos módulos, no escopo da unidade. Pedidos LGPD aparecem só pelo protocolo.
 */
export type Fluxo = "SOLICITACAO" | "CASO" | "CHAMADO" | "LGPD" | "ADMISSAO" | "DESLIGAMENTO" | "FERIAS" | "VAGA" | "DESCONTO" | "EXCECAO" | "ACAO" | "NC";
export const FLUXOS: Record<Fluxo, { nome: string; curto: string; href: (id: number) => string; lista: string }> = {
  SOLICITACAO: { nome: "Solicitações e aprovações", curto: "Solicitações", href: id => `/solicitacoes/${id}`, lista: "/solicitacoes?aba=todas" },
  CASO: { nome: "Casos das famílias", curto: "Casos", href: id => `/atendimento/casos/${id}`, lista: "/atendimento/casos" },
  CHAMADO: { nome: "Chamados de operações", curto: "Chamados", href: id => `/operacoes/chamados/${id}`, lista: "/operacoes/chamados" },
  LGPD: { nome: "Pedidos de titulares (LGPD)", curto: "LGPD", href: id => `/governanca/privacidade/pedidos/${id}`, lista: "/governanca/privacidade" },
  ADMISSAO: { nome: "Admissões", curto: "Admissões", href: id => `/processos/${id}`, lista: "/processos?tipo=ADMISSAO" },
  DESLIGAMENTO: { nome: "Desligamentos", curto: "Desligamentos", href: id => `/processos/${id}`, lista: "/processos?tipo=DESLIGAMENTO" },
  FERIAS: { nome: "Férias e afastamentos (aprovação)", curto: "Férias", href: () => "/ferias", lista: "/ferias" },
  VAGA: { nome: "Abertura de vagas (aprovação)", curto: "Vagas", href: id => `/recrutamento/${id}`, lista: "/recrutamento" },
  DESCONTO: { nome: "Descontos e bolsas (aprovação)", curto: "Descontos", href: () => "/financeiro/descontos", lista: "/financeiro/descontos" },
  EXCECAO: { nome: "Exceções a POPs (aprovação)", curto: "Exceções", href: () => "/governanca/excecoes", lista: "/governanca/excecoes" },
  ACAO: { nome: "Plano de ação", curto: "Ações", href: id => `/estrategia/acoes/${id}`, lista: "/estrategia/acoes" },
  NC: { nome: "Não conformidades", curto: "NCs", href: () => "/governanca/controles", lista: "/governanca/controles" },
};
export const ORDEM_FLUXOS = Object.keys(FLUXOS) as Fluxo[];

export type Instancia = {
  fluxo: Fluxo; id: number; titulo: string; unit_id: number | null; unidade: string | null; etapa: string; responsavel: string | null; responsavel_user_id: number | null;
  aberto: number; prazo: number | null; concluido: number | null; href: string; grupo?: string | null;
};
export type Situacao = "VENCIDO" | "EM_RISCO" | "NO_PRAZO" | "SEM_PRAZO" | "CONCLUIDO_NO_PRAZO" | "CONCLUIDO_FORA" | "CONCLUIDO_SEM_PRAZO";
export const SITUACAO_LABEL: Record<Situacao, string> = { VENCIDO: "Vencido", EM_RISCO: "Em risco", NO_PRAZO: "No prazo", SEM_PRAZO: "Sem prazo", CONCLUIDO_NO_PRAZO: "Concluído no prazo", CONCLUIDO_FORA: "Concluído fora do prazo", CONCLUIDO_SEM_PRAZO: "Concluído (sem prazo)" };
export const SITUACAO_TOM: Record<Situacao, "bom" | "atencao" | "ruim" | "neutro"> = { VENCIDO: "ruim", EM_RISCO: "atencao", NO_PRAZO: "bom", SEM_PRAZO: "neutro", CONCLUIDO_NO_PRAZO: "bom", CONCLUIDO_FORA: "ruim", CONCLUIDO_SEM_PRAZO: "neutro" };

/** Fim do dia de uma data no fuso da escola (UTC−4). */
export const fimDoDia = (iso: string) => Date.parse(`${iso}T23:59:59-04:00`);
const DIA = 86400000;

/** Situação de uma instância agora: em risco quando resta até `riscoPct`% do prazo total (ou menos de 1 dia num prazo de 2 dias ou mais). */
export function situacao(i: Pick<Instancia, "aberto" | "prazo" | "concluido">, agora: number, riscoPct = 25): Situacao {
  if (i.concluido !== null) return i.prazo === null ? "CONCLUIDO_SEM_PRAZO" : i.concluido <= i.prazo ? "CONCLUIDO_NO_PRAZO" : "CONCLUIDO_FORA";
  if (i.prazo === null) return "SEM_PRAZO";
  if (agora > i.prazo) return "VENCIDO";
  const total = Math.max(1, i.prazo - i.aberto); const resta = i.prazo - agora;
  return resta <= total * riscoPct / 100 || (total >= 2 * DIA && resta <= DIA) ? "EM_RISCO" : "NO_PRAZO";
}

/** Fluxos que o perfil enxerga (os mesmos dos módulos de origem). */
export async function fluxosVisiveis(s: Session): Promise<Fluxo[]> {
  const r = s.role; const out: Fluxo[] = [];
  if (vePainel(s)) out.push("SOLICITACAO");
  if (["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "COMERCIAL", "LEITURA"].includes(r)) out.push("CASO");
  if (["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "OPERACOES", "LEITURA"].includes(r)) out.push("CHAMADO");
  if (await podePrivacidade(s).catch(() => false)) out.push("LGPD");
  if (["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "LEITURA"].includes(r)) out.push("ADMISSAO", "DESLIGAMENTO", "FERIAS", "VAGA");
  if (["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE", "RH", "COMERCIAL"].includes(r)) out.push("DESCONTO");
  if (!["COLABORADOR"].includes(r)) out.push("EXCECAO", "ACAO", "NC");
  return out;
}
export const veFluxos = (s: Session) => s.role !== "COLABORADOR";

// a central mede prazo, não motivo: afastamento de saúde e licença aparecem juntos, sem revelar o tipo
const TIPO_AUSENCIA = "CASE l.tipo WHEN 'FERIAS' THEN 'Férias' WHEN 'FOLGA_BANCO' THEN 'Folga do banco' ELSE 'Afastamento ou licença' END";
const ms = (col: ReturnType<typeof sql>) => sql`(extract(epoch FROM ${col}) * 1000)::float8`;

/** Instâncias abertas e concluídas desde `desde` (ISO), dos fluxos pedidos, no escopo da unidade (null = rede). */
export async function instancias(fluxos: Fluxo[], unitId: number | null, desde: string): Promise<Instancia[]> {
  const cfg = await getSettings(); const fx = cfg.fluxos ?? { prazoDecisaoDias: 2, prazoFeriasDias: 3 };
  const quer = (f: Fluxo) => fluxos.includes(f);
  const ufx = (col: string) => unitId === null ? sql`` : sql`AND ${sql(col)}=${unitId}`;
  const q: Promise<Instancia[]>[] = [];
  if (quer("SOLICITACAO")) q.push(sql<Instancia[]>`SELECT 'SOLICITACAO' AS fluxo, r.id, (r.numero || ' · ' || r.titulo) AS titulo, r.unit_id, u.nome AS unidade, coalesce(r.etapas->r.etapa_atual->>'nome', ${"Etapa"}) AS etapa, NULL AS responsavel, NULL::int AS responsavel_user_id,
      ${ms(sql`r.created_at`)} AS aberto, CASE WHEN r.status IN ('EM_APROVACAO','DEVOLVIDA') AND r.prazo_etapa IS NOT NULL THEN (extract(epoch FROM (r.prazo_etapa + 1)::timestamp + interval '4 hours') * 1000 - 1000)::float8 END AS prazo,
      CASE WHEN r.status IN ('APROVADA','REJEITADA') THEN ${ms(sql`coalesce(r.concluida_em, r.updated_at)`)} END AS concluido, t.nome AS grupo
    FROM requests r JOIN request_types t ON t.id=r.type_id LEFT JOIN units u ON u.id=r.unit_id
    WHERE (r.status IN ('EM_APROVACAO','DEVOLVIDA') OR (r.status IN ('APROVADA','REJEITADA') AND coalesce(r.concluida_em, r.updated_at) >= ${desde}::date)) ${ufx("r.unit_id")}`);
  if (quer("CASO")) q.push(sql<Instancia[]>`SELECT 'CASO' AS fluxo, c.id, c.assunto AS titulo, c.unit_id, u.nome AS unidade, c.status AS etapa, us.nome AS responsavel, c.responsavel_user_id,
      ${ms(sql`c.created_at`)} AS aberto, CASE WHEN c.sla_ate IS NOT NULL THEN ${ms(sql`c.sla_ate`)} END AS prazo, CASE WHEN c.status NOT IN ('ABERTO','EM_ATENDIMENTO','AGUARDANDO_FAMILIA','REABERTO') THEN ${ms(sql`coalesce(c.resolvido_em, c.fechado_em, c.updated_at)`)} END AS concluido, c.tipo AS grupo
    FROM cases c LEFT JOIN units u ON u.id=c.unit_id LEFT JOIN users us ON us.id=c.responsavel_user_id
    WHERE (c.status = ANY(${CASOS_ABERTOS}) OR coalesce(c.resolvido_em, c.fechado_em, c.updated_at) >= ${desde}::date) ${ufx("c.unit_id")}`);
  if (quer("CHAMADO")) q.push(sql<Instancia[]>`SELECT 'CHAMADO' AS fluxo, w.id, w.titulo, w.unit_id, u.nome AS unidade, w.status AS etapa, us.nome AS responsavel, w.responsavel_user_id,
      ${ms(sql`w.created_at`)} AS aberto, CASE WHEN w.sla_ate IS NOT NULL THEN ${ms(sql`w.sla_ate`)} END AS prazo, CASE WHEN w.status='CONCLUIDO' THEN ${ms(sql`coalesce(w.concluido_em, w.updated_at)`)} END AS concluido, w.tipo AS grupo
    FROM work_orders w LEFT JOIN units u ON u.id=w.unit_id LEFT JOIN users us ON us.id=w.responsavel_user_id
    WHERE (w.status = ANY(${OS_ABERTAS}) OR (w.status='CONCLUIDO' AND w.concluido_em >= ${desde}::date)) ${ufx("w.unit_id")}`);
  if (quer("LGPD")) q.push(sql<Instancia[]>`SELECT 'LGPD' AS fluxo, p.id, ('Pedido ' || p.protocolo) AS titulo, NULL::int AS unit_id, NULL AS unidade, p.status AS etapa, us.nome AS responsavel, p.responsavel_user_id,
      ${ms(sql`p.created_at`)} AS aberto, (extract(epoch FROM (p.prazo + 1)::timestamp + interval '4 hours') * 1000 - 1000)::float8 AS prazo, CASE WHEN p.respondida_em IS NOT NULL THEN ${ms(sql`p.respondida_em`)} END AS concluido, p.tipo AS grupo
    FROM privacy_requests p LEFT JOIN users us ON us.id=p.responsavel_user_id WHERE (p.respondida_em IS NULL AND p.status IN ('RECEBIDA','EM_ANALISE','AGUARDANDO_TITULAR')) OR p.respondida_em >= ${desde}::date`);
  if (quer("ADMISSAO") || quer("DESLIGAMENTO")) q.push(sql<Instancia[]>`SELECT p.tipo AS fluxo, p.id, e.nome AS titulo, e.unit_id, u.nome AS unidade,
      coalesce((SELECT i.titulo FROM process_items i WHERE i.process_id=p.id AND NOT i.concluido ORDER BY i.ordem, i.id LIMIT 1), 'Concluir processo') AS etapa, us.nome AS responsavel, p.responsavel_user_id,
      (extract(epoch FROM p.inicio::timestamp + interval '4 hours') * 1000)::float8 AS aberto, CASE WHEN p.prazo IS NOT NULL THEN (extract(epoch FROM (p.prazo + 1)::timestamp + interval '4 hours') * 1000 - 1000)::float8 END AS prazo,
      CASE WHEN p.status='CONCLUIDO' THEN ${ms(sql`p.concluido_em`)} END AS concluido, NULL AS grupo
    FROM processes p JOIN employees e ON e.id=p.employee_id JOIN units u ON u.id=e.unit_id LEFT JOIN users us ON us.id=p.responsavel_user_id
    WHERE p.tipo = ANY(${[quer("ADMISSAO") ? "ADMISSAO" : "", quer("DESLIGAMENTO") ? "DESLIGAMENTO" : ""]}) AND (p.status='ABERTO' OR (p.status='CONCLUIDO' AND p.concluido_em >= ${desde}::date)) ${ufx("e.unit_id")}`);
  if (quer("FERIAS")) q.push(sql<Instancia[]>`SELECT 'FERIAS' AS fluxo, l.id, (e.nome || ' · ' || ${sql.unsafe(TIPO_AUSENCIA)}) AS titulo, e.unit_id, u.nome AS unidade, 'Aguardando aprovação' AS etapa, NULL AS responsavel, NULL::int AS responsavel_user_id,
      ${ms(sql`l.created_at`)} AS aberto, (extract(epoch FROM (least(l.created_at::date + ${fx.prazoFeriasDias ?? 3}::int, l.inicio - 1) + 1)::timestamp + interval '4 hours') * 1000 - 1000)::float8 AS prazo,
      CASE WHEN l.status IN ('APROVADA','REJEITADA') AND l.decidido_em IS NOT NULL THEN ${ms(sql`l.decidido_em`)} END AS concluido, ${sql.unsafe(TIPO_AUSENCIA)} AS grupo
    FROM leave_requests l JOIN employees e ON e.id=l.employee_id JOIN units u ON u.id=e.unit_id
    WHERE (l.status='SOLICITADA' OR (l.status IN ('APROVADA','REJEITADA') AND l.decidido_em >= ${desde}::date)) ${ufx("e.unit_id")}`);
  if (quer("VAGA")) q.push(sql<Instancia[]>`SELECT 'VAGA' AS fluxo, r.id, r.titulo, r.unit_id, u.nome AS unidade, 'Aguardando aprovação' AS etapa, NULL AS responsavel, NULL::int AS responsavel_user_id,
      ${ms(sql`r.created_at`)} AS aberto, (extract(epoch FROM (r.created_at::date + ${fx.prazoDecisaoDias ?? 2}::int + 1)::timestamp + interval '4 hours') * 1000 - 1000)::float8 AS prazo,
      CASE WHEN r.status <> 'SOLICITADA' AND r.aberta_em IS NOT NULL THEN greatest(${ms(sql`r.created_at`)}, (extract(epoch FROM r.aberta_em::timestamp + interval '16 hours') * 1000)::float8) END AS concluido, NULL AS grupo
    FROM requisitions r LEFT JOIN units u ON u.id=r.unit_id WHERE (r.status='SOLICITADA' OR (r.aberta_em >= ${desde}::date AND r.created_at >= ${desde}::date)) ${ufx("r.unit_id")}`);
  if (quer("DESCONTO")) q.push(sql<Instancia[]>`SELECT 'DESCONTO' AS fluxo, d.id, (d.aluno_nome || ' · ' || d.percentual || '%') AS titulo, d.unit_id, u.nome AS unidade, 'Aguardando aprovação' AS etapa, NULL AS responsavel, NULL::int AS responsavel_user_id,
      ${ms(sql`d.created_at`)} AS aberto, (extract(epoch FROM (d.created_at::date + ${fx.prazoDecisaoDias ?? 2}::int + 1)::timestamp + interval '4 hours') * 1000 - 1000)::float8 AS prazo,
      CASE WHEN d.status <> 'SOLICITADO' AND d.decidido_em IS NOT NULL THEN ${ms(sql`d.decidido_em`)} END AS concluido, d.tipo AS grupo
    FROM discounts d LEFT JOIN units u ON u.id=d.unit_id WHERE (d.status='SOLICITADO' OR d.decidido_em >= ${desde}::date) ${ufx("d.unit_id")}`);
  if (quer("EXCECAO")) q.push(sql<Instancia[]>`SELECT 'EXCECAO' AS fluxo, x.id, x.regra AS titulo, x.unit_id, u.nome AS unidade, 'Aguardando decisão' AS etapa, NULL AS responsavel, NULL::int AS responsavel_user_id,
      ${ms(sql`x.created_at`)} AS aberto, (extract(epoch FROM (x.created_at::date + ${fx.prazoDecisaoDias ?? 2}::int + 1)::timestamp + interval '4 hours') * 1000 - 1000)::float8 AS prazo,
      CASE WHEN x.status <> 'SOLICITADA' AND x.decidido_em IS NOT NULL THEN ${ms(sql`x.decidido_em`)} END AS concluido, x.motivo AS grupo
    FROM exceptions x LEFT JOIN units u ON u.id=x.unit_id WHERE (x.status='SOLICITADA' OR x.decidido_em >= ${desde}::date) ${ufx("x.unit_id")}`);
  if (quer("ACAO")) q.push(sql<Instancia[]>`SELECT 'ACAO' AS fluxo, a.id, a.titulo, a.unit_id, u.nome AS unidade, a.status AS etapa, us.nome AS responsavel, a.responsavel_user_id,
      ${ms(sql`a.created_at`)} AS aberto, CASE WHEN a.prazo IS NOT NULL THEN (extract(epoch FROM (a.prazo + 1)::timestamp + interval '4 hours') * 1000 - 1000)::float8 END AS prazo,
      CASE WHEN a.status='CONCLUIDA' AND a.concluida_em IS NOT NULL THEN (extract(epoch FROM a.concluida_em::timestamp + interval '16 hours') * 1000)::float8 END AS concluido, a.origem AS grupo
    FROM action_plans a LEFT JOIN units u ON u.id=a.unit_id LEFT JOIN users us ON us.id=a.responsavel_user_id
    WHERE (a.status IN ('A_FAZER','EM_ANDAMENTO','BLOQUEADA') OR (a.status='CONCLUIDA' AND a.concluida_em >= ${desde}::date)) ${unitId === null ? sql`` : sql`AND (a.unit_id IS NULL OR a.unit_id=${unitId})`}`);
  if (quer("NC")) q.push(sql<Instancia[]>`SELECT 'NC' AS fluxo, n.id, n.titulo, n.unit_id, u.nome AS unidade, n.status AS etapa, us.nome AS responsavel, n.responsavel_user_id,
      ${ms(sql`n.created_at`)} AS aberto, CASE WHEN n.prazo IS NOT NULL THEN (extract(epoch FROM (n.prazo + 1)::timestamp + interval '4 hours') * 1000 - 1000)::float8 END AS prazo,
      CASE WHEN n.encerrada_em IS NOT NULL THEN ${ms(sql`n.encerrada_em`)} END AS concluido, n.origem AS grupo
    FROM nonconformities n LEFT JOIN units u ON u.id=n.unit_id LEFT JOIN users us ON us.id=n.responsavel_user_id
    WHERE (n.encerrada_em IS NULL OR n.encerrada_em >= ${desde}::date) ${unitId === null ? sql`` : sql`AND (n.unit_id IS NULL OR n.unit_id=${unitId})`}`);
  const rows = (await Promise.all(q)).flat();
  return rows.map(r => ({ ...r, href: FLUXOS[r.fluxo].href(r.id), etapa: rotuloEtapa(r.fluxo, r.etapa) }));
}

function rotuloEtapa(f: Fluxo, e: string) {
  if (f === "CASO") return CASE_STATUS[e] ?? e;
  if (f === "CHAMADO") return OS_STATUS[e] ?? e;
  if (f === "NC") return NC_STATUS[e] ?? e;
  if (f === "ACAO") return ({ A_FAZER: "A fazer", EM_ANDAMENTO: "Em andamento", BLOQUEADA: "Bloqueada", CONCLUIDA: "Concluída" } as Record<string, string>)[e] ?? e;
  if (f === "LGPD") return ({ RECEBIDA: "Recebido", EM_ANALISE: "Em análise", AGUARDANDO_TITULAR: "Aguardando o titular", RESPONDIDA: "Respondido", INDEFERIDA: "Não atendido" } as Record<string, string>)[e] ?? e;
  return e;
}

export type ResumoFluxo = { fluxo: Fluxo; abertos: number; noPrazo: number; emRisco: number; vencidos: number; semPrazo: number; concluidos: number; concluidosNoPrazo: number; concluidosComPrazo: number; cicloMedioDias: number | null; maisAntigoDias: number | null };
export function resumir(insts: Instancia[], agora: number, riscoPct = 25) {
  const por = new Map<Fluxo, ResumoFluxo>(); const sit = new Map<Instancia, Situacao>();
  for (const i of insts) {
    const st = situacao(i, agora, riscoPct); sit.set(i, st);
    const r = por.get(i.fluxo) ?? { fluxo: i.fluxo, abertos: 0, noPrazo: 0, emRisco: 0, vencidos: 0, semPrazo: 0, concluidos: 0, concluidosNoPrazo: 0, concluidosComPrazo: 0, cicloMedioDias: null, maisAntigoDias: null };
    if (i.concluido === null) { r.abertos++; if (st === "NO_PRAZO") r.noPrazo++; else if (st === "EM_RISCO") r.emRisco++; else if (st === "VENCIDO") r.vencidos++; else r.semPrazo++; r.maisAntigoDias = Math.max(r.maisAntigoDias ?? 0, (agora - i.aberto) / DIA); }
    else { r.concluidos++; if (i.prazo !== null) { r.concluidosComPrazo++; if (st === "CONCLUIDO_NO_PRAZO") r.concluidosNoPrazo++; } }
    por.set(i.fluxo, r);
  }
  for (const [f, r] of por) { const c = insts.filter(i => i.fluxo === f && i.concluido !== null); r.cicloMedioDias = c.length ? c.reduce((a, i) => a + Math.max(0, (i.concluido ?? 0) - i.aberto) / DIA, 0) / c.length : null; }
  const lista = [...por.values()];
  const tot = lista.reduce((a, r) => ({ abertos: a.abertos + r.abertos, noPrazo: a.noPrazo + r.noPrazo, emRisco: a.emRisco + r.emRisco, vencidos: a.vencidos + r.vencidos, semPrazo: a.semPrazo + r.semPrazo, concluidos: a.concluidos + r.concluidos, concluidosNoPrazo: a.concluidosNoPrazo + r.concluidosNoPrazo, concluidosComPrazo: a.concluidosComPrazo + r.concluidosComPrazo }), { abertos: 0, noPrazo: 0, emRisco: 0, vencidos: 0, semPrazo: 0, concluidos: 0, concluidosNoPrazo: 0, concluidosComPrazo: 0 });
  return { porFluxo: lista, total: tot, situacoes: sit };
}

/** Cumprimento por semana (segunda a domingo) das instâncias concluídas: no prazo × fora do prazo. */
export function porSemana(insts: Instancia[], semanas: number, agora: number) {
  const hojeIso = new Date(agora - 4 * 3600000).toISOString().slice(0, 10); const dow = (new Date(`${hojeIso}T12:00:00Z`).getUTCDay() + 6) % 7; const segunda = addDays(hojeIso, -dow);
  const out = Array.from({ length: semanas }, (_, k) => { const ini = addDays(segunda, -7 * (semanas - 1 - k)); return { ini, a: Date.parse(`${ini}T00:00:00-04:00`), b: Date.parse(`${addDays(ini, 7)}T00:00:00-04:00`), noPrazo: 0, fora: 0 }; });
  for (const i of insts) { if (i.concluido === null || i.prazo === null) continue; const w = out.find(x => i.concluido! >= x.a && i.concluido! < x.b); if (!w) continue; if (i.concluido <= i.prazo) w.noPrazo++; else w.fora++; }
  return out.map(w => ({ semana: w.ini, noPrazo: w.noPrazo, fora: w.fora, pct: w.noPrazo + w.fora ? (100 * w.noPrazo) / (w.noPrazo + w.fora) : null }));
}

/** Gargalos das aprovações: tempo de decisão por etapa (tipo · etapa) e por aprovador, a partir do histórico das solicitações. */
export async function gargalosAprovacao(unitId: number | null, desde: string) {
  const rows = await sql<{ tipo: string; etapa: string; aprovador: string | null; dias: number; prazo: number | null; resultado: string }[]>`WITH ev AS (SELECT re.request_id, re.etapa, re.tipo, re.created_at, re.user_nome, lag(re.created_at) OVER (PARTITION BY re.request_id ORDER BY re.created_at, re.id) AS desde FROM request_events re WHERE re.tipo IN ('CRIADA','REENVIADA','APROVADA','REJEITADA','DEVOLVIDA'))
    SELECT t.nome AS tipo, coalesce(r.etapas->ev.etapa->>'nome', 'Etapa ' || (coalesce(ev.etapa, 0) + 1)) AS etapa, ev.user_nome AS aprovador, (extract(epoch FROM ev.created_at - ev.desde) / 86400)::float AS dias, t.prazo_dias::float AS prazo, ev.tipo AS resultado
    FROM ev JOIN requests r ON r.id=ev.request_id JOIN request_types t ON t.id=r.type_id WHERE ev.tipo IN ('APROVADA','REJEITADA','DEVOLVIDA') AND ev.desde IS NOT NULL AND ev.created_at >= ${desde}::date ${unitId === null ? sql`` : sql`AND r.unit_id=${unitId}`}`;
  type G = { chave: string; n: number; media: number; max: number; prazo: number | null; noPrazo: number; devolvidas: number };
  const agrupa = (chave: (r: typeof rows[number]) => string): G[] => {
    const m = new Map<string, G & { soma: number }>();
    for (const r of rows) { const k = chave(r); const x = m.get(k) ?? { chave: k, n: 0, soma: 0, media: 0, max: 0, prazo: r.prazo, noPrazo: 0, devolvidas: 0 }; x.n++; x.soma += r.dias; x.max = Math.max(x.max, r.dias); if (r.prazo !== null && r.dias <= r.prazo + 1 / 24) x.noPrazo++; if (r.resultado === "DEVOLVIDA") x.devolvidas++; if (x.prazo !== r.prazo) x.prazo = null; m.set(k, x); }
    return [...m.values()].map(({ soma, ...x }) => ({ ...x, media: soma / x.n })).sort((a, b) => b.media - a.media);
  };
  return { etapas: agrupa(r => `${r.tipo} · ${r.etapa}`), aprovadores: agrupa(r => r.aprovador ?? "—"), decisoes: rows.length, mediaDias: rows.length ? rows.reduce((a, r) => a + r.dias, 0) / rows.length : null, noPrazoPct: rows.some(r => r.prazo !== null) ? (100 * rows.filter(r => r.prazo !== null && r.dias <= r.prazo + 1 / 24).length) / rows.filter(r => r.prazo !== null).length : null };
}

/** Itens em andamento por responsável (só os que têm responsável nomeado), com a situação de cada um. */
export function porResponsavel(insts: Instancia[], sit: Map<Instancia, Situacao>, max = 12) {
  const m = new Map<string, { nome: string; userId: number | null; noPrazo: number; emRisco: number; vencidos: number; semPrazo: number; total: number }>();
  for (const i of insts) { if (i.concluido !== null || !i.responsavel) continue; const k = `${i.responsavel_user_id ?? i.responsavel}`; const x = m.get(k) ?? { nome: i.responsavel, userId: i.responsavel_user_id, noPrazo: 0, emRisco: 0, vencidos: 0, semPrazo: 0, total: 0 }; const st = sit.get(i); if (st === "NO_PRAZO") x.noPrazo++; else if (st === "EM_RISCO") x.emRisco++; else if (st === "VENCIDO") x.vencidos++; else x.semPrazo++; x.total++; m.set(k, x); }
  return [...m.values()].sort((a, b) => b.vencidos - a.vencidos || b.total - a.total).slice(0, max);
}

/** Itens por unidade: em andamento, vencidos, em risco e cumprimento do prazo nos concluídos do período. Itens sem unidade ficam em "Rede". */
export function porUnidadeFluxo(insts: Instancia[], sit: Map<Instancia, Situacao>) {
  const m = new Map<string, { nome: string; unitId: number | null; abertos: number; vencidos: number; emRisco: number; concluidos: number; noPrazo: number; comPrazo: number }>();
  for (const i of insts) { const k = String(i.unit_id ?? 0); const x = m.get(k) ?? { nome: i.unidade ?? "Rede (sem unidade)", unitId: i.unit_id, abertos: 0, vencidos: 0, emRisco: 0, concluidos: 0, noPrazo: 0, comPrazo: 0 }; const st = sit.get(i);
    if (i.concluido === null) { x.abertos++; if (st === "VENCIDO") x.vencidos++; if (st === "EM_RISCO") x.emRisco++; } else { x.concluidos++; if (i.prazo !== null) { x.comPrazo++; if (st === "CONCLUIDO_NO_PRAZO") x.noPrazo++; } }
    m.set(k, x); }
  return [...m.values()].map(x => ({ ...x, pct: x.comPrazo ? (100 * x.noPrazo) / x.comPrazo : null })).sort((a, b) => (a.unitId === null ? 1 : 0) - (b.unitId === null ? 1 : 0) || a.nome.localeCompare(b.nome));
}

/** Itens abertos por semana no período (entrada de demanda). */
export function abertosPorSemana(insts: Instancia[], semanas: number, agora: number) {
  const hojeIso = new Date(agora - 4 * 3600000).toISOString().slice(0, 10); const dow = (new Date(`${hojeIso}T12:00:00Z`).getUTCDay() + 6) % 7; const segunda = addDays(hojeIso, -dow);
  return Array.from({ length: semanas }, (_, k) => { const ini = addDays(segunda, -7 * (semanas - 1 - k)); const a = Date.parse(`${ini}T00:00:00-04:00`), b = Date.parse(`${addDays(ini, 7)}T00:00:00-04:00`); return { semana: ini, n: insts.filter(i => i.aberto >= a && i.aberto < b).length }; });
}

/**
 * Leitura automática da central (determinística, sem IA e sem nomes): vencidos e onde se concentram, tendência do cumprimento,
 * maior gargalo de aprovação contra o prazo, unidade com mais atraso e o item mais antigo parado.
 */
export function leituraFluxos(o: { resumo: ReturnType<typeof resumir>; semanas: ReturnType<typeof porSemana>; gargalos: { etapas: { chave: string; n: number; media: number; prazo: number | null }[] } | null; unidades: ReturnType<typeof porUnidadeFluxo>; agora: number }) {
  const out: { tom: "bom" | "atencao" | "ruim" | "neutro"; texto: string }[] = []; const t = o.resumo.total; const f1 = (x: number) => x.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  if (t.vencidos) { const top = [...o.resumo.porFluxo].sort((a, b) => b.vencidos - a.vencidos)[0]; out.push({ tom: "ruim", texto: `${t.vencidos} ${t.vencidos === 1 ? "item vencido" : "itens vencidos"} em andamento${top && top.vencidos ? ` — ${top.vencidos} em ${FLUXOS[top.fluxo].nome.toLowerCase()}` : ""}.` }); }
  else if (t.abertos) out.push({ tom: "bom", texto: `Nenhum item vencido entre os ${t.abertos} em andamento.` });
  if (t.emRisco) out.push({ tom: "atencao", texto: `${t.emRisco} ${t.emRisco === 1 ? "item vence" : "itens vencem"} em breve (em risco): agir hoje evita atraso.` });
  const ult = o.semanas.slice(-4), ant = o.semanas.slice(-8, -4); const pct = (ws: typeof ult) => { const a = ws.reduce((x, w) => x + w.noPrazo, 0), b = ws.reduce((x, w) => x + w.noPrazo + w.fora, 0); return b >= 5 ? (100 * a) / b : null; };
  const p1 = pct(ult), p0 = pct(ant);
  if (p1 !== null && p0 !== null && Math.abs(p1 - p0) >= 5) out.push({ tom: p1 > p0 ? "bom" : "atencao", texto: `Cumprimento do prazo nas últimas 4 semanas: ${f1(p1)}% (${p1 > p0 ? "+" : "−"}${f1(Math.abs(p1 - p0))} p.p. sobre as 4 anteriores).` });
  else if (p1 !== null) out.push({ tom: p1 >= 90 ? "bom" : p1 >= 75 ? "atencao" : "ruim", texto: `Cumprimento do prazo nas últimas 4 semanas: ${f1(p1)}% dos itens concluídos.` });
  const g = o.gargalos?.etapas.filter(e => e.n >= 3 && e.prazo !== null && e.media > e.prazo).sort((a, b) => (b.media - (b.prazo ?? 0)) - (a.media - (a.prazo ?? 0)))[0];
  if (g) out.push({ tom: "atencao", texto: `Gargalo de aprovação: ${g.chave} leva em média ${f1(g.media)} dias para decidir (prazo ${f1(g.prazo ?? 0)}) em ${g.n} decisões.` });
  const u = o.unidades.filter(x => x.unitId !== null && x.vencidos > 0).sort((a, b) => b.vencidos - a.vencidos)[0];
  if (u && o.unidades.filter(x => x.unitId !== null).length > 1) out.push({ tom: "atencao", texto: `Unidade com mais atraso: ${u.nome}, com ${u.vencidos} ${u.vencidos === 1 ? "item vencido" : "itens vencidos"}.` });
  const velho = [...o.resumo.porFluxo].filter(r => r.maisAntigoDias !== null).sort((a, b) => (b.maisAntigoDias ?? 0) - (a.maisAntigoDias ?? 0))[0];
  if (velho && (velho.maisAntigoDias ?? 0) >= 30) out.push({ tom: "neutro", texto: `O item em andamento mais antigo é de ${FLUXOS[velho.fluxo].nome.toLowerCase()}: aberto há ${Math.floor(velho.maisAntigoDias ?? 0)} dias.` });
  return out;
}

export const NC_ABERTAS = ["ABERTA", "EM_TRATAMENTO", "VERIFICACAO"];
/** Painel de não conformidades (visão de auditoria): por responsável, situação, prazo, unidade × origem e gravidade. */
export async function ncsPainel(unitId: number | null, desde: string) {
  const h = hoje();
  const rows = await sql<{ id: number; titulo: string; origem: string; status: string; gravidade: number | null; prazo: string | null; unit_id: number | null; unidade: string | null; responsavel: string | null; created_at: Date; encerrada_em: Date | null; encerrada_dia: string | null }[]>`SELECT n.id, n.titulo, n.origem, n.status, n.gravidade, n.prazo::text, n.unit_id, u.nome AS unidade, us.nome AS responsavel, n.created_at, n.encerrada_em, (n.encerrada_em AT TIME ZONE 'UTC' AT TIME ZONE 'America/Campo_Grande')::date::text AS encerrada_dia
    FROM nonconformities n LEFT JOIN units u ON u.id=n.unit_id LEFT JOIN users us ON us.id=n.responsavel_user_id WHERE (n.encerrada_em IS NULL OR n.encerrada_em >= ${desde}::date) ${unitId === null ? sql`` : sql`AND (n.unit_id IS NULL OR n.unit_id=${unitId})`} ORDER BY n.prazo NULLS LAST, n.id`;
  const abertas = rows.filter(r => r.encerrada_em === null); const encerradas = rows.filter(r => r.encerrada_em !== null);
  const conta = <K extends string>(xs: (typeof rows)[number][], k: (r: typeof rows[number]) => K) => { const m = new Map<K, number>(); for (const r of xs) m.set(k(r), (m.get(k(r)) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  return {
    abertas, encerradas,
    vencidas: abertas.filter(r => r.prazo !== null && r.prazo < h).length, noPrazo: abertas.filter(r => r.prazo !== null && r.prazo >= h).length, semPrazo: abertas.filter(r => r.prazo === null).length,
    encNoPrazo: encerradas.filter(r => r.prazo !== null && r.encerrada_dia !== null && r.encerrada_dia <= r.prazo).length, encComPrazo: encerradas.filter(r => r.prazo !== null).length,
    porResponsavel: conta(abertas, r => r.responsavel ?? "Sem responsável"), porStatus: conta(abertas, r => r.status), porOrigem: conta(rows, r => r.origem),
    porUnidadeOrigem: rows.reduce((m, r) => { const k = `${r.unidade ?? "Rede"}|${r.origem}`; m.set(k, (m.get(k) ?? 0) + 1); return m; }, new Map<string, number>()),
    unidades: [...new Set(rows.map(r => r.unidade ?? "Rede"))].sort((a, b) => (a === "Rede" ? 1 : 0) - (b === "Rede" ? 1 : 0) || a.localeCompare(b)),
    porGravidade: conta(abertas, r => String(r.gravidade ?? 0)),
  };
}

/** Onde as instâncias abertas esperam mais: idade média por fluxo e etapa (status). */
export function esperas(insts: Instancia[], agora: number, max = 8) {
  const m = new Map<string, { fluxo: Fluxo; etapa: string; n: number; soma: number }>();
  for (const i of insts) { if (i.concluido !== null) continue; const k = `${i.fluxo}|${i.etapa}`; const x = m.get(k) ?? { fluxo: i.fluxo, etapa: i.etapa, n: 0, soma: 0 }; x.n++; x.soma += (agora - i.aberto) / DIA; m.set(k, x); }
  return [...m.values()].map(x => ({ ...x, media: x.soma / x.n })).filter(x => x.n >= 1).sort((a, b) => b.media * Math.sqrt(b.n) - a.media * Math.sqrt(a.n)).slice(0, max);
}

export async function contexto(s: Session) {
  const cfg = await getSettings(); return { riscoPct: Number(cfg.fluxos?.riscoPct ?? 25), escopo: scopeUnit(s), hoje: hoje() };
}
