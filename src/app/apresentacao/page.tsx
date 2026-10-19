import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { requireGestao } from "@/lib/auth";
import { vePainelExecutivo } from "@/lib/kpi";
import { carregarPainel, linkPainel, type Painel } from "@/lib/painel-executivo";
import { TOM_FAROL, porUnidade, type VisaoKpi } from "@/lib/kpi-catalogo";
import { fmtKpi, rotuloMes } from "@/lib/formato";
import { MapaCalor, COR_TOM, type CelulaCalor } from "@/components/graficos";
import { NavegacaoApresentacao } from "@/components/NavegacaoApresentacao";
import { PrintButton } from "@/components/PrintButton";
import { CartaoKpi, GraficoKpi, Leitura, ResumoSituacao, deltasDe, fmtV } from "@/app/(app)/executivo/_ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Apresentação · Painel Executivo · STATUS ONE" };

type Slide = { titulo: string; conteudo: ReactNode };

function NumeroGrande({ v }: { v: VisaoKpi }) {
  const d = deltasDe(v)[0];
  return (
    <div className="flex min-w-0 flex-col justify-between rounded-lg border border-line bg-white p-4 sm:p-5" style={{ borderTop: `6px solid ${COR_TOM[TOM_FAROL[v.farol]]}` }}>
      <div className="text-sm font-medium text-slate-600 sm:text-base">{v.nome}</div>
      <div className="my-2 text-3xl font-semibold tabular-nums text-navy [overflow-wrap:anywhere] sm:text-5xl">{fmtV(v, v.valor)}</div>
      <div className="text-sm text-slate-600">{d ? <><b className={d.bom === null ? "" : d.bom ? "text-ok" : "text-erro"}>{d.texto}</b> {d.rotulo}</> : " "}{v.meta !== null && <span className="block text-xs text-slate-500">meta {fmtV(v, v.meta)}</span>}</div>
    </div>
  );
}

function montarSlides(P: Painel): Slide[] {
  const href = (chave: string) => linkPainel(`/executivo/indicador/${encodeURIComponent(chave)}`, { periodo: P.periodo, unitId: P.unitId });
  const slides: Slide[] = [];
  slides.push({ titulo: "Resumo do mês", conteudo: (
    <div className="flex flex-1 flex-col justify-center gap-5">
      <div><div className="text-sm uppercase tracking-widest text-slate-500">Colégio Status · Painel Executivo</div><h1 className="mt-1 text-3xl font-semibold text-navy sm:text-5xl">{P.titulo[0].toUpperCase() + P.titulo.slice(1)}</h1><div className="mt-1 text-lg text-slate-600">{P.unidadeNome}</div></div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{P.destaques.slice(0, 8).map(v => <NumeroGrande key={v.def.chave} v={v} />)}</div>
      {P.frases.length > 0 && <div className="rounded-lg bg-mist p-4"><div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Em destaque</div><Leitura frases={P.frases.slice(0, 3)} /></div>}
    </div>) });
  slides.push({ titulo: "Leitura do mês", conteudo: (
    <div className="grid h-full grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="text-base sm:text-lg [&_li]:text-base sm:[&_li]:text-lg"><Leitura frases={P.frases} /></div>
      <div><ResumoSituacao visoes={P.vs} href={href} /></div>
    </div>) });
  for (const a of P.areas) {
    const vs = P.porArea[a] ?? []; if (!vs.length) continue;
    // gráficos que mais dizem: destaques, depois indicadores com meta, depois os demais (com pelo menos 3 meses medidos)
    const graficos = vs.filter(v => v.serie.filter(p => p.valor !== null).length >= 3).sort((a, b) => (a.def.destaque ? 0 : a.meta !== null ? 1 : 2) - (b.def.destaque ? 0 : b.meta !== null ? 1 : 2)).slice(0, 2);
    slides.push({ titulo: P.nomesArea[a].nome, conteudo: (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{vs.slice(0, 8).map(v => <CartaoKpi key={v.def.chave} v={v} href={href(v.def.chave)} />)}</div>
        {graficos.length > 0 && <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{graficos.map(v => <div key={v.def.chave} className="rounded-md border border-line p-3"><div className="mb-1 text-sm font-semibold text-navy">{v.nome}</div><GraficoKpi v={v} /></div>)}</div>}
      </div>) });
  }
  if (P.comparativo) {
    const linhas = P.destaques.filter(v => porUnidade(v.def)); const cols = [...P.comparativo.unidades.map(u => ({ chave: String(u.id), rotulo: u.nome })), { chave: "0", rotulo: "Rede" }];
    const celula = (chave: string, col: string): CelulaCalor => { const c = P.comparativo!.celulas.get(`${chave}|${col}`); const v = linhas.find(x => x.def.chave === chave)!; return !c || c.valor === null ? { texto: "—", tom: "vazio" } : { texto: fmtKpi(c.valor, v.def.unidade, true), tom: TOM_FAROL[c.farol], titulo: c.meta !== null ? `meta ${fmtKpi(c.meta, v.def.unidade, true)}` : undefined }; };
    if (linhas.length) slides.push({ titulo: "Comparativo das unidades", conteudo: <div className="text-base [&_td]:py-3 [&_th]:py-3"><MapaCalor rotulo="Indicadores por unidade" cabecalho="Indicador" colunas={cols} linhas={linhas.map(v => ({ chave: v.def.chave, rotulo: v.nome }))} celula={celula} /></div> });
  }
  return slides;
}

export default async function Apresentacao({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireGestao(); if (!vePainelExecutivo(s)) redirect("/");
  const sp = await searchParams; const P = await carregarPainel(s, sp);
  const slides = montarSlides(P); const total = slides.length;
  const i = Math.max(0, Math.min(total - 1, Number(sp.s ?? 0) || 0)); const auto = sp.auto ? Number(sp.auto) || null : null;
  const base = { periodo: P.periodo, unitId: P.unitId };
  const link = (n: number) => linkPainel("/apresentacao", base, { s: n, auto: auto ?? undefined });
  const imprimir = sp.imprimir === "1";
  const cabecalho = (t: string, n: number) => (
    <header className="flex flex-wrap items-center justify-between gap-2 bg-navy px-4 py-2.5 text-white sm:px-6">
      <div className="min-w-0"><span className="text-xs text-sky-200">STATUS ONE · Painel Executivo · {P.unidadeNome} · {rotuloMes(P.periodo)}</span><h2 className="truncate text-lg font-semibold leading-tight sm:text-xl">{t}</h2></div>
      {!imprimir && <nav className="flex items-center gap-2 text-sm print:hidden" aria-label="Navegação da apresentação">
        <span className="tabular-nums text-sky-200">{n + 1} / {total}</span>
        {n > 0 ? <Link href={link(n - 1)} className="rounded border border-white/30 px-2.5 py-1 hover:bg-white/10" aria-label="Slide anterior">←</Link> : <span className="rounded border border-white/10 px-2.5 py-1 text-white/30">←</span>}
        {n < total - 1 ? <Link href={link(n + 1)} className="rounded border border-white/30 px-2.5 py-1 hover:bg-white/10" aria-label="Próximo slide">→</Link> : <span className="rounded border border-white/10 px-2.5 py-1 text-white/30">→</span>}
        <NavegacaoApresentacao anterior={n > 0 ? link(n - 1) : null} proximo={n < total - 1 ? link(n + 1) : null} primeiro={link(0)} sair={linkPainel("/executivo", base)} auto={auto} />
        <Link href={linkPainel("/apresentacao", base, { imprimir: 1 })} className="rounded border border-white/30 px-2.5 py-1 text-xs hover:bg-white/10">PDF</Link>
        <Link href={linkPainel("/executivo", base)} className="rounded border border-white/30 px-2.5 py-1 text-xs hover:bg-white/10">Sair</Link>
      </nav>}
    </header>
  );
  return (
    <div className="min-h-screen bg-slate-200 print:bg-white">
      <style>{`@page { size: A4 landscape; margin: 8mm } @media print { .slide { break-after: page; min-height: 0 !important; } .slide:last-child { break-after: auto; } }`}</style>
      {(imprimir ? slides.map((sl, n) => ({ sl, n })) : [{ sl: slides[i], n: i }]).map(({ sl, n }) => (
        <section key={n} className="slide flex min-h-screen flex-col">
          {cabecalho(sl.titulo, n)}
          <div className="flex flex-1 flex-col bg-white p-4 sm:p-6 lg:[zoom:1.05] 2xl:[zoom:1.3]">{sl.conteudo}</div>
          {!imprimir && <div className="bg-white px-4 pb-2 text-center text-[11px] text-slate-500 print:hidden">← → ou espaço para navegar · Esc volta ao painel · passagem automática: <Link className="underline" href={linkPainel("/apresentacao", base, { s: i, auto: 20 })}>a cada 20 s</Link> · <Link className="underline" href={linkPainel("/apresentacao", base, { s: i })}>parar</Link></div>}
        </section>
      ))}
      {imprimir && <div className="fixed bottom-4 right-4 flex gap-2 print:hidden"><PrintButton /><Link href={linkPainel("/apresentacao", base)} className="rounded-md bg-white px-3 py-2 text-sm text-navy shadow">Voltar aos slides</Link></div>}
    </div>
  );
}
