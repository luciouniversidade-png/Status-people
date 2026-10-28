"use server";
// v30 · Academy: avaliação de reação, inscrição com aprovação do gestor e decisão da inscrição
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, can, assert, scopeUnit } from "@/lib/auth";
import { audit, str, strOrNull, int } from "@/lib/utils";
import { comMensagem } from "@/lib/redirecionar";
import { notificar } from "@/lib/comunicacao";

const go = (b: string, k: "ok" | "erro", msg: string, hash = "") => comMensagem(b, k, msg, hash);
const msgErro = (e: unknown) => (e instanceof Error ? e.message : "Erro");

/** Quem concluiu dá a nota do treinamento (uma vez) — vira “mais bem avaliados” no painel da Academy. */
export async function avaliarTreinamento(fd: FormData) {
  const s = await requireSession(); const courseId = Number(fd.get("courseId"));
  try {
    assert(!!s.employeeId, "A avaliação é de quem fez o treinamento.");
    const [p] = await sql<{ status: string }[]>`SELECT status FROM training_progress WHERE course_id=${courseId} AND employee_id=${s.employeeId}`; if (p?.status !== "CONCLUIDO") throw new Error("Avalie depois de concluir o treinamento.");
    const nota = int(fd, "nota"); if (!nota || nota < 1 || nota > 5) throw new Error("Dê uma nota de 1 a 5."); const aplicavel = int(fd, "aplicavel");
    await sql`INSERT INTO training_feedback (course_id, employee_id, nota, aplicavel, comentario) VALUES (${courseId}, ${s.employeeId}, ${nota}, ${aplicavel && aplicavel >= 1 && aplicavel <= 5 ? aplicavel : null}, ${(strOrNull(fd, "comentario") ?? "").slice(0, 1000) || null})
      ON CONFLICT (course_id, employee_id) DO UPDATE SET nota=EXCLUDED.nota, aplicavel=EXCLUDED.aplicavel, comentario=EXCLUDED.comentario, created_at=now()`;
    await audit(s, "avaliar treinamento", "training_feedback", courseId, null, { nota });
  } catch (e) { redirect(go("/academy/minha", "erro", msgErro(e), "#avaliar")); }
  redirect(go("/academy/minha", "ok", "Obrigado pela avaliação!", "#avaliar"));
}
export async function inscreverTreinamento(fd: FormData) {
  const s = await requireSession(); const courseId = Number(fd.get("courseId"));
  try {
    assert(!!s.employeeId, "A inscrição é do próprio colaborador.");
    const [c] = await sql<{ titulo: string; inscricao_aberta: boolean; exige_aprovacao: boolean; ativo: boolean }[]>`SELECT titulo, inscricao_aberta, exige_aprovacao, ativo FROM courses WHERE id=${courseId}`; if (!c?.ativo || !c.inscricao_aberta) throw new Error("Este treinamento não está com inscrição aberta.");
    const [ja] = await sql<{ status: string }[]>`SELECT status FROM training_enrollments WHERE course_id=${courseId} AND employee_id=${s.employeeId}`;
    if (ja && ["INSCRITO", "AGUARDANDO_APROVACAO"].includes(ja.status)) throw new Error("Você já está inscrito(a).");
    const [e] = await sql<{ gestor_id: number | null; unit_id: number }[]>`SELECT gestor_id, unit_id FROM employees WHERE id=${s.employeeId}`;
    const status = c.exige_aprovacao && e?.gestor_id ? "AGUARDANDO_APROVACAO" : "INSCRITO";
    await sql`INSERT INTO training_enrollments (course_id, employee_id, status, session_id) VALUES (${courseId}, ${s.employeeId}, ${status}, ${int(fd, "sessionId")}) ON CONFLICT (course_id, employee_id) DO UPDATE SET status=EXCLUDED.status, session_id=EXCLUDED.session_id, motivo=NULL, decidido_por=NULL, decidido_em=NULL, created_at=now()`;
    await audit(s, "inscrição em treinamento", "training_enrollments", courseId, null, { status });
    if (status === "AGUARDANDO_APROVACAO") { const [g] = await sql<{ id: number }[]>`SELECT id FROM users WHERE employee_id=${e!.gestor_id} AND ativo LIMIT 1`; if (g) await notificar([g.id], "Inscrição em treinamento", "1 inscrição da sua equipe aguarda aprovação.", "/academy/aprovar", "ACAO"); }
  } catch (e) { redirect(go("/academy/minha", "erro", msgErro(e), "#inscricoes")); }
  redirect(go("/academy/minha", "ok", "Inscrição registrada.", "#inscricoes"));
}
export async function desistirInscricao(fd: FormData) {
  const s = await requireSession(); const courseId = Number(fd.get("courseId"));
  try {
    assert(!!s.employeeId); const r = await sql`UPDATE training_enrollments SET status='DESISTIU', motivo=${strOrNull(fd, "motivo")} WHERE course_id=${courseId} AND employee_id=${s.employeeId} AND status IN ('INSCRITO','AGUARDANDO_APROVACAO')`; if (!r.count) throw new Error("Inscrição não encontrada.");
    await audit(s, "desistir de treinamento", "training_enrollments", courseId, null, { desistiu: true });
  } catch (e) { redirect(go("/academy/minha", "erro", msgErro(e), "#inscricoes")); }
  redirect(go("/academy/minha", "ok", "Inscrição cancelada.", "#inscricoes"));
}
/** Gestor direto (a equipe), RH/Direção (a rede) ou a direção da unidade (quem não tem gestor) decidem a inscrição. */
export async function decidirInscricao(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const decisao = str(fd, "decisao");
  try {
    if (!["INSCRITO", "RECUSADA"].includes(decisao)) throw new Error("Decisão inválida.");
    const [t] = await sql<{ employee_id: number; gestor_id: number | null; unit_id: number; status: string; titulo: string }[]>`SELECT t.employee_id, e.gestor_id, e.unit_id, t.status, c.titulo FROM training_enrollments t JOIN employees e ON e.id=t.employee_id JOIN courses c ON c.id=t.course_id WHERE t.id=${id}`;
    if (!t) throw new Error("Inscrição não encontrada."); if (t.status !== "AGUARDANDO_APROVACAO") throw new Error("Inscrição já decidida.");
    const pode = can.editar(s) || (!!s.employeeId && t.gestor_id === s.employeeId) || (s.role === "DIRETOR_UNIDADE" && scopeUnit(s) === t.unit_id && !t.gestor_id); assert(pode, "Quem aprova é o gestor direto (ou o RH).");
    const motivo = strOrNull(fd, "motivo"); if (decisao === "RECUSADA" && (!motivo || motivo.length < 5)) throw new Error("Diga o motivo da recusa.");
    await sql`UPDATE training_enrollments SET status=${decisao}, motivo=${motivo}, decidido_por=${s.id}, decidido_em=now() WHERE id=${id}`;
    await audit(s, decisao === "INSCRITO" ? "aprovar inscrição" : "recusar inscrição", "training_enrollments", id, null, { decisao, motivo });
    const [u] = await sql<{ id: number }[]>`SELECT id FROM users WHERE employee_id=${t.employee_id} AND ativo LIMIT 1`; if (u) await notificar([u.id], decisao === "INSCRITO" ? "Inscrição aprovada" : "Inscrição não aprovada", decisao === "INSCRITO" ? "Sua inscrição em um treinamento foi aprovada." : `Motivo: ${motivo}`, "/academy/minha#inscricoes", "INFO");
  } catch (e) { redirect(go("/academy/aprovar", "erro", msgErro(e), "#inscricoes")); }
  redirect(go("/academy/aprovar", "ok", decisao === "INSCRITO" ? "Inscrição aprovada." : "Inscrição recusada.", "#inscricoes"));
}
