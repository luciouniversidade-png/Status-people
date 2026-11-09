import { sql } from "@/db";
import { hoje } from "@/lib/utils";
import { hashToken } from "@/lib/portal-candidato";
import { notificar, usuariosPorPerfil } from "@/lib/comunicacao";

/**
 * v33 · Portal do fornecedor (SO-ARCH-SUP-001, UX-SUP-11): link pessoal com prazo, guardado só como hash. O fornecedor vê e propõe
 * mudanças apenas dos próprios dados — nada do que envia vale sozinho: contatos e endereço viram pedido para revisão, conta bancária
 * entra na quarentena (conferência por canal conhecido + aprovação) e documento chega para conferência. Nunca mostra avaliações,
 * risco, preços, títulos ou outros fornecedores.
 */
export const QUEM_PORTAL = "Fornecedor (portal)";
export type ContextoFornecedor = { conviteId: number; supplierId: number; nome: string; status: string; tipo: string; criticidade: string; categoria: string | null; email: string | null; escopo: string[]; expira_em: string; criado_por_nome: string | null };

export async function contextoFornecedor(token: string, marcar = true): Promise<ContextoFornecedor> {
  if (!token || token.length < 20 || token.length > 100) throw new Error("Link inválido.");
  const [c] = await sql<(ContextoFornecedor & { estado: string })[]>`SELECT i.id AS "conviteId", i.supplier_id AS "supplierId", s.nome, s.status, s.tipo, s.criticidade, s.categoria, i.email, i.escopo, i.expira_em::text, i.criado_por_nome, i.estado
    FROM supplier_invitations i JOIN suppliers s ON s.id=i.supplier_id WHERE i.token_hash=${hashToken(token)}`;
  if (!c) throw new Error("Link inválido.");
  if (c.estado !== "ATIVO" || c.expira_em < hoje() || ["INATIVO", "REJEITADO"].includes(c.status)) throw new Error("Este link não está mais ativo. Peça um novo ao seu contato no Colégio Status.");
  if (marcar) await sql`UPDATE supplier_invitations SET aberto_em=coalesce(aberto_em, now()), ultimo_acesso=now() WHERE id=${c.conviteId}`;
  return c;
}
export const podePortal = (c: ContextoFornecedor, parte: "contatos" | "banco" | "documentos") => (c.escopo ?? []).includes(parte);

/** Protocolo legível (FOR-2026-0001) para o pedido de alteração enviado pelo portal. */
export async function novoProtocoloFornecedor(): Promise<string> {
  const ano = hoje().slice(0, 4);
  const [{ n }] = await sql<{ n: number }[]>`SELECT coalesce(max(substring(protocolo from 10)::int), 0)::int AS n FROM supplier_change_requests WHERE protocolo LIKE ${`FOR-${ano}-%`}`;
  return `FOR-${ano}-${String(n + 1).padStart(4, "0")}`;
}
/** Aviso interno sem nome do fornecedor no título (contagem e link para a fila). */
export async function avisarCompras(titulo: string, link: string, chave: string) {
  await notificar(await usuariosPorPerfil(["FINANCEIRO", "DIRECAO", "OPERACOES"]), titulo, null, link, "ACAO", chave);
}
