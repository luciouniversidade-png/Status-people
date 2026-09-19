import { redirect } from "next/navigation";
import { requireFinanceiro, can } from "@/lib/auth";
import { db, schema } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Flash, Field, Select, Btn, Textarea } from "@/components/ui";
import { importarTitulos } from "../actions";

export const dynamic = "force-dynamic";

export default async function Importar({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireFinanceiro(); if (!can.financeiro(s)) redirect("/financeiro"); const sp = await searchParams; const units = await db.select().from(schema.units).orderBy(asc(schema.units.nome));
  return (
    <Page title="Importar títulos do ActiveSoft" sub="Cole a exportação de títulos (em aberto ou recebidos). O sistema casa o aluno com o cadastro, atualiza títulos já importados e não duplica." actions={<Btn kind="ghost" href="/financeiro">Painel</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px] lg:items-start">
        <form action={importarTitulos} className="space-y-3"><Field label="Unidade padrão (quando o CSV não trouxer a coluna unidade)"><Select name="unitId" defaultValue=""><option value="">—</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Field label="CSV"><Textarea name="csv" className="min-h-[320px] font-mono text-xs" required placeholder={"titulo;aluno;responsavel;telefone;unidade;tipo;competencia;vencimento;valor;pago_em;valor_pago;status\n123456;Ana Souza;Carla Souza;67 99999-0000;Carandá;Mensalidade;09/2026;10/09/2026;1.850,00;;;aberto\n123457;Bruno Lima;;;TV Morena I;Mensalidade;09/2026;10/09/2026;1.850,00;09/09/2026;1.850,00;pago"} /></Field><Btn>Importar</Btn></form>
        <Card title="Colunas aceitas"><ul className="space-y-2 text-sm text-slate-700"><li><b>Obrigatórias:</b> aluno, vencimento, valor.</li><li><b>Opcionais:</b> titulo (nº no ActiveSoft — permite atualizar depois), unidade, tipo (mensalidade, integral, material, taxa), competencia (MM/AAAA), responsavel, telefone, pago_em, valor_pago, status (aberto/pago/cancelado).</li><li>Datas em DD/MM/AAAA; valores em 1.850,00 ou 1850.00.</li><li>Reimportar o mesmo arquivo atualiza os títulos (por nº do título ou por aluno + vencimento + valor). Títulos em acordo não voltam a "aberto" pela importação.</li><li>Depois de importar, a régua de cobrança aparece em <b>Inadimplência</b> e o realizado em <b>Receita</b>.</li></ul></Card>
      </div>
    </Page>
  );
}
