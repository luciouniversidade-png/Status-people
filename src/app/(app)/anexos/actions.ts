"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, assertScope } from "@/lib/auth";
import { audit, str, strOrNull, int, getSettings } from "@/lib/utils";
import { unidadeDoRegistro } from "@/lib/anexos";

const go = (b: string, k: "ok" | "erro", msg: string) => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}`;
export async function enviarAnexo(fd: FormData) {
  const s = await requireSession(); const entidade = str(fd, "entidade"); const id = int(fd, "entidadeId") ?? 0; const voltar = str(fd, "voltar") || "/";
  try { assert(s.role !== "LEITURA", "Perfil somente leitura não anexa arquivos."); const cfg = await getSettings(); const arq = fd.get("arquivo"); if (!arq || typeof arq !== "object" || !("arrayBuffer" in arq) || (arq as File).size === 0) throw new Error("Escolha um arquivo.");
    const f = arq as File; if (f.size > cfg.plataforma.anexoMaxMb * 1048576) throw new Error(`Arquivo acima de ${cfg.plataforma.anexoMaxMb} MB.`); const mime = f.type || "application/octet-stream"; if (!cfg.plataforma.anexoTipos.includes(mime)) throw new Error(`Tipo não permitido (${mime}). Use PDF, imagem, Word, Excel ou texto.`);
    const unitId = await unidadeDoRegistro(entidade, id); if (unitId) assertScope(s, unitId); if (s.role === "COLABORADOR" && !(entidade === "employee" && id === s.employeeId) && !(entidade === "work_order")) throw new Error("Você só anexa na sua própria ficha ou nos seus chamados.");
    const dados = Buffer.from(await f.arrayBuffer()); const nome = f.name.replace(/[^\w.\-() áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ]/g, "_").slice(0, 120);
    const [r] = await sql<{ id: number }[]>`INSERT INTO attachments (entidade, entidade_id, nome, mime, tamanho, dados, descricao, unit_id, user_id, user_nome) VALUES (${entidade}, ${id}, ${nome}, ${mime}, ${f.size}, ${dados}, ${strOrNull(fd, "descricao")}, ${unitId}, ${s.id}, ${s.nome}) RETURNING id`;
    await audit(s, "anexar arquivo", "attachments", r.id, null, { entidade, id, nome, tamanho: f.size });
  } catch (e) { redirect(go(voltar, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(voltar, "ok", "Arquivo anexado."));
}
export async function removerAnexo(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const voltar = str(fd, "voltar") || "/";
  try { const [a] = await sql<{ entidade: string; entidade_id: number; unit_id: number | null; user_id: number | null; nome: string }[]>`SELECT entidade, entidade_id, unit_id, user_id, nome FROM attachments WHERE id=${id}`; if (!a) throw new Error("Anexo não encontrado.");
    assert(["DIRECAO", "RH"].includes(s.role) || a.user_id === s.id, "Só quem anexou, RH ou Direção removem."); if (a.unit_id) assertScope(s, a.unit_id);
    await sql`DELETE FROM attachments WHERE id=${id}`; await audit(s, "remover anexo", "attachments", id, null, { nome: a.nome, entidade: a.entidade, id: a.entidade_id });
  } catch (e) { redirect(go(voltar, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(voltar, "ok", "Anexo removido."));
}
