import { redirect } from "next/navigation";
import { getSession, scopeUnit } from "@/lib/auth";
import { healthGeral } from "@/lib/command-center";
import { sql } from "@/db";
import { painelGestao } from "@/lib/gestao-estrategica";
import { getSettings } from "@/lib/utils";

export const dynamic = "force-dynamic";
const cor = (v: number) => v >= 80 ? "#34d399" : v >= 60 ? "#fbbf24" : "#f87171";

/** Modo TV do Command Center: tela cheia, dados agregados (sem nomes de pessoas); atualiza a cada 5 min no horário escolar e 30 min fora dele. Acesso por sessão de gestão ou por TV_TOKEN (tela fixa). */
export default async function TV({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams; const s = await getSession(); const tokenOk = !!process.env.TV_TOKEN && sp.token === process.env.TV_TOKEN;
  if (!s && !tokenOk) redirect("/login");
  if (s && !["DIRECAO", "RH", "DIRETOR_UNIDADE", "LEITURA"].includes(s.role)) redirect("/");
  const escopo = s ? scopeUnit(s) : null; const pedida = sp.unidade ? Number(sp.unidade) : null; const u = escopo ?? pedida;
  const [hg, g, cfg] = await Promise.all([healthGeral(u), painelGestao(u).catch(() => null), getSettings()]); const fx = cfg.estrategia.faixasSaude as [number, number]; const corS = (v: number | null) => v === null ? "#94a3b8" : v >= fx[1] ? "#34d399" : v >= fx[0] ? "#fbbf24" : "#f87171"; const [unit] = u ? await sql<{ nome: string }[]>`SELECT nome FROM units WHERE id=${u}` : [];
  const completo = !!s && sp.completo === "1"; const agora = new Date().toLocaleString("pt-BR", { timeZone: "America/Campo_Grande", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
  // Horário escolar: atualiza a cada 5 min; fora dele, a cada 30 min (a TV pode ficar ligada sem gastar a hospedagem à toa)
  const horaLocal = Number(new Date().toLocaleString("en-US", { timeZone: "America/Campo_Grande", hour: "2-digit", hour12: false })); const intervalo = horaLocal >= 6 && horaLocal < 20 ? 300 : 1800;
  const alertas = [...hg.alertas].sort((a, b) => (a.nivel === "ALTO" ? 0 : 1) - (b.nivel === "ALTO" ? 0 : 1)).slice(0, 8);
  return (
    <main className="min-h-screen bg-[#0b1526] p-6 text-slate-100 lg:p-10">
      <meta httpEquiv="refresh" content={String(intervalo)} />
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><div className="text-sm uppercase tracking-widest text-slate-400">STATUS ONE · Painel da operação</div><h1 className="text-3xl font-semibold lg:text-5xl">{unit?.nome ?? "Rede Colégio Status"}</h1></div><div className="text-right text-slate-400"><div className="text-lg">Atualizado {agora}</div><div className="text-xs">atualiza sozinho a cada {intervalo / 60} minutos</div></div></header>
      <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="flex flex-col items-center justify-center rounded-2xl bg-white/5 p-6"><div className="text-sm uppercase tracking-wide text-slate-400">Saúde geral</div><div className="text-7xl font-bold tabular-nums lg:text-8xl" style={{ color: cor(hg.geral) }}>{hg.geral}</div><div className="text-xs text-slate-400">de 100</div></div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">{hg.dominios.map(d => <div key={d.chave} className="rounded-2xl bg-white/5 p-4"><div className="flex items-baseline justify-between gap-2"><div className="text-lg font-medium">{d.nome}</div><div className="text-4xl font-bold tabular-nums" style={{ color: cor(d.score) }}>{d.score}</div></div>{(d.chave !== "financeiro" || completo) ? <ul className="mt-2 space-y-0.5 text-sm text-slate-300">{d.kpis.slice(0, 3).map(k => <li key={k.label} className="flex justify-between gap-2"><span className="text-slate-400">{k.label}</span><span className="tabular-nums">{k.valor}</span></li>)}</ul> : <div className="mt-2 text-xs text-slate-500">valores financeiros ocultos na TV</div>}</div>)}</div>
      </section>
      {g && <section className="mb-6 rounded-2xl bg-white/5 p-5"><div className="mb-3 text-sm uppercase tracking-wide text-slate-400">Estratégia {g.ciclo}</div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <div><div className="text-5xl font-bold tabular-nums" style={{ color: corS(g.saude.score) }}>{g.saude.score === null ? "—" : Math.round(g.saude.score)}</div><div className="text-sm text-slate-400">saúde estratégica</div></div>
          <div><div className="text-4xl font-bold tabular-nums" style={{ color: corS(g.ok.progressoCiclo) }}>{g.ok.progressoCiclo === null ? "—" : `${g.ok.progressoCiclo}%`}</div><div className="text-sm text-slate-400">progresso dos OKRs</div></div>
          <div><div className="text-4xl font-bold tabular-nums">{g.comMeta ? `${g.noAlvo}/${g.comMeta}` : "—"}</div><div className="text-sm text-slate-400">indicadores no alvo</div></div>
          <div><div className="text-4xl font-bold tabular-nums" style={{ color: g.ac.vencidas ? "#f87171" : "#34d399" }}>{g.ac.vencidas}</div><div className="text-sm text-slate-400">ações vencidas · {g.ac.bloqueadas} bloqueada(s)</div></div>
          <div><div className="text-4xl font-bold tabular-nums">{g.rit.ativos ? `${g.rit.emDia}/${g.rit.ativos}` : "—"}</div><div className="text-sm text-slate-400">rituais de gestão em dia</div></div>
        </div></section>}
      <section className="rounded-2xl bg-white/5 p-5"><div className="mb-3 text-sm uppercase tracking-wide text-slate-400">Atenção agora</div>{alertas.length === 0 ? <div className="text-xl text-emerald-300">Nenhum alerta aberto.</div> : <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">{alertas.map((a, i) => <li key={i} className="flex items-start gap-3 text-lg"><span className="mt-2 inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: a.nivel === "ALTO" ? "#f87171" : "#fbbf24" }} aria-label={a.nivel === "ALTO" ? "alto" : "médio"} />{a.texto}</li>)}</ul>}</section>
      <footer className="mt-6 text-xs text-slate-500">Dados agregados, sem informações pessoais. Para tela fixa sem login, use /tv?token=… com a variável TV_TOKEN (e opcionalmente &unidade=ID).</footer>
    </main>
  );
}
