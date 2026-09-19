import Link from "next/link";
import { requireMatriculas, scopeUnit, can } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Table, Td, Badge, Flash, Field, Btn, Select } from "@/components/ui";
import { fmtData, fmtDataHora, getSettings, ENR_STATUS, hoje } from "@/lib/utils";
import { processarVencimentos } from "@/lib/matriculas";
import { AcoesMatricula, turmasAbertas } from "../_shared";

export const dynamic = "force-dynamic";

export default async function Reservas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireMatriculas(); const sp = await searchParams; const cfg = await getSettings(); const ano = cfg.matriculas.anoLetivo;
  await processarVencimentos();
  const u = scopeUnit(s); const status = sp.status ?? "RESERVADA"; const h = hoje();
  const rows = await sql<{ id: number; aluno: string; student_id: number; turma: string; class_id: number; unidade: string; turno: string; modalidade: string; status: string; reserva_ate: string | null; contrato: boolean; fin: boolean; responsavel: string | null; created_at: Date; excecao: string | null }[]>`
    SELECT e.id, st.nome AS aluno, e.student_id, c.nome AS turma, e.class_id, un.nome AS unidade, c.turno, e.modalidade, e.status, e.reserva_ate::text, e.contrato_assinado AS contrato, e.financeiro_ok AS fin, us.nome AS responsavel, e.created_at, e.excecao
    FROM enrollments e JOIN students st ON st.id=e.student_id JOIN classes c ON c.id=e.class_id JOIN units un ON un.id=c.unit_id LEFT JOIN users us ON us.id=e.responsavel_user_id
    WHERE e.ano=${ano} ${status ? sql`AND e.status=${status}` : sql``} ${u === null ? sql`` : sql`AND c.unit_id=${u}`}
    ORDER BY (e.status='RESERVADA') DESC, e.reserva_ate NULLS LAST, st.nome LIMIT 500`;
  const turmas = await turmasAbertas(s, ano);
  const podeConfirmar = can.aprovar(s, cfg.alcadas.matricula);
  return (
    <Page title={`Reservas e matrículas ${ano}`} sub={`Reserva vale ${cfg.matriculas.reservaDias} dias por padrão; vencida, a vaga volta a ficar livre. Matrícula só com contrato assinado e financeiro OK.`}
      actions={<Btn kind="ghost" href={`/api/export/matriculas?ano=${ano}`}>Exportar CSV</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-4 flex flex-wrap items-end gap-2"><Field label="Situação"><Select name="status" defaultValue={status}><option value="RESERVADA">Reservas ativas</option><option value="CONFIRMADA">Matriculados</option><option value="EXPIRADA">Reservas expiradas</option><option value="CANCELADA">Cancelados</option><option value="">Todos</option></Select></Field><Btn kind="ghost">Filtrar</Btn></form>
      <Table head={["Aluno", "Turma", "Unidade", "Situação", "Reserva até", "Contrato", "Financeiro", "Por", ""]} empty="Nada neste filtro.">
        {rows.map(e => <tr key={e.id}>
          <Td><Link className="font-medium text-acao" href={`/matriculas/alunos/${e.student_id}`}>{e.aluno}</Link>{e.excecao && <div className="text-xs text-aviso">exceção</div>}</Td>
          <Td><Link className="text-acao" href={`/matriculas/turmas/${e.class_id}`}>{e.turma}</Link><div className="text-xs text-slate-500">{e.turno}{e.modalidade === "INTEGRAL" ? " · Integral" : ""}</div></Td><Td>{e.unidade}</Td>
          <Td><Badge v={e.status === "CONFIRMADA" ? "APROVADA" : e.status === "RESERVADA" ? "SOLICITADA" : e.status === "EXPIRADA" ? "REJEITADA" : "CANCELADA"} label={ENR_STATUS[e.status]} /></Td>
          <Td className={e.status === "RESERVADA" && e.reserva_ate && e.reserva_ate <= h ? "font-medium text-erro" : ""}>{e.status === "RESERVADA" ? fmtData(e.reserva_ate) : "—"}</Td><Td>{e.contrato ? "✓" : "—"}</Td><Td>{e.fin ? "✓" : "—"}</Td>
          <Td className="text-xs text-slate-500">{e.responsavel ?? ""}<br />{fmtDataHora(e.created_at)}</Td>
          <Td><AcoesMatricula e={e} voltar={`/matriculas/reservas?status=${status}`} podeConfirmar={podeConfirmar} podeCancelarMat={podeConfirmar} turmas={turmas.filter(t => t.modalidade === e.modalidade)} /></Td>
        </tr>)}
      </Table>
    </Page>
  );
}
