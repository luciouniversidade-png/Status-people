"use server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireSession, can, assert, assertScope } from "@/lib/auth";
import { audit, str, strOrNull, int } from "@/lib/utils";
import { contextoIA, perguntarIA } from "@/lib/talentos-analytics";

const go = (b: string, k: "ok" | "erro", msg: string) => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}`;
const podeSucessao = (r: string) => ["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(r);

export async function salvarPosicaoCritica(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id"); const b = "/sucessao";
  try { assert(podeSucessao(s.role), "Só RH, Direção e diretores mapeiam posições críticas."); const positionId = int(fd, "positionId"); if (!positionId) throw new Error("Escolha o cargo."); const unitId = int(fd, "unitId"); if (unitId) assertScope(s, unitId);
    const d = { positionId, unitId, titularEmployeeId: int(fd, "titularEmployeeId"), criticidade: int(fd, "criticidade") ?? 2, motivo: strOrNull(fd, "motivo"), riscoSaida: str(fd, "riscoSaida") || "MEDIO", contingencia: strOrNull(fd, "contingencia") };
    if (id) await db.update(schema.criticalPositions).set(d).where(eq(schema.criticalPositions.id, id)); else await db.insert(schema.criticalPositions).values(d);
    await audit(s, id ? "editar posição crítica" : "criar posição crítica", "critical_positions", id, null, d);
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Posição crítica salva."));
}
export async function excluirPosicaoCritica(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id"));
  try { assert(podeSucessao(s.role)); await db.delete(schema.successors).where(eq(schema.successors.criticalPositionId, id)); await db.delete(schema.criticalPositions).where(eq(schema.criticalPositions.id, id)); await audit(s, "excluir posição crítica", "critical_positions", id, null, null); }
  catch (e) { redirect(go("/sucessao", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go("/sucessao", "ok", "Posição removida."));
}
export async function salvarSucessor(fd: FormData) {
  const s = await requireSession(); const cpId = Number(fd.get("criticalPositionId")); const id = int(fd, "id"); const b = "/sucessao";
  try { assert(podeSucessao(s.role)); const employeeId = int(fd, "employeeId"); if (!employeeId && !id) throw new Error("Escolha o sucessor.");
    if (id) await db.update(schema.successors).set({ prontidao: str(fd, "prontidao") || "EM_DESENVOLVIMENTO", plano: strOrNull(fd, "plano"), ativo: str(fd, "ativo") !== "0" }).where(eq(schema.successors.id, id));
    else await db.insert(schema.successors).values({ criticalPositionId: cpId, employeeId: employeeId!, prontidao: str(fd, "prontidao") || "EM_DESENVOLVIMENTO", plano: strOrNull(fd, "plano") });
    await audit(s, "sucessor", "successors", id, null, { cpId, employeeId, prontidao: str(fd, "prontidao") });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Sucessor salvo."));
}
export async function criarTalentReview(fd: FormData) {
  const s = await requireSession(); let id = 0;
  try { assert(can.editar(s), "Só RH e Direção conduzem o talent review."); const nome = str(fd, "nome"); const data = str(fd, "data"); if (!nome || !data) throw new Error("Informe nome e data.");
    const [r] = await db.insert(schema.talentReviews).values({ nome, data, participantes: strOrNull(fd, "participantes") }).returning({ id: schema.talentReviews.id }); id = r.id; await audit(s, "criar talent review", "talent_reviews", id, null, { nome, data });
  } catch (e) { redirect(go("/sucessao", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`/sucessao/review/${id}`, "ok", "Talent review criado. As sugestões vêm do último ciclo de desempenho e dos sinais de risco."));
}
export async function salvarItemReview(fd: FormData) {
  const s = await requireSession(); const reviewId = Number(fd.get("reviewId")); const employeeId = Number(fd.get("employeeId")); const b = `/sucessao/review/${reviewId}`;
  try { assert(can.editar(s));
    const d = { classificacao: str(fd, "classificacao") || "SOLIDO", riscoPerda: str(fd, "riscoPerda") || "MEDIO", impactoPerda: str(fd, "impactoPerda") || "MEDIO", acao: strOrNull(fd, "acao"), responsavelUserId: int(fd, "responsavelUserId"), prazo: strOrNull(fd, "prazo"), status: str(fd, "status") || "PLANEJADA" };
    await sql`INSERT INTO talent_review_items (review_id, employee_id, classificacao, risco_perda, impacto_perda, acao, responsavel_user_id, prazo, status) VALUES (${reviewId}, ${employeeId}, ${d.classificacao}, ${d.riscoPerda}, ${d.impactoPerda}, ${d.acao}, ${d.responsavelUserId}, ${d.prazo}, ${d.status}) ON CONFLICT (review_id, employee_id) DO UPDATE SET classificacao=EXCLUDED.classificacao, risco_perda=EXCLUDED.risco_perda, impacto_perda=EXCLUDED.impacto_perda, acao=EXCLUDED.acao, responsavel_user_id=EXCLUDED.responsavel_user_id, prazo=EXCLUDED.prazo, status=EXCLUDED.status`;
    await audit(s, "talent review item", "talent_review_items", reviewId, null, { employeeId, ...d });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Classificação salva."));
}
export async function encerrarTalentReview(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id"));
  try { assert(can.editar(s)); await db.update(schema.talentReviews).set({ status: "REALIZADO", notas: strOrNull(fd, "notas") }).where(eq(schema.talentReviews.id, id)); await audit(s, "encerrar talent review", "talent_reviews", id, null, null); }
  catch (e) { redirect(go(`/sucessao/review/${id}`, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`/sucessao/review/${id}`, "ok", "Talent review registrado como realizado."));
}

// ---------- People AI ----------
export async function perguntar(fd: FormData) {
  const s = await requireSession(); const pergunta = str(fd, "pergunta"); let id = 0;
  try { assert(can.editar(s) || s.role === "DIRETOR_UNIDADE", "O assistente é para RH, Direção e diretores."); if (!pergunta) throw new Error("Escreva a pergunta.");
    const unitId = s.role === "DIRETOR_UNIDADE" ? s.unitId : int(fd, "unitId");
    const ctx = await contextoIA(unitId ?? null);
    const [log] = await db.insert(schema.aiLog).values({ userId: s.id, userNome: s.nome, pergunta }).returning({ id: schema.aiLog.id }); id = log.id;
    try { const r = await perguntarIA(pergunta, ctx); await db.update(schema.aiLog).set({ resposta: r.resposta, modelo: r.modelo, tokensEntrada: r.tokensEntrada, tokensSaida: r.tokensSaida }).where(eq(schema.aiLog.id, id)); }
    catch (e) { await db.update(schema.aiLog).set({ erro: e instanceof Error ? e.message : "Erro" }).where(eq(schema.aiLog.id, id)); }
    await audit(s, "pergunta ao People AI", "ai_log", id, null, { pergunta: pergunta.slice(0, 200) });
  } catch (e) { redirect(go("/analytics/assistente", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(`/analytics/assistente?resposta=${id}`);
}
