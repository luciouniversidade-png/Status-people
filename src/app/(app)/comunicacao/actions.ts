"use server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireSession, can, assert, assertScope, scopeUnit } from "@/lib/auth";
import { audit, str, strOrNull, int, getSettings } from "@/lib/utils";
import { foneWa, enviarWhatsApp, preencher, notificar } from "@/lib/comunicacao";
import { enviarEmail } from "@/lib/notify";
import { alvoComunicado, aprovadoresMassa, emHorarioComercial, proximaJanela, fmtJanela, dispararComunicado } from "@/lib/massa";

const go = (b: string, k: "ok" | "erro", msg: string) => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}`;
const GESTAO = ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "COMERCIAL", "FINANCEIRO", "OPERACOES"];

// ---------- Comunicados internos ----------
export async function publicarComunicado(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id"); const b = "/comunicacao/comunicados"; let msg = "Comunicado publicado.";
  try { assert(["DIRECAO", "RH", "DIRETOR_UNIDADE"].includes(s.role), "Comunicados são publicados por Direção, RH e diretores."); const titulo = str(fd, "titulo"); const texto = str(fd, "texto"); if (!titulo || !texto) throw new Error("Informe título e texto.");
    const publico = str(fd, "publico") || "TODOS"; const unitId = publico === "UNIDADE" ? (int(fd, "unitId") ?? scopeUnit(s)) : null; if (s.role === "DIRETOR_UNIDADE" && (publico !== "UNIDADE" || unitId !== s.unitId)) throw new Error("Diretor publica só para a própria unidade.");
    const d = { titulo, texto, publico, unitId, role: publico === "PERFIL" ? strOrNull(fd, "role") : null, requerCiencia: str(fd, "requerCiencia") === "1", prazoCiencia: strOrNull(fd, "prazoCiencia"), fixado: str(fd, "fixado") === "1", expiraEm: strOrNull(fd, "expiraEm"), autorUserId: s.id, autorNome: s.nome };
    // v25 · CRQ-COM-V3-01: para muita gente, é comunicação em massa — só sai com um segundo aprovador e em horário comercial
    const cfg = await getSettings(); const alvo = await alvoComunicado(publico, unitId, d.role); const massa = alvo.length >= Number(cfg.comunicacao.massaMinDestinatarios ?? 20);
    let cid = id ?? 0;
    if (id) { const [old] = await sql<{ status: string; autor_user_id: number | null }[]>`SELECT status, autor_user_id FROM announcements WHERE id=${id}`; if (!old) throw new Error("Comunicado não encontrado."); assert(old.autor_user_id === s.id || can.editar(s), "Só o autor, o RH ou a Direção editam.");
      await db.update(schema.announcements).set(d).where(eq(schema.announcements.id, id)); }
    else {
      const [r] = await db.insert(schema.announcements).values({ ...d, status: massa ? "AGUARDANDO_APROVACAO" : "PUBLICADO", destinatarios: alvo.length, disparadoEm: massa ? null : new Date() }).returning({ id: schema.announcements.id }); cid = r.id;
      if (massa) { const ap = await aprovadoresMassa(cfg, s.id); assert(ap.length > 0, "Comunicação em massa precisa de um segundo aprovador (Direção ou RH) com acesso ativo — cadastre antes de publicar.");
        await notificar(ap, "Comunicado em massa aguardando aprovação", `${alvo.length} destinatário(s) · ${titulo}`, `/comunicacao/comunicados#c${cid}`, "ACAO"); msg = `Comunicado para ${alvo.length} pessoas: é comunicação em massa — enviado para aprovação de um segundo responsável (Direção ou RH).`; }
      else await notificar(alvo, `Comunicado: ${titulo}`, d.requerCiencia ? "Requer sua ciência." : null, `/comunicacao/comunicados#c${cid}`, d.requerCiencia ? "ACAO" : "INFO");
    }
    await audit(s, id ? "editar comunicado" : massa ? "submeter comunicado em massa" : "publicar comunicado", "announcements", cid, null, { titulo, publico, destinatarios: alvo.length, massa });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}
/** Segundo humano aprova (ou rejeita) o comunicado em massa; fora do horário comercial o disparo fica agendado. */
export async function decidirComunicado(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const b = "/comunicacao/comunicados"; let msg = "";
  try {
    const cfg = await getSettings(); assert((cfg.comunicacao.aprovadoresMassa as string[]).includes(s.role), "Aprovação de comunicação em massa: Direção ou RH.");
    const [a] = await sql<{ status: string; autor_user_id: number | null; titulo: string; destinatarios: number | null }[]>`SELECT status, autor_user_id, titulo, destinatarios FROM announcements WHERE id=${id}`; assert(!!a, "Comunicado não encontrado.");
    assert(a.status === "AGUARDANDO_APROVACAO", "Este comunicado não aguarda aprovação."); assert(a.autor_user_id !== s.id, "Quem escreveu não aprova o próprio comunicado em massa.");
    const decisao = str(fd, "decisao");
    if (decisao === "REJEITAR") { const motivo = str(fd, "motivo"); assert(motivo.length >= 5, "Explique o motivo da rejeição.");
      await sql`UPDATE announcements SET status='REJEITADO', aprovado_por=${s.id}, aprovado_em=now(), motivo_rejeicao=${motivo} WHERE id=${id}`; if (a.autor_user_id) await notificar([a.autor_user_id], `Comunicado não aprovado: ${a.titulo}`, motivo, `/comunicacao/comunicados#c${id}`, "INFO"); msg = "Comunicado rejeitado; o autor foi avisado."; }
    else if (decisao === "APROVAR") {
      await sql`UPDATE announcements SET status='APROVADO', aprovado_por=${s.id}, aprovado_em=now() WHERE id=${id}`;
      if (emHorarioComercial(cfg)) { await dispararComunicado(id); msg = `Aprovado e publicado para ${a.destinatarios ?? 0} pessoa(s).`; }
      else { const j = proximaJanela(cfg); await sql`UPDATE announcements SET status='AGENDADO', disparo_em=${j.toISOString()}::timestamptz WHERE id=${id}`; msg = `Aprovado. Fora do horário comercial: publica ${fmtJanela(j)}.`; }
    } else throw new Error("Decisão inválida.");
    await audit(s, decisao === "APROVAR" ? "aprovar comunicado em massa" : "rejeitar comunicado em massa", "announcements", id, { status: a.status }, { decisao });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}
export async function cienciaComunicado(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id"));
  await sql`INSERT INTO announcement_acks (announcement_id, user_id) VALUES (${id}, ${s.id}) ON CONFLICT DO NOTHING`; await sql`UPDATE notifications SET lida_em=now() WHERE user_id=${s.id} AND link=${`/comunicacao/comunicados#c${id}`}`;
  redirect(go("/comunicacao/comunicados", "ok", "Ciência registrada."));
}
export async function removerComunicado(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id"));
  try { assert(can.editar(s)); await db.delete(schema.announcements).where(eq(schema.announcements.id, id)); await audit(s, "remover comunicado", "announcements", id, null, null); } catch (e) { redirect(go("/comunicacao/comunicados", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go("/comunicacao/comunicados", "ok", "Comunicado removido."));
}

// ---------- Modelos ----------
export async function salvarModelo(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id"); const b = "/comunicacao/modelos";
  try { assert(can.editar(s)); const codigo = str(fd, "codigo").toUpperCase(); const titulo = str(fd, "titulo"); const texto = str(fd, "texto"); if (!codigo || !titulo || !texto) throw new Error("Informe código, título e texto.");
    const d = { codigo, titulo, categoria: str(fd, "categoria") || "GERAL", canal: str(fd, "canal") || "WHATSAPP", texto, ativo: str(fd, "ativo") !== "0" };
    if (id) await db.update(schema.messageTemplates).set(d).where(eq(schema.messageTemplates.id, id)); else await db.insert(schema.messageTemplates).values(d); await audit(s, id ? "editar modelo" : "criar modelo", "message_templates", id, null, { codigo });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Modelo salvo."));
}

// ---------- Mensagens (registro + envio) ----------
export async function registrarMensagem(fd: FormData) {
  const s = await requireSession(); const voltar = str(fd, "voltar") || "/comunicacao/mensagens"; let msg = "";
  try { assert(GESTAO.includes(s.role), "Seu perfil não envia mensagens."); const canal = str(fd, "canal") || "WHATSAPP"; const nome = str(fd, "destinatarioNome"); const contato = strOrNull(fd, "destinatarioContato"); let texto = str(fd, "texto"); if (!nome || !texto) throw new Error("Informe destinatário e texto.");
    const cfg = await getSettings(); let vars: Record<string, string | number | null> = {}; try { vars = JSON.parse(str(fd, "vars") || "{}"); } catch { vars = {}; } texto = preencher(texto, { unidade: "Colégio Status", ...vars, nome, responsavel: nome, assinatura: cfg.comunicacao.assinatura }); const unitId = int(fd, "unitId") ?? scopeUnit(s); if (unitId) assertScope(s, unitId);
    const [m] = await db.insert(schema.messages).values({ canal, destinatarioNome: nome, destinatarioContato: contato, studentId: int(fd, "studentId"), employeeId: int(fd, "employeeId"), entidade: strOrNull(fd, "entidade"), entidadeId: int(fd, "entidadeId"), templateId: int(fd, "templateId"), texto, status: "REGISTRADA", userId: s.id, userNome: s.nome, unitId }).returning({ id: schema.messages.id });
    const enviar = str(fd, "enviar") === "1";
    if (enviar && canal === "WHATSAPP") { const fone = foneWa(contato); if (!fone) throw new Error("Telefone inválido para WhatsApp."); const r = await enviarWhatsApp(fone, texto); await db.update(schema.messages).set(r.ok ? { status: "ENVIADA", enviadaEm: new Date(), provedorId: r.id } : { status: r.via === "api" ? "FALHOU" : "REGISTRADA", erro: r.erro }).where(eq(schema.messages.id, m.id)); msg = r.ok ? "Mensagem enviada pela API do WhatsApp." : r.via === "link" ? "Mensagem registrada — abra o link do WhatsApp para enviar pelo celular." : `Falha no envio: ${r.erro}`; }
    else if (enviar && canal === "EMAIL") { if (!contato || !contato.includes("@")) throw new Error("E-mail inválido."); const ok = await enviarEmail([contato], str(fd, "assunto") || "Colégio Status", texto); await db.update(schema.messages).set(ok ? { status: "ENVIADA", enviadaEm: new Date() } : { status: "FALHOU", erro: "E-mail não configurado (RESEND_API_KEY)" }).where(eq(schema.messages.id, m.id)); msg = ok ? "E-mail enviado." : "E-mail não enviado: serviço de e-mail não configurado."; }
    else msg = "Mensagem registrada no histórico.";
    await audit(s, "mensagem", "messages", m.id, null, { canal, nome, entidade: strOrNull(fd, "entidade") });
    redirect(go(voltar, "ok", msg) + `&msg=${m.id}`);
  } catch (e) { if (e instanceof Error && (e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e; redirect(go(voltar, "erro", e instanceof Error ? e.message : "Erro")); }
}
export async function marcarEnviada(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const voltar = str(fd, "voltar") || "/comunicacao/mensagens";
  try { assert(GESTAO.includes(s.role)); await db.update(schema.messages).set({ status: "ENVIADA", enviadaEm: new Date() }).where(eq(schema.messages.id, id)); } catch (e) { redirect(go(voltar, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(voltar, "ok", "Marcada como enviada."));
}

// ---------- Notificações ----------
export async function lerNotificacoes(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id");
  if (id) await sql`UPDATE notifications SET lida_em=now() WHERE id=${id} AND user_id=${s.id}`; else await sql`UPDATE notifications SET lida_em=now() WHERE user_id=${s.id} AND lida_em IS NULL`;
  const link = strOrNull(fd, "link"); redirect(link ?? "/notificacoes");
}
