import { Card, Field, Input, Textarea, Btn } from "@/components/ui";
import { getSettings } from "@/lib/utils";
import { salvarParametrosV31 } from "./v31-actions";

/** Configurações da v31: 1:1 (temas e duração), feedback (limites e pedidos), 360° (pares sugeridos e teto de convites) e PDI (alvo de adesão). */
export async function ParametrosV31() {
  const cfg = await getSettings(); const c = cfg.conversas; const d = cfg.desempenho;
  return (
    <Card title="Conversas e desenvolvimento (v31) — 1:1, feedback, 360° e PDI" className="mb-4"><div id="v31" />
      <details className="rounded-md border border-line bg-white" id="v31-conversas"><summary className="cursor-pointer px-3 py-2 text-sm font-medium text-navy">Parâmetros</summary>
        <form action={salvarParametrosV31} className="space-y-3 border-t border-line p-3">
          <p className="text-[11px] text-slate-500">A cadência de 1:1 (dias) por família de cargo é a mesma do acompanhamento (Desempenho → periodicidade por família). O conteúdo das 1:1 e dos feedbacks entre colegas nunca aparece para a gestão — só contagens.</p>
          <Field label="Temas da 1:1 (um por linha, até 20)"><Textarea name="temas" defaultValue={(c.temas as string[]).join("\n")} className="min-h-[160px] text-xs" /></Field>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field label="Duração padrão da 1:1 (min)"><Input name="duracao" defaultValue={Number(c.duracaoMin)} /></Field>
            <Field label="Feedbacks por pessoa por dia"><Input name="limite" defaultValue={Number(c.feedbackLimiteDia)} /></Field>
            <Field label="Prazo do pedido de feedback (dias)"><Input name="prazo" defaultValue={Number(c.pedidoPrazoDias)} /></Field>
            <Field label="Pessoas por pedido de feedback"><Input name="pessoas" defaultValue={Number(c.pedidoMaxPessoas)} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Field label="360°: pares sugeridos por avaliado"><Input name="pares" defaultValue={Number(d.paresSugeridos)} /></Field>
            <Field label="360°: teto de convites por avaliador"><Input name="teto" defaultValue={Number(d.maxConvitesPorAvaliador)} /></Field>
            <Field label="PDI: adesão esperada por líder (%)"><Input name="adesao" defaultValue={Number(d.pdiAdesaoAlvo)} /></Field>
          </div>
          <Btn small>Salvar</Btn>
        </form>
      </details>
    </Card>
  );
}
