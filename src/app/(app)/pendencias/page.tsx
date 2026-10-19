import Link from "@/components/Link";
import { requireSession } from "@/lib/auth";
import { Page, Card, Stat, Btn } from "@/components/ui";
import { Situacao as Selo } from "@/components/graficos";
import { minhasPendencias, resumoPendencias, situacaoPend, GRUPO_PEND, ORDEM_GRUPOS, SITUACAO_PEND, type Pendencia, type GrupoPend } from "@/lib/pendencias";
import { hoje, fmtData } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Minhas pendências: tudo o que espera por mim em todos os módulos, por urgência — com o link de onde resolver. */
export default async function Pendencias({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams; const h = hoje();
  const { itens, falhas } = await minhasPendencias(s);
  const R = resumoPendencias(itens, h);
  const grupo = ORDEM_GRUPOS.includes(sp.grupo as GrupoPend) ? (sp.grupo as GrupoPend) : null;
  const filtroSit = sp.sit === "urgentes" ? "urgentes" : null;
  const lista = itens.filter(i => (!grupo || i.grupo === grupo) && (!filtroSit || ["VENCIDA", "HOJE"].includes(situacaoPend(i.prazo, h))));
  const link = (g: string | null, sit: string | null = filtroSit) => { const q = new URLSearchParams(); if (g) q.set("grupo", g); if (sit) q.set("sit", sit); const t = q.toString(); return `/pendencias${t ? `?${t}` : ""}`; };
  const porGrupo = (g: GrupoPend) => itens.filter(i => i.grupo === g).length;
  const faixas: { chave: string; titulo: string; ok: (p: Pendencia) => boolean }[] = [
    { chave: "VENCIDA", titulo: "Vencidas", ok: p => situacaoPend(p.prazo, h) === "VENCIDA" },
    { chave: "HOJE", titulo: "Vencem hoje", ok: p => situacaoPend(p.prazo, h) === "HOJE" },
    { chave: "PROXIMA", titulo: "Próximos 3 dias", ok: p => situacaoPend(p.prazo, h) === "PROXIMA" },
    { chave: "FUTURA", titulo: "Mais adiante", ok: p => situacaoPend(p.prazo, h) === "FUTURA" },
    { chave: "SEM_PRAZO", titulo: "Sem prazo", ok: p => situacaoPend(p.prazo, h) === "SEM_PRAZO" },
  ];
  const primeiroNome = s.nome.split(" ")[0];
  return (
    <Page title="Minhas pendências" sub={`${primeiroNome}, tudo o que espera por você nos módulos do ONE — aprovações, casos, chamados, ações, ciência e desenvolvimento. Resolva no próprio módulo pelo link.`}
      actions={<div className="flex gap-2 print:hidden"><Btn kind="ghost" href="/">Início</Btn>{s.role !== "COLABORADOR" && <Btn kind="ghost" href="/fluxos">Central de fluxos</Btn>}</div>}>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Pendências" value={R.total} href={link(null, null)} />
        <Stat label="Vencidas" value={<span className={R.vencidas ? "text-erro" : "text-ok"}>{R.vencidas}</span>} hint={R.vencidas ? "resolva primeiro" : "nada vencido"} href={link(grupo, "urgentes")} />
        <Stat label="Vencem hoje" value={<span className={R.hoje ? "text-aviso" : ""}>{R.hoje}</span>} href={link(grupo, "urgentes")} />
        <Stat label="Próximos 3 dias" value={R.proximas} />
      </div>
      <nav aria-label="Grupos de pendências" className="mb-4 flex flex-wrap gap-1.5 print:hidden">
        <Link href={link(null)} className={`rounded-full border px-3 py-1 text-xs ${!grupo ? "border-acao bg-sky-50 font-semibold text-navy" : "border-line text-slate-600 hover:bg-mist"}`}>Todas <span className="tabular-nums text-slate-500">{itens.length}</span></Link>
        {ORDEM_GRUPOS.map(g => <Link key={g} href={link(g)} className={`rounded-full border px-3 py-1 text-xs ${grupo === g ? "border-acao bg-sky-50 font-semibold text-navy" : "border-line text-slate-600 hover:bg-mist"}`}>{GRUPO_PEND[g].nome} <span className="tabular-nums text-slate-500">{porGrupo(g)}</span></Link>)}
        {filtroSit ? <Link href={link(grupo, null)} className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs text-erro">só vencidas e de hoje ✕</Link> : <Link href={link(grupo, "urgentes")} className="rounded-full border border-line px-3 py-1 text-xs text-slate-600 hover:bg-mist">só vencidas e de hoje</Link>}
      </nav>
      {lista.length === 0 ? <Card><p className="py-6 text-center text-sm text-slate-600">{itens.length === 0 ? "Nada pendente com você agora. 🎉" : "Nada neste filtro."}</p></Card> :
        <div className="space-y-4">
          {faixas.map(f => { const xs = lista.filter(f.ok); if (!xs.length) return null; return (
            <Card key={f.chave} title={<span className="flex items-center gap-2">{f.titulo} <span className="rounded-full bg-mist px-2 text-xs font-normal tabular-nums text-slate-600">{xs.length}</span></span>}>
              <ul className="divide-y divide-line">
                {xs.map(p => { const st = situacaoPend(p.prazo, h); return (
                  <li key={p.chave} className="grid grid-cols-1 gap-1 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2 text-[11px] uppercase tracking-wide text-slate-500"><span>{p.modulo}</span><span aria-hidden>·</span><span className="normal-case tracking-normal">{GRUPO_PEND[p.grupo].nome}</span></div>
                      <Link href={p.href} className="block font-medium text-acao hover:underline [overflow-wrap:anywhere]">{p.titulo}</Link>
                      {p.sub && <div className="text-xs text-slate-500 [overflow-wrap:anywhere]">{p.sub}</div>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      {p.prazo && <span className="whitespace-nowrap text-xs tabular-nums text-slate-600">{st === "VENCIDA" ? "venceu" : "prazo"} {fmtData(p.prazo)}</span>}
                      <Selo tom={SITUACAO_PEND[st].tom} texto={SITUACAO_PEND[st].rotulo} />
                      <Btn small href={p.href}>{p.acao}</Btn>
                    </div>
                  </li>); })}
              </ul>
            </Card>); })}
        </div>}
      {falhas.length > 0 && <p className="mt-4 text-xs text-aviso">Alguns módulos não puderam ser consultados agora ({falhas.map(f => f.split(":")[0]).join(", ")}). Tente de novo em instantes.</p>}
      <p className="mt-4 text-[11px] text-slate-500">Ética e LGPD aparecem só pelo protocolo — nenhum conteúdo de relato ou pedido sai do módulo de origem.</p>
    </Page>
  );
}
