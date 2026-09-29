import { sql } from "@/db";
import { calcular, type Criterio, type Notas } from "./avaliacao";

/** Critérios com evidência contestada (limitação exibida na memória de cálculo). */
export async function contestadosDa(reviewId: number, employeeId: number, cycleId: number) {
  const r = await sql<{ c: string | null; cs: string[] | null }[]>`SELECT criterio_id AS c, criterios AS cs FROM eval_evidences WHERE validacao='CONTESTADA' AND (review_id=${reviewId} OR (employee_id=${employeeId} AND cycle_id=${cycleId}))`;
  return [...new Set(r.flatMap(x => [x.c, ...(x.cs ?? [])]).filter((x): x is string => !!x))];
}
type R = { id: number; employeeId: number; cycleId: number; notasCriterios: unknown };
type C = { criterios: unknown; pesoResultados: number; pesoAtitudes: number; notaComposta: boolean; coberturaMinima: number };
/** Único ponto de cálculo usado por telas, ações, exportações e rotina: aplica as regras congeladas do ciclo. */
export async function calcularRevisao(r: R, c: C, notas?: Notas) {
  return calcular((c.criterios as Criterio[] | null) ?? [], notas ?? ((r.notasCriterios as Notas | null) ?? {}), c.pesoResultados, c.pesoAtitudes, { composta: c.notaComposta, coberturaMinima: c.coberturaMinima, contestados: await contestadosDa(r.id, r.employeeId, r.cycleId) });
}
