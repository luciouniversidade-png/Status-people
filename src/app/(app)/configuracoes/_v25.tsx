import { sql } from "@/db";
import { Card, Field, Input, Select, Textarea, Btn } from "@/components/ui";
import { getSettings } from "@/lib/utils";
import { salvarParametrosV25 } from "./v25-actions";

/** Configurações da v25: conciliação bancária e de cartão (Cap. 21) e política de despesas (T-029). Só a Direção altera. */
export async function ParametrosV25() {
  const cfg = await getSettings(); const c = cfg.conciliacao; const d = cfg.despesas;
  const tipos = await sql<{ codigo: string; nome: string }[]>`SELECT codigo, nome FROM request_types WHERE ativo ORDER BY ordem, nome`;
  const cats = cfg.financeiro.categoriasSaida as string[]; const porTipo = d.categoriaPorTipo as Record<string, string>;
  const taxas = c.taxasCartao as { bandeira: string; categoria: string; taxa: number }[]; const pal = c.palavras as Record<string, string[]>; const esc = c.escalonamentoDias as number[];
  const Sec = ({ id, titulo, children, nota }: { id: string; titulo: string; children: React.ReactNode; nota?: string }) => <details className="rounded-md border border-line bg-white" id={`v25-${id}`}><summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-navy">{titulo}</summary><form action={salvarParametrosV25} className="space-y-2 border-t border-line p-3"><input type="hidden" name="secao" value={id} />{children}{nota && <p className="text-[11px] text-slate-500">{nota}</p>}<Btn small>Salvar</Btn></form></details>;
  const Check = ({ name, value, on, rotulo }: { name: string; value: string; on: boolean; rotulo: string }) => <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name={name} value={value} defaultChecked={on} /> {rotulo}</label>;
  return (
    <Card title="Conciliação, despesas e ponto (v25) — regras e parâmetros" className="mb-4"><div id="v25" />
      <div className="space-y-2">
        <Sec id="conciliacao" titulo="Conciliação bancária e de cartão" nota="Quitação oficial continua no ActiveSoft: o ONE nunca marca título como pago. Confiança abaixo do limiar vai para a fila de confirmação humana. Taxas: copie do contrato com a adquirente (os valores de fábrica são EXEMPLO).">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field label="Confirmar sozinho a partir de (% de confiança)"><Input name="limiar" defaultValue={c.limiarAuto as number} /></Field>
            <Field label="Janela PIX/TED/depósito (dias)"><Input name="janela" defaultValue={c.janelaDias as number} /></Field>
            <Field label="Janela do cartão (dias)"><Input name="janelaCartao" defaultValue={c.janelaCartaoDias as number} /></Field>
            <Field label="Tolerância de centavos (R$)"><Input name="centavos" defaultValue={String(c.toleranciaCentavos).replace(".", ",")} /></Field>
            <Field label="Ocorrências para o achado de centavos"><Input name="centavosMin" defaultValue={c.centavosMinOcorrencias as number} /></Field>
            <Field label="Tolerância da taxa (p.p.)"><Input name="tolTaxa" defaultValue={String(c.toleranciaTaxaPp).replace(".", ",")} /></Field>
            <Field label="Meta do KPI-09 para fechar (%)"><Input name="meta" defaultValue={c.metaConciliadoPct as number} /></Field>
            <Field label="Fechar a competência até o dia"><Input name="diaLimite" defaultValue={c.diaLimiteFechamento as number} /></Field>
            <Field label="Pendência escala ao gestor após (dias)"><Input name="escGestor" defaultValue={esc[0]} /></Field>
            <Field label="Pendência escala à Direção após (dias)"><Input name="escDirecao" defaultValue={esc[1]} /></Field>
            <Field label="Perda assumida pelo Financeiro até (R$)"><Input name="alcadaPerda" defaultValue={c.perdaAlcadaFinanceiro as number} /></Field>
          </div>
          <Field label="Taxas contratadas — bandeira (ou *) | categoria | taxa %"><Textarea name="taxas" defaultValue={taxas.map(t => `${t.bandeira} | ${t.categoria} | ${String(t.taxa).replace(".", ",")}`).join("\n")} className="min-h-[110px] font-mono text-xs" /></Field>
          <Field label="Palavras do histórico do extrato → forma (a primeira regra que bate vale)"><Textarea name="palavras" defaultValue={Object.entries(pal).map(([k, v]) => `${k}: ${v.join(", ")}`).join("\n")} className="min-h-[130px] font-mono text-xs" /></Field>
        </Sec>
        <Sec id="despesas" titulo="Política de despesas — lote, exceções e pagamento" nota="Lote só para o normal: acima do limite, sem documento, categoria bloqueada ou orçamento estourado viram exceção (decisão item a item). Pagamento só com o débito do extrato; o lançamento do caixa vai para a categoria do tipo.">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3"><Field label="Aprovação em lote até (R$)"><Input name="loteAte" defaultValue={d.loteAte as number} /></Field><Field label="Alerta de aprovada sem pagamento após (dias)"><Input name="alerta" defaultValue={d.alertaPagamentoDias as number} /></Field></div>
          <Check name="doc" value="1" on={!!d.exigirDocumento} rotulo="Despesa sem documento anexado é exceção" />
          <Check name="orc" value="1" on={!!d.excecaoOrcamento} rotulo="Categoria sem orçamento ou com o mês estourado é exceção (unidades que orçam o ano)" />
          <fieldset><legend className="text-xs font-medium text-slate-600">Categorias que sempre pedem decisão item a item</legend><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{cats.map(x => <Check key={x} name="bloq" value={x} on={(d.categoriasBloqueadas as string[]).includes(x)} rotulo={x} />)}</div></fieldset>
          <h4 className="text-xs font-semibold text-slate-600">Categoria do caixa de cada tipo de solicitação</h4>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">{tipos.map(t => <div key={t.codigo} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-1.5 text-xs"><span className="[overflow-wrap:anywhere]">{t.nome}</span><Select name={`cat_${t.codigo}`} defaultValue={porTipo[t.codigo] ?? ""} className="!py-1 !text-xs" aria-label={`Categoria de ${t.nome}`}><option value="">— Outras despesas —</option>{cats.map(x => <option key={x} value={x}>{x}</option>)}</Select></div>)}</div>
        </Sec>
        <Sec id="massa" titulo="Comunicação em massa — segundo aprovador e horário comercial" nota="CRQ-COM-V3-01: comunicado para muita gente e envio para lista de famílias ou da equipe só saem com a aprovação de outra pessoa (nunca o autor), e só dentro do horário comercial — fora dele, ficam agendados para a próxima janela. Só a Direção altera.">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3"><Field label="Comunicado em massa a partir de (pessoas)"><Input name="minimo" defaultValue={cfg.comunicacao.massaMinDestinatarios as number} /></Field><Field label="Disparo a partir de"><Input name="inicio" defaultValue={(cfg.comunicacao.horarioComercial as { inicio: string }).inicio} /></Field><Field label="Disparo até"><Input name="fim" defaultValue={(cfg.comunicacao.horarioComercial as { fim: string }).fim} /></Field></div>
          <fieldset><legend className="text-xs font-medium text-slate-600">Dias de disparo</legend><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d, i) => <Check key={d} name="dias" value={String(i)} on={(cfg.comunicacao.horarioComercial as { dias: number[] }).dias.includes(i)} rotulo={d} />)}</div></fieldset>
          <fieldset><legend className="text-xs font-medium text-slate-600">Quem aprova</legend><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1"><Check name="aprovadores" value="DIRECAO" on={(cfg.comunicacao.aprovadoresMassa as string[]).includes("DIRECAO")} rotulo="Direção" /><Check name="aprovadores" value="RH" on={(cfg.comunicacao.aprovadoresMassa as string[]).includes("RH")} rotulo="RH" /></div></fieldset>
        </Sec>
        <Sec id="ponto" titulo="Auditoria do ponto e grade docente" nota="Tolerância: diferença total no dia até este valor não vira divergência (CLT art. 58 §1º). A CH do professor vem da grade (por turno: janela conta, almoço não; plantão conta) e só muda pela vigência. RH ou Direção alteram.">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3"><Field label="Tolerância do dia (min)"><Input name="tolerancia" defaultValue={cfg.auditoriaPonto.toleranciaDiaMin as number} /></Field><Field label="Hora extra a partir de (min)"><Input name="heMinima" defaultValue={cfg.auditoriaPonto.heMinimaMin as number} /></Field><Field label="Durações de aula (min)"><Input name="duracoes" defaultValue={(cfg.grade.duracoesAula as number[]).join(", ")} /></Field></div>
          <Check name="atestado" value="1" on={!!cfg.auditoriaPonto.exigirAnexoAtestado} rotulo="Atestado sem documento anexado é divergência" />
          <Field label="Rótulos de plantão (turma ou disciplina; um por linha)"><Textarea name="plantao" defaultValue={(cfg.grade.rotulosPlantao as string[]).join("\n")} className="min-h-[50px]" /></Field>
        </Sec>
      </div>
    </Card>
  );
}
