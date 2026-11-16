"use server";
// v34 · reações nos comunicados (marca e desmarca). Sem notificação: reação não é ciência.
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession } from "@/lib/auth";
import { str, int } from "@/lib/utils";

const EMOJIS = ["👍", "❤️", "👏", "🎉", "😮"];
export async function reagirComunicado(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const emoji = str(fd, "emoji");
  if (id > 0 && EMOJIS.includes(emoji)) {
    const [a] = await sql<{ ok: boolean }[]>`SELECT (status='PUBLICADO') AS ok FROM announcements WHERE id=${id}`;
    if (a?.ok) { const r = await sql`DELETE FROM announcement_reactions WHERE announcement_id=${id} AND user_id=${s.id} AND emoji=${emoji}`; if (r.count === 0) await sql`INSERT INTO announcement_reactions (announcement_id, user_id, emoji) VALUES (${id}, ${s.id}, ${emoji}) ON CONFLICT DO NOTHING`; }
  }
  redirect(`/comunicacao/comunicados#c${id}`);
}
