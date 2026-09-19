import { requireSession, can } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge, Flash, Field, Btn, Input, Select, Textarea } from "@/components/ui";
import { brl } from "@/lib/operacoes";
import { salvarFornecedor } from "../actions";

export const dynamic = "force-dynamic";

export default async function Fornecedores({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams; const gest = can.operacoes(s);
  const rows = await sql<{ id: number; nome: string; servico: string | null; telefone: string | null; email: string | null; contrato: string | null; ativo: boolean; obs: string | null; os: number; custo_ano: number; avaliacao: number | null }[]>`SELECT f.*, (SELECT count(*) FROM work_orders w WHERE w.supplier_id=f.id)::int AS os, coalesce((SELECT sum(w.custo_real) FROM work_orders w WHERE w.supplier_id=f.id AND w.concluido_em >= date_trunc('year', now())),0)::float AS custo_ano, (SELECT avg(w.avaliacao)::numeric(3,2)::float FROM work_orders w WHERE w.supplier_id=f.id AND w.avaliacao IS NOT NULL) AS avaliacao FROM suppliers f ORDER BY f.ativo DESC, f.nome`;
  const Form = ({ f }: { f?: typeof rows[number] }) => <form action={salvarFornecedor} className="space-y-2">{f && <input type="hidden" name="id" value={f.id} />}<Field label="Nome"><Input name="nome" required defaultValue={f?.nome ?? ""} /></Field><Field label="Serviço"><Input name="servico" defaultValue={f?.servico ?? ""} placeholder="Ar-condicionado, elétrica, limpeza…" /></Field><div className="grid grid-cols-2 gap-2"><Field label="Telefone"><Input name="telefone" defaultValue={f?.telefone ?? ""} /></Field><Field label="E-mail"><Input name="email" defaultValue={f?.email ?? ""} /></Field></div><Field label="Contrato / condições"><Input name="contrato" defaultValue={f?.contrato ?? ""} /></Field><Field label="Observações"><Textarea name="obs" className="min-h-[40px]" defaultValue={f?.obs ?? ""} /></Field>{f && <Field label="Situação"><Select name="ativo" defaultValue={f.ativo ? "1" : "0"}><option value="1">Ativo</option><option value="0">Inativo</option></Select></Field>}<Btn small>{f ? "Salvar" : "Cadastrar"}</Btn></form>;
  return (
    <Page title="Fornecedores" sub="Prestadores de manutenção e serviços, com histórico de ordens, custo no ano e avaliação média dos atendimentos.">
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className={`grid gap-4 ${gest ? "lg:grid-cols-[1fr_340px]" : ""} lg:items-start`}>
        <Table head={["Fornecedor", "Serviço", "Contato", "Contrato", "OS", "Custo no ano", "Avaliação", "Situação", ""]} empty="Nenhum fornecedor.">{rows.map(f => <tr key={f.id} className={!f.ativo ? "opacity-50" : ""}><Td className="font-medium">{f.nome}</Td><Td className="text-xs">{f.servico ?? "—"}</Td><Td className="text-xs">{f.telefone ?? ""}<br />{f.email ?? ""}</Td><Td className="text-xs">{f.contrato ?? "—"}</Td><Td>{f.os}</Td><Td className="tabular-nums">{brl(f.custo_ano)}</Td><Td>{f.avaliacao ?? "—"}</Td><Td><Badge v={f.ativo ? "ATIVO" : "CANCELADA"} label={f.ativo ? "Ativo" : "Inativo"} /></Td><Td>{gest && <details className="relative"><summary className="cursor-pointer text-xs text-acao">Editar</summary><div className="mt-1 w-80 max-w-[85vw] rounded-md border border-line bg-white p-3 shadow-lg"><Form f={f} /></div></details>}</Td></tr>)}</Table>
        {gest && <Card title="Novo fornecedor"><Form /></Card>}
      </div>
    </Page>
  );
}
