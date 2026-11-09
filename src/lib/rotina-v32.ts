// v32 · rotina diária: o ajuste de telas por pessoa que passou da data de fim sai sozinho (fica na trilha de auditoria) e quem
// configura o sistema recebe um aviso só com a quantidade (sem nomes — o aviso aparece na tela de bloqueio do celular).
import { sql } from "@/db";
import { notificar, usuariosPorPerfil } from "./comunicacao";
import { hoje } from "./utils";

export async function rotinaV32(h = hoje()) {
  const r = { ajustesVencidos: 0, falhas: [] as string[] };
  try {
    const xs = await sql<{ id: number; ajuste_telas: unknown }[]>`UPDATE users u SET ajuste_telas=NULL FROM (SELECT id, ajuste_telas FROM users WHERE ajuste_telas IS NOT NULL AND coalesce(ajuste_telas->>'ate', '') <> '' AND ajuste_telas->>'ate' < ${h} FOR UPDATE) v WHERE u.id=v.id RETURNING u.id, v.ajuste_telas`;
    for (const x of xs) await sql`INSERT INTO audit_log (user_id, user_nome, acao, entidade, entidade_id, antes, depois) VALUES (NULL, 'sistema', 'ajuste de telas vencido', 'users', ${x.id}, ${JSON.stringify(x.ajuste_telas)}::jsonb, NULL)`;
    r.ajustesVencidos = xs.length;
    if (xs.length) await notificar(await usuariosPorPerfil(["RH", "DIRECAO"]), `${xs.length} ajuste(s) de telas por pessoa venceram hoje`, "As pessoas voltaram a seguir o cargo nessas telas.", "/configuracoes/acessos?aba=pessoas", "INFO", `ajuste-telas-venc:${h}`);
  } catch (e) { r.falhas.push(`ajustes de telas: ${e instanceof Error ? e.message : String(e)}`); }
  return r;
}
