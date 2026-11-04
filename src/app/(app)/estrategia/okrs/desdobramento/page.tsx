// v31 · Desdobramento dos OKRs (“os OKRs descem”): o objetivo da rede, os objetivos das unidades e áreas que vêm dele e as metas
// individuais ligadas — com o progresso de cada nível e a média dos desdobramentos.
import Link from "@/components/Link";
import { requireGestao, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Field, Select, Btn, Stat } from "@/components/ui";
import { getSettings } from "@/lib/utils";
import { okrs } from "@/lib/estrategia";
import { SubNav } from "../../_ui";

export const dynamic = "force-dynamic";
type Obj = Awaited<ReturnType<typeof okrs>>["objetivos"][number];
const tom = (p: number | null) => (p === null ? "text-slate-400" : p >= 70 ? "text-ok" : p >= 40 ? "text-aviso" : "text-erro");

export default async function Desdobramento({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireGestao(); const sp = await searchParams; const cfg = await getSettings(); const u = scopeUnit(s); const ciclo = sp.ciclo ?? cfg.estrategia.cicloAtual;
  const [ok, ciclos, metas] = await Promise.all([okrs(ciclo, u), sql<{ ciclo: string }[]>`SELECT DISTINCT ciclo FROM objectives ORDER BY ciclo DESC`,
    sql<{ oid: number; metas: number; pessoas: number }[]>`SELECT coalesce(g.objective_id, k.objective_id) AS oid, count(*)::int AS metas, count(DISTINCT g.employee_id)::int AS pessoas FROM perf_goals g LEFT JOIN key_results k ON k.id=g.key_result_id JOIN employees e ON e.id=g.employee_id WHERE coalesce(g.objective_id, k.objective_id) IS NOT NULL ${u === null ? sql`` : sql`AND e.unit_id=${u}`} GROUP BY 1`]);
  const objs = ok.objetivos.filter(o => o.status !== "CANCELADO"); const ids = new Set(objs.map(o => o.id));
  const filhos = (id: number) => objs.filter(o => o.parent_id === id);
  const raizes = objs.filter(o => !o.parent_id || !ids.has(o.parent_id));
  const mediaFilhos = (id: number): number | null => { const fs = filhos(id).map(f => f.progresso ?? mediaFilhos(f.id)).filter((x): x is number => x !== null); return fs.length ? Math.round(fs.reduce((a, b) => a + b, 0) / fs.length) : null; };
  const desdobrados = objs.filter(o => o.parent_id && ids.has(o.parent_id)).length; const comFilhos = raizes.filter(r => filhos(r.id).length).length;
  const nMetas = (id: number) => metas.find(m => m.oid === id);
  const Cartao = ({ o, nivel }: { o: Obj; nivel: number }) => { const fs = filhos(o.id); const mf = fs.length ? mediaFilhos(o.id) : null; const mt = nMetas(o.id); return (
    <div id={`o${o.id}`} className="scroll-mt-20">
      <div className={`rounded-lg border bg-white p-3 shadow-sm ${sp.foco && Number(sp.foco) === o.id ? "border-acao ring-2 ring-acao/30" : "border-line"}`}>
        <div className="flex items-start justify-between gap-2"><span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ok">{nivel === 0 ? "Objetivo" : "Objetivo desdobrado"}</span><span className={`text-sm font-semibold tabular-nums ${tom(o.progresso)}`}>{o.progresso === null ? "—" : `${o.progresso}%`}</span></div>
        <Link href={`/estrategia/okrs/${o.id}`} className="mt-1 block text-sm font-medium leading-snug text-ink hover:text-acao">{o.titulo}</Link>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600"><span><b className="tabular-nums">{o.krs.length}</b> resultado(s)-chave</span>{mt && <Link className="text-acao" href="/desempenho/metas">{mt.metas} meta(s) individuais · {mt.pessoas} pessoa(s)</Link>}{mf !== null && <span>desdobramentos: <b className={`tabular-nums ${tom(mf)}`}>{mf}%</b></span>}</div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5"><span className="rounded-full bg-mist px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-navy">{o.unidade ?? "Rede"}</span>{o.owner && <span className="text-[11px] text-slate-500">{o.owner}</span>}{o.pilar && <span className="text-[11px] text-slate-400">· {o.pilar}</span>}</div>
      </div>
      {fs.length > 0 && <details open className="group"><summary className="ml-3 mt-1 inline-flex cursor-pointer list-none items-center gap-1 rounded border border-line bg-white px-1.5 py-0.5 text-[11px] text-navy hover:bg-mist">{fs.length} <span className="transition group-open:rotate-180">⌃</span></summary>
        <div className={`relative ml-3 mt-2 grid grid-cols-1 gap-3 border-l-2 border-dashed border-sky-300 pl-4 ${nivel === 0 ? "lg:grid-cols-2" : ""}`}>{fs.map(f => <div key={f.id} className="relative before:absolute before:-left-4 before:top-6 before:w-4 before:border-t-2 before:border-dashed before:border-sky-300"><Cartao o={f} nivel={nivel + 1} /></div>)}</div>
      </details>}
    </div>); };
  return (
    <Page title={`Desdobramento dos OKRs · ${ciclo}`} sub="Os objetivos descem da rede para as unidades e áreas — e chegam às metas individuais. Cada cartão mostra o próprio progresso (pelos resultados-chave) e a média dos desdobramentos.">
      <SubNav atual="desdobramento" />
      <form className="mb-3 flex flex-wrap items-end gap-2"><Field label="Ciclo"><Select name="ciclo" defaultValue={ciclo}>{[...new Set([ciclo, cfg.estrategia.cicloAtual, ...ciclos.map(c => c.ciclo)])].map(c => <option key={c}>{c}</option>)}</Select></Field><Btn kind="ghost">Ver</Btn></form>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><Stat label="Objetivos de topo" value={raizes.length} /><Stat label="Desdobrados" value={desdobrados} hint="objetivos que vêm de outro" /><Stat label="Topo com desdobramento" value={raizes.length ? `${Math.round((100 * comFilhos) / raizes.length)}%` : "—"} /><Stat label="Metas individuais ligadas" value={metas.filter(m => ids.has(m.oid)).reduce((a, m) => a + m.metas, 0)} href="/desempenho/metas" /></div>
      {objs.length === 0 ? <Card><p className="text-sm text-slate-500">Nenhum objetivo neste ciclo. Crie em OKRs; para desdobrar, crie o objetivo da unidade escolhendo “Desdobra o objetivo”.</p></Card> :
        <div className="space-y-6">{raizes.map(r => <Cartao key={r.id} o={r} nivel={0} />)}</div>}
      <p className="mt-4 text-[11px] text-slate-500">Para desdobrar: abra o objetivo → “Desdobrar este objetivo” (ou, em OKRs, escolha “Desdobra o objetivo” ao criar). Para ligar uma meta individual: na meta, “Contribui para (estratégia)”. <Link className="text-acao" href="/estrategia/alinhamento">Árvore de alinhamento</Link> (missão → perspectivas → objetivos → projetos e ações).</p>
    </Page>
  );
}
