import { createHash } from "crypto";
import { headers } from "next/headers";

/**
 * Limite de envios por origem nos formulários públicos (canal de ética, pedidos LGPD). Só em memória e com a origem embaralhada:
 * nada é gravado no banco — o canal continua anônimo. Com várias instâncias do servidor, cada uma conta a sua parte; o teto global
 * (contagem no banco) completa a proteção contra robôs.
 */
const baldes = new Map<string, number[]>();
export async function chaveOrigem(escopo: string) {
  // primeiro os cabeçalhos que a hospedagem preenche (Vercel, proxies), depois o x-forwarded-for
  const h = await headers(); const ip = h.get("x-vercel-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  return `${escopo}:${createHash("sha256").update(`${process.env.AUTH_SECRET ?? ""}|${ip}`).digest("base64url").slice(0, 16)}`;
}
const vivos = (k: string, janelaMs: number) => (baldes.get(k) ?? []).filter(t => Date.now() - t < janelaMs);
/** Já atingiu o limite nesta janela? (não conta a tentativa — só envios concluídos contam, via registrarEnvio) */
export function excedeu(chave: string, max: number, janelaMs: number) { return vivos(chave, janelaMs).length >= max; }
export function registrarEnvio(chave: string, janelaMs: number) {
  const l = vivos(chave, janelaMs); l.push(Date.now()); baldes.set(chave, l);
  if (baldes.size > 5000) for (const [k] of baldes) if (!vivos(k, janelaMs).length) baldes.delete(k);
}
