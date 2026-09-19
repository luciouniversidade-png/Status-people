import { redirect } from "next/navigation";
import { requireSession, type Session } from "@/lib/auth";
import { sql } from "@/db";

export const GESTAO = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"];
export const EQUIPE = [...GESTAO, "COMERCIAL"];
/** Páginas de gestão da governança: colaborador e leitura vão para a biblioteca de POPs. */
export async function requireGestao(): Promise<Session> {
  const s = await requireSession();
  if (!EQUIPE.includes(s.role)) redirect("/governanca/pops");
  return s;
}
export const usuariosGestao = () => sql<{ id: number; nome: string; role: string }[]>`SELECT id, nome, role FROM users WHERE ativo AND role IN ('RH','DIRECAO','DIRETOR_UNIDADE','GESTOR','COMERCIAL') ORDER BY nome`;
export const popsLista = () => sql<{ id: number; codigo: string; titulo: string; status: string }[]>`SELECT id, codigo, titulo, status FROM procedures WHERE status <> 'OBSOLETO' ORDER BY codigo`;
