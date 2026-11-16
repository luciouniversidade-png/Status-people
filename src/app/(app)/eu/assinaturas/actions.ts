"use server";
// v34 · assinatura no Meu espaço: confirma a identidade (senha e, se ativo, o código 2FA), confere o hash do arquivo e registra as evidências.
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { sql } from "@/db";
import { requireSession, assert } from "@/lib/auth";
import { audit, str, int } from "@/lib/utils";
import { comMensagem } from "@/lib/redirecionar";
import { verificarCodigo } from "@/lib/twofa";
import { excedeu, registrarEnvio } from "@/lib/limite";
import { sha256 } from "@/lib/pdf-v34";
import { origemAssinatura, TIPO_ASSINATURA } from "@/lib/assinaturas";
import { notificar, usuariosPorPerfil } from "@/lib/comunicacao";
import { cpfMascarado } from "@/lib/rematricula";

const go = (b: string, k: "ok" | "erro", m: string) => comMensagem(b, k, m);
const msgErro = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado.");

async function meuPedido(id: number, employeeId: number | null) {
  const [r] = await sql<{ id: number; document_id: number; employee_id: number; status: string; doc_status: string; tipo: string; titulo: string; hash: string; attachment_id: number; competencia: string | null }[]>`
    SELECT r.id, r.document_id, r.employee_id, r.status, d.status AS doc_status, d.tipo, d.titulo, d.hash, d.attachment_id, d.competencia FROM sign_requests r JOIN sign_documents d ON d.id=r.document_id WHERE r.id=${id}`;
  assert(!!r && !!employeeId && r.employee_id === employeeId, "Este documento não é seu.");
  assert(r!.status === "PENDENTE" && r!.doc_status === "ABERTO", r!.status === "ASSINADO" ? "Você já assinou este documento." : "Este documento não está mais aguardando assinatura.");
  return r!;
}

export async function assinarDocumento(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "requestId") ?? 0; const volta = `/eu/assinaturas/${id}`; const chave = `assinar:${s.id}`;
  try {
    const r = await meuPedido(id, s.employeeId);
    assert(str(fd, "li") === "1", "Marque que leu o documento antes de assinar.");
    assert(!excedeu(chave, 5, 15 * 60000), "Muitas tentativas com senha errada. Espere 15 minutos e tente de novo.");
    const [u] = await sql<{ senha_hash: string; totp_ativo: boolean; totp_secret: string | null }[]>`SELECT senha_hash, totp_ativo, totp_secret FROM users WHERE id=${s.id} AND ativo`;
    assert(!!u, "Conta inativa.");
    if (!(await bcrypt.compare(str(fd, "senha"), u!.senha_hash))) { registrarEnvio(chave, 15 * 60000); await audit(s, "senha errada ao assinar", "sign_requests", id, null, null); throw new Error("Senha incorreta. A assinatura confirma que é você: use a mesma senha do login."); }
    let metodo = "SENHA";
    if (u!.totp_ativo && u!.totp_secret) { assert(verificarCodigo(u!.totp_secret, str(fd, "codigo")), "Código da verificação em duas etapas inválido."); metodo = "SENHA+2FA"; }
    const [a] = await sql<{ dados: Buffer }[]>`SELECT dados FROM attachments WHERE id=${r.attachment_id}`;
    const hash = a ? sha256(new Uint8Array(a.dados)) : "";
    if (hash !== r.hash) { await audit(s, "hash divergente ao assinar", "sign_documents", r.document_id, null, { esperado: r.hash.slice(0, 16), calculado: hash.slice(0, 16) }); throw new Error("O arquivo guardado não confere com o enviado para assinatura. Nada foi assinado: avise o RH."); }
    const o = await origemAssinatura();
    const [e] = await sql<{ nome: string; cpf: string | null; cargo: string | null; unidade: string }[]>`SELECT e.nome, e.cpf, p.nome AS cargo, un.nome AS unidade FROM employees e JOIN units un ON un.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id WHERE e.id=${r.employee_id}`;
    const evidencia = { documento: r.titulo, tipo: TIPO_ASSINATURA[r.tipo] ?? r.tipo, hash, usuario: s.email, nome: e?.nome, cpf: cpfMascarado(e?.cpf), cargo: e?.cargo ?? null, unidade: e?.unidade ?? null, metodo, ip: o.ip, dispositivo: o.userAgent, declaracao: "Li o documento e concordo com o conteúdo." };
    const up = await sql`UPDATE sign_requests SET status='ASSINADO', assinado_em=now(), assinado_user_id=${s.id}, metodo=${metodo}, ip=${o.ip}, user_agent=${o.userAgent}, hash_conferido=${hash}, evidencia=${JSON.stringify(evidencia)}::jsonb WHERE id=${id} AND status='PENDENTE'`;
    assert(up.count === 1, "Este documento não está mais aguardando assinatura.");
    if (r.tipo === "TERMO_EPI") await sql`UPDATE epi_deliveries SET termo_assinado=true WHERE sign_request_id=${id}`;
    await sql`UPDATE sign_documents SET status='CONCLUIDO' WHERE id=${r.document_id} AND status='ABERTO' AND NOT EXISTS (SELECT 1 FROM sign_requests x WHERE x.document_id=${r.document_id} AND x.status='PENDENTE')`;
    await audit(s, "assinar documento", "sign_requests", id, null, { documento: r.document_id, metodo });
  } catch (e) { redirect(go(volta, "erro", msgErro(e))); }
  redirect(go("/eu/assinaturas", "ok", "Documento assinado. O comprovante (com data, hora e o hash do arquivo) fica disponível aqui."));
}

/** Recusar (documento) ou contestar (espelho do ponto): sempre com o motivo, que vai para o RH. */
export async function recusarDocumento(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "requestId") ?? 0; const volta = `/eu/assinaturas/${id}`; let espelho = false;
  try {
    const r = await meuPedido(id, s.employeeId); espelho = r.tipo === "ESPELHO";
    const motivo = str(fd, "motivo").slice(0, 1200); assert(motivo.length >= 10, espelho ? "Escreva o que não confere no espelho (dia e horário), com pelo menos 10 caracteres." : "Escreva o motivo da recusa (mínimo 10 caracteres).");
    const o = await origemAssinatura();
    await sql`UPDATE sign_requests SET status=${espelho ? "CONTESTADO" : "RECUSADO"}, recusado_em=now(), motivo=${motivo}, ip=${o.ip}, user_agent=${o.userAgent} WHERE id=${id} AND status='PENDENTE'`;
    await sql`UPDATE sign_documents SET status='CONCLUIDO' WHERE id=${r.document_id} AND status='ABERTO' AND NOT EXISTS (SELECT 1 FROM sign_requests x WHERE x.document_id=${r.document_id} AND x.status='PENDENTE')`;
    await notificar(await usuariosPorPerfil(["RH"]), espelho ? "Espelho do ponto contestado" : "Documento recusado", "1 pessoa respondeu a um documento para assinatura: veja o motivo e responda.", `/documentos/assinaturas/${r.document_id}`, "ACAO");
    await audit(s, espelho ? "contestar espelho do ponto" : "recusar documento", "sign_requests", id, null, { documento: r.document_id });
  } catch (e) { redirect(go(volta, "erro", msgErro(e))); }
  redirect(go("/eu/assinaturas", "ok", espelho ? "Contestação enviada ao RH. Você recebe a resposta aqui no Meu espaço." : "Recusa registrada e enviada ao RH com o seu motivo."));
}
