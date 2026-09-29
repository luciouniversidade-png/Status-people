"use server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession, assert } from "@/lib/auth";
import { audit, str, strOrNull, int, hoje } from "@/lib/utils";
import { notificar } from "@/lib/comunicacao";
import { NIVEIS_IA } from "@/lib/governanca";

const go = (k: "ok" | "erro", m: string) => `/governanca/agentes?${k}=${encodeURIComponent(m)}`;

export async function salvarAgente(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id"); let msg = "";
  try { assert(["DIRECAO", "RH"].includes(s.role), "Inventário de agentes é mantido pela Direção/RH (AI Owner).");
    const nivel = str(fd, "nivel") || "N1"; if (!NIVEIS_IA[nivel]) throw new Error("Nível inválido.");
    const d = { nome: str(fd, "nome"), funcao: str(fd, "funcao"), area: strOrNull(fd, "area"), unitId: int(fd, "unitId"), positionId: int(fd, "positionId"), donoUserId: int(fd, "donoUserId"), nivel, ferramenta: strOrNull(fd, "ferramenta"), dados: strOrNull(fd, "dados"), limites: strOrNull(fd, "limites"), revisaoHumana: strOrNull(fd, "revisaoHumana"), revisaoEm: strOrNull(fd, "revisaoEm"), updatedAt: new Date() };
    if (!d.nome || !d.funcao) throw new Error("Informe nome e função do agente.");
    if (!d.donoUserId) throw new Error("Todo agente precisa de um dono humano responsável.");
    if (!d.limites) throw new Error("Descreva os limites: o que o agente não pode fazer.");
    if (["N2", "N3"].includes(nivel) && !d.revisaoHumana) throw new Error("Níveis N2 e N3 exigem descrever a revisão humana (quem aprova, com que frequência).");
    if (str(fd, "dadosSensiveis") === "1" && ["N2", "N3"].includes(nivel)) throw new Error("Agentes com acesso a dados de estudantes, saúde ou documentos pessoais ficam em N0 ou N1.");
    if (!d.revisaoEm) d.revisaoEm = new Date(Date.parse(hoje()) + 90 * 86400000).toISOString().slice(0, 10);
    if (id) { await db.update(schema.aiAgents).set(d).where(eq(schema.aiAgents.id, id)); await audit(s, "editar agente de IA", "ai_agents", id, null, { nivel }); msg = "Agente atualizado."; }
    else { const [a] = await db.insert(schema.aiAgents).values({ ...d, createdBy: s.id }).returning({ id: schema.aiAgents.id }); await audit(s, "cadastrar agente de IA", "ai_agents", a.id, null, { nivel }); await notificar([d.donoUserId], `Você é o dono do agente de IA “${d.nome}”`, "Revise escopo, limites e a data de revisão.", "/governanca/agentes", "ACAO", `agente:${a.id}`); msg = "Agente cadastrado em piloto."; }
  } catch (e) { redirect(go("erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go("ok", msg));
}
export async function statusAgente(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const st = str(fd, "status");
  try { assert(["DIRECAO", "RH"].includes(s.role)); if (!["PILOTO", "ATIVO", "PAUSADO", "DESATIVADO"].includes(st)) throw new Error("Situação inválida."); const j = strOrNull(fd, "justificativa"); if (["PAUSADO", "DESATIVADO"].includes(st) && !j) throw new Error("Pausar ou desativar exige justificativa.");
    const [a] = await db.select().from(schema.aiAgents).where(eq(schema.aiAgents.id, id)); if (!a) throw new Error("Agente não encontrado.");
    await db.update(schema.aiAgents).set({ status: st, updatedAt: new Date(), ...(st === "ATIVO" ? { revisaoEm: new Date(Date.parse(hoje()) + 90 * 86400000).toISOString().slice(0, 10) } : {}) }).where(eq(schema.aiAgents.id, id)); await audit(s, "situação de agente de IA", "ai_agents", id, { status: a.status }, { status: st, justificativa: j });
  } catch (e) { redirect(go("erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go("ok", "Situação atualizada."));
}
