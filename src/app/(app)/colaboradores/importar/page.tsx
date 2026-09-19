import { redirect } from "next/navigation";
import { requireSession, can } from "@/lib/auth";
import { Page, Flash, Card, Textarea, Btn, Field } from "@/components/ui";
import { importarCSV } from "../actions";

export const dynamic = "force-dynamic";

export default async function Importar({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const s = await requireSession(); if (!can.editar(s)) redirect("/colaboradores");
  const { erro } = await searchParams;
  return (
    <Page title="Importar colaboradores" sub="Cole aqui o conteúdo da planilha salva como CSV (Excel: Salvar como → CSV UTF-8).">
      <Flash erro={erro} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <form action={importarCSV} className="space-y-3">
          <Field label="Conteúdo CSV"><Textarea name="csv" className="min-h-[320px] font-mono text-xs" placeholder={"nome;unidade;cargo;empresa;vinculo;admissao;email;telefone;jornada_min_dia;turno\nMaria da Silva;Carandá;Professor;Colégio Status LTDA;CLT;03/08/2026;maria@...;67 9...;528;Matutino"} required /></Field>
          <Btn>Importar</Btn>
        </form>
        <Card title="Como preparar a planilha">
          <ul className="space-y-2 text-sm text-slate-700">
            <li>Primeira linha = cabeçalho. Obrigatórios: <b>nome</b>, <b>unidade</b>, <b>admissao</b>.</li>
            <li>Opcionais: cargo, empresa, vinculo (CLT, HORISTA, ESTAGIARIO, PJ, TEMPORARIO), email, telefone, jornada_min_dia, turno.</li>
            <li>Unidade aceita nome (Carandá, TV Morena I…) ou código (CAR, TVM1, TVM2, CUL).</li>
            <li>Cargo e empresa são casados pelo nome cadastrado em Configurações; se não bater, ficam em branco para você completar depois.</li>
            <li>Data em DD/MM/AAAA ou AAAA-MM-DD. Separador ; ou ,.</li>
            <li>Linhas com erro são puladas e listadas no resumo. Nada é sobrescrito.</li>
          </ul>
        </Card>
      </div>
    </Page>
  );
}
