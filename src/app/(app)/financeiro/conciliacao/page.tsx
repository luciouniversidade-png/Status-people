import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession } from "@/lib/auth";
import { Page, Card, Table, Td, Badge, Flash, Field, Select, Input, Textarea, Stat, Btn } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { BarraContexto } from "@/components/BarraContexto";
import { lerContexto, qsContexto, filtroUnidades } from "@/lib/contexto";
import { audit, getSettings, fmtData, fmtDataHora, hoje } from "@/lib/utils";
import { brl } from "@/lib/financeiro";
import { fmtReais } from "@/lib/formato";
import { podeOperar, podeVer, podeTriar, LINHA_STATUS, VENDA_STATUS, REPASSE_STATUS, FORMA_LINHA, CLASSES_IGNORA, categoriaCartao, taxaContratada, competenciaFechada } from "@/lib/conciliacao";
import { salvarConta, importarExtrato, importarCielo, reprocessar, confirmarPar, confirmarLote, vincular, desfazer, classificar, identificar } from "./actions";

export const dynamic = "force-dynamic";
const ABAS: [string, string][] = [["pix", "PIX, boletos e depósitos"], ["cartao", "Cartão (Cielo)"], ["triagem", "Triagem de pagadores"], ["contas", "Contas e importação"]];
const pctTxt = (v: number | null) => v === null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const mascaraConta = (c: string | null) => c ? `••••${c.replace(/\D/g, "").slice(-4)}` : "—";

/** T-034/T-035 · Conciliação: créditos do extrato × baixas do ActiveSoft e vendas da Cielo × títulos e repasses, com fila de confirmação. */
export default async function Conciliacao({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams;
  if (!podeVer(s)) { await audit(s, "acesso negado: conciliação", "bank_lines", null, null, { papel: s.role }); redirect("/?erro=" + encodeURIComponent("A conciliação é do Financeiro e da Direção — a tentativa foi registrada.")); }
  const opera = podeOperar(s); const secretaria = s.role === "COMERCIAL";
  const aba = secretaria ? "triagem" : ABAS.some(([k]) => k === sp.aba) ? sp.aba! : "pix";
  const ctx = await lerContexto(s, sp); const cfg = await getSettings(); const [a, m] = ctx.periodo.split("-").map(Number); const ini = `${ctx.periodo}-01`; const fim = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  const voltar = `/financeiro/conciliacao?aba=${aba}&${qsContexto(ctx)}${sp.conta ? `&conta=${sp.conta}` : ""}${sp.situacao ? `&situacao=${sp.situacao}` : ""}`;
  const contas = await sql<{ id: number; apelido: string; banco: string | null; agencia: string | null; conta: string | null; unit_id: number | null; company_id: number | null; tipo: string; ativo: boolean; unidade: string | null; entidade: string | null; ultima: string | null; linhas: number }[]>`
    SELECT a.id, a.apelido, a.banco, a.agencia, a.conta, a.unit_id, a.company_id, a.tipo, a.ativo, u.nome AS unidade, c.nome AS entidade, (SELECT max(l.data) FROM bank_lines l WHERE l.bank_account_id=a.id)::text AS ultima, (SELECT count(*) FROM bank_lines l WHERE l.bank_account_id=a.id)::int AS linhas
    FROM bank_accounts a LEFT JOIN units u ON u.id=a.unit_id LEFT JOIN companies c ON c.id=a.company_id ORDER BY a.ativo DESC, a.apelido`;
  const contasNoRecorte = contas.filter(c => ctx.unitIds === null || (c.unit_id ? ctx.unitIds.includes(c.unit_id) : c.company_id === null || ctx.units.some(u => ctx.unitIds!.includes(u.id) && u.company_id === c.company_id))).map(c => c.id);
  const travada = await competenciaFechada(ini, ctx.unitId);
  const tabs = <nav className="mb-4 flex flex-wrap gap-2" aria-label="Abas da conciliação">{ABAS.filter(([k]) => !secretaria || k === "triagem").map(([k, t]) => <Link key={k} href={`/financeiro/conciliacao?aba=${k}&${qsContexto(ctx)}`} className={`rounded-full border px-3 py-1.5 text-sm ${aba === k ? "border-navy bg-navy text-white" : "border-line bg-white text-navy hover:bg-mist"}`}>{t}</Link>)}</nav>;
  const sub = "Cada baixa do ActiveSoft casada com o dinheiro: crédito no extrato (PIX, boleto, TED, depósito) ou venda e repasse da Cielo. Par com confiança alta entra sozinho; o resto vai para a sua confirmação. A quitação continua sendo do ActiveSoft.";

  // ------------------------------------------------------------ PIX, boletos e depósitos
  if (aba === "pix") {
    const SIT: Record<string, string[]> = { abertos: ["PENDENTE", "SUGERIDO", "SEM_PAR", "DIVERGENTE", "NAO_IDENTIFICADO", "SEM_BAIXA"], sugeridos: ["SUGERIDO"], conciliados: ["CONCILIADO"], naoidentificados: ["NAO_IDENTIFICADO"], sembaixa: ["SEM_BAIXA"], classificados: ["IGNORADO"], todos: Object.keys(LINHA_STATUS) };
    const situacao = SIT[sp.situacao ?? ""] ? sp.situacao! : "abertos"; const contaF = Number(sp.conta) || null; const busca = (sp.q ?? "").trim();
    const filtroConta = contaF ? sql`AND l.bank_account_id=${contaF}` : sql`AND l.bank_account_id = ANY(${contasNoRecorte})`;
    const [[st], linhas, [{ total }]] = await Promise.all([
      sql<{ n: number; valor: number; conc: number; vconc: number; auto: number; sug: number; semb: number; nid: number; sempar: number; diverg: number }[]>`SELECT count(*)::int AS n, coalesce(sum(l.valor),0)::float AS valor, count(*) FILTER (WHERE l.status='CONCILIADO')::int AS conc, coalesce(sum(l.valor) FILTER (WHERE l.status='CONCILIADO'),0)::float AS vconc,
          count(*) FILTER (WHERE l.status='CONCILIADO' AND EXISTS (SELECT 1 FROM recon_matches mm WHERE mm.bank_line_id=l.id AND mm.status='CONFIRMADO' AND mm.metodo='AUTO'))::int AS auto, count(*) FILTER (WHERE l.status='SUGERIDO')::int AS sug, count(*) FILTER (WHERE l.status='SEM_BAIXA')::int AS semb,
          count(*) FILTER (WHERE l.status='NAO_IDENTIFICADO')::int AS nid, count(*) FILTER (WHERE l.status='SEM_PAR')::int AS sempar, count(*) FILTER (WHERE l.status='DIVERGENTE')::int AS diverg
        FROM bank_lines l WHERE l.valor > 0 AND l.forma IN ('PIX','BOLETO','TED','DEPOSITO','OUTRO') AND l.data BETWEEN ${ini} AND ${fim} ${filtroConta}`,
      sql<{ id: number; data: string; valor: number; forma: string; descricao: string | null; pagador: string | null; status: string; classe: string | null; apelido: string; unit_id: number | null; student_id: number | null; familia: string | null }[]>`SELECT l.id, l.data::text, l.valor::float, l.forma, l.descricao, l.pagador, l.status, l.classe, a.apelido, a.unit_id, l.student_id, st.nome AS familia
        FROM bank_lines l JOIN bank_accounts a ON a.id=l.bank_account_id LEFT JOIN students st ON st.id=l.student_id
        WHERE l.valor > 0 AND l.forma IN ('PIX','BOLETO','TED','DEPOSITO','OUTRO') AND l.data BETWEEN ${ini} AND ${fim} ${filtroConta} AND l.status = ANY(${SIT[situacao]})
          ${busca ? sql`AND (l.pagador ILIKE ${"%" + busca + "%"} OR l.descricao ILIKE ${"%" + busca + "%"} OR st.nome ILIKE ${"%" + busca + "%"})` : sql``}
        ORDER BY CASE l.status WHEN 'SUGERIDO' THEN 0 WHEN 'SEM_BAIXA' THEN 1 WHEN 'NAO_IDENTIFICADO' THEN 2 WHEN 'DIVERGENTE' THEN 3 WHEN 'SEM_PAR' THEN 4 ELSE 5 END, l.data, l.id LIMIT 150`,
      sql<{ total: number }[]>`SELECT count(*)::int AS total FROM bank_lines l LEFT JOIN students st ON st.id=l.student_id WHERE l.valor > 0 AND l.forma IN ('PIX','BOLETO','TED','DEPOSITO','OUTRO') AND l.data BETWEEN ${ini} AND ${fim} ${filtroConta} AND l.status = ANY(${SIT[situacao]})`,
    ]);
    const ids = linhas.map(l => l.id);
    const pares = ids.length ? await sql<{ bank_line_id: number; grupo: string; status: string; confianca: number; motivo: string | null; metodo: string; receivable_id: number; aluno_nome: string; vencimento: string; valor: number; pago_em: string | null }[]>`SELECT m.bank_line_id, m.grupo, m.status, m.confianca, m.motivo, m.metodo, m.receivable_id, r.aluno_nome, r.vencimento::text, m.valor::float, r.pago_em::text
      FROM recon_matches m JOIN receivables r ON r.id=m.receivable_id WHERE m.bank_line_id = ANY(${ids}) AND m.status IN ('SUGERIDO','CONFIRMADO') ORDER BY m.id` : [];
    const semBaixa = ids.length ? await sql<{ bank_line_id: number; aluno_nome: string; vencimento: string }[]>`SELECT i.bank_line_id, r.aluno_nome, r.vencimento::text FROM recon_issues i JOIN receivables r ON r.id=i.receivable_id WHERE i.tipo='SEM_BAIXA' AND i.bank_line_id = ANY(${ids})` : [];
    // candidatos para o vínculo manual: títulos baixados e ainda sem par, perto da data do crédito
    const cands = ids.length && opera ? await sql<{ id: number; aluno_nome: string; responsavel: string | null; valor: number; pago_em: string; forma: string | null; unit_id: number; student_id: number | null }[]>`SELECT r.id, r.aluno_nome, r.responsavel, coalesce(r.valor_pago, r.valor)::float AS valor, r.pago_em::text, r.forma_pagamento AS forma, r.unit_id, r.student_id
      FROM receivables r WHERE r.status='PAGO' AND r.conciliado_em IS NULL AND r.pago_em BETWEEN ${ini}::date - 10 AND ${fim}::date + 5 ${filtroUnidades(ctx, "r.unit_id")} AND coalesce(r.forma_pagamento,'') <> 'CARTAO' ORDER BY r.pago_em LIMIT 2000` : [];
    return (
      <Page title="Conciliação" sub={sub} actions={<><Btn kind="ghost" href={`/api/export/extrato?periodo=${ctx.periodo}`}>Exportar CSV</Btn><Btn kind="ghost" href="/financeiro/recebimentos">Recebimentos do mês</Btn><Btn kind="ghost" href="/financeiro/divergencias">Divergências</Btn></>}>
        <Flash ok={sp.ok} erro={sp.erro} />
        <BarraContexto ctx={ctx} voltar="/financeiro/conciliacao" />
        {tabs}
        {travada && <p className="mb-3 rounded-md border border-line bg-mist px-3 py-2 text-xs text-slate-600">Competência fechada em {fmtData(travada.fechado_em.slice(0, 10))}{travada.por ? ` por ${travada.por}` : ""}: confirmações, vínculos e classificações deste mês estão travados.</p>}
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <Stat label="Créditos no mês" value={st.n} hint={`${brl(st.valor)} · PIX, boleto, TED e depósito`} />
          <Stat label="Conciliados" value={<span className="text-ok">{st.conc}</span>} hint={`${pctTxt(st.n ? (100 * st.conc) / st.n : null)} dos créditos · ${fmtReais(st.vconc, true)}`} href={`/financeiro/conciliacao?aba=pix&situacao=conciliados&${qsContexto(ctx)}`} />
          <Stat label="Identificação automática" value={pctTxt(st.conc ? (100 * st.auto) / st.conc : null)} hint={`${st.auto} par(es) sem intervenção (confiança ≥ ${cfg.conciliacao.limiarAuto}%)`} />
          <Stat label="Para confirmar" value={<span className={st.sug ? "text-aviso" : ""}>{st.sug}</span>} hint="pares sugeridos abaixo do limiar" href={`/financeiro/conciliacao?aba=pix&situacao=sugeridos&${qsContexto(ctx)}`} />
          <Stat label="Sem baixa no ActiveSoft" value={<span className={st.semb ? "text-erro" : ""}>{st.semb}</span>} hint="dinheiro no banco, título em aberto" href={`/financeiro/conciliacao?aba=pix&situacao=sembaixa&${qsContexto(ctx)}`} />
          <Stat label="Não identificados" value={<span className={st.nid ? "text-erro" : ""}>{st.nid}</span>} hint={`${st.sempar} sem título · ${st.diverg} com diferença`} href={`/financeiro/conciliacao?aba=pix&situacao=naoidentificados&${qsContexto(ctx)}`} />
        </div>
        <Card>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <form className="flex flex-wrap items-end gap-2"><input type="hidden" name="aba" value="pix" /><input type="hidden" name="ctx_p" value={ctx.periodo} />{ctx.entidadeId && <input type="hidden" name="ctx_e" value={ctx.entidadeId} />}{ctx.unitId && <input type="hidden" name="ctx_u" value={ctx.unitId} />}
              <Field label="Conta" className="w-full sm:w-56"><Select name="conta" defaultValue={contaF ?? ""}><option value="">Todas do recorte</option>{contas.filter(c => contasNoRecorte.includes(c.id)).map(c => <option key={c.id} value={c.id}>{c.apelido}</option>)}</Select></Field>
              <Field label="Situação" className="w-full sm:w-48"><Select name="situacao" defaultValue={situacao}><option value="abertos">A tratar</option><option value="sugeridos">Para confirmar</option><option value="sembaixa">Sem baixa no ActiveSoft</option><option value="naoidentificados">Não identificados</option><option value="conciliados">Conciliados</option><option value="classificados">Não é recebimento</option><option value="todos">Todos</option></Select></Field>
              <Field label="Buscar" className="min-w-[12rem] flex-1"><Input name="q" defaultValue={busca} placeholder="pagador, histórico ou família" /></Field>
              <Btn kind="ghost">Filtrar</Btn></form>
            {opera && !travada && st.sug > 0 && <form action={confirmarLote} className="flex flex-wrap items-end gap-2 rounded-md bg-mist p-2"><input type="hidden" name="competencia" value={ctx.periodo} /><input type="hidden" name="voltar" value={voltar} />
              <Field label="Confirmar sugestões com confiança a partir de (%)" className="w-full sm:w-64"><Input name="minimo" type="number" min={50} max={99} defaultValue={80} /></Field><Btn small kind="ghost" pendingText="Confirmando…">Confirmar em lote</Btn></form>}
          </div>
          <Table head={["Data", "Conta", "Pagador / histórico", "Valor", "Situação", "Par", ""]} empty="Nenhum crédito nesta situação.">
            {linhas.map(l => { const ps = pares.filter(x => x.bank_line_id === l.id); const g = ps[0]?.grupo; const sb = semBaixa.find(x => x.bank_line_id === l.id); const conf = ps.length ? Math.min(...ps.map(x => x.confianca)) : null;
              const meus = cands.filter(c => (!l.unit_id || c.unit_id === l.unit_id) && Math.abs(Date.parse(c.pago_em) - Date.parse(l.data)) <= 10 * 86400000 && (c.valor <= l.valor + 0.005) && (!l.student_id || c.student_id === l.student_id)).sort((x, y) => Math.abs(x.valor - l.valor) - Math.abs(y.valor - l.valor)).slice(0, 25);
              return <tr key={l.id}>
                <Td className="whitespace-nowrap text-xs">{fmtData(l.data)}</Td>
                <Td className="text-xs">{l.apelido}<div className="text-[11px] text-slate-500">{FORMA_LINHA[l.forma] ?? l.forma}</div></Td>
                <Td className="text-xs"><div className="font-medium text-ink">{l.pagador ?? "—"}</div><div className="text-[11px] text-slate-500">{l.descricao}</div>{l.familia && <div className="text-[11px] text-acao">família: {l.familia}</div>}</Td>
                <Td className="whitespace-nowrap tabular-nums">{brl(l.valor)}</Td>
                <Td><Badge v={LINHA_STATUS[l.status]?.tom ?? "PENDENTE"} label={LINHA_STATUS[l.status]?.rotulo ?? l.status} />{l.classe && <div className="mt-0.5 text-[11px] text-slate-500">{CLASSES_IGNORA[l.classe]}</div>}</Td>
                <Td className="text-xs">{ps.length ? <><ul className="space-y-0.5">{ps.map(x => <li key={x.receivable_id}>{x.aluno_nome} · venc. {fmtData(x.vencimento)} · {brl(x.valor)}</li>)}</ul>
                    <div className="mt-0.5 text-[11px] text-slate-500" title={ps[0].motivo ?? ""}>{ps[0].status === "CONFIRMADO" ? (ps[0].metodo === "AUTO" ? `automático · ${conf}%` : `confirmado por pessoa`) : `sugestão · ${conf}%`} — {ps[0].motivo}</div></>
                  : sb ? <span className="text-erro">título em aberto: {sb.aluno_nome} · venc. {fmtData(sb.vencimento)} — registrar a baixa no ActiveSoft</span> : <span className="text-slate-400">—</span>}</Td>
                <Td className="whitespace-nowrap">{opera && !travada && <div className="flex flex-col items-start gap-1">
                  {ps[0]?.status === "SUGERIDO" && <form action={confirmarPar}><input type="hidden" name="grupo" value={g} /><input type="hidden" name="voltar" value={voltar} /><Btn small>Confirmar</Btn></form>}
                  {ps[0]?.status === "CONFIRMADO" && <Modal label="Desfazer" title="Desfazer o par"><form action={desfazer} className="space-y-2"><input type="hidden" name="grupo" value={g} /><input type="hidden" name="voltar" value={voltar} /><Field label="Por que o par está errado?"><Textarea name="motivo" required minLength={5} /></Field><Btn small>Desfazer par</Btn></form></Modal>}
                  {l.status !== "CONCILIADO" && l.status !== "IGNORADO" && <Modal label="Vincular" title={`Vincular o crédito de ${brl(l.valor)} (${fmtData(l.data)})`}><form action={vincular} className="space-y-2"><input type="hidden" name="lineId" value={l.id} /><input type="hidden" name="voltar" value={voltar} />
                    <p className="text-xs text-slate-600">Marque os títulos baixados no ActiveSoft que este crédito paga — a soma precisa bater exatamente. Título ainda em aberto? Registre a baixa no ActiveSoft e reimporte os títulos.</p>
                    {meus.length === 0 ? <p className="text-sm text-slate-500">Nenhum título baixado e sem par perto desta data.</p> : <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-line p-2">{meus.map(c => <label key={c.id} className="flex items-start gap-2 text-xs"><input type="checkbox" name="receivableId" value={c.id} className="mt-0.5" /><span><b>{c.aluno_nome}</b> · {brl(c.valor)} · pago {fmtData(c.pago_em)}{c.forma ? ` · ${c.forma}` : ""}<span className="block text-[11px] text-slate-500">{c.responsavel}</span></span></label>)}</div>}
                    <Field label="Observação"><Input name="motivo" placeholder="Ex.: PIX único para os dois irmãos" /></Field><Btn small>Vincular e conciliar</Btn></form></Modal>}
                  {l.status !== "CONCILIADO" && l.status !== "IGNORADO" && <Modal label="Não é mensalidade" title="Classificar o crédito"><form action={classificar} className="space-y-2"><input type="hidden" name="lineId" value={l.id} /><input type="hidden" name="voltar" value={voltar} />
                    <Field label="Classe"><Select name="classe" required defaultValue="">{[["", "Escolha"], ...Object.entries(CLASSES_IGNORA)].map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Observação"><Input name="obs" /></Field><Btn small>Classificar</Btn></form></Modal>}
                </div>}</Td>
              </tr>; })}
          </Table>
          {total > linhas.length && <p className="mt-2 text-xs text-slate-500">Mostrando {linhas.length} de {total}. Use os filtros ou a busca para chegar ao item.</p>}
        </Card>
      </Page>
    );
  }

  // ------------------------------------------------------------ Cartão (Cielo)
  if (aba === "cartao") {
    const uv = ctx.unitIds === null ? sql`` : sql`AND (v.unit_id = ANY(${ctx.unitIds}) OR v.unit_id IS NULL)`;
    const [[st], vendas, repasses, ant] = await Promise.all([
      sql<{ n: number; bruto: number; taxa: number; liquido: number; casadas: number; sug: number; creditado: number; acreditar: number }[]>`SELECT count(*)::int AS n, coalesce(sum(valor_bruto),0)::float AS bruto, coalesce(sum(valor_taxa),0)::float AS taxa, coalesce(sum(valor_liquido),0)::float AS liquido,
          count(*) FILTER (WHERE status='CASADA')::int AS casadas, count(*) FILTER (WHERE status='SUGERIDO')::int AS sug, coalesce(sum(valor_liquido) FILTER (WHERE repasse='CREDITADA'),0)::float AS creditado, coalesce(sum(valor_liquido) FILTER (WHERE data_pagamento <= ${hoje()}),0)::float AS acreditar
        FROM card_sales v WHERE v.data_venda BETWEEN ${ini} AND ${fim} ${uv}`,
      sql<{ id: number; data_venda: string; data_pagamento: string | null; bandeira: string; produto: string; parcelas: number; parcela: number; nsu: string | null; valor_bruto: number; valor_taxa: number; valor_liquido: number; antecipado: boolean; status: string; repasse: string; unidade: string | null; grupo: string | null; mstatus: string | null; conf: number | null; aluno: string | null }[]>`
        SELECT v.id, v.data_venda::text, v.data_pagamento::text, v.bandeira, v.produto, v.parcelas, v.parcela, v.nsu, v.valor_bruto::float, v.valor_taxa::float, v.valor_liquido::float, v.antecipado, v.status, v.repasse, u.nome AS unidade,
          m.grupo, m.status AS mstatus, m.confianca AS conf, r.aluno_nome AS aluno
        FROM card_sales v LEFT JOIN units u ON u.id=v.unit_id LEFT JOIN LATERAL (SELECT * FROM recon_matches mm WHERE mm.card_sale_id=v.id AND mm.tipo='CARTAO' AND mm.status IN ('SUGERIDO','CONFIRMADO') ORDER BY mm.id DESC LIMIT 1) m ON true LEFT JOIN receivables r ON r.id=m.receivable_id
        WHERE v.data_venda BETWEEN ${ini} AND ${fim} ${uv} ORDER BY CASE v.status WHEN 'SUGERIDO' THEN 0 WHEN 'PENDENTE' THEN 1 ELSE 2 END, v.data_venda, v.id LIMIT 150`,
      sql<{ data: string; bandeira: string; n: number; previsto: number; creditado: number }[]>`SELECT v.data_pagamento::text AS data, v.bandeira, count(*)::int AS n, sum(v.valor_liquido)::float AS previsto, coalesce(sum(v.valor_liquido) FILTER (WHERE v.repasse='CREDITADA'),0)::float AS creditado
        FROM card_sales v WHERE v.data_pagamento BETWEEN ${ini} AND ${fim} ${uv} GROUP BY 1, 2 ORDER BY 1, 2`,
      sql<{ n: number; taxa: number }[]>`SELECT count(*)::int AS n, coalesce(sum(valor_taxa),0)::float AS taxa FROM card_sales v WHERE v.antecipado AND v.data_venda BETWEEN ${ini} AND ${fim} ${uv}`,
    ]);
    const todas = await sql<{ bandeira: string; produto: string; parcelas: number; valor_bruto: number; valor_taxa: number; antecipado: boolean }[]>`SELECT bandeira, produto, parcelas, valor_bruto::float, valor_taxa::float, antecipado FROM card_sales v WHERE v.data_venda BETWEEN ${ini} AND ${fim} ${uv}`;
    const painel = new Map<string, { bandeira: string; categoria: string; n: number; bruto: number; taxa: number }>();
    for (const v of todas) { if (v.antecipado) continue; const cat = categoriaCartao(v.produto, v.parcelas); const k = `${v.bandeira}|${cat}`; const x = painel.get(k) ?? { bandeira: v.bandeira, categoria: cat, n: 0, bruto: 0, taxa: 0 }; x.n++; x.bruto += v.valor_bruto; x.taxa += v.valor_taxa; painel.set(k, x); }
    const tol = cfg.conciliacao.toleranciaTaxaPp as number;
    return (
      <Page title="Conciliação" sub={sub} actions={<><Btn kind="ghost" href="/financeiro/recebimentos">Recebimentos do mês</Btn><Btn kind="ghost" href="/financeiro/divergencias">Divergências</Btn></>}>
        <Flash ok={sp.ok} erro={sp.erro} />
        <BarraContexto ctx={ctx} voltar="/financeiro/conciliacao?aba=cartao" />
        {tabs}
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <Stat label="Vendas no mês" value={st.n} hint={`bruto ${brl(st.bruto)}`} />
          <Stat label="Taxas da operadora" value={fmtReais(st.taxa, true)} hint={`${pctTxt(st.bruto ? (100 * st.taxa) / st.bruto : null)} do bruto · ${brl(st.taxa)}`} />
          <Stat label="Casadas com o título" value={<span className="text-ok">{pctTxt(st.n ? (100 * st.casadas) / st.n : null)}</span>} hint={`${st.casadas} de ${st.n} · ${st.sug} para confirmar`} />
          <Stat label="Repasse creditado" value={fmtReais(st.creditado, true)} hint={`de ${brl(st.acreditar)} previstos até hoje`} />
          <Stat label="Antecipações" value={ant[0].n} hint={ant[0].n ? `custo ${brl(ant[0].taxa)} (fora da conferência de taxa)` : "nenhuma no mês"} />
          <Stat label="Líquido das vendas" value={fmtReais(st.liquido, true)} hint={brl(st.liquido)} />
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card title="Taxa praticada × contratada">
            <Table head={["Bandeira", "Categoria", "Vendas", "Praticada", "Contratada", "Excesso"]} empty="Nenhuma venda no mês.">
              {[...painel.values()].sort((x, y) => y.bruto - x.bruto).map(x => { const prat = x.bruto ? (100 * x.taxa) / x.bruto : 0; const contr = taxaContratada(cfg, x.bandeira, x.categoria); const exc = contr === null ? null : Math.max(0, x.bruto * (prat - contr) / 100);
                return <tr key={`${x.bandeira}${x.categoria}`}><Td>{x.bandeira}</Td><Td className="text-xs">{x.categoria}</Td><Td className="tabular-nums">{x.n}</Td><Td className={`tabular-nums ${contr !== null && prat > contr + tol ? "text-erro font-semibold" : ""}`}>{pctTxt(prat)}</Td><Td className="tabular-nums">{contr === null ? "—" : pctTxt(contr)}</Td><Td className={`tabular-nums ${exc ? "text-erro" : ""}`}>{exc ? brl(exc) : "—"}</Td></tr>; })}
            </Table>
            <p className="mt-2 text-xs text-slate-500">Taxas contratadas em Configurações → Conciliação (exemplo de fábrica: troque pelas do seu contrato). Excesso acima de {tol.toLocaleString("pt-BR")} p.p. abre uma divergência por bandeira, categoria e mês.</p>
          </Card>
          <Card title="Repasses da Cielo × banco">
            <Table head={["Data prevista", "Bandeira", "Vendas", "Previsto (líquido)", "Creditado", "Situação"]} empty="Nenhum repasse previsto no mês.">
              {repasses.map(r => { const dif = Math.round((r.previsto - r.creditado) * 100) / 100; return <tr key={`${r.data}${r.bandeira}`}><Td className="text-xs">{fmtData(r.data)}</Td><Td>{r.bandeira}</Td><Td className="tabular-nums">{r.n}</Td><Td className="tabular-nums">{brl(r.previsto)}</Td><Td className="tabular-nums">{brl(r.creditado)}</Td>
                <Td>{dif < 0.005 ? <Badge v="APROVADA" label="creditado" /> : r.data > hoje() ? <Badge v="PENDENTE" label="a receber" /> : <Badge v="REJEITADA" label={`falta ${brl(dif)}`} />}</Td></tr>; })}
            </Table>
          </Card>
        </div>
        <Card title="Vendas do mês" className="mt-4">
          <Table head={["Venda", "Bandeira / produto", "NSU", "Bruto", "Taxa", "Líquido", "Título", "Repasse", ""]} empty="Nenhuma venda importada no mês — importe o relatório da Cielo em Contas e importação.">
            {vendas.map(v => <tr key={v.id}><Td className="whitespace-nowrap text-xs">{fmtData(v.data_venda)}<div className="text-[11px] text-slate-500">{v.unidade ?? "—"}</div></Td><Td className="text-xs">{v.bandeira}<div className="text-[11px] text-slate-500">{v.produto}{v.parcelas > 1 ? ` · parcela ${v.parcela}/${v.parcelas}` : ""}{v.antecipado ? " · antecipada" : ""}</div></Td><Td className="text-xs">{v.nsu ?? "—"}</Td>
              <Td className="tabular-nums">{brl(v.valor_bruto)}</Td><Td className="tabular-nums text-xs">{brl(v.valor_taxa)}<div className="text-[11px] text-slate-500">{pctTxt(v.valor_bruto ? (100 * v.valor_taxa) / v.valor_bruto : null)}</div></Td><Td className="tabular-nums">{brl(v.valor_liquido)}</Td>
              <Td className="text-xs"><Badge v={VENDA_STATUS[v.status]?.tom ?? "PENDENTE"} label={VENDA_STATUS[v.status]?.rotulo ?? v.status} />{v.aluno && <div className="mt-0.5">{v.aluno}{v.conf !== null ? ` · ${v.conf}%` : ""}</div>}</Td>
              <Td className="text-xs"><Badge v={REPASSE_STATUS[v.repasse]?.tom ?? "PENDENTE"} label={REPASSE_STATUS[v.repasse]?.rotulo ?? v.repasse} /><div className="text-[11px] text-slate-500">{fmtData(v.data_pagamento)}</div></Td>
              <Td>{opera && v.mstatus === "SUGERIDO" && v.grupo && <form action={confirmarPar}><input type="hidden" name="grupo" value={v.grupo} /><input type="hidden" name="voltar" value={`/financeiro/conciliacao?aba=cartao&${qsContexto(ctx)}`} /><Btn small>Confirmar</Btn></form>}
                {opera && v.mstatus === "CONFIRMADO" && v.grupo && <Modal label="Desfazer" title="Desfazer venda × título"><form action={desfazer} className="space-y-2"><input type="hidden" name="grupo" value={v.grupo} /><input type="hidden" name="voltar" value={`/financeiro/conciliacao?aba=cartao&${qsContexto(ctx)}`} /><Field label="Motivo"><Textarea name="motivo" required minLength={5} /></Field><Btn small>Desfazer</Btn></form></Modal>}</Td></tr>)}
          </Table>
        </Card>
      </Page>
    );
  }

  // ------------------------------------------------------------ Triagem (secretaria): PIX não identificados e créditos sem baixa
  if (aba === "triagem") {
    const itens = await sql<{ id: number; tipo: string; idade: number; escalonamento: number; line_id: number; data: string; valor: number; pagador: string | null; descricao: string | null; apelido: string; aluno: string | null; vencimento: string | null }[]>`
      SELECT i.id, i.tipo, (current_date - i.created_at::date)::int AS idade, i.escalonamento, l.id AS line_id, l.data::text, l.valor::float, l.pagador, l.descricao, a.apelido, r.aluno_nome AS aluno, r.vencimento::text
      FROM recon_issues i JOIN bank_lines l ON l.id=i.bank_line_id JOIN bank_accounts a ON a.id=l.bank_account_id LEFT JOIN receivables r ON r.id=i.receivable_id
      WHERE i.status='ABERTA' AND i.tipo IN ('NAO_IDENTIFICADO','SEM_BAIXA') ${ctx.unitIds === null ? sql`` : sql`AND (i.unit_id = ANY(${ctx.unitIds}) OR i.unit_id IS NULL)`} ORDER BY i.escalonamento DESC, i.created_at LIMIT 200`;
    const alunos = itens.some(x => x.tipo === "NAO_IDENTIFICADO") ? await sql<{ id: number; nome: string; unidade: string | null; responsavel: string | null }[]>`SELECT st.id, st.nome, u.nome AS unidade, st.responsavel FROM students st LEFT JOIN units u ON u.id=st.unit_atual_id WHERE st.aluno_atual ${filtroUnidades(ctx, "st.unit_atual_id")} ORDER BY st.nome` : [];
    return (
      <Page title="Conciliação" sub="Triagem de pagadores: cada PIX sem pagador reconhecido fica na lista, com idade, até alguém dizer de qual família é — nunca num limbo. Crédito que bate com título em aberto pede a baixa no ActiveSoft.">
        <Flash ok={sp.ok} erro={sp.erro} />
        <BarraContexto ctx={ctx} voltar="/financeiro/conciliacao?aba=triagem" periodo={false} />
        {tabs}
        <Card title={`A identificar (${itens.length})`}>
          <datalist id="alunos-triagem">{alunos.map(x => <option key={x.id} value={`${x.nome} — ${x.unidade ?? "rede"} (#${x.id})`}>{x.responsavel ?? ""}</option>)}</datalist>
          <Table head={["Crédito", "Pagador / histórico", "Valor", "Idade", "O que fazer"]} empty="Nada a identificar. Bom trabalho.">
            {itens.map(x => <tr key={x.id}><Td className="whitespace-nowrap text-xs">{fmtData(x.data)}<div className="text-[11px] text-slate-500">{x.apelido}</div></Td><Td className="text-xs"><div className="font-medium">{x.pagador ?? "sem nome do pagador"}</div><div className="text-[11px] text-slate-500">{x.descricao}</div></Td>
              <Td className="tabular-nums">{brl(x.valor)}</Td><Td>{x.escalonamento >= 2 ? <Badge v="REJEITADA" label={`${x.idade} d`} /> : x.escalonamento === 1 ? <Badge v="PENDENTE" label={`${x.idade} d`} /> : <span className="text-xs">{x.idade} d</span>}</Td>
              <Td className="text-xs">{x.tipo === "NAO_IDENTIFICADO" ? (podeTriar(s) ? <form action={identificar} className="flex flex-wrap items-end gap-2"><input type="hidden" name="lineId" value={x.line_id} /><input type="hidden" name="voltar" value={`/financeiro/conciliacao?aba=triagem&${qsContexto(ctx)}`} />
                  <Field label="Família (aluno)" className="w-full sm:w-72"><Input name="aluno" list="alunos-triagem" required placeholder="digite o nome do aluno" /></Field><Btn small>Identificar</Btn></form> : "—")
                : <span className="text-erro">Título em aberto de {x.aluno} (venc. {fmtData(x.vencimento)}): registre a baixa no ActiveSoft e reimporte os títulos. <Link className="text-acao" href={`/financeiro/divergencias#p${x.id}`}>pendência #{x.id}</Link></span>}</Td></tr>)}
          </Table>
          <p className="mt-2 text-xs text-slate-500">Pendência aberta há {(cfg.conciliacao.escalonamentoDias as number[])[0]} dias escala ao gestor financeiro. Na dúvida sobre o pagador, peça à família o comprovante — o nome no extrato costuma vir abreviado.</p>
        </Card>
      </Page>
    );
  }

  // ------------------------------------------------------------ Contas e importação
  const imports = await sql<{ id: number; tipo: string; arquivo: string | null; linhas: number; novas: number; repetidas: number; travadas: number; periodo_ini: string | null; periodo_fim: string | null; user_nome: string | null; created_at: string; apelido: string | null }[]>`
    SELECT i.id, i.tipo, i.arquivo, i.linhas, i.novas, i.repetidas, i.travadas, i.periodo_ini::text, i.periodo_fim::text, i.user_nome, i.created_at::text, a.apelido FROM recon_imports i LEFT JOIN bank_accounts a ON a.id=i.bank_account_id ORDER BY i.id DESC LIMIT 15`;
  const formConta = (c?: typeof contas[number]) => <form action={salvarConta} className="space-y-2">{c && <input type="hidden" name="id" value={c.id} />}<input type="hidden" name="voltar" value={voltar} />
    <Field label="Apelido"><Input name="apelido" required defaultValue={c?.apelido} placeholder="Ex.: Banco X — movimento Carandá" /></Field>
    <div className="grid grid-cols-3 gap-2"><Field label="Banco"><Input name="banco" defaultValue={c?.banco ?? ""} /></Field><Field label="Agência"><Input name="agencia" defaultValue={c?.agencia ?? ""} /></Field><Field label="Conta"><Input name="conta" placeholder={c?.conta ? `${mascaraConta(c.conta)} (em branco mantém)` : ""} /></Field></div>
    <div className="grid grid-cols-2 gap-2"><Field label="Unidade"><Select name="unitId" defaultValue={c?.unit_id ?? ""}><option value="">— conta da entidade —</option>{ctx.units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>
      <Field label="Entidade"><Select name="companyId" defaultValue={c?.company_id ?? ""}><option value="">—</option>{ctx.entidades.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</Select></Field></div>
    <div className="grid grid-cols-2 gap-2"><Field label="Tipo"><Select name="tipo" defaultValue={c?.tipo ?? "CORRENTE"}><option value="CORRENTE">Conta corrente</option><option value="PAGAMENTO">Conta de pagamento</option><option value="INVESTIMENTO">Investimento</option></Select></Field>
      <Field label="Situação"><Select name="ativo" defaultValue={c ? (c.ativo ? "1" : "0") : "1"}><option value="1">Ativa</option><option value="0">Inativa</option></Select></Field></div>
    <Btn small>Salvar conta</Btn></form>;
  return (
    <Page title="Conciliação" sub={sub}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <BarraContexto ctx={ctx} voltar="/financeiro/conciliacao?aba=contas" />
      {tabs}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="space-y-4">
          <Card title={`Contas bancárias (${contas.length})`} actions={opera ? <Modal label="Nova conta" title="Nova conta bancária" kind="primary">{formConta()}</Modal> : undefined}>
            <Table head={["Conta", "Banco · agência · conta", "Unidade / entidade", "Extrato até", ""]} empty="Nenhuma conta cadastrada. Cadastre as contas de movimento das quatro unidades.">
              {contas.map(c => <tr key={c.id}><Td><div className="font-medium">{c.apelido}</div><div className="text-[11px] text-slate-500">{c.tipo === "CORRENTE" ? "Conta corrente" : c.tipo === "PAGAMENTO" ? "Conta de pagamento" : "Investimento"}{c.ativo ? "" : " · inativa"}</div></Td>
                <Td className="text-xs">{c.banco ?? "—"} · ag. {c.agencia ?? "—"} · c/c {mascaraConta(c.conta)}</Td><Td className="text-xs">{c.unidade ?? "—"}<div className="text-[11px] text-slate-500">{c.entidade ?? ""}</div></Td>
                <Td className="text-xs">{c.ultima ? fmtData(c.ultima) : <span className="text-aviso">sem extrato</span>}<div className="text-[11px] text-slate-500">{c.linhas} lançamento(s)</div></Td>
                <Td>{opera && <Modal label="Editar" title={`Editar ${c.apelido}`}>{formConta(c)}</Modal>}</Td></tr>)}
            </Table>
          </Card>
          <Card title="Últimas importações">
            <Table head={["Quando", "Tipo", "Conta / arquivo", "Período", "Linhas", "Por"]} empty="Nenhuma importação ainda.">
              {imports.map(i => <tr key={i.id}><Td className="whitespace-nowrap text-xs">{fmtDataHora(i.created_at)}</Td><Td className="text-xs">{i.tipo === "CIELO" ? "Relatório Cielo" : `Extrato ${i.tipo}`}</Td><Td className="text-xs">{i.apelido ?? "—"}<div className="text-[11px] text-slate-500">{i.arquivo}</div></Td>
                <Td className="whitespace-nowrap text-xs">{fmtData(i.periodo_ini)} a {fmtData(i.periodo_fim)}</Td><Td className="text-xs tabular-nums">{i.novas} nova(s) · {i.repetidas} repetida(s){i.travadas ? ` · ${i.travadas} travada(s)` : ""}</Td><Td className="text-xs">{i.user_nome}</Td></tr>)}
            </Table>
          </Card>
        </div>
        {opera && <div className="space-y-4">
          <Card title="Importar extrato (OFX ou CSV)"><form action={importarExtrato} className="space-y-2"><input type="hidden" name="voltar" value={voltar} />
            <Field label="Conta"><Select name="contaId" required defaultValue=""><option value="">Escolha a conta</option>{contas.filter(c => c.ativo).map(c => <option key={c.id} value={c.id}>{c.apelido}</option>)}</Select></Field>
            <Field label="Arquivo do banco (.ofx, .csv, .xlsx)"><input type="file" name="arquivo" accept=".ofx,.qfx,.csv,.txt,.xlsx,.xls" className="block w-full rounded-md border border-line bg-white px-2 py-1.5 text-xs file:mr-2 file:rounded file:border-0 file:bg-acao file:px-2 file:py-1 file:text-xs file:text-white" /></Field>
            <Field label="Ou cole o CSV: data;descricao;valor;documento;pagador" hint="valor negativo = débito; ou colunas credito e debito"><Textarea name="csv" className="min-h-[70px] font-mono text-xs" placeholder={"data;descricao;valor;documento;pagador\n05/10/2026;PIX RECEBIDO;1380,00;E1234;MARIA DA SILVA"} /></Field>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="lancarCaixa" value="1" defaultChecked /> Lançar também no fluxo de caixa (categoria sugerida, reclassificável)</label>
            <Field label="Unidade do fluxo de caixa (só para conta sem unidade)"><Select name="unitCaixa" defaultValue=""><option value="">—</option>{ctx.units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>
            <Btn small pendingText="Importando e conciliando…">Importar e conciliar</Btn>
            <p className="text-[11px] text-slate-500">Reimportar o mesmo extrato não duplica (identificador do banco ou data+valor+histórico). Datas de competência fechada não entram.</p></form></Card>
          <Card title="Importar relatório da Cielo"><form action={importarCielo} className="space-y-2"><input type="hidden" name="voltar" value={voltar} />
            <Field label="Unidade padrão (se o relatório não tiver a coluna unidade)"><Select name="unitId" defaultValue=""><option value="">—</option>{ctx.units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>
            <Field label="Arquivo (.csv, .xlsx)"><input type="file" name="arquivo" accept=".csv,.txt,.xlsx,.xls" className="block w-full rounded-md border border-line bg-white px-2 py-1.5 text-xs file:mr-2 file:rounded file:border-0 file:bg-acao file:px-2 file:py-1 file:text-xs file:text-white" /></Field>
            <Field label="Ou cole: data_venda;data_pagamento;bandeira;produto;parcelas;parcela;nsu;autorizacao;valor_bruto;taxa;valor_liquido;antecipacao;unidade"><Textarea name="csv" className="min-h-[70px] font-mono text-xs" /></Field>
            <Btn small pendingText="Importando e conciliando…">Importar e conciliar</Btn></form></Card>
          <Card title="Refazer a conciliação"><form action={reprocessar} className="flex flex-wrap items-end gap-2"><input type="hidden" name="voltar" value={voltar} /><Field label="Competência" className="w-44"><Input type="month" name="competencia" defaultValue={ctx.periodo} /></Field><Btn small kind="ghost" pendingText="Conciliando…">Conciliar de novo</Btn></form>
            <p className="mt-2 text-[11px] text-slate-500">Refaz só as sugestões: pares confirmados, classificações e pendências tratadas por pessoas ficam como estão. A rotina diária concilia o mês corrente e o anterior.</p></Card>
        </div>}
      </div>
    </Page>
  );
}
