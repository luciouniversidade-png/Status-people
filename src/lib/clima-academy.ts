import { sql } from "@/db";
import { hoje, addDays, addMonths, getSettings } from "./utils";

export const SURVEY_TIPO: Record<string, string> = { CLIMA: "Clima organizacional", ENPS: "eNPS", PULSE: "Pulse (rápida)" };
export const SURVEY_STATUS: Record<string, string> = { RASCUNHO: "Rascunho", ABERTA: "Aberta", ENCERRADA: "Encerrada" };
export const ACTION_STATUS: Record<string, string> = { PLANEJADA: "Planejada", EM_ANDAMENTO: "Em andamento", CONCLUIDA: "Concluída" };
export const COURSE_TIPO: Record<string, string> = { OBRIGATORIO: "Obrigatório", TRILHA_CARGO: "Trilha do cargo", OPCIONAL: "Opcional" };
export const COURSE_FORMATO: Record<string, string> = { PRESENCIAL: "Presencial", ONLINE: "Online", LEITURA: "Leitura", POP: "Ciência de POP" };
export const PROG_STATUS: Record<string, string> = { PENDENTE: "Pendente", EM_ANDAMENTO: "Em andamento", CONCLUIDO: "Concluído", VENCIDO: "Vencido" };
export const NEED_ORIGEM: Record<string, string> = { PDI: "PDI", GESTOR: "Gestor", NC: "Não conformidade", CLIMA: "Pesquisa de clima", OUTRO: "Outro" };

export type Pergunta = { id: string; dimensao: string; texto: string; tipo: "ESCALA" | "ENPS" | "TEXTO" };

export function perguntasPadrao(dimensoes: [string, string][], tipo: string): Pergunta[] {
  const p: Pergunta[] = [];
  if (tipo !== "ENPS") dimensoes.forEach(([d, t], i) => p.push({ id: `q${i + 1}`, dimensao: d, texto: t, tipo: "ESCALA" }));
  p.push({ id: "enps", dimensao: "eNPS", texto: "De 0 a 10, quanto você recomendaria o Colégio Status como lugar para trabalhar?", tipo: "ENPS" });
  p.push({ id: "aberta", dimensao: "Comentário", texto: "O que mais ajudaria você a trabalhar melhor? (opcional)", tipo: "TEXTO" });
  return p;
}

export function enpsScore(vals: number[]) {
  if (!vals.length) return null; const p = vals.filter(v => v >= 9).length, d = vals.filter(v => v <= 6).length; return Math.round(100 * (p - d) / vals.length);
}

/** Resultados agregados com regra de anonimato (células com menos de N respostas não são exibidas). */
export async function resultadosPesquisa(surveyId: number, minimo: number, perguntas: Pergunta[]) {
  const rows = await sql<{ unit_id: number | null; regime: string | null; respostas: Record<string, number | string>; comentario: string | null }[]>`SELECT unit_id, regime, respostas, comentario FROM climate_responses WHERE survey_id=${surveyId}`;
  const units = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`;
  const escala = perguntas.filter(q => q.tipo === "ESCALA"); const enpsQ = perguntas.find(q => q.tipo === "ENPS");
  const media = (vals: number[]) => vals.length ? Math.round(10 * vals.reduce((a, b) => a + b, 0) / vals.length) / 10 : null;
  const geral = escala.map(q => { const v = rows.map(r => Number(r.respostas[q.id])).filter(n => n >= 1); return { q, n: v.length, media: v.length >= minimo ? media(v) : null, favoravel: v.length >= minimo ? Math.round(100 * v.filter(n => n >= 4).length / v.length) : null }; });
  const enpsVals = enpsQ ? rows.map(r => Number(r.respostas[enpsQ.id])).filter(n => n >= 0 && n <= 10 && !Number.isNaN(n)) : [];
  const enps = enpsVals.length >= minimo ? enpsScore(enpsVals) : null;
  const heat = units.map(u => { const rs = rows.filter(r => r.unit_id === u.id); return { unidade: u.nome, n: rs.length, celulas: escala.map(q => { const v = rs.map(r => Number(r.respostas[q.id])).filter(n => n >= 1); return v.length >= minimo ? media(v) : null; }), enps: enpsQ ? (() => { const v = rs.map(r => Number(r.respostas[enpsQ.id])).filter(n => n >= 0 && n <= 10 && !Number.isNaN(n)); return v.length >= minimo ? enpsScore(v) : null; })() : null }; }).filter(h => h.n > 0);
  const semUnidade = rows.filter(r => !r.unit_id).length;
  const comentarios = rows.map(r => r.comentario).filter((c): c is string => !!c && c.trim().length > 0);
  return { total: rows.length, geral, enps, enpsN: enpsVals.length, heat, semUnidade, comentarios: rows.length >= minimo ? comentarios : [], comentariosOcultos: rows.length < minimo ? comentarios.length : 0 };
}

/** Matriz de treinamento: para cada colaborador ativo, cursos exigidos (obrigatórios para todos / cargo / regime) e situação. */
export async function matrizTreinamento(unitId: number | null) {
  const cfg = await getSettings(); const h = hoje(); const alerta = addDays(h, cfg.academy.alertaVencimentoDias);
  const [emps, cursos, prog, acks] = await Promise.all([
    sql<{ id: number; nome: string; unidade: string; unit_id: number; position_id: number | null; cargo: string | null; regime: string; user_id: number | null }[]>`SELECT e.id, e.nome, u.nome AS unidade, e.unit_id, e.position_id, p.nome AS cargo, e.regime, (SELECT us.id FROM users us WHERE us.employee_id=e.id LIMIT 1) AS user_id FROM employees e JOIN units u ON u.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id WHERE e.situacao='ATIVO' ${unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`} ORDER BY u.nome, e.nome`,
    sql<{ id: number; codigo: string; titulo: string; tipo: string; formato: string; procedure_id: number | null; validade_meses: number | null; para_todos: boolean; para_cargos: number[] | null; para_regime: string | null; carga_horas: number | null }[]>`SELECT id, codigo, titulo, tipo, formato, procedure_id, validade_meses, para_todos, para_cargos, para_regime, carga_horas::float FROM courses WHERE ativo AND tipo IN ('OBRIGATORIO','TRILHA_CARGO') ORDER BY codigo`,
    sql<{ course_id: number; employee_id: number; status: string; concluido_em: string | null; valido_ate: string | null }[]>`SELECT course_id, employee_id, status, concluido_em::text, valido_ate::text FROM training_progress`,
    sql<{ procedure_id: number; user_id: number }[]>`SELECT a.procedure_id, a.user_id FROM procedure_acks a JOIN procedures p ON p.id=a.procedure_id AND p.versao=a.versao AND p.status='VIGENTE'`,
  ]);
  const exige = (c: typeof cursos[number], e: typeof emps[number]) => c.para_todos || (Array.isArray(c.para_cargos) && e.position_id !== null && c.para_cargos.map(Number).includes(e.position_id)) || (!!c.para_regime && c.para_regime === e.regime);
  const linhas = emps.map(e => {
    const itens = cursos.filter(c => exige(c, e)).map(c => {
      let status = "PENDENTE"; let validoAte: string | null = null; let concluidoEm: string | null = null;
      if (c.formato === "POP" && c.procedure_id) { if (e.user_id && acks.some(a => a.procedure_id === c.procedure_id && a.user_id === e.user_id)) status = "CONCLUIDO"; }
      else { const p = prog.find(x => x.course_id === c.id && x.employee_id === e.id); if (p) { status = p.status; validoAte = p.valido_ate; concluidoEm = p.concluido_em; if (p.status === "CONCLUIDO" && p.valido_ate && p.valido_ate < h) status = "VENCIDO"; } }
      return { curso: c, status, validoAte, concluidoEm, vencendo: status === "CONCLUIDO" && !!validoAte && validoAte <= alerta };
    });
    const ok = itens.filter(i => i.status === "CONCLUIDO").length;
    return { emp: e, itens, total: itens.length, ok, pct: itens.length ? Math.round(100 * ok / itens.length) : null };
  });
  const totalItens = linhas.reduce((a, l) => a + l.total, 0), totalOk = linhas.reduce((a, l) => a + l.ok, 0);
  return { linhas, cursos, conformidade: totalItens ? Math.round(100 * totalOk / totalItens) : null, pendentes: totalItens - totalOk, vencendo: linhas.reduce((a, l) => a + l.itens.filter(i => i.vencendo).length, 0), vencidos: linhas.reduce((a, l) => a + l.itens.filter(i => i.status === "VENCIDO").length, 0) };
}

export function validadeFinal(concluidoEm: string, validadeMeses: number | null) { return validadeMeses ? addMonths(concluidoEm, validadeMeses) : null; }
