import { db, schema } from "@/db";
import { addDays } from "./utils";

/** Abre um processo (admissão/desligamento) com o checklist configurado. */
export async function abrirProcesso(userId: number, employeeId: number, tipo: "ADMISSAO" | "DESLIGAMENTO", inicio: string, itens: string[]) {
  const [p] = await db.insert(schema.processes).values({ employeeId, tipo, inicio, prazo: addDays(inicio, tipo === "ADMISSAO" ? 30 : 10), responsavelUserId: userId }).returning({ id: schema.processes.id });
  await db.insert(schema.processItems).values(itens.map((titulo, i) => ({ processId: p.id, titulo, ordem: i })));
  return p.id;
}

