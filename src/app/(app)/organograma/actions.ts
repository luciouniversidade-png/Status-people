"use server";
// v34 · mover liderados em lote (reestruturação): troca o gestor direto de várias pessoas de uma vez, com a movimentação no histórico.
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, can } from "@/lib/auth";
import { audit, str, int, hoje, caminhoSeguro } from "@/lib/utils";
import { comMensagem } from "@/lib/redirecionar";
import { registrarMovimentacao, estadoDe } from "@/lib/pessoas-v30";
import { notificar } from "@/lib/comunicacao";
import { usuariosDasFichas } from "@/lib/assinaturas";

export async function moverLiderados(fd: FormData) {
  const s = await requireSession(); const atual = int(fd, "gestorAtual") ?? 0; const volta = caminhoSeguro(str(fd, "voltar"), `/organograma?p=${atual}#pessoa`); let msg = "";
  try {
    assert(can.editar(s), "Só RH e Direção mudam o gestor direto.");
    const novo = int(fd, "novoGestor") ?? 0; assert(novo > 0, "Escolha o novo gestor."); assert(novo !== atual, "O novo gestor é o mesmo de hoje.");
    const ids = [...new Set(fd.getAll("liderados").map(Number).filter(n => n > 0))]; assert(ids.length > 0, "Marque quem muda de gestor."); assert(!ids.includes(novo), "O novo gestor não pode estar entre os que mudam.");
    const data = str(fd, "data") || hoje(); assert(/^\d{4}-\d{2}-\d{2}$/.test(data), "Data inválida."); const motivo = str(fd, "motivo").slice(0, 200) || "Mudança de gestor em lote";
    const [g] = await sql<{ id: number; situacao: string }[]>`SELECT id, situacao FROM employees WHERE id=${novo}`; assert(!!g && g!.situacao !== "DESLIGADO", "Novo gestor inválido.");
    // ciclo: o novo gestor não pode estar abaixo de nenhum dos liderados (nem ser um deles)
    const abaixo = await sql<{ id: number }[]>`WITH RECURSIVE sub AS (SELECT id FROM employees WHERE gestor_id = ANY(${ids}) UNION SELECT e.id FROM employees e JOIN sub ON e.gestor_id=sub.id) SELECT id FROM sub WHERE id=${novo}`;
    assert(abaixo.length === 0, "O novo gestor está abaixo de alguém que você quer mover (o organograma ficaria em círculo).");
    const pessoas = await sql<{ id: number; unit_id: number; position_id: number | null; nivel: string | null; gestor_id: number | null; vinculo: string; jornada_min_dia: number | null; turno: string | null; regime: string; company_id: number | null }[]>`SELECT id, unit_id, position_id, nivel, gestor_id, vinculo, jornada_min_dia, turno, regime, company_id FROM employees WHERE id = ANY(${ids}) AND gestor_id=${atual} AND situacao <> 'DESLIGADO'`;
    assert(pessoas.length > 0, "Ninguém da lista responde hoje a este gestor.");
    for (const p of pessoas) {
      const de = estadoDe({ unitId: p.unit_id, positionId: p.position_id, nivel: p.nivel, gestorId: p.gestor_id, vinculo: p.vinculo, jornadaMinDia: p.jornada_min_dia, turno: p.turno, regime: p.regime, companyId: p.company_id });
      await sql`UPDATE employees SET gestor_id=${novo}, updated_at=now() WHERE id=${p.id}`;
      await registrarMovimentacao(s, p.id, de, { ...de, gestorId: novo }, { data, motivo, origem: "LOTE" });
    }
    const avisar = await usuariosDasFichas([atual, novo]);
    await notificar(avisar, "Mudança na equipe", `${pessoas.length} pessoa(s) mudaram de gestor direto. Veja no organograma.`, `/organograma?p=${novo}#pessoa`, "INFO");
    await notificar(await usuariosDasFichas(pessoas.map(p => p.id)), "Seu gestor direto mudou", "Veja no organograma a quem você responde agora.", "/organograma", "INFO");
    await audit(s, "mover liderados em lote", "employees", novo, { gestor: atual }, { gestor: novo, pessoas: pessoas.length, data });
    msg = `${pessoas.length} pessoa(s) passaram a responder ao novo gestor; movimentação registrada no histórico de cada uma.`;
  } catch (e) { redirect(comMensagem(volta, "erro", e instanceof Error ? e.message : "Erro inesperado.")); }
  redirect(comMensagem(`/organograma?p=${int(fd, "novoGestor") ?? atual}#pessoa`, "ok", msg));
}
