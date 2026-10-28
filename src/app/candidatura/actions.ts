"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { str, strOrNull, int, hoje, addDays, getSettings, auditComo } from "@/lib/utils";
import { erroAssinado } from "@/lib/aviso";
import { notificar, usuariosPorPerfil } from "@/lib/comunicacao";
import { novoProtocolo } from "@/lib/privacidade";
import { contextoPortal, registrar, avisarRh } from "@/lib/portal-candidato";

const QUEM = "Candidato (portal)";
const volta = (token: string, q: string) => `/candidatura/${encodeURIComponent(token)}${q}`;
const erroQ = (e: unknown) => `?${erroAssinado(e instanceof Error ? e.message : "Não foi possível concluir. Tente de novo.")}`;
const ehRedirect = (e: unknown) => e instanceof Error && (e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT");

/** Envia um documento pedido pelo RH (PDF ou imagem). Recusado pode ser reenviado. */
export async function enviarDocumentoCandidato(fd: FormData) {
  const token = str(fd, "token");
  try {
    const c = await contextoPortal(token, false); if (c.retirada) throw new Error("Candidatura retirada: não recebe mais documentos.");
    const id = int(fd, "docId") ?? 0; const [d] = await sql<{ id: number; tipo: string; status: string }[]>`SELECT id, tipo, status FROM candidate_doc_requests WHERE id=${id} AND application_id=${c.applicationId}`;
    if (!d) throw new Error("Documento não encontrado."); if (!["PENDENTE", "RECUSADO"].includes(d.status)) throw new Error("Este documento já foi enviado.");
    const cfg = await getSettings(); const arq = fd.get("arquivo"); if (!arq || typeof arq !== "object" || !("arrayBuffer" in arq) || (arq as File).size === 0) throw new Error("Escolha o arquivo.");
    const f = arq as File; if (f.size > cfg.plataforma.anexoMaxMb * 1048576) throw new Error(`Arquivo acima de ${cfg.plataforma.anexoMaxMb} MB.`);
    const mime = f.type || "application/octet-stream"; if (!["application/pdf", "image/jpeg", "image/png"].includes(mime)) throw new Error("Envie PDF, JPG ou PNG.");
    const nome = f.name.replace(/[^\w.\-() áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ]/g, "_").slice(0, 120);
    await sql.begin(async tx => {
      await tx`INSERT INTO attachments (entidade, entidade_id, nome, mime, tamanho, dados, descricao, unit_id, user_id, user_nome) VALUES ('candidate_doc', ${d.id}, ${nome}, ${mime}, ${f.size}, ${Buffer.from(await f.arrayBuffer())}, ${d.tipo}, ${c.unitId}, NULL, ${QUEM})`;
      await tx`UPDATE candidate_doc_requests SET status='ENVIADO', enviado_em=now(), motivo_recusa=NULL WHERE id=${d.id}`;
    });
    await registrar(c.applicationId, `Enviou o documento: ${d.tipo}`, "CANDIDATO", QUEM);
    await auditComo(QUEM, "enviar documento pelo portal", "candidate_doc_requests", d.id, { status: d.status }, { status: "ENVIADO" });
    await avisarRh(c, "Documento enviado pelo portal do candidato", `cand-doc:${d.id}`);
  } catch (e) { if (ehRedirect(e)) throw e; redirect(volta(token, erroQ(e))); }
  redirect(volta(token, "?ok=doc"));
}

/** Escolhe um dos horários oferecidos para a etapa; os demais da mesma etapa saem. */
export async function escolherHorarioCandidato(fd: FormData) {
  const token = str(fd, "token");
  try {
    const c = await contextoPortal(token, false); if (c.retirada) throw new Error("Candidatura retirada.");
    const id = int(fd, "slotId") ?? 0;
    await sql.begin(async tx => {
      const [sl] = await tx<{ id: number; etapa: string; status: string; futuro: boolean }[]>`SELECT id, etapa, status, (inicio AT TIME ZONE 'America/Campo_Grande') > now() AS futuro FROM interview_slots WHERE id=${id} AND application_id=${c.applicationId} FOR UPDATE`;
      if (!sl) throw new Error("Horário não encontrado."); if (sl.status !== "OFERECIDO") throw new Error("Este horário não está mais disponível."); if (!sl.futuro) throw new Error("Este horário já passou.");
      const [ja] = await tx`SELECT 1 FROM interview_slots WHERE application_id=${c.applicationId} AND etapa=${sl.etapa} AND status='ESCOLHIDO'`; if (ja) throw new Error("Você já escolheu um horário para esta etapa. Para remarcar, envie uma mensagem ao RH.");
      await tx`UPDATE interview_slots SET status='ESCOLHIDO', escolhido_em=now() WHERE id=${sl.id}`;
      await tx`UPDATE interview_slots SET status='DESCARTADO' WHERE application_id=${c.applicationId} AND etapa=${sl.etapa} AND status='OFERECIDO' AND id <> ${sl.id}`;
    });
    const [x] = await sql<{ inicio: string }[]>`SELECT to_char(inicio, 'DD/MM/YYYY HH24:MI') AS inicio FROM interview_slots WHERE id=${id}`;
    await registrar(c.applicationId, `Escolheu o horário da entrevista: ${x?.inicio}`, "CANDIDATO", QUEM);
    await auditComo(QUEM, "escolher horário de entrevista", "interview_slots", id, { status: "OFERECIDO" }, { status: "ESCOLHIDO" });
    await avisarRh(c, "Entrevista marcada pelo portal do candidato", `cand-slot:${id}`);
  } catch (e) { if (ehRedirect(e)) throw e; redirect(volta(token, erroQ(e))); }
  redirect(volta(token, "?ok=horario"));
}

export async function mensagemCandidato(fd: FormData) {
  const token = str(fd, "token");
  try {
    const c = await contextoPortal(token, false); const texto = str(fd, "texto").trim();
    if (texto.length < 5) throw new Error("Escreva a mensagem (mínimo 5 caracteres)."); if (texto.length > 1000) throw new Error("Mensagem longa demais (até 1.000 caracteres).");
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM application_events WHERE application_id=${c.applicationId} AND origem='CANDIDATO' AND at > now() - interval '1 hour'`; if (n >= 10) throw new Error("Muitas mensagens em pouco tempo. Aguarde a resposta do RH.");
    await registrar(c.applicationId, `Mensagem: ${texto}`, "CANDIDATO", QUEM);
    await auditComo(QUEM, "mensagem pelo portal do candidato", "applications", c.applicationId, null, { caracteres: texto.length });
    await avisarRh(c, "Mensagem de candidato no portal", `cand-msg:${c.applicationId}:${new Date().toISOString().slice(0, 13)}`);
  } catch (e) { if (ehRedirect(e)) throw e; redirect(volta(token, erroQ(e))); }
  redirect(volta(token, "?ok=msg"));
}

/** Retirar a candidatura: etapa "desistiu", link encerrado, horários oferecidos saem. */
export async function retirarCandidatura(fd: FormData) {
  const token = str(fd, "token");
  try {
    const c = await contextoPortal(token, false); if (c.retirada) throw new Error("Candidatura já retirada.");
    if (str(fd, "confirmo") !== "1") throw new Error("Marque a confirmação para retirar a candidatura.");
    const motivo = strOrNull(fd, "motivo")?.slice(0, 300) ?? null;
    await sql.begin(async tx => {
      await tx`UPDATE applications SET etapa='DESISTIU', retirada_em=now(), motivo_reprovacao=${`Retirada pelo candidato${motivo ? `: ${motivo}` : ""}`}, updated_at=now() WHERE id=${c.applicationId}`;
      await tx`UPDATE interview_slots SET status='DESCARTADO' WHERE application_id=${c.applicationId} AND status='OFERECIDO'`;
    });
    await registrar(c.applicationId, `Retirou a candidatura${motivo ? `: ${motivo}` : ""}`, "CANDIDATO", QUEM);
    await auditComo(QUEM, "retirar candidatura pelo portal", "applications", c.applicationId, { etapa: c.etapa }, { etapa: "DESISTIU" });
    await avisarRh(c, "Candidatura retirada pelo portal", `cand-ret:${c.applicationId}`);
  } catch (e) { if (ehRedirect(e)) throw e; redirect(volta(token, erroQ(e))); }
  redirect(volta(token, "?ok=retirada"));
}

/** Pedido de exclusão dos dados (LGPD): entra como pedido de titular, com a identidade já confirmada pelo link pessoal. */
export async function pedirExclusaoCandidato(fd: FormData) {
  const token = str(fd, "token"); let protocolo = "";
  try {
    const c = await contextoPortal(token, false); if (c.exclusao) throw new Error("O pedido de exclusão já foi registrado.");
    const cfg = await getSettings(); const prazo = addDays(hoje(), cfg.privacidade.prazoPedidoDias as number); let id = 0;
    for (let k = 0; k < 3 && !id; k++) { protocolo = await novoProtocolo("LGPD", "privacy_requests", "protocolo");
      const r = await sql<{ id: number }[]>`INSERT INTO privacy_requests (protocolo, tipo, titular_nome, titular_tipo, contato_email, descricao, canal, prazo, identidade_verificada, historico) VALUES (${protocolo}, 'ANONIMIZACAO_ELIMINACAO', ${c.nome}, 'CANDIDATO', ${c.email}, ${`Pedido feito pelo portal do candidato (vaga ${c.vaga}). Excluir ou anonimizar os dados da candidatura e do banco de talentos.`}, 'PORTAL_CANDIDATO', ${prazo}, true, ${JSON.stringify([{ em: new Date().toISOString(), quem: QUEM, texto: "Pedido registrado pelo portal do candidato" }])}::jsonb) ON CONFLICT (protocolo) DO NOTHING RETURNING id`;
      if (r[0]) id = r[0].id; }
    if (!id) throw new Error("Não foi possível registrar agora. Tente de novo em instantes.");
    await sql`UPDATE candidates SET exclusao_pedida_em=now() WHERE id=${c.candidateId}`;
    await registrar(c.applicationId, `Pediu a exclusão dos dados (protocolo ${protocolo})`, "CANDIDATO", QUEM);
    await auditComo(QUEM, "pedido de titular", "privacy_requests", id, null, { protocolo, tipo: "ANONIMIZACAO_ELIMINACAO", canal: "PORTAL_CANDIDATO" });
    const quem = [...await usuariosPorPerfil(cfg.privacidade.perfis as string[]), ...(cfg.privacidade.dpoUserId ? [cfg.privacidade.dpoUserId as number] : [])];
    await notificar(quem, `Pedido de titular (LGPD): ${protocolo}`, `Anonimização ou eliminação — responder até ${prazo.split("-").reverse().join("/")}.`, `/governanca/privacidade/pedidos/${id}`, "ACAO", `privped:${id}`);
  } catch (e) { if (ehRedirect(e)) throw e; redirect(volta(token, erroQ(e))); }
  redirect(volta(token, `?ok=exclusao&protocolo=${encodeURIComponent(protocolo)}`));
}

/** v30 · Pesquisa de experiência do candidato (anônima): quando o processo termina, 3 notas, a recomendação e um comentário.
 * Grava só a unidade e o desfecho, com a data arredondada para a semana — nada liga a resposta à pessoa; o resultado sai com 5+ respostas. */
export async function responderExperiencia(fd: FormData) {
  const token = str(fd, "token");
  try {
    const c = await contextoPortal(token, false);
    const [a] = await sql<{ experiencia_em: string | null }[]>`SELECT experiencia_em::text FROM applications WHERE id=${c.applicationId}`;
    if (!(c.retirada || ["REPROVADO", "DESISTIU", "CONTRATADO"].includes(c.etapa))) throw new Error("A pesquisa abre quando o processo termina.");
    if (a?.experiencia_em) throw new Error("Você já respondeu. Obrigado!");
    const nota = (k: string) => { const v = int(fd, k); if (v === null || v < 1 || v > 5) throw new Error("Responda as três perguntas de 1 a 5."); return v; };
    const np = nota("processo"), nc = nota("clareza"), nr = nota("respeito"); const rec = int(fd, "recomendaria"); if (rec === null || rec < 0 || rec > 10) throw new Error("Diga de 0 a 10 se recomendaria.");
    const desfecho = c.retirada ? "RETIRADA" : c.etapa;
    await sql`INSERT INTO candidate_experience (requisition_id, unit_id, desfecho, nota_processo, nota_clareza, nota_respeito, recomendaria, comentario, created_at) VALUES (NULL, ${c.unitId}, ${desfecho}, ${np}, ${nc}, ${nr}, ${rec}, ${(strOrNull(fd, "comentario") ?? "").slice(0, 1000) || null}, date_trunc('week', now()))`;
    await sql`UPDATE applications SET experiencia_em=now() WHERE id=${c.applicationId}`;
  } catch (e) { if (ehRedirect(e)) throw e; redirect(volta(token, erroQ(e))); }
  redirect(volta(token, "?ok=experiencia"));
}
