"use server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireSession, can, assert, assertScope } from "@/lib/auth";
import { audit, str, strOrNull, int, hoje, addDays, addMonths, getSettings } from "@/lib/utils";
import { FREQ_DIAS } from "@/lib/governanca";

const go = (b: string, k: "ok" | "erro", msg: string) => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}`;
const GESTAO = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"];
const EQUIPE = [...GESTAO, "COMERCIAL"];

// ---------- POPs ----------
async function pop(id: number) { const [p] = await db.select().from(schema.procedures).where(eq(schema.procedures.id, id)); if (!p) throw new Error("POP não encontrado."); return p; }
function lerPop(fd: FormData) {
  const codigo = str(fd, "codigo"); const titulo = str(fd, "titulo"); const area = str(fd, "area"); if (!codigo || !titulo || !area) throw new Error("Informe código, título e área.");
  return { codigo, titulo, area, unitId: int(fd, "unitId"), ownerUserId: int(fd, "ownerUserId"), objetivo: strOrNull(fd, "objetivo"), escopo: strOrNull(fd, "escopo"), passos: strOrNull(fd, "passos"), responsavel: strOrNull(fd, "responsavel"), aprovador: strOrNull(fd, "aprovador"), consultados: strOrNull(fd, "consultados"), informados: strOrNull(fd, "informados"), indicadores: strOrNull(fd, "indicadores"), link: strOrNull(fd, "link"), revisarEm: strOrNull(fd, "revisarEm") };
}
export async function salvarPop(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id"); let novoId = id ?? 0;
  try {
    const d = lerPop(fd);
    if (id) { const antes = await pop(id); assert(can.editar(s) || antes.ownerUserId === s.id, "Só RH, Direção ou o dono editam este POP."); await db.update(schema.procedures).set({ ...d, updatedAt: new Date() }).where(eq(schema.procedures.id, id)); await audit(s, "editar", "procedures", id, { titulo: antes.titulo, versao: antes.versao }, d); }
    else { assert(GESTAO.includes(s.role), "Seu perfil não cria POPs."); const [r] = await db.insert(schema.procedures).values(d).returning({ id: schema.procedures.id }); novoId = r.id; await audit(s, "criar", "procedures", r.id, null, d); }
  } catch (e) { redirect(go(id ? `/governanca/pops/${id}` : "/governanca/pops", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`/governanca/pops/${novoId}`, "ok", "POP salvo."));
}
export async function publicarPop(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const b = `/governanca/pops/${id}`;
  try {
    const cfg = await getSettings(); assert(can.aprovar(s, cfg.alcadas.pops), "Publicar POP exige: " + cfg.alcadas.pops.join(", ") + ".");
    const p = await pop(id); if (!p.passos) throw new Error("POP sem passos não pode ser publicado."); if (!p.ownerUserId) throw new Error("Defina o dono do POP antes de publicar.");
    const novaVersao = p.publicadoEm ? p.versao + 1 : p.versao;
    const { id: _i, createdAt: _c, updatedAt: _u, ...conteudo } = p; void _i; void _c; void _u;
    await db.insert(schema.procedureVersions).values({ procedureId: id, versao: novaVersao, conteudo: { ...conteudo, versao: novaVersao }, notas: strOrNull(fd, "notas"), publicadoPor: s.id });
    await db.update(schema.procedures).set({ status: "VIGENTE", versao: novaVersao, publicadoEm: new Date(), revisarEm: p.revisarEm ?? addMonths(hoje(), cfg.governanca.revisaoPopMeses), updatedAt: new Date() }).where(eq(schema.procedures.id, id));
    await audit(s, "publicar", "procedures", id, { versao: p.versao, status: p.status }, { versao: novaVersao, status: "VIGENTE" });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "POP publicado como vigente. A equipe precisa dar ciência da nova versão."));
}
export async function mudarStatusPop(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const novo = str(fd, "status"); const b = `/governanca/pops/${id}`;
  try { const cfg = await getSettings(); assert(can.aprovar(s, cfg.alcadas.pops)); const p = await pop(id); if (!["EM_REVISAO", "OBSOLETO", "RASCUNHO"].includes(novo)) throw new Error("Situação inválida.");
    await db.update(schema.procedures).set({ status: novo, updatedAt: new Date() }).where(eq(schema.procedures.id, id)); await audit(s, "mudar status", "procedures", id, { status: p.status }, { status: novo }); }
  catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Situação do POP atualizada."));
}
export async function darCiencia(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const b = `/governanca/pops/${id}`;
  try { const p = await pop(id); if (p.status !== "VIGENTE") throw new Error("Só POPs vigentes recebem ciência.");
    await sql`INSERT INTO procedure_acks (procedure_id, versao, user_id) VALUES (${id}, ${p.versao}, ${s.id}) ON CONFLICT DO NOTHING`; await audit(s, "dar ciência", "procedures", id, null, { versao: p.versao }); }
  catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Ciência registrada. Obrigado."));
}

// ---------- Exceções ----------
export async function solicitarExcecao(fd: FormData) {
  const s = await requireSession(); const b = str(fd, "voltar") || "/governanca/excecoes"; let id = 0;
  try {
    assert(EQUIPE.includes(s.role), "Seu perfil não solicita exceções."); const cfg = await getSettings();
    const regra = str(fd, "regra"); const motivo = str(fd, "motivo"); if (!regra || !motivo) throw new Error("Informe a regra/POP e o motivo padronizado.");
    const unitId = int(fd, "unitId"); if (unitId) assertScope(s, unitId);
    const [r] = await db.insert(schema.exceptions).values({ procedureId: int(fd, "procedureId"), regra, motivo, descricao: strOrNull(fd, "descricao"), impacto: strOrNull(fd, "impacto"), referencia: strOrNull(fd, "referencia"), unitId, solicitanteUserId: s.id, validadeAte: strOrNull(fd, "validadeAte") ?? addDays(hoje(), cfg.governanca.excecaoValidadeDias) }).returning({ id: schema.exceptions.id });
    id = r.id; await audit(s, "solicitar exceção", "exceptions", id, null, { regra, motivo, unitId });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go("/governanca/excecoes", "ok", `Exceção #${id} enviada para aprovação.`));
}
export async function decidirExcecao(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const decisao = str(fd, "decisao"); const b = "/governanca/excecoes";
  try {
    const cfg = await getSettings(); const [e] = await db.select().from(schema.exceptions).where(eq(schema.exceptions.id, id)); if (!e) throw new Error("Exceção não encontrada.");
    if (decisao === "REVISADA") { assert(GESTAO.includes(s.role)); assert(e.status === "EXPIRADA" || e.status === "APROVADA", "Só exceções vigentes ou expiradas são revisadas."); await db.update(schema.exceptions).set({ status: "REVISADA", revisaoNota: strOrNull(fd, "nota") }).where(eq(schema.exceptions.id, id)); }
    else {
      assert(can.aprovar(s, cfg.alcadas.excecao), "Aprovar exceções exige: " + cfg.alcadas.excecao.join(", ") + "."); assert(e.status === "SOLICITADA", "Exceção já decidida."); assert(e.solicitanteUserId !== s.id, "Quem solicita não aprova a própria exceção.");
      if (e.unitId) assertScope(s, e.unitId); if (decisao !== "APROVADA" && decisao !== "REJEITADA") throw new Error("Decisão inválida.");
      await db.update(schema.exceptions).set({ status: decisao, aprovadorUserId: s.id, decididoEm: new Date(), motivoDecisao: strOrNull(fd, "nota"), validadeAte: strOrNull(fd, "validadeAte") ?? e.validadeAte }).where(eq(schema.exceptions.id, id));
    }
    await audit(s, decisao === "APROVADA" ? "aprovar exceção" : decisao === "REJEITADA" ? "rejeitar exceção" : "revisar exceção", "exceptions", id, { status: e.status }, { status: decisao, nota: strOrNull(fd, "nota") });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", decisao === "APROVADA" ? "Exceção aprovada com validade." : decisao === "REJEITADA" ? "Exceção rejeitada." : "Exceção revisada."));
}

// ---------- Controles ----------
export async function salvarControle(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id"); const b = "/governanca/controles";
  try { assert(GESTAO.includes(s.role)); const titulo = str(fd, "titulo"); const area = str(fd, "area"); const frequencia = str(fd, "frequencia") || "MENSAL"; if (!titulo || !area) throw new Error("Informe título e área."); if (!FREQ_DIAS[frequencia]) throw new Error("Frequência inválida.");
    const d = { titulo, area, frequencia, procedureId: int(fd, "procedureId"), unitId: int(fd, "unitId"), responsavelUserId: int(fd, "responsavelUserId") ?? s.id, descricao: strOrNull(fd, "descricao"), proximaEm: strOrNull(fd, "proximaEm") ?? hoje(), ativo: str(fd, "ativo") !== "0" };
    if (d.unitId) assertScope(s, d.unitId);
    if (id) { await db.update(schema.controls).set(d).where(eq(schema.controls.id, id)); await audit(s, "editar", "controls", id, null, d); } else { const [r] = await db.insert(schema.controls).values(d).returning({ id: schema.controls.id }); await audit(s, "criar", "controls", r.id, null, d); }
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Controle salvo."));
}
export async function registrarExecucao(fd: FormData) {
  const s = await requireSession(); const controlId = Number(fd.get("controlId")); const b = "/governanca/controles"; let msg = "";
  try { assert(GESTAO.includes(s.role) || s.role === "COMERCIAL"); const [c] = await db.select().from(schema.controls).where(eq(schema.controls.id, controlId)); if (!c) throw new Error("Controle não encontrado."); if (c.unitId) assertScope(s, c.unitId);
    const resultado = str(fd, "resultado"); if (resultado !== "CONFORME" && resultado !== "NAO_CONFORME") throw new Error("Informe o resultado."); const data = str(fd, "data") || hoje();
    await db.insert(schema.controlRuns).values({ controlId, data, resultado, evidencia: strOrNull(fd, "evidencia"), obs: strOrNull(fd, "obs"), userId: s.id });
    await db.update(schema.controls).set({ proximaEm: addDays(data, FREQ_DIAS[c.frequencia] ?? 30) }).where(eq(schema.controls.id, controlId));
    msg = "Execução registrada.";
    if (resultado === "NAO_CONFORME" && str(fd, "abrirNc") === "1") {
      const [nc] = await db.insert(schema.nonconformities).values({ titulo: `Não conformidade em: ${c.titulo}`, origem: "CONTROLE", descricao: strOrNull(fd, "obs"), procedureId: c.procedureId, controlId, unitId: c.unitId, gravidade: int(fd, "gravidade") ?? 2, responsavelUserId: c.responsavelUserId ?? s.id, prazo: addDays(data, 15), createdBy: s.id }).returning({ id: schema.nonconformities.id });
      msg += ` Não conformidade #${nc.id} aberta com prazo de 15 dias.`; await audit(s, "abrir NC", "nonconformities", nc.id, null, { controlId });
    }
    await audit(s, "executar controle", "control_runs", controlId, null, { data, resultado });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}

// ---------- Não conformidades ----------
export async function salvarNc(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id"); const b = "/governanca/controles#ncs";
  try { assert(GESTAO.includes(s.role) || s.role === "COMERCIAL");
    const d = { titulo: str(fd, "titulo"), origem: str(fd, "origem") || "OUTRO", descricao: strOrNull(fd, "descricao"), procedureId: int(fd, "procedureId"), caseId: int(fd, "caseId"), unitId: int(fd, "unitId"), gravidade: int(fd, "gravidade") ?? 2, causaRaiz: strOrNull(fd, "causaRaiz"), acaoCorretiva: strOrNull(fd, "acaoCorretiva"), acaoPreventiva: strOrNull(fd, "acaoPreventiva"), responsavelUserId: int(fd, "responsavelUserId") ?? s.id, prazo: strOrNull(fd, "prazo") ?? addDays(hoje(), 15), status: str(fd, "status") || "ABERTA", eficaciaVerificada: str(fd, "eficaciaVerificada") === "1" };
    if (!d.titulo) throw new Error("Informe o título."); if (d.unitId) assertScope(s, d.unitId);
    if (d.status === "ENCERRADA") { if (!d.causaRaiz || !d.acaoCorretiva) throw new Error("Só encerra com causa raiz e ação corretiva."); if (!d.eficaciaVerificada) throw new Error("Confirme a verificação de eficácia antes de encerrar."); }
    const upd = { ...d, encerradaEm: d.status === "ENCERRADA" ? new Date() : null };
    if (id) { const [antes] = await db.select().from(schema.nonconformities).where(eq(schema.nonconformities.id, id)); await db.update(schema.nonconformities).set(upd).where(eq(schema.nonconformities.id, id)); await audit(s, "editar NC", "nonconformities", id, { status: antes?.status }, { status: d.status }); }
    else { const [r] = await db.insert(schema.nonconformities).values({ ...upd, createdBy: s.id }).returning({ id: schema.nonconformities.id }); await audit(s, "abrir NC", "nonconformities", r.id, null, d); }
  } catch (e) { redirect(go("/governanca/controles", "erro", e instanceof Error ? e.message : "Erro") + "#ncs"); }
  redirect(go("/governanca/controles", "ok", "Não conformidade salva.") + "#ncs");
}

// ---------- Decisões ----------
export async function salvarDecisao(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id"); const b = "/governanca/decisoes";
  try { const cfg = await getSettings(); assert(can.aprovar(s, cfg.alcadas.pops), "Registrar decisões exige: " + cfg.alcadas.pops.join(", ") + ".");
    const d = { data: str(fd, "data") || hoje(), titulo: str(fd, "titulo"), area: str(fd, "area"), unitId: int(fd, "unitId"), contexto: strOrNull(fd, "contexto"), decisao: str(fd, "decisao"), alternativas: strOrNull(fd, "alternativas"), consequencias: strOrNull(fd, "consequencias"), responsavelUserId: int(fd, "responsavelUserId") ?? s.id, revisarEm: strOrNull(fd, "revisarEm"), link: strOrNull(fd, "link") };
    if (!d.titulo || !d.area || !d.decisao) throw new Error("Informe título, área e a decisão.");
    if (id) { await db.update(schema.decisions).set(d).where(eq(schema.decisions.id, id)); await audit(s, "editar decisão", "decisions", id, null, d); } else { const [r] = await db.insert(schema.decisions).values(d).returning({ id: schema.decisions.id }); await audit(s, "registrar decisão", "decisions", r.id, null, d); }
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Decisão registrada."));
}
export async function encerrarDecisao(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const novo = str(fd, "status"); const b = "/governanca/decisoes";
  try { const cfg = await getSettings(); assert(can.aprovar(s, cfg.alcadas.pops)); if (novo !== "REVOGADA" && novo !== "SUBSTITUIDA") throw new Error("Situação inválida.");
    await db.update(schema.decisions).set({ status: novo, substituidaPor: int(fd, "substituidaPor") }).where(eq(schema.decisions.id, id)); await audit(s, novo === "REVOGADA" ? "revogar decisão" : "substituir decisão", "decisions", id, null, { substituidaPor: int(fd, "substituidaPor") }); }
  catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Decisão atualizada."));
}

export async function salvarParamGovernanca(fd: FormData) {
  const s = await requireSession();
  try { assert(can.configurar(s)); const cfg = await getSettings();
    const lista = (k: string, fb: string[]) => { const v = str(fd, k); return v ? v.split("\n").map(x => x.trim()).filter(Boolean) : fb; };
    const novo = { areas: lista("areas", cfg.governanca.areas), motivosExcecao: lista("motivosExcecao", cfg.governanca.motivosExcecao), revisaoPopMeses: int(fd, "revisaoPopMeses") ?? cfg.governanca.revisaoPopMeses, excecaoValidadeDias: int(fd, "excecaoValidadeDias") ?? cfg.governanca.excecaoValidadeDias };
    await sql`INSERT INTO settings (key, value) VALUES ('governanca', ${JSON.stringify(novo)}::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`; await audit(s, "editar", "settings", null, cfg.governanca, novo);
  } catch (e) { redirect(go("/configuracoes", "erro", e instanceof Error ? e.message : "Erro") + "#governanca"); }
  redirect(go("/configuracoes", "ok", "Parâmetros de governança salvos.") + "#governanca");
}
