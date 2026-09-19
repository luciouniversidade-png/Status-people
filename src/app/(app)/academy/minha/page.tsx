import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge } from "@/components/ui";
import { fmtData, hoje } from "@/lib/utils";
import { COURSE_TIPO, COURSE_FORMATO, PROG_STATUS, matrizTreinamento } from "@/lib/clima-academy";

export const dynamic = "force-dynamic";

export default async function Meus() {
  const s = await requireSession(); const h = hoje();
  if (!s.employeeId) return <Page title="Meus treinamentos"><Card><p className="text-sm text-slate-600">Seu acesso não está vinculado a um cadastro de colaborador.</p></Card></Page>;
  const [e] = await sql<{ unit_id: number }[]>`SELECT unit_id FROM employees WHERE id=${s.employeeId}`;
  const m = await matrizTreinamento(e?.unit_id ?? null); const linha = m.linhas.find(l => l.emp.id === s.employeeId);
  const outros = await sql<{ codigo: string; titulo: string; tipo: string; formato: string; status: string; concluido_em: string | null; valido_ate: string | null; link: string | null }[]>`SELECT c.codigo, c.titulo, c.tipo, c.formato, p.status, p.concluido_em::text, p.valido_ate::text, c.link FROM training_progress p JOIN courses c ON c.id=p.course_id WHERE p.employee_id=${s.employeeId} AND c.tipo='OPCIONAL' ORDER BY p.updated_at DESC`;
  return (
    <Page title="Meus treinamentos" sub={linha ? `${linha.ok} de ${linha.total} obrigatórios concluídos${linha.pct !== null ? ` (${linha.pct}%)` : ""}` : "Nenhum treinamento obrigatório para o seu cargo."}>
      <Card title="Obrigatórios e trilha do cargo">
        <Table head={["Treinamento", "Tipo", "Formato", "Situação", "Concluído em", "Válido até"]} empty="Nenhum treinamento exigido.">{(linha?.itens ?? []).map(i => <tr key={i.curso.id}><Td><span className="font-medium">{i.curso.codigo}</span> {i.curso.titulo}</Td><Td className="text-xs">{COURSE_TIPO[i.curso.tipo]}</Td><Td className="text-xs">{COURSE_FORMATO[i.curso.formato]}{i.curso.formato === "POP" && i.status !== "CONCLUIDO" && <span> · <a className="text-acao" href="/governanca/pops">dar ciência</a></span>}</Td><Td><Badge v={i.status === "CONCLUIDO" ? (i.vencendo ? "VENCE_EM_BREVE" : "APROVADA") : i.status === "VENCIDO" ? "VENCIDO" : "PENDENTE"} label={i.status === "CONCLUIDO" && i.vencendo ? "Concluído · vence em breve" : PROG_STATUS[i.status]} /></Td><Td className="text-xs">{fmtData(i.concluidoEm)}</Td><Td className={`text-xs ${i.validoAte && i.validoAte < h ? "text-erro" : ""}`}>{fmtData(i.validoAte)}</Td></tr>)}</Table>
      </Card>
      {outros.length > 0 && <Card title="Outros treinamentos" className="mt-4"><Table head={["Treinamento", "Formato", "Situação", "Concluído em"]}>{outros.map((o, i) => <tr key={i}><Td>{o.codigo} {o.titulo}{o.link && <> · <a className="text-acao" href={o.link} target="_blank" rel="noreferrer">material</a></>}</Td><Td className="text-xs">{COURSE_FORMATO[o.formato]}</Td><Td><Badge v={o.status === "CONCLUIDO" ? "APROVADA" : "PENDENTE"} label={PROG_STATUS[o.status]} /></Td><Td className="text-xs">{fmtData(o.concluido_em)}</Td></tr>)}</Table></Card>}
    </Page>
  );
}
