// v32 · pendências: ajuste de telas por pessoa que vence em até 7 dias (RH e Direção decidem: renovar a data ou deixar vencer).
import { sql } from "@/db";
import { can, type Session } from "./auth";
import { hoje, addDays } from "./utils";
import type { Pendencia } from "./pendencias";

export async function pendenciasV32(s: Session): Promise<{ itens: Pendencia[]; falhas: string[] }> {
  const itens: Pendencia[] = []; const falhas: string[] = [];
  if (!can.configurar(s)) return { itens, falhas };
  try {
    const h = hoje(); const r = await sql<{ id: number; nome: string; ate: string; mais: number; menos: number }[]>`SELECT id, nome, ajuste_telas->>'ate' AS ate, jsonb_array_length(coalesce(ajuste_telas->'mais', '[]'::jsonb))::int AS mais, jsonb_array_length(coalesce(ajuste_telas->'menos', '[]'::jsonb))::int AS menos
      FROM users WHERE ativo AND ajuste_telas IS NOT NULL AND coalesce(ajuste_telas->>'ate', '') <> '' AND ajuste_telas->>'ate' >= ${h} AND ajuste_telas->>'ate' <= ${addDays(h, 7)} ORDER BY ajuste_telas->>'ate', nome LIMIT 50`;
    for (const x of r) itens.push({ chave: `ajuste-telas${x.id}`, grupo: "GESTAO", modulo: "Acesso", acao: "Renovar ou deixar vencer", titulo: `Telas de ${x.nome} (+${x.mais} −${x.menos})`, sub: "ajuste individual sobre o cargo — no fim do prazo a pessoa volta a seguir o cargo", href: `/configuracoes/acessos/usuario/${x.id}#telas`, prazo: x.ate });
  } catch (e) { falhas.push(`ajustes de telas: ${e instanceof Error ? e.message : String(e)}`); }
  return { itens, falhas };
}
