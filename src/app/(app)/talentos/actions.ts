"use server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireSession, can, assert, assertScope, scopeUnit } from "@/lib/auth";
import { audit, str, strOrNull, int, hoje } from "@/lib/utils";
import { contextoIA, perguntarIA } from "@/lib/talentos-analytics";

const go = (b: string, k: "ok" | "erro", msg: string, hash = "") => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}${hash}`;
const DIRECAO = ["RH", "DIRECAO", "DIRETOR_UNIDADE"];

export async function salvarPosicaoCritica(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id"); const b = "/sucessao";
  try { assert(DIRECAO.includes(s.role), "Só RH, Direção e diretores mapeiam posições críticas."); const positionId = int(fd, "positionId"); if (!positionId) throw new Error("Escolha o cargo."); const unitId = int(fd, "unitId"); if (unitId) assertScope(s, unitId);
    const d = { positionId, unitId, titularEmployeeId: int(fd, "titularEmployeeId"), criticidade: int(fd, "criticidade") ?? 2, motivo: strOrNull(fd, "motivo"), riscoSaida: str(fd, "riscoSaida") || "MEDIO", contingencia: strOrNull(fd, "contingencia") };
    if (id) { await db.update(schema.criticalPositions).set(d).where(eq(schema.criticalPositions.id, id)); } else { const [r] = await db.insert(schema.criticalPositions).values(d).returning({ id: schema.criticalPositions.id }); await audit(s, "posição crítica", "critical_positions", r.id, null, d); }
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Posição crítica salva."));
}
export async function excluirPosicaoCritica(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const b = "/sucessao";
  try { assert(DIRECAO.includes(s.role)); await db.delete(schema.successors).where(eq(schema.successors.criticalPositionId, id)); await db.delete(schema.criticalPositions).where(eq(schema.criticalPositions.id, id)); await audit(s, "excluir posição crítica", "critical_positions", id, null, null); }
  catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Posição removida."));
}
export async function salvarSucessor(fd: FormData) {
  const s = await requireSession(); const cpId = Number(fd.get("criticalPositionId")); const b = "/sucessao";
  try { assert(DIRECAO.includes(s.role)); const employeeId = int(fd, "employeeId"); if (!employeeId) throw new Error("Escolha o sucessor."); const prontidao = str(fd, "prontidao") || "EM_DESENVOLVIMENTO";
    const [dup] = await sql<{ id: number }[]>`SELECT id FROM successors WHERE critical_position_id=${cpId} AND employee_id=${employeeId} AND ativo`; if (dup) throw new Error("Já é sucessor desta posição.");
    const [r] = await db.insert(schema.successors).values({ criticalPositionId: cpId, employeeId, prontidao, plano: strOrNull(fd, "plano") }).returning({ id: schema.successors.id }); await audit(s, "sucessor", "successors", r.id, null, { cpId, employeeId, prontidao });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Sucessor registrado."));
}
export async function removerSucessor(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const b = "/sucessao";
  try { assert(DIRECAO.includes(s.role)); await db.update(schema.successors).set({ ativo: false }).where(eq(schema.successors.id, id)); await audit(s, "remover sucessor", "successors", id, null, null); }
  catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Sucessor removido."));
}
export async function criarTalentReview(fd: FormData) {
  const s = await requireSession(); let id = 0;
  try { assert(can.editar(s), "Só RH e Direção criam o talent review."); const nome = str(fd, "nome"); if (!nome) throw new Error("Informe o nome."); const [r] = await db.insert(schema.talentReviews).values({ nome, data: str(fd, "data") || hoje(), participantes: strOrNull(fd, "participantes") }).returning({ id: schema.talentReviews.id }); id = r.id; await audit(s, "criar talent review", "talent_reviews", id, null, { nome }); }
  catch (e) { redirect(go("/sucessao", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`/sucessao/talent-review/${id}`, "ok", "Talent review criado. Classifique as pessoas e registre as ações de retenção."));
}
export async function salvarItemReview(fd: FormData) {
  const s = await requireSession(); const reviewId = Number(fd.get("reviewId")); const employeeId = Number(fd.get("employeeId")); const b = `/sucessao/talent-review/${reviewId}`;
  try { assert(can.editar(s));
    await sql`INSERT INTO talent_review_items (review_id, employee_id, classificacao, risco_perda, impacto_perda, acao, responsavel_user_id, prazo, status) VALUES (${reviewId}, ${employeeId}, ${str(fd, "classificacao") || "SOLIDO"}, ${str(fd, "riscoPerda") || "MEDIO"}, ${str(fd, "impactoPerda") || "MEDIO"}, ${strOrNull(fd, "acao")}, ${int(fd, "responsavelUserId") ?? s.id}, ${strOrNull(fd, "prazo")}, ${str(fd, "status") || "PLANEJADA"})
      ON CONFLICT (review_id, employee_id) DO UPDATE SET classificacao=EXCLUDED.classificacao, risco_perda=EXCLUDED.risco_perda, impacto_perda=EXCLUDED.impacto_perda, acao=EXCLUDED.acao, responsavel_user_id=EXCLUDED.responsavel_user_id, prazo=EXCLUDED.prazo, status=EXCLUDED.status`;
    await audit(s, "talent review item", "talent_review_items", reviewId, null, { employeeId, classificacao: str(fd, "classificacao") });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(b);
}
export async function concluirReview(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const b = `/sucessao/talent-review/${id}`;
  try { assert(can.editar(s)); await db.update(schema.talentReviews).set({ status: "REALIZADO", notas: strOrNull(fd, "notas") }).where(eq(schema.talentReviews.id, id)); await audit(s, "concluir talent review", "talent_reviews", id, null, null); }
  catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Talent review concluído."));
}

export async function perguntar(fd: FormData) {
  const s = await requireSession(); const pergunta = str(fd, "pergunta"); const b = "/analytics/assistente";
  try { assert(["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role), "O assistente é para RH, Direção e diretores."); if (!pergunta) throw new Error("Escreva a pergunta.");
    const ctx = await contextoIA(scopeUnit(s));
    try { const r = await perguntarIA(pergunta, ctx); await db.insert(schema.aiLog).values({ userId: s.id, userNome: s.nome, pergunta, resposta: r.resposta, modelo: r.modelo, tokensEntrada: r.tokensEntrada, tokensSaida: r.tokensSaida }); }
    catch (e) { await db.insert(schema.aiLog).values({ userId: s.id, userNome: s.nome, pergunta, erro: e instanceof Error ? e.message : "Erro" }); throw e; }
    await audit(s, "pergunta ao People AI", "ai_log", null, null, { pergunta: pergunta.slice(0, 120) });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(b);
}

export async function salvarParamAnalytics(fd: FormData) {
  const s = await requireSession();
  try { assert(can.configurar(s)); const { getSettings } = await import("@/lib/utils"); const cfg = await getSettings();
    const pesos = Object.fromEntries(Object.keys(cfg.analytics.pesos).map(k => [k, int(fd, `peso_${k}`) ?? (cfg.analytics.pesos as Record<string, number>)[k]]));
    const metas = Object.fromEntries(Object.keys(cfg.analytics.metas).map(k => { const v = fd.get(`meta_${k}`); return [k, v === null || v === "" ? (cfg.analytics.metas as Record<string, number>)[k] : Number(v)]; }));
    const novo = { pesos, metas, custoReposicaoSalarios: Number(fd.get("custoReposicaoSalarios") ?? cfg.analytics.custoReposicaoSalarios) };
    await sql`INSERT INTO settings (key, value) VALUES ('analytics', ${JSON.stringify(novo)}::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`; await audit(s, "editar", "settings", null, cfg.analytics, novo);
  } catch (e) { redirect(go("/configuracoes", "erro", e instanceof Error ? e.message : "Erro", "#analytics")); }
  redirect(go("/configuracoes", "ok", "Pesos e metas salvos.", "#analytics"));
}
