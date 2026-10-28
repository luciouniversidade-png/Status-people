"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert } from "@/lib/auth";
import { audit, str, int, caminhoSeguro } from "@/lib/utils";
import { notificar } from "@/lib/comunicacao";
import { podeReconhecer, podeModerar, valoresDaEscola, colegasReconheciveis, MURAL_MIN, MURAL_MAX } from "@/lib/reconhecimento";
import { comMensagem } from "@/lib/redirecionar";

const go = (b: string, k: "ok" | "erro", msg: string) => comMensagem(b, k, msg);
const msg = (e: unknown) => e instanceof Error ? e.message : "Erro inesperado.";

/** Publica um reconhecimento no mural e avisa a pessoa reconhecida (notificação e celular). */
export async function reconhecer(fd: FormData) {
  const s = await requireSession(); const volta = caminhoSeguro(str(fd, "voltar"), "/reconhecimento");
  try {
    assert(podeReconhecer(s), "Seu acesso só lê o mural.");
    const para = int(fd, "para") ?? 0; assert(para > 0, "Escolha quem você quer reconhecer."); assert(para !== s.employeeId, "Reconheça um colega — não a si mesmo.");
    assert((await colegasReconheciveis(s)).some(c => c.id === para), "Escolha um colega da lista.");
    const valor = str(fd, "valor"); const valores = await valoresDaEscola(); assert(!valor || valores.includes(valor), "Escolha um dos valores da escola.");
    const mensagem = str(fd, "mensagem").replace(/\s+\n/g, "\n"); assert(mensagem.length >= MURAL_MIN, `Conte o que a pessoa fez (pelo menos ${MURAL_MIN} caracteres).`); assert(mensagem.length <= MURAL_MAX, `Mensagem longa demais (até ${MURAL_MAX} caracteres).`);
    // limite simples contra excesso: 10 recados por pessoa por dia
    const [n] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM recognitions WHERE de_user_id=${s.id} AND created_at >= now() - interval '1 day'`; assert(n.n < 10, "Você já publicou 10 reconhecimentos nas últimas 24 horas. Volte amanhã!");
    const [e] = await sql<{ unit_id: number; nome: string }[]>`SELECT unit_id, nome FROM employees WHERE id=${para}`;
    const [r] = await sql<{ id: number }[]>`INSERT INTO recognitions (de_user_id, de_nome, para_employee_id, valor, mensagem, unit_id) VALUES (${s.id}, ${s.nome}, ${para}, ${valor || null}, ${mensagem}, ${e.unit_id}) RETURNING id`;
    await audit(s, "reconhecimento publicado", "recognitions", r.id, null, { para, valor: valor || null });
    const destinos = await sql<{ id: number }[]>`SELECT id FROM users WHERE employee_id=${para} AND ativo`;
    if (destinos.length) await notificar(destinos.map(d => d.id), "Você recebeu um reconhecimento 👏", `${s.nome} reconheceu você${valor ? ` por ${valor}` : ""}.`, "/reconhecimento", "INFO", `recon:${r.id}`);
  } catch (e) { redirect(go(volta, "erro", msg(e))); }
  redirect(go(volta, "ok", "Reconhecimento publicado no mural."));
}

/** Aplaudir (ou desfazer o aplauso de) um recado. */
export async function aplaudir(fd: FormData) {
  const s = await requireSession(); const volta = caminhoSeguro(str(fd, "voltar"), "/reconhecimento");
  try {
    assert(podeReconhecer(s), "Seu acesso só lê o mural.");
    const id = int(fd, "id") ?? 0; const [r] = await sql<{ status: string }[]>`SELECT status FROM recognitions WHERE id=${id}`; assert(!!r && r.status === "PUBLICADO", "Recado não encontrado.");
    const del = await sql`DELETE FROM recognition_reactions WHERE recognition_id=${id} AND user_id=${s.id} RETURNING 1`;
    if (!del.length) await sql`INSERT INTO recognition_reactions (recognition_id, user_id) VALUES (${id}, ${s.id}) ON CONFLICT DO NOTHING`;
  } catch (e) { redirect(go(volta, "erro", msg(e))); }
  redirect(volta);
}

/** Moderação (Direção e RH): oculta ou volta a publicar um recado, com motivo. */
export async function moderar(fd: FormData) {
  const s = await requireSession(); const volta = caminhoSeguro(str(fd, "voltar"), "/reconhecimento"); let texto = "";
  try {
    assert(podeModerar(s), "Só Direção e RH moderam o mural.");
    const id = int(fd, "id") ?? 0; const [r] = await sql<{ status: string }[]>`SELECT status FROM recognitions WHERE id=${id}`; assert(!!r, "Recado não encontrado.");
    const ocultar = str(fd, "acao") === "ocultar"; const motivo = str(fd, "motivo");
    if (ocultar) assert(motivo.length >= 5, "Informe o motivo para ocultar.");
    await sql`UPDATE recognitions SET status=${ocultar ? "OCULTO" : "PUBLICADO"}, oculto_por=${ocultar ? s.id : null}, oculto_motivo=${ocultar ? motivo : null} WHERE id=${id}`;
    await audit(s, ocultar ? "reconhecimento ocultado" : "reconhecimento republicado", "recognitions", id, { status: r.status }, { status: ocultar ? "OCULTO" : "PUBLICADO", motivo: ocultar ? motivo : null });
    texto = ocultar ? "Recado ocultado do mural." : "Recado publicado de novo.";
  } catch (e) { redirect(go(volta, "erro", msg(e))); }
  redirect(go(volta, "ok", texto));
}
