import { redirect } from "next/navigation";
import { requireSession, can } from "@/lib/auth";
import { Page, Flash, Card, Textarea, Btn, Field } from "@/components/ui";
import { importarCSV } from "../actions";

export const dynamic = "force-dynamic";

export default async function Importar({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const s = await requireSession(); if (!can.editar(s)) redirect("/colaboradores");
  const { erro } = await searchParams;
  return (
    <Page title="Importar colaboradores" sub="Envie a planilha do Excel diretamente ou cole as células copiadas. Cabeçalho na primeira linha; separador (tabulação, ; ou ,) e acentos são reconhecidos automaticamente.">
      <Flash erro={erro} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <form action={importarCSV} className="space-y-3">
          <Field label="1. Escolha a planilha (Excel .xlsx ou .csv)" hint="A primeira aba é lida. Não precisa converter para CSV."><input type="file" name="arquivo" accept=".xlsx,.xls,.csv,.txt" className="block w-full rounded-md border border-line bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-acao file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white" /></Field>
          <Field label="2. …ou cole o conteúdo (selecionar células no Excel → Ctrl+C → Ctrl+V aqui)"><Textarea name="csv" className="min-h-[220px] font-mono text-xs" placeholder={"nome\tunidade\tcargo\tempresa\tvinculo\tadmissao\temail\ttelefone\tjornada_min_dia\tturno\nMaria da Silva\tCarandá\tProfessor\tColégio Status LTDA\tCLT\t03/08/2026\tmaria@...\t67 9...\t528\tMatutino"} /></Field>
          <Btn pendingText="Importando…">Importar</Btn>
        </form>
        <Card title="Como preparar a planilha">
          <ul className="space-y-2 text-sm text-slate-700">
            <li>Primeira linha = cabeçalho. Obrigatórios: <b>nome</b>, <b>unidade</b>, <b>admissao</b>.</li>
            <li>Opcionais: cargo, empresa, vinculo (CLT, HORISTA, ESTAGIARIO, PJ, TEMPORARIO), email, telefone, jornada_min_dia, turno.</li>
            <li>Unidade aceita nome (Carandá, TV Morena I…) ou código (CAR, TVM1, TVM2, CUL).</li>
            <li>Cargo e empresa são casados pelo nome cadastrado em Configurações; se não bater, ficam em branco para você completar depois.</li>
            <li>Data em DD/MM/AAAA ou AAAA-MM-DD. Cabeçalho pode ter acento e maiúsculas (Admissão, E-mail, Vínculo…).</li>
            <li>Linhas com erro são puladas e listadas no resumo. Nada é sobrescrito.</li>
          </ul>
        </Card>
      </div>
    </Page>
  );
}
