import { sql } from "@/db";

export const ENTIDADES: Record<string, { tabela: string; unidade: string | null }> = { employee: { tabela: "employees", unidade: "unit_id" }, student: { tabela: "students", unidade: "unit_atual_id" }, case: { tabela: "cases", unidade: "unit_id" }, work_order: { tabela: "work_orders", unidade: "unit_id" }, project: { tabela: "projects", unidade: "unit_id" }, procedure: { tabela: "procedures", unidade: null }, receivable: { tabela: "receivables", unidade: "unit_id" }, asset: { tabela: "assets", unidade: "unit_id" } };

/** Unidade do registro dono do anexo (para o escopo por unidade). */
export async function unidadeDoRegistro(entidade: string, id: number): Promise<number | null> {
  const e = ENTIDADES[entidade]; if (!e) throw new Error("Tipo de registro inválido."); if (!e.unidade) return null;
  const [r] = await sql<{ u: number | null }[]>`SELECT ${sql(e.unidade)} AS u FROM ${sql(e.tabela)} WHERE id=${id}`; if (!r) throw new Error("Registro não encontrado."); return r.u;
}
