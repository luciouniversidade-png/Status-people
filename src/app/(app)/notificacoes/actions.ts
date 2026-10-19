"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession } from "@/lib/auth";

/** Marca como lidas todas as notificações de um grupo (só as do próprio usuário). */
export async function lerGrupo(fd: FormData) {
  const s = await requireSession(); const ids = fd.getAll("id").map(Number).filter(Boolean).slice(0, 200);
  if (ids.length) await sql`UPDATE notifications SET lida_em=now() WHERE user_id=${s.id} AND id = ANY(${ids}) AND lida_em IS NULL`;
  redirect("/notificacoes");
}
