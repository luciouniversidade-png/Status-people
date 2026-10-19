import { sql } from "@/db";
import { getSettings, hoje, addDays, addMonths } from "./utils";
import type { Session } from "./auth";

/**
 * SST — saúde e segurança do trabalho (T-101…T-103 · Nova Arquitetura, Cap. 28 / Bíblia do RH, Caps. 6 e 13).
 * ASO por cargo com validade (sem dado clínico: só tipo, data, validade, aptidão e restrição administrativa), incidentes com CAT no
 * prazo legal e investigação com a CIPA, mandatos da CIPA com a estabilidade dos eleitos e EPI com termo e troca.
 * Tudo restrito a RH e Direção (o diretor de unidade registra incidentes da própria unidade). Alertas só com contagens.
 */
export const podeSst = (s: Session) => ["RH", "DIRECAO"].includes(s.role);
export const podeIncidente = (s: Session) => ["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role);

export const TIPOS_ASO: Record<string, string> = { ADMISSIONAL: "Admissional", PERIODICO: "Periódico", RETORNO: "Retorno ao trabalho", MUDANCA_FUNCAO: "Mudança de função", DEMISSIONAL: "Demissional" };
export const RESULTADO_ASO: Record<string, string> = { APTO: "Apto", APTO_RESTRICAO: "Apto com restrição", INAPTO: "Inapto" };
export const SITUACAO_ASO: Record<string, { rotulo: string; tom: "bom" | "atencao" | "ruim" | "neutro" }> = {
  EM_DIA: { rotulo: "Em dia", tom: "bom" }, VENCENDO: { rotulo: "Vence em até 30 dias", tom: "atencao" }, VENCIDO: { rotulo: "Vencido", tom: "ruim" },
  SEM_ADMISSIONAL: { rotulo: "Admissão sem ASO", tom: "ruim" }, SEM_REGISTRO: { rotulo: "Sem registro no sistema", tom: "neutro" },
  RETORNO_PENDENTE: { rotulo: "ASO de retorno pendente", tom: "ruim" }, DEMISSIONAL_PENDENTE: { rotulo: "Demissional pendente", tom: "atencao" }, INAPTO: { rotulo: "Inapto — ver restrição", tom: "ruim" },
};
export const TIPOS_INCIDENTE: Record<string, string> = { ACIDENTE_TIPICO: "Acidente típico (no trabalho)", TRAJETO: "Acidente de trajeto", DOENCA_OCUPACIONAL: "Doença relacionada ao trabalho", QUASE_ACIDENTE: "Quase acidente (sem lesão)" };
export const GRAVIDADE_INCIDENTE: Record<string, string> = { LEVE: "Leve", MODERADA: "Moderada", GRAVE: "Grave", OBITO: "Óbito" };
export const FUNCOES_CIPA: Record<string, string> = { PRESIDENTE: "Presidente", VICE: "Vice-presidente", SECRETARIO: "Secretário(a)", MEMBRO: "Membro", REPRESENTANTE_NR5: "Representante nomeado (NR-5)" };
export const REPRESENTACAO_CIPA: Record<string, string> = { EMPREGADOS: "Eleito pelos empregados", EMPREGADOR: "Indicado pela empresa" };

/** Validade do ASO: a informada; senão data + periodicidade do cargo (o PCMSO prevalece). Demissional não tem validade. */
export function validadeAso(e: { tipo: string; data: string; validade: string | null }, meses: number) {
  if (e.validade) return e.validade; if (e.tipo === "DEMISSIONAL") return null; return addMonths(e.data, meses);
}
/** Situação do colaborador quanto ao ASO, a partir dos exames registrados. */
export function situacaoAso(p: { admissao: string; exames: { tipo: string; data: string; validade: string | null; resultado: string; situacao?: string }[]; meses: number; hoje: string; recente: boolean; retornoDesde?: string | null; demissionalDesde?: string | null }) {
  const realizados = p.exames.filter(e => (e.situacao ?? "REALIZADO") === "REALIZADO" && e.data <= p.hoje).sort((a, b) => a.data.localeCompare(b.data));
  const ultimo = realizados[realizados.length - 1] ?? null; const validos = realizados.filter(e => e.tipo !== "DEMISSIONAL");
  const ultValido = validos[validos.length - 1] ?? null; const validade = ultValido ? validadeAso(ultValido, p.meses) : null;
  if (p.demissionalDesde && !realizados.some(e => e.tipo === "DEMISSIONAL" && e.data >= p.demissionalDesde!)) return { situacao: "DEMISSIONAL_PENDENTE", ultimo, validade };
  if (p.retornoDesde && !realizados.some(e => e.tipo === "RETORNO" && e.data >= p.retornoDesde!)) return { situacao: "RETORNO_PENDENTE", ultimo, validade };
  if (!realizados.length) return { situacao: p.recente ? "SEM_ADMISSIONAL" : "SEM_REGISTRO", ultimo, validade };
  if (ultValido?.resultado === "INAPTO") return { situacao: "INAPTO", ultimo, validade };
  if (!validade) return { situacao: "EM_DIA", ultimo, validade };
  if (validade < p.hoje) return { situacao: "VENCIDO", ultimo, validade };
  if (validade <= addDays(p.hoje, 30)) return { situacao: "VENCENDO", ultimo, validade };
  return { situacao: "EM_DIA", ultimo, validade };
}
/** Prazo legal da CAT: até o primeiro dia útil seguinte ao da ocorrência; em caso de morte, de imediato (Lei 8.213/91, art. 22). */
export function prazoCat(data: string, feriados: string[], obito: boolean) {
  if (obito) return data;
  let d = addDays(data, 1); const util = (x: string) => { const dow = new Date(x + "T12:00:00Z").getUTCDay(); return dow !== 0 && dow !== 6 && !feriados.includes(x); };
  while (!util(d)) d = addDays(d, 1);
  return d;
}
/** Estabilidade do representante eleito dos empregados: do registro da candidatura até 1 ano após o fim do mandato (ADCT, art. 10, II, "a"). */
export function estabilidadeCipa(m: { representacao: string; mandato_fim: string }) { return m.representacao === "EMPREGADOS" ? addMonths(m.mandato_fim, 12) : null; }

export type LinhaAso = { id: number; nome: string; unidade: string; unit_id: number; cargo: string | null; position_id: number | null; admissao: string; situacao: string; ultimo: { tipo: string; data: string; resultado: string } | null; validade: string | null; meses: number; agendado: string | null };
/** Mapa colaborador × exame exigido × validade (T-101). */
export async function painelAso(unitId: number | null): Promise<LinhaAso[]> {
  const cfg = await getSettings(); const h = hoje(); const padrao = Number(cfg.sst.asoMesesPadrao) || 12; const dRet = Number(cfg.sst.afastamentoRetornoDias) || 30;
  const emps = await sql<{ id: number; nome: string; unidade: string; unit_id: number; cargo: string | null; position_id: number | null; admissao: string; aso_meses: number | null; situacao: string }[]>`SELECT e.id, e.nome, u.nome AS unidade, e.unit_id, p.nome AS cargo, e.position_id, e.admissao::text, p.aso_meses, e.situacao FROM employees e JOIN units u ON u.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id WHERE e.situacao IN ('ATIVO','FERIAS','AFASTADO','EM_ADMISSAO') AND e.vinculo IN ('CLT','HORISTA','TEMPORARIO') ${unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`} ORDER BY u.nome, e.nome`;
  if (!emps.length) return [];
  const ids = emps.map(e => e.id);
  const [exames, retornos, deslig] = await Promise.all([
    sql<{ employee_id: number; tipo: string; data: string; validade: string | null; resultado: string; situacao: string }[]>`SELECT employee_id, tipo, data::text, validade::text, resultado, situacao FROM sst_exams WHERE employee_id = ANY(${ids}) ORDER BY data`,
    // afastamento por saúde longo terminado nos últimos 90 dias pede ASO de retorno (só a data entra na regra; o motivo não é exibido)
    sql<{ employee_id: number; fim: string }[]>`SELECT employee_id, max(fim)::text AS fim FROM leave_requests WHERE employee_id = ANY(${ids}) AND status='APROVADA' AND tipo='AFASTAMENTO_SAUDE' AND dias >= ${dRet} AND fim < ${h} AND fim >= ${addDays(h, -90)} GROUP BY 1`,
    sql<{ employee_id: number; inicio: string }[]>`SELECT employee_id, min(inicio)::text AS inicio FROM processes WHERE employee_id = ANY(${ids}) AND tipo='DESLIGAMENTO' AND status='ABERTO' GROUP BY 1`,
  ]);
  return emps.map(e => {
    const meses = e.aso_meses ?? padrao; const ex = exames.filter(x => x.employee_id === e.id);
    const r = situacaoAso({ admissao: e.admissao, exames: ex, meses, hoje: h, recente: e.situacao === "EM_ADMISSAO" || e.admissao >= addDays(h, -90), retornoDesde: retornos.find(x => x.employee_id === e.id)?.fim ?? null, demissionalDesde: deslig.find(x => x.employee_id === e.id)?.inicio ?? null });
    const ag = ex.filter(x => x.situacao === "AGENDADO" && x.data >= h).sort((a, b) => a.data.localeCompare(b.data))[0];
    return { id: e.id, nome: e.nome, unidade: e.unidade, unit_id: e.unit_id, cargo: e.cargo, position_id: e.position_id, admissao: e.admissao, situacao: r.situacao, ultimo: r.ultimo ? { tipo: r.ultimo.tipo, data: r.ultimo.data, resultado: r.ultimo.resultado } : null, validade: r.validade, meses, agendado: ag?.data ?? null };
  });
}

/** Conformidade de segurança (T-103): cursos obrigatórios das áreas de SST (Academy) × colaborador, brigada e EPI. */
export async function conformidadeSst(unitId: number | null) {
  const cfg = await getSettings(); const h = hoje(); const areas = cfg.sst.areasCursos as string[];
  const { matrizTreinamento } = await import("./clima-academy");
  const [m, cursosSst] = await Promise.all([matrizTreinamento(unitId), sql<{ id: number; codigo: string; titulo: string }[]>`SELECT id, codigo, titulo FROM courses WHERE ativo AND area = ANY(${areas}) ORDER BY codigo`]);
  const ids = new Set(cursosSst.map(c => c.id));
  const linhas = m.linhas.map(l => ({ emp: l.emp, itens: l.itens.filter(i => ids.has(i.curso.id)) })).filter(l => l.itens.length);
  const porUnidade = new Map<string, { total: number; ok: number }>();
  for (const l of linhas) { const x = porUnidade.get(l.emp.unidade) ?? { total: 0, ok: 0 }; x.total += l.itens.length; x.ok += l.itens.filter(i => i.status === "CONCLUIDO").length; porUnidade.set(l.emp.unidade, x); }
  const pendentes = linhas.flatMap(l => l.itens.filter(i => i.status !== "CONCLUIDO").map(i => ({ emp: l.emp, curso: i.curso, status: i.status, validoAte: i.validoAte })));
  const vencendo = linhas.flatMap(l => l.itens.filter(i => i.vencendo).map(i => ({ emp: l.emp, curso: i.curso, validoAte: i.validoAte })));
  const [epiV] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM epi_deliveries d JOIN employees e ON e.id=d.employee_id WHERE d.devolvido_em IS NULL AND d.proxima_troca < ${h} AND e.situacao IN ('ATIVO','FERIAS','AFASTADO') ${unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`} AND NOT EXISTS (SELECT 1 FROM epi_deliveries d2 WHERE d2.employee_id=d.employee_id AND d2.epi_id=d.epi_id AND d2.data > d.data)`;
  return { cursos: cursosSst, linhas, pendentes, vencendo, porUnidade: [...porUnidade.entries()].map(([nome, v]) => ({ nome, ...v, pct: v.total ? Math.round((100 * v.ok) / v.total) : null })), epiVencidos: epiV.n };
}

/** Contagens para os alertas (nunca nomes). */
export async function resumoSst(unitId: number | null) {
  const h = hoje(); const uf = unitId === null ? sql`` : sql`AND unit_id=${unitId}`;
  const aso = await painelAso(unitId);
  const [inc] = await sql<{ cat: number; inv: number }[]>`SELECT count(*) FILTER (WHERE cat_necessaria AND cat_emitida_em IS NULL AND cat_prazo < ${h})::int AS cat, count(*) FILTER (WHERE status <> 'CONCLUIDO' AND investigado_em IS NULL AND investigacao_prazo < ${h})::int AS inv FROM sst_incidents WHERE true ${uf}`;
  let nr = 0, epi = 0; try { const c = await conformidadeSst(unitId); nr = c.pendentes.filter(p => p.status === "VENCIDO").length; epi = c.epiVencidos; } catch { /* Academy indisponível */ }
  return { asoVencidos: aso.filter(a => ["VENCIDO", "SEM_ADMISSIONAL", "RETORNO_PENDENTE", "INAPTO"].includes(a.situacao)).length, semRegistro: aso.filter(a => a.situacao === "SEM_REGISTRO").length, catAtrasadas: inc.cat, investigacoesAtrasadas: inc.inv, nrVencidos: nr, epiVencidos: epi };
}

/** Exame admissional registrado (trava o item da admissão quando a regra está ligada — T-101). */
export async function temAsoAdmissional(employeeId: number) {
  const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM sst_exams WHERE employee_id=${employeeId} AND tipo='ADMISSIONAL' AND situacao='REALIZADO' AND resultado <> 'INAPTO'`; return r.n > 0;
}
/** Demissional: registrado depois do início do desligamento, ou último exame dentro do prazo de dispensa (NR-7). */
export async function temAsoDemissional(employeeId: number, desde: string, dispensaDias: number) {
  const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM sst_exams WHERE employee_id=${employeeId} AND situacao='REALIZADO' AND ((tipo='DEMISSIONAL' AND data >= ${desde}::date - 30) OR (tipo <> 'DEMISSIONAL' AND data >= ${desde}::date - ${dispensaDias}::int))`; return r.n > 0;
}
