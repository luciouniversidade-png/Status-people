"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, assertScope } from "@/lib/auth";
import { audit, str, strOrNull, int, hoje, getSettings, caminhoSeguro } from "@/lib/utils";
import { validadePadrao } from "@/lib/acao-requerida";
import { comMensagem } from "@/lib/redirecionar";

const go = (b: string, k: "ok" | "erro", m: string) => comMensagem(b, k, m);
const msg = (e: unknown) => e instanceof Error ? e.message : "Erro inesperado.";
const BASE = "/matriculas/acao";
const SECRETARIA = ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "COMERCIAL"];
async function secretaria() { const s = await requireSession(); assert(SECRETARIA.includes(s.role), "Fila da secretaria: Direção, coordenação, secretaria e atendimento."); return s; }
async function unidadeDoAluno(id: number) { const [r] = await sql<{ u: number | null }[]>`SELECT coalesce((SELECT c.unit_id FROM enrollments e JOIN classes c ON c.id=e.class_id WHERE e.student_id=${id} AND e.status IN ('CONFIRMADA','RESERVADA') ORDER BY e.ano DESC LIMIT 1), (SELECT unit_atual_id FROM students WHERE id=${id})) AS u`; return r?.u ?? null; }

export async function designarTitular(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), BASE);
  try {
    const s = await secretaria(); assert(s.role !== "COMERCIAL", "Designar titular é da coordenação ou da Direção."); const classId = int(fd, "classId") ?? 0; const emp = int(fd, "employeeId") ?? 0;
    const [c] = await sql<{ unit_id: number; nome: string }[]>`SELECT unit_id, nome FROM classes WHERE id=${classId}`; assert(!!c, "Turma não encontrada."); assertScope(s, c.unit_id);
    const [e] = await sql<{ unit_id: number; nome: string }[]>`SELECT unit_id, nome FROM employees WHERE id=${emp} AND situacao IN ('ATIVO','FERIAS','AFASTADO')`; assert(!!e, "Escolha um(a) professor(a) ativo(a).");
    assert(e.unit_id === c.unit_id || s.role === "DIRECAO", "O(a) titular precisa ser da mesma unidade da turma (a Direção pode designar entre unidades).");
    await sql`UPDATE classes SET titular_employee_id=${emp} WHERE id=${classId}`; await audit(s, "designar titular da turma", "classes", classId, null, { employeeId: emp, turma: c.nome });
  } catch (err) { redirect(go(voltar, "erro", msg(err))); }
  redirect(go(voltar, "ok", "Titular designado: a turma saiu da fila."));
}

/** Documento de matrícula: recebido (com validade), verificado, rejeitado (com motivo) ou de volta a pendente. */
export async function registrarDocumento(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), BASE);
  try {
    const s = await secretaria(); const studentId = int(fd, "studentId") ?? 0; const tipo = str(fd, "tipo"); const acao = str(fd, "acao");
    const cfg = await getSettings(); const tipos = (cfg.acaoRequerida.documentos as { tipo: string; validadeMeses: number | null }[]); const t = tipos.find(x => x.tipo === tipo); assert(!!t, "Tipo de documento fora da lista configurada.");
    assert(["RECEBIDO", "VERIFICADO", "REJEITADO", "PENDENTE"].includes(acao), "Ação inválida."); const u = await unidadeDoAluno(studentId); if (u) assertScope(s, u);
    const h = hoje(); const val = str(fd, "validade"); assert(!val || /^\d{4}-\d{2}-\d{2}$/.test(val), "Validade inválida."); const motivo = strOrNull(fd, "motivo"); if (acao === "REJEITADO") assert((motivo ?? "").length >= 5, "Diga por que o documento foi rejeitado.");
    const validade = acao === "RECEBIDO" ? (val || validadePadrao(h, t!.validadeMeses)) : val || null;
    await sql`INSERT INTO student_documents (student_id, tipo, status, validade, recebido_em, verificado_por, verificado_em, motivo) VALUES (${studentId}, ${tipo}, ${acao}, ${validade}, ${acao === "RECEBIDO" || acao === "VERIFICADO" ? h : null}, ${acao === "VERIFICADO" ? s.id : null}, CASE WHEN ${acao}::text = 'VERIFICADO' THEN now() END, ${motivo})
      ON CONFLICT (student_id, tipo) DO UPDATE SET status=EXCLUDED.status, validade=coalesce(EXCLUDED.validade, CASE WHEN EXCLUDED.status IN ('PENDENTE','REJEITADO') THEN NULL ELSE student_documents.validade END), recebido_em=coalesce(EXCLUDED.recebido_em, CASE WHEN EXCLUDED.status='PENDENTE' THEN NULL ELSE student_documents.recebido_em END), verificado_por=EXCLUDED.verificado_por, verificado_em=EXCLUDED.verificado_em, motivo=EXCLUDED.motivo, updated_at=now()`;
    await audit(s, `documento de matrícula: ${acao.toLowerCase()}`, "student_documents", null, null, { studentId, tipo });
  } catch (err) { redirect(go(voltar, "erro", msg(err))); }
  redirect(go(voltar, "ok", "Documento atualizado."));
}

/** Reenvio da solicitação pelo canal preferido: registra o contato na timeline da família e devolve o atalho de envio. */
export async function reenviarSolicitacao(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), BASE); let destino = voltar; let canal = "";
  try {
    const s = await secretaria(); const studentId = int(fd, "studentId") ?? 0; const tipos = fd.getAll("tipo").map(String).filter(Boolean); assert(tipos.length > 0, "Escolha os documentos.");
    const [st] = await sql<{ nome: string; responsavel: string | null; telefone: string | null; email: string | null }[]>`SELECT nome, responsavel, telefone, email FROM students WHERE id=${studentId}`; assert(!!st, "Aluno não encontrado."); const u = await unidadeDoAluno(studentId); if (u) assertScope(s, u);
    canal = (st.telefone ?? "").replace(/\D/g, "").length >= 10 ? "WHATSAPP" : st.email ? "EMAIL" : "TELEFONE";
    await sql`INSERT INTO family_contacts (student_id, data, canal, tipo, resumo, user_id, user_nome) VALUES (${studentId}, ${hoje()}, ${canal}, 'SOLICITACAO', ${`Solicitação de documento(s) de matrícula reenviada: ${tipos.join(", ")}.`}, ${s.id}, ${s.nome})`;
    for (const t of tipos) await sql`INSERT INTO student_documents (student_id, tipo, status, solicitado_em, solicitacoes) VALUES (${studentId}, ${t}, 'PENDENTE', ${hoje()}, 1) ON CONFLICT (student_id, tipo) DO UPDATE SET solicitado_em=EXCLUDED.solicitado_em, solicitacoes=student_documents.solicitacoes + 1, updated_at=now()`;
    await audit(s, "reenviar solicitação de documentos", "students", studentId, null, { tipos, canal });
    destino = `${BASE}?enviar=${studentId}&docs=${encodeURIComponent(tipos.join("|"))}#documentos`;
  } catch (err) { redirect(go(voltar, "erro", msg(err))); }
  redirect(go(destino, "ok", canal === "TELEFONE" ? "Solicitação registrada na timeline da família (cadastro sem WhatsApp e sem e-mail: ligue para o responsável)." : "Solicitação registrada na timeline da família. Toque em “abrir” para enviar a mensagem pronta."));
}
