import { redirect } from "next/navigation";
import { requireStaff, can } from "@/lib/auth";
import { Page, Flash, Card, Textarea, Btn, Field } from "@/components/ui";
import { importarHistoricoFerias } from "../actions";

export const dynamic = "force-dynamic";

/** Carga inicial (v24.1): férias gozadas antes do sistema. Junto com “Férias quitadas até” na ficha, evita períodos antigos aparecendo como vencidos. */
export default async function ImportarHistoricoFerias({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const s = await requireStaff(); if (!can.editar(s)) redirect("/ferias");
  const { erro } = await searchParams;
  return (
    <Page title="Importar histórico de férias" sub="Carga inicial: férias já gozadas antes do sistema entram como férias aprovadas no período aquisitivo certo — sem pedido, sem aprovação e sem aviso a ninguém." actions={<Btn kind="ghost" href="/ferias">Férias e afastamentos</Btn>}>
      <Flash erro={erro} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <form action={importarHistoricoFerias} className="space-y-3">
          <Field label="Conteúdo CSV"><Textarea name="csv" className="min-h-[300px] font-mono text-xs" placeholder={"nome;inicio;fim;dias;unidade\nMaria da Silva;02/01/2026;31/01/2026;;Carandá\nJoão Pereira;10/07/2025;29/07/2025;30;Cultura"} /></Field>
          <Field label="Ou envie o arquivo (.xlsx/.xls/.csv)"><input type="file" name="arquivo" accept=".xlsx,.xls,.xlsm,.csv,.txt" className="block w-full rounded-md border border-line bg-white px-2 py-1.5 text-xs file:mr-2 file:rounded file:border-0 file:bg-acao file:px-2 file:py-1 file:text-xs file:text-white" /></Field>
          <Btn>Importar histórico</Btn>
        </form>
        <div className="space-y-4">
          <Card title="Como preparar">
            <ul className="space-y-2 text-sm text-slate-700">
              <li>Cabeçalho obrigatório: <b>nome; inicio; fim</b> (DD/MM/AAAA). Opcionais: <b>dias</b> e <b>unidade</b> (para desempatar nomes iguais).</li>
              <li><b>dias</b> é o que sai do saldo do período. Vazio = dias corridos entre início e fim. Com abono (venda de 10 dias), informe 30 para 20 dias gozados.</li>
              <li>Cada linha entra no período aquisitivo mais antigo com saldo que já tinha começado no início das férias — a mesma regra de um pedido novo.</li>
              <li>Só histórico: férias que ainda vão começar entram como pedido normal, em Férias e afastamentos.</li>
              <li>Rodar de novo não duplica (mesma pessoa, início e fim). Sobreposição com outro afastamento é erro da linha; as demais seguem.</li>
            </ul>
          </Card>
          <Card title="Antes de importar">
            <p className="text-sm text-slate-700">Para quem tem muitos anos de casa, preencha na ficha (ou na planilha de colaboradores) o campo <b>Férias quitadas até</b>: os períodos encerrados até essa data contam como quitados. Importe aqui só as férias dos períodos seguintes.</p>
          </Card>
        </div>
      </div>
    </Page>
  );
}
