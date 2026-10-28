"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, assertScope } from "@/lib/auth";
import { audit, str, strOrNull, int, hoje, addDays, caminhoSeguro, getSettings } from "@/lib/utils";
import { notificar } from "@/lib/comunicacao";
import { STATUS_AUDITORIA, TIPOS_AUDITORIA, gravidadeReincidente } from "@/lib/auditorias";
import { comMensagem } from "@/lib/redirecionar";

const go = (b: string, k: "ok" | "erro", m: string) => comMensagem(b, k, m);
const msg = (e: unknown) => e instanceof Error ? e.message : "Erro inesperado.";
const BASE = "/governanca/auditorias";
const GOV = ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR"];
const dataOk = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
async function governanca() { const s = await requireSession(); assert(GOV.includes(s.role), "Auditorias: Governança/Qualidade, Direção e gestores."); return s; }

export async function salvarAuditoria(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), BASE); const id = int(fd, "id"); let novo = 0;
  try {
    const s = await governanca(); const titulo = str(fd, "titulo"); assert(titulo.length >= 4, "Dê um título à auditoria."); const tipo = str(fd, "tipo"); assert(!!TIPOS_AUDITORIA[tipo], "Tipo inválido.");
    const plan = str(fd, "planejadaPara"); assert(dataOk(plan), "Informe a data planejada."); const pr = str(fd, "prazoRelatorio"); assert(!pr || (dataOk(pr) && pr >= plan), "O prazo do relatório vem depois da execução.");
    const unitId = int(fd, "unitId"); if (unitId) assertScope(s, unitId); const lead = int(fd, "leadUserId") ?? s.id;
    if (id) { const [a] = await sql<{ status: string }[]>`SELECT status FROM audits WHERE id=${id}`; assert(!!a && a.status !== "CONCLUIDA", "Auditoria concluída não se edita.");
      await sql`UPDATE audits SET titulo=${titulo}, tipo=${tipo}, area=${strOrNull(fd, "area")}, unit_id=${unitId}, lead_user_id=${lead}, planejada_para=${plan}, prazo_relatorio=${pr || null}, escopo=${strOrNull(fd, "escopo")}, updated_at=now() WHERE id=${id}`; await audit(s, "editar auditoria", "audits", id, null, { titulo, plan }); }
    else { const [r] = await sql<{ id: number }[]>`INSERT INTO audits (titulo, tipo, area, unit_id, lead_user_id, planejada_para, prazo_relatorio, escopo, created_by) VALUES (${titulo}, ${tipo}, ${strOrNull(fd, "area")}, ${unitId}, ${lead}, ${plan}, ${pr || addDays(plan, 15)}, ${strOrNull(fd, "escopo")}, ${s.id}) RETURNING id`; novo = r.id; await audit(s, "planejar auditoria", "audits", r.id, null, { titulo, plan, tipo });
      if (lead !== s.id) await notificar([lead], `Você é o auditor-líder: ${titulo}`, `planejada para ${plan.split("-").reverse().join("/")}`, `${BASE}?id=${r.id}`, "ACAO", `aud:${r.id}:lead`); }
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(novo ? `${BASE}?id=${novo}` : voltar, "ok", "Auditoria salva."));
}

export async function avancarAuditoria(fd: FormData) {
  const id = int(fd, "id") ?? 0; const voltar = `${BASE}?id=${id}`;
  try {
    const s = await governanca(); const para = str(fd, "status"); assert(!!STATUS_AUDITORIA[para], "Situação inválida.");
    const [a] = await sql<{ status: string; realizada_em: string | null }[]>`SELECT status, realizada_em::text FROM audits WHERE id=${id}`; assert(!!a, "Auditoria não encontrada."); assert(a.status !== "CONCLUIDA" && a.status !== "CANCELADA", "Auditoria encerrada.");
    if (para === "CONCLUIDA") { const conclusao = str(fd, "conclusao"); assert(conclusao.length >= 10, "Registre a conclusão do relatório (mín. 10 caracteres)."); await sql`UPDATE audits SET status='CONCLUIDA', conclusao=${conclusao}, realizada_em=coalesce(realizada_em, ${hoje()}), updated_at=now() WHERE id=${id}`; }
    else if (para === "CANCELADA") { const motivo = str(fd, "motivo"); assert(motivo.length >= 10, "Explique o cancelamento."); await sql`UPDATE audits SET status='CANCELADA', conclusao=${`Cancelada: ${motivo}`}, updated_at=now() WHERE id=${id}`; }
    else { const real = para === "EM_EXECUCAO" || para === "RELATORIO" ? (str(fd, "realizadaEm") || a.realizada_em || hoje()) : a.realizada_em; await sql`UPDATE audits SET status=${para}, realizada_em=${real}, updated_at=now() WHERE id=${id}`; }
    await audit(s, "situação da auditoria", "audits", id, { status: a.status }, { status: para });
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(voltar, "ok", "Auditoria atualizada."));
}

/** Achado com evidência → NC (origem Auditoria) com gravidade, responsável e prazo da CAPA. */
export async function registrarAchado(fd: FormData) {
  const auditId = int(fd, "auditId") ?? 0; const voltar = `${BASE}?id=${auditId}`;
  try {
    const s = await governanca(); const [a] = await sql<{ status: string; unit_id: number | null; titulo: string }[]>`SELECT status, unit_id, titulo FROM audits WHERE id=${auditId}`; assert(!!a, "Auditoria não encontrada."); assert(["EM_EXECUCAO", "RELATORIO"].includes(a.status), "Achados entram com a auditoria em execução ou em relatório.");
    const titulo = str(fd, "titulo"); assert(titulo.length >= 4, "Descreva o achado."); const evid = str(fd, "evidencia"); assert(evid.length >= 10, "Achado sem evidência não entra: descreva a evidência (mín. 10 caracteres).");
    const g = int(fd, "gravidade") ?? 2; assert(g >= 1 && g <= 3, "Gravidade de 1 a 3."); const resp = int(fd, "responsavelUserId"); const prazo = str(fd, "prazo") || addDays(hoje(), g === 3 ? 15 : g === 2 ? 30 : 60);
    const [n] = await sql<{ id: number }[]>`INSERT INTO nonconformities (titulo, origem, descricao, procedure_id, unit_id, gravidade, responsavel_user_id, prazo, status, audit_id, created_by) VALUES (${titulo}, 'AUDITORIA', ${`Evidência: ${evid}`}, ${int(fd, "procedureId")}, ${a.unit_id}, ${g}, ${resp}, ${prazo}, 'ABERTA', ${auditId}, ${s.id}) RETURNING id`;
    const arq = fd.get("arquivo"); if (arq && typeof arq === "object" && "arrayBuffer" in arq && (arq as File).size > 0) { const f = arq as File; const cfg = await getSettings(); assert(f.size <= cfg.plataforma.anexoMaxMb * 1048576, `Arquivo acima de ${cfg.plataforma.anexoMaxMb} MB.`); assert((cfg.plataforma.anexoTipos as string[]).includes(f.type || "application/octet-stream"), `Tipo não permitido (${f.type}).`); const dados = Buffer.from(await f.arrayBuffer()); await sql`INSERT INTO attachments (entidade, entidade_id, nome, mime, tamanho, dados, descricao, unit_id, user_id, user_nome) VALUES ('nonconformity', ${n.id}, ${f.name.replace(/[^\w.\-() ]/g, "_").slice(0, 120)}, ${f.type || "application/octet-stream"}, ${f.size}, ${dados}, 'Evidência do achado', ${a.unit_id}, ${s.id}, ${s.nome})`; }
    if (resp) await notificar([resp], `Não conformidade de auditoria: ${titulo}`, `Abra a CAPA (causa raiz e ações) até ${prazo.split("-").reverse().join("/")}.`, `${BASE}?nc=${n.id}#capa`, "ACAO", `nc:${n.id}:resp`);
    await audit(s, "registrar achado de auditoria", "nonconformities", n.id, null, { auditId, gravidade: g });
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(voltar, "ok", "Achado registrado como não conformidade."));
}

/** CAPA: causa raiz + ação corretiva (e preventiva) com prazo → em tratamento; o responsável conclui → verificação de eficácia. */
export async function salvarCapa(fd: FormData) {
  const id = int(fd, "id") ?? 0; const voltar = caminhoSeguro(str(fd, "voltar"), `${BASE}?nc=${id}#capa`);
  try {
    const s = await requireSession(); const [n] = await sql<{ status: string; responsavel_user_id: number | null; unit_id: number | null }[]>`SELECT status, responsavel_user_id, unit_id FROM nonconformities WHERE id=${id}`; assert(!!n, "NC não encontrada.");
    assert(GOV.includes(s.role) || n.responsavel_user_id === s.id, "Só o responsável pela NC ou a Governança registram a CAPA."); assert(n.status !== "ENCERRADA", "NC encerrada.");
    const causa = str(fd, "causaRaiz"), corr = str(fd, "acaoCorretiva"); assert(causa.length >= 10 && corr.length >= 10, "CAPA exige causa raiz e ação corretiva (mín. 10 caracteres cada).");
    const concluir = str(fd, "concluir") === "1"; const prazo = str(fd, "prazo"); assert(!prazo || dataOk(prazo), "Prazo inválido.");
    await sql`UPDATE nonconformities SET causa_raiz=${causa}, acao_corretiva=${corr}, acao_preventiva=${strOrNull(fd, "acaoPreventiva")}, prazo=coalesce(${prazo || null}::date, prazo), status=${concluir ? "VERIFICACAO" : "EM_TRATAMENTO"} WHERE id=${id}`;
    await audit(s, concluir ? "concluir CAPA (vai à verificação)" : "registrar CAPA", "nonconformities", id, { status: n.status }, { status: concluir ? "VERIFICACAO" : "EM_TRATAMENTO" });
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(voltar, "ok", "CAPA registrada."));
}

/** Verificação de eficácia (aceite T-080): fecha só com evidência; ineficaz volta ao tratamento. */
export async function verificarEficacia(fd: FormData) {
  const id = int(fd, "id") ?? 0; const voltar = caminhoSeguro(str(fd, "voltar"), `${BASE}?nc=${id}#capa`); let fechou = false;
  try {
    const s = await governanca(); const [n] = await sql<{ status: string; responsavel_user_id: number | null; causa_raiz: string | null; acao_corretiva: string | null }[]>`SELECT status, responsavel_user_id, causa_raiz, acao_corretiva FROM nonconformities WHERE id=${id}`; assert(!!n, "NC não encontrada.");
    assert(n.status === "VERIFICACAO", "A verificação vem depois de o responsável concluir a CAPA."); assert(n.responsavel_user_id !== s.id || s.role === "DIRECAO", "Quem executou a CAPA não verifica a própria eficácia (Four-Eyes).");
    const evid = str(fd, "evidencia"); assert(evid.length >= 15, "Fechar exige a evidência de eficácia (o que foi medido/observado, mín. 15 caracteres)."); const eficaz = str(fd, "eficaz") === "1";
    if (eficaz) { await sql`UPDATE nonconformities SET status='ENCERRADA', eficacia_verificada=true, eficacia_evidencia=${evid}, eficacia_em=${hoje()}, encerrada_em=now() WHERE id=${id}`; fechou = true; }
    else { await sql`UPDATE nonconformities SET status='EM_TRATAMENTO', eficacia_verificada=false, eficacia_evidencia=${`Ineficaz em ${hoje().split("-").reverse().join("/")}: ${evid}`} WHERE id=${id}`; if (n.responsavel_user_id) await notificar([n.responsavel_user_id], "CAPA não foi eficaz", "A verificação pediu nova ação: revise causa raiz e ações.", `${BASE}?nc=${id}#capa`, "ACAO", `nc:${id}:inef:${hoje()}`); }
    await audit(s, eficaz ? "eficácia verificada — NC encerrada" : "eficácia não comprovada — NC reaberta", "nonconformities", id, null, { eficaz });
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(voltar, "ok", fechou ? "Eficácia verificada: NC encerrada com evidência." : "CAPA ineficaz: NC voltou ao tratamento."));
}

/** Reincidência: reabre a NC encerrada com gravidade maior e conta a recorrência. */
export async function registrarReincidencia(fd: FormData) {
  const id = int(fd, "id") ?? 0; const voltar = caminhoSeguro(str(fd, "voltar"), `${BASE}?nc=${id}#capa`);
  try {
    const s = await governanca(); const [n] = await sql<{ status: string; gravidade: number; responsavel_user_id: number | null; titulo: string }[]>`SELECT status, gravidade, responsavel_user_id, titulo FROM nonconformities WHERE id=${id}`; assert(!!n, "NC não encontrada."); assert(n.status === "ENCERRADA", "Reincidência é de NC já encerrada.");
    const relato = str(fd, "relato"); assert(relato.length >= 10, "Descreva a reincidência (onde, quando, evidência)."); const g = gravidadeReincidente(n.gravidade);
    await sql`UPDATE nonconformities SET status='ABERTA', gravidade=${g}, reincidencias=reincidencias+1, eficacia_verificada=false, encerrada_em=NULL, prazo=${addDays(hoje(), 15)}, descricao=coalesce(descricao, '') || ${`\n\nReincidência em ${hoje().split("-").reverse().join("/")}: ${relato}`} WHERE id=${id}`;
    if (n.responsavel_user_id) await notificar([n.responsavel_user_id], `Reincidência: ${n.titulo}`, `NC reaberta com gravidade ${g}. Revise a causa raiz.`, `${BASE}?nc=${id}#capa`, "ALERTA", `nc:${id}:reinc:${hoje()}`);
    await audit(s, "reincidência de NC", "nonconformities", id, { gravidade: n.gravidade }, { gravidade: g });
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(voltar, "ok", "NC reaberta por reincidência, com gravidade maior."));
}
