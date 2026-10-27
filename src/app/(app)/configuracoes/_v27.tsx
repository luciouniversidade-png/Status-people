import { Card, Field, Input, Textarea, Btn } from "@/components/ui";
import { getSettings } from "@/lib/utils";
import { salvarParametrosV27 } from "./v27-actions";

/** Configurações da v27: contas a pagar (Direção) e contratos com prazo (RH e Direção). */
export async function ParametrosV27() {
  const cfg = await getSettings(); const c = cfg.contasPagar; const p = cfg.contratosPrazo; const aprov = (cfg.alcadas.contasPagar ?? ["DIRECAO"]) as string[]; const manual = (c.baixaManualPerfis ?? []) as string[]; const nats = (c.naturezaSempreAprova ?? []) as string[];
  const Sec = ({ id, titulo, children, nota }: { id: string; titulo: string; children: React.ReactNode; nota?: string }) => <details className="rounded-md border border-line bg-white" id={`v27-${id}`}><summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-navy">{titulo}</summary><form action={salvarParametrosV27} className="space-y-2 border-t border-line p-3"><input type="hidden" name="secao" value={id} />{children}{nota && <p className="text-[11px] text-slate-500">{nota}</p>}<Btn small>Salvar</Btn></form></details>;
  const Check = ({ name, value, on, rotulo }: { name: string; value: string; on: boolean; rotulo: string }) => <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name={name} value={value} defaultChecked={on} /> {rotulo}</label>;
  const brl = (v: number) => String(v).replace(".", ",");
  return (
    <Card title="Contas a pagar e contratos com prazo (v27) — regras e parâmetros" className="mb-4"><div id="v27" />
      <div className="space-y-2">
        <Sec id="contas" titulo="Contas a pagar — alçada, dupla checagem, dia útil e baixa" nota="Alçada vale para o compromisso total do título (parcelado: o total; recorrente: a soma das parcelas). Dupla checagem: duas pessoas diferentes com a alçada aprovam (0 desliga). Feriados locais entram no ajuste do vencimento para o próximo dia útil bancário. Só a Direção altera.">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field label="Alçada a partir de (R$)"><Input name="alcada" defaultValue={brl(Number(c.alcadaValor))} /></Field>
            <Field label="Dupla checagem a partir de (R$)"><Input name="dupla" defaultValue={brl(Number(c.alcadaDuplaValor ?? 0))} /></Field>
            <Field label="Aviso de vencimento (dias)"><Input name="alerta" defaultValue={Number(c.alertaDias)} /></Field>
            <Field label="Janela do extrato (dias)"><Input name="janela" defaultValue={Number(c.janelaExtratoDias)} /></Field>
          </div>
          <fieldset><legend className="text-xs font-medium text-slate-600">Quem aprova</legend><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1"><Check name="aprovadores" value="DIRECAO" on={aprov.includes("DIRECAO")} rotulo="Direção" /><Check name="aprovadores" value="FINANCEIRO" on={aprov.includes("FINANCEIRO")} rotulo="Financeiro" /></div></fieldset>
          <fieldset><legend className="text-xs font-medium text-slate-600">Baixa manual (exceção sem débito do extrato)</legend><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1"><Check name="manual" value="DIRECAO" on={manual.includes("DIRECAO")} rotulo="Direção" /><Check name="manual" value="FINANCEIRO" on={manual.includes("FINANCEIRO")} rotulo="Financeiro" /></div></fieldset>
          <fieldset><legend className="text-xs font-medium text-slate-600">Natureza que sempre passa pela aprovação, de qualquer valor</legend><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1"><Check name="naturezas" value="INVESTIMENTO" on={nats.includes("INVESTIMENTO")} rotulo="Investimento (obra, reforma, equipamento)" /><Check name="naturezas" value="EXTRAORDINARIA" on={nats.includes("EXTRAORDINARIA")} rotulo="Extraordinária (não se repete)" /></div></fieldset>
          <div className="flex flex-wrap gap-x-4 gap-y-1"><Check name="orcamento" value="1" on={!!c.exigirOrcamento} rotulo="Fora do orçamento da categoria no mês também pede aprovação" /><Check name="segregar" value="1" on={!!c.segregarAprovarPagar} rotulo="Quem aprovou não registra o pagamento (segregação de funções)" /></div>
          <div className="flex flex-wrap gap-x-4 gap-y-1"><Check name="diaUtil" value="1" on={!!c.ajustarDiaUtil} rotulo="Ajustar vencimentos para dia útil (padrão do lançamento)" /><Check name="carnaval" value="1" on={c.carnavalSemBanco !== false} rotulo="Carnaval sem banco" /><Check name="corpus" value="1" on={c.corpusChristiSemBanco !== false} rotulo="Corpus Christi sem banco" /></div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="Feriados locais (DD/MM, um por linha)" hint="Campo Grande: 13/06 (Santo Antônio) e 26/08 (aniversário da cidade); MS: 11/10."><Textarea name="feriados" defaultValue={(c.feriadosLocais as string[]).map(x => x.split("-").reverse().join("/")).join("\n")} className="min-h-[90px] font-mono text-xs" /></Field>
            <Field label="Tipos de documento (um por linha)"><Textarea name="tipos" defaultValue={(c.tiposDocumento as string[]).join("\n")} className="min-h-[90px] text-xs" /></Field>
          </div>
        </Sec>
        <Sec id="prazos" titulo="Contratos com prazo — experiência, estágio e temporário" nota="Experiência: CLT art. 445, parágrafo único (até 90 dias, uma prorrogação). Estágio: Lei 11.788/2008, art. 11 (até 2 anos, exceto pessoa com deficiência). Temporário: Lei 6.019/1974, art. 10 (180 + 90 dias). RH ou Direção alteram.">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Field label="Experiência: 1º período (dias)"><Input name="exp1" defaultValue={Number(p.experienciaPrimeiroDias)} /></Field>
            <Field label="Experiência: total (dias)"><Input name="expTotal" defaultValue={Number(p.experienciaTotalDias)} /></Field>
            <Field label="Aviso antes do vencimento (dias)"><Input name="aviso" defaultValue={Number(p.avisoDias)} /></Field>
            <Field label="Estágio: limite (meses)"><Input name="estagio" defaultValue={Number(p.estagioMaxMeses)} /></Field>
            <Field label="Temporário: prazo (dias)"><Input name="temp" defaultValue={Number(p.temporarioDias)} /></Field>
            <Field label="Temporário: prorrogação (dias)"><Input name="tempProrr" defaultValue={Number(p.temporarioProrrogacaoDias)} /></Field>
          </div>
        </Sec>
      </div>
    </Card>
  );
}
