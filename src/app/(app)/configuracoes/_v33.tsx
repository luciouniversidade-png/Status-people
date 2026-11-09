import { Card, Field, Input, Textarea, Btn } from "@/components/ui";
import { cfgForn, CRITICIDADE, DIMENSOES } from "@/lib/fornecedores";
import { salvarParametrosV33 } from "./v33-actions";

const P: Record<string, string> = { qualidade: "pQualidade", pontualidade: "pPontualidade", atendimento: "pAtendimento", custo: "pCusto", conformidade: "pConformidade" };

/** Configurações da v33: política de fornecedores (categorias × criticidade, documentos, prazos, pesos do scorecard e regras de exceção). */
export async function ParametrosV33() {
  const c = await cfgForn();
  return (
    <Card title="Fornecedores (v33) — categorias, documentos, homologação e scorecard" className="mb-4"><div id="v33" />
      <details className="rounded-md border border-line bg-white"><summary className="cursor-pointer px-3 py-2 text-sm font-medium text-navy">Política de fornecedores</summary>
        <form action={salvarParametrosV33} className="space-y-3 border-t border-line p-3">
          <p className="text-[11px] text-slate-500">Política proposta, não rol jurídico: a exigência concreta depende da atividade. Mudar a criticidade de uma categoria vale para os próximos cadastros — quem já está cadastrado muda na própria ficha. Os pesos do risco e do scorecard são hipótese até o piloto.</p>
          <Field label="Categorias e criticidade (uma por linha: Nome | alta, média ou baixa)"><Textarea name="categorias" defaultValue={c.categorias.map(([n, k]) => `${n} | ${CRITICIDADE[k].toLowerCase()}`).join("\n")} className="min-h-[180px] text-xs" /></Field>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {(["BAIXA", "MEDIA", "ALTA", "PF"] as const).map(k => <Field key={k} label={k === "PF" ? "Documentos — pessoa física (um por linha)" : `Documentos — criticidade ${CRITICIDADE[k].toLowerCase()} (um por linha)`}><Textarea name={`doc${k}`} defaultValue={(c.documentos[k] ?? []).join("\n")} className="min-h-[110px] text-xs" /></Field>)}
          </div>
          <Field label="Documentos a mais por categoria (Categoria | Documento)"><Textarea name="extras" defaultValue={c.extras.map(([a, b]) => `${a} | ${b}`).join("\n")} className="min-h-[120px] text-xs" /></Field>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Field label="Revalidar alta (meses)"><Input name="revALTA" defaultValue={c.revalidacaoMeses.ALTA} /></Field><Field label="Revalidar média (meses)"><Input name="revMEDIA" defaultValue={c.revalidacaoMeses.MEDIA} /></Field><Field label="Revalidar baixa (meses)"><Input name="revBAIXA" defaultValue={c.revalidacaoMeses.BAIXA} /></Field>
            <Field label="Avisar documento (dias antes)"><Input name="alerta" defaultValue={c.alertaDocumentosDias} /></Field><Field label="Convite do portal (dias)"><Input name="convite" defaultValue={c.conviteDias} /></Field><Field label="Concentração que pesa no risco (%)"><Input name="concentracao" defaultValue={c.concentracaoAlertaPct} /></Field>
          </div>
          <fieldset className="rounded-md border border-line p-2"><legend className="px-1 text-xs font-medium text-navy">Pesos do scorecard (somam 100)</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{DIMENSOES.map(([k, r]) => <Field key={k} label={r}><Input name={P[k]} defaultValue={c.pesos[k]} /></Field>)}</div></fieldset>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:items-end">
            <Field label="Cadastros anteriores à v33 valem até"><Input type="date" name="legadoAte" defaultValue={c.legadoAte} /></Field>
            <label className="flex items-start gap-1.5 text-xs"><input type="checkbox" name="vencidoBloqueiaAlta" value="1" defaultChecked={c.vencidoBloqueiaAlta} className="mt-0.5" /> Documento exigível vencido leva o fornecedor de criticidade alta a “em revalidação”</label>
            <label className="flex items-start gap-1.5 text-xs"><input type="checkbox" name="excecaoExigeAprovacao" value="1" defaultChecked={c.excecaoExigeAprovacao !== false} className="mt-0.5" /> Conta a pagar com exceção de fornecedor vai para a aprovação de outra pessoa (recomendado)</label>
          </div>
          <Btn small>Salvar política</Btn>
        </form>
      </details>
    </Card>
  );
}
