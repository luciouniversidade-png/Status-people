"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert } from "@/lib/auth";
import { audit, str } from "@/lib/utils";
import { GOLIVE } from "@/lib/arquitetura";

/** Item do checklist de go-live (Ap. F): marcar feito exige evidência (link, ata, relatório); só Direção e RH. */
export async function marcarGoLive(fd: FormData) {
  const chave = str(fd, "chave"); let txt = "";
  try {
    const s = await requireSession(); assert(["DIRECAO", "RH"].includes(s.role), "O checklist de go-live é conduzido pela Direção e pelo RH.");
    assert(GOLIVE.some(g => g[0] === chave), "Item desconhecido."); const feito = str(fd, "feito") === "1"; const evidencia = str(fd, "evidencia"); const responsavel = str(fd, "responsavel");
    assert(!feito || evidencia.length >= 5, "Marcar como feito exige a evidência (link, ata ou relatório).");
    if (chave === "f1-gonogo" && feito) assert(s.role === "DIRECAO", "O GO/NO-GO formal é da Direção (decisão nº 8).");
    await sql`INSERT INTO golive_items (chave, feito, evidencia, responsavel, user_id, user_nome, updated_at) VALUES (${chave}, ${feito}, ${evidencia || null}, ${responsavel || null}, ${s.id}, ${s.nome}, now())
      ON CONFLICT (chave) DO UPDATE SET feito=EXCLUDED.feito, evidencia=coalesce(EXCLUDED.evidencia, golive_items.evidencia), responsavel=coalesce(EXCLUDED.responsavel, golive_items.responsavel), user_id=EXCLUDED.user_id, user_nome=EXCLUDED.user_nome, updated_at=now()`;
    await audit(s, feito ? "go-live: item concluído" : "go-live: item reaberto", "golive_items", null, null, { chave, evidencia: evidencia || null });
    txt = feito ? "Item marcado com evidência." : "Item reaberto.";
  } catch (e) { redirect(`/arquitetura?aba=golive&erro=${encodeURIComponent(e instanceof Error ? e.message : "Erro")}#${chave}`); }
  redirect(`/arquitetura?aba=golive&ok=${encodeURIComponent(txt)}#${chave}`);
}
