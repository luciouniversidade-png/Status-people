import { requireGestao, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Field, Select, Btn } from "@/components/ui";
import { Gantt, KpiCard, Rosca, BarrasH, Bala, COR, type LinhaGantt } from "@/components/graficos";
import { portfolio, PROJ_STATUS, SAUDE, ATIVOS_PROJ } from "@/lib/estrategia";
import { hoje, addDays } from "@/lib/utils";
import { fmtReais } from "@/lib/formato";
import { SubNav } from "../_ui";

export const dynamic = "force-dynamic";

const COR_SAUDE: Record<string, string> = { VERDE: COR.ok, AMARELO: COR.aviso, VERMELHO: COR.erro };

/** Cronograma do portfólio (Gantt): barras de início a fim com o avanço dos marcos, marcos no tempo e a linha de hoje. */
export default async function Cronograma({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireGestao(); const sp = await searchParams; const u = scopeUnit(s); const h = hoje();
  const filtro = sp.filtro === "TODOS" ? "TODOS" : "ATIVOS";
  const pf = await portfolio(u);
  const rows = (filtro === "ATIVOS" ? pf.rows.filter(r => ATIVOS_PROJ.includes(r.status)) : pf.rows.filter(r => r.status !== "CANCELADO"));
  const marcos = rows.length ? await sql<{ project_id: number; titulo: string; prazo: string | null; concluido_em: string | null; baseline_prazo: string | null }[]>`SELECT project_id, titulo, prazo::text, concluido_em::text, baseline_prazo::text FROM milestones WHERE project_id = ANY(${rows.map(r => r.id)}) ORDER BY prazo NULLS LAST, ordem` : [];
  const zoom = sp.zoom === "semana" ? "semana" as const : "mes" as const;
  const datas = rows.flatMap(r => [r.inicio, r.fim]).filter((d): d is string => !!d);
  let de = datas.length ? datas.reduce((a, b) => a < b ? a : b) : addDays(h, -30); let ate = datas.length ? datas.reduce((a, b) => a > b ? a : b) : addDays(h, 120);
  if (de > addDays(h, -30)) de = addDays(h, -30); if (ate < addDays(h, 60)) ate = addDays(h, 60);
  if (de < addDays(h, -365)) de = addDays(h, -365); if (ate > addDays(h, 540)) ate = addDays(h, 540);
  de = `${de.slice(0, 7)}-01`;
  const linhas: LinhaGantt[] = rows.filter(r => r.inicio || r.fim).sort((a, b) => (a.inicio ?? a.fim ?? "").localeCompare(b.inicio ?? b.fim ?? "")).map(r => ({
    chave: String(r.id), rotulo: r.nome, href: `/estrategia/projetos/${r.id}`, sub: `${r.owner ?? "sem dono"} · ${r.unidade ?? "rede"} · ${PROJ_STATUS[r.status]}${ATIVOS_PROJ.includes(r.status) ? ` · ${SAUDE[r.saude] ?? ""}` : ""}`,
    inicio: r.inicio ?? r.fim, fim: r.fim ?? r.inicio, cor: r.status === "CONCLUIDO" ? COR.neutro : COR_SAUDE[r.saude] ?? COR.acao, progresso: r.marcos ? Math.round((100 * r.marcos_ok) / r.marcos) : null,
    marcos: marcos.filter(m => m.project_id === r.id && m.prazo).map(m => ({ data: m.prazo!, rotulo: m.titulo, estado: m.concluido_em ? "FEITO" as const : m.prazo! < h ? "ATRASADO" as const : "PENDENTE" as const, baseline: m.baseline_prazo })),
  }));
  const semDatas = rows.filter(r => !r.inicio && !r.fim);
  const ativos = pf.rows.filter(r => ATIVOS_PROJ.includes(r.status)); const atrasados = ativos.filter(r => r.fim && r.fim < h);
  const concluidosAno = pf.rows.filter(r => r.status === "CONCLUIDO" && (r.fim ?? "") >= `${h.slice(0, 4)}-01-01`).length;
  const porDono = new Map<string, { v: number; a: number; r: number }>(); for (const r of ativos) { const k = r.owner ?? "Sem dono"; const x = porDono.get(k) ?? { v: 0, a: 0, r: 0 }; if (r.saude === "VERMELHO") x.r++; else if (r.saude === "AMARELO") x.a++; else x.v++; porDono.set(k, x); }
  const orc = ativos.filter(r => r.orcamento).sort((a, b) => (b.orcamento ?? 0) - (a.orcamento ?? 0)).slice(0, 8);
  return (
    <Page title="Cronograma do portfólio" sub="Barras do início ao fim de cada projeto, preenchidas pelo avanço dos marcos; losangos são os marcos (verde feito, vermelho atrasado); a linha vermelha é hoje."
      actions={<div className="flex flex-wrap gap-2 print:hidden"><Btn kind="ghost" href="/estrategia/projetos">Lista de projetos</Btn><Btn kind="ghost" href="/estrategia/acoes/quadro">Quadro de ações</Btn></div>}>
      <SubNav atual="cronograma" />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard titulo="Projetos ativos" valor={String(pf.ativos)} />
        <KpiCard titulo="No rumo" valor={String(ativos.length - pf.vermelhos - pf.amarelos)} tom="bom" />
        <KpiCard titulo="Atenção" valor={String(pf.amarelos)} tom={pf.amarelos ? "atencao" : "neutro"} />
        <KpiCard titulo="Em risco" valor={String(pf.vermelhos)} tom={pf.vermelhos ? "ruim" : "neutro"} />
        <KpiCard titulo="Passaram do prazo final" valor={String(atrasados.length)} tom={atrasados.length ? "ruim" : "bom"} sub={`${pf.marcosAtrasados} marco(s) atrasado(s)`} />
        <KpiCard titulo={`Concluídos em ${h.slice(0, 4)}`} valor={String(concluidosAno)} tom="bom" />
      </div>
      <form className="mb-3 flex flex-wrap items-end gap-2 print:hidden"><Field label="Mostrar"><Select name="filtro" defaultValue={filtro}><option value="ATIVOS">Ativos</option><option value="TODOS">Todos (sem cancelados)</option></Select></Field><Field label="Zoom"><Select name="zoom" defaultValue={zoom}><option value="mes">Mês</option><option value="semana">Semana (próximas 9)</option></Select></Field><Btn kind="ghost">Ver</Btn></form>
      <Card title={`Cronograma (${linhas.length} projeto(s))`}>
        <Gantt de={zoom === "semana" ? addDays(h, -28) : de} ate={zoom === "semana" ? addDays(h, 63) : ate} hoje={h} linhas={linhas} escala={zoom} rotulo="Cronograma dos projetos" />
        <p className="mt-1 text-[11px] text-slate-500">Losango vazado cinza: data da baseline do marco (o traço liga ao prazo atual). Desvios e replanejamentos com motivo ficam no cronograma de cada projeto.</p>
        {semDatas.length > 0 && <p className="mt-2 text-xs text-aviso">Sem datas de início e fim: {semDatas.map(r => r.nome).join(", ")} — defina as datas no projeto para aparecer no cronograma.</p>}
      </Card>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Projetos por situação"><Rosca rotulo="Projetos por situação" fatias={Object.keys(PROJ_STATUS).filter(k => k !== "CANCELADO").map((k, i) => ({ rotulo: PROJ_STATUS[k], valor: pf.rows.filter(r => r.status === k).length, cor: k === "CONCLUIDO" ? COR.ok : k === "EM_ANDAMENTO" ? COR.acao : k === "PAUSADO" ? COR.aviso : i === 0 ? "#cbd5e1" : "#94a3b8" }))} centro={{ valor: String(pf.rows.filter(r => r.status !== "CANCELADO").length), rotulo: "projetos" }} tamanho={120} /></Card>
        <Card title="Projetos ativos por dono">{porDono.size === 0 ? <p className="text-sm text-slate-500">Nenhum projeto ativo.</p> : <BarrasH rotulo="Projetos ativos por dono e saúde" itens={[...porDono.entries()].sort((a, b) => (b[1].r - a[1].r) || (b[1].v + b[1].a + b[1].r) - (a[1].v + a[1].a + a[1].r)).map(([k, x]) => ({ chave: k, rotulo: k, valor: x.v + x.a + x.r, segmentos: [{ valor: x.v, cor: COR.ok, rotulo: "No rumo" }, { valor: x.a, cor: COR.aviso, rotulo: "Atenção" }, { valor: x.r, cor: COR.erro, rotulo: "Em risco" }] }))} formato={x => String(x)} />}</Card>
        <Card title="Gasto × orçamento (ativos)">{orc.length === 0 ? <p className="text-sm text-slate-500">Nenhum projeto ativo com orçamento.</p> : <><Bala rotulo="Gasto de cada projeto contra o orçamento" itens={orc.map(r => ({ rotulo: r.nome, atual: r.gasto ?? 0, meta: r.orcamento, menorMelhor: true, formato: (x: number) => fmtReais(x, true), href: `/estrategia/projetos/${r.id}` }))} /><p className="mt-2 text-[11px] text-slate-500">Barra: gasto · traço: orçamento · % = parte do orçamento já gasta (âmbar a partir de 90%, vermelho acima do orçado). Total: {fmtReais(pf.gasto, true)} de {fmtReais(pf.orcamento, true)}.</p></>}</Card>
      </div>
    </Page>
  );
}
