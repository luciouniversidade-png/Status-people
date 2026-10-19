import { randomBytes, createHash } from "crypto";
import { sql } from "@/db";
import { hoje, addDays, getSettings } from "./utils";
import { notificar, usuariosPorPerfil } from "./comunicacao";

/**
 * T-106 · Portal do candidato: link pessoal (token guardado só como hash), escopo mínimo — a própria candidatura.
 * O candidato vê a etapa, envia os documentos pedidos, escolhe um dos horários oferecidos, troca mensagens registradas
 * e pode retirar a candidatura ou pedir a exclusão dos dados (LGPD). Nada de notas internas, scorecard ou proposta.
 */
export const DOC_STATUS: Record<string, [string, string]> = { PENDENTE: ["PENDENTE", "a enviar"], ENVIADO: ["EM_ADMISSAO", "enviado — em conferência"], ACEITO: ["APROVADA", "conferido"], RECUSADO: ["REJEITADA", "reenviar"] };
export const SLOT_STATUS: Record<string, [string, string]> = { OFERECIDO: ["PENDENTE", "oferecido"], ESCOLHIDO: ["APROVADA", "confirmado"], DESCARTADO: ["CANCELADA", "não escolhido"], CANCELADO: ["CANCELADA", "cancelado"] };
export const novoTokenPortal = () => randomBytes(24).toString("base64url");
export const hashToken = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

export type Contexto = { linkId: number; applicationId: number; candidateId: number; requisitionId: number; nome: string; email: string | null; vaga: string; unidade: string; unitId: number; etapa: string; retirada: boolean; expira_em: string; responsavel: number | null; exclusao: string | null };
/** Resolve o link do portal (ativo e no prazo) e marca o acesso. Mensagens de erro pensadas para quem está fora da escola. */
export async function contextoPortal(token: string, marcar = true): Promise<Contexto> {
  if (!token || token.length < 20) throw new Error("Link inválido.");
  const [l] = await sql<(Contexto & { status: string })[]>`SELECT l.id AS "linkId", l.status, l.expira_em::text, a.id AS "applicationId", c.id AS "candidateId", r.id AS "requisitionId", c.nome, c.email, r.titulo AS vaga, u.nome AS unidade, r.unit_id AS "unitId", a.etapa, (a.retirada_em IS NOT NULL) AS retirada, r.responsavel_user_id AS responsavel, c.exclusao_pedida_em::text AS exclusao
    FROM candidate_portal_links l JOIN applications a ON a.id=l.application_id JOIN candidates c ON c.id=a.candidate_id JOIN requisitions r ON r.id=a.requisition_id JOIN units u ON u.id=r.unit_id WHERE l.token_hash=${hashToken(token)}`;
  if (!l) throw new Error("Link inválido.");
  if (l.status !== "ATIVO" || l.expira_em < hoje()) throw new Error("Este link não está mais ativo. Fale com o RH do Colégio Status para receber um novo.");
  if (marcar) await sql`UPDATE candidate_portal_links SET aberto_em=coalesce(aberto_em, now()), ultimo_acesso=now() WHERE id=${l.linkId}`;
  return l;
}
/** Gera o link pessoal (revoga o anterior da mesma candidatura) e devolve o token — mostrado uma única vez ao RH. */
export async function gerarLinkPortal(applicationId: number, userId: number, dias?: number) {
  const cfg = await getSettings(); const validade = Math.max(1, Math.min(120, dias ?? Number(cfg.recrutamento.portal?.validadeDias ?? 30)));
  const token = novoTokenPortal();
  await sql.begin(async tx => {
    await tx`UPDATE candidate_portal_links SET status='REVOGADO', encerrado_em=now() WHERE application_id=${applicationId} AND status='ATIVO'`;
    await tx`INSERT INTO candidate_portal_links (application_id, token_hash, expira_em, criado_por) VALUES (${applicationId}, ${hashToken(token)}, ${addDays(hoje(), validade)}, ${userId})`;
  });
  return { token, validade };
}
/** Registro na linha do tempo da candidatura: origem CANDIDATO (portal) ou RH_PARA_CANDIDATO (aparece no portal). */
export async function registrar(applicationId: number, texto: string, origem: "CANDIDATO" | "RH_PARA_CANDIDATO" | "RH", userNome: string) {
  await sql`INSERT INTO application_events (application_id, user_nome, texto, origem) VALUES (${applicationId}, ${userNome}, ${texto.slice(0, 1200)}, ${origem})`;
}
/** Aviso ao responsável pela vaga (ou ao RH): só a vaga e o que aconteceu — sem dado do candidato na notificação. */
export async function avisarRh(c: Contexto, titulo: string, chave: string) {
  const dest = c.responsavel ? [c.responsavel] : await usuariosPorPerfil(["RH"]);
  await notificar(dest, titulo, `Vaga: ${c.vaga} (${c.unidade})`, `/recrutamento/vagas/${c.requisitionId}`, "ACAO", chave);
}
