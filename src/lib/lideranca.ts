/**
 * v30 · Pesquisa de liderança (no estilo dos índices de efetividade do gestor): cada pessoa avalia o PRÓPRIO gestor direto, de forma
 * anônima, nas dimensões configuradas. Índice do gestor = % de respostas favoráveis (4–5) em todas as dimensões. Resultado de um gestor
 * só aparece com o mínimo de respostas; “pontos de atenção” contam quantos gestores ficam abaixo do limite em cada dimensão — e cada
 * dimensão traz as práticas sugeridas, ligadas ao que o ONE já tem (expectativas, 1:1, feedback, PDI, reconhecimento).
 */
import { sql } from "@/db";
import type { Pergunta } from "./clima-academy";

export function perguntasLideranca(dims: [string, string][]): Pergunta[] {
  const p: Pergunta[] = dims.map(([d, t], i) => ({ id: `l${i + 1}`, dimensao: d, texto: t, tipo: "ESCALA" }));
  p.push({ id: "enps", dimensao: "Recomendação", texto: "De 0 a 10, quanto você recomendaria trabalhar com o seu gestor direto?", tipo: "ENPS" });
  p.push({ id: "aberta", dimensao: "Comentário", texto: "O que o seu gestor poderia começar, parar ou continuar fazendo? (opcional — não se identifique)", tipo: "TEXTO" });
  return p;
}

/** Práticas sugeridas por dimensão — conversa do RH com o gestor, não punição. */
export const ACOES_LIDERANCA: Record<string, { texto: string; href: string }[]> = {
  "Clareza de expectativas": [{ texto: "Revisar com a equipe as expectativas do cargo e registrar a ciência", href: "/desempenho/expectativas" }, { texto: "Combinar metas com regra de leitura explícita", href: "/desempenho/metas" }],
  "Feedback": [{ texto: "Agendar 1:1 a cada 30 dias e registrar os combinados", href: "/equipe" }, { texto: "Registrar devolutivas no painel do colaborador", href: "/desempenho/lideranca" }],
  "Reconhecimento": [{ texto: "Reconhecer entregas no mural, ligadas aos valores da escola", href: "/reconhecimento" }],
  "Apoio ao desenvolvimento": [{ texto: "Abrir ou revisar o PDI de cada pessoa da equipe", href: "/desempenho/lideranca" }, { texto: "Indicar treinamentos da Academy", href: "/academy" }],
  "Condições para trabalhar": [{ texto: "Levantar bloqueios na 1:1 e abrir chamados de infraestrutura", href: "/operacoes/chamados" }],
  "Comunicação e escuta": [{ texto: "Reunião curta semanal com a equipe e retorno das sugestões", href: "/estrategia/rituais" }],
  "Confiança e respeito": [{ texto: "Conversa com o RH sobre o clima da equipe (o canal de ética continua aberto)", href: "/clima" }],
};

type Resposta = { gestor_id: number | null; respostas: Record<string, number | string>; comentario: string | null };
const favoravel = (vs: number[]) => (vs.length ? Math.round((100 * vs.filter(v => v >= 4).length) / vs.length) : null);

export type GestorLideranca = { gestorId: number; nome: string; unidade: string; unitId: number; n: number; liberado: boolean; indice: number | null; porDimensao: { dimensao: string; favoravel: number | null }[]; nps: number | null; atencao: string[]; comentarios: string[] };

/** Resultado por gestor (com o mínimo de respostas) e o resumo da rede: índice médio, gestores abaixo do alvo e os pontos de atenção por dimensão. */
export async function resultadosLideranca(surveyId: number, perguntas: Pergunta[], minimo: number, atencaoAbaixo: number) {
  const [rows, gestores] = await Promise.all([
    sql<Resposta[]>`SELECT gestor_id, respostas, comentario FROM climate_responses WHERE survey_id=${surveyId}`,
    sql<{ id: number; nome: string; unidade: string; unit_id: number }[]>`SELECT e.id, e.nome, u.nome AS unidade, e.unit_id FROM employees e JOIN units u ON u.id=e.unit_id WHERE e.id IN (SELECT DISTINCT gestor_id FROM climate_responses WHERE survey_id=${surveyId} AND gestor_id IS NOT NULL)`,
  ]);
  const escala = perguntas.filter(q => q.tipo === "ESCALA"); const dims = [...new Set(escala.map(q => q.dimensao))]; const rec = perguntas.find(q => q.tipo === "ENPS");
  const min = Math.max(3, minimo);
  const lista: GestorLideranca[] = gestores.map(g => {
    const rs = rows.filter(r => r.gestor_id === g.id); const liberado = rs.length >= min;
    const vals = (qs: Pergunta[]) => rs.flatMap(r => qs.map(q => Number(r.respostas[q.id]))).filter(v => v >= 1 && v <= 5);
    const porDimensao = dims.map(d => ({ dimensao: d, favoravel: liberado ? favoravel(vals(escala.filter(q => q.dimensao === d))) : null }));
    const recs = rec ? rs.map(r => Number(r.respostas[rec.id])).filter(v => v >= 0 && v <= 10 && !Number.isNaN(v)) : [];
    return { gestorId: g.id, nome: g.nome, unidade: g.unidade, unitId: g.unit_id, n: rs.length, liberado, indice: liberado ? favoravel(vals(escala)) : null, porDimensao,
      nps: liberado && recs.length ? Math.round((100 * (recs.filter(v => v >= 9).length - recs.filter(v => v <= 6).length)) / recs.length) : null,
      atencao: porDimensao.filter(d => d.favoravel !== null && d.favoravel < atencaoAbaixo).map(d => d.dimensao),
      comentarios: liberado ? rs.map(r => r.comentario).filter((c): c is string => !!c && c.trim().length > 3) : [] };
  }).sort((a, b) => (a.indice ?? 999) - (b.indice ?? 999) || a.nome.localeCompare(b.nome, "pt-BR"));
  const lib = lista.filter(l => l.liberado);
  const pontos = dims.map(d => { const baixos = lib.filter(l => (l.porDimensao.find(x => x.dimensao === d)?.favoravel ?? 100) < atencaoAbaixo); return { dimensao: d, abaixo: baixos.length, de: lib.length, rede: favoravel(rows.flatMap(r => escala.filter(q => q.dimensao === d).map(q => Number(r.respostas[q.id]))).filter(v => v >= 1 && v <= 5)) }; }).sort((a, b) => b.abaixo - a.abaixo);
  const todas = rows.flatMap(r => escala.map(q => Number(r.respostas[q.id]))).filter(v => v >= 1 && v <= 5);
  return { lista, pontos, total: rows.length, semGestor: rows.filter(r => !r.gestor_id).length, gestoresComMinimo: lib.length, gestoresAbaixoMinimo: lista.length - lib.length, indiceRede: rows.length >= min ? favoravel(todas) : null, minimo: min };
}

/** O resultado do próprio gestor na última pesquisa de liderança encerrada em que ele tem o mínimo de respostas. */
export async function minhaLideranca(employeeId: number, minimo: number, atencaoAbaixo: number) {
  const pesquisas = await sql<{ id: number; nome: string; fim: string; perguntas: Pergunta[] }[]>`SELECT s.id, s.nome, s.fim::text, s.perguntas FROM climate_surveys s WHERE s.tipo='LIDERANCA' AND s.status='ENCERRADA' AND EXISTS (SELECT 1 FROM climate_responses r WHERE r.survey_id=s.id AND r.gestor_id=${employeeId}) ORDER BY s.fim DESC LIMIT 2`;
  for (const p of pesquisas) { const r = await resultadosLideranca(p.id, p.perguntas, minimo, atencaoAbaixo); const eu = r.lista.find(l => l.gestorId === employeeId); if (eu) return { pesquisa: p, eu, rede: r.indiceRede }; }
  return null;
}
