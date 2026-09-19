"use server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession, can, assert } from "@/lib/auth";
import { audit, str, strOrNull, int, hoje, getSettings } from "@/lib/utils";

const go = (k: "ok" | "erro", msg: string) => `/command-center?${k}=${encodeURIComponent(msg)}#decisoes`;

export async function salvarPendencia(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id");
  try { assert(can.editar(s), "Só Direção e RH mantêm a lista de decisões."); const titulo = str(fd, "titulo"); if (!titulo) throw new Error("Informe o título.");
    const d = { titulo, area: strOrNull(fd, "area"), descricao: strOrNull(fd, "descricao"), prazo: strOrNull(fd, "prazo"), responsavelUserId: int(fd, "responsavelUserId") };
    if (id) await db.update(schema.execPending).set(d).where(eq(schema.execPending.id, id)); else await db.insert(schema.execPending).values(d);
    await audit(s, id ? "editar decisão pendente" : "criar decisão pendente", "exec_pending", id, null, d);
  } catch (e) { redirect(go("erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go("ok", "Decisão pendente salva."));
}

/** Marca como decidida e, se pedido, registra no Decision Log com o texto da decisão. */
export async function decidirPendencia(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const novo = str(fd, "status");
  try { const cfg = await getSettings(); assert(can.aprovar(s, cfg.alcadas.pops), "Registrar decisões exige: " + cfg.alcadas.pops.join(", "));
    const [p] = await db.select().from(schema.execPending).where(eq(schema.execPending.id, id)); if (!p) throw new Error("Pendência não encontrada.");
    let decisionId: number | null = p.decisionId;
    if (novo === "DECIDIDA") { const texto = str(fd, "decisao"); if (!texto) throw new Error("Escreva a decisão tomada.");
      const [d] = await db.insert(schema.decisions).values({ data: hoje(), titulo: p.titulo, area: p.area ?? "Direção e Governança", contexto: p.descricao, decisao: texto, responsavelUserId: s.id, revisarEm: strOrNull(fd, "revisarEm") }).returning({ id: schema.decisions.id }); decisionId = d.id; }
    else if (novo !== "ADIADA" && novo !== "ABERTA") throw new Error("Situação inválida.");
    await db.update(schema.execPending).set({ status: novo, decisionId, prazo: strOrNull(fd, "prazo") ?? p.prazo }).where(eq(schema.execPending.id, id));
    await audit(s, novo === "DECIDIDA" ? "decidir pendência" : "adiar pendência", "exec_pending", id, { status: p.status }, { status: novo, decisionId });
  } catch (e) { redirect(go("erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go("ok", novo === "DECIDIDA" ? "Decisão registrada no Decision Log." : "Pendência atualizada."));
}
