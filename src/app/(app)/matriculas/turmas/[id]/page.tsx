import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMatriculas, scopeUnit, can } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge, Flash, Stat } from "@/components/ui";
import { fmtData, fmtDataHora, getSettings, ENR_STATUS } from "@/lib/utils";
import { ocupacao, processarVencimentos } from "@/lib/matriculas";
import { ReservaForm, AcoesMatricula, turmasAbertas, alunosAtivos } from "../../_shared";

export const dynamic = "force-dynamic";

export default async function Turma({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireMatriculas(); const { id } = await params; const sp = await searchParams; const cfg = await getSettings();
  await processarVencimentos();
  const cid = Number(id);
  const [c] = await sql<{ id: number; ano: number; unit_id: number; unidade: string; modalidade: string; serie: string | null; series_texto: string | null; turno: string; nome: string; vagas: number; status: string; obs: string | null }[]>`SELECT c.id, c.ano, c.unit_id, u.nome AS unidade, c.modalidade, g.nome AS serie, c.series_texto, c.turno, c.nome, c.vagas, c.status, c.obs FROM classes c JOIN units u ON u.id=c.unit_id LEFT JOIN grades g ON g.id=c.grade_id WHERE c.id=${cid}`;
  if (!c) notFound(); const scope = scopeUnit(s); if (scope !== null && scope !== c.unit_id) notFound();
  const [oc] = (await ocupacao(c.ano, c.unit_id)).filter(x => x.class_id === cid);
  const lista = await sql<{ id: number; aluno: string; student_id: number; status: string; reserva_ate: string | null; contrato: boolean; fin: boolean; class_id: number; excecao: string | null; created_at: Date; responsavel: string | null; motivo: string | null }[]>`SELECT e.id, st.nome AS aluno, e.student_id, e.status, e.reserva_ate::text, e.contrato_assinado AS contrato, e.financeiro_ok AS fin, e.class_id, e.excecao, e.created_at, u.nome AS responsavel, e.motivo_cancelamento AS motivo FROM enrollments e JOIN students st ON st.id=e.student_id LEFT JOIN users u ON u.id=e.responsavel_user_id WHERE e.class_id=${cid} ORDER BY (e.status IN ('CONFIRMADA','RESERVADA')) DESC, e.status, st.nome`;
  const [turmas, alunos] = await Promise.all([turmasAbertas(s, c.ano, c.modalidade), alunosAtivos()]);
  const podeConfirmar = can.aprovar(s, cfg.alcadas.matricula); const podeExcecao = can.aprovar(s, cfg.alcadas.excecaoCapacidade);
  const voltar = `/matriculas/turmas/${cid}`;
  return (
    <Page title={`${c.nome} — ${c.unidade}`} sub={<span className="flex flex-wrap items-center gap-2"><Badge v={c.status === "ABERTA" ? "ATIVO" : "DESLIGADO"} label={c.status === "ABERTA" ? "Aberta" : "Fechada"} />{c.modalidade === "REGULAR" ? c.serie : `Integral · ${c.series_texto}`} · {c.turno} · {c.ano} · <Link className="text-acao" href="/matriculas">painel</Link></span>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Vagas" value={c.vagas} /><Stat label="Matriculados" value={<span className="text-ok">{oc?.confirmadas ?? 0}</span>} /><Stat label="Reservas ativas" value={<span className="text-aviso">{oc?.reservadas ?? 0}</span>} /><Stat label="Livres" value={oc && oc.livres <= 0 ? <span className="text-erro">lotada</span> : oc?.livres ?? c.vagas} hint={oc?.fila ? `${oc.fila} na fila` : undefined} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card title="Alunos da turma">
          <Table head={["Aluno", "Situação", "Reserva até", "Contrato", "Financeiro", "Por", ""]} empty="Nenhuma reserva ou matrícula nesta turma.">
            {lista.map(e => <tr key={e.id} className={["CANCELADA", "EXPIRADA", "TRANSFERIDA"].includes(e.status) ? "opacity-60" : ""}>
              <Td><Link className="text-acao" href={`/matriculas/alunos/${e.student_id}`}>{e.aluno}</Link>{e.excecao && <div className="text-xs text-aviso">exceção: {e.excecao}</div>}{e.motivo && <div className="text-xs text-slate-500">{e.motivo}</div>}</Td>
              <Td><Badge v={e.status === "CONFIRMADA" ? "APROVADA" : e.status === "RESERVADA" ? "SOLICITADA" : e.status === "EXPIRADA" ? "REJEITADA" : "CANCELADA"} label={ENR_STATUS[e.status]} /></Td>
              <Td>{e.status === "RESERVADA" ? fmtData(e.reserva_ate) : "—"}</Td><Td>{e.contrato ? "✓" : "—"}</Td><Td>{e.fin ? "✓" : "—"}</Td><Td className="text-xs text-slate-500">{e.responsavel ?? ""}<br />{fmtDataHora(e.created_at)}</Td>
              <Td><AcoesMatricula e={e} voltar={voltar} podeConfirmar={podeConfirmar} podeCancelarMat={podeConfirmar} turmas={turmas} /></Td>
            </tr>)}
          </Table>
        </Card>
        {c.status === "ABERTA" && <ReservaForm s={s} cfg={cfg.matriculas} voltar={voltar} classId={cid} alunos={alunos} podeExcecao={podeExcecao} podeConfirmar={podeConfirmar} />}
      </div>
    </Page>
  );
}
