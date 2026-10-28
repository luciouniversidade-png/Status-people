"use server";
// v30 · recrutamento: avaliadores com notas independentes, vaga pausada, página pública e a satisfação do gestor aos 90 dias
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, can, assert, assertScope } from "@/lib/auth";
import { audit, str, strOrNull, int, hoje, addDays, getSettings } from "@/lib/utils";
import { comMensagem } from "@/lib/redirecionar";
import { notificar } from "@/lib/comunicacao";
import { RECOMENDACAO } from "@/lib/recrutamento-v30";

const go = (b: string, k: "ok" | "erro", msg: string, hash = "") => comMensagem(b, k, msg, hash);
const msgErro = (e: unknown) => (e instanceof Error ? e.message : "Erro");
const GESTAO = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"];
type Req = { id: number; titulo: string; unit_id: number; status: string; prazo: string | null; pausada_em: string | null; dias_pausada: number; responsavel_user_id: number | null; solicitante_user_id: number | null; slug: string | null };
async function vaga(id: number): Promise<Req> { const [r] = await sql<Req[]>`SELECT id, titulo, unit_id, status, prazo::text, pausada_em::text, dias_pausada, responsavel_user_id, solicitante_user_id, slug FROM requisitions WHERE id=${id}`; if (!r) throw new Error("Vaga não encontrada."); return r; }
const evento = (applicationId: number, nome: string, texto: string) => sql`INSERT INTO application_events (application_id, user_nome, texto) VALUES (${applicationId}, ${nome}, ${texto})`;

// ------------------------------------------------------------------ avaliadores
export async function convidarAvaliadores(fd: FormData) {
  const s = await requireSession(); const applicationId = Number(fd.get("applicationId")); let rid = 0;
  try {
    assert(GESTAO.includes(s.role), "Seu acesso não convida avaliadores.");
    const [a] = await sql<{ requisition_id: number; etapa: string; nome: string }[]>`SELECT a.requisition_id, a.etapa, c.nome FROM applications a JOIN candidates c ON c.id=a.candidate_id WHERE a.id=${applicationId}`; if (!a) throw new Error("Candidatura não encontrada."); rid = a.requisition_id;
    const r = await vaga(rid); assertScope(s, r.unit_id); if (r.status !== "ABERTA") throw new Error("A vaga não está aberta.");
    if (["REPROVADO", "DESISTIU", "CONTRATADO"].includes(a.etapa)) throw new Error("Candidatura encerrada.");
    const ids = [...new Set(fd.getAll("avaliadores").map(Number).filter(Boolean))]; if (!ids.length) throw new Error("Escolha pelo menos um avaliador.");
    const cfg = await getSettings(); const etapa = str(fd, "etapa") || a.etapa; const prazo = str(fd, "prazo") || addDays(hoje(), Number(cfg.recrutamento.avaliacaoPrazoDias) || 3);
    const validos = await sql<{ id: number }[]>`SELECT id FROM users WHERE id IN ${sql(ids)} AND ativo`; if (validos.length !== ids.length) throw new Error("Avaliador sem acesso ativo.");
    for (const u of validos) {
      const [f] = await sql<{ id: number; novo: boolean }[]>`INSERT INTO interview_feedback (application_id, etapa, avaliador_user_id, convidado_por, prazo) VALUES (${applicationId}, ${etapa}, ${u.id}, ${s.id}, ${prazo})
        ON CONFLICT (application_id, etapa, avaliador_user_id) DO UPDATE SET cancelado_em=NULL, prazo=EXCLUDED.prazo RETURNING id, (xmax = 0) AS novo`;
      await notificar([u.id], "Avaliação de candidato", "1 candidato aguarda as suas notas (independentes: você vê as dos outros depois de enviar).", `/recrutamento/avaliar/${f.id}`, "ACAO", `aval:${f.id}`);
    }
    await evento(applicationId, s.nome, `Avaliadores convidados para ${etapa.toLowerCase().replace(/_/g, " ")}: ${validos.length}`);
    await audit(s, "convidar avaliadores", "applications", applicationId, null, { etapa, avaliadores: ids, prazo });
  } catch (e) { redirect(go(`/recrutamento/vagas/${rid || ""}`, "erro", msgErro(e), "#avaliadores")); }
  redirect(go(`/recrutamento/vagas/${rid}`, "ok", "Avaliadores convidados — cada um envia as notas sem ver as dos outros.", "#avaliadores"));
}
export async function cancelarConvite(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); let rid = 0;
  try {
    assert(GESTAO.includes(s.role)); const [f] = await sql<{ requisition_id: number; enviado_em: string | null; application_id: number }[]>`SELECT a.requisition_id, f.enviado_em::text, f.application_id FROM interview_feedback f JOIN applications a ON a.id=f.application_id WHERE f.id=${id}`;
    if (!f) throw new Error("Convite não encontrado."); rid = f.requisition_id; const r = await vaga(rid); assertScope(s, r.unit_id); if (f.enviado_em) throw new Error("Avaliação já enviada — fica no histórico.");
    await sql`UPDATE interview_feedback SET cancelado_em=now() WHERE id=${id}`; await audit(s, "cancelar convite de avaliação", "interview_feedback", id, null, { cancelado: true });
  } catch (e) { redirect(go(`/recrutamento/vagas/${rid || ""}`, "erro", msgErro(e), "#avaliadores")); }
  redirect(go(`/recrutamento/vagas/${rid}`, "ok", "Convite cancelado.", "#avaliadores"));
}
/** O próprio avaliador envia as notas (uma vez). Só depois de enviar ele vê as dos outros. */
export async function enviarAvaliacao(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const b = `/recrutamento/avaliar/${id}`;
  try {
    const [f] = await sql<{ avaliador_user_id: number; enviado_em: string | null; cancelado_em: string | null; application_id: number; etapa: string; requisition_id: number; responsavel_user_id: number | null; status: string }[]>`SELECT f.avaliador_user_id, f.enviado_em::text, f.cancelado_em::text, f.application_id, f.etapa, a.requisition_id, r.responsavel_user_id, r.status FROM interview_feedback f JOIN applications a ON a.id=f.application_id JOIN requisitions r ON r.id=a.requisition_id WHERE f.id=${id}`;
    if (!f || f.avaliador_user_id !== s.id) throw new Error("Este convite de avaliação não é seu."); if (f.cancelado_em) throw new Error("O convite foi cancelado."); if (f.enviado_em) throw new Error("Você já enviou as suas notas.");
    const cfg = await getSettings(); const notas: Record<string, number> = {};
    cfg.recrutamento.criterios.forEach((c, i) => { const v = int(fd, `sc_${i}`); if (v && v >= 1 && v <= 5) notas[c] = v; });
    const rec = str(fd, "recomendacao"); if (!RECOMENDACAO[rec]) throw new Error("Escolha a sua recomendação."); if (!Object.keys(notas).length) throw new Error("Dê nota em pelo menos um critério (deixe em branco o que você não observou).");
    const fortes = strOrNull(fd, "pontosFortes"), atencao = strOrNull(fd, "pontosAtencao"); if (!fortes && !atencao) throw new Error("Escreva pelo menos um ponto forte ou de atenção (evidência do que você observou).");
    await sql`UPDATE interview_feedback SET notas=${JSON.stringify(notas)}::jsonb, recomendacao=${rec}, pontos_fortes=${fortes}, pontos_atencao=${atencao}, enviado_em=now() WHERE id=${id}`;
    await evento(f.application_id, s.nome, `Avaliação enviada (${f.etapa.toLowerCase().replace(/_/g, " ")})`);
    await audit(s, "enviar avaliação de candidato", "interview_feedback", id, null, { recomendacao: rec, criterios: Object.keys(notas).length });
    const [{ faltam }] = await sql<{ faltam: number }[]>`SELECT count(*)::int AS faltam FROM interview_feedback WHERE application_id=${f.application_id} AND etapa=${f.etapa} AND enviado_em IS NULL AND cancelado_em IS NULL`;
    if (!faltam && f.responsavel_user_id) await notificar([f.responsavel_user_id], "Avaliações completas", "1 candidato com todas as notas dos avaliadores — pronto para a decisão.", `/recrutamento/vagas/${f.requisition_id}#avaliadores`, "ACAO", `aval-ok:${f.application_id}:${f.etapa}`);
  } catch (e) { redirect(go(b, "erro", msgErro(e))); }
  redirect(go(b, "ok", "Notas enviadas. Agora você vê o consolidado dos avaliadores."));
}

// ------------------------------------------------------------------ vaga pausada
export async function pausarVaga(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const b = `/recrutamento/vagas/${id}`;
  try {
    const r = await vaga(id); assert(can.aprovar(s, "vagas") || can.editar(s) || r.responsavel_user_id === s.id, "Pausar a vaga exige a aprovação de vagas (ou ser o responsável)."); assertScope(s, r.unit_id);
    if (r.status !== "ABERTA") throw new Error("Só uma vaga aberta pode ser pausada."); const motivo = str(fd, "motivo"); if (motivo.length < 5) throw new Error("Diga por que a vaga para (ex.: congelamento do orçamento, revisão do perfil).");
    await sql`UPDATE requisitions SET status='PAUSADA', pausada_em=${hoje()}, pausa_motivo=${motivo} WHERE id=${id}`;
    await audit(s, "pausar vaga", "requisitions", id, { status: "ABERTA" }, { status: "PAUSADA", motivo });
  } catch (e) { redirect(go(b, "erro", msgErro(e))); }
  redirect(go(b, "ok", "Vaga pausada: o prazo não corre e ela sai da página de vagas até ser retomada."));
}
export async function retomarVaga(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const b = `/recrutamento/vagas/${id}`;
  try {
    const r = await vaga(id); assert(can.aprovar(s, "vagas") || can.editar(s) || r.responsavel_user_id === s.id, "Retomar a vaga exige a aprovação de vagas (ou ser o responsável)."); assertScope(s, r.unit_id);
    if (r.status !== "PAUSADA") throw new Error("A vaga não está pausada."); const dias = r.pausada_em ? Math.max(0, Math.round((Date.parse(hoje()) - Date.parse(r.pausada_em)) / 86400000)) : 0;
    await sql`UPDATE requisitions SET status='ABERTA', pausada_em=NULL, dias_pausada=dias_pausada + ${dias}, prazo=CASE WHEN prazo IS NULL THEN NULL ELSE prazo + ${dias}::int END WHERE id=${id}`;
    await audit(s, "retomar vaga", "requisitions", id, { status: "PAUSADA" }, { status: "ABERTA", diasPausada: dias });
  } catch (e) { redirect(go(b, "erro", msgErro(e))); }
  redirect(go(b, "ok", "Vaga retomada — o prazo foi estendido pelos dias em pausa."));
}

// ------------------------------------------------------------------ página pública de vagas
const slugify = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
export async function salvarPublicacao(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const b = `/recrutamento/vagas/${id}`;
  try {
    assert(GESTAO.includes(s.role), "Seu acesso não publica vagas."); const r = await vaga(id); assertScope(s, r.unit_id);
    const publicar = str(fd, "publicar") === "1"; const desc = strOrNull(fd, "descricaoPublica");
    if (publicar && (!desc || desc.length < 40)) throw new Error("Escreva a descrição pública (o que a pessoa vai fazer, requisitos e jornada — sem dados internos).");
    const [u] = await sql<{ nome: string }[]>`SELECT nome FROM units WHERE id=${r.unit_id}`; const base = u?.nome && !slugify(r.titulo).includes(slugify(u.nome)) ? `${r.titulo} ${u.nome}` : r.titulo; const slug = r.slug ?? `${slugify(base)}-${id}`; // o título já costuma trazer a unidade: não repete
    await sql`UPDATE requisitions SET publicar=${publicar}, descricao_publica=${desc}, slug=${slug} WHERE id=${id}`;
    await audit(s, publicar ? "publicar vaga" : "tirar vaga da página", "requisitions", id, null, { publicar });
  } catch (e) { redirect(go(b, "erro", msgErro(e), "#publicacao")); }
  const cfg = await getSettings(); const ativa = !!(cfg.recrutamento.paginaPublica as { ativa?: boolean })?.ativa;
  redirect(go(b, "ok", ativa ? "Publicação salva." : "Publicação salva — a página de vagas ainda está desligada (Configurações → Recrutamento; ligar só depois do GO).", "#publicacao"));
}

// ------------------------------------------------------------------ satisfação do gestor com a contratação
export async function avaliarContratacao(fd: FormData) {
  const s = await requireSession(); const applicationId = Number(fd.get("applicationId")); const b = `/recrutamento/contratacao/${applicationId}`;
  try {
    const [a] = await sql<{ employee_id: number | null; requisition_id: number; gestor_id: number | null; solicitante: number | null; unit_id: number }[]>`SELECT a.employee_id, a.requisition_id, e.gestor_id, r.solicitante_user_id AS solicitante, e.unit_id FROM applications a JOIN requisitions r ON r.id=a.requisition_id LEFT JOIN employees e ON e.id=a.employee_id WHERE a.id=${applicationId} AND a.etapa='CONTRATADO'`;
    if (!a?.employee_id) throw new Error("Contratação não encontrada.");
    const pode = (!!s.employeeId && a.gestor_id === s.employeeId) || (a.gestor_id === null && a.solicitante === s.id) || can.editar(s); assert(pode, "Quem avalia é o gestor direto da pessoa contratada.");
    const nota = int(fd, "nota"); if (!nota || nota < 1 || nota > 5) throw new Error("Escolha a nota de 1 a 5."); const contrataria = str(fd, "contrataria"); if (!["1", "0"].includes(contrataria)) throw new Error("Diga se contrataria de novo.");
    await sql`INSERT INTO hire_feedback (employee_id, application_id, requisition_id, gestor_user_id, nota, contrataria, comentario, respondido_em) VALUES (${a.employee_id}, ${applicationId}, ${a.requisition_id}, ${s.id}, ${nota}, ${contrataria === "1"}, ${strOrNull(fd, "comentario")}, now())
      ON CONFLICT (employee_id) DO UPDATE SET nota=EXCLUDED.nota, contrataria=EXCLUDED.contrataria, comentario=EXCLUDED.comentario, gestor_user_id=EXCLUDED.gestor_user_id, respondido_em=now()`;
    await audit(s, "avaliar contratação", "hire_feedback", a.employee_id, null, { nota, contrataria: contrataria === "1" });
  } catch (e) { redirect(go(b, "erro", msgErro(e))); }
  redirect(go(b, "ok", "Obrigado! A sua avaliação entra no índice de qualidade da contratação."));
}
