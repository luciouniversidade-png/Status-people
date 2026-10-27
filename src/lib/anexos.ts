import { sql } from "@/db";
import type { Session } from "./auth";
import { scopeUnit } from "./auth";

export const ENTIDADES: Record<string, { tabela: string; unidade: string | null }> = {
  employee: { tabela: "employees", unidade: "unit_id" }, student: { tabela: "students", unidade: "unit_atual_id" }, case: { tabela: "cases", unidade: "unit_id" }, work_order: { tabela: "work_orders", unidade: "unit_id" }, project: { tabela: "projects", unidade: "unit_id" }, procedure: { tabela: "procedures", unidade: null }, receivable: { tabela: "receivables", unidade: "unit_id" }, asset: { tabela: "assets", unidade: "unit_id" },
  // v22
  contract: { tabela: "contracts", unidade: "unit_id" }, license: { tabela: "licenses", unidade: "unit_id" }, request: { tabela: "requests", unidade: "unit_id" }, emergency_event: { tabela: "emergency_events", unidade: "unit_id" },
  privacy_request: { tabela: "privacy_requests", unidade: null }, privacy_incident: { tabela: "privacy_incidents", unidade: "unit_id" }, ethics_report: { tabela: "ethics_reports", unidade: null },
  // v27 · contas a pagar (boleto, nota fiscal, comprovante)
  payable: { tabela: "payables", unidade: "unit_id" },
  // v24
  payroll_cycle: { tabela: "payroll_cycles", unidade: null }, cash_entry: { tabela: "cash_entries", unidade: "unit_id" }, obligation: { tabela: "obligations", unidade: "unit_id" }, fiscal_case: { tabela: "fiscal_cases", unidade: null },
  timesheet_day: { tabela: "timesheet_days", unidade: null }, candidate_doc: { tabela: "candidate_doc_requests", unidade: null }, sst_exam: { tabela: "sst_exams", unidade: null }, sst_incident: { tabela: "sst_incidents", unidade: "unit_id" }, audit: { tabela: "audits", unidade: "unit_id" }, nonconformity: { tabela: "nonconformities", unidade: "unit_id" },
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
  // v24 · folha: holerites só RH/Direção (e o próprio colaborador, no individual); guias e resumo também para o Financeiro
  if (entidade === "payroll_cycle") {
    if (modo === "editar") return ["RH", "DIRECAO"].includes(s.role) ? true : false;
    if (["RH", "DIRECAO"].includes(s.role)) return true;
    return false;
  }
  // v24 · documento de um lançamento de caixa (drill da DRE até o documento): quem vê o financeiro vê; anexa Financeiro/Direção
  if (entidade === "payable") return modo === "ver" ? (["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE"].includes(s.role) ? null : false) : (["DIRECAO", "FINANCEIRO"].includes(s.role) ? null : false);
  if (entidade === "cash_entry") return modo === "ver" ? (["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE", "RH"].includes(s.role) ? null : false) : (["DIRECAO", "FINANCEIRO"].includes(s.role) ? null : false);
  // v24 · obrigações e fiscalizações: Financeiro e Direção (RH também, para as guias da folha)
  if (entidade === "obligation" || entidade === "fiscal_case") return (modo === "ver" ? ["FINANCEIRO", "DIRECAO", "RH", "LEITURA"] : ["FINANCEIRO", "DIRECAO"]).includes(s.role) ? true : false;
  // v24 · SST: exames e incidentes são restritos ao RH e à Direção (nunca dado clínico — só datas, aptidão e o comprovante)
  if (entidade === "sst_exam" || entidade === "sst_incident") return ["RH", "DIRECAO"].includes(s.role) ? true : false;
  // v25 · documento enviado pelo candidato no portal (T-106): RH e Direção; o diretor(a) da unidade da vaga também vê
  if (entidade === "candidate_doc") {
    if (["RH", "DIRECAO"].includes(s.role)) return true;
    if (modo === "ver" && s.role === "DIRETOR_UNIDADE") { const [r] = await sql<{ unit_id: number }[]>`SELECT q.unit_id FROM candidate_doc_requests d JOIN applications a ON a.id=d.application_id JOIN requisitions q ON q.id=a.requisition_id WHERE d.id=${id}`; return !!r && r.unit_id === scopeUnit(s); }
    return false;
  }
  // v25 · atestado anexado ao dia do ponto (auditoria T-050): documento sensível — RH e Direção; o próprio colaborador vê o seu
  if (entidade === "timesheet_day") {
    if (["RH", "DIRECAO"].includes(s.role)) return true;
    if (modo === "ver" && s.employeeId) { const [d] = await sql<{ employee_id: number }[]>`SELECT employee_id FROM timesheet_days WHERE id=${id}`; return d?.employee_id === s.employeeId; }
    return false;
  }
  if (entidade === "request") {
    if (["DIRECAO", "RH", "FINANCEIRO"].includes(s.role)) return true;
    const [r] = await sql<{ ok: boolean; unit_id: number | null }[]>`SELECT (solicitante_user_id=${s.id} OR EXISTS (SELECT 1 FROM jsonb_array_elements(etapas) e WHERE (e->'aprovadores') @> to_jsonb(${s.id}::int))) AS ok, unit_id FROM requests WHERE id=${id}`;
    if (!r) return false; if (r.ok) return true; const u = scopeUnit(s); return s.role === "DIRETOR_UNIDADE" && r.unit_id !== null && r.unit_id === u;
  }
  return null;
}

/** v24 · acesso a um documento da folha (pelo anexo): regra fina por tipo e registro de consulta (CRQ-FOL-V3-03). */
export async function acessoDocFolha(s: Session, attachmentId: number): Promise<{ ok: boolean; docId: number | null }> {
  const [d] = await sql<{ id: number; tipo: string; employee_id: number | null }[]>`SELECT id, tipo, employee_id FROM payroll_docs WHERE attachment_id=${attachmentId}`;
  if (!d) return { ok: ["RH", "DIRECAO"].includes(s.role), docId: null };
  if (["RH", "DIRECAO"].includes(s.role)) return { ok: true, docId: d.id };
  if (s.role === "FINANCEIRO") return { ok: d.tipo.startsWith("GUIA_") || d.tipo === "RESUMO_FOLHA", docId: d.id };
  if (s.role === "COLABORADOR") return { ok: d.tipo === "HOLERITES" && d.employee_id !== null && d.employee_id === s.employeeId, docId: d.id };
  return { ok: false, docId: d.id };
}
