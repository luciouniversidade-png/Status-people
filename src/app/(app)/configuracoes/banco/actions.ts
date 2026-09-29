"use server";
import { redirect } from "next/navigation";
import { requireSession, assert } from "@/lib/auth";
import { audit } from "@/lib/utils";
import { runMigrations, seedBase } from "@/db/setup";

/** Aplica as atualizações do banco pelo próprio sistema (sem URL com token). Seguro repetir: nada é apagado. */
export async function atualizarBanco() {
  const s = await requireSession(); let msg = "";
  try {
    assert(["DIRECAO", "RH"].includes(s.role), "Só Direção ou RH atualizam o banco de dados.");
    const r = await runMigrations(); try { await seedBase(process.env.ADMIN_PASSWORD ?? ""); } catch { /* dados-base são opcionais nesta etapa */ }
    try { await audit(s, "atualizar banco de dados", "settings", null, null, { versao: r.versao, aplicadas: r.aplicadas, falhas: r.falhas.length }); } catch { /* auditoria antiga */ }
    msg = r.falhas.length ? `Atualização aplicada com ${r.falhas.length} pendência(s) — veja a lista abaixo.` : "Banco atualizado. Todas as telas podem ser usadas.";
  } catch (e) { redirect(`/configuracoes/banco?erro=${encodeURIComponent(e instanceof Error ? e.message : "Erro")}`); }
  redirect(`/configuracoes/banco?ok=${encodeURIComponent(msg)}`);
}
