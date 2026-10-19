import { sql } from "@/db";
import { getSettings, hoje, addDays, addMonths } from "./utils";

/**
 * T-013 · Ação requerida (pendências estruturais da operação acadêmica): o que está quebrado antes de analisar —
 * turmas sem titular, alunos atuais sem turma no próximo ano letivo, documentos de matrícula pendentes/vencendo e reservas expirando.
 * Cada item tem a ação na própria fila e só some quando resolvido. Tudo no escopo da unidade do perfil.
 */
export type SituacaoDoc = "PENDENTE" | "RECEBIDO" | "VERIFICADO" | "REJEITADO" | "VENCENDO" | "VENCIDO";
export const SITUACAO_DOC: Record<SituacaoDoc, { rotulo: string; tom: "bom" | "atencao" | "ruim" | "neutro" }> = {
  PENDENTE: { rotulo: "Pendente", tom: "atencao" }, RECEBIDO: { rotulo: "Recebido (a verificar)", tom: "neutro" }, VERIFICADO: { rotulo: "Verificado", tom: "bom" },
  REJEITADO: { rotulo: "Rejeitado", tom: "ruim" }, VENCENDO: { rotulo: "Vencendo", tom: "atencao" }, VENCIDO: { rotulo: "Vencido", tom: "ruim" },
};
/** Situação efetiva do documento: a validade manda sobre o status (vencido/vencendo), depois o status. */
export function situacaoDoc(d: { status: string; validade: string | null } | null, h: string, vencendoDias: number): SituacaoDoc {
  if (!d || d.status === "PENDENTE") return "PENDENTE"; if (d.status === "REJEITADO") return "REJEITADO";
  if (d.validade && d.validade < h) return "VENCIDO"; if (d.validade && d.validade <= addDays(h, vencendoDias)) return "VENCENDO";
  return d.status === "VERIFICADO" ? "VERIFICADO" : "RECEBIDO";
}
/** Validade a partir da data de recebimento e dos meses do tipo (null = não vence). */
export const validadePadrao = (recebido: string, meses: number | null) => meses ? addMonths(recebido, meses) : null;
/** Peso de impacto para ordenar a fila (receita e vaga primeiro, depois operação e conformidade). */
export const IMPACTO: Record<string, number> = { RESERVA: 4, SEM_TURMA: 3, SEM_TITULAR: 2, DOCUMENTO: 1 };

export async function acaoRequerida(unitId: number | null) {
  const cfg = await getSettings(); const h = hoje(); const ano = cfg.matriculas.anoLetivo as number; const anoAtual = Number(h.slice(0, 4));
  const ar = cfg.acaoRequerida as { documentos: { tipo: string; validadeMeses: number | null }[]; vencendoDias: number; reservaHoras: number };
  const uf = (col: string) => unitId === null ? sql`` : sql`AND ${sql(col)}=${unitId}`;
  const [semTitular, semTurma, reservas, matriculados, docs] = await Promise.all([
    sql<{ id: number; nome: string; ano: number; unidade: string; unit_id: number; turno: string; alunos: number }[]>`SELECT c.id, c.nome, c.ano, u.nome AS unidade, c.unit_id, c.turno, (SELECT count(*) FROM enrollments e WHERE e.class_id=c.id AND e.status IN ('CONFIRMADA','RESERVADA'))::int AS alunos
      FROM classes c JOIN units u ON u.id=c.unit_id WHERE c.ano IN (${anoAtual}, ${ano}) AND c.status <> 'CANCELADA' AND c.modalidade='REGULAR' AND (c.titular_employee_id IS NULL OR NOT EXISTS (SELECT 1 FROM employees e WHERE e.id=c.titular_employee_id AND e.situacao IN ('ATIVO','FERIAS','AFASTADO'))) ${uf("c.unit_id")} ORDER BY c.ano, u.nome, c.nome`,
    sql<{ id: number; nome: string; unidade: string | null; unit_id: number | null; serie: string | null; responsavel: string | null; telefone: string | null; link: string | null }[]>`SELECT s.id, s.nome, u.nome AS unidade, s.unit_atual_id AS unit_id, g.nome AS serie, s.responsavel, s.telefone,
        (SELECT l.status FROM rematricula_links l WHERE l.student_id=s.id AND l.ano=${ano} ORDER BY l.id DESC LIMIT 1) AS link
      FROM students s LEFT JOIN units u ON u.id=s.unit_atual_id LEFT JOIN grades g ON g.id=s.serie_atual_id
      WHERE s.aluno_atual AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id=s.id AND e.ano=${ano} AND e.status IN ('CONFIRMADA','RESERVADA'))
        AND NOT EXISTS (SELECT 1 FROM rematricula_links l WHERE l.student_id=s.id AND l.ano=${ano} AND l.status='RECUSADA') ${uf("s.unit_atual_id")} ORDER BY u.nome NULLS LAST, s.nome LIMIT 500`,
    sql<{ id: number; aluno: string; student_id: number; turma: string; unidade: string; unit_id: number; reserva_ate: string }[]>`SELECT e.id, st.nome AS aluno, st.id AS student_id, c.nome AS turma, u.nome AS unidade, c.unit_id, e.reserva_ate::text FROM enrollments e JOIN students st ON st.id=e.student_id JOIN classes c ON c.id=e.class_id JOIN units u ON u.id=c.unit_id
      WHERE e.status='RESERVADA' AND e.reserva_ate <= ${addDays(h, Math.ceil(ar.reservaHoras / 24))}::date ${uf("c.unit_id")} ORDER BY e.reserva_ate, st.nome`,
    sql<{ student_id: number; nome: string; unidade: string; unit_id: number; responsavel: string | null; telefone: string | null; email: string | null; status: string }[]>`SELECT DISTINCT ON (st.id) st.id AS student_id, st.nome, u.nome AS unidade, c.unit_id, st.responsavel, st.telefone, st.email, e.status FROM enrollments e JOIN students st ON st.id=e.student_id JOIN classes c ON c.id=e.class_id JOIN units u ON u.id=c.unit_id
      WHERE e.ano=${ano} AND e.status IN ('CONFIRMADA','RESERVADA') ${uf("c.unit_id")} ORDER BY st.id, (e.status='CONFIRMADA') DESC`,
    sql<{ id: number; student_id: number; tipo: string; status: string; validade: string | null; solicitado_em: string | null; solicitacoes: number; motivo: string | null }[]>`SELECT d.id, d.student_id, d.tipo, d.status, d.validade::text, d.solicitado_em::text, d.solicitacoes, d.motivo FROM student_documents d WHERE d.student_id IN (SELECT e.student_id FROM enrollments e WHERE e.ano=${ano} AND e.status IN ('CONFIRMADA','RESERVADA'))`,
  ]);
  // documentos: cada matriculado/reservado × cada tipo exigido
  const linhasDoc = matriculados.map(m => { const itens = ar.documentos.map(t => { const d = docs.find(x => x.student_id === m.student_id && x.tipo === t.tipo) ?? null; return { tipo: t.tipo, id: d?.id ?? null, situacao: situacaoDoc(d, h, ar.vencendoDias), validade: d?.validade ?? null, solicitado_em: d?.solicitado_em ?? null, solicitacoes: d?.solicitacoes ?? 0, motivo: d?.motivo ?? null }; }); return { ...m, itens, faltando: itens.filter(i => ["PENDENTE", "REJEITADO", "VENCIDO", "VENCENDO"].includes(i.situacao)).length }; });
  const todos = linhasDoc.flatMap(l => l.itens);
  const contadores = { total: todos.length, PENDENTE: todos.filter(i => i.situacao === "PENDENTE").length, RECEBIDO: todos.filter(i => i.situacao === "RECEBIDO").length, VERIFICADO: todos.filter(i => i.situacao === "VERIFICADO").length, REJEITADO: todos.filter(i => i.situacao === "REJEITADO").length, VENCENDO: todos.filter(i => i.situacao === "VENCENDO").length, VENCIDO: todos.filter(i => i.situacao === "VENCIDO").length };
  return { ano, anoAtual, semTitular, semTurma, reservas: reservas.map(r => ({ ...r, vencida: r.reserva_ate < h })), documentos: linhasDoc.filter(l => l.faltando > 0), contadores, tipos: ar.documentos, vencendoDias: ar.vencendoDias };
}
