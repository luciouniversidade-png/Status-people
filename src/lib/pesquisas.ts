/**
 * v34 · Pesquisas internas (referência: MarQ HR): perguntas de escala, múltipla escolha (uma ou várias) e texto, respondidas
 * dentro do ONE. Anônima (padrão): a resposta não guarda quem respondeu nem quando, e o resultado só aparece com o mínimo de
 * respostas (também por unidade). Identificada: o RH vê quem respondeu o quê e exporta em CSV — e a pessoa é avisada antes.
 */
import { sql } from "@/db";
import type { Session } from "./auth";

export type Pergunta = { id: string; tipo: "ESCALA" | "UNICA" | "MULTIPLA" | "TEXTO"; texto: string; opcoes?: string[]; obrigatoria: boolean };
export const TIPO_PERGUNTA: Record<string, string> = { ESCALA: "Escala de 1 a 5", UNICA: "Múltipla escolha (uma)", MULTIPLA: "Múltipla escolha (várias)", TEXTO: "Texto livre" };
export const STATUS_PESQUISA: Record<string, string> = { RASCUNHO: "Rascunho", ABERTA: "Aberta", ENCERRADA: "Encerrada" };
export const PUBLICO: Record<string, string> = { TODOS: "Toda a equipe", UNIDADE: "Uma unidade", CARGO: "Um cargo" };
export const ESCALA_ROTULO = ["", "Discordo totalmente", "Discordo", "Neutro", "Concordo", "Concordo totalmente"];
export const podePesquisas = (s: Session) => ["RH", "DIRECAO"].includes(s.role);

/** Lê o texto do formulário: uma pergunta por linha — “TIPO | pergunta | opção1; opção2” (o * no fim da pergunta = opcional). */
export function lerPerguntas(texto: string): Pergunta[] {
  const out: Pergunta[] = [];
  texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach((l, i) => {
    const [t0, q0, o0] = l.split("|").map(x => x.trim()); const tipo = (t0 ?? "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const mapa: Record<string, Pergunta["tipo"]> = { ESCALA: "ESCALA", UNICA: "UNICA", MULTIPLA: "MULTIPLA", TEXTO: "TEXTO" };
    if (!mapa[tipo]) throw new Error(`Linha ${i + 1}: comece com ESCALA, UNICA, MULTIPLA ou TEXTO.`);
    let q = (q0 ?? "").slice(0, 300); if (q.length < 5) throw new Error(`Linha ${i + 1}: escreva a pergunta.`);
    const opcional = q.endsWith("*"); if (opcional) q = q.slice(0, -1).trim();
    const opcoes = mapa[tipo] === "UNICA" || mapa[tipo] === "MULTIPLA" ? [...new Set((o0 ?? "").split(";").map(x => x.trim().slice(0, 120)).filter(Boolean))] : undefined;
    if (opcoes && (opcoes.length < 2 || opcoes.length > 12)) throw new Error(`Linha ${i + 1}: de 2 a 12 opções, separadas por ponto e vírgula.`);
    out.push({ id: `q${i + 1}`, tipo: mapa[tipo], texto: q, ...(opcoes ? { opcoes } : {}), obrigatoria: !opcional && mapa[tipo] !== "TEXTO" });
  });
  if (!out.length) throw new Error("Escreva ao menos uma pergunta."); if (out.length > 30) throw new Error("No máximo 30 perguntas.");
  return out;
}
export const perguntasTexto = (ps: Pergunta[]) => ps.map(p => [p.tipo, p.texto + (!p.obrigatoria && p.tipo !== "TEXTO" ? " *" : ""), ...(p.opcoes ? [p.opcoes.join("; ")] : [])].join(" | ")).join("\n");

/** A pessoa está no público da pesquisa? */
export async function noPublico(surveyId: number, employeeId: number | null): Promise<boolean> {
  if (!employeeId) return false;
  const [r] = await sql<{ ok: boolean }[]>`SELECT (sv.publico='TODOS' OR (sv.publico='UNIDADE' AND sv.unit_id=e.unit_id) OR (sv.publico='CARGO' AND sv.position_id=e.position_id)) AS ok FROM custom_surveys sv, employees e WHERE sv.id=${surveyId} AND e.id=${employeeId} AND e.situacao <> 'DESLIGADO'`;
  return !!r?.ok;
}
/** Pesquisas abertas que a pessoa ainda não respondeu. */
export async function pesquisasPendentes(s: Session) {
  if (!s.employeeId) return [] as { id: number; titulo: string; fim: string; identificada: boolean }[];
  return sql<{ id: number; titulo: string; fim: string; identificada: boolean }[]>`SELECT sv.id, sv.titulo, sv.fim::text, sv.identificada FROM custom_surveys sv JOIN employees e ON e.id=${s.employeeId}
    WHERE sv.status='ABERTA' AND sv.inicio <= current_date AND sv.fim >= current_date AND (sv.publico='TODOS' OR (sv.publico='UNIDADE' AND sv.unit_id=e.unit_id) OR (sv.publico='CARGO' AND sv.position_id=e.position_id))
      AND NOT EXISTS (SELECT 1 FROM custom_survey_marks m WHERE m.survey_id=sv.id AND m.user_id=${s.id}) ORDER BY sv.fim`;
}
/** Tamanho do público (para a taxa de resposta). */
export async function tamanhoPublico(sv: { publico: string; unit_id: number | null; position_id: number | null }) {
  const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM employees e WHERE e.situacao NOT IN ('DESLIGADO','EM_ADMISSAO') ${sv.publico === "UNIDADE" ? sql`AND e.unit_id=${sv.unit_id}` : sv.publico === "CARGO" ? sql`AND e.position_id=${sv.position_id}` : sql``}`;
  return r?.n ?? 0;
}

export type Resultado = { pergunta: Pergunta; n: number; media?: number | null; dist?: number[]; contagem?: [string, number][]; textos?: string[] };
/** Agrega as respostas (de um recorte, se houver) por pergunta. */
export function agregar(perguntas: Pergunta[], respostas: Record<string, unknown>[]): Resultado[] {
  return perguntas.map(p => {
    const vs = respostas.map(r => r[p.id]).filter(v => v !== undefined && v !== null && v !== "");
    if (p.tipo === "ESCALA") { const ns = vs.map(Number).filter(n => n >= 1 && n <= 5); return { pergunta: p, n: ns.length, media: ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null, dist: [1, 2, 3, 4, 5].map(k => ns.filter(n => n === k).length) }; }
    if (p.tipo === "UNICA" || p.tipo === "MULTIPLA") { const todas = vs.flatMap(v => (Array.isArray(v) ? v : [v]).map(String)); return { pergunta: p, n: vs.length, contagem: (p.opcoes ?? []).map(o => [o, todas.filter(x => x === o).length] as [string, number]) }; }
    return { pergunta: p, n: vs.length, textos: vs.map(String) };
  });
}
/** Embaralha (sem semente previsível) os comentários anônimos: a ordem não denuncia quem respondeu primeiro. */
export function embaralhar<T>(xs: T[]): T[] { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
