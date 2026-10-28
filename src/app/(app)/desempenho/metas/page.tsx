import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { requireStaff, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Stat, Select, Btn, Badge } from "@/components/ui";
import { BarrasH, corSerie, COR } from "@/components/graficos";
import { getSettings, hoje, fmtData, addDays } from "@/lib/utils";
import { interpretarMeta, TIPO_META } from "@/lib/avaliacao";

export const dynamic = "force-dynamic";
const pctTxt = (v: number | null) => (v === null ? "—" : `${Math.round(v)}%`);

/**
 * v30 · Painel de metas (no estilo dos analytics de metas): quantas metas por tipo, o andamento pela regra declarada (nunca
 * “resultado ÷ meta” automático), as que precisam de atualização, quem tem metas e quantas estão ligadas à estratégia.
 */
export default async function PainelMetas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); if (!["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR", "LEITURA"].includes(s.role)) redirect("/desempenho");
  const sp = await searchParams; const u = scopeUnit(s); const h = hoje(); const cfg = await getSettings(); const dias = Number(cfg.desempenho.metaSemAtualizacaoDias) || 30;
  const ciclos = await sql<{ id: number; nome: string; fase: string }[]>`SELECT id, nome, fase FROM perf_cycles ORDER BY (fase NOT IN ('CONCLUSAO','ARQUIVADO')) DESC, fim DESC, id DESC LIMIT 20`;
  const cid = sp.ciclo ? Number(sp.ciclo) : ciclos[0]?.id ?? null; const ciclo = ciclos.find(c => c.id === cid);
  const soEquipe = s.role === "GESTOR" ? s.employeeId ?? -1 : null;
  const metas = cid ? await sql<{ id: number; employee_id: number; nome: string; unidade: string; titulo: string; tipo: string; direcao: string; linha_base: number | null; esperado: number | null; faixa_min: number | null; faixa_max: number | null; valor_atual: number | null; marcos: { titulo: string; feito: boolean }[] | null; conversao: { ate: number; nota: number }[] | null; conv_ok: boolean; prazo: string | null; status: string; atualizada: string; objective_id: number | null; key_result_id: number | null; objetivo: string | null }[]>`
    SELECT g.id, g.employee_id, e.nome, un.nome AS unidade, g.titulo, g.tipo, g.direcao, g.linha_base::float, g.esperado::float, g.faixa_min::float, g.faixa_max::float, g.valor_atual::float, g.marcos, g.conversao, (g.conversao_aprovada_em IS NOT NULL) AS conv_ok, g.prazo::text, g.status,
      coalesce(g.atualizada_em, g.created_at)::date::text AS atualizada, g.objective_id, g.key_result_id, coalesce(o.titulo, ok.titulo) AS objetivo
    FROM perf_goals g JOIN employees e ON e.id=g.employee_id JOIN units un ON un.id=e.unit_id LEFT JOIN objectives o ON o.id=g.objective_id LEFT JOIN key_results k ON k.id=g.key_result_id LEFT JOIN objectives ok ON ok.id=k.objective_id
    WHERE g.cycle_id=${cid} ${u === null ? sql`` : sql`AND e.unit_id=${u}`} ${soEquipe === null ? sql`` : sql`AND (e.gestor_id=${soEquipe} OR e.id=${soEquipe})`}` : [];
  const [{ pessoas }] = cid ? await sql<{ pessoas: number }[]>`SELECT count(DISTINCT r.employee_id)::int AS pessoas FROM perf_reviews r JOIN employees e ON e.id=r.employee_id WHERE r.cycle_id=${cid} ${u === null ? sql`` : sql`AND e.unit_id=${u}`} ${soEquipe === null ? sql`` : sql`AND (e.gestor_id=${soEquipe} OR e.id=${soEquipe})`}` : [{ pessoas: 0 }];
  const ativo = !!ciclo && !["CONCLUSAO", "ARQUIVADO"].includes(ciclo.fase); const limite = addDays(h, -dias);
  const lidas = metas.map(m => { const it = interpretarMeta({ tipo: m.tipo, direcao: m.direcao, linhaBase: m.linha_base, esperado: m.esperado, faixaMin: m.faixa_min, faixaMax: m.faixa_max, valorAtual: m.valor_atual, marcos: m.marcos, conversao: m.conversao, conversaoAprovada: m.conv_ok });
    const atingida = m.status === "ATINGIDA" || (it.progresso !== null && it.progresso >= 100);
    return { ...m, progresso: it.progresso === null ? null : Math.max(0, Math.min(150, it.progresso)), situacao: it.situacao, atingida, desatualizada: ativo && !atingida && m.atualizada < limite, atrasada: !atingida && !!m.prazo && m.prazo < h, ligada: !!(m.objective_id || m.key_result_id) }; });
  const media = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const tipos = Object.keys(TIPO_META).map(t => { const xs = lidas.filter(m => m.tipo === t); return { tipo: t, n: xs.length, progresso: media(xs.map(x => x.progresso)), desatualizadas: xs.filter(x => x.desatualizada).length }; });
  const comMeta = new Set(lidas.map(m => m.employee_id)).size;
  const porUnidade = [...new Set(lidas.map(m => m.unidade))].sort().map(un => { const xs = lidas.filter(m => m.unidade === un); return { unidade: un, n: xs.length, progresso: media(xs.map(x => x.progresso)), desatualizadas: xs.filter(x => x.desatualizada).length, ligadas: xs.filter(x => x.ligada).length }; });
  const porObjetivo = [...new Set(lidas.filter(m => m.objetivo).map(m => m.objetivo!))].map(o => ({ o, n: lidas.filter(m => m.objetivo === o).length })).sort((a, b) => b.n - a.n);
  const desat = lidas.filter(m => m.desatualizada).sort((a, b) => a.atualizada.localeCompare(b.atualizada));
  return (
    <Page title="Painel de metas" sub={<>Metas do ciclo pela regra declarada de cada uma — quantas, como andam, quais precisam de atualização e o alinhamento à estratégia{soEquipe !== null ? " · sua equipe" : u !== null ? " · sua unidade" : " · rede"}. <Link className="text-acao" href="/desempenho">Desempenho</Link></>}
      actions={<form className="flex items-end gap-1"><Select name="ciclo" defaultValue={cid ?? ""} aria-label="Ciclo" className="!w-56">{ciclos.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select><Btn small kind="ghost">Ver</Btn></form>}>
      {!cid ? <Card><p className="text-sm text-slate-500">Nenhum ciclo de desempenho ainda.</p></Card> : <>
        <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-5">
          <Stat label="Metas" value={lidas.length} hint={`${comMeta} pessoa(s) com meta`} />
          <Stat label="Andamento médio" value={pctTxt(media(lidas.map(x => x.progresso)))} hint="pela regra de leitura de cada meta" />
          <Stat label="Precisam de atualização" value={<span className={desat.length ? "text-aviso" : ""}>{desat.length}</span>} hint={`sem andamento há mais de ${dias} dias`} />
          <Stat label="Pessoas com metas" value={pessoas ? `${Math.round((100 * comMeta) / pessoas)}%` : "—"} hint={`${comMeta} de ${pessoas} no ciclo · ${comMeta ? (lidas.length / comMeta).toFixed(1).replace(".", ",") : "0"} meta(s) por pessoa`} />
          <Stat label="Ligadas à estratégia" value={lidas.length ? `${Math.round((100 * lidas.filter(x => x.ligada).length) / lidas.length)}%` : "—"} hint="contribuem para um objetivo ou resultado-chave" />
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
          <Card title="Por tipo de meta">
            <Table head={["Tipo", "Metas", "Andamento médio", "Precisam de atualização"]}>{tipos.map(t => <tr key={t.tipo}><Td>{TIPO_META[t.tipo]}</Td><Td className="tabular-nums">{t.n}</Td><Td className="tabular-nums">{t.n ? pctTxt(t.progresso) : "—"}</Td><Td className={`tabular-nums ${t.desatualizadas ? "text-aviso" : ""}`}>{t.desatualizadas}</Td></tr>)}</Table>
            <p className="mt-2 text-[11px] text-slate-500">Exploratória, de aprendizagem e coletiva não viram nota individual (regra do ciclo); o andamento aqui é só acompanhamento.</p>
          </Card>
          <Card title="Por unidade">
            <BarrasH rotulo="Andamento médio das metas por unidade" formato={v => `${Math.round(v)}%`} max={100} itens={porUnidade.map((x, i) => ({ rotulo: x.unidade, valor: x.progresso, cor: corSerie(i), sub: `${x.n} meta(s) · ${x.desatualizadas} sem atualização · ${x.ligadas} ligadas à estratégia` }))} />
          </Card>
          <Card title="Alinhamento à estratégia">
            {porObjetivo.length === 0 ? <p className="text-sm text-slate-500">Nenhuma meta ligada a objetivo ou resultado-chave neste ciclo. Na meta, use “Contribui para (estratégia)”.</p> : <BarrasH rotulo="Metas por objetivo estratégico" formato={v => String(v)} itens={porObjetivo.map(x => ({ rotulo: x.o, valor: x.n, cor: COR.acao }))} />}
          </Card>
          <Card title={`Precisam de atualização (${desat.length})`}>
            <Table head={["Pessoa", "Meta", "Última atualização"]} empty="Todas as metas atualizadas. 👍">{desat.slice(0, 20).map(m => <tr key={m.id}><Td><Link className="text-acao" href={`/colaboradores/${m.employee_id}/painel?aba=metas`}>{m.nome}</Link><div className="text-[11px] text-slate-500">{m.unidade}</div></Td><Td className="text-xs">{m.titulo}{m.atrasada && <div><Badge v="VENCIDO" label="prazo vencido" /></div>}</Td><Td className="text-xs">{fmtData(m.atualizada)}</Td></tr>)}</Table>
            {desat.length > 20 && <p className="mt-1 text-xs text-slate-500">+ {desat.length - 20} outras.</p>}
          </Card>
        </div>
      </>}
    </Page>
  );
}
