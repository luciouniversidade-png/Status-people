"use server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { sql } from "@/db";
import { str, strOrNull, int, hoje, addDays, getSettings, auditComo } from "@/lib/utils";
import { notificar } from "@/lib/comunicacao";
import { novoCodigo } from "@/lib/privacidade";
import { CATEGORIA_ETICA, RELACAO_ETICA, novoProtocoloEtica, hashCodigo, candidatosEtica, impedidosAutomaticos, impedidosDoRelato, responsaveisRelato } from "@/lib/etica";
import { erroAssinado } from "@/lib/aviso";
import { chaveOrigem, excedeu, registrarEnvio } from "@/lib/limite";

const erroQ = (b: string, e: unknown) => `${b}${b.includes("?") ? "&" : "?"}${erroAssinado(e instanceof Error ? e.message : "Não foi possível enviar. Tente de novo.")}`;
const HORA = 3600000;
const ehRedirect = (e: unknown) => e instanceof Error && (e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT");

/** Relato pelo canal (sem login, sem IP): protocolo + código para acompanhar; comitê avisado sem o conteúdo; quem é citado fica impedido. */
export async function enviarRelato(fd: FormData) {
  try {
    if (str(fd, "site")) redirect("/etica?enviado=1");
    // contra robôs, sem identificar ninguém: até 5 relatos por hora da mesma origem (só em memória) e teto geral por hora
    const origem = await chaveOrigem("etica"); if (excedeu(origem, 5, HORA)) throw new Error("Você já enviou vários relatos agora. Aguarde um pouco para enviar outro.");
    // teto geral por hora: acima dele o relato continua entrando (nunca se bloqueia quem precisa relatar), mas o aviso vira um resumo por hora
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ethics_reports WHERE created_at > now() - interval '1 hour'`; const pico = n >= 40;
    const cfg = await getSettings();
    const categoria = str(fd, "categoria"); if (!CATEGORIA_ETICA[categoria]) throw new Error("Escolha o tipo de conduta.");
    const relato = str(fd, "relato"); if (relato.length < 30) throw new Error("Descreva o que aconteceu (pelo menos algumas linhas): o quê, quando, onde.");
    const identificar = str(fd, "identificar") === "1"; const nome = strOrNull(fd, "nome"); const contato = strOrNull(fd, "contato");
    if (identificar && (!nome || !contato)) throw new Error("Para se identificar, informe nome e um contato. Ou deixe anônimo.");
    const relacao = str(fd, "relacao"); const unitId = int(fd, "unitId");
    if (unitId) { const [u] = await sql`SELECT 1 FROM units WHERE id=${unitId}`; if (!u) throw new Error("Unidade inválida."); }
    const envolvidos = strOrNull(fd, "envolvidos")?.slice(0, 1000) ?? null;
    // impedidos: citados entre todos os que poderiam tratar o relato (comitê, Direção, RH); o cálculo se repete a cada acesso
    const impedidos = impedidosAutomaticos(await candidatosEtica(), envolvidos, relato);
    const codigo = novoCodigo(); let protocolo = ""; let id = 0;
    for (let k = 0; k < 5 && !id; k++) { protocolo = novoProtocoloEtica();
      const r = await sql<{ id: number }[]>`INSERT INTO ethics_reports (protocolo, codigo_hash, categoria, relato, envolvidos, local, quando, testemunhas, unit_id, relacao, anonimo, contato, prazo_triagem, prazo_conclusao, impedidos)
        VALUES (${protocolo}, ${hashCodigo(codigo)}, ${categoria}, ${relato.slice(0, 10000)}, ${envolvidos}, ${strOrNull(fd, "local")?.slice(0, 300) ?? null}, ${strOrNull(fd, "quando")?.slice(0, 200) ?? null}, ${strOrNull(fd, "testemunhas")?.slice(0, 1000) ?? null}, ${unitId}, ${RELACAO_ETICA[relacao] ? relacao : "NAO_INFORMADO"}, ${!identificar}, ${identificar ? JSON.stringify({ nome: nome!.slice(0, 200), contato: contato!.slice(0, 200) }) : null}::jsonb, ${addDays(hoje(), cfg.etica.prazoTriagemDias as number)}, ${addDays(hoje(), cfg.etica.prazoConclusaoDias as number)}, ${JSON.stringify(impedidos)}::jsonb) ON CONFLICT (protocolo) DO NOTHING RETURNING id`;
      if (r[0]) id = r[0].id; }
    if (!id) throw new Error("Não foi possível registrar agora. Tente de novo.");
    await auditComo("Canal de ética", "relato recebido", "ethics_reports", id);
    const resp = await responsaveisRelato(impedidos);
    if (!pico) await notificar(resp.map(m => m.id), "Novo relato no canal de ética", `Protocolo ${protocolo}. Triagem até ${addDays(hoje(), cfg.etica.prazoTriagemDias as number).split("-").reverse().join("/")}.`, `/governanca/etica/${id}`, "ALERTA", `etica:${id}`);
    else await notificar(resp.map(m => m.id), "Volume anormal de relatos no canal de ética", "Muitos relatos na última hora (possível envio automatizado). Confira a lista e arquive o que for indevido.", "/governanca/etica", "ALERTA", `etipico:${new Date().toISOString().slice(0, 13)}`);
    registrarEnvio(origem, HORA);
    // protocolo e código aparecem uma vez nesta tela (por poucos minutos ou até a pessoa clicar em "Anotei")
    (await cookies()).set("etica_novo", `${protocolo}|${codigo}`, { httpOnly: true, sameSite: "strict", path: "/etica", maxAge: 300 });
  } catch (e) { if (ehRedirect(e)) throw e; redirect(erroQ("/etica", e)); }
  redirect("/etica?enviado=1");
}

export async function acompanharRelato(fd: FormData) {
  const protocolo = str(fd, "protocolo").toUpperCase(); let ok = false;
  try {
    const chave = `etica:${protocolo}`;
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM login_attempts WHERE email=${chave} AND ok=false AND at > now() - interval '15 minutes'`;
    if (n >= 5) throw new Error("Muitas tentativas. Aguarde 15 minutos.");
    const [r] = await sql<{ id: number; codigo_hash: string }[]>`SELECT id, codigo_hash FROM ethics_reports WHERE protocolo=${protocolo}`;
    if (!r || r.codigo_hash !== hashCodigo(str(fd, "codigo"))) { await sql`INSERT INTO login_attempts (email, ok) VALUES (${chave}, false)`; throw new Error("Protocolo ou código não conferem."); }
    (await cookies()).set(`etica_${r.id}`, r.codigo_hash, { httpOnly: true, sameSite: "lax", path: "/etica", maxAge: 1800 }); ok = true;
  } catch (e) { redirect(erroQ("/etica/acompanhar", e)); }
  if (ok) redirect(`/etica/acompanhar?p=${encodeURIComponent(protocolo)}`);
}

/** Mensagem de quem relatou (complemento, resposta a pergunta do comitê), sem identificar. */
export async function mensagemDenunciante(fd: FormData) {
  const protocolo = str(fd, "protocolo"); const b = `/etica/acompanhar?p=${encodeURIComponent(protocolo)}`;
  try {
    const [r] = await sql<{ id: number; codigo_hash: string; status: string; responsavel_user_id: number | null; impedidos: number[] | null; liberados: number[] | null; envolvidos: string | null; relato: string }[]>`SELECT id, codigo_hash, status, responsavel_user_id, impedidos, liberados, envolvidos, relato FROM ethics_reports WHERE protocolo=${protocolo}`;
    if (!r || (await cookies()).get(`etica_${r.id}`)?.value !== r.codigo_hash) throw new Error("Sessão expirada: informe o protocolo e o código de novo.");
    if (!["RECEBIDA", "EM_APURACAO"].includes(r.status)) throw new Error("Este relato já foi encerrado.");
    const texto = str(fd, "texto"); if (texto.length < 3) throw new Error("Escreva a mensagem.");
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ethics_messages WHERE report_id=${r.id} AND autor='DENUNCIANTE' AND created_at > now() - interval '1 hour'`;
    if (n >= 10) throw new Error("Você já mandou várias mensagens na última hora. Aguarde um pouco: o comitê já foi avisado.");
    await sql`INSERT INTO ethics_messages (report_id, autor, texto) VALUES (${r.id}, 'DENUNCIANTE', ${texto.slice(0, 5000)})`; await sql`UPDATE ethics_reports SET updated_at=now() WHERE id=${r.id}`;
    const imp = await impedidosDoRelato(r); const elegiveis = (await responsaveisRelato(imp)).map(m => m.id);
    const dest = r.responsavel_user_id && elegiveis.includes(r.responsavel_user_id) ? [r.responsavel_user_id] : elegiveis;
    // um aviso por hora e por relato (muitas mensagens seguidas não disparam muitas notificações no celular)
    await notificar(dest, "Nova mensagem no canal de ética", `Protocolo ${protocolo}.`, `/governanca/etica/${r.id}`, "ACAO", `etimsg:${r.id}:${new Date().toISOString().slice(0, 13)}`);
  } catch (e) { redirect(erroQ(b, e)); }
  redirect(`${b}&ok=1`);
}

/** "Anotei": tira protocolo e código da tela deste navegador (computador compartilhado). */
export async function limparComprovanteEtica() {
  (await cookies()).delete({ name: "etica_novo", path: "/etica" });
  redirect("/etica");
}
