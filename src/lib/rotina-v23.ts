import { sql } from "@/db";
import { rotinaInsights } from "./insights-rotina";
import { minhasPendencias, resumoPendencias, situacaoPend } from "./pendencias";
import { notificar } from "./comunicacao";
import { getSettings } from "./utils";
import type { Role, Session } from "./auth";

/**
 * Lembrete diário das pendências (dias úteis): quem tem pendência vencida ou para hoje recebe um aviso (notificação e celular)
 * só com números e módulos — nunca o conteúdo. Um aviso por pessoa por dia; com orçamento de tempo para não travar a rotina.
 */
export async function lembretePendencias(h: string, orcamentoMs = 20000) {
  const cfg = await getSettings(); const r = { avisados: 0, pessoas: 0, interrompido: false };
  if ((cfg.insights as { lembretePendencias?: boolean })?.lembretePendencias === false) return r;
  const dia = new Date(`${h}T12:00:00Z`).getUTCDay(); if (dia === 0 || dia === 6) return r;
  const t0 = Date.now();
  const users = await sql<{ id: number; nome: string; email: string; role: Role; unit_id: number | null; employee_id: number | null }[]>`SELECT u.id, u.nome, u.email, u.role, u.unit_id, u.employee_id FROM users u
    WHERE u.ativo AND u.role <> 'LEITURA' AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id=u.id AND n.chave=${`pend:${h}`} ) ORDER BY u.id`;
  for (const u of users) {
    if (Date.now() - t0 > orcamentoMs) { r.interrompido = true; break; }
    const s: Session = { id: u.id, nome: u.nome, email: u.email, role: u.role, unitId: u.unit_id, employeeId: u.employee_id };
    const { itens } = await minhasPendencias(s, { semTreinamentos: true }); r.pessoas++;
    const R = resumoPendencias(itens, h); if (!R.vencidas && !R.hoje) continue;
    const urgentes = itens.filter(i => ["VENCIDA", "HOJE"].includes(situacaoPend(i.prazo, h)));
    const modulos = [...new Set(urgentes.map(i => i.modulo))].slice(0, 3).join(", ");
    const partes = [R.vencidas ? `${R.vencidas} vencida(s)` : null, R.hoje ? `${R.hoje} para hoje` : null].filter(Boolean).join(" e ");
    await notificar([u.id], "Suas pendências de hoje", `${partes} — em ${modulos}. Abra Minhas pendências para resolver.`, "/pendencias", "ACAO", `pend:${h}`);
    r.avisados++;
  }
  return r;
}

/**
 * Rotina diária dos módulos da v23 (chamada por /api/tarefas). Cada bloco roda isolado: uma falha não impede os demais.
 * - Insights: base de indicadores em dia (fotos do dia) e resumo executivo semanal às segundas-feiras.
 * - Pendências: lembrete do dia para quem tem pendência vencida ou para hoje (dias úteis).
 */
export async function rotinaV23(h: string) {
  const out: Record<string, unknown> = {}; const falhas: string[] = [];
  const bloco = async (nome: string, f: () => Promise<unknown>) => { try { out[nome] = await f(); } catch (e) { falhas.push(`${nome}: ${e instanceof Error ? e.message : String(e)}`); } };
  await bloco("insights", async () => (await rotinaInsights(h)).insights);
  await bloco("pendencias", async () => lembretePendencias(h));
  return { ...out, falhas };
}
