import { notFound, redirect } from "next/navigation";
import Link from "@/components/Link";
import { requireSession, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Badge, Flash, Btn, Stat, Table, Td, Field, Input, Select, Textarea } from "@/components/ui";
import { Anexos } from "@/components/Anexos";
import { audit, fmtData, fmtDataHora, getSettings, hoje, addDays } from "@/lib/utils";
import { veCP, operaCP, aprovaCP, baixaManualCP, numeroCP, situacaoParcela, candidatosBaixa, opcoesFeriado, CP_STATUS, MOTIVO_ROTULO, NATUREZAS, ehNatureza, type MotivoCP, type Candidato } from "@/lib/contas-pagar";
import { INTERVALO_LABEL, proximoDiaUtil, type Intervalo } from "@/lib/parcelas";
import { lerBoleto, lerChaveNFe } from "@/lib/documentos-fiscais";
import { decidirContaPagar, registrarBaixaParcela, baixaManualParcela, desfazerBaixaParcela, editarParcela, cancelarParcela, cancelarContaPagar, estenderRecorrencia, programarParcelas, desprogramarParcela, reterParcela, registrarBoletoParcela } from "../actions";

export const dynamic = "force-dynamic";
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Aprov = { userId: number; nome: string; at: string };
type Tit = { id: number; numero: number; unit_id: number | null; unidade: string | null; entidade: string | null; cnpj: string | null; supplier_id: number | null; fornecedor_nome: string; contract_id: number | null; contrato: string | null; categoria: string; tipo_documento: string; numero_documento: string | null; chave_nfe: string | null; emissao: string; descricao: string; recorrente: boolean; natureza: string; conta_codigo: string | null; conta_nome: string | null; macro: string | null; centro: string | null; valor_total: number; parcelas: number; intervalo: string; dias_intervalo: number | null; primeiro_vencimento: string | null; ajustar_dia_util: boolean; status: string; motivos_aprovacao: MotivoCP[] | null; aprovacoes: Aprov[]; aprovacoes_necessarias: number; aprovado_por: string | null; aprovado_em: string | null; motivo_rejeicao: string | null; obs: string | null; created_by: number | null; lancado_por: string | null; responsavel: string | null; created_at: string };
type Parc = { id: number; parcela: number; emissao: string; vencimento: string; competencia: string | null; valor: number; status: string; pago_em: string | null; valor_pago: number | null; juros: number; desconto: number; baixa_manual: boolean; motivo_baixa: string | null; deb_data: string | null; deb_conta: string | null; deb_hist: string | null; pago_por: string | null; codigo_barras: string | null; retida: boolean; motivo_retencao: string | null; programado_para: string | null; conta_programada: string | null };

/** v27 · Título de contas a pagar: aprovação (com dupla checagem), parcelas com boleto, competência, programação, retenção e baixa pelo débito do extrato, anexos e linha do tempo. */
export default async function ContaPagar({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const { id } = await params; const sp = await searchParams; const pid = Number(id) || 0;
  if (!veCP(s)) { await audit(s, "acesso negado: conta a pagar", "payables", pid, null, { papel: s.role }); redirect("/financeiro"); }
  const escopo = scopeUnit(s); const cfg = await getSettings(); const h = hoje(); const alerta = Number(cfg.contasPagar.alertaDias ?? 3);
  const [p] = await sql<Tit[]>`SELECT p.id, p.numero, p.unit_id, u.nome AS unidade, co.nome AS entidade, co.cnpj, p.supplier_id, p.fornecedor_nome, p.contract_id, k.objeto AS contrato, p.categoria, p.tipo_documento, p.numero_documento, p.chave_nfe, p.emissao::text, p.descricao, p.recorrente, p.natureza, ca.codigo AS conta_codigo, ca.nome AS conta_nome, (SELECT g.nome FROM chart_accounts g WHERE g.codigo = split_part(ca.codigo, '.', 1)) AS macro, cc.codigo || ' · ' || cc.nome AS centro, p.valor_total::float, p.parcelas, p.intervalo, p.dias_intervalo, p.primeiro_vencimento::text, p.ajustar_dia_util, p.status, p.motivos_aprovacao,
      p.aprovacoes, p.aprovacoes_necessarias, ua.nome AS aprovado_por, p.aprovado_em::text, p.motivo_rejeicao, p.obs, p.created_by, uc.nome AS lancado_por, ur.nome AS responsavel, p.created_at::text
    FROM payables p LEFT JOIN units u ON u.id=p.unit_id LEFT JOIN companies co ON co.id=p.company_id LEFT JOIN contracts k ON k.id=p.contract_id LEFT JOIN users ua ON ua.id=p.aprovado_por LEFT JOIN users uc ON uc.id=p.created_by LEFT JOIN users ur ON ur.id=p.responsavel_user_id LEFT JOIN chart_accounts ca ON ca.id=p.conta_id LEFT JOIN cost_centers cc ON cc.id=p.cost_center_id WHERE p.id=${pid}`;
  if (!p || (escopo !== null && p.unit_id !== escopo)) notFound();
  const [parcs, eventos, contas] = await Promise.all([
    sql<Parc[]>`SELECT i.id, i.parcela, i.emissao::text, i.vencimento::text, i.competencia, i.valor::float, i.status, i.pago_em::text, i.valor_pago::float, i.juros::float, i.desconto::float, i.baixa_manual, i.motivo_baixa, l.data::text AS deb_data, a.apelido AS deb_conta, l.descricao AS deb_hist, us.nome AS pago_por,
        i.codigo_barras, i.retida, i.motivo_retencao, i.programado_para::text, bp.apelido AS conta_programada
      FROM payable_installments i LEFT JOIN bank_lines l ON l.id=i.bank_line_id LEFT JOIN bank_accounts a ON a.id=l.bank_account_id LEFT JOIN users us ON us.id=i.pago_por LEFT JOIN bank_accounts bp ON bp.id=i.conta_programada_id WHERE i.payable_id=${pid} ORDER BY i.parcela`,
    sql<{ at: string; user_nome: string | null; texto: string }[]>`SELECT at::text, user_nome, texto FROM payable_events WHERE payable_id=${pid} ORDER BY at, id`,
    sql<{ id: number; apelido: string }[]>`SELECT id, apelido FROM bank_accounts WHERE ativo ${p.unit_id === null ? sql`` : sql`AND (unit_id IS NULL OR unit_id=${p.unit_id})`} ORDER BY apelido`,
  ]);
  const opera = operaCP(s); const aberto = ["ATIVO", "AGUARDANDO_APROVACAO"].includes(p.status); const podeBaixar = opera && p.status === "ATIVO"; const manual = baixaManualCP(cfg, s);
  const aprovacoes = p.aprovacoes ?? []; const segregado = !!cfg.contasPagar.segregarAprovarPagar && aprovacoes.some(a => a.userId === s.id);
  const cand = podeBaixar ? await candidatosBaixa(pid, p.unit_id) : new Map<number, Candidato[]>();
  const vivas = parcs.filter(x => x.status !== "CANCELADA"); const pagas = parcs.filter(x => x.status === "PAGA"); const abertas = parcs.filter(x => x.status === "A_PAGAR");
  const compromisso = vivas.reduce((a, x) => a + x.valor, 0); const pago = pagas.reduce((a, x) => a + (x.valor_pago ?? 0), 0); const juros = pagas.reduce((a, x) => a + x.juros, 0); const descontos = pagas.reduce((a, x) => a + x.desconto, 0);
  const emAberto = abertas.reduce((a, x) => a + x.valor, 0); const proxima = abertas[0];
  const st = CP_STATUS[p.status] ?? { rotulo: p.status, tom: p.status };
  const voltar = `/financeiro/contas-a-pagar/${pid}`; const tipos = cfg.contasPagar.tiposDocumento as string[];
  const decide = aprovaCP(cfg, s) && p.status === "AGUARDANDO_APROVACAO" && p.created_by !== s.id && !aprovacoes.some(a => a.userId === s.id);
  const nfe = p.chave_nfe ? lerChaveNFe(p.chave_nfe) : null; const proxUtil = proximoDiaUtil(addDays(h, 1), opcoesFeriado(cfg));
  const diasAguardando = Math.max(0, Math.round((Date.parse(h) - Date.parse(p.created_at.slice(0, 10))) / 86400000));
  // parcela em foco (?p=): a próxima em aberto por padrão — as ações aparecem só para ela (página leve, foco no celular)
  const pedida = Number(sp.p) || 0; const sel = parcs.find(x => x.id === pedida) ?? abertas.find(x => !x.retida) ?? abertas[0] ?? null;
  const selSit = sel ? situacaoParcela({ ...sel, payable_status: p.status }, h, alerta) : null; const cs = sel ? cand.get(sel.id) ?? [] : [];
  const selBol = sel?.codigo_barras ? lerBoleto(sel.codigo_barras, h) : null; const voltarSel = sel ? `${voltar}?p=${sel.id}` : voltar;
  return (
    <Page title={`${numeroCP(p.numero)} · ${p.descricao}`} sub={`${p.fornecedor_nome} · ${p.categoria}${p.natureza !== "OPERACAO" && ehNatureza(p.natureza) ? ` (${NATUREZAS[p.natureza].curto})` : ""} · ${p.unidade ?? "Rede"}${p.entidade ? ` · ${p.entidade}` : ""} · ${p.tipo_documento}${p.numero_documento ? ` nº ${p.numero_documento}` : ""} · emissão ${fmtData(p.emissao)}`}
      actions={<><Btn kind="ghost" href="/financeiro/contas-a-pagar">Contas a pagar</Btn>{opera && <Btn kind="ghost" href={`/financeiro/contas-a-pagar/nova?de=${pid}`}>Copiar como novo</Btn>}{p.contract_id && <Btn kind="ghost" href={`/operacoes/contratos/${p.contract_id}`}>Contrato</Btn>}</>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {p.status === "AGUARDANDO_APROVACAO" && <Card className="mb-4 border-amber-300" title={`Aguardando aprovação${p.aprovacoes_necessarias > 1 ? ` — dupla checagem (${aprovacoes.length} de ${p.aprovacoes_necessarias})` : ""}`} actions={<Badge v="PENDENTE" label={diasAguardando <= 0 ? "desde hoje" : diasAguardando === 1 ? "há 1 dia" : `há ${diasAguardando} dias`} />}>
        <ul className="space-y-1 text-sm">{(p.motivos_aprovacao ?? []).map((m, i) => <li key={i}><b className="text-aviso">{MOTIVO_ROTULO[m.codigo] ?? m.codigo}:</b> {m.texto}</li>)}</ul>
        {aprovacoes.length > 0 && <p className="mt-2 text-xs text-ok">Aprovado por {aprovacoes.map(a => `${a.nome} (${fmtDataHora(a.at)})`).join(" e ")} — falta {p.aprovacoes_necessarias - aprovacoes.length} pessoa(s) diferente(s).</p>}
        {decide ? <form action={decidirContaPagar} className="mt-3 space-y-2"><input type="hidden" name="id" value={pid} /><Field label="Comentário (obrigatório para rejeitar)"><Textarea name="motivo" className="min-h-[50px]" /></Field>
          <div className="flex flex-wrap gap-2"><Btn name="decisao" value="APROVAR">{p.aprovacoes_necessarias > 1 && aprovacoes.length === 0 ? "Aprovar (1ª de 2)" : "Aprovar"}</Btn><Btn name="decisao" value="REJEITAR" danger>Rejeitar</Btn></div></form>
          : <p className="mt-2 text-xs text-slate-500">{p.created_by === s.id ? "Você lançou este título: outra pessoa com a alçada decide." : aprovacoes.some(a => a.userId === s.id) ? "Você já aprovou: a dupla checagem pede outra pessoa." : "A decisão é de quem tem a alçada de contas a pagar."} Enquanto isso, as parcelas não entram no caixa projetado e não podem ser programadas nem baixadas.</p>}
      </Card>}
      {p.status === "REJEITADO" && <Card className="mb-4 border-red-200"><p className="text-sm text-erro"><b>Rejeitado</b>{p.aprovado_por ? ` por ${p.aprovado_por}` : ""}{p.aprovado_em ? ` em ${fmtDataHora(p.aprovado_em)}` : ""}: {p.motivo_rejeicao}</p></Card>}
      {segregado && podeBaixar && <p className="mb-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-acao">Segregação de funções: você aprovou este título, então a baixa das parcelas fica com outra pessoa do Financeiro.</p>}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Stat label="Compromisso" value={brl(compromisso)} hint={`${vivas.length} parcela(s)${p.recorrente ? ` · recorrente de ${brl(p.valor_total)}` : ""}`} />
        <Stat label="Pago" value={<span className="text-ok">{brl(pago)}</span>} hint={`${pagas.length} parcela(s)${juros ? ` · juros ${brl(juros)}` : ""}${descontos ? ` · desconto ${brl(descontos)}` : ""}`} />
        <Stat label="Em aberto" value={brl(emAberto)} hint={`${abertas.length} parcela(s)${abertas.some(x => x.retida) ? ` · ${abertas.filter(x => x.retida).length} retida(s)` : ""}`} />
        <Stat label="Próximo vencimento" value={proxima ? fmtData(proxima.vencimento) : "—"} hint={proxima ? `${brl(proxima.valor)} · parcela ${proxima.parcela}/${p.parcelas}${proxima.programado_para ? ` · pagar ${fmtData(proxima.programado_para)}` : ""}` : "nada a vencer"} />
        <Stat label="Situação" value={<Badge v={st.tom} label={st.rotulo} />} hint={p.aprovado_por && p.status !== "REJEITADO" ? `aprovado por ${aprovacoes.length > 1 ? aprovacoes.map(a => a.nome).join(" e ") : p.aprovado_por}` : p.motivos_aprovacao?.length ? "pede alçada" : "dentro da alçada"} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="min-w-0 space-y-4">
          {opera && sel && <Card title={<span id="acoes">Ações da parcela {sel.parcela}/{p.parcelas} — {brl(sel.valor)} · vence {fmtData(sel.vencimento)}</span>} className="border-acao/40" actions={<Badge v={selSit!.tom} label={selSit!.rotulo} />}>
            <div className="space-y-4 text-sm">
              {sel.status === "PAGA" && <div className="space-y-2">
                <p>Paga em <b>{fmtData(sel.pago_em)}</b> · {brl(sel.valor_pago)}{sel.juros ? ` (+${brl(sel.juros)} juros)` : ""}{sel.desconto ? ` (−${brl(sel.desconto)} desconto)` : ""} — {sel.baixa_manual ? <span className="font-medium text-aviso">baixa manual: {sel.motivo_baixa}</span> : <>débito {sel.deb_conta}{sel.deb_hist ? ` · ${sel.deb_hist}` : ""} (conciliado)</>}{sel.pago_por ? ` · ${sel.pago_por}` : ""}</p>
                <details className="rounded-md border border-line p-2"><summary className="cursor-pointer text-xs font-medium text-erro">Desfazer a baixa</summary>
                  <form action={desfazerBaixaParcela} className="mt-2 space-y-2"><input type="hidden" name="id" value={sel.id} /><input type="hidden" name="voltar" value={voltarSel} /><p className="text-xs text-slate-600">A parcela volta a pagar e o débito fica livre para outra baixa.</p><Field label="Motivo"><Textarea name="motivo" required className="min-h-[50px]" /></Field><Btn small danger>Desfazer baixa</Btn></form></details>
              </div>}
              {sel.status === "A_PAGAR" && sel.retida && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-erro"><b>Retida em contestação:</b> {sel.motivo_retencao} — fora da programação e da baixa até ser liberada.</p>}
              {sel.status === "A_PAGAR" && podeBaixar && !sel.retida && <section><h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-navy">Baixar com o débito do extrato</h3>
                {segregado ? <p className="rounded bg-sky-50 p-2 text-xs text-acao">Você aprovou este título: pela segregação de funções, a baixa fica com outra pessoa do Financeiro.</p> : <>
                <form action={registrarBaixaParcela} className="space-y-2"><input type="hidden" name="id" value={sel.id} /><input type="hidden" name="voltar" value={voltarSel} />
                  {cs.length === 0 ? <p className="rounded bg-mist p-2 text-xs">Nenhum débito livre no extrato perto deste vencimento (de 80% a 125% do valor). Importe o extrato em <Link className="text-acao underline" href="/financeiro/conciliacao?aba=contas">Conciliação</Link>{manual ? " ou use a baixa manual abaixo (exceção)" : ""}.</p>
                    : <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-line p-2">{cs.map((d, i) => <label key={d.id} className="flex items-start gap-2 text-xs"><input type="radio" name="lineId" value={d.id} defaultChecked={i === 0} className="mt-0.5" /><span>{fmtData(d.data)} · <b>{brl(Math.abs(d.valor))}</b> · {d.conta}{d.exato ? <span className="text-ok"> · valor exato</span> : <span className="text-aviso"> · diferença {brl(Math.abs(d.valor) - sel.valor)}</span>}<span className="block text-[11px] text-slate-500 [overflow-wrap:anywhere]">{d.descricao}</span></span></label>)}</div>}
                  {cs.length > 0 && <><div className="grid grid-cols-2 gap-2 sm:max-w-sm"><Field label="Juros/multa (R$)"><Input name="juros" inputMode="decimal" placeholder="0,00" /></Field><Field label="Desconto (R$)"><Input name="desconto" inputMode="decimal" placeholder="0,00" /></Field></div><Btn small pendingText="Conciliando…">Registrar baixa com o débito</Btn></>}
                </form>
                {manual && <details className="mt-2 rounded-md border border-amber-200 bg-amber-50/50 p-2"><summary className="cursor-pointer text-xs font-medium text-aviso">Exceção: baixa manual, sem débito do extrato</summary>
                  <form action={baixaManualParcela} className="mt-2 space-y-2"><input type="hidden" name="id" value={sel.id} /><input type="hidden" name="voltar" value={voltarSel} />
                    <div className="grid grid-cols-2 gap-2 sm:max-w-md"><Field label="Data do pagamento"><Input name="data" type="date" defaultValue={h < sel.vencimento ? h : sel.vencimento} max={h} required /></Field><Field label="Valor pago (R$)"><Input name="valorPago" inputMode="decimal" defaultValue={num(sel.valor)} required /></Field></div>
                    <Field label="Como foi pago"><Select name="forma" defaultValue="Dinheiro" className="sm:!w-60">{tipos.map(t => <option key={t} value={t}>{t}</option>)}</Select></Field>
                    <Field label="Por que não há débito no extrato" hint="Fica na auditoria e a Direção é avisada."><Textarea name="motivo" required minLength={15} className="min-h-[50px]" /></Field>
                    <Btn small danger>Registrar baixa manual</Btn></form></details>}</>}
              </section>}
              {sel.status === "A_PAGAR" && p.status === "ATIVO" && !sel.retida && <section><h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-navy">Programação do pagamento{sel.programado_para ? ` — programada para ${fmtData(sel.programado_para)}${sel.conta_programada ? ` · ${sel.conta_programada}` : ""}` : ""}</h3>
                <form action={programarParcelas} className="flex flex-wrap items-end gap-2"><input type="hidden" name="ids" value={sel.id} /><input type="hidden" name="voltar" value={voltarSel} />
                  <Field label="Pagar em"><Input name="data" type="date" min={h} defaultValue={sel.programado_para && sel.programado_para >= h ? sel.programado_para : sel.vencimento >= h ? sel.vencimento : proxUtil} required className="!w-40" /></Field>
                  <Field label="Conta"><Select name="contaId" defaultValue="" className="!w-48"><option value="">— a definir —</option>{contas.map(a => <option key={a.id} value={a.id}>{a.apelido}</option>)}</Select></Field>
                  <Btn small>{sel.programado_para ? "Reprogramar" : "Programar"}</Btn></form>
                {sel.programado_para && <form action={desprogramarParcela} className="mt-2"><input type="hidden" name="id" value={sel.id} /><input type="hidden" name="voltar" value={voltarSel} /><Btn small kind="ghost">Tirar da programação</Btn></form>}
              </section>}
              {sel.status === "A_PAGAR" && aberto && <div className="grid grid-cols-1 items-start gap-2 lg:grid-cols-2">
                <details className="rounded-md border border-line p-2" open={!selBol}><summary className="cursor-pointer text-xs font-medium text-navy">{selBol?.ok ? "Boleto vinculado ✓" : "Boleto (linha digitável)"}</summary>
                  {selBol?.ok && <p className="my-2 rounded bg-mist p-2 font-mono text-[11px] [overflow-wrap:anywhere]">{selBol.linhaFormatada}<span className="mt-1 block font-sans text-xs text-ok">✓ {selBol.bancoNome ?? selBol.segmento ?? "boleto"}{selBol.valor ? ` · ${brl(selBol.valor)}` : ""}{selBol.vencimento ? ` · vence ${fmtData(selBol.vencimento)}` : ""}</span></p>}
                  <form action={registrarBoletoParcela} className="mt-2 space-y-2"><input type="hidden" name="id" value={sel.id} /><input type="hidden" name="voltar" value={voltarSel} />
                    <Field label={selBol ? "Trocar pela linha digitável" : "Linha digitável"} hint="Dígitos verificadores conferidos; o mesmo boleto não entra em duas parcelas; vencimento diferente ajusta a parcela."><Input name="boleto" required inputMode="numeric" className="font-mono text-xs" /></Field><Btn small>Conferir e vincular</Btn></form>
                  {selBol && <form action={registrarBoletoParcela} className="mt-2"><input type="hidden" name="id" value={sel.id} /><input type="hidden" name="voltar" value={voltarSel} /><input type="hidden" name="remover" value="1" /><Btn small kind="ghost">Remover o boleto</Btn></form>}</details>
                <details className="rounded-md border border-line p-2"><summary className={`cursor-pointer text-xs font-medium ${sel.retida ? "text-ok" : "text-erro"}`}>{sel.retida ? "Liberar para pagamento" : "Reter (contestação com o fornecedor)"}</summary>
                  <form action={reterParcela} className="mt-2 space-y-2"><input type="hidden" name="id" value={sel.id} /><input type="hidden" name="voltar" value={voltarSel} /><input type="hidden" name="acao" value={sel.retida ? "liberar" : "reter"} />
                    <p className="text-xs text-slate-600">{sel.retida ? "A parcela volta a poder ser programada e paga." : "Nota errada, serviço não prestado, cobrança em duplicidade… A parcela sai da programação e não pode ser baixada até ser liberada."}</p>
                    <Field label="Motivo"><Textarea name="motivo" required className="min-h-[50px]" /></Field><Btn small danger={!sel.retida}>{sel.retida ? "Liberar para pagamento" : "Reter a parcela"}</Btn></form></details>
                <details className="rounded-md border border-line p-2"><summary className="cursor-pointer text-xs font-medium text-navy">Alterar vencimento, valor ou competência</summary>
                  <form action={editarParcela} className="mt-2 space-y-2"><input type="hidden" name="id" value={sel.id} /><input type="hidden" name="voltar" value={voltarSel} />
                    <div className="grid grid-cols-3 gap-2"><Field label="Vencimento"><Input name="vencimento" type="date" defaultValue={sel.vencimento} required /></Field><Field label="Valor (R$)"><Input name="valor" inputMode="decimal" defaultValue={num(sel.valor)} required /></Field><Field label="Competência"><Input name="competencia" type="month" defaultValue={sel.competencia ?? sel.emissao.slice(0, 7)} /></Field></div>
                    <Field label="Motivo" hint="Renegociação, novo boleto, correção…"><Textarea name="motivo" required className="min-h-[50px]" /></Field><Btn small>Salvar alteração</Btn></form></details>
                <details className="rounded-md border border-line p-2"><summary className="cursor-pointer text-xs font-medium text-erro">Cancelar a parcela</summary>
                  <form action={cancelarParcela} className="mt-2 space-y-2"><input type="hidden" name="id" value={sel.id} /><input type="hidden" name="voltar" value={voltarSel} /><Field label="Motivo"><Textarea name="motivo" required className="min-h-[50px]" /></Field><Btn small danger>Cancelar parcela</Btn></form></details>
              </div>}
              {sel.status === "CANCELADA" && <p className="text-xs text-slate-500">Parcela cancelada — fica no histórico.</p>}
            </div>
          </Card>}
          <Card title={`Parcelas (${parcs.length})`}>
            <Table head={["Parcela", "Valor", { label: "Situação", className: "hidden sm:table-cell" }, { label: "", className: "hidden sm:table-cell" }]}>
              {parcs.map(x => { const sit = situacaoParcela({ ...x, payable_status: p.status }, h, alerta); const atual = sel?.id === x.id; return <tr key={x.id} id={`p${x.id}`} className={atual ? "bg-sky-50" : sit.codigo === "VENCIDA" ? "bg-red-50/40" : x.status === "CANCELADA" ? "text-slate-400" : ""}>
                <Td className={`sm:whitespace-nowrap ${atual ? "first:!bg-sky-50" : ""}`}><Link className="whitespace-nowrap font-medium text-acao tabular-nums" href={`${voltar}?p=${x.id}#acoes`}>{x.parcela}/{p.parcelas}</Link><span className="block whitespace-nowrap text-xs sm:inline"><span className="hidden sm:inline"> · </span>vence {fmtData(x.vencimento)}</span>
                  {x.programado_para && x.status === "A_PAGAR" && <span className="block text-[11px] text-acao">pagar {fmtData(x.programado_para)}{x.conta_programada ? ` · ${x.conta_programada}` : ""}</span>}
                  <span className="block text-[11px] text-slate-500">emissão {fmtData(x.emissao)}{x.competencia ? ` · comp. ${x.competencia.split("-").reverse().join("/")}` : ""}</span></Td>
                <Td className="whitespace-nowrap tabular-nums">{brl(x.valor)}{x.codigo_barras && <span className="block text-[11px] text-ok">boleto ✓</span>}
                  <span className="mt-1 block sm:hidden"><Badge v={sit.tom} label={sit.rotulo} />{x.status === "PAGA" && <span className="block text-[11px] text-slate-500">{fmtData(x.pago_em)}{x.baixa_manual ? <span className="font-medium text-aviso"> · manual</span> : " · débito"}</span>}</span></Td>
                <Td className="hidden sm:table-cell"><Badge v={sit.tom} label={sit.rotulo} />{x.status === "PAGA" && <span className="mt-0.5 block whitespace-nowrap text-[11px] text-slate-500">{fmtData(x.pago_em)} · {brl(x.valor_pago)}{x.juros ? <span className="text-aviso"> (+juros)</span> : null}{x.baixa_manual ? <span className="font-medium text-aviso"> · manual</span> : " · débito"}</span>}</Td>
                <Td className="hidden text-right sm:table-cell">{opera && x.status !== "CANCELADA" && !atual ? <Btn small kind="ghost" href={`${voltar}?p=${x.id}#acoes`}>{x.status === "PAGA" ? "Ver" : "Ações"}</Btn> : atual ? <span className="whitespace-nowrap text-[11px] font-medium text-acao">▲ em foco</span> : null}</Td></tr>; })}
            </Table>
            <p className="mt-1 text-[11px] text-slate-500"><span className="sm:hidden">Toque no número da parcela para ver as ações. </span>“Paga” só com o débito do extrato vinculado (ou baixa manual justificada). Retida = em contestação: fora da programação e da baixa. Competência fechada trava baixar e desfazer.</p>
          </Card>
          <Anexos entidade="payable" id={pid} voltar={voltar} titulo="Boleto, nota fiscal e comprovantes" podeEnviar={opera} />
          <Card title="Linha do tempo">
            {eventos.length === 0 ? <p className="text-sm text-slate-500">Sem eventos.</p> : <ol className="space-y-2 border-l-2 border-line pl-3 text-sm">{eventos.map((e, i) => <li key={i}><div className="text-[11px] text-slate-500">{fmtDataHora(e.at)}{e.user_nome ? ` · ${e.user_nome}` : ""}</div><div className="[overflow-wrap:anywhere]">{e.texto}</div></li>)}</ol>}
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Título">
            <dl className="space-y-1.5 text-sm">
              <div><dt className="text-xs text-slate-500">Fornecedor</dt><dd>{p.fornecedor_nome}{p.supplier_id ? "" : <span className="text-xs text-slate-500"> (fora do cadastro)</span>}</dd></div>
              <div><dt className="text-xs text-slate-500">Entidade que paga</dt><dd>{p.entidade ?? "—"}{p.cnpj ? <span className="text-xs text-slate-500"> · CNPJ {p.cnpj}</span> : null}</dd></div>
              {p.contrato && <div><dt className="text-xs text-slate-500">Contrato</dt><dd><Link className="text-acao" href={`/operacoes/contratos/${p.contract_id}`}>{p.contrato}</Link></dd></div>}
              {nfe?.ok && <div><dt className="text-xs text-slate-500">NF-e (chave conferida)</dt><dd className="text-xs">{nfe.modeloNome} nº {nfe.numero.toLocaleString("pt-BR")} série {nfe.serie} · emitente {nfe.cnpjFormatado} · {nfe.uf} · {nfe.anoMes.split("-").reverse().join("/")}<span className="mt-0.5 block font-mono text-[10px] text-slate-500 [overflow-wrap:anywhere]">{nfe.chaveFormatada}</span></dd></div>}
              <div><dt className="text-xs text-slate-500">Conta do plano</dt><dd>{p.conta_codigo ? <><span className="font-mono text-xs text-slate-500">{p.conta_codigo}</span> {p.conta_nome}<span className="block text-[11px] text-slate-500">{p.macro} · categoria {p.categoria}</span></> : <>{p.categoria} <span className="text-[11px] text-aviso">(sem conta do plano)</span></>}</dd></div>
              <div><dt className="text-xs text-slate-500">Centro de custo</dt><dd>{p.centro ?? <span className="text-slate-500">— a unidade que paga</span>}</dd></div>
              <div><dt className="text-xs text-slate-500">Natureza</dt><dd>{ehNatureza(p.natureza) ? NATUREZAS[p.natureza].rotulo : p.natureza}{ehNatureza(p.natureza) && <span className="block text-[11px] text-slate-500">{NATUREZAS[p.natureza].dica}</span>}</dd></div>
              <div><dt className="text-xs text-slate-500">Parcelas</dt><dd>{p.recorrente ? `Recorrente · ${brl(p.valor_total)} por parcela` : `Parcelado · total ${brl(p.valor_total)}`} · {INTERVALO_LABEL[p.intervalo as Intervalo] ?? p.intervalo}{p.intervalo === "DIAS" && p.dias_intervalo ? ` (${p.dias_intervalo} dias)` : ""}</dd></div>
              <div><dt className="text-xs text-slate-500">1º vencimento (âncora)</dt><dd>{fmtData(p.primeiro_vencimento)}{p.ajustar_dia_util ? " · ajusta para dia útil" : ""}</dd></div>
              <div><dt className="text-xs text-slate-500">Responsável pela despesa</dt><dd>{p.responsavel ?? "—"}</dd></div>
              <div><dt className="text-xs text-slate-500">Lançado</dt><dd>{p.lancado_por ?? "—"} · {fmtDataHora(p.created_at)}</dd></div>
              {aprovacoes.length > 0 && p.status !== "REJEITADO" && <div><dt className="text-xs text-slate-500">Aprovação{aprovacoes.length > 1 ? " (dupla checagem)" : ""}</dt><dd>{aprovacoes.map(a => <span key={a.userId} className="block">{a.nome} · {fmtDataHora(a.at)}</span>)}</dd></div>}
            </dl>
            {p.obs && <p className="mt-3 whitespace-pre-wrap rounded bg-mist p-2 text-sm">{p.obs}</p>}
          </Card>
          {opera && p.recorrente && ["ATIVO", "QUITADO"].includes(p.status) && <Card title="Estender a recorrência">
            <form action={estenderRecorrencia} className="space-y-2"><input type="hidden" name="id" value={pid} />
              <div className="grid grid-cols-2 gap-2"><Field label="Mais parcelas"><Input name="n" type="number" min={1} max={120} defaultValue={12} required /></Field><Field label="Valor (R$)" hint="Reajuste? Informe o novo."><Input name="valor" inputMode="decimal" defaultValue={num(p.valor_total)} /></Field></div>
              <p className="text-[11px] text-slate-500">Segue o dia-âncora {p.primeiro_vencimento ? fmtData(p.primeiro_vencimento).slice(0, 2) : ""} e o mesmo intervalo. Acima da alçada ou fora do orçamento, só quem aprova.</p>
              <Btn small>Estender</Btn></form></Card>}
          {opera && aberto && <Card title="Cancelar o título"><form action={cancelarContaPagar} className="space-y-2"><input type="hidden" name="id" value={pid} /><p className="text-xs text-slate-600">As parcelas em aberto são canceladas; as pagas ficam no histórico.</p><Field label="Motivo"><Textarea name="motivo" required className="min-h-[50px]" /></Field><Btn small danger>Cancelar título</Btn></form></Card>}
        </div>
      </div>
    </Page>
  );
}
