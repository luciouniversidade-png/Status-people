/** Junta ?ok= / ?erro= ao endereço de volta, antes de uma #âncora que ele já tenha (senão a mensagem vira parte da âncora e não aparece). */
export function comMensagem(b0: string, k: "ok" | "erro", m: string, hash = ""): string {
  const b = /^\/(?![\/\\])/.test(b0) ? b0 : "/"; // v30 · só endereços do próprio sistema (nunca um site de fora)
  const i = b.indexOf("#"); const base = i >= 0 ? b.slice(0, i) : b; const ancora = hash || (i >= 0 ? b.slice(i) : "");
  return `${base}${base.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(m)}${ancora}`;
}
