import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { requireSession, scopeUnit } from "@/lib/auth";
import { Page, Card, Flash, Stat, Table, Td, Field, Select, Input, Textarea, Btn, Badge } from "@/components/ui";
import { BarraContexto } from "@/components/BarraContexto";
import { Colunas, COR } from "@/components/graficos";
import { lerContexto } from "@/lib/contexto";
import { audit, getSettings, fmtData } from "@/lib/utils";
import { fmtCompacto } from "@/lib/formato";
import { vePlano, editaPlano, aprovaRateio } from "@/lib/plano-contas";
import { resultadoComRateio } from "@/lib/rateio";
import { ROTULO_BASE, BASES } from "@/lib/rateio-calc";
import { criarRegraRateio, decidirRegraRateio } from "./actions";

export const dynamic = "force-dynamic";
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brl0 = (v: number | null | undefined) => (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pct = (v: number | null) => v === null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const STATUS: Record<string, [string, string]> = { RASCUNHO: ["PENDENTE", "Aguardando a Direção"], APROVADA: ["ATIVO", "Aprovada"], REJEITADA: ["REJEITADO", "Rejeitada"] };

/** v28 · Resultado por unidade antes e depois do rateio do corporativo, custos diretos × indiretos e custo por aluno (catálogo de custos). */
export default async function Rateio({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams;
  if (!vePlano(s)) { await audit(s, "acesso negado: rateio", "allocation_rules", null, null, { papel: s.role }); redirect("/financeiro"); }
  const cfg = await getSettings(); const ctx = await lerContexto(s, sp); const visao = sp.visao === "mes" ? "mes" : "acumulado";
  const r = await resultadoComRateio(ctx.periodo, visao); const escopo = scopeUnit(s);
  const linhas = r.linhas.filter(l => (escopo === null || l.unitId === escopo) && (ctx.unitIds === null || ctx.unitIds.includes(l.unitId)));
  const propoe = editaPlano(cfg, s); const aprova = aprovaRateio(s);
  const mesRef = `${ctx.periodo.slice(5, 7)}/${ctx.periodo.slice(0, 4)}`; const periodoTxt = visao === "mes" ? mesRef : `jan a ${mesRef}`;
  return (
    <Page title="Resultado por unidade com rateio" sub={`Receita e custos de cada unidade — diretos, indiretos e o corporativo rateado pela regra aprovada · ${periodoTxt} · regime de caixa (transferências, principal de dívida e adiantamentos fora). ${ctx.carimbo}.`}
      actions={<><Btn kind="ghost" href="/financeiro/plano-de-contas">Plano de contas</Btn><Btn kind="ghost" href="/financeiro/dre">DRE gerencial</Btn><Btn kind="ghost" href={`/api/export/resultado-rateio?periodo=${ctx.periodo}&visao=${visao}`}>Exportar</Btn></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <BarraContexto ctx={ctx} voltar={`/financeiro/rateio?visao=${visao}`} notaPeriodo="mês de referência (ou acumulado no ano até ele)" />
      <nav className="mb-3 flex gap-4 text-sm"><Link href="/financeiro/rateio?visao=acumulado" className={visao === "acumulado" ? "font-semibold text-navy underline underline-offset-4" : "text-acao"}>Acumulado no ano</Link><Link href="/financeiro/rateio?visao=mes" className={visao === "mes" ? "font-semibold text-navy underline underline-offset-4" : "text-acao"}>Só o mês</Link></nav>
      {r.provisoria && <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-aviso">Sem regra de rateio aprovada até {mesRef}: o corporativo está sendo rateado provisoriamente por <b>alunos atuais</b>. Proponha a regra abaixo para a Direção aprovar.</div>}
      {r.semConta.n > 0 && <div className="mb-4 rounded-md border border-line bg-mist px-4 py-2 text-xs text-slate-600">{r.semConta.n} saída(s) sem conta do plano no período ({brl(r.semConta.v)}) aparecem como “não classificado” — <Link className="text-acao underline" href={`/financeiro/plano-de-contas?aba=classificacao&de=${r.ini}`}>classificar</Link> separa custo direto de indireto.</div>}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Stat label="Receita" value={brl(r.rede.receita)} hint={periodoTxt} />
        <Stat label="Custos das unidades" value={brl(r.rede.diretos + r.rede.indiretos + r.rede.naoClassificados)} hint={`diretos ${brl(r.rede.diretos)} · indiretos ${brl(r.rede.indiretos)}`} />
        <Stat label="Corporativo rateado" value={brl(r.corporativo)} hint={`base: ${ROTULO_BASE[r.base]}${r.regra ? "" : " (provisória)"}`} />
        <Stat label="Resultado da rede" value={<span className={r.rede.depois < 0 ? "text-erro" : "text-ok"}>{brl(r.rede.depois)}</span>} hint={`margem ${pct(r.rede.margem)}`} />
        <Stat label="Custo por aluno ao mês" value={r.rede.custoAlunoMes === null ? "—" : brl(r.rede.custoAlunoMes)} hint={`${r.rede.alunos.toLocaleString("pt-BR")} alunos atuais · ${r.meses} mês(es)`} />
      </div>
      <Card title={`Resultado por unidade — antes e depois do rateio (${periodoTxt})`} className="mb-4">
        <Table denso head={["Unidade", "Receita", { label: "Custos da unidade", className: "hidden md:table-cell" }, "Antes do rateio", "Rateio", "Depois", { label: "Custo/aluno/mês", className: "hidden sm:table-cell" }]}>
          {linhas.map(l => <tr key={l.unitId}><Td className="min-w-[8.5rem] font-medium"><span className="whitespace-nowrap">{l.nome}</span><div className="whitespace-nowrap text-[11px] text-slate-500">{l.alunos.toLocaleString("pt-BR")} alunos · margem {pct(l.margem)}</div></Td>
            <Td className="whitespace-nowrap tabular-nums">{brl0(l.receita)}</Td>
            <Td className="hidden whitespace-nowrap tabular-nums md:table-cell">{brl0(l.diretos + l.indiretos + l.naoClassificados)}<div className="text-[11px] text-slate-500">diretos {brl0(l.diretos)} · indiretos {brl0(l.indiretos)}</div>{l.naoClassificados ? <div className="text-[11px] text-aviso">sem conta {brl0(l.naoClassificados)}</div> : null}</Td>
            <Td className={`whitespace-nowrap tabular-nums ${l.antes < 0 ? "text-erro" : ""}`}>{brl0(l.antes)}</Td><Td className="whitespace-nowrap tabular-nums">−{brl0(l.rateio)}<div className="text-[11px] text-slate-500">{pct(100 * l.pctRateio)} da base</div></Td>
            <Td className={`whitespace-nowrap font-semibold tabular-nums ${l.depois < 0 ? "text-erro" : "text-ok"}`}>{brl0(l.depois)}</Td>
            <Td className="hidden min-w-[8.5rem] text-xs tabular-nums sm:table-cell"><span className="whitespace-nowrap">{l.custoAluno.total === null ? "—" : brl(l.custoAluno.total)}</span>{l.custoAluno.total !== null && <div className="text-[11px] text-slate-500"><span className="whitespace-nowrap">dir. {brl(l.custoAluno.direto)}</span> · <span className="whitespace-nowrap">ind. {brl(l.custoAluno.indireto)}</span> · <span className="whitespace-nowrap">rat. {brl(l.custoAluno.rateio)}</span></div>}</Td></tr>)}
        </Table>
        <div className="mt-4"><Colunas rotulo="Resultado antes e depois do rateio" categorias={linhas.map(l => l.nome)} series={[{ nome: "Antes do rateio", valores: linhas.map(l => l.antes), cor: COR.neutro }, { nome: "Depois do rateio", valores: linhas.map(l => l.depois), cor: COR.acao }]} formato={v => fmtCompacto(v)} formatoDica={v => brl(v)} tamanho="inteiro" /></div>
        <p className="mt-2 text-[11px] text-slate-500">Diretos: contas de custo da turma/segmento (professores, material didático, plataformas). Indiretos: o que a unidade compartilha (ocupação, apoio, administrativo local). Sem centro de custo, o gasto fica na unidade que pagou; centro de outra unidade leva o gasto para a beneficiária; o centro corporativo vai para o rateio. Custo por aluno = custos ÷ alunos atuais ÷ meses do período.</p>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" id="regras">
        <Card title="Memória do rateio">
          <dl className="mb-2 space-y-1 text-sm"><div><dt className="text-xs text-slate-500">Regra vigente em {mesRef}</dt><dd>{r.regra ? <>{r.regra.nome} · desde {r.regra.desde.split("-").reverse().join("/")} · aprovada por {r.regra.aprovado_por ?? "—"}{r.regra.aprovado_em ? ` em ${fmtData(r.regra.aprovado_em.slice(0, 10))}` : ""}</> : <span className="text-aviso">nenhuma aprovada — provisória por alunos atuais</span>}</dd></div>
            <div><dt className="text-xs text-slate-500">Corporativo a ratear no período</dt><dd>{brl(r.corporativo)} <span className="text-xs text-slate-500">(centro CORP, todas as unidades pagadoras)</span></dd></div></dl>
          <Table denso head={["Unidade", `Base (${ROTULO_BASE[r.base].toLowerCase()})`, "Participação", "Rateado"]}>
            {r.linhas.filter(l => escopo === null || l.unitId === escopo).map(l => <tr key={l.unitId}><Td className="whitespace-nowrap">{l.nome}</Td><Td className="tabular-nums">{r.base === "RECEITA" ? brl(r.valores.get(l.unitId) ?? 0) : r.base === "PERCENTUAL" ? `${(r.valores.get(l.unitId) ?? 0).toLocaleString("pt-BR")}%` : (r.valores.get(l.unitId) ?? 0).toLocaleString("pt-BR")}</Td><Td className="tabular-nums">{pct(100 * l.pctRateio)}</Td><Td className="tabular-nums">{brl(l.rateio)}</Td></tr>)}
          </Table>
          <p className="mt-2 text-[11px] text-slate-500">A regra vale a partir do mês “desde” até outra ser aprovada. Arredondamento: os centavos ficam na maior participação, para a soma rateada fechar com o corporativo.</p>
        </Card>
        <Card title={`Regras de rateio (${r.regras.length})`}>
          {r.regras.length === 0 ? <p className="text-sm text-slate-500">Nenhuma regra ainda.</p> : <ul className="mb-3 divide-y divide-line text-sm">{r.regras.map(x => <li key={x.id} className="py-2"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{x.nome}</span><Badge v={STATUS[x.status]?.[0] ?? x.status} label={STATUS[x.status]?.[1] ?? x.status} /></div>
            <div className="text-[11px] text-slate-500">{ROTULO_BASE[x.base]} · desde {x.desde.split("-").reverse().join("/")} · proposta por {x.criado_por ?? "—"} em {fmtData(x.created_at.slice(0, 10))}{x.aprovado_por ? ` · ${x.status === "APROVADA" ? "aprovada" : "decidida"} por ${x.aprovado_por}` : ""}</div>
            {x.motivo && <p className="text-xs text-slate-600">{x.motivo}</p>}{x.decisao_motivo && <p className="text-xs text-slate-500">Decisão: {x.decisao_motivo}</p>}
            {x.status === "RASCUNHO" && aprova && <form action={decidirRegraRateio} className="mt-1 flex flex-wrap items-end gap-2"><input type="hidden" name="id" value={x.id} /><Field label="Motivo (obrigatório para rejeitar)" className="min-w-[12rem] flex-1"><Input name="motivo" maxLength={300} /></Field><Btn small name="decisao" value="APROVAR">Aprovar</Btn><Btn small kind="ghost" name="decisao" value="REJEITAR">Rejeitar</Btn></form>}</li>)}</ul>}
          {propoe && <details className="rounded-md border border-line p-2" open={r.regras.length === 0}><summary className="cursor-pointer text-sm font-medium text-navy">Propor nova regra</summary>
            <form action={criarRegraRateio} className="mt-2 space-y-2">
              <div className="grid grid-cols-2 gap-2"><Field label="Nome" className="col-span-2"><Input name="nome" required placeholder="Ex.: Corporativo por alunos 2026" maxLength={120} /></Field>
                <Field label="Base"><Select name="base" defaultValue="ALUNOS">{BASES.map(b => <option key={b} value={b}>{ROTULO_BASE[b]}</option>)}</Select></Field><Field label="Vale desde (mês)"><Input name="desde" type="month" defaultValue={`${ctx.periodo.slice(0, 4)}-01`} required /></Field></div>
              <fieldset className="rounded border border-line p-2"><legend className="px-1 text-xs text-slate-600">Só para percentual fixo (soma 100%)</legend><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{r.unidades.map(u => <Field key={u.id} label={u.nome}><Input name={`pct_${u.id}`} inputMode="decimal" placeholder="0" /></Field>)}</div></fieldset>
              <Field label="Critério e motivo" hint="Por que esta base representa o consumo do corporativo."><Textarea name="motivo" required minLength={10} className="min-h-[60px]" /></Field>
              <Btn small>Enviar para a Direção</Btn></form></details>}
        </Card>
      </div>
    </Page>
  );
}
