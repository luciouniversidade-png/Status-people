import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { Page, Card, Table, Td, Badge, Flash, Field, Textarea, Stat } from "@/components/ui";
import { Btn } from "@/components/Btn";
import { Modal } from "@/components/Modal";
import { BarraContexto } from "@/components/BarraContexto";
import { lerContexto, qsContexto } from "@/lib/contexto";
import { audit, getSettings, hoje, fmtData } from "@/lib/utils";
import { brl } from "@/lib/financeiro";
import { fmtReais } from "@/lib/formato";
import { painelRecebimentos, gateFechamento, fechamentoDe, podeOperar, podeVer, FORMAS_RECEB, FORMA_RECEB_LABEL, ISSUE_TIPO, type FormaReceb } from "@/lib/conciliacao";
import { fecharCompetencia, reabrirCompetencia } from "../conciliacao/actions";

export const dynamic = "force-dynamic";
const pctTxt = (v: number | null) => v === null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

/** T-033 · Recebimentos do mês por forma: o resumo de conciliação do grupo, vivo — previsto × recebido × conciliado. */
export default async function Recebimentos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams;
  if (!podeVer(s) || s.role === "COMERCIAL") { await audit(s, "acesso negado: recebimentos do mês", "recon_closings", null, null, { papel: s.role }); redirect(s.role === "COMERCIAL" ? "/financeiro/conciliacao?aba=triagem" : "/?erro=" + encodeURIComponent("Acesso restrito ao Financeiro e à Direção — a tentativa foi registrada.")); }
  const ctx = await lerContexto(s, sp); const cfg = await getSettings(); const meta = cfg.conciliacao.metaConciliadoPct as number;
  const [p, fech] = await Promise.all([painelRecebimentos(ctx.periodo, ctx.unitIds), fechamentoDe(ctx.periodo, ctx.entidadeId)]);
  const fechada = fech?.status === "FECHADA"; const opera = podeOperar(s);
  const gate = !fechada && opera ? await gateFechamento(ctx.periodo, ctx.entidadeId) : null;
  const [a, m] = ctx.periodo.split("-").map(Number); const fimMes = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10); const corte = fimMes < hoje() ? fimMes : hoje();
  const semExtrato = p.cobertura.filter(c => !c.ate || c.ate < `${ctx.periodo}-01`); const parcial = p.cobertura.filter(c => c.ate && c.ate >= `${ctx.periodo}-01` && c.ate < corte);
  const formas: (FormaReceb | "SEM")[] = [...FORMAS_RECEB, ...(p.porForma.some(f => f.forma === "SEM") ? ["SEM" as const] : [])];
  const rotulo = (f: string) => f === "SEM" ? "Sem forma informada" : FORMA_RECEB_LABEL[f as FormaReceb];
  const unidades = [...new Set(p.porUnidade.map(x => x.unidade))];
  const cel = (un: string, f: string) => p.porUnidade.find(x => x.unidade === un && x.forma === f);
  const voltar = `/financeiro/recebimentos?${qsContexto(ctx)}`;
  const semFonte = semExtrato.length === p.cobertura.length && p.cobertura.length > 0;
  return (
    <Page title="Recebimentos do mês" sub={`Por forma de pagamento: previsto × recebido × conciliado, por unidade e entidade. Baixas do ActiveSoft (fonte oficial da quitação) casadas com extratos e o relatório da Cielo. ${ctx.carimbo}.`}
      actions={<><Btn kind="ghost" href={`/api/export/recebimentos?periodo=${ctx.periodo}${ctx.unitId ? `&unidade=${ctx.unitId}` : ""}`}>Exportar CSV</Btn><Btn kind="ghost" href="/financeiro/conciliacao">Conciliação</Btn><Btn kind="ghost" href="/financeiro/divergencias">Divergências</Btn></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <BarraContexto ctx={ctx} voltar="/financeiro/recebimentos" notaPeriodo={fechada ? `competência fechada em ${fmtData(fech!.fechado_em.slice(0, 10))}` : "competência aberta"} />
      {(semExtrato.length > 0 || parcial.length > 0) && <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-aviso">
        {semFonte ? "Sem fonte: nenhum extrato importado para este período — os números de conciliação aparecem em cinza até a importação." : <>Dados parciais: {[...semExtrato.map(c => `${unidade(ctx.units, c.unit_id)} sem extrato`), ...parcial.map(c => `${unidade(ctx.units, c.unit_id)} até ${fmtData(c.ate)}`)].join(" · ")}.</>} Cartão: relatório da Cielo {p.coberturaCielo ? `até ${fmtData(p.coberturaCielo)}` : "não importado"}.</p>}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Previsto no mês" value={fmtReais(p.previsto, true)} hint={`${brl(p.previsto)} · ${p.nPrevisto} título(s) com vencimento no mês`} />
        <Stat label="Recebido no mês" value={fmtReais(p.recebido, true)} hint={`${brl(p.recebido)} · ${p.nRecebidos} baixa(s)`} />
        <Stat label="Conciliado" value={semFonte ? <span className="text-slate-400">sem fonte</span> : fmtReais(p.conciliado, true)} hint={`${brl(p.conciliado)} · REAL só depois de casado com o banco`} />
        <Stat label="Conciliado ÷ recebido (KPI-09)" value={semFonte ? <span className="text-slate-400">—</span> : <span className={p.pct !== null && p.pct >= meta ? "text-ok" : "text-aviso"}>{pctTxt(p.pct)}</span>} hint={`meta ${meta}% até o dia ${cfg.conciliacao.diaLimiteFechamento} do mês seguinte`} />
        <Stat label="Explicado com alçada" value={fmtReais(p.explicado, true)} hint="baixas sem crédito encerradas com desfecho e evidência" />
        <Stat label="Pendências da competência" value={<span className={p.pendencias.length ? "text-erro" : "text-ok"}>{p.pendencias.length}</span>} hint={p.pendencias.length ? `${p.pendencias.filter(x => x.escalonamento > 0).length} escalada(s)` : "nada a tratar"} href="/financeiro/divergencias" />
      </div>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {formas.map(f => { const x = p.porForma.find(y => y.forma === f); const rec = x?.recebido ?? 0, conc = x?.conciliado ?? 0; const pc = rec ? (100 * conc) / rec : null;
          return <Card key={f} title={rotulo(f)}>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Recebido</span><span className="tabular-nums font-semibold text-navy">{brl(rec)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Conciliado</span><span className={`tabular-nums ${semFonte ? "text-slate-400" : "text-ok"}`}>{semFonte ? "sem fonte" : brl(conc)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">A conciliar</span><span className="tabular-nums text-aviso">{brl(rec - conc)}</span></div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-mist" role="img" aria-label={`${pctTxt(pc)} conciliado`}><div className="h-full bg-ok" style={{ width: `${Math.min(100, pc ?? 0)}%` }} /></div>
              <div className="flex justify-between text-xs text-slate-500"><span>{x?.n ?? 0} baixa(s) · {x?.nConciliados ?? 0} casada(s)</span><span>{pctTxt(pc)}</span></div>
            </div>
          </Card>; })}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="space-y-4">
          <Card title="Unidade × forma de pagamento">
            <Table head={["Unidade", ...formas.map(rotulo), "Total"]} empty="Nenhuma baixa no mês.">
              {unidades.map(un => { const linhas = p.porUnidade.filter(x => x.unidade === un); const tr = linhas.reduce((a2, x) => a2 + x.recebido, 0), tc = linhas.reduce((a2, x) => a2 + x.conciliado, 0);
                return <tr key={un}><Td className="font-medium">{un}</Td>{formas.map(f => { const c = cel(un, f); return <Td key={f} className="tabular-nums text-xs">{c ? <><div>{brl(c.recebido)}</div><div className={c.recebido && c.conciliado / c.recebido >= meta / 100 - 1e-9 ? "text-ok" : "text-aviso"}>{pctTxt(c.recebido ? (100 * c.conciliado) / c.recebido : null)} conciliado</div></> : "—"}</Td>; })}
                  <Td className="tabular-nums text-xs font-semibold"><div>{brl(tr)}</div><div>{pctTxt(tr ? (100 * tc) / tr : null)}</div></Td></tr>; })}
            </Table>
            <p className="mt-2 text-xs text-slate-500">Recebido = baixas do ActiveSoft no mês, pela data do pagamento. Conciliado = baixa casada com o crédito no extrato (PIX, boleto, TED, depósito) ou com a venda da Cielo (cartão). Clique em Conciliação para ver item a item.</p>
          </Card>
          <Card title={`Pendências da competência (${p.pendencias.length})`} actions={<Link className="text-xs text-acao" href="/financeiro/divergencias">ver todas</Link>}>
            {p.pendencias.length === 0 ? <p className="text-sm text-ok">Nenhuma pendência aberta nesta competência.</p> :
              <Table head={["#", "Tipo", "Valor", "Dono", "Prazo", "Idade"]}>{p.pendencias.slice(0, 15).map(x => <tr key={x.id}><Td className="text-slate-500"><Link className="text-acao" href={`/financeiro/divergencias#p${x.id}`}>{x.id}</Link></Td><Td><div className="text-sm">{ISSUE_TIPO[x.tipo] ?? x.tipo}</div><div className="text-[11px] text-slate-500">{x.origem}</div></Td>
                <Td className="tabular-nums">{x.valor === null ? "—" : brl(x.valor)}</Td><Td className="text-xs">{x.dono ?? <span className="text-erro">sem dono</span>}</Td><Td className="text-xs">{fmtData(x.prazo)}</Td><Td>{x.escalonamento >= 2 ? <Badge v="REJEITADA" label={`${x.idade} d · Direção`} /> : x.escalonamento === 1 ? <Badge v="PENDENTE" label={`${x.idade} d · financeiro`} /> : <span className="text-xs tabular-nums">{x.idade} d</span>}</Td></tr>)}</Table>}
          </Card>
        </div>
        <div className="space-y-4">
          <Card title={`Fechamento · ${ctx.rotulo.periodo}`}>
            {fechada ? <div className="space-y-2 text-sm">
              <p><Badge v="APROVADA" label="Competência fechada" /> em {fmtData(fech!.fechado_em.slice(0, 10))}{fech!.por ? ` por ${fech!.por}` : ""} ({pctTxt(fech!.pct)} conciliado + explicado).</p>
              <p className="text-xs text-slate-500">Importações de extrato e da Cielo, vínculos e lançamentos de caixa com data nesta competência ficam travados ({ctx.entidadeId ? ctx.rotulo.entidade : "consolidado — todas as entidades"}).</p>
              {s.role === "DIRECAO" && <Modal label="Reabrir com justificativa" title="Reabrir a competência"><form action={reabrirCompetencia} className="space-y-2"><input type="hidden" name="id" value={fech!.id} /><input type="hidden" name="voltar" value={voltar} /><Field label="Motivo (fica na auditoria)"><Textarea name="motivo" required minLength={10} /></Field><Btn small>Reabrir competência</Btn></form></Modal>}
            </div> : gate ? <div className="space-y-2 text-sm">
              <div className="flex items-baseline justify-between"><span className="text-slate-500">Conciliado + explicado</span><span className={`text-xl font-semibold tabular-nums ${gate.ok ? "text-ok" : "text-aviso"}`}>{pctTxt(gate.pctGate)}</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-mist"><div className={`h-full ${gate.ok ? "bg-ok" : "bg-aviso"}`} style={{ width: `${Math.min(100, gate.pctGate ?? 0)}%` }} /></div>
              <p className="text-xs text-slate-500">Meta para fechar: {gate.meta}% ({ctx.entidadeId ? ctx.rotulo.entidade : "consolidado"}). {gate.ok ? "Pode fechar: lançamentos e importações desta competência passam a ficar travados." : `Faltam ${brl(Math.max(0, gate.recebido * gate.meta / 100 - gate.conciliado - gate.explicado))} conciliados (ou explicados com alçada).`}</p>
              <form action={fecharCompetencia} className="space-y-2"><input type="hidden" name="competencia" value={ctx.periodo} /><input type="hidden" name="companyId" value={ctx.entidadeId ?? ""} /><input type="hidden" name="voltar" value={voltar} />
                <Field label="Observação (opcional)"><Textarea name="obs" className="min-h-[50px]" /></Field>
                <Btn small kind={gate.ok ? "primary" : "ghost"}>Fechar competência</Btn></form>
              {!gate.ok && <p className="text-[11px] text-slate-500">Sem a meta, o fechamento é bloqueado e a lista de pendências (com dono e prazo) aparece. É o número que trava o lock do Financeiro (KPI-09).</p>}
            </div> : <p className="text-sm text-slate-600">Competência aberta. O fechamento é feito pelo Financeiro ou pela Direção quando o conciliado chega à meta de {meta}%.</p>}
          </Card>
          <Card title="Como ler">
            <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
              <li><b>Previsto</b>: títulos com vencimento no mês (o que deveria entrar).</li>
              <li><b>Recebido</b>: baixas do ActiveSoft no mês — a quitação oficial continua lá (CRQ-COB-V3-04).</li>
              <li><b>Conciliado</b>: a baixa casou com o dinheiro no banco ou na Cielo. Só então o número é REAL.</li>
              <li><b>Explicado</b>: baixa sem crédito encerrada com desfecho tipificado, evidência e alçada.</li>
              <li>Pendência aberta há {(cfg.conciliacao.escalonamentoDias as number[])[0]} dias escala ao gestor financeiro; há {(cfg.conciliacao.escalonamentoDias as number[])[1]}, à Direção.</li>
            </ul>
          </Card>
        </div>
      </div>
    </Page>
  );
}
function unidade(units: { id: number; nome: string }[], id: number) { return units.find(u => u.id === id)?.nome ?? `#${id}`; }
