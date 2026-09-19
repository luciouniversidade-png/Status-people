import { sql } from "@/db";
import { hoje, addDays, getSettings } from "./utils";
import type { Session } from "./auth";
import { can, scopeUnit } from "./auth";

export type Ocup = { class_id: number; unidade: string; unit_id: number; modalidade: string; serie: string | null; grade_id: number | null; segmento: string | null; ordem: number; series_texto: string | null; turno: string; nome: string; vagas: number; status: string; confirmadas: number; reservadas: number; livres: number; fila: number };

/** Expira reservas vencidas e ofertas de fila vencidas (idempotente; chamado ao abrir as telas do módulo). */
export async function processarVencimentos() {
  const h = hoje();
  const exp = await sql`UPDATE enrollments SET status='EXPIRADA', updated_at=now() WHERE status='RESERVADA' AND reserva_ate < ${h} RETURNING id`;
  const ofe = await sql`UPDATE waitlist SET status='AGUARDANDO', oferta_ate=NULL, oferta_class_id=NULL WHERE status='OFERTADA' AND oferta_ate < ${h} RETURNING id`;
  return { reservasExpiradas: exp.length, ofertasVencidas: ofe.length };
}

/** Ocupação por turma (confirmadas, reservas ativas, livres, fila da série). */
export async function ocupacao(ano: number, unitId: number | null, modalidade?: string): Promise<Ocup[]> {
  const h = hoje();
  return sql<Ocup[]>`
    SELECT c.id AS class_id, u.nome AS unidade, c.unit_id, c.modalidade, g.nome AS serie, c.grade_id, g.segmento, coalesce(g.ordem, 900) AS ordem, c.series_texto, c.turno, c.nome, c.vagas, c.status,
      (SELECT count(*) FROM enrollments e WHERE e.class_id=c.id AND e.status='CONFIRMADA')::int AS confirmadas,
      (SELECT count(*) FROM enrollments e WHERE e.class_id=c.id AND e.status='RESERVADA' AND e.reserva_ate >= ${h})::int AS reservadas,
      (c.vagas - (SELECT count(*) FROM enrollments e WHERE e.class_id=c.id AND (e.status='CONFIRMADA' OR (e.status='RESERVADA' AND e.reserva_ate >= ${h}))))::int AS livres,
      (SELECT count(*) FROM waitlist w WHERE w.unit_id=c.unit_id AND w.grade_id=c.grade_id AND w.ano=c.ano AND w.modalidade=c.modalidade AND w.status IN ('AGUARDANDO','OFERTADA') AND (w.turno IS NULL OR w.turno=c.turno))::int AS fila
    FROM classes c JOIN units u ON u.id=c.unit_id LEFT JOIN grades g ON g.id=c.grade_id
    WHERE c.ano=${ano} ${unitId === null ? sql`` : sql`AND c.unit_id=${unitId}`} ${modalidade ? sql`AND c.modalidade=${modalidade}` : sql``}
    ORDER BY u.nome, c.modalidade, coalesce(g.ordem, 900), c.turno, c.nome`;
}

export type ReservaInput = { studentId: number; classId: number; prazoDias?: number; excecao?: string | null; confirmarDireto?: boolean; contrato?: boolean; financeiro?: boolean; obs?: string | null };

/** Reserva (ou matricula direto) com bloqueio de linha da turma — duas reservas simultâneas na última vaga: só uma passa. */
export async function reservarVaga(s: Session, inp: ReservaInput) {
  const cfg = await getSettings(); const h = hoje();
  const prazo = inp.prazoDias ?? cfg.matriculas.reservaDias;
  return sql.begin(async tx => {
    const [c] = await tx<{ id: number; unit_id: number; ano: number; modalidade: string; vagas: number; status: string; nome: string; grade_id: number | null }[]>`SELECT id, unit_id, ano, modalidade, vagas, status, nome, grade_id FROM classes WHERE id=${inp.classId} FOR UPDATE`;
    if (!c) throw new Error("Turma não encontrada.");
    const u = scopeUnit(s); if (u !== null && u !== c.unit_id) throw new Error("Sem acesso a esta unidade.");
    if (c.status !== "ABERTA") throw new Error("Turma fechada para novas reservas.");
    const [st] = await tx<{ id: number; nome: string }[]>`SELECT id, nome FROM students WHERE id=${inp.studentId}`;
    if (!st) throw new Error("Aluno não encontrado.");
    const [dup] = await tx<{ id: number; status: string; class_id: number }[]>`SELECT id, status, class_id FROM enrollments WHERE student_id=${inp.studentId} AND ano=${c.ano} AND modalidade=${c.modalidade} AND (status='CONFIRMADA' OR (status='RESERVADA' AND reserva_ate >= ${h}))`;
    if (dup) throw new Error(dup.class_id === c.id ? `${st.nome} já tem ${dup.status === "CONFIRMADA" ? "matrícula" : "reserva"} nesta turma.` : `${st.nome} já tem ${dup.status === "CONFIRMADA" ? "matrícula" : "reserva ativa"} em outra turma de ${c.ano} (${c.modalidade === "REGULAR" ? "Regular" : "Integral"}). Transfira ou cancele antes.`);
    const [{ ocupadas }] = await tx<{ ocupadas: number }[]>`SELECT count(*)::int AS ocupadas FROM enrollments WHERE class_id=${c.id} AND (status='CONFIRMADA' OR (status='RESERVADA' AND reserva_ate >= ${h}))`;
    let excecao: string | null = null;
    if (ocupadas >= c.vagas) {
      if (!inp.excecao) throw new Error(`Turma ${c.nome} está lotada (${ocupadas}/${c.vagas}). Coloque o aluno na lista de espera ou registre uma exceção autorizada.`);
      if (!can.aprovar(s, cfg.alcadas.excecaoCapacidade)) throw new Error("Matrícula acima da capacidade exige autorização de: " + cfg.alcadas.excecaoCapacidade.join(", ") + ".");
      excecao = inp.excecao;
    }
    const confirmar = !!inp.confirmarDireto;
    if (confirmar) {
      if (!can.aprovar(s, cfg.alcadas.matricula)) throw new Error("Seu perfil não confirma matrículas.");
      if (!inp.contrato || !inp.financeiro) throw new Error("Matrícula só é confirmada com contrato assinado e financeiro OK.");
    }
    const [e] = await tx<{ id: number }[]>`INSERT INTO enrollments (student_id, class_id, ano, modalidade, status, reserva_ate, contrato_assinado, financeiro_ok, confirmada_em, excecao, responsavel_user_id, obs)
      VALUES (${inp.studentId}, ${c.id}, ${c.ano}, ${c.modalidade}, ${confirmar ? "CONFIRMADA" : "RESERVADA"}, ${confirmar ? null : addDays(h, prazo)}, ${!!inp.contrato}, ${!!inp.financeiro}, ${confirmar ? tx`now()` : null}, ${excecao}, ${s.id}, ${inp.obs ?? null}) RETURNING id`;
    // aluno que estava na fila desta série/unidade sai da fila
    await tx`UPDATE waitlist SET status='CONVERTIDA' WHERE student_id=${inp.studentId} AND ano=${c.ano} AND modalidade=${c.modalidade} AND status IN ('AGUARDANDO','OFERTADA')`;
    return { id: e.id, turma: c.nome, confirmada: confirmar, excecao, reservaAte: confirmar ? null : addDays(h, prazo) };
  });
}

export async function confirmarMatricula(s: Session, enrollmentId: number, contrato: boolean, financeiro: boolean) {
  const cfg = await getSettings(); const h = hoje();
  if (!can.aprovar(s, cfg.alcadas.matricula)) throw new Error("Seu perfil não confirma matrículas.");
  if (!contrato || !financeiro) throw new Error("Matrícula só é confirmada com contrato assinado e financeiro OK.");
  return sql.begin(async tx => {
    const [e] = await tx<{ id: number; status: string; reserva_ate: string | null; class_id: number; unit_id: number; nome: string }[]>`SELECT e.id, e.status, e.reserva_ate::text, e.class_id, c.unit_id, c.nome FROM enrollments e JOIN classes c ON c.id=e.class_id WHERE e.id=${enrollmentId} FOR UPDATE OF e`;
    if (!e) throw new Error("Reserva não encontrada.");
    const u = scopeUnit(s); if (u !== null && u !== e.unit_id) throw new Error("Sem acesso a esta unidade.");
    if (e.status === "CONFIRMADA") throw new Error("Já está matriculado.");
    if (e.status !== "RESERVADA" || (e.reserva_ate && e.reserva_ate < h)) throw new Error("A reserva expirou ou foi cancelada. Faça uma nova reserva se houver vaga.");
    await tx`UPDATE enrollments SET status='CONFIRMADA', contrato_assinado=true, financeiro_ok=true, confirmada_em=now(), updated_at=now() WHERE id=${e.id}`;
    return { turma: e.nome };
  });
}

export async function cancelarMatricula(s: Session, enrollmentId: number, motivo: string) {
  const cfg = await getSettings();
  return sql.begin(async tx => {
    const [e] = await tx<{ id: number; status: string; unit_id: number; class_id: number; grade_id: number | null; ano: number; modalidade: string; nome: string }[]>`SELECT e.id, e.status, c.unit_id, e.class_id, c.grade_id, c.ano, c.modalidade, c.nome FROM enrollments e JOIN classes c ON c.id=e.class_id WHERE e.id=${enrollmentId} FOR UPDATE OF e`;
    if (!e) throw new Error("Registro não encontrado.");
    const u = scopeUnit(s); if (u !== null && u !== e.unit_id) throw new Error("Sem acesso a esta unidade.");
    if (e.status === "CONFIRMADA" && !can.aprovar(s, cfg.alcadas.matricula)) throw new Error("Cancelar uma matrícula confirmada exige o mesmo perfil que a confirma.");
    if (!["RESERVADA", "CONFIRMADA"].includes(e.status)) throw new Error("Este registro já está encerrado.");
    if (!motivo) throw new Error("Informe o motivo (padronizado).");
    await tx`UPDATE enrollments SET status='CANCELADA', motivo_cancelamento=${motivo}, updated_at=now() WHERE id=${e.id}`;
    // vaga liberada: próximo da fila recebe oferta (se houver)
    const [{ ocup }] = await tx<{ ocup: number }[]>`SELECT count(*)::int AS ocup FROM enrollments WHERE class_id=${e.class_id} AND (status='CONFIRMADA' OR (status='RESERVADA' AND reserva_ate >= ${hoje()}))`;
    const [c] = await tx<{ vagas: number; turno: string }[]>`SELECT vagas, turno FROM classes WHERE id=${e.class_id}`;
    let ofertado: string | null = null;
    if (c && ocup < c.vagas && e.grade_id) {
      const [w] = await tx<{ id: number; nome: string }[]>`SELECT w.id, st.nome FROM waitlist w JOIN students st ON st.id=w.student_id WHERE w.unit_id=${e.unit_id} AND w.grade_id=${e.grade_id} AND w.ano=${e.ano} AND w.modalidade=${e.modalidade} AND w.status='AGUARDANDO' AND (w.turno IS NULL OR w.turno=${c.turno}) ORDER BY w.created_at LIMIT 1`;
      if (w) { await tx`UPDATE waitlist SET status='OFERTADA', oferta_ate=${addDays(hoje(), cfg.matriculas.ofertaFilaDias)}, oferta_class_id=${e.class_id} WHERE id=${w.id}`; ofertado = w.nome; }
    }
    return { turma: e.nome, statusAnterior: e.status, ofertado };
  });
}

export async function transferir(s: Session, enrollmentId: number, novaClassId: number, excecao?: string | null) {
  const cfg = await getSettings(); const h = hoje();
  return sql.begin(async tx => {
    const [e] = await tx<{ id: number; status: string; student_id: number; class_id: number; unit_id: number; ano: number; modalidade: string; contrato: boolean; fin: boolean; reserva_ate: string | null }[]>`SELECT e.id, e.status, e.student_id, e.class_id, c.unit_id, c.ano, c.modalidade, e.contrato_assinado AS contrato, e.financeiro_ok AS fin, e.reserva_ate::text FROM enrollments e JOIN classes c ON c.id=e.class_id WHERE e.id=${enrollmentId} FOR UPDATE OF e`;
    if (!e || !["RESERVADA", "CONFIRMADA"].includes(e.status)) throw new Error("Só reservas ativas ou matrículas podem ser transferidas.");
    const u = scopeUnit(s); if (u !== null && u !== e.unit_id) throw new Error("Sem acesso a esta unidade.");
    const [c] = await tx<{ id: number; unit_id: number; ano: number; modalidade: string; vagas: number; status: string; nome: string }[]>`SELECT id, unit_id, ano, modalidade, vagas, status, nome FROM classes WHERE id=${novaClassId} FOR UPDATE`;
    if (!c) throw new Error("Turma de destino não encontrada.");
    if (c.id === e.class_id) throw new Error("Já está nesta turma.");
    if (c.ano !== e.ano || c.modalidade !== e.modalidade) throw new Error("A turma de destino precisa ser do mesmo ano e modalidade.");
    if (c.status !== "ABERTA") throw new Error("Turma de destino fechada.");
    if (u !== null && u !== c.unit_id) throw new Error("Sem acesso à unidade de destino.");
    const [{ ocup }] = await tx<{ ocup: number }[]>`SELECT count(*)::int AS ocup FROM enrollments WHERE class_id=${c.id} AND (status='CONFIRMADA' OR (status='RESERVADA' AND reserva_ate >= ${h}))`;
    let exc: string | null = null;
    if (ocup >= c.vagas) {
      if (!excecao) throw new Error(`Turma ${c.nome} está lotada (${ocup}/${c.vagas}).`);
      if (!can.aprovar(s, cfg.alcadas.excecaoCapacidade)) throw new Error("Transferência acima da capacidade exige autorização de: " + cfg.alcadas.excecaoCapacidade.join(", ") + ".");
      exc = excecao;
    }
    await tx`UPDATE enrollments SET status='TRANSFERIDA', updated_at=now() WHERE id=${e.id}`;
    const [n] = await tx<{ id: number }[]>`INSERT INTO enrollments (student_id, class_id, ano, modalidade, status, reserva_ate, contrato_assinado, financeiro_ok, confirmada_em, excecao, responsavel_user_id, obs)
      VALUES (${e.student_id}, ${c.id}, ${c.ano}, ${c.modalidade}, ${e.status}, ${e.status === "RESERVADA" ? e.reserva_ate : null}, ${e.contrato}, ${e.fin}, ${e.status === "CONFIRMADA" ? tx`now()` : null}, ${exc}, ${s.id}, ${"Transferida do registro #" + e.id}) RETURNING id`;
    return { novoId: n.id, turma: c.nome };
  });
}

export async function entrarNaFila(s: Session, studentId: number, unitId: number, gradeId: number, turno: string | null, modalidade: string, ano: number) {
  const u = scopeUnit(s); if (u !== null && u !== unitId) throw new Error("Sem acesso a esta unidade.");
  const [dup] = await sql<{ id: number }[]>`SELECT id FROM waitlist WHERE student_id=${studentId} AND ano=${ano} AND modalidade=${modalidade} AND status IN ('AGUARDANDO','OFERTADA')`;
  if (dup) throw new Error("Aluno já está na lista de espera deste ano.");
  const [e] = await sql<{ id: number }[]>`SELECT e.id FROM enrollments e WHERE e.student_id=${studentId} AND e.ano=${ano} AND e.modalidade=${modalidade} AND (e.status='CONFIRMADA' OR (e.status='RESERVADA' AND e.reserva_ate >= ${hoje()}))`;
  if (e) throw new Error("Aluno já tem reserva ou matrícula ativa neste ano.");
  const [w] = await sql<{ id: number }[]>`INSERT INTO waitlist (student_id, ano, unit_id, grade_id, turno, modalidade) VALUES (${studentId}, ${ano}, ${unitId}, ${gradeId}, ${turno}, ${modalidade}) RETURNING id`;
  return w.id;
}
