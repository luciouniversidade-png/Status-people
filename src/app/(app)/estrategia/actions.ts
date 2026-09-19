"use server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireSession, can, assert, assertScope, scopeUnit } from "@/lib/auth";
import { audit, str, strOrNull, int, num, hoje, getSettings } from "@/lib/utils";

const go = (b: string, k: "ok" | "erro", msg: string, hash = "") => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}${hash}`;
const ESTRATEGIA = ["DIRECAO", "RH"]; const GESTAO = ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "FINANCEIRO", "OPERACOES", "COMERCIAL"];

// ---------- OKRs ----------
export async function salvarObjetivo(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id"); let oid = id ?? 0;
  try { assert(ESTRATEGIA.includes(s.role) || (s.role === "DIRETOR_UNIDADE" && (id ? true : !!int(fd, "unitId"))), "Objetivos são definidos pela Direção/RH (diretor: só da própria unidade)."); const titulo = str(fd, "titulo"); if (!titulo) throw new Error("Informe o objetivo."); const cfg = await getSettings(); const unitId = int(fd, "unitId"); if (unitId) assertScope(s, unitId);
    const d = { ciclo: str(fd, "ciclo") || cfg.estrategia.cicloAtual, pilar: strOrNull(fd, "pilar"), titulo, descricao: strOrNull(fd, "descricao"), ownerUserId: int(fd, "ownerUserId") ?? s.id, unitId, status: str(fd, "status") || "ATIVO", ordem: int(fd, "ordem") ?? 0 };
    if (id) await db.update(schema.objectives).set(d).where(eq(schema.objectives.id, id)); else { const [r] = await db.insert(schema.objectives).values(d).returning({ id: schema.objectives.id }); oid = r.id; }
    await audit(s, id ? "editar objetivo" : "criar objetivo", "objectives", oid, null, { titulo, ciclo: d.ciclo, status: d.status });
  } catch (e) { redirect(go(id ? `/estrategia/okrs/${id}` : "/estrategia/okrs", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`/estrategia/okrs/${oid}`, "ok", "Objetivo salvo."));
}
export async function salvarKR(fd: FormData) {
  const s = await requireSession(); const objectiveId = Number(fd.get("objectiveId")); const id = int(fd, "id"); const b = `/estrategia/okrs/${objectiveId}`;
  try { assert(ESTRATEGIA.includes(s.role) || s.role === "DIRETOR_UNIDADE", "Só Direção/RH/diretores definem resultados-chave."); const titulo = str(fd, "titulo"); const meta = num(fd, "valorMeta"); if (!titulo || meta === null) throw new Error("Informe o resultado-chave e a meta.");
    const fonte = str(fd, "fonte") ? `SISTEMA:${str(fd, "fonte")}` : null;
    const d = { objectiveId, titulo, metrica: strOrNull(fd, "metrica"), valorInicial: String(num(fd, "valorInicial") ?? 0), valorMeta: String(meta), valorAtual: fonte ? null : (num(fd, "valorAtual") === null ? null : String(num(fd, "valorAtual"))), direcao: str(fd, "direcao") || "SUBIR", fonte, ownerUserId: int(fd, "ownerUserId"), prazo: strOrNull(fd, "prazo") };
    if (id) await db.update(schema.keyResults).set(d).where(eq(schema.keyResults.id, id)); else await db.insert(schema.keyResults).values(d);
    await audit(s, id ? "editar KR" : "criar KR", "key_results", id, null, { titulo, meta, fonte });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Resultado-chave salvo."));
}
export async function excluirKR(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const objectiveId = Number(fd.get("objectiveId"));
  try { assert(ESTRATEGIA.includes(s.role)); await db.delete(schema.keyResults).where(eq(schema.keyResults.id, id)); await audit(s, "excluir KR", "key_results", id, null, null); }
  catch (e) { redirect(go(`/estrategia/okrs/${objectiveId}`, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`/estrategia/okrs/${objectiveId}`, "ok", "Resultado-chave excluído."));
}
export async function checkinKR(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const objectiveId = Number(fd.get("objectiveId")); const b = str(fd, "voltar") || `/estrategia/okrs/${objectiveId}`;
  try { const [k] = await db.select().from(schema.keyResults).where(eq(schema.keyResults.id, id)); if (!k) throw new Error("KR não encontrado."); assert(GESTAO.includes(s.role) || k.ownerUserId === s.id, "Só o dono do KR ou gestores fazem check-in.");
    const conf = int(fd, "confianca"); const valor = k.fonte ? null : num(fd, "valor"); const comentario = strOrNull(fd, "comentario"); if (!k.fonte && valor === null && !comentario && !conf) throw new Error("Informe o valor atual, a confiança ou um comentário.");
    await db.insert(schema.krCheckins).values({ keyResultId: id, data: str(fd, "data") || hoje(), valor: valor === null ? null : String(valor), confianca: conf, comentario, userId: s.id, userNome: s.nome });
    await db.update(schema.keyResults).set({ ...(valor === null ? {} : { valorAtual: String(valor) }), ...(conf ? { confianca: conf } : {}), atualizadoEm: new Date() }).where(eq(schema.keyResults.id, id));
    await audit(s, "check-in KR", "key_results", id, null, { valor, conf });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Check-in registrado."));
}

// ---------- Projetos ----------
export async function salvarProjeto(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id"); let pid = id ?? 0;
  try { assert(GESTAO.includes(s.role), "Seu perfil não cria projetos."); const nome = str(fd, "nome"); if (!nome) throw new Error("Informe o nome do projeto."); const unitId = int(fd, "unitId") ?? scopeUnit(s); if (unitId) assertScope(s, unitId);
    const d = { nome, descricao: strOrNull(fd, "descricao"), objectiveId: int(fd, "objectiveId"), ownerUserId: int(fd, "ownerUserId") ?? s.id, unitId, status: str(fd, "status") || "PLANEJADO", prioridade: str(fd, "prioridade") || "NORMAL", inicio: strOrNull(fd, "inicio"), fim: strOrNull(fd, "fim"), orcamento: num(fd, "orcamento") === null ? null : String(num(fd, "orcamento")), gasto: num(fd, "gasto") === null ? null : String(num(fd, "gasto")), resultadoEsperado: strOrNull(fd, "resultadoEsperado"), updatedAt: new Date() };
    if (id) await db.update(schema.projects).set(d).where(eq(schema.projects.id, id)); else { const [r] = await db.insert(schema.projects).values(d).returning({ id: schema.projects.id }); pid = r.id; }
    await audit(s, id ? "editar projeto" : "criar projeto", "projects", pid, null, { nome, status: d.status });
  } catch (e) { redirect(go(id ? `/estrategia/projetos/${id}` : "/estrategia/projetos", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`/estrategia/projetos/${pid}`, "ok", "Projeto salvo."));
}
export async function salvarMarco(fd: FormData) {
  const s = await requireSession(); const projectId = Number(fd.get("projectId")); const id = int(fd, "id"); const b = `/estrategia/projetos/${projectId}`;
  try { assert(GESTAO.includes(s.role)); const titulo = str(fd, "titulo"); const prazo = str(fd, "prazo"); if (!titulo || !prazo) throw new Error("Informe o marco e o prazo.");
    if (id) await db.update(schema.milestones).set({ titulo, prazo, responsavelUserId: int(fd, "responsavelUserId") }).where(eq(schema.milestones.id, id)); else await db.insert(schema.milestones).values({ projectId, titulo, prazo, responsavelUserId: int(fd, "responsavelUserId"), ordem: int(fd, "ordem") ?? 0 });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro", "#marcos")); }
  redirect(go(b, "ok", "Marco salvo.", "#marcos"));
}
export async function concluirMarco(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const projectId = Number(fd.get("projectId"));
  try { assert(GESTAO.includes(s.role)); const [m] = await db.select().from(schema.milestones).where(eq(schema.milestones.id, id)); if (!m) throw new Error("Marco não encontrado."); await db.update(schema.milestones).set({ concluidoEm: m.concluidoEm ? null : hoje() }).where(eq(schema.milestones.id, id)); await audit(s, m.concluidoEm ? "reabrir marco" : "concluir marco", "milestones", id, null, { projectId }); }
  catch (e) { redirect(go(`/estrategia/projetos/${projectId}`, "erro", e instanceof Error ? e.message : "Erro", "#marcos")); }
  redirect(go(`/estrategia/projetos/${projectId}`, "ok", "Marco atualizado.", "#marcos"));
}
export async function statusReport(fd: FormData) {
  const s = await requireSession(); const projectId = Number(fd.get("projectId")); const b = `/estrategia/projetos/${projectId}`;
  try { const [p] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)); if (!p) throw new Error("Projeto não encontrado."); assert(GESTAO.includes(s.role) || p.ownerUserId === s.id, "Só o dono do projeto ou gestores atualizam."); const saude = str(fd, "saude") || "VERDE"; if (!["VERDE", "AMARELO", "VERMELHO"].includes(saude)) throw new Error("Saúde inválida.");
    await db.insert(schema.projectUpdates).values({ projectId, data: str(fd, "data") || hoje(), saude, feito: strOrNull(fd, "feito"), proximo: strOrNull(fd, "proximo"), riscos: strOrNull(fd, "riscos"), userId: s.id, userNome: s.nome });
    const upd: Partial<typeof schema.projects.$inferInsert> = { saude, updatedAt: new Date() }; const g = num(fd, "gasto"); if (g !== null) upd.gasto = String(g); const st = strOrNull(fd, "status"); if (st && st !== p.status) upd.status = st;
    await db.update(schema.projects).set(upd).where(eq(schema.projects.id, projectId)); await audit(s, "status report", "projects", projectId, { saude: p.saude }, { saude, status: st ?? p.status });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Status report registrado."));
}
export async function salvarRisco(fd: FormData) {
  const s = await requireSession(); const projectId = Number(fd.get("projectId")); const id = int(fd, "id"); const b = `/estrategia/projetos/${projectId}`;
  try { assert(GESTAO.includes(s.role)); const descricao = str(fd, "descricao"); if (!descricao && !id) throw new Error("Descreva o risco.");
    const d = { descricao: descricao || undefined, probabilidade: int(fd, "probabilidade") ?? 2, impacto: int(fd, "impacto") ?? 2, mitigacao: strOrNull(fd, "mitigacao"), status: str(fd, "status") || "ABERTO" };
    if (id) await db.update(schema.projectRisks).set(d).where(eq(schema.projectRisks.id, id)); else await db.insert(schema.projectRisks).values({ projectId, ...d, descricao });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro", "#riscos")); }
  redirect(go(b, "ok", "Risco salvo.", "#riscos"));
}
void sql;
