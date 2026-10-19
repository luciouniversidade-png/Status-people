import Link from "@/components/Link";
import { requireMatriculas, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Field, Select, Btn } from "@/components/ui";
import { KpiCard, Medidor, Bala, Linhas, BarrasH, COR } from "@/components/graficos";
import { metasMatricula, ritmoCampanha, segundaDe } from "@/lib/metas-matricula";
import { fmtData, addDays } from "@/lib/utils";
import { fmtPct, fmtNumero } from "@/lib/formato";

export const dynamic = "force-dynamic";

const MEDALHA = ["🥇", "🥈", "🥉"];
const r0 = (x: number | null | undefined) => x === null || x === undefined ? "—" : fmtNumero(Math.round(x));

/** Metas e previsão da campanha: matrícula e rematrícula contra a meta, por unidade e carteira, com o ritmo semanal e a projeção até o fim. */
export default async function Metas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireMatriculas(); const sp = await searchParams; const escopo = scopeUnit(s);
  const units = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`;
  const unitId = escopo ?? (units.some(u => u.id === Number(sp.unidade)) ? Number(sp.unidade) : null);
  const M = await metasMatricula(unitId); const R = M.rede;
  const ritmo = await ritmoCampanha(unitId, R.vagas || null);
  const ocup = R.vagas ? (100 * (R.confirmadas + R.reservas)) / R.vagas : null; const metaOcPct = R.metaMatriculas !== null && R.vagas ? (100 * R.metaMatriculas) / R.vagas : null;
  const remPct = R.remBase ? (100 * R.remFeitas) / R.remBase : null;
  const nomeU = unitId ? units.find(u => u.id === unitId)?.nome ?? "Unidade" : "Rede";
  // séries do ritmo + projeção
  type Grafico = { cats: string[]; real: (number | null)[]; proj: (number | null)[]; min: (number | null)[]; max: (number | null)[] };
  let graficoMat: Grafico | null = null;
  let graficoRem: Grafico | null = null;
  if (ritmo && ritmo.semanas.length) {
    const hist = ritmo.semanas; const fut = Array.from({ length: ritmo.restantes }, (_, i) => addDays(segundaDe(M.hoje), 7 * (i + 1)));
    const cats = [...hist.map(w => w.semana), ...fut].map(d => fmtData(d).slice(0, 5));
    const monta = (vals: number[], p: typeof ritmo.projMat, f = (x: number) => x) => {
      const n = vals.length; const last = vals[n - 1];
      return { cats, real: [...vals.map(f), ...fut.map(() => null)], proj: p ? [...vals.map((_, i) => i === n - 1 ? f(last) : null), ...p.proj.map(x => f(x.provavel))] : [], min: p ? [...vals.map((_, i) => i === n - 1 ? f(last) : null), ...p.proj.map(x => f(x.min))] : [], max: p ? [...vals.map((_, i) => i === n - 1 ? f(last) : null), ...p.proj.map(x => f(x.max))] : [] };
    };
    graficoMat = monta(hist.map(w => w.ativas), ritmo.projMat);
    graficoRem = ritmo.baseRem ? monta(hist.map(w => w.rem), ritmo.projRem, x => (100 * x) / ritmo.baseRem) : null;
  }
  const leitura: string[] = [];
  if (ritmo?.projMat && R.metaMatriculas) { const f = ritmo.projMat.final; leitura.push(`No ritmo das últimas semanas (${fmtNumero(ritmo.projMat.media, 1)} matrícula(s) por semana), a campanha termina em ${fmtData(ritmo.fim)} com cerca de ${r0(f.provavel)} matrículas (${Math.round(f.min) === Math.round(f.max) ? "limitada às vagas" : `faixa ${r0(f.min)}–${r0(f.max)}`}): ${fmtPct((100 * f.provavel) / R.metaMatriculas, 0)} da meta de ${r0(R.metaMatriculas)}.`); }
  else if (ritmo && !ritmo.projMat) leitura.push("Ainda não há semanas suficientes de campanha para projetar (mínimo de 4).");
  if (ritmo?.projRem && ritmo.baseRem && R.metaRematriculaPct !== null) { const f = (100 * ritmo.projRem.final.provavel) / ritmo.baseRem; leitura.push(`Rematrícula: no ritmo atual chega a ${fmtPct(f, 0)} dos alunos (meta ${fmtPct(R.metaRematriculaPct, 0)}) — ${f >= R.metaRematriculaPct ? "dentro da meta" : `faltariam cerca de ${r0(((R.metaRematriculaPct - f) / 100) * ritmo.baseRem)} famílias`}.`); }
  if (R.remPend) leitura.push(`${R.remPend} família(s) com rematrícula em andamento (link sem resposta ou aberto sem concluir) — o maior potencial imediato.`);
  return (
    <Page title={`Metas e previsão da campanha ${M.ano}`} sub={`${nomeU} · compromisso (confirmadas), provável (+ reservas válidas) e potencial (+ lista de espera e rematrícula em andamento) contra a meta. Projeção até ${fmtData(M.fim)}.`}
      actions={<div className="flex flex-wrap gap-2 print:hidden"><Btn kind="ghost" href="/matriculas/rematricula/quadro">Quadro da rematrícula</Btn><Btn kind="ghost" href="/matriculas">Painel de vagas</Btn><Btn kind="ghost" href={`/executivo/metas?ano=${M.hoje.slice(0, 4)}`}>Definir metas</Btn></div>}>
      {escopo === null && <form className="mb-4 flex items-end gap-2 print:hidden"><Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Rede</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Btn kind="ghost">Ver</Btn></form>}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)]">
        <Card title="Ocupação das vagas"><Medidor valor={ocup === null ? null : Math.round(ocup * 10) / 10} min={0} max={100} faixas={metaOcPct !== null ? [Math.max(0, metaOcPct - 10), metaOcPct] : undefined} rotulo="confirmadas + reservas ÷ vagas" formato={x => fmtPct(x, 0)} sub={metaOcPct !== null ? `meta ${fmtPct(metaOcPct, 0)} · ${r0(R.metaMatriculas)} matrículas` : "sem meta"} /></Card>
        <Card title="Rematrícula"><Medidor valor={remPct === null ? null : Math.round(remPct * 10) / 10} min={0} max={100} faixas={R.metaRematriculaPct !== null ? [Math.max(0, R.metaRematriculaPct - 10), R.metaRematriculaPct] : undefined} rotulo={`${R.remFeitas} de ${R.remBase} famílias`} formato={x => fmtPct(x, 0)} sub={R.metaRematriculaPct !== null ? `meta ${fmtPct(R.metaRematriculaPct, 0)}` : "sem meta"} /></Card>
        <div className="grid grid-cols-2 content-start gap-3">
          <KpiCard titulo="Compromisso (confirmadas)" valor={r0(R.confirmadas)} tom="bom" sub={R.metaMatriculas ? `${fmtPct((100 * R.confirmadas) / R.metaMatriculas, 0)} da meta` : undefined} />
          <KpiCard titulo="Provável (+ reservas)" valor={r0(R.confirmadas + R.reservas)} sub={`${R.reservas} reserva(s) válida(s)`} tom={R.metaMatriculas !== null ? (R.confirmadas + R.reservas >= R.metaMatriculas ? "bom" : "atencao") : "neutro"} />
          <KpiCard titulo="Potencial (+ espera e rematrícula)" valor={r0(R.potencial)} sub={`${R.espera} na lista de espera · ${R.remPend} rematrícula(s) em andamento`} />
          <KpiCard titulo="Vagas livres" valor={r0(Math.max(0, R.vagas - R.confirmadas - R.reservas))} sub={`de ${r0(R.vagas)} vagas regulares`} />
        </div>
      </div>
      {leitura.length > 0 && <Card title="Leitura da campanha" className="mb-4"><ul className="space-y-1.5 text-sm">{leitura.map((t, i) => <li key={i} className="flex gap-2"><span aria-hidden className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-acao" />{t}</li>)}</ul><p className="mt-2 text-[11px] text-slate-500">Projeção pelo ritmo médio das últimas 8 semanas; a faixa usa a semana mais fraca e a mais forte do mesmo período. Limitada às vagas.</p></Card>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {graficoMat && <Card title="Ritmo: matrículas ativas por semana" className="lg:col-span-2"><Linhas categorias={graficoMat.cats} series={[{ nome: "Realizado", valores: graficoMat.real, cor: COR.acao, area: true }, ...(graficoMat.proj.length ? [{ nome: "Projeção", valores: graficoMat.proj, cor: COR.navy, tracejada: true }] : [])]} faixa={graficoMat.min.length ? { min: graficoMat.min, max: graficoMat.max, rotulo: "Faixa provável" } : null} meta={R.metaMatriculas ? { valor: R.metaMatriculas, rotulo: "meta" } : null} zero formato={x => fmtNumero(x)} tamanho="inteiro" rotulo="Matrículas ativas por semana e projeção até o fim da campanha" rotuloUltimo={false} /></Card>}
        {graficoRem && <Card title="Ritmo da rematrícula (% dos alunos atuais)" className="lg:col-span-2"><Linhas categorias={graficoRem.cats} series={[{ nome: "Realizado", valores: graficoRem.real, cor: COR.ok, area: true }, ...(graficoRem.proj.length ? [{ nome: "Projeção", valores: graficoRem.proj, cor: COR.navy, tracejada: true }] : [])]} faixa={graficoRem.min.length ? { min: graficoRem.min, max: graficoRem.max, rotulo: "Faixa provável" } : null} meta={R.metaRematriculaPct !== null ? { valor: R.metaRematriculaPct, rotulo: "meta" } : null} zero formato={x => `${Math.round(x)}%`} formatoDica={x => fmtPct(x, 1)} tamanho="inteiro" rotulo="Rematrícula acumulada por semana e projeção" rotuloUltimo={false} /></Card>}
        {M.porUnidade.length > 1 && <Card title="Matrícula por unidade contra a meta"><Bala rotulo="Matrículas por unidade contra a meta" itens={M.porUnidade.map(u => ({ rotulo: u.nome, atual: u.confirmadas + u.reservas, meta: u.metaMatriculas, maximo: u.vagas, formato: (x: number) => fmtNumero(Math.round(x)), href: `/matriculas/metas?unidade=${u.id}`, sub: `${u.vagas} vagas` }))} /><p className="mt-2 text-[11px] text-slate-500">Barra: confirmadas + reservas · traço: meta · fundo cinza: vagas.</p></Card>}
        {M.porUnidade.length > 1 && <Card title="Rematrícula por unidade"><Bala rotulo="Rematrícula por unidade contra a meta" itens={M.porUnidade.map(u => ({ rotulo: u.nome, atual: u.rematriculaPct, meta: u.metaRematriculaPct, maximo: 100, formato: (x: number) => fmtPct(x, 0), href: `/matriculas/rematricula/quadro?unidade=${u.id}`, sub: `${u.remFeitas}/${u.remBase}` }))} /></Card>}
        <Card title="Compromisso, provável e potencial por unidade" className="lg:col-span-2">
          <BarrasH rotulo="Matrícula por categoria de previsão e unidade" largRotulo="9rem" itens={M.porUnidade.map(u => ({ chave: String(u.id), rotulo: u.nome, valor: u.potencial, texto: `${u.confirmadas} + ${u.reservas} + ${Math.max(0, u.potencial - u.confirmadas - u.reservas)}${u.metaMatriculas !== null ? ` · meta ${u.metaMatriculas}` : ""}`, segmentos: [{ valor: u.confirmadas, cor: COR.ok, rotulo: "Confirmadas" }, { valor: u.reservas, cor: COR.acao, rotulo: "Reservas" }, { valor: Math.max(0, u.potencial - u.confirmadas - u.reservas), cor: "#cbd5e1", rotulo: "Potencial" }] }))} max={Math.max(...M.porUnidade.map(u => Math.max(u.vagas, u.potencial)), 1)} formato={x => fmtNumero(x)} />
          <p className="mt-2 text-[11px] text-slate-500">Verde: confirmadas (compromisso) · azul: reservas válidas (provável) · cinza: lista de espera e rematrícula em andamento (potencial), limitado às vagas.</p>
        </Card>
      </div>
      <Card title="Ranking das carteiras na rematrícula" className="mt-4">
        {M.carteiras.length === 0 ? <p className="text-sm text-slate-500">Nenhum aluno atual na base.</p> : <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]"><table className="w-full min-w-[640px] text-left text-xs sm:text-sm">
          <thead className="bg-mist text-xs text-slate-600"><tr>{["#", "Carteira", "Famílias", "Rematriculadas", "Em andamento", "Recusas", "Rematrícula"].map((h, i) => <th key={h} className={`px-3 py-2 font-medium ${i >= 2 && i <= 5 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">{M.carteiras.map((c, i) => <tr key={`${c.userId}`}><td className="px-3 py-2 text-base">{c.userId ? (MEDALHA[i] ?? <span className="text-xs text-slate-500">{i + 1}º</span>) : ""}</td><td className="px-3 py-2 font-medium">{c.userId ? <Link className="text-acao hover:underline" href={`/matriculas/rematricula/quadro?carteira=${c.userId}${unitId ? `&unidade=${unitId}` : ""}`}>{c.nome}</Link> : <span className="text-slate-500">{c.nome}</span>}</td><td className="px-3 py-2 text-right tabular-nums">{c.base}</td><td className="px-3 py-2 text-right tabular-nums text-ok">{c.feitas}</td><td className="px-3 py-2 text-right tabular-nums text-aviso">{c.pendentes}</td><td className="px-3 py-2 text-right tabular-nums text-erro">{c.recusas || "·"}</td><td className="min-w-[12rem] px-3 py-2"><Bala rotulo={`Rematrícula da carteira ${c.nome}`} itens={[{ rotulo: "", atual: c.pct, meta: R.metaRematriculaPct, maximo: 100, formato: (x: number) => fmtPct(x, 0) }]} /></td></tr>)}</tbody>
        </table></div>}
        <p className="mt-2 text-[11px] text-slate-500">Carteira = pessoa da equipe responsável pelo relacionamento com a família (cadastro do aluno). Clique para ver as famílias da carteira no quadro.</p>
      </Card>
    </Page>
  );
}
