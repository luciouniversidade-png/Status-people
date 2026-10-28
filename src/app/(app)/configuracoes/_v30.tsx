import { Card, Field, Input, Textarea, Btn } from "@/components/ui";
import { getSettings } from "@/lib/utils";
import { FAMILIAS } from "@/lib/avaliacao";
import { salvarParametrosV30 } from "./v30-actions";

/** Configurações da v30: recrutamento (página pública, avaliadores, qualidade), igualdade salarial, calibração, pesquisa de liderança, Academy e benefícios. */
export async function ParametrosV30() {
  const cfg = await getSettings(); const r = cfg.recrutamento; const pag = r.paginaPublica as { ativa?: boolean; titulo?: string; texto?: string; limitePorHora?: number }; const ig = cfg.igualdade; const d = cfg.desempenho; const li = cfg.clima.lideranca; const ref = d.referencia as Record<string, number>;
  const Sec = ({ id, titulo, children, nota }: { id: string; titulo: string; children: React.ReactNode; nota?: string }) => <details className="rounded-md border border-line bg-white" id={`v30-${id}`}><summary className="cursor-pointer px-3 py-2 text-sm font-medium text-navy">{titulo}</summary><form action={salvarParametrosV30} className="space-y-3 border-t border-line p-3"><input type="hidden" name="secao" value={id} />{nota && <p className="text-[11px] text-slate-500">{nota}</p>}{children}<Btn small>Salvar</Btn></form></details>;
  const Check = ({ name, value, on, rotulo }: { name: string; value: string; on: boolean; rotulo: string }) => <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name={name} value={value} defaultChecked={on} /> {rotulo}</label>;
  return (
    <Card title="Pessoas (v30) — recrutamento, igualdade salarial, calibração, liderança, Academy e benefícios" className="mb-4"><div id="v30" />
      <div className="space-y-2">
        <Sec id="recrutamento" titulo="Recrutamento — página de vagas, avaliadores e qualidade da contratação" nota="A página pública de vagas (Trabalhe conosco) só liga com a decisão da Direção — depois do GO da homologação. Cada vaga ainda escolhe se aparece nela.">
          <div className="flex flex-wrap gap-x-4 gap-y-1"><Check name="paginaAtiva" value="1" on={!!pag?.ativa} rotulo="Página pública de vagas ligada (só a Direção liga)" /></div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Field label="Título da página"><Input name="paginaTitulo" defaultValue={pag?.titulo ?? ""} /></Field><Field label="Candidaturas por endereço por hora"><Input name="paginaLimite" defaultValue={Number(pag?.limitePorHora ?? 5)} /></Field></div>
          <Field label="Texto de abertura"><Textarea name="paginaTexto" defaultValue={pag?.texto ?? ""} className="min-h-[60px] text-xs" /></Field>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field label="Prazo do avaliador (dias)"><Input name="avaliacaoPrazo" defaultValue={Number(r.avaliacaoPrazoDias)} /></Field>
            <Field label="Gestor avalia a contratação (dias)"><Input name="satisfacaoDias" defaultValue={Number(r.satisfacaoGestorDias)} /></Field>
            <Field label="Mínimo de respostas (experiência)"><Input name="minExp" defaultValue={Number(r.minimoExperiencia)} /></Field>
            <Field label="Candidaturas por posição (saúde)"><Input name="candPorVaga" defaultValue={Number(r.candidatosPorVaga)} /></Field>
          </div>
          <Field label="Motivos de recusa da proposta (um por linha)"><Textarea name="motivosRecusa" defaultValue={(r.motivosRecusa as string[]).join("\n")} className="min-h-[90px] text-xs" /></Field>
        </Sec>
        <Sec id="igualdade" titulo="Igualdade salarial e diversidade (Lei 14.611/2023)" nota="Compara a remuneração de mulheres e homens no mesmo cargo (e nível) só quando os dois grupos têm o mínimo de pessoas. Diferença acima do limite pede explicação por critério objetivo (CLT art. 461).">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Field label="Mínimo por grupo (mulheres e homens)"><Input name="grupoMinimo" defaultValue={Number(ig.grupoMinimo)} /></Field>
            <Field label="Diferença que pede explicação (%)"><Input name="limite" defaultValue={Number(ig.limiteDiferencaPct)} /></Field>
            <Field label="Empregados para o relatório semestral"><Input name="empregados" defaultValue={Number(ig.empregadosObrigatorio)} /></Field>
          </div>
          <fieldset><legend className="text-xs font-medium text-slate-600">Famílias de cargo que contam como liderança (além de quem tem equipe direta)</legend><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{Object.entries(FAMILIAS).map(([k, v]) => <Check key={k} name="familias" value={k} on={(ig.familiasLideranca as string[]).includes(k)} rotulo={v} />)}</div></fieldset>
        </Sec>
        <Sec id="calibracao" titulo="Calibração e metas — distribuição de referência (sem cota)" nota="A referência aparece ao lado da distribuição real na calibração, para a conversa — nenhuma cota é aplicada e ninguém muda de faixa por causa dela.">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Field label="Destaque (%)"><Input name="refDestaque" defaultValue={ref.DESTAQUE} /></Field><Field label="Consistente (%)"><Input name="refConsistente" defaultValue={ref.CONSISTENTE} /></Field><Field label="Prioritário (%)"><Input name="refPrioritario" defaultValue={ref.PRIORITARIO} /></Field>
            <Field label="Avaliador: mínimo de avaliados"><Input name="consMin" defaultValue={Number(d.consistenciaMinAvaliados)} /></Field><Field label="Avaliador: diferença da média (pontos)"><Input name="consDelta" defaultValue={String(d.consistenciaDelta).replace(".", ",")} /></Field>
            <Field label="Meta sem atualização (dias)"><Input name="metaDias" defaultValue={Number(d.metaSemAtualizacaoDias)} /></Field>
          </div>
        </Sec>
        <Sec id="lideranca" titulo="Pesquisa de liderança — o gestor avaliado pela equipe" nota="Cada pessoa avalia o próprio gestor direto, de forma anônima. O resultado de um gestor só aparece com o mínimo de respostas (nunca menos de 3).">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3"><Field label="Mínimo de respostas por gestor"><Input name="liMin" defaultValue={Number(li.minimo)} /></Field><Field label="Índice esperado (% favorável)"><Input name="liAlvo" defaultValue={Number(li.favoravelAlvo)} /></Field><Field label="Ponto de atenção abaixo de (%)"><Input name="liAtencao" defaultValue={Number(li.atencaoAbaixo)} /></Field></div>
          <Field label="Dimensões (Dimensão | afirmação, uma por linha)"><Textarea name="liDimensoes" defaultValue={(li.dimensoes as [string, string][]).map(([a, b]) => `${a} | ${b}`).join("\n")} className="min-h-[140px] text-xs" /></Field>
        </Sec>
        <Sec id="academy" titulo="Academy e benefícios">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3"><Field label="Avaliações para mostrar a nota do treinamento"><Input name="reacaoMin" defaultValue={Number(cfg.academy.reacaoMinima)} /></Field><Field label="VT: desconto máximo (% do salário)"><Input name="vtPct" defaultValue={Number(cfg.beneficios.vtDescontoMaxPct)} /></Field><Field label="FGTS na remuneração total (%)"><Input name="fgtsPct" defaultValue={Number(cfg.beneficios.fgtsPct)} /></Field></div>
          <p className="text-[11px] text-slate-500">Os encargos da remuneração total usam a estimativa de encargos do Financeiro ({cfg.financeiro.encargosPct}%). O cálculo oficial da folha continua com o contador.</p>
        </Sec>
      </div>
    </Card>
  );
}
