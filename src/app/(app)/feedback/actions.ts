"use server";
// v31 · feedback contínuo: mandar (rascunho ou envio), pedir, responder pedido, recusar, dar ciência e agradecer.
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit, type Session } from "@/lib/auth";
import { audit, str, strOrNull, int, getSettings, hoje, addDays, caminhoSeguro } from "@/lib/utils";
import { notificar } from "@/lib/comunicacao";
import { comMensagem } from "@/lib/redirecionar";
import { colegasConversa, FORMATO_FB } from "@/lib/conversas";
import { valoresDaEscola, MURAL_MIN, MURAL_MAX } from "@/lib/reconhecimento";

const go = (b: string, k: "ok" | "erro", m: string) => comMensagem(b, k, m);
const erro = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado.");

/** Quem é “gestão” desta pessoa para o feedback ir ao painel: o gestor direto, RH/Direção ou a direção da unidade dela. */
async function souGestaoDe(s: Session, employeeId: number) {
  const [e] = await sql<{ gestor_id: number | null; unit_id: number }[]>`SELECT gestor_id, unit_id FROM employees WHERE id=${employeeId}`; if (!e) return false;
  if (["RH", "DIRECAO"].includes(s.role)) return true; if (s.role === "DIRETOR_UNIDADE" && scopeUnit(s) === e.unit_id) return true;
  return !!s.employeeId && e.gestor_id === s.employeeId;
}

export async function salvarFeedback(fd: FormData) {
  const s = await requireSession(); const enviar = str(fd, "acao") !== "rascunho"; const id = int(fd, "id"); const pedidoId = int(fd, "pedidoId");
  const volta = caminhoSeguro(str(fd, "voltar"), "/feedback/novo"); let fid = id ?? 0; let destino = "";
  try {
    assert(s.role !== "LEITURA", "O acesso de consulta não manda feedback.");
    const cfg = await getSettings(); const formato = FORMATO_FB[str(fd, "formato")] ? str(fd, "formato") : "LIVRE";
    let para = int(fd, "employeeId") ?? 0;
    const pedido = pedidoId ? (await sql<{ id: number; para_user_id: number; solicitante_employee_id: number | null; solicitante_user_id: number; status: string; assunto: string }[]>`SELECT id, para_user_id, solicitante_employee_id, solicitante_user_id, status, assunto FROM feedback_requests WHERE id=${pedidoId}`)[0] : null;
    if (pedidoId) { assert(!!pedido && pedido.para_user_id === s.id, "Pedido de feedback não encontrado."); assert(pedido!.status === "PENDENTE", "Este pedido já foi respondido, recusado ou cancelado."); assert(!!pedido!.solicitante_employee_id, "Quem pediu não tem ficha vinculada."); para = pedido!.solicitante_employee_id!; }
    assert(para > 0, "Escolha para quem é o feedback."); assert(para !== s.employeeId, "Feedback é para um colega — para você mesmo, use a autoavaliação.");
    const colega = (await colegasConversa(s)).find(c => c.id === para);
    assert(!!colega || !!pedido, "Escolha a pessoa na lista de colegas.");
    const [dest] = await sql<{ nome: string; user_id: number | null; gestor_user: number | null }[]>`SELECT e.nome, (SELECT us.id FROM users us WHERE us.employee_id=e.id AND us.ativo ORDER BY us.id LIMIT 1) AS user_id, (SELECT ug.id FROM users ug WHERE ug.employee_id=e.gestor_id AND ug.ativo ORDER BY ug.id LIMIT 1) AS gestor_user FROM employees e WHERE e.id=${para}`;
    const gestao = await souGestaoDe(s, para);
    const vis = str(fd, "visibilidade"); const visibilidade = gestao ? (vis === "PRIVADO" ? "PRIVADO" : "GESTAO") : (vis === "GESTOR" ? "GESTOR" : "PRIVADO");
    const assunto = strOrNull(fd, "assunto")?.slice(0, 120) ?? (pedido ? pedido.assunto : null);
    const texto = formato === "SCI" ? null : strOrNull(fd, "texto")?.slice(0, 4000) ?? null;
    const situacao = formato === "SCI" ? strOrNull(fd, "situacao")?.slice(0, 1500) ?? null : null, comportamento = formato === "SCI" ? strOrNull(fd, "comportamento")?.slice(0, 1500) ?? null : null, impacto = formato === "SCI" ? strOrNull(fd, "impacto")?.slice(0, 1500) ?? null : null;
    const valoresOk = await valoresDaEscola(); const valores = [...new Set(fd.getAll("valores").map(String))].filter(v => valoresOk.includes(v));
    const courseId = int(fd, "courseId"); if (courseId) { const [c] = await sql`SELECT 1 FROM courses WHERE id=${courseId}`; assert(!!c, "Conteúdo da Academy não encontrado."); }
    if (enviar) {
      if (formato === "SCI") { assert((situacao ?? "").length >= 10 && (comportamento ?? "").length >= 10, "Descreva a situação e o comportamento (pelo menos 10 caracteres cada)."); }
      else assert((texto ?? "").length >= 20, "Escreva o feedback (pelo menos 20 caracteres) — com o contexto e as consequências.");
      assert(!!dest?.user_id || visibilidade === "GESTAO", `${dest?.nome ?? "A pessoa"} ainda não tem acesso ao ONE — converse pessoalmente${gestao ? " ou registre no painel (gestão)" : " ou peça ao gestor dela"}.`);
      const [n] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM feedbacks WHERE autor_user_id=${s.id} AND status='ENVIADO' AND enviado_em >= now() - interval '1 day'`; assert(n.n < Number(cfg.conversas.feedbackLimiteDia || 20), "Limite diário de feedbacks atingido — continue amanhã.");
    } else assert(!!(texto || situacao || comportamento || assunto), "Escreva algo antes de salvar o rascunho.");
    const tipo = formato === "ELOGIO" ? "RECONHECIMENTO" : "DESENVOLVIMENTO"; const status = enviar ? "ENVIADO" : "RASCUNHO";
    if (id) {
      const [f] = await sql<{ autor_user_id: number | null; status: string }[]>`SELECT autor_user_id, status FROM feedbacks WHERE id=${id}`; assert(!!f && f.autor_user_id === s.id && f.status === "RASCUNHO", "Rascunho não encontrado.");
      await sql`UPDATE feedbacks SET employee_id=${para}, tipo=${tipo}, data=${hoje()}, situacao=${situacao}, comportamento=${comportamento}, impacto=${impacto}, formato=${formato}, assunto=${assunto}, texto=${texto}, valores=${JSON.stringify(valores)}::jsonb, course_id=${courseId}, status=${status}, visibilidade=${visibilidade}, request_id=${pedidoId}, enviado_em=${enviar ? sql`now()` : sql`NULL`} WHERE id=${id}`;
    } else {
      const [r] = await sql<{ id: number }[]>`INSERT INTO feedbacks (employee_id, tipo, data, situacao, comportamento, impacto, autor_user_id, autor_nome, formato, assunto, texto, valores, course_id, status, visibilidade, autor_employee_id, request_id, enviado_em)
        VALUES (${para}, ${tipo}, ${hoje()}, ${situacao}, ${comportamento}, ${impacto}, ${s.id}, ${s.nome}, ${formato}, ${assunto}, ${texto}, ${JSON.stringify(valores)}::jsonb, ${courseId}, ${status}, ${visibilidade}, ${s.employeeId ?? null}, ${pedidoId}, ${enviar ? sql`now()` : sql`NULL`}) RETURNING id`;
      fid = r.id;
    }
    await audit(s, enviar ? "enviar feedback" : "rascunho de feedback", "feedbacks", fid, null, { para, formato, visibilidade, valores: valores.length, academy: !!courseId, pedido: pedidoId });
    if (enviar) {
      if (dest?.user_id) await notificar([dest.user_id], "Você recebeu um feedback", null, "/feedback?aba=recebidos", "INFO", `fb:${fid}`);
      if (visibilidade === "GESTOR" && dest?.gestor_user && dest.gestor_user !== s.id) await notificar([dest.gestor_user], "Um feedback sobre alguém da sua equipe foi compartilhado com você", null, `/colaboradores/${para}/painel?aba=feedbacks`, "INFO", `fbg:${fid}`);
      if (pedido) { await sql`UPDATE feedback_requests SET status='RESPONDIDO', feedback_id=${fid}, respondido_em=now() WHERE id=${pedido.id}`; await notificar([pedido.solicitante_user_id], "Responderam ao seu pedido de feedback", null, "/feedback?aba=recebidos", "INFO", `fbp:${pedido.id}`); }
      // elogio também no mural (público), se a pessoa quiser — o mural tem as próprias regras de tamanho
      if (formato === "ELOGIO" && str(fd, "mural") === "1" && texto) {
        assert(texto.length >= MURAL_MIN, `Para o mural, conte o que a pessoa fez (pelo menos ${MURAL_MIN} caracteres).`);
        const [e] = await sql<{ unit_id: number }[]>`SELECT unit_id FROM employees WHERE id=${para}`;
        const [rc] = await sql<{ id: number }[]>`INSERT INTO recognitions (de_user_id, de_nome, para_employee_id, valor, mensagem, unit_id) VALUES (${s.id}, ${s.nome}, ${para}, ${valores[0] ?? null}, ${texto.slice(0, MURAL_MAX)}, ${e.unit_id}) RETURNING id`;
        await sql`UPDATE feedbacks SET recognition_id=${rc.id} WHERE id=${fid}`; await audit(s, "reconhecimento publicado", "recognitions", rc.id, null, { para, origem: "feedback" });
      }
      destino = `/feedback?enviado=${fid}`;
    } else destino = go("/feedback?aba=rascunhos", "ok", "Rascunho salvo — só você vê.");
  } catch (e) { redirect(go(volta, "erro", erro(e))); }
  redirect(destino);
}

export async function excluirRascunho(fd: FormData) {
  const s = await requireSession(); const id = Number(str(fd, "id"));
  try { const r = await sql`DELETE FROM feedbacks WHERE id=${id} AND autor_user_id=${s.id} AND status='RASCUNHO'`; assert(r.count === 1, "Rascunho não encontrado."); await audit(s, "excluir rascunho de feedback", "feedbacks", id, null, null); }
  catch (e) { redirect(go("/feedback?aba=rascunhos", "erro", erro(e))); }
  redirect(go("/feedback?aba=rascunhos", "ok", "Rascunho excluído."));
}

/** Quem recebeu: ciência (com comentário opcional) e/ou agradecer. */
export async function responderRecebido(fd: FormData) {
  const s = await requireSession(); const id = Number(str(fd, "id")); const volta = "/feedback?aba=recebidos";
  try {
    const [f] = await sql<{ employee_id: number; status: string; autor_user_id: number | null; ciencia_em: Date | null; agradecido_em: Date | null }[]>`SELECT employee_id, status, autor_user_id, ciencia_em, agradecido_em FROM feedbacks WHERE id=${id}`;
    assert(!!f && f.employee_id === s.employeeId && f.status === "ENVIADO", "Feedback não encontrado.");
    const agradecer = str(fd, "agradecer") === "1" && !f.agradecido_em; const comentario = strOrNull(fd, "comentario")?.slice(0, 600) ?? null;
    await sql`UPDATE feedbacks SET ciencia_em=coalesce(ciencia_em, now()), comentario_colaborador=coalesce(${comentario}, comentario_colaborador), agradecido_em=${agradecer ? sql`coalesce(agradecido_em, now())` : sql`agradecido_em`} WHERE id=${id}`;
    await audit(s, agradecer ? "agradecer feedback" : "ciência de feedback", "feedbacks", id, null, { comentario: !!comentario });
    if ((agradecer || comentario) && f.autor_user_id && f.autor_user_id !== s.id) await notificar([f.autor_user_id], agradecer ? "Agradeceram o seu feedback" : "Comentaram o feedback que você enviou", null, "/feedback?aba=enviados", "INFO", `fbr:${id}:${agradecer ? "ag" : "cm"}`);
  } catch (e) { redirect(go(volta, "erro", erro(e))); }
  redirect(go(volta, "ok", "Registrado. Obrigado por responder ao feedback."));
}

export async function pedirFeedback(fd: FormData) {
  const s = await requireSession(); const volta = "/feedback?aba=pedidos"; let n = 0;
  try {
    assert(s.role !== "LEITURA", "O acesso de consulta não pede feedback."); assert(!!s.employeeId, "Pedir feedback exige o acesso vinculado à sua ficha (fale com o RH).");
    const cfg = await getSettings(); const ids = [...new Set(fd.getAll("para").map(Number))].filter(x => x > 0); assert(ids.length > 0, "Escolha a quem pedir.");
    assert(ids.length <= Number(cfg.conversas.pedidoMaxPessoas || 5), `Peça a até ${cfg.conversas.pedidoMaxPessoas} pessoas de cada vez.`);
    const assunto = str(fd, "assunto").slice(0, 120); assert(assunto.length >= 5, "Diga sobre o que você quer feedback (ex.: a condução da reunião de pais).");
    const prazo = str(fd, "prazo") || addDays(hoje(), Number(cfg.conversas.pedidoPrazoDias) || 7); assert(prazo >= hoje(), "O prazo não pode estar no passado.");
    const colegas = await colegasConversa(s);
    for (const id of ids) {
      const c = colegas.find(x => x.id === id); assert(!!c, "Escolha as pessoas na lista."); assert(!!c!.user_id, `${c!.nome} não tem acesso ao ONE — peça pessoalmente.`);
      const [dup] = await sql`SELECT 1 FROM feedback_requests WHERE solicitante_user_id=${s.id} AND para_user_id=${c!.user_id} AND status='PENDENTE' AND assunto=${assunto}`; if (dup) continue;
      const [r] = await sql<{ id: number }[]>`INSERT INTO feedback_requests (solicitante_user_id, solicitante_employee_id, solicitante_nome, para_user_id, para_employee_id, assunto, mensagem, prazo) VALUES (${s.id}, ${s.employeeId}, ${s.nome}, ${c!.user_id}, ${c!.id}, ${assunto}, ${strOrNull(fd, "mensagem")?.slice(0, 600) ?? null}, ${prazo}) RETURNING id`;
      await notificar([c!.user_id!], "Pediram um feedback seu", null, `/feedback/novo?pedido=${r.id}`, "ACAO", `fbq:${r.id}`); n++;
    }
    await audit(s, "pedir feedback", "feedback_requests", null, null, { pessoas: n, assunto });
  } catch (e) { redirect(go(volta, "erro", erro(e))); }
  redirect(go(volta, "ok", n ? `Pedido enviado a ${n} pessoa(s).` : "Esses pedidos já estavam abertos."));
}

export async function recusarPedido(fd: FormData) {
  const s = await requireSession(); const id = Number(str(fd, "id")); const volta = "/feedback?aba=pedidos";
  try {
    const [p] = await sql<{ para_user_id: number; solicitante_user_id: number; status: string }[]>`SELECT para_user_id, solicitante_user_id, status FROM feedback_requests WHERE id=${id}`;
    assert(!!p && p.para_user_id === s.id && p.status === "PENDENTE", "Pedido não encontrado.");
    await sql`UPDATE feedback_requests SET status='RECUSADO', motivo_recusa=${strOrNull(fd, "motivo")?.slice(0, 300) ?? null}, respondido_em=now() WHERE id=${id}`;
    await audit(s, "recusar pedido de feedback", "feedback_requests", id, null, null); await notificar([p.solicitante_user_id], "Um pedido de feedback seu não pôde ser atendido", null, "/feedback?aba=pedidos", "INFO", `fbx:${id}`);
  } catch (e) { redirect(go(volta, "erro", erro(e))); }
  redirect(go(volta, "ok", "Pedido recusado — a pessoa foi avisada."));
}
export async function cancelarPedido(fd: FormData) {
  const s = await requireSession(); const id = Number(str(fd, "id")); const volta = "/feedback?aba=pedidos";
  try { const r = await sql`UPDATE feedback_requests SET status='CANCELADO' WHERE id=${id} AND solicitante_user_id=${s.id} AND status='PENDENTE'`; assert(r.count === 1, "Pedido não encontrado."); await audit(s, "cancelar pedido de feedback", "feedback_requests", id, null, null); }
  catch (e) { redirect(go(volta, "erro", erro(e))); }
  redirect(go(volta, "ok", "Pedido cancelado."));
}
