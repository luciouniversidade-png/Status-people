import { redirect } from "next/navigation";
import { requireStaff, can } from "@/lib/auth";
import { Page, Flash, Card, Textarea, Btn, Field, Input } from "@/components/ui";
import { hoje } from "@/lib/utils";
import { importarSaldos } from "../actions";

export const dynamic = "force-dynamic";

export default async function Importar({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const s = await requireStaff(); if (!can.editar(s)) redirect("/banco-de-horas");
  const { erro } = await searchParams;
  return (
    <Page title="Importar saldos do banco de horas" sub="Traz o saldo atual de cada colaborador da planilha para o sistema, como um ajuste aprovado na data do fechamento.">
      <Flash erro={erro} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <form action={importarSaldos} className="space-y-3">
          <Field label="Data do fechamento (vale para as linhas sem coluna data)"><Input name="data" type="date" defaultValue={hoje()} className="max-w-[200px]" /></Field>
          <Field label="Conteúdo CSV"><Textarea name="csv" className="min-h-[300px] font-mono text-xs" placeholder={"nome;saldo;unidade\nAdrielly ...;-4215;Carandá\nLetícia ...;228\nKawan ...;16:05"} /></Field><Field label="Ou envie o arquivo (.xlsx/.xls/.csv)"><input type="file" name="arquivo" accept=".xlsx,.xls,.xlsm,.csv,.txt" className="block w-full rounded-md border border-line bg-white px-2 py-1.5 text-xs file:mr-2 file:rounded file:border-0 file:bg-acao file:px-2 file:py-1 file:text-xs file:text-white" /></Field>
          <Btn>Importar saldos</Btn>
        </form>
        <Card title="Como preparar">
          <ul className="space-y-2 text-sm text-slate-700">
            <li>Cabeçalho obrigatório: <b>nome; saldo</b>. Opcionais: <b>data</b> (DD/MM/AAAA) e <b>unidade</b> (para desempatar nomes iguais).</li>
            <li>Saldo em minutos (ex.: <code>-4215</code>, como na planilha _RESUMO) ou em horas <code>hh:mm</code> com sinal (ex.: <code>-70:15</code>, <code>16:05</code>).</li>
            <li>Nome é casado com o cadastro (sem acentos, sem diferença de maiúsculas). Se houver dois iguais, informe a unidade.</li>
            <li>Cada linha vira um lançamento <b>Ajuste</b> aprovado com a descrição “Saldo importado da planilha”. Rodar de novo com a mesma data não duplica.</li>
            <li>Saldo zero é pulado. Linhas com erro são listadas no resumo; nada é sobrescrito.</li>
          </ul>
        </Card>
      </div>
    </Page>
  );
}
