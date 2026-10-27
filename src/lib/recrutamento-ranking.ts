// v26 · leitura da aderência e da shortlist de uma vaga (servidor)
import { sql } from "@/db";
import { criteriosDoTexto, type Criterio, type DetalheFit, type FonteFit } from "@/lib/recrutamento-fit";

export type LinhaRanking = { application_id: number; candidate_id: number; nome: string; etapa: string; origem: string | null; score: number | null; atende: number | null; total: number | null; faltando: number | null; detalhes: DetalheFit[] | null; metodo: string | null; modelo: string | null; mascarados: number | null; calculado_em: Date | null; tem_texto: boolean; decisao: string | null; decisao_nome: string | null; decisao_em: Date | null; posicao: number; sugerido: boolean };

export const ETAPAS_FORA = ["REPROVADO", "DESISTIU", "CONTRATADO"];

/** Critérios da vaga: os editados no sistema ou, sem eles, lidos dos requisitos. */
export function criteriosDaVaga(r: { criteriosFit?: unknown; requisitos?: string | null }): Criterio[] {
  const c = r.criteriosFit as Criterio[] | null | undefined;
  return Array.isArray(c) && c.length ? c : criteriosDoTexto(r.requisitos);
}

/** Ranking da vaga: primeiro quem comprova todos os obrigatórios, depois a maior aderência; sem cálculo vai para o fim. */
export async function rankingVaga(rid: number, cfg: { tamanhoShortlist: number; minimoSugestao: number }): Promise<LinhaRanking[]> {
  const rows = await sql<Omit<LinhaRanking, "posicao" | "sugerido">[]>`SELECT a.id AS application_id, a.candidate_id, c.nome, a.etapa, c.origem, f.score, f.atende, f.total, f.obrigatorios_faltando AS faltando, f.detalhes, f.metodo, f.modelo, f.mascarados, f.calculado_em,
      (coalesce(length(c.curriculo_texto),0) + coalesce(length(c.formacao),0) + coalesce(length(c.tags),0) + coalesce(length(c.obs),0) + coalesce(length(a.notas),0)) > 20 AS tem_texto,
      d.decisao, d.decidido_nome AS decisao_nome, d.decidido_em AS decisao_em
    FROM applications a JOIN candidates c ON c.id=a.candidate_id LEFT JOIN application_fit f ON f.application_id=a.id
    LEFT JOIN LATERAL (SELECT decisao, decidido_nome, decidido_em FROM shortlist_decisions x WHERE x.application_id=a.id ORDER BY x.decidido_em DESC LIMIT 1) d ON true
    WHERE a.requisition_id=${rid} AND a.etapa NOT IN ('REPROVADO','DESISTIU','CONTRATADO') AND a.retirada_em IS NULL
    ORDER BY (f.score IS NULL), f.obrigatorios_faltando ASC NULLS LAST, f.score DESC NULLS LAST, a.created_at ASC`;
  let n = 0;
  return rows.map((r, i) => { const elegivel = r.score !== null && (r.faltando ?? 0) === 0 && r.score >= cfg.minimoSugestao; const sugerido = elegivel && n < cfg.tamanhoShortlist; if (sugerido) n++; return { ...r, posicao: i + 1, sugerido }; });
}

/** Textos do candidato que entram na análise (nunca o scorecard, nunca documentos pessoais). */
export async function fontesDoCandidato(applicationId: number): Promise<{ fontes: FonteFit[]; candidateId: number } | null> {
  const [x] = await sql<{ candidate_id: number; curriculo_texto: string | null; formacao: string | null; tags: string | null; obs: string | null; notas: string | null }[]>`SELECT a.candidate_id, c.curriculo_texto, c.formacao, c.tags, c.obs, a.notas FROM applications a JOIN candidates c ON c.id=a.candidate_id WHERE a.id=${applicationId}`;
  if (!x) return null;
  const fontes: FonteFit[] = [];
  if (x.curriculo_texto?.trim()) fontes.push({ id: "CV", rotulo: "Currículo", texto: x.curriculo_texto });
  const ficha = [x.formacao && `Formação: ${x.formacao}`, x.tags && `Palavras-chave: ${x.tags}`, x.obs && `Observações: ${x.obs}`].filter(Boolean).join("\n"); if (ficha) fontes.push({ id: "FICHA", rotulo: "Ficha do candidato", texto: ficha });
  if (x.notas?.trim()) fontes.push({ id: "NOTAS", rotulo: "Anotações do RH", texto: x.notas });
  return { fontes, candidateId: x.candidate_id };
}
