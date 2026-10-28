import Link from "@/components/Link";
import { requireSession, can, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Flash, Btn, Field, Textarea, Badge } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { fmtData } from "@/lib/utils";
import { decidirInscricao } from "../v30-actions";

export const dynamic = "force-dynamic";

/** v30 · Inscrições em treinamento que a pessoa decide: gestor direto (a própria equipe), RH/Direção (a rede), direção da unidade (quem não tem gestor). */
export default async function AprovarInscricoes({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams; const emp = s.employeeId ?? 0; const escopo = scopeUnit(s);
  const filtro = can.editar(s) ? sql`TRUE` : s.role === "DIRETOR_UNIDADE" && escopo !== null ? sql`(e.gestor_id=${emp} OR (e.gestor_id IS NULL AND e.unit_id=${escopo}))` : sql`(${emp}::int <> 0 AND e.gestor_id=${emp})`;
  const [pend, decididas] = await Promise.all([
    sql<{ id: number; nome: string; cargo: string | null; unidade: string; curso: string; codigo: string; carga: number | null; turma: string | null; created_at: string }[]>`SELECT t.id, e.nome, p.nome AS cargo, un.nome AS unidade, c.titulo AS curso, c.codigo, c.carga_horas::float AS carga, (SELECT s2.data::text FROM training_sessions s2 WHERE s2.id=t.session_id) AS turma, t.created_at::date::text
      FROM training_enrollments t JOIN employees e ON e.id=t.employee_id JOIN units un ON un.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id JOIN courses c ON c.id=t.course_id WHERE t.status='AGUARDANDO_APROVACAO' AND ${filtro} ORDER BY t.created_at`,
    sql<{ id: number; nome: string; curso: string; status: string; motivo: string | null; decidido_em: string | null }[]>`SELECT t.id, e.nome, c.titulo AS curso, t.status, t.motivo, t.decidido_em::date::text FROM training_enrollments t JOIN employees e ON e.id=t.employee_id JOIN courses c ON c.id=t.course_id WHERE t.decidido_por=${s.id} ORDER BY t.decidido_em DESC LIMIT 20`,
  ]);
  return (
    <Page title="Aprovar inscrições em treinamento" sub={<>Inscrições da sua equipe que aguardam a sua decisão. A pessoa é avisada da decisão. <Link className="text-acao" href="/academy/minha">Meus treinamentos</Link></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <Card title={`Aguardando decisão (${pend.length})`}>
        <div id="inscricoes" />
        <Table head={["Colaborador", "Treinamento", "Pedido em", ""]} empty="Nenhuma inscrição aguardando a sua decisão.">{pend.map(p => <tr key={p.id}><Td><div className="font-medium">{p.nome}</div><div className="text-[11px] text-slate-500">{p.cargo ?? "—"} · {p.unidade}</div></Td><Td className="text-xs">{p.codigo} {p.curso}{p.carga ? ` · ${String(p.carga).replace(".", ",")} h` : ""}{p.turma ? ` · turma de ${fmtData(p.turma)}` : ""}</Td><Td className="text-xs">{fmtData(p.created_at)}</Td>
          <Td><div className="flex flex-wrap items-center gap-2"><form action={decidirInscricao}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="decisao" value="INSCRITO" /><Btn small>Aprovar</Btn></form>
            <Modal label="Não aprovar" kind="link" title={`Não aprovar a inscrição de ${p.nome}`}><form action={decidirInscricao} className="space-y-2"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="decisao" value="RECUSADA" /><Field label="Motivo (a pessoa vê)"><Textarea name="motivo" required minLength={5} placeholder="Ex.: período de provas; vamos fazer na próxima turma." /></Field><Btn small danger>Não aprovar</Btn></form></Modal></div></Td></tr>)}</Table>
      </Card>
      {decididas.length > 0 && <Card className="mt-4" title="Decididas por mim">
        <Table head={["Colaborador", "Treinamento", "Decisão", "Em"]}>{decididas.map(d => <tr key={d.id}><Td>{d.nome}</Td><Td className="text-xs">{d.curso}</Td><Td><Badge v={d.status === "INSCRITO" ? "APROVADA" : d.status === "RECUSADA" ? "REJEITADA" : "CANCELADA"} label={d.status === "INSCRITO" ? "aprovada" : d.status === "RECUSADA" ? "não aprovada" : "desistiu"} />{d.motivo && d.status === "RECUSADA" && <div className="text-[11px] text-slate-500">{d.motivo}</div>}</Td><Td className="text-xs">{fmtData(d.decidido_em)}</Td></tr>)}</Table>
      </Card>}
    </Page>
  );
}
