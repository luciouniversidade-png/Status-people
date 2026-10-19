"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit } from "@/lib/auth";
import { audit, str, strOrNull, int, getSettings } from "@/lib/utils";
import { notificar } from "@/lib/comunicacao";
import { destinatariosCampanha, aprovadoresMassa, emHorarioComercial, proximaJanela, fmtJanela, dispararCampanha, PUBLICO_CAMPANHA, AUTORES_MASSA_LISTA } from "@/lib/massa";

const go = (b: string, k: "ok" | "erro", msg: string) => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}`;

/** CRQ-COM-V3-01 · campanha (WhatsApp/e-mail) para uma lista: modelo aprovado obrigatório; vai para aprovação de outra pessoa. */
export async function criarCampanha(fd: FormData) {
  const s = await requireSession(); let b = "/comunicacao/massa";
  try {
    assert(AUTORES_MASSA_LISTA.includes(s.role), "Seu perfil não cria envio em massa.");
    const canal = str(fd, "canal"); assert(["WHATSAPP", "EMAIL"].includes(canal), "Escolha o canal.");
    const publico = str(fd, "publico"); assert(!!PUBLICO_CAMPANHA[publico], "Escolha o público."); assert(publico !== "COLABORADORES" || ["DIRECAO", "RH", "DIRETOR_UNIDADE"].includes(s.role), "Envio para a equipe: Direção, RH ou diretor(a) da unidade.");
    const templateId = int(fd, "templateId") ?? 0; const [t] = await sql<{ id: number; canal: string; ativo: boolean; titulo: string }[]>`SELECT id, canal, ativo, titulo FROM message_templates WHERE id=${templateId}`;
    assert(!!t && t.ativo, "Escolha um modelo aprovado e ativo — envio em massa não aceita texto livre."); assert(t.canal === canal, "O modelo é de outro canal.");
    const u = scopeUnit(s); const unitId = u ?? int(fd, "unitId"); const filtro = { unitId: unitId ?? null, gradeId: int(fd, "gradeId"), classId: int(fd, "classId"), inadimplentes: str(fd, "inadimplentes") === "1" };
    if (filtro.inadimplentes) assert(["DIRECAO", "FINANCEIRO"].includes(s.role) && publico === "FAMILIAS", "Lista de inadimplentes: Financeiro ou Direção.");
    const { validos } = await destinatariosCampanha(publico, canal, filtro); assert(validos.length > 0, "Nenhum destinatário com contato válido neste recorte.");
    const cfg = await getSettings(); const ap = await aprovadoresMassa(cfg, s.id); assert(ap.length > 0, "Envio em massa precisa de um segundo aprovador (Direção ou RH) com acesso ativo.");
    const titulo = str(fd, "titulo") || t.titulo;
    const [c] = await sql<{ id: number }[]>`INSERT INTO message_campaigns (titulo, canal, template_id, publico, filtro, assunto, total, autor_user_id, autor_nome) VALUES (${titulo.slice(0, 160)}, ${canal}, ${t.id}, ${publico}, ${JSON.stringify(filtro)}::jsonb, ${strOrNull(fd, "assunto")}, ${validos.length}, ${s.id}, ${s.nome}) RETURNING id`;
    await audit(s, "submeter envio em massa", "message_campaigns", c.id, null, { canal, publico, filtro, modelo: t.id, destinatarios: validos.length });
    await notificar(ap, "Envio em massa aguardando aprovação", `${validos.length} destinatário(s) · ${titulo}`, `/comunicacao/massa/${c.id}`, "ACAO");
    b = `/comunicacao/massa/${c.id}`;
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Enviado para aprovação de um segundo responsável (Direção ou RH). Nada sai antes disso."));
}
export async function decidirCampanha(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const b = `/comunicacao/massa/${id}`; let msg = "";
  try {
    const cfg = await getSettings(); assert((cfg.comunicacao.aprovadoresMassa as string[]).includes(s.role), "Aprovação de envio em massa: Direção ou RH.");
    const [c] = await sql<{ status: string; autor_user_id: number; titulo: string; total: number }[]>`SELECT status, autor_user_id, titulo, total FROM message_campaigns WHERE id=${id}`; assert(!!c, "Envio não encontrado.");
    assert(c.status === "AGUARDANDO_APROVACAO", "Este envio não aguarda aprovação."); assert(c.autor_user_id !== s.id, "Quem criou não aprova o próprio envio em massa.");
    const decisao = str(fd, "decisao");
    if (decisao === "REJEITAR") { const motivo = str(fd, "motivo"); assert(motivo.length >= 5, "Explique o motivo.");
      await sql`UPDATE message_campaigns SET status='REJEITADA', aprovado_por=${s.id}, aprovado_em=now(), motivo_rejeicao=${motivo} WHERE id=${id}`; await notificar([c.autor_user_id], `Envio em massa não aprovado: ${c.titulo}`, motivo, b, "INFO"); msg = "Envio rejeitado; o autor foi avisado."; }
    else if (decisao === "APROVAR") {
      await sql`UPDATE message_campaigns SET status='APROVADA', aprovado_por=${s.id}, aprovado_em=now() WHERE id=${id}`;
      if (emHorarioComercial(cfg)) { const r = await dispararCampanha(id); msg = r ? `Aprovado e disparado: ${r.total} destinatário(s) — ${r.enviadas} enviada(s), ${r.registradas} para envio pelo histórico.` : "Aprovado."; }
      else { const j = proximaJanela(cfg); await sql`UPDATE message_campaigns SET status='AGENDADA', disparo_em=${j.toISOString()}::timestamptz WHERE id=${id}`; msg = `Aprovado. Fora do horário comercial: dispara ${fmtJanela(j)}.`; }
    } else throw new Error("Decisão inválida.");
    await audit(s, decisao === "APROVAR" ? "aprovar envio em massa" : "rejeitar envio em massa", "message_campaigns", id, { status: c.status }, { decisao });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}
export async function cancelarCampanha(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const b = `/comunicacao/massa/${id}`;
  try {
    const cfg = await getSettings(); const [c] = await sql<{ status: string; autor_user_id: number }[]>`SELECT status, autor_user_id FROM message_campaigns WHERE id=${id}`; assert(!!c, "Envio não encontrado.");
    assert(c.autor_user_id === s.id || (cfg.comunicacao.aprovadoresMassa as string[]).includes(s.role), "Só o autor ou um aprovador cancelam."); assert(["AGUARDANDO_APROVACAO", "AGENDADA"].includes(c.status), "Envio já disparado ou encerrado.");
    await sql`UPDATE message_campaigns SET status='CANCELADA' WHERE id=${id}`; await audit(s, "cancelar envio em massa", "message_campaigns", id, { status: c.status }, { status: "CANCELADA" });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Envio cancelado."));
}
