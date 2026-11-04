// v31 · rotina diária: lembrete da 1:1 do dia (para as duas pessoas), pedido de feedback que vence amanhã e metas propostas
// esperando o gestor há mais de 7 dias. Avisos sem nomes (aparecem na tela de bloqueio do celular).
import { sql } from "@/db";
import { notificar } from "./comunicacao";
import { hoje, addDays } from "./utils";

export async function rotinaV31(h = hoje()) {
  const r = { umAUmHoje: 0, pedidosVencendo: 0, metasParadas: 0, falhas: [] as string[] };
  try {
    const xs = await sql<{ id: number; organizador_user_id: number; inicio: string; convidado: number | null }[]>`SELECT o.id, o.organizador_user_id, o.inicio, (SELECT us.id FROM users us WHERE us.employee_id=o.employee_id AND us.ativo ORDER BY us.id LIMIT 1) AS convidado FROM one_on_ones o WHERE o.status='MARCADA' AND o.data=${h}`;
    for (const x of xs) { await notificar([x.organizador_user_id, x.convidado ?? 0], `Você tem 1:1 hoje às ${x.inicio}`, "Confira a pauta antes da conversa.", `/um-a-um/${x.id}`, "ACAO", `1a1-dia:${x.id}`); r.umAUmHoje++; }
  } catch (e) { r.falhas.push(`1:1: ${e instanceof Error ? e.message : String(e)}`); }
  try {
    const xs = await sql<{ id: number; para_user_id: number }[]>`SELECT id, para_user_id FROM feedback_requests WHERE status='PENDENTE' AND prazo=${addDays(h, 1)}`;
    for (const x of xs) { await notificar([x.para_user_id], "Um pedido de feedback vence amanhã", null, `/feedback/novo?pedido=${x.id}`, "ACAO", `fbq-vence:${x.id}`); r.pedidosVencendo++; }
  } catch (e) { r.falhas.push(`pedidos: ${e instanceof Error ? e.message : String(e)}`); }
  try {
    const xs = await sql<{ gestor_user: number; n: number }[]>`SELECT ug.id AS gestor_user, count(*)::int AS n FROM perf_goals g JOIN employees e ON e.id=g.employee_id JOIN users ug ON ug.employee_id=e.gestor_id AND ug.ativo JOIN perf_cycles c ON c.id=g.cycle_id
      WHERE g.aprovacao='PROPOSTA' AND g.created_at < ${addDays(h, -7)}::date AND c.fase NOT IN ('CONCLUSAO','ARQUIVADO') GROUP BY ug.id`;
    for (const x of xs) { await notificar([x.gestor_user], `${x.n} meta(s) da equipe esperando a sua aprovação há mais de 7 dias`, null, "/desempenho/metas#aprovacao", "ALERTA", `metas-paradas:${x.gestor_user}:${h}`); r.metasParadas++; }
  } catch (e) { r.falhas.push(`metas: ${e instanceof Error ? e.message : String(e)}`); }
  return r;
}
