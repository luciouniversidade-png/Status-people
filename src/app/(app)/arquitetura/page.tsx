import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession } from "@/lib/auth";
import { Page, Card, Flash, Stat, Input, Btn } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { BarrasH, COR } from "@/components/graficos";
import { PrintButton } from "@/components/PrintButton";
import { FICHAS, KPIS_OBRA, CRQS, GOLIVE, NOTIFICACOES_OBRA, ESTADO_FICHA, type EstadoFicha } from "@/lib/arquitetura";
import { DECISOES_V3 } from "@/db/setup";
import { KPI } from "@/lib/kpi";
import { APP_VERSION } from "@/lib/versao";
import { fmtDataHora } from "@/lib/utils";
import { marcarGoLive } from "./actions";

export const dynamic = "force-dynamic";
const CHIP: Record<string, string> = { bom: "border-emerald-200 bg-emerald-50 text-ok", atencao: "border-amber-200 bg-amber-50 text-aviso", neutro: "border-slate-200 bg-slate-50 text-slate-600", ruim: "border-red-200 bg-red-50 text-erro" };
const Estado = ({ e }: { e: EstadoFicha }) => <span className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-medium ${CHIP[ESTADO_FICHA[e].tom]}`}>{ESTADO_FICHA[e].rotulo}</span>;
const ABAS: [string, string][] = [["fichas", "106 telas"], ["kpis", "40 KPIs"], ["regras", "Regras CRQ"], ["decisoes", "14 decisões"], ["golive", "Go-live (Ap. F)"], ["notificacoes", "Notificações (Ap. J)"]];

/** A obra dentro do sistema: rastreabilidade de cada ficha, KPI, regra, decisão, item de go-live e notificação com o estado real na versão atual. */
export default async function Arquitetura({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!["DIRECAO", "RH", "FINANCEIRO", "DIRETOR_UNIDADE", "LEITURA"].includes(s.role)) redirect("/"); const sp = await searchParams;
  const aba = ABAS.some(([k]) => k === sp.aba) ? sp.aba! : "fichas"; const q = (sp.q ?? "").trim().toLowerCase(); const filtro = sp.estado as EstadoFicha | undefined;
  const conta = (xs: { 4: EstadoFicha }[] | EstadoFicha[]) => { const es = (xs as unknown[]).map(x => (Array.isArray(x) ? x[4] : x) as EstadoFicha); return Object.fromEntries((Object.keys(ESTADO_FICHA) as EstadoFicha[]).map(k => [k, es.filter(e => e === k).length])) as Record<EstadoFicha, number>; };
  const cf = conta(FICHAS as unknown as { 4: EstadoFicha }[]);
  const [pend, golive] = await Promise.all([sql<{ titulo: string; status: string; prazo: string | null; responsavel: string | null }[]>`SELECT p.titulo, p.status, p.prazo::text, u.nome AS responsavel FROM exec_pending p LEFT JOIN users u ON u.id=p.responsavel_user_id WHERE p.titulo LIKE 'Decisão nº %'`,
    sql<{ chave: string; feito: boolean; evidencia: string | null; responsavel: string | null; user_nome: string | null; updated_at: Date }[]>`SELECT chave, feito, evidencia, responsavel, user_nome, updated_at FROM golive_items`]);
  const modulos = [...new Set(FICHAS.map(f => f[3]))];
  const fichas = FICHAS.filter(f => (!filtro || f[4] === filtro) && (!q || `${f[0]} ${f[1]} ${f[3]} ${f[6]}`.toLowerCase().includes(q)));
  const conduz = ["DIRECAO", "RH"].includes(s.role); const feitos = GOLIVE.filter(g => golive.find(x => x.chave === g[0])?.feito).length;
  return (
    <Page title="A Nova Arquitetura no sistema" sub={`Rastreabilidade da obra “STATUS ONE · A Nova Arquitetura · Edição Integral Referenciada v3” na versão ${APP_VERSION}: cada tela, KPI, regra, decisão, item de go-live e notificação, com o estado real e o link.`} actions={<PrintButton />}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">
        <Stat label="Telas no ar" value={<span className="text-ok">{cf.IMPLEMENTADA}</span>} hint={`de ${FICHAS.length} fichas`} href="/arquitetura?aba=fichas&estado=IMPLEMENTADA" />
        <Stat label="Parciais" value={<span className="text-aviso">{cf.PARCIAL}</span>} hint="o restante explicado" href="/arquitetura?aba=fichas&estado=PARCIAL" />
        <Stat label="Fora por decisão" value={cf.FORA} hint="CRM de leads, acadêmico transacional, assinaturas" href="/arquitetura?aba=fichas&estado=FORA" />
        <Stat label="Visão futura" value={cf.FUTURA} href="/arquitetura?aba=fichas&estado=FUTURA" />
        <Stat label="KPIs com chave no catálogo" value={KPIS_OBRA.filter(k => k[2]).length} hint={`de ${KPIS_OBRA.length}`} href="/arquitetura?aba=kpis" />
        <Stat label="Go-live" value={`${feitos}/${GOLIVE.length}`} hint="itens com evidência" href="/arquitetura?aba=golive" />
      </div>
      <nav className="mb-3 flex flex-wrap gap-1.5 print:hidden" aria-label="Seções">{ABAS.map(([k, r]) => <Link key={k} href={`/arquitetura?aba=${k}`} className={`rounded-full border px-3 py-1 text-xs ${aba === k ? "border-acao bg-acao text-white" : "border-line bg-white hover:bg-mist"}`}>{r}</Link>)}</nav>

      {aba === "fichas" && <Card title={`Fichas de tela (${fichas.length}${filtro || q ? ` de ${FICHAS.length}` : ""})`} actions={<form className="flex gap-1 print:hidden" action="/arquitetura"><input type="hidden" name="aba" value="fichas" />{filtro && <input type="hidden" name="estado" value={filtro} />}<label className="sr-only" htmlFor="q">Buscar</label><Input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="T-023, DRE, folha…" className="!py-1 !text-xs" /><Btn small kind="ghost">Buscar</Btn></form>}>
        <div className="mb-3"><BarrasH itens={modulos.map(m => { const xs = FICHAS.filter(f => f[3] === m); return { rotulo: m, valor: xs.length, segmentos: [{ valor: xs.filter(f => f[4] === "IMPLEMENTADA").length, cor: COR.ok, rotulo: "No ar" }, { valor: xs.filter(f => f[4] === "PARCIAL").length, cor: COR.aviso, rotulo: "Parcial" }, { valor: xs.filter(f => f[4] === "FORA" || f[4] === "FUTURA").length, cor: COR.neutro, rotulo: "Fora / futura" }] }; })} formato={x => String(x)} rotulo="Fichas por módulo e estado" largRotulo="11rem" /></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="bg-mist text-xs text-slate-600"><tr><th className="px-2 py-1.5 text-left font-medium">Ficha</th><th className="px-2 py-1.5 text-left font-medium">Módulo · onda</th><th className="px-2 py-1.5 text-left font-medium">Estado</th><th className="px-2 py-1.5 text-left font-medium">Na versão {APP_VERSION}</th></tr></thead>
          <tbody className="divide-y divide-line">{fichas.map(f => <tr key={f[0]} id={f[0]}><td className="px-2 py-1.5 align-top"><span className="font-mono text-[11px] text-slate-500">{f[0]}</span> {f[5] ? <Link href={f[5]} className="font-medium text-acao hover:underline">{f[1]}</Link> : <span className="font-medium">{f[1]}</span>}</td><td className="px-2 py-1.5 align-top text-xs text-slate-600">{f[3]} · {f[2].toLowerCase()}</td><td className="px-2 py-1.5 align-top"><Estado e={f[4]} /></td><td className="px-2 py-1.5 align-top text-xs">{f[6]}</td></tr>)}</tbody></table></div>
      </Card>}

      {aba === "kpis" && <Card title="KPI-01 a KPI-40 (Cap. 34) → catálogo de indicadores">
        <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm"><thead className="bg-mist text-xs text-slate-600"><tr><th className="px-2 py-1.5 text-left font-medium">KPI</th><th className="px-2 py-1.5 text-left font-medium">Chave no sistema</th><th className="px-2 py-1.5 text-left font-medium">Estado</th><th className="px-2 py-1.5 text-left font-medium">Nota</th></tr></thead>
          <tbody className="divide-y divide-line">{KPIS_OBRA.map(k => <tr key={k[0]}><td className="px-2 py-1.5"><span className="font-mono text-[11px] text-slate-500">{k[0]}</span> {k[1]}</td><td className="px-2 py-1.5 text-xs">{k[2] && KPI[k[2]] ? <Link href={`/executivo/indicador/${encodeURIComponent(k[2])}`} className="font-mono text-acao hover:underline">{k[2]}</Link> : k[2] ? <span className="font-mono text-erro">{k[2]} (não encontrada)</span> : "—"}</td><td className="px-2 py-1.5"><Estado e={k[3]} /></td><td className="px-2 py-1.5 text-xs">{k[4]}</td></tr>)}</tbody></table></div>
      </Card>}

      {aba === "regras" && <Card title={`Regras CRQ (Cap. 35) — ${CRQS.length}`}>
        <ul className="divide-y divide-line text-sm">{CRQS.map(r => <li key={r[0]} className="flex flex-wrap items-baseline gap-2 py-1.5"><span className="font-mono text-[11px] text-slate-500">{r[0]}</span><b className="min-w-0 flex-1">{r[1]}</b><Estado e={r[2]} /><span className="w-full text-xs text-slate-600">{r[3]}</span></li>)}</ul>
      </Card>}

      {aba === "decisoes" && <Card title="As 14 decisões pendentes da obra (Cap. 39.1)" actions={<Link href="/command-center#decisoes" className="text-xs text-acao">Decidir no Command Center →</Link>}>
        <ul className="divide-y divide-line text-sm">{DECISOES_V3.map(([n, titulo, bloqueia, origem]) => { const p = pend.find(x => x.titulo === `Decisão nº ${n} — ${titulo}`); return <li key={n} className="flex flex-wrap items-baseline gap-2 py-1.5"><span className="w-8 font-mono text-[11px] text-slate-500">nº {n}</span><span className="min-w-0 flex-1"><b>{titulo}</b><span className="block text-xs text-slate-600">Bloqueia: {bloqueia} · {origem}</span></span><span className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${p?.status === "DECIDIDA" ? CHIP.bom : p?.status === "ADIADA" ? CHIP.atencao : CHIP.neutro}`}>{p ? (p.status === "DECIDIDA" ? "Decidida" : p.status === "ADIADA" ? "Adiada" : "Aberta") : "fora da fila"}</span>{p?.responsavel && <span className="text-xs text-slate-500">{p.responsavel}</span>}</li>; })}</ul>
      </Card>}

      {aba === "golive" && <Card title={`Checklist de go-live (Ap. F) — ${feitos}/${GOLIVE.length} com evidência`}>
        <p className="mb-2 text-xs text-slate-600">Nada de dado real antes do GO formal (decisão nº 8). Cada item só é marcado com a evidência arquivada (link, ata ou relatório); a trilha registra quem e quando.</p>
        {(["F.1", "F.2", "F.3"] as const).map(sec => { const xs = GOLIVE.filter(g => g[1] === sec); const ok = xs.filter(g => golive.find(x => x.chave === g[0])?.feito).length; return <div key={sec} className="mb-3"><h3 className="text-sm font-semibold text-navy">{sec === "F.1" ? "F.1 · Antes do GO (evidências obrigatórias)" : sec === "F.2" ? "F.2 · Carga de dados reais (na ordem)" : "F.3 · Primeiras 4 semanas (operação assistida)"} <span className="text-xs font-normal text-slate-500">· {ok}/{xs.length}</span></h3>
          <ul className="mt-1 divide-y divide-line text-sm">{xs.map(([chave, , texto]) => { const g = golive.find(x => x.chave === chave); return <li key={chave} id={chave} className="flex flex-wrap items-center gap-2 py-1.5"><span aria-hidden className={`flex h-5 w-5 items-center justify-center rounded border text-xs ${g?.feito ? "border-ok bg-ok text-white" : "border-slate-300 bg-white"}`}>{g?.feito ? "✓" : ""}</span><span className="min-w-0 flex-1">{texto}{g?.evidencia && <span className="block text-[11px] text-slate-500">evidência: {g.evidencia}{g.responsavel ? ` · resp. ${g.responsavel}` : ""} · {g.user_nome ?? "—"} em {fmtDataHora(g.updated_at)}</span>}</span>
            {conduz && <Modal label={g?.feito ? "Reabrir/editar" : "Marcar feito"} kind={g?.feito ? "ghost" : "primary"} title={texto}><form action={marcarGoLive} className="space-y-2"><input type="hidden" name="chave" value={chave} /><label className="block text-xs">Evidência (link, ata, relatório)<Input name="evidencia" defaultValue={g?.evidencia ?? ""} /></label><label className="block text-xs">Responsável<Input name="responsavel" defaultValue={g?.responsavel ?? ""} /></label><div className="flex gap-2"><Btn small name="feito" value="1">Feito, com evidência</Btn>{g?.feito && <Btn small kind="ghost" name="feito" value="0">Reabrir</Btn>}</div></form></Modal>}</li>; })}</ul></div>; })}
      </Card>}

      {aba === "notificacoes" && <Card title="Catálogo oficial de notificações (Ap. J)">
        <p className="mb-2 text-xs text-slate-600">O sino agrupa sempre que houver mais de 3 do mesmo tipo. Notificação nova fora deste catálogo entra por CRQ.</p>
        <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="bg-mist text-xs text-slate-600"><tr><th className="px-2 py-1.5 text-left font-medium">Gatilho</th><th className="px-2 py-1.5 text-left font-medium">Destinatário</th><th className="px-2 py-1.5 text-left font-medium">Canal</th><th className="px-2 py-1.5 text-left font-medium">Estado</th><th className="px-2 py-1.5 text-left font-medium">Onde</th></tr></thead>
          <tbody className="divide-y divide-line">{NOTIFICACOES_OBRA.map(n => <tr key={n[0]}><td className="px-2 py-1.5">{n[0]}</td><td className="px-2 py-1.5 text-xs">{n[1]}</td><td className="px-2 py-1.5 text-xs">{n[2]}</td><td className="px-2 py-1.5"><Estado e={n[3]} /></td><td className="px-2 py-1.5 text-xs">{n[4]}</td></tr>)}</tbody></table></div>
      </Card>}
    </Page>
  );
}
