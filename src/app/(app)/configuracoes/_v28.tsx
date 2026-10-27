import { Card, Field, Input, Textarea, Btn } from "@/components/ui";
import { getSettings } from "@/lib/utils";
import { MESES_CURTOS } from "@/lib/formato";
import { salvarParametrosV28 } from "./v28-actions";

/** Configurações da v28: plano de contas e centros de custo, o que não é despesa e os valores iniciais do orçamento pelo histórico. Só a Direção altera. */
export async function ParametrosV28() {
  const cfg = await getSettings(); const pc = cfg.planoContas; const oh = cfg.orcamentoHistorico; const nd = (cfg.dre.naoDespesa ?? []) as string[];
  const Sec = ({ id, titulo, children, nota }: { id: string; titulo: string; children: React.ReactNode; nota?: string }) => <details className="rounded-md border border-line bg-white" id={`v28-${id}`}><summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-navy">{titulo}</summary><form action={salvarParametrosV28} className="space-y-2 border-t border-line p-3"><input type="hidden" name="secao" value={id} />{children}{nota && <p className="text-[11px] text-slate-500">{nota}</p>}<Btn small>Salvar</Btn></form></details>;
  const Check = ({ name, on, rotulo }: { name: string; on: boolean; rotulo: string }) => <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name={name} value="1" defaultChecked={on} /> {rotulo}</label>;
  const n = (v: unknown) => String(Number(v)).replace(".", ",");
  return (
    <Card title="Plano de contas, centros de custo e orçamento pelo histórico (v28)" className="mb-4"><div id="v28" />
      <div className="space-y-2">
        <Sec id="plano" titulo="Plano de contas e centros de custo — o que é obrigatório" nota="Conta obrigatória em contas a pagar: a categoria do caixa, da DRE e do orçamento vem da conta. Centro obrigatório: todo lançamento classificado indica o centro (sem ele, fica na unidade que pagou). Só a Direção altera.">
          <div className="flex flex-wrap gap-x-4 gap-y-1"><Check name="exigirConta" on={pc.exigirContaContasPagar !== false} rotulo="Conta a pagar nasce com a conta do plano" /><Check name="exigirCentro" on={!!pc.exigirCentroCusto} rotulo="Centro de custo obrigatório ao classificar" /></div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Field label="Conta genérica: meta até (%)"><Input name="metaGenerica" defaultValue={n(pc.metaGenericaPct)} /></Field><Field label="Fila de classificação (dias)"><Input name="janela" defaultValue={n(pc.janelaClassificacaoDias)} /></Field></div>
          <Field label="Saídas que não são despesa (uma categoria por linha)" hint="Saem do caixa, mas ficam fora da DRE, do orçado × realizado e do orçamento: principal de dívida, adiantamentos."><Textarea name="naoDespesa" defaultValue={nd.join("\n")} className="min-h-[70px] text-xs" /></Field>
        </Sec>
        <Sec id="orcamento" titulo="Orçamento pelo histórico — valores iniciais de cada ano" nota="Cada orçamento anual guarda os próprios parâmetros na tela do orçamento pelo histórico; aqui ficam os valores com que um ano novo começa.">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Field label="IPCA no ano (%)"><Input name="ipca" defaultValue={n(oh.ipcaPct)} /></Field><Field label="Dissídio (%)"><Input name="dissidio" defaultValue={n(oh.dissidioPct)} /></Field>
            <Field label="Mês do dissídio"><select name="mesDissidio" defaultValue={String(oh.mesDissidio ?? 3)} className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm">{MESES_CURTOS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></Field>
            <Field label="Reajuste da mensalidade (%)"><Input name="mensalidade" defaultValue={n(oh.reajusteMensalidadePct)} /></Field>
            <Field label="Mês do reajuste"><select name="mesMensalidade" defaultValue={String(oh.mesReajusteMensalidade ?? 1)} className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm">{MESES_CURTOS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></Field>
            <Field label="Consumo nas férias (×)"><Input name="ferias" defaultValue={n(oh.fatorFerias)} /></Field>
            <Field label="Pico: × a mediana"><Input name="outlier" defaultValue={n(oh.outlierFator)} /></Field><Field label="Pico: R$ acima"><Input name="outlierMin" defaultValue={n(oh.outlierMinimo)} /></Field>
            <Field label="Evento a confirmar (R$)"><Input name="evento" defaultValue={n(oh.eventoMinimo ?? 5000)} /></Field>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs"><span className="text-slate-600">Férias escolares:</span>{MESES_CURTOS.map((m, i) => <label key={m} className="inline-flex items-center gap-1"><input type="checkbox" name="mesesFerias" value={i + 1} defaultChecked={((oh.mesesFerias ?? []) as number[]).includes(i + 1)} />{m}</label>)}</div>
          <Check name="contratos" on={oh.usarContratos !== false} rotulo="Piso dos contratos vigentes e títulos a pagar já lançados para o ano" />
        </Sec>
      </div>
    </Card>
  );
}
