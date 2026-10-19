"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit } from "@/lib/auth";
import { audit, str, strOrNull, int, hoje, addDays, caminhoSeguro } from "@/lib/utils";
import { criarPlanoOnboarding, papelNoPlano } from "@/lib/onboarding";
import { notificar } from "@/lib/comunicacao";

const go = (b: string, k: "ok" | "erro", msg: string) => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}`;
const erro = (e: unknown) => e instanceof Error ? e.message : "Erro inesperado.";

/** Gera o plano 30-60-90 de quem foi admitido nos últimos 90 dias e ainda não tem plano. */
export async function gerarPlanos(fd: FormData) {
  const s = await requireSession(); const voltar = caminhoSeguro(str(fd, "voltar"), "/onboarding"); let n = 0;
  try {
    assert(["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role), "Gera planos: RH, Direção ou diretor(a) da unidade."); const u = scopeUnit(s);
    const ids = await sql<{ id: number }[]>`SELECT e.id FROM employees e WHERE e.situacao IN ('ATIVO','EM_ADMISSAO') AND e.admissao >= ${addDays(hoje(), -90)} ${u === null ? sql`` : sql`AND e.unit_id=${u}`} AND NOT EXISTS (SELECT 1 FROM onboarding_plans p WHERE p.employee_id=e.id)`;
    for (const r of ids) { await criarPlanoOnboarding(r.id, s); n++; }
  } catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", n ? `${n} plano(s) criado(s) a partir do modelo.` : "Todos os admitidos dos últimos 90 dias já têm plano."));
}

export async function criarPlano(fd: FormData) {
  const s = await requireSession(); const employeeId = int(fd, "employeeId") ?? 0; let id = 0;
  try { assert(["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role), "Sem permissão."); const [e] = await sql<{ unit_id: number }[]>`SELECT unit_id FROM employees WHERE id=${employeeId}`; assert(!!e, "Colaborador não encontrado."); const u = scopeUnit(s); assert(u === null || u === e.unit_id, "Fora da sua unidade."); id = await criarPlanoOnboarding(employeeId, s); }
  catch (e) { redirect(go("/onboarding", "erro", erro(e))); }
  redirect(go(`/onboarding/${id}`, "ok", "Plano de onboarding criado."));
}

export async function concluirItemOnb(fd: FormData) {
  const s = await requireSession(); const itemId = int(fd, "itemId") ?? 0; const planId = int(fd, "planId") ?? 0; const voltar = `/onboarding/${planId}`;
  try {
    const p = await papelNoPlano(s, planId); assert(!!p, "Plano não encontrado.");
    const [it] = await sql<{ responsavel: string; tipo: string; titulo: string; concluido_em: string | null }[]>`SELECT responsavel, tipo, titulo, concluido_em::text FROM onboarding_items WHERE id=${itemId} AND plan_id=${planId}`; assert(!!it, "Item não encontrado.");
    assert(p!.papeis.has("RH") || p!.papeis.has("GESTOR") || p!.papeis.has(it.responsavel), "Este item é de outro responsável.");
    assert(it.tipo !== "PESQUISA" || p!.papeis.has("NOVATO") || p!.papeis.has("RH"), "A pesquisa é respondida pelo próprio novato.");
    const desfazer = !!it.concluido_em;
    await sql`UPDATE onboarding_items SET concluido_em=CASE WHEN ${desfazer}::boolean THEN NULL ELSE now() END, concluido_por=${desfazer ? null : s.id}, nota=${desfazer ? null : strOrNull(fd, "nota")} WHERE id=${itemId}`;
    await audit(s, desfazer ? "reabrir item de onboarding" : "concluir item de onboarding", "onboarding_items", itemId, null, { titulo: it.titulo });
    const [{ abertos }] = await sql<{ abertos: number }[]>`SELECT count(*)::int AS abertos FROM onboarding_items WHERE plan_id=${planId} AND concluido_em IS NULL`;
    if (!abertos) await sql`UPDATE onboarding_plans SET status='CONCLUIDO', concluido_em=now() WHERE id=${planId}`; else await sql`UPDATE onboarding_plans SET status='EM_ANDAMENTO', concluido_em=NULL WHERE id=${planId} AND status='CONCLUIDO'`;
  } catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Plano atualizado."));
}

export async function definirBuddy(fd: FormData) {
  const s = await requireSession(); const planId = int(fd, "planId") ?? 0; const buddy = int(fd, "buddyId"); const voltar = `/onboarding/${planId}`;
  try { const p = await papelNoPlano(s, planId); assert(!!p && (p.papeis.has("RH") || p.papeis.has("GESTOR")), "Define o buddy: RH ou o gestor.");
    assert(buddy !== p!.employee_id, "O buddy é outra pessoa da equipe.");
    await sql`UPDATE onboarding_plans SET buddy_employee_id=${buddy} WHERE id=${planId}`; await audit(s, "definir buddy", "onboarding_plans", planId, null, { buddy });
    if (buddy) { const [u] = await sql<{ id: number }[]>`SELECT id FROM users WHERE employee_id=${buddy} AND ativo LIMIT 1`; if (u) await notificar([u.id], "Você é buddy de um novato", "Acompanhe os primeiros 90 dias pelo plano de onboarding.", `/onboarding/${planId}`, "ACAO"); } }
  catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Buddy definido."));
}

export async function responderPesquisaOnb(fd: FormData) {
  const s = await requireSession(); const planId = int(fd, "planId") ?? 0; const marco = int(fd, "marco") ?? 0; const voltar = `/onboarding/${planId}`;
  try {
    const p = await papelNoPlano(s, planId); assert(!!p && (p.papeis.has("NOVATO") || p.papeis.has("RH")), "A pesquisa é do próprio novato.");
    const nota = int(fd, "nota") ?? 0; assert(nota >= 1 && nota <= 5, "Escolha uma nota de 1 a 5."); assert([30, 60, 90].includes(marco), "Marco inválido.");
    await sql`INSERT INTO onboarding_surveys (plan_id, marco, nota, comentario) VALUES (${planId}, ${marco}, ${nota}, ${strOrNull(fd, "comentario")}) ON CONFLICT (plan_id, marco) DO UPDATE SET nota=EXCLUDED.nota, comentario=EXCLUDED.comentario`;
    await sql`UPDATE onboarding_items SET concluido_em=now(), concluido_por=${s.id} WHERE plan_id=${planId} AND tipo='PESQUISA' AND marco=${marco} AND concluido_em IS NULL`;
    await audit(s, "responder pesquisa do novato", "onboarding_surveys", planId, null, { marco });
  } catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Obrigado! Sua resposta ajuda a melhorar a chegada de quem vem depois."));
}
