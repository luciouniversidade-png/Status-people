"use server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { sql } from "@/db";
import { str, strOrNull, hoje, addDays, getSettings, auditComo } from "@/lib/utils";
import { notificar, usuariosPorPerfil } from "@/lib/comunicacao";
import { PEDIDO_TIPO, TITULAR_TIPO, novoProtocolo, novoCodigo, hashCodigo } from "@/lib/privacidade";
import { erroAssinado } from "@/lib/aviso";
import { chaveOrigem, excedeu, registrarEnvio } from "@/lib/limite";

const erroQ = (b: string, e: unknown) => `${b}${b.includes("?") ? "&" : "?"}${erroAssinado(e instanceof Error ? e.message : "Não foi possível enviar. Tente de novo.")}`;
const HORA = 3600000;

/** Pedido do titular pelo portal (sem login): protocolo e código para acompanhar; prazo de resposta conta do recebimento. */
export async function abrirPedidoPublico(fd: FormData) {
  try {
    if (str(fd, "site")) redirect("/privacidade?enviado=1"); // armadilha para robôs
    // contra robôs: até 5 pedidos por hora da mesma origem (só em memória, nada gravado) e teto geral por hora
    const origem = await chaveOrigem("privacidade"); if (excedeu(origem, 5, HORA)) throw new Error("Você já enviou vários pedidos agora. Aguarde um pouco para enviar outro.");
    // teto geral por hora: acima dele o pedido continua entrando (é direito do titular), mas o aviso vira um resumo por hora
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM privacy_requests WHERE canal='PORTAL' AND created_at > now() - interval '1 hour'`; const pico = n >= 40;
    const cfg = await getSettings();
    const tipo = str(fd, "tipo"); if (!PEDIDO_TIPO[tipo]) throw new Error("Escolha o que você deseja.");
    const titular = str(fd, "titularNome").slice(0, 200); if (titular.split(/\s+/).filter(Boolean).length < 2) throw new Error("Informe seu nome completo.");
    const titularTipo = str(fd, "titularTipo"); if (!TITULAR_TIPO[titularTipo]) throw new Error("Informe sua relação com a escola.");
    const email = strOrNull(fd, "email")?.slice(0, 200) ?? null; const tel = strOrNull(fd, "telefone")?.slice(0, 40) ?? null;
    if (!email && !tel) throw new Error("Informe um e-mail ou telefone para a resposta."); if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("E-mail inválido.");
    const descricao = str(fd, "descricao"); if (descricao.length < 10) throw new Error("Conte em poucas palavras o que você precisa.");
    const codigo = novoCodigo(); let protocolo = ""; let id = 0;
    for (let k = 0; k < 3 && !id; k++) { protocolo = await novoProtocolo("LGPD", "privacy_requests", "protocolo");
      const r = await sql<{ id: number }[]>`INSERT INTO privacy_requests (protocolo, codigo_hash, tipo, titular_nome, titular_tipo, aluno_nome, contato_email, contato_telefone, descricao, canal, prazo, historico) VALUES (${protocolo}, ${hashCodigo(codigo)}, ${tipo}, ${titular}, ${titularTipo}, ${strOrNull(fd, "alunoNome")?.slice(0, 200) ?? null}, ${email}, ${tel}, ${descricao.slice(0, 4000)}, 'PORTAL', ${addDays(hoje(), cfg.privacidade.prazoPedidoDias as number)}, ${JSON.stringify([{ em: new Date().toISOString(), por: "Titular (portal)", texto: "Pedido recebido pelo portal de privacidade" }])}::jsonb) ON CONFLICT (protocolo) DO NOTHING RETURNING id`;
      if (r[0]) id = r[0].id; }
    if (!id) throw new Error("Não foi possível registrar agora. Tente de novo em instantes.");
    await auditComo("Titular (portal de privacidade)", "pedido de titular", "privacy_requests", id, null, { protocolo, tipo });
    const quem = [...await usuariosPorPerfil(cfg.privacidade.perfis as string[]), ...(cfg.privacidade.dpoUserId ? [cfg.privacidade.dpoUserId as number] : [])];
    if (!pico) await notificar(quem, `Pedido de titular (LGPD): ${protocolo}`, `${PEDIDO_TIPO[tipo]} — responder até ${addDays(hoje(), cfg.privacidade.prazoPedidoDias as number).split("-").reverse().join("/")}.`, `/governanca/privacidade/pedidos/${id}`, "ACAO", `privped:${id}`);
    else await notificar(quem, "Volume anormal de pedidos de titulares", "Muitos pedidos pelo portal na última hora (possível envio automatizado). Confira a lista.", "/governanca/privacidade", "ALERTA", `privpico:${new Date().toISOString().slice(0, 13)}`);
    registrarEnvio(origem, HORA);
    (await cookies()).set("priv_novo", `${protocolo}|${codigo}`, { httpOnly: true, sameSite: "strict", path: "/privacidade", maxAge: 300 });
  } catch (e) { if (e instanceof Error && (e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e; redirect(erroQ("/privacidade", e)); }
  redirect("/privacidade?enviado=1");
}

/** Acompanhamento: protocolo + código conferidos; libera a consulta por 30 minutos neste navegador. Tentativas erradas são limitadas. */
export async function acompanharPedido(fd: FormData) {
  const protocolo = str(fd, "protocolo").toUpperCase(); let ok = false;
  try {
    const chave = `privacidade:${protocolo}`;
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM login_attempts WHERE email=${chave} AND ok=false AND at > now() - interval '15 minutes'`;
    if (n >= 5) throw new Error("Muitas tentativas. Aguarde 15 minutos.");
    const [p] = await sql<{ id: number; codigo_hash: string | null }[]>`SELECT id, codigo_hash FROM privacy_requests WHERE protocolo=${protocolo}`;
    if (!p || !p.codigo_hash || p.codigo_hash !== hashCodigo(str(fd, "codigo"))) { await sql`INSERT INTO login_attempts (email, ok) VALUES (${chave}, false)`; throw new Error("Protocolo ou código não conferem."); }
    (await cookies()).set(`priv_${p.id}`, p.codigo_hash, { httpOnly: true, sameSite: "lax", path: "/privacidade", maxAge: 1800 }); ok = true;
  } catch (e) { redirect(erroQ("/privacidade/acompanhar", e)); }
  if (ok) redirect(`/privacidade/acompanhar?p=${encodeURIComponent(protocolo)}`);
}

/** "Anotei": tira protocolo e código da tela deste navegador (computador compartilhado). */
export async function limparComprovantePrivacidade() {
  (await cookies()).delete({ name: "priv_novo", path: "/privacidade" });
  redirect("/privacidade");
}
