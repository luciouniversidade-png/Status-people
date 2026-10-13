import { createHmac } from "crypto";

/**
 * Mensagens de erro das páginas públicas (sem login): vão na URL com uma assinatura curta. A página só mostra o texto quando a
 * assinatura confere — um link forjado (?erro=Ligue para…) nunca exibe texto de terceiros numa página oficial da escola.
 */
const assinatura = (m: string) => createHmac("sha256", process.env.AUTH_SECRET || "status-one").update("aviso:" + m).digest("base64url").slice(0, 16);
export const erroAssinado = (msg: string) => `erro=${encodeURIComponent(msg)}&as=${assinatura(msg)}`;
/** Texto a exibir: o original quando assinado por nós; um aviso genérico quando não; nada quando não há erro. */
export function textoErro(sp: { erro?: string; as?: string }) {
  if (!sp.erro) return null;
  return sp.as && sp.as === assinatura(sp.erro) ? sp.erro : "Não foi possível concluir. Confira os dados e tente de novo.";
}
