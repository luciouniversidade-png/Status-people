"use server";
// v34 · Ficha cadastral pelo link (admissão ou recadastramento), sem login. Tudo vira um pedido revisado pelo RH campo a campo.
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { str, getSettings, auditComo } from "@/lib/utils";
import { erroAssinado } from "@/lib/aviso";
import { chaveOrigem, excedeu, registrarEnvio } from "@/lib/limite";
import * as C from "@/lib/cadastro";
import { notificar, usuariosPorPerfil } from "@/lib/comunicacao";

const QUEM = "Ficha de admissão (link)";
const ehRedirect = (e: unknown) => e instanceof Error && (e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT");

export async function enviarFichaAdmissao(fd: FormData) {
  const token = str(fd, "token"); let protocolo = "";
  const chave = await chaveOrigem("admissao");
  try {
    if (excedeu(chave, 10, 3600000)) throw new Error("Muitos envios deste aparelho em pouco tempo. Tente de novo mais tarde.");
    const c = await C.contextoAdmissao(token, false); const cfg = await getSettings();
    if (c.envios >= Number(cfg.cadastro.maxEnviosAdmissao)) throw new Error("Você já enviou a ficha o número máximo de vezes. Fale com o RH do Colégio Status.");
    if (str(fd, "aceite") !== "1") throw new Error("Marque que leu o aviso de privacidade.");
    const campos = await C.lerMudancas(fd, c.employeeId, C.CAMPOS.filter(x => x.admissao));
    const deps = C.lerDependentes(fd);
    const { arquivos } = await C.gravarDocumentos(fd, "doc", Number(cfg.plataforma.anexoMaxMb), C.DOCS_ADMISSAO, { userId: null, nome: QUEM });
    if (!campos.length && !deps.length && !arquivos.length) throw new Error("Preencha os seus dados (ou envie os documentos) antes de enviar.");
    const r = await C.criarPedido({ employeeId: c.employeeId, origem: "ADMISSAO", tipo: "ADMISSAO", campos, dependentes: deps, arquivos, solicitanteUserId: null, inviteId: c.inviteId, quemNome: QUEM, motivo: str(fd, "obs").slice(0, 500) || null });
    protocolo = r.protocolo;
    await sql`UPDATE admission_invites SET envios=envios+1 WHERE id=${c.inviteId}`;
    registrarEnvio(chave, 3600000);
    await notificar(await usuariosPorPerfil(["RH"]), "Ficha cadastral recebida pelo link", "1 ficha nova para revisar.", `/colaboradores/alteracoes/${r.id}`, "ACAO", `adm:${r.id}`);
    await auditComo(QUEM, "ficha cadastral enviada pelo link", "employees", c.employeeId, null, { protocolo, campos: campos.map(x => x.campo), dependentes: deps.length, arquivos: arquivos.length });
  } catch (e) {
    if (ehRedirect(e)) throw e;
    redirect(`/admissao/${encodeURIComponent(token)}?${erroAssinado(e instanceof Error ? e.message : "Não foi possível enviar.")}`);
  }
  redirect(`/admissao/${encodeURIComponent(token)}?ok=1&protocolo=${encodeURIComponent(protocolo)}`);
}
