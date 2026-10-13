import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { requireSession, scopeUnit, can } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge, Flash, Field, Btn, Select, Input } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { fmtData } from "@/lib/utils";
import { consentimentosAtuais, finalidades, podePrivacidade, CONSENT_STATUS } from "@/lib/privacidade";

export const dynamic = "force-dynamic";
const TOM: Record<string, string> = { CONCEDIDO: "APROVADA", NEGADO: "NEUTRO", REVOGADO: "REJEITADA", SEM_REGISTRO: "PENDENTE" };

/** Situação das autorizações por aluno — inclui a lista para eventos e fotos (quem NÃO pode aparecer). */
export default async function Consentimentos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (s.role === "COLABORADOR") redirect("/conta");
  const sp = await searchParams; const escopo = scopeUnit(s);
  if (!(can.reservar(s) || await podePrivacidade(s) || s.role === "LEITURA")) redirect("/");
  const [fins, units, grades] = await Promise.all([finalidades(), sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ${escopo === null ? sql`` : sql`WHERE id=${escopo}`} ORDER BY nome`, sql<{ id: number; nome: string }[]>`SELECT id, nome FROM grades ORDER BY ordem`]);
  const unidade = escopo ?? (sp.unidade ? Number(sp.unidade) : null); const fin = sp.finalidade ? Number(sp.finalidade) : fins[0]?.id; const so = sp.so ?? ""; const aluno = sp.aluno ? Number(sp.aluno) : null;
  const alunos = await sql<{ id: number; nome: string; serie: string | null; unidade: string | null }[]>`SELECT st.id, st.nome, g.nome AS serie, u.nome AS unidade FROM students st LEFT JOIN grades g ON g.id=st.serie_atual_id LEFT JOIN units u ON u.id=st.unit_atual_id WHERE st.aluno_atual ${unidade === null ? sql`` : sql`AND st.unit_atual_id=${unidade}`} ${sp.serie ? sql`AND st.serie_atual_id=${Number(sp.serie)}` : sql``} ${aluno ? sql`AND st.id=${aluno}` : sql``} ORDER BY u.nome, g.ordem NULLS LAST, st.nome LIMIT 2000`;
  const atual = await consentimentosAtuais(alunos.map(a => a.id));
  const st = (sid: number, pid: number) => atual.get(`${sid}:${pid}`)?.status ?? "SEM_REGISTRO";
  const lista = so === "SEM" ? alunos.filter(a => fin && st(a.id, fin) !== "CONCEDIDO") : so === "COM" ? alunos.filter(a => fin && st(a.id, fin) === "CONCEDIDO") : alunos;
  const f = fins.find(x => x.id === fin);
  return (
    <Page title="Autorizações de imagem e divulgação" sub="Situação vigente de cada aluno por finalidade. Para eventos e fotos, filtre “sem autorização” e imprima a lista." actions={<PrintButton />}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-4 grid grid-cols-2 items-end gap-2 rounded-md border border-line bg-white p-3 print:hidden sm:flex sm:flex-wrap">
        {!escopo && <Field label="Unidade"><Select name="unidade" defaultValue={unidade ?? ""}><option value="">Todas</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
        <Field label="Série"><Select name="serie" defaultValue={sp.serie ?? ""}><option value="">Todas</option>{grades.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}</Select></Field>
        <Field label="Finalidade"><Select name="finalidade" defaultValue={fin ?? ""}>{fins.map(x => <option key={x.id} value={x.id}>{x.titulo}</option>)}</Select></Field>
        <Field label="Mostrar"><Select name="so" defaultValue={so}><option value="">Todos</option><option value="SEM">Sem autorização (não podem aparecer)</option><option value="COM">Com autorização</option></Select></Field>
        <Btn kind="ghost">Filtrar</Btn>
      </form>
      {so === "SEM" && f && <Card className="mb-3 border-amber-300"><p className="text-sm"><b>{lista.length} aluno(s) sem autorização para “{f.titulo}”.</b> Não usar imagem destes alunos nesta finalidade (sem registro conta como não autorizado).</p></Card>}
      <Table head={["Aluno", "Série", ...fins.map(x => x.titulo)]} empty="Nenhum aluno atual neste filtro.">
        {lista.map(a => <tr key={a.id}><Td><Link className="text-acao" href={`/matriculas/alunos/${a.id}#autorizacoes`}>{a.nome}</Link>{!escopo && <div className="text-[11px] text-slate-500">{a.unidade}</div>}</Td><Td>{a.serie ?? "—"}</Td>
          {fins.map(x => { const c = atual.get(`${a.id}:${x.id}`); const v = c?.status ?? "SEM_REGISTRO"; return <Td key={x.id}><Badge v={TOM[v]} label={CONSENT_STATUS[v]} />{c && <div className="text-[10px] text-slate-500">{fmtData(c.em.slice(0, 10))}{c.versao !== x.versao ? ` · texto v${c.versao}` : ""}</div>}</Td>; })}</tr>)}
      </Table>
      <form className="mt-3 flex flex-wrap items-end gap-2 print:hidden"><Field label="Ver um aluno (código)"><Input name="aluno" type="number" defaultValue={aluno ?? ""} className="w-32" /></Field><Btn small kind="ghost">Ver</Btn></form>
    </Page>
  );
}
