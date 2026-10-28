"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, assertScope } from "@/lib/auth";
import { audit, str, strOrNull, int, hoje, caminhoSeguro } from "@/lib/utils";
import { DESFECHOS } from "@/lib/painel-dia";
import { salvarDias } from "@/lib/ponto";
import { comMensagem } from "@/lib/redirecionar";

const go = (b: string, k: "ok" | "erro", m: string) => comMensagem(b, k, m);

/** Contato do no-show (aceite T-048): o desfecho fica registrado e, quando é falta/atestado/folga/dispensa, alimenta o lançamento do dia. */
export async function registrarContato(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), "/ponto/hoje"); let txt = "Contato registrado.";
  try {
    const s = await requireSession(); assert(["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role), "Registrar contato: RH, Direção, direção da unidade ou gestor.");
    const id = int(fd, "employeeId") ?? 0; const desfecho = str(fd, "desfecho"); assert(!!DESFECHOS[desfecho], "Escolha o desfecho do contato.");
    const [e] = await sql<{ unit_id: number; nome: string; jornada: number | null }[]>`SELECT unit_id, nome, jornada_min_dia AS jornada FROM employees WHERE id=${id}`; assert(!!e, "Colaborador não encontrado."); assertScope(s, e.unit_id);
    const h = hoje(); const obs = strOrNull(fd, "obs");
    await sql`INSERT INTO daily_contacts (employee_id, data, desfecho, obs, user_id, user_nome) VALUES (${id}, ${h}, ${desfecho}, ${obs}, ${s.id}, ${s.nome})`;
    const ponto = DESFECHOS[desfecho].ponto;
    if (ponto) {
      const esperado = int(fd, "esperado") ?? e.jornada ?? 0;
      await salvarDias(s, id, [{ data: h, esperado, trabalhado: 0, status: ponto, obs: `Painel do dia: ${DESFECHOS[desfecho].rotulo}${obs ? ` — ${obs}` : ""}`, origem: "PAINEL_DIA" }]);
      txt = `Contato registrado e o dia lançado no ponto como ${DESFECHOS[desfecho].rotulo.toLowerCase()}${ponto === "FALTA" || ponto === "FOLGA_BANCO" ? " (o débito no banco segue a aprovação)" : ""}.`;
    }
    await audit(s, "contato do painel do dia", "daily_contacts", id, null, { desfecho, lancou: ponto });
  } catch (err) { redirect(go(voltar, "erro", err instanceof Error ? err.message : "Erro")); }
  redirect(go(voltar, "ok", txt));
}
