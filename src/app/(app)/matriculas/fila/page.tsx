import { Modal } from "@/components/Modal";
import Link from "next/link";
import { requireMatriculas, scopeUnit, can } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Table, Td, Badge, Flash, Field, Btn, Select, Input } from "@/components/ui";
import { fmtData, fmtDataHora, getSettings, WL_STATUS } from "@/lib/utils";
import { processarVencimentos } from "@/lib/matriculas";
import { turmasAbertas, rotuloTurma } from "../_shared";
import { ofertarFila, converterFila, sairFila } from "../actions";

export const dynamic = "force-dynamic";

export default async function Fila({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireMatriculas(); const sp = await searchParams; const cfg = await getSettings(); const ano = cfg.matriculas.anoLetivo;
  await processarVencimentos();
  const scope = scopeUnit(s); const unitId = scope ?? (sp.unidade ? Number(sp.unidade) : null); const gradeId = sp.serie ? Number(sp.serie) : null; const status = sp.status ?? "ATIVOS";
  const rows = await sql<{ id: number; aluno: string; student_id: number; unidade: string; unit_id: number; serie: string; grade_id: number; turno: string | null; modalidade: string; status: string; oferta_ate: string | null; oferta_class_id: number | null; turma_oferta: string | null; created_at: Date; posicao: number; telefone: string | null; responsavel: string | null }[]>`
    SELECT w.id, st.nome AS aluno, w.student_id, u.nome AS unidade, w.unit_id, g.nome AS serie, w.grade_id, w.turno, w.modalidade, w.status, w.oferta_ate::text, w.oferta_class_id, c.nome AS turma_oferta, w.created_at, st.telefone, st.responsavel,
      row_number() OVER (PARTITION BY w.unit_id, w.grade_id, w.modalidade ORDER BY w.created_at)::int AS posicao
    FROM waitlist w JOIN students st ON st.id=w.student_id JOIN units u ON u.id=w.unit_id JOIN grades g ON g.id=w.grade_id LEFT JOIN classes c ON c.id=w.oferta_class_id
    WHERE w.ano=${ano} ${status === "ATIVOS" ? sql`AND w.status IN ('AGUARDANDO','OFERTADA')` : status ? sql`AND w.status=${status}` : sql``} ${unitId === null ? sql`` : sql`AND w.unit_id=${unitId}`} ${gradeId ? sql`AND w.grade_id=${gradeId}` : sql``}
    ORDER BY u.nome, g.ordem, w.created_at LIMIT 500`;
  const [units, grades, turmas] = await Promise.all([db.select().from(schema.units).orderBy(asc(schema.units.nome)), db.select().from(schema.grades).orderBy(asc(schema.grades.ordem)), turmasAbertas(s, ano)]);
  return (
    <Page title={`Lista de espera ${ano}`} sub="Ordem de chegada por unidade e série. Quando uma vaga abre, o próximo recebe a oferta com prazo; aceitou, vira reserva.">
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-4 flex flex-wrap items-end gap-2 rounded-md border border-line bg-white p-3">
        {!scope && <Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Todas</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
        <Field label="Série"><Select name="serie" defaultValue={gradeId ?? ""}><option value="">Todas</option>{grades.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}</Select></Field>
        <Field label="Situação"><Select name="status" defaultValue={status}><option value="ATIVOS">Aguardando e ofertadas</option><option value="CONVERTIDA">Convertidas</option><option value="DESISTIU">Desistências</option><option value="">Todas</option></Select></Field>
        <Btn kind="ghost">Filtrar</Btn>
      </form>
      <Table head={["#", "Aluno", "Unidade", "Série", "Turno", "Situação", "Desde", ""]} empty="Ninguém na fila neste filtro.">
        {rows.map(w => { const opcoes = turmas.filter(t => t.modalidade === w.modalidade && t.livres > 0 && t.unidade === w.unidade && (t.serie === w.serie) && (!w.turno || t.turno === w.turno)); return (
          <tr key={w.id}>
            <Td className="tabular-nums text-slate-500">{w.posicao}º</Td>
            <Td><Link className="font-medium text-acao" href={`/matriculas/alunos/${w.student_id}`}>{w.aluno}</Link><div className="text-xs text-slate-500">{w.responsavel ?? ""} {w.telefone ?? ""}</div></Td><Td>{w.unidade}</Td><Td>{w.serie}{w.modalidade === "INTEGRAL" ? " · Integral" : ""}</Td><Td>{w.turno ?? "qualquer"}</Td>
            <Td><Badge v={w.status === "AGUARDANDO" ? "PENDENTE" : w.status === "OFERTADA" ? "EM_ADMISSAO" : w.status === "CONVERTIDA" ? "APROVADA" : "CANCELADA"} label={WL_STATUS[w.status]} />{w.status === "OFERTADA" && <div className="text-xs">{w.turma_oferta} · até {fmtData(w.oferta_ate)}</div>}</Td>
            <Td className="text-xs text-slate-500">{fmtDataHora(w.created_at)}</Td>
            <Td>{can.reservar(s) && ["AGUARDANDO", "OFERTADA"].includes(w.status) && <div className="flex flex-wrap gap-1">
              {w.status === "AGUARDANDO" && opcoes.length > 0 && <form action={ofertarFila} className="flex items-center gap-1"><input type="hidden" name="id" value={w.id} /><input type="hidden" name="voltar" value="/matriculas/fila" /><Select name="classId" className="!w-auto !py-1 !text-xs">{opcoes.map(t => <option key={t.id} value={t.id}>{rotuloTurma(t)}</option>)}</Select><Btn small kind="ghost">Ofertar</Btn></form>}
              {w.status === "AGUARDANDO" && opcoes.length === 0 && <span className="text-xs text-slate-400">sem vaga livre</span>}
              {w.status === "OFERTADA" && <form action={converterFila}><input type="hidden" name="id" value={w.id} /><input type="hidden" name="voltar" value="/matriculas/fila" /><Btn small>Aceitou → reservar</Btn></form>}
              <Modal label={"Sair"} kind="ghost"><form action={sairFila} className="space-y-1"><input type="hidden" name="id" value={w.id} /><input type="hidden" name="voltar" value="/matriculas/fila" /><Input name="motivo" placeholder="Motivo" /><Btn small danger>Retirar da fila</Btn></form></Modal>
            </div>}</Td>
          </tr>); })}
      </Table>
    </Page>
  );
}
