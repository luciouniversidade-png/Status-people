import { Modal } from "@/components/Modal";
import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Field, Input, Select, Textarea, Btn } from "@/components/ui";
import { MOTIVOS_PERDA } from "@/lib/utils";
import type { Session } from "@/lib/auth";
import { can, scopeUnit } from "@/lib/auth";
import { reservar, cancelar, confirmar, transferirAcao, prorrogar } from "./actions";

export async function turmasAbertas(s: Session, ano: number, modalidade?: string) {
  const u = scopeUnit(s);
  return sql<{ id: number; nome: string; unidade: string; turno: string; modalidade: string; serie: string | null; vagas: number; livres: number }[]>`
    SELECT c.id, c.nome, u.nome AS unidade, c.turno, c.modalidade, g.nome AS serie, c.vagas,
      (c.vagas - (SELECT count(*) FROM enrollments e WHERE e.class_id=c.id AND (e.status='CONFIRMADA' OR (e.status='RESERVADA' AND e.reserva_ate >= CURRENT_DATE))))::int AS livres
    FROM classes c JOIN units u ON u.id=c.unit_id LEFT JOIN grades g ON g.id=c.grade_id
    WHERE c.ano=${ano} AND c.status='ABERTA' ${u === null ? sql`` : sql`AND c.unit_id=${u}`} ${modalidade ? sql`AND c.modalidade=${modalidade}` : sql``}
    ORDER BY u.nome, c.modalidade, coalesce(g.ordem, 900), c.turno, c.nome`;
}
export const alunosAtivos = () => db.select({ id: schema.students.id, nome: schema.students.nome }).from(schema.students).orderBy(asc(schema.students.nome));

type Turma = Awaited<ReturnType<typeof turmasAbertas>>[number];
export const rotuloTurma = (t: Turma) => `${t.unidade} · ${t.nome} · ${t.turno}${t.modalidade === "INTEGRAL" ? " · Integral" : ""} (${t.livres > 0 ? `${t.livres} livre${t.livres > 1 ? "s" : ""}` : "lotada"})`;

/** Formulário de reserva/matrícula — usado na turma e na ficha do aluno. */
export function ReservaForm({ s, cfg, voltar, studentId, classId, alunos, turmas, podeExcecao, podeConfirmar }: { s: Session; cfg: { reservaDias: number }; voltar: string; studentId?: number; classId?: number; alunos?: { id: number; nome: string }[]; turmas?: Turma[]; podeExcecao: boolean; podeConfirmar: boolean }) {
  if (!can.reservar(s)) return null;
  return (
    <form action={reservar} className="space-y-2 rounded-md border border-line bg-mist p-3">
      <div id="reservar" className="text-sm font-semibold text-navy">Reservar vaga / matricular</div>
      <input type="hidden" name="voltar" value={voltar} />
      {studentId ? <input type="hidden" name="studentId" value={studentId} /> : <Field label="Aluno"><Select name="studentId" required><option value="">Escolha</option>{alunos?.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}</Select></Field>}
      {classId ? <input type="hidden" name="classId" value={classId} /> : <Field label="Turma"><Select name="classId" required><option value="">Escolha</option>{turmas?.map(t => <option key={t.id} value={t.id}>{rotuloTurma(t)}</option>)}</Select></Field>}
      <Field label="Prazo da reserva (dias)" hint={`Padrão: ${cfg.reservaDias} dias. Vencida, a vaga volta a ficar livre.`}><Input name="prazoDias" type="number" min={1} max={60} defaultValue={cfg.reservaDias} /></Field>
      {podeConfirmar && <div className="rounded border border-line bg-white p-2 text-xs">
        <label className="flex items-center gap-2"><input type="checkbox" name="confirmarDireto" value="1" /> Matricular direto (sem reserva)</label>
        <label className="mt-1 flex items-center gap-2"><input type="checkbox" name="contrato" value="1" /> Contrato assinado</label>
        <label className="mt-1 flex items-center gap-2"><input type="checkbox" name="financeiro" value="1" /> Financeiro OK</label>
      </div>}
      {podeExcecao && <Field label="Exceção de capacidade (só se a turma estiver lotada)" hint="Justificativa obrigatória; fica na auditoria."><Input name="excecao" placeholder="Ex.: irmão já matriculado na turma" /></Field>}
      <Field label="Observação"><Input name="obs" /></Field>
      <Btn small>{podeConfirmar ? "Reservar ou matricular" : "Reservar vaga"}</Btn>
    </form>
  );
}

/** Ações de uma reserva/matrícula (confirmar, cancelar, transferir, prorrogar). */
export function AcoesMatricula({ e, voltar, podeConfirmar, podeCancelarMat, turmas }: { e: { id: number; status: string; contrato: boolean; fin: boolean; class_id: number }; voltar: string; podeConfirmar: boolean; podeCancelarMat: boolean; turmas: Turma[] }) {
  const ativa = e.status === "RESERVADA" || e.status === "CONFIRMADA";
  if (!ativa) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {e.status === "RESERVADA" && podeConfirmar && (
        <Modal label={"Confirmar"} kind="primary">
          <form action={confirmar} className="absolute z-10 space-y-2"><input type="hidden" name="id" value={e.id} /><input type="hidden" name="voltar" value={voltar} />
            <label className="flex items-center gap-2"><input type="checkbox" name="contrato" value="1" defaultChecked={e.contrato} /> Contrato assinado</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="financeiro" value="1" defaultChecked={e.fin} /> Financeiro OK</label>
            <Btn small>Confirmar matrícula</Btn></form></Modal>)}
      {e.status === "RESERVADA" && podeConfirmar && <form action={prorrogar} className="flex items-center gap-1"><input type="hidden" name="id" value={e.id} /><input type="hidden" name="voltar" value={voltar} /><input name="dias" type="number" min={1} max={30} defaultValue={3} className="w-14 rounded border border-line px-1 py-1 text-xs" aria-label="dias" /><Btn small kind="ghost">Prorrogar</Btn></form>}
      <Modal label={"Transferir"} kind="ghost">
        <form action={transferirAcao} className="absolute z-10 space-y-2"><input type="hidden" name="id" value={e.id} /><input type="hidden" name="voltar" value={voltar} />
          <Field label="Nova turma"><Select name="novaClassId" required><option value="">Escolha</option>{turmas.filter(t => t.id !== e.class_id).map(t => <option key={t.id} value={t.id}>{rotuloTurma(t)}</option>)}</Select></Field>
          <Field label="Exceção (se lotada)"><Input name="excecao" /></Field><Btn small>Transferir</Btn></form></Modal>
      {(e.status === "RESERVADA" || podeCancelarMat) && <Modal label={"Cancelar"} kind="ghost">
        <form action={cancelar} className="space-y-2"><input type="hidden" name="id" value={e.id} /><input type="hidden" name="voltar" value={voltar} />
          <Field label="Motivo"><Select name="motivo" required><option value="">Escolha</option>{MOTIVOS_PERDA.map(m => <option key={m}>{m}</option>)}</Select></Field><Btn small danger>Confirmar cancelamento</Btn></form></Modal>}
    </div>
  );
}
export { Textarea };
