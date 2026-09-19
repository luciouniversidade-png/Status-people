import Link from "next/link";
import { requireMatriculas, can } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Table, Td, Badge, Flash, Field, Btn, Input, Select } from "@/components/ui";
import { getSettings, ENR_STATUS, ORIGEM_LABEL } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Alunos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireMatriculas(); const sp = await searchParams; const cfg = await getSettings(); const ano = cfg.matriculas.anoLetivo;
  const q = (sp.q ?? "").trim(); const sit = sp.situacao ?? "";
  const rows = await sql<{ id: number; nome: string; responsavel: string | null; telefone: string | null; aluno_atual: boolean; origem: string | null; serie_atual: string | null; unidade_atual: string | null; status: string | null; turma: string | null; unidade: string | null; fila: number }[]>`
    SELECT st.id, st.nome, st.responsavel, st.telefone, st.aluno_atual, st.origem, g.nome AS serie_atual, ua.nome AS unidade_atual,
      e.status, c.nome AS turma, u.nome AS unidade,
      (SELECT count(*) FROM waitlist w WHERE w.student_id=st.id AND w.ano=${ano} AND w.status IN ('AGUARDANDO','OFERTADA'))::int AS fila
    FROM students st LEFT JOIN grades g ON g.id=st.serie_atual_id LEFT JOIN units ua ON ua.id=st.unit_atual_id
    LEFT JOIN LATERAL (SELECT e.status, e.class_id FROM enrollments e WHERE e.student_id=st.id AND e.ano=${ano} AND e.modalidade='REGULAR' ORDER BY (e.status='CONFIRMADA') DESC, (e.status='RESERVADA') DESC, e.id DESC LIMIT 1) e ON true
    LEFT JOIN classes c ON c.id=e.class_id LEFT JOIN units u ON u.id=c.unit_id
    WHERE 1=1 ${q ? sql`AND (st.nome ILIKE ${"%" + q + "%"} OR st.responsavel ILIKE ${"%" + q + "%"} OR st.telefone ILIKE ${"%" + q + "%"})` : sql``}
      ${sit === "SEM" ? sql`AND (e.status IS NULL OR e.status NOT IN ('CONFIRMADA','RESERVADA'))` : sit ? sql`AND e.status=${sit}` : sql``}
    ORDER BY st.nome LIMIT 500`;
  return (
    <Page title="Alunos e candidatos" sub={`${rows.length} registro(s) · situação em ${ano} (Regular)`}
      actions={<><Btn kind="ghost" href={`/api/export/matriculas?ano=${ano}`}>Exportar CSV</Btn>{can.reservar(s) && <><Btn kind="ghost" href="/matriculas/importar">Importar planilha</Btn><Btn href="/matriculas/alunos/novo">Novo aluno / candidato</Btn></>}</>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-4 grid gap-2 rounded-md border border-line bg-white p-3 sm:grid-cols-[1fr_220px_auto]">
        <Field label="Buscar"><Input name="q" defaultValue={q} placeholder="Aluno, responsável ou telefone" /></Field>
        <Field label={`Situação ${ano}`}><Select name="situacao" defaultValue={sit}><option value="">Todas</option><option value="CONFIRMADA">Matriculados</option><option value="RESERVADA">Com reserva</option><option value="SEM">Sem vaga (candidatos / fila)</option><option value="CANCELADA">Cancelados</option></Select></Field>
        <div className="flex items-end"><Btn kind="ghost">Filtrar</Btn></div>
      </form>
      <Table head={["Aluno", "Responsável", "Telefone", "Hoje", "Origem", `${ano}`, "Turma"]} empty="Nenhum aluno. Cadastre ou importe a base atual.">
        {rows.map(r => <tr key={r.id} className="hover:bg-mist/60">
          <Td><Link className="font-medium text-acao" href={`/matriculas/alunos/${r.id}`}>{r.nome}</Link></Td><Td>{r.responsavel ?? "—"}</Td><Td>{r.telefone ?? "—"}</Td>
          <Td className="text-xs text-slate-600">{r.aluno_atual ? `${r.serie_atual ?? "aluno"} · ${r.unidade_atual ?? ""}` : "novo"}</Td><Td className="text-xs">{r.origem ? ORIGEM_LABEL[r.origem] ?? r.origem : "—"}</Td>
          <Td>{r.status ? <Badge v={r.status === "CONFIRMADA" ? "APROVADA" : r.status === "RESERVADA" ? "SOLICITADA" : "CANCELADA"} label={ENR_STATUS[r.status]} /> : r.fila ? <Badge v="PENDENTE" label="Na fila" /> : <span className="text-xs text-slate-400">sem vaga</span>}</Td><Td>{r.turma ? `${r.turma} · ${r.unidade}` : "—"}</Td>
        </tr>)}
      </Table>
    </Page>
  );
}
