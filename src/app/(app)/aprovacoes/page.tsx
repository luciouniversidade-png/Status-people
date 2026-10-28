import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { requireSession, scopeUnit, can } from "@/lib/auth";
import { Page, Card, Flash, Stat, Btn, Textarea, Badge, Table, Td } from "@/components/ui";
import { BarrasH, COR } from "@/components/graficos";
import { filaFerias, filaBanco, rankingHe, type ItemFila } from "@/lib/aprovacoes";
import { aprovarLote, decidirExcecao } from "./actions";
import { fmtReais } from "@/lib/formato";
import { getSettings } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** C10 · Aprovações em lote com exceção à vista: férias e afastamentos, banco de horas e horas extras (T-049 · T-052 · T-054). */
export default async function Aprovacoes({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (["COLABORADOR", "LEITURA"].includes(s.role)) redirect("/"); const sp = await searchParams;
  const cfg = await getSettings(); const aba = sp.aba === "banco" ? "banco" : sp.aba === "he" ? "he" : "ferias";
  const [ferias, banco] = await Promise.all([filaFerias(s), filaBanco(s)]);
  if (!can.aprovar(s, "ferias") && !can.aprovar(s, "banco")) redirect("/solicitacoes");
  const verCusto = ["DIRECAO", "RH", "FINANCEIRO"].includes(s.role); const ranking = aba === "he" ? await rankingHe(scopeUnit(s), verCusto) : null;
  const fila: ItemFila[] = aba === "banco" ? banco : ferias; const normais = fila.filter(i => !i.excecoes.length); const excecoes = fila.filter(i => i.excecoes.length);
  const voltar = `/aprovacoes?aba=${aba}`;
  const Abas = () => <nav className="mb-4 flex flex-wrap gap-1 text-sm">{[["ferias", `Férias e afastamentos (${ferias.length})`], ["banco", `Banco de horas e HE (${banco.length})`], ["he", "Ranking de horas extras"]].map(([k, t]) => <Link key={k} href={`/aprovacoes?aba=${k}`} aria-current={k === aba ? "page" : undefined} className={`rounded-md border px-3 py-1.5 ${k === aba ? "border-navy bg-navy text-white" : "border-line bg-white text-navy"}`}>{t}</Link>)}</nav>;
  return (
    <Page title="Aprovações em lote" sub="Os pedidos normais saem num clique, com registro item a item; as exceções — limite de HE estourado, conflito de cobertura, saldo insuficiente, quem pediu aprovando o próprio pedido — ficam fora do lote e pedem decisão com justificativa.">
      <Flash ok={sp.ok} erro={sp.erro} />
      <Abas />
      {aba !== "he" && <>
        <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4"><Stat label="Na fila" value={fila.length} /><Stat label="Normais (podem ir no lote)" value={<span className="text-ok">{normais.length}</span>} /><Stat label="Exceções (decisão própria)" value={<span className={excecoes.length ? "text-erro" : ""}>{excecoes.length}</span>} /><Stat label={aba === "banco" ? "Limite mensal de HE" : "Cobertura mínima do cargo"} value={aba === "banco" ? `${Math.round(Number(cfg.aprovacoes.limiteHeMensalMin) / 60)} h` : `${cfg.aprovacoes.feriasMinimoPresentesPct}%`} hint="Configurações → aprovações" /></div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
          <Card title={`Normais (${normais.length})`}>
            {normais.length === 0 ? <p className="text-sm text-slate-600">Nada para aprovar em lote.</p> : <form action={aprovarLote} className="space-y-2"><input type="hidden" name="aba" value={aba} /><input type="hidden" name="voltar" value={voltar} />
              <ul className="divide-y divide-line">{normais.map(i => <li key={i.id} className="flex items-start gap-2 py-2 text-sm"><input type="checkbox" name="ids" value={i.id} defaultChecked className="mt-1" aria-label={`Incluir ${i.pessoa} no lote`} /><span className="min-w-0 flex-1"><b>{i.pessoa}</b> · {i.titulo}<span className="block text-xs text-slate-500">{i.unidade} · {i.detalhe}</span></span></li>)}</ul>
              <Btn>Aprovar os {normais.length} normais</Btn><p className="text-[11px] text-slate-500">O servidor confere de novo: se algum virar exceção no meio do caminho, ele fica fora do lote.</p></form>}
          </Card>
          <Card title={`Exceções (${excecoes.length})`}>
            {excecoes.length === 0 ? <p className="text-sm text-slate-600">Nenhuma exceção. ✓</p> : <ul className="space-y-3">{excecoes.map(i => <li key={i.id} className="rounded-md border border-red-200 bg-red-50/40 p-3 text-sm">
              <div><b>{i.pessoa}</b> · {i.titulo}</div><div className="text-xs text-slate-500">{i.unidade} · {i.detalhe}</div>
              <ul className="mt-1 space-y-0.5 text-xs text-erro">{i.excecoes.map((e, k) => <li key={k}>⛔ {e}</li>)}</ul>
              {!i.excecoes.some(e => e.startsWith("você ") || e.startsWith("mês fechado")) ? <form action={decidirExcecao} className="mt-2 space-y-2"><input type="hidden" name="aba" value={aba} /><input type="hidden" name="id" value={i.id} /><input type="hidden" name="voltar" value={voltar} /><Textarea name="justificativa" required minLength={10} placeholder="Justificativa consciente (fica na trilha)" className="min-h-[52px] text-xs" /><div className="flex gap-2"><Btn small name="decisao" value="APROVAR">Aprovar com justificativa</Btn><Btn small kind="ghost" danger name="decisao" value="DEVOLVER">Devolver</Btn></div></form> : <p className="mt-2 text-xs text-slate-600">{i.excecoes.some(e => e.startsWith("mês fechado")) ? <Link href="/ponto" className="text-acao">Reabrir o mês no ponto</Link> : "Outra pessoa da alçada decide."}</p>}
            </li>)}</ul>}
          </Card>
        </div>
      </>}
      {aba === "he" && ranking && <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
        <Card title="Quem mais acumula HE (3 meses)"><BarrasH rotulo="Horas extras aprovadas por pessoa" formato={v => `${Math.round(v / 60)} h`} itens={ranking.pessoas.map(p => ({ rotulo: p.nome, sub: `${p.cargo ?? "—"} · ${p.unidade}`, valor: p.m0 + p.m1 + p.m2, segmentos: [{ valor: p.m2, cor: "#c7d7ea", rotulo: "há 2 meses" }, { valor: p.m1, cor: "#7fa5cf", rotulo: "mês passado" }, { valor: p.m0, cor: COR.acao, rotulo: "este mês" }] }))} largRotulo="12rem" /><p className="mt-2 text-xs text-slate-500">Acúmulo constante é sinal de dimensionamento errado, não de mérito: abra a conversa de dimensionamento com a área.</p></Card>
        <Card title="Por cargo e unidade"><Table head={["Cargo", "Unidade", "Pessoas", "HE (3 meses)", ...(verCusto ? ["Custo estimado do mês"] : [])]} empty="Nenhuma hora extra aprovada nos últimos 3 meses.">{ranking.porCargo.map(c => <tr key={`${c.cargo}|${c.unidade}`}><Td>{c.cargo}</Td><Td>{c.unidade}</Td><Td>{c.pessoas}</Td><Td className="tabular-nums">{Math.round(c.minutos / 60)} h</Td>{verCusto && <Td className="tabular-nums">{fmtReais(c.custoMes)}</Td>}</tr>)}</Table>
          {verCusto && <p className="mt-2 text-xs text-slate-500">Custo estimado = salário ÷ 220 h × 1,5 por hora (sem reflexos). Total do mês: <b>{fmtReais(ranking.custoTotalMes)}</b>. Em banco de horas, a hora vira folga — o custo só existe se for paga.</p>}
          <p className="mt-1 text-xs"><Badge v="ABERTO" label="T-054" /> <Link href="/banco-de-horas" className="text-acao">Banco de horas →</Link></p></Card>
      </div>}
    </Page>
  );
}
