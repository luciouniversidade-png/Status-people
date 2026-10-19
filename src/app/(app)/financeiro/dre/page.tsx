import Link from "@/components/Link";
import { requireFinanceiro } from "@/lib/auth";
import { Page, Card, Flash, Field, Select, Textarea, Btn, Badge } from "@/components/ui";
import { Minigrafico, COR } from "@/components/graficos";
import { BarraContexto, CarimboContexto } from "@/components/BarraContexto";
import { PrintButton } from "@/components/PrintButton";
import { lerContexto, qsContexto } from "@/lib/contexto";
import { dadosDre, type DimDre, type VisaoDre } from "@/lib/dre";
import { LINHAS_DRE, valorModo, tomDelta, FOLHA_REAL, type Modo, type CodigoLinha } from "@/lib/dre-calc";
import { fmtReais, fmtPct, rotuloMes, MESES_CURTOS } from "@/lib/formato";
import { sql } from "@/db";
import { fmtData, fmtDataHora, hoje } from "@/lib/utils";
import { mesParcial } from "@/lib/cockpit";
import { comentarDre } from "./actions";

export const dynamic = "force-dynamic";
const MODOS: [Modo, string][] = [["real", "Realizado"], ["orcado", "Orçado"], ["delta", "Δ real − orçado"], ["ah", "AH % (vs ano anterior)"], ["av", "AV % (da receita líquida)"]];

/** T-024 · DRE gerencial multidimensional: linhas canônicas × unidade/entidade/mês × modos, com eliminação de internos e drill ao lançamento. */
export default async function Dre({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireFinanceiro(); const sp = await searchParams; const ctx = await lerContexto(s, sp);
  const dim: DimDre = sp.dim === "entidade" || sp.dim === "mes" ? sp.dim : "unidade"; const visao: VisaoDre = sp.visao === "acumulado" ? "acumulado" : "mes";
  const modo: Modo = (MODOS.find(([m]) => m === sp.modo)?.[0] ?? "real"); const comContas = sp.contas !== "0";
  const { dre, cols, ano, mesRef, dadosAte, temOrcamento, temFolhaReal, meses } = await dadosDre(ctx, dim, visao);
  const parcialAte = mesParcial(ctx.periodo, hoje(), dadosAte)?.ate ?? null; // mês em andamento: o realizado é parcial
  const qs = (extra: Record<string, string>) => { const p = new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(qsContexto(ctx))), dim, visao, modo, contas: comContas ? "1" : "0", ...extra }); return p.toString(); };
  const fmt = (v: number | null) => v === null ? "—" : modo === "ah" || modo === "av" ? fmtPct(v) : fmtReais(v);
  const m1 = (c: typeof cols[number]) => Math.min(...c.meses), m2 = (c: typeof cols[number]) => Math.max(...c.meses);
  const drill = (c: typeof cols[number], linha: CodigoLinha, categoria: string | null) => categoria === null && linha === "PESSOAL" ? `/folha/custo?ctx_p=${ano}-${String(m2(c)).padStart(2, "0")}` : `/financeiro/lancamentos?${new URLSearchParams({ ano: String(ano), m1: String(m1(c)), m2: String(m2(c)), u: c.units.join(","), linha, ...(categoria ? { cat: categoria } : {}) })}`;
  const recLiq = (c: typeof cols[number]) => dre.linha("LIQUIDA", c.chave).real;
  const comentarios = await sql<{ id: number; categoria: string; texto: string; user_nome: string | null; created_at: string; unidade: string | null }[]>`SELECT b.id, b.categoria, b.texto, b.user_nome, b.created_at::text, u.nome AS unidade FROM budget_comments b LEFT JOIN units u ON u.id=b.unit_id WHERE b.tipo='DRE' AND b.ano=${ano} AND b.mes=${mesRef} ORDER BY b.id DESC LIMIT 40`;
  const nomePeriodo = dim === "mes" || visao === "acumulado" ? `jan–${MESES_CURTOS[mesRef - 1]}/${String(ano).slice(2)}` : rotuloMes(ctx.periodo);
  const pessoalFontes = new Set(cols.map(c => dre.linha("PESSOAL", c.chave).fonte).filter(Boolean));
  return (
    <Page title="DRE gerencial" sub="Demonstração em linhas canônicas × unidade, entidade (com Consolidado) ou mês, nos modos realizado, orçado, Δ, AH e AV. Clique em qualquer valor para ver os lançamentos."
      actions={<><a className="inline-flex items-center rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-navy hover:bg-mist" href={`/api/financeiro/dre?${qs({})}`}>Exportar CSV</a><PrintButton /></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <BarraContexto ctx={ctx} voltar={`/financeiro/dre?dim=${dim}&visao=${visao}&modo=${modo}`} />
      <CarimboContexto ctx={ctx} extra={`${MODOS.find(([m]) => m === modo)![1]} · ${nomePeriodo}`} />
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm print:hidden">
        <span className="flex flex-wrap gap-1">{(["unidade", "entidade", "mes"] as DimDre[]).map(d => <Link key={d} href={`/financeiro/dre?${qs({ dim: d })}`} className={`rounded-full border px-3 py-1 text-xs ${d === dim ? "border-navy bg-navy text-white" : "border-line bg-white text-navy"}`}>{d === "mes" ? "Por mês" : d === "entidade" ? "Por entidade" : "Por unidade"}</Link>)}</span>
        {dim !== "mes" && <span className="flex gap-1">{(["mes", "acumulado"] as VisaoDre[]).map(v => <Link key={v} href={`/financeiro/dre?${qs({ visao: v })}`} className={`rounded-full border px-3 py-1 text-xs ${v === visao ? "border-acao bg-acao text-white" : "border-line bg-white text-acao"}`}>{v === "mes" ? `Mês (${rotuloMes(ctx.periodo)})` : `Acumulado ${ano}`}</Link>)}</span>}
        <span className="flex flex-wrap gap-1">{MODOS.map(([m, r]) => <Link key={m} href={`/financeiro/dre?${qs({ modo: m })}`} className={`rounded-full border px-3 py-1 text-xs ${m === modo ? "border-ok bg-ok text-white" : "border-line bg-white text-slate-700"}`}>{r}</Link>)}</span>
        <Link href={`/financeiro/dre?${qs({ contas: comContas ? "0" : "1" })}`} className="text-xs text-acao">{comContas ? "Recolher contas" : "Abrir contas"}</Link>
      </div>
      <div className="mb-3 flex flex-wrap gap-2 text-[11px]">
        <Badge v="ABERTO" label={`Regime de caixa gerencial · dados até ${dadosAte ? fmtData(dadosAte) : "—"}`} />
        <Badge v={temFolhaReal ? "APROVADA" : "PENDENTE"} label={temFolhaReal ? `Pessoal: folha aceita (REAL)${pessoalFontes.has("caixa") || pessoalFontes.has("misto") ? " + caixa onde ainda não há resultado" : ""}` : "Pessoal: saídas de caixa (sem folha aceita no período)"} />
        {!temOrcamento && (modo === "orcado" || modo === "delta") && <Badge v="PENDENTE" label="Sem orçamento cadastrado no ano" />}
        <Badge v="ABERTO" label="Transferências internas eliminadas das linhas" />
        {parcialAte && <Badge v="PENDENTE" label={`${rotuloMes(ctx.periodo)} em andamento: realizado até ${fmtData(parcialAte)} — orçado, Δ e AH comparam com o mês cheio (a régua proporcional está no Cockpit do CFO)`} />}
      </div>
      <div className="overflow-x-auto rounded-md border border-line bg-white [-webkit-overflow-scrolling:touch]">
        <table className="w-full text-left text-xs sm:text-sm">
          <thead className="bg-mist text-xs text-slate-600"><tr><th className="sticky left-0 z-[1] min-w-[13rem] bg-mist px-3 py-2 font-medium">Linha · {nomePeriodo}</th>{cols.map(c => <th key={c.chave} className={`whitespace-nowrap px-3 py-2 text-right font-medium ${c.consolidado ? "bg-slate-200/60 text-navy" : ""}`}>{c.rotulo}</th>)}<th className="px-3 py-2 text-right font-medium">Tendência {ano}</th></tr></thead>
          <tbody className="divide-y divide-line">
            {LINHAS_DRE.map(l => {
              const contas = dre.contas.filter(c => c.linha === l.codigo);
              return [
                <tr key={l.codigo} className={l.total ? "bg-mist/60 font-semibold text-navy" : "font-medium"}>
                  <th scope="row" className={`sticky left-0 z-[1] px-3 py-2 text-left ${l.total ? "bg-mist" : "bg-white"}`}>{l.nome}</th>
                  {cols.map(c => { const cel = dre.linha(l.codigo, c.chave); const v = valorModo(cel, modo, recLiq(c)); const tom = modo === "delta" ? tomDelta(l.codigo, v) : null; const inner = <span className={`tabular-nums ${tom === "bom" ? "text-ok" : tom === "ruim" ? "text-erro" : ""}`}>{fmt(v)}{l.codigo === "PESSOAL" && cel.fonte && cel.real !== null && <sup className="ml-0.5 text-[9px] text-slate-500">{cel.fonte === "REAL" ? "REAL" : cel.fonte === "misto" ? "misto" : "caixa"}</sup>}</span>;
                    return <td key={c.chave} className={`whitespace-nowrap px-3 py-2 text-right ${c.consolidado ? "bg-slate-100/60" : ""}`}>{!l.total && v !== null && modo !== "orcado" ? <Link href={drill(c, l.codigo, null)} className="hover:underline">{inner}</Link> : inner}</td>; })}
                  <td className="px-3 py-1 text-right"><Minigrafico valores={dre.serieLinha(l.codigo).slice(0, mesRef)} cor={l.total ? COR.navy : COR.acao} largura={88} altura={24} rotulo={`${l.nome}: realizado mês a mês`} /></td>
                </tr>,
                ...(comContas && !l.total ? contas.map(k => (
                  <tr key={k.chave} className="text-slate-700">
                    <th scope="row" className="sticky left-0 z-[1] bg-white py-1.5 pl-7 pr-3 text-left text-xs font-normal">{k.nome}{k.chave === FOLHA_REAL && <Badge v="APROVADA" label="REAL" />}</th>
                    {cols.map(c => { const cel = dre.celula(k.chave, c.chave); const v = valorModo(cel, modo, recLiq(c)); const tom = modo === "delta" ? tomDelta(l.codigo, v) : null; const inner = <span className={`tabular-nums ${tom === "bom" ? "text-ok" : tom === "ruim" ? "text-erro" : ""}`}>{fmt(v)}</span>;
                      return <td key={c.chave} className={`whitespace-nowrap px-3 py-1.5 text-right text-xs ${c.consolidado ? "bg-slate-50" : ""}`}>{v !== null && modo !== "orcado" ? <Link href={drill(c, l.codigo, k.categoria)} className="hover:underline">{inner}</Link> : inner}</td>; })}
                    <td className="px-3 py-1 text-right"><Minigrafico valores={dre.serieConta(k.chave).slice(0, mesRef)} largura={72} altura={20} /></td>
                  </tr>)) : []),
              ];
            })}
            <tr className="text-xs text-slate-500"><th scope="row" className="sticky left-0 z-[1] bg-white px-3 py-2 text-left font-normal">Movimentos internos (fora das linhas; eliminados no Consolidado)</th>{cols.map(c => { const x = dre.internas.get(c.chave); const tem = !!x && !!(x.entradas || x.saidas || x.transferencias); const partes = tem ? [x!.entradas ? `+${fmtReais(x!.entradas)}` : null, x!.saidas ? `−${fmtReais(x!.saidas)}` : null, x!.transferencias ? `⇄ ${fmtReais(x!.transferencias)}` : null].filter(Boolean).join(" ") : ""; return <td key={c.chave} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{tem ? <>{partes}{c.consolidado && <div className="text-[10px]">saldo {fmtReais(x!.entradas - x!.saidas)} · eliminado</div>}</> : "—"}</td>; })}<td /></tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">Mapeamento das categorias em Configurações (dre): tributos e taxas abatem a receita; pessoal e encargos viram “Custo de pessoal” — substituídos pelo resultado aceito da folha no mês/unidade em que ele existir; financeiras ficam abaixo do EBITDA; transferências e categorias internas nunca entram nas linhas. AH compara com o mesmo recorte de {ano - 1}; AV divide pela receita líquida da coluna. {meses.length > 1 && dim !== "mes" ? `Acumulado de ${meses.length} meses.` : ""}</p>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={`Comentários do fechamento — ${rotuloMes(ctx.periodo)}`}>
          {comentarios.length === 0 ? <p className="text-sm text-slate-600">Nenhum comentário neste mês.</p> : <ul className="space-y-2 text-sm">{comentarios.map(c => <li key={c.id}><b className="text-navy">{LINHAS_DRE.find(l => l.codigo === c.categoria)?.nome ?? c.categoria}</b>{c.unidade ? ` · ${c.unidade}` : ""} — {c.texto}<div className="text-[11px] text-slate-500">{c.user_nome} · {fmtDataHora(c.created_at)}</div></li>)}</ul>}
        </Card>
        {["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE"].includes(s.role) && <Card title="Comentar uma linha">
          <form action={comentarDre} className="space-y-2"><input type="hidden" name="ano" value={ano} /><input type="hidden" name="mes" value={mesRef} /><input type="hidden" name="unitId" value={ctx.unitId ?? ""} /><input type="hidden" name="voltar" value={`/financeiro/dre?${qs({})}`} />
            <Field label="Linha"><Select name="linha">{LINHAS_DRE.map(l => <option key={l.codigo} value={l.codigo}>{l.nome}</option>)}</Select></Field>
            <Field label="Explicação do mês"><Textarea name="texto" required minLength={5} placeholder="ex.: reajuste do aluguel da Cultura antecipado para outubro" /></Field>
            <Btn small>Registrar comentário</Btn></form>
        </Card>}
      </div>
    </Page>
  );
}
