import { sql } from "@/db";
import { periodosFerias, addDays, hoje, type Periodo } from "./utils";

export type Alerta = { employeeId: number; nome: string; unidade: string; periodo: Periodo };

/** Períodos aquisitivos com saldo cujo prazo de concessão vence em `dias` dias ou já venceu (risco de férias em dobro). */
export async function feriasAVencer(unitId: number | null, dias = 90): Promise<Alerta[]> {
  const uf = unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`;
  const emps = await sql<{ id: number; nome: string; unidade: string; admissao: string; vinculo: string }[]>`SELECT e.id, e.nome, u.nome AS unidade, e.admissao::text, e.vinculo FROM employees e JOIN units u ON u.id=e.unit_id WHERE e.situacao='ATIVO' AND e.vinculo IN ('CLT','HORISTA') ${uf}`;
  if (emps.length === 0) return [];
  const usadas = await sql<{ employee_id: number; periodo_ref: string | null; dias: number }[]>`SELECT employee_id, periodo_ref::text, dias FROM leave_requests WHERE status='APROVADA' AND tipo='FERIAS' AND employee_id = ANY(${emps.map(e => e.id)})`;
  const limite = addDays(hoje(), dias); const out: Alerta[] = [];
  for (const e of emps) {
    const mine = usadas.filter(u => u.employee_id === e.id).map(u => ({ periodoRef: u.periodo_ref, dias: u.dias }));
    for (const p of periodosFerias(e.admissao, mine)) {
      if ((p.status === "ABERTO" && p.concessivoAte <= limite) || p.status === "VENCIDO") out.push({ employeeId: e.id, nome: e.nome, unidade: e.unidade, periodo: p });
    }
  }
  return out.sort((a, b) => a.periodo.concessivoAte.localeCompare(b.periodo.concessivoAte));
}
