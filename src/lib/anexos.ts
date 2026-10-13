import { sql } from "@/db";
import type { Session } from "./auth";
import { scopeUnit } from "./auth";

export const ENTIDADES: Record<string, { tabela: string; unidade: string | null }> = {
  employee: { tabela: "employees", unidade: "unit_id" }, student: { tabela: "students", unidade: "unit_atual_id" }, case: { tabela: "cases", unidade: "unit_id" }, work_order: { tabela: "work_orders", unidade: "unit_id" }, project: { tabela: "projects", unidade: "unit_id" }, procedure: { tabela: "procedures", unidade: null }, receivable: { tabela: "receivables", unidade: "unit_id" }, asset: { tabela: "assets", unidade: "unit_id" },
  // v22
  contract: { tabela: "contracts", unidade: "unit_id" }, license: { tabela: "licenses", unidade: "unit_id" }, request: { tabela: "requests", unidade: "unit_id" }, emergency_event: { tabela: "emergency_events", unidade: "unit_id" },
  privacy_request: { tabela: "privacy_requests", unidade: null }, privacy_incident: { tabela: "privacy_incidents", unidade: "unit_id" }, ethics_report: { tabela: "ethics_reports", unidade: null },
};

/** Unidade do registro dono do anexo (para o escopo por unidade). */
export async function unidadeDoRegistro(entidade: string, id: number): Promise<number | null> {
  const e = ENTIDADES[entidade]; if (!e) throw new Error("Tipo de registro inválido."); if (!e.unidade) { const [r] = await sql`SELECT 1 FROM ${sql(e.tabela)} WHERE id=${id}`; if (!r) throw new Error("Registro não encontrado."); return null; }
  const [r] = await sql<{ u: number | null }[]>`SELECT ${sql(e.unidade)} AS u FROM ${sql(e.tabela)} WHERE id=${id}`; if (!r) throw new Error("Registro não encontrado."); return r.u;
}

/**
 * Regras extras de acesso aos anexos de registros sensíveis (privacidade, ética, solicitações, contratos e licenças).
 * null = segue a regra geral (escopo da unidade; Leitura não anexa). `modo`: "ver" (baixar) ou "editar" (anexar/remover).
 */
export async function acessoAnexoRestrito(s: Session, entidade: string, id: number, modo: "ver" | "editar" = "ver"): Promise<boolean | null> {
  if (entidade === "contract" || entidade === "license") {
    const { podeContratos, podeLicencas, veContratos, veLicencas } = await import("./contratos");
    if (modo === "ver") return (entidade === "contract" ? veContratos(s) : veLicencas(s)) ? null : false;
    if (!(entidade === "contract" ? podeContratos(s) : podeLicencas(s))) return false;
    // diretor(a) de unidade só mexe nos da própria unidade (contrato da rede: só a gestão central)
    const u = scopeUnit(s); if (u === null) return null;
    const [r] = await sql<{ unit_id: number | null }[]>`SELECT unit_id FROM ${sql(entidade === "contract" ? "contracts" : "licenses")} WHERE id=${id}`;
    return r && r.unit_id === u ? null : false;
  }
  if (entidade === "privacy_request" || entidade === "privacy_incident") { const { podePrivacidade } = await import("./privacidade"); return podePrivacidade(s); }
  if (entidade === "ethics_report") { const { podeTratarRelato } = await import("./etica"); const [r] = await sql<{ impedidos: number[] | null; liberados: number[] | null; envolvidos: string | null; relato: string }[]>`SELECT impedidos, liberados, envolvidos, relato FROM ethics_reports WHERE id=${id}`; return !!r && podeTratarRelato(s, r); }
  if (entidade === "request") {
    if (["DIRECAO", "RH", "FINANCEIRO"].includes(s.role)) return true;
    const [r] = await sql<{ ok: boolean; unit_id: number | null }[]>`SELECT (solicitante_user_id=${s.id} OR EXISTS (SELECT 1 FROM jsonb_array_elements(etapas) e WHERE (e->'aprovadores') @> to_jsonb(${s.id}::int))) AS ok, unit_id FROM requests WHERE id=${id}`;
    if (!r) return false; if (r.ok) return true; const u = scopeUnit(s); return s.role === "DIRETOR_UNIDADE" && r.unit_id !== null && r.unit_id === u;
  }
  return null;
}
