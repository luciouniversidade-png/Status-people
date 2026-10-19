import Link from "@/components/Link";
import { requireGestao, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Flash, Field, Input, Btn } from "@/components/ui";
import { KpiCard, BarrasH, Colunas, Rosca, COR } from "@/components/graficos";
import { Quadro, type ColunaQuadro, type CartaoQuadro } from "@/components/Quadro";
import { fmtData, hoje, addDays } from "@/lib/utils";
import { listarAcoes, type AcaoRow } from "@/lib/gestao-estrategica";
import { fmtReais } from "@/lib/formato";
import { SubNav } from "../../_ui";
import { MoverAcao, podeMexerAcao } from "../_form";

export const dynamic = "force-dynamic";

/** Plano de ação em quadro (kanban): a fazer → em andamento → bloqueada → concluída, com carga por responsável e o que vence na semana. */
export default async function QuadroAcoes({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireGestao(); const sp = await searchParams; const u = scopeUnit(s); const h = hoje();
  const minhas = sp.minhas === "1"; const q = sp.q?.trim() || null;
  const [abertas, concluidas, semanas] = await Promise.all([
    listarAcoes(u, { situacao: "ABERTAS", responsavel: minhas ? s.id : null, q }),
    listarAcoes(u, { situacao: "CONCLUIDA", responsavel: minhas ? s.id : null, q, concluidasDesde: addDays(h, -30) }),
    sql<{ semana: string; n: number }[]>`SELECT to_char(date_trunc('week', concluida_em), 'YYYY-MM-DD') AS semana, count(*)::int AS n FROM action_plans WHERE status='CONCLUIDA' AND concluida_em >= ${addDays(h, -84)}::date ${u === null ? sql`` : sql`AND (unit_id IS NULL OR unit_id=${u})`} ${minhas ? sql`AND responsavel_user_id=${s.id}` : sql``} GROUP BY 1`,
  ]);
  const voltar = `/estrategia/acoes/quadro${minhas || q ? `?${new URLSearchParams({ ...(minhas ? { minhas: "1" } : {}), ...(q ? { q } : {}) })}` : ""}`;
  const em7 = addDays(h, 7);
  const cartao = (a: AcaoRow): CartaoQuadro => {
    const proximo = !a.vencida && a.prazo && a.prazo <= addDays(h, 3) && ["A_FAZER", "EM_ANDAMENTO"].includes(a.status);
    return {
      chave: String(a.id), titulo: a.titulo, href: `/estrategia/acoes/${a.id}`, responsavel: a.responsavel,
      linhas: [[a.unidade ?? "Rede", a.local].filter(Boolean).join(" · "), a.objetivo ? `Objetivo: ${a.objetivo}` : a.projeto ? `Projeto: ${a.projeto}` : a.indicador ? `Indicador: ${a.indicador}` : a.ritual ? `Reunião: ${a.ritual}` : null],
      selos: [
        ...(a.vencida ? [{ texto: `vencida há ${a.dias_atraso} dia(s)`, tom: "ruim" as const }] : a.status === "CONCLUIDA" ? [{ texto: `concluída ${fmtData(a.concluida_em)}`, tom: "bom" as const }] : a.prazo ? [{ texto: `prazo ${fmtData(a.prazo)}`, tom: proximo ? "atencao" as const : "neutro" as const }] : [{ texto: "sem prazo", tom: "neutro" as const }]),
        ...(a.status === "BLOQUEADA" && a.bloqueio_desde ? [{ texto: `bloqueada desde ${fmtData(a.bloqueio_desde)}`, tom: "atencao" as const }] : []),
        ...(a.custo_previsto ? [{ texto: fmtReais(a.custo_previsto, true), tom: "neutro" as const }] : []),
      ],
      rodape: a.status === "BLOQUEADA" && a.bloqueio ? `Aguarda: ${a.bloqueio}` : undefined,
      acoes: podeMexerAcao(s, a) && a.status !== "CONCLUIDA" ? <MoverAcao a={a} voltar={voltar} /> : undefined,
      destaque: a.vencida ? "ruim" : a.status === "BLOQUEADA" || proximo ? "atencao" : a.status === "CONCLUIDA" ? "bom" : null,
    };
  };
  const por = (st: string) => abertas.filter(a => a.status === st);
  const colunas: ColunaQuadro[] = [
    { chave: "A_FAZER", titulo: "A fazer", cor: "#94a3b8", itens: por("A_FAZER").map(cartao), descricao: `${por("A_FAZER").filter(a => a.vencida).length} vencida(s)` },
    { chave: "EM_ANDAMENTO", titulo: "Em andamento", cor: COR.acao, itens: por("EM_ANDAMENTO").map(cartao), descricao: `${por("EM_ANDAMENTO").filter(a => a.vencida).length} vencida(s)` },
    { chave: "BLOQUEADA", titulo: "Bloqueada (aguarda apoio)", cor: COR.aviso, itens: por("BLOQUEADA").map(cartao) },
    { chave: "CONCLUIDA", titulo: "Concluída (30 dias)", cor: COR.ok, itens: concluidas.map(cartao), mais: { texto: "ver todas", href: "/estrategia/acoes?situacao=CONCLUIDA" } },
  ];
  const vencidas = abertas.filter(a => a.vencida); const semana = abertas.filter(a => !a.vencida && a.prazo && a.prazo >= h && a.prazo <= em7 && a.status !== "BLOQUEADA");
  const carga = new Map<string, { af: number; ea: number; bl: number; ve: number }>();
  for (const a of abertas) { const k = a.responsavel ?? "Sem responsável"; const x = carga.get(k) ?? { af: 0, ea: 0, bl: 0, ve: 0 }; if (a.vencida) x.ve++; else if (a.status === "A_FAZER") x.af++; else if (a.status === "EM_ANDAMENTO") x.ea++; else x.bl++; carga.set(k, x); }
  const segundas = Array.from({ length: 12 }, (_, i) => { const d = new Date(`${h}T12:00:00Z`); const dow = (d.getUTCDay() + 6) % 7; return addDays(addDays(h, -dow), -7 * (11 - i)); });
  return (
    <Page title="Plano de ação — quadro" sub="As mesmas ações do plano, por situação. Iniciar, concluir (com evidência) e bloquear direto no cartão; vencida = passou do prazo sem estar bloqueada."
      actions={<div className="flex flex-wrap gap-2 print:hidden"><Btn kind="ghost" href="/estrategia/acoes">Ver em lista</Btn><Btn kind="ghost" href="/estrategia/cronograma">Cronograma</Btn></div>}>
      <SubNav atual="quadro" />
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard titulo="Total (abertas + concluídas em 30 dias)" valor={String(abertas.length + concluidas.length)} />
        <KpiCard titulo="Concluídas em 30 dias" valor={String(concluidas.length)} tom="bom" />
        <KpiCard titulo="Em aberto" valor={String(abertas.length)} />
        <KpiCard titulo="Vencidas" valor={String(vencidas.length)} tom={vencidas.length ? "ruim" : "bom"} href="/estrategia/acoes?situacao=VENCIDAS" />
        <KpiCard titulo="Bloqueadas" valor={String(por("BLOQUEADA").length)} tom={por("BLOQUEADA").length ? "atencao" : "neutro"} href="/estrategia/acoes?situacao=BLOQUEADA" />
        <KpiCard titulo="Vencem em 7 dias" valor={String(semana.length)} tom={semana.length ? "atencao" : "neutro"} />
      </div>
      <form className="mb-3 flex flex-wrap items-end gap-2 print:hidden">
        <Field label="Buscar"><Input name="q" defaultValue={q ?? ""} placeholder="ação, motivo ou origem" /></Field>
        <label className="flex items-center gap-1.5 pb-2 text-xs"><input type="checkbox" name="minhas" value="1" defaultChecked={minhas} /> só as minhas</label>
        <Btn kind="ghost">Filtrar</Btn>
      </form>
      <Quadro rotulo="Quadro do plano de ação" colunas={colunas} />
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Carga por responsável (abertas)">{carga.size === 0 ? <p className="text-sm text-slate-500">Nenhuma ação aberta.</p> : <BarrasH rotulo="Ações abertas por responsável" largRotulo="9rem" itens={[...carga.entries()].sort((a, b) => (b[1].ve - a[1].ve) || (b[1].af + b[1].ea + b[1].bl + b[1].ve) - (a[1].af + a[1].ea + a[1].bl + a[1].ve)).slice(0, 10).map(([k, x]) => ({ chave: k, rotulo: k, valor: x.af + x.ea + x.bl + x.ve, texto: `${x.af + x.ea + x.bl + x.ve}${x.ve ? ` · ${x.ve} venc.` : ""}`, segmentos: [{ valor: x.af, cor: "#94a3b8", rotulo: "A fazer" }, { valor: x.ea, cor: COR.acao, rotulo: "Em andamento" }, { valor: x.bl, cor: COR.aviso, rotulo: "Bloqueada" }, { valor: x.ve, cor: COR.erro, rotulo: "Vencida" }] }))} formato={x => String(x)} />}</Card>
        <Card title="Concluídas por semana (12 semanas)"><Colunas categorias={segundas.map(d => fmtData(d).slice(0, 5))} series={[{ nome: "Concluídas", valores: segundas.map(d => semanas.find(x => x.semana === d)?.n ?? 0), cor: COR.ok }]} rotulo="Ações concluídas por semana" tamanho="terco" /></Card>
        <Card title="Situação das abertas"><Rosca rotulo="Ações abertas por situação" fatias={[{ rotulo: "A fazer (no prazo)", valor: por("A_FAZER").filter(a => !a.vencida).length, cor: "#94a3b8" }, { rotulo: "Em andamento (no prazo)", valor: por("EM_ANDAMENTO").filter(a => !a.vencida).length, cor: COR.acao }, { rotulo: "Bloqueadas", valor: por("BLOQUEADA").length, cor: COR.aviso }, { rotulo: "Vencidas", valor: vencidas.length, cor: COR.erro }]} centro={{ valor: String(abertas.length), rotulo: "abertas" }} tamanho={120} /></Card>
      </div>
      <Card title={`Vencem nos próximos 7 dias (${semana.length})`} className="mt-4">
        {semana.length === 0 ? <p className="text-sm text-slate-500">Nenhuma ação vence nos próximos 7 dias.</p> : <ul className="divide-y divide-line">{semana.sort((a, b) => (a.prazo ?? "").localeCompare(b.prazo ?? "")).map(a => <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><Link href={`/estrategia/acoes/${a.id}`} className="min-w-0 truncate text-acao hover:underline">{a.titulo}</Link><span className="text-xs text-slate-500">{a.responsavel ?? "—"} · {fmtData(a.prazo)}</span></li>)}</ul>}
      </Card>
    </Page>
  );
}
