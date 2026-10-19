import Link from "@/components/Link";
import { requireGestao, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Btn } from "@/components/ui";
import { Situacao as Selo, COR } from "@/components/graficos";
import { okrs, SAUDE, CONFIANCA, ATIVOS_PROJ } from "@/lib/estrategia";
import { identidadeAtual } from "@/lib/gestao-estrategica";
import { getSettings, hoje } from "@/lib/utils";
import { SubNav } from "../_ui";

export const dynamic = "force-dynamic";

const Barra = ({ p, cor }: { p: number | null; cor?: string }) => <span className="relative inline-block h-2 w-24 shrink-0 rounded bg-mist align-middle" title={p === null ? "sem medição" : `${p}%`}>{p !== null && <span className="absolute inset-y-0 left-0 rounded" style={{ width: `${Math.max(2, Math.min(100, p))}%`, background: cor ?? (p >= 70 ? COR.ok : p >= 40 ? COR.aviso : COR.erro) }} />}</span>;

/**
 * Árvore de alinhamento: da missão e da visão às perspectivas do mapa, objetivos, resultados-chave, projetos e ações do dia a dia.
 * Mostra também o que está solto — projetos sem objetivo e ações sem vínculo — para a gestão alinhar.
 */
export default async function Alinhamento() {
  const s = await requireGestao(); const u = scopeUnit(s); const cfg = await getSettings(); const ciclo = cfg.estrategia.cicloAtual as string; const h = hoje();
  const [ident, o, projetos, acoes] = await Promise.all([
    identidadeAtual(), okrs(ciclo, u),
    sql<{ id: number; nome: string; status: string; saude: string; objective_id: number | null; owner: string | null }[]>`SELECT p.id, p.nome, p.status, p.saude, p.objective_id, us.nome AS owner FROM projects p LEFT JOIN users us ON us.id=p.owner_user_id WHERE p.status <> 'CANCELADO' ${u === null ? sql`` : sql`AND (p.unit_id IS NULL OR p.unit_id=${u})`} ORDER BY p.nome`,
    sql<{ objective_id: number | null; project_id: number | null; indicator_id: number | null; abertas: number; vencidas: number; concluidas: number }[]>`SELECT objective_id, project_id, indicator_id, count(*) FILTER (WHERE status IN ('A_FAZER','EM_ANDAMENTO','BLOQUEADA'))::int AS abertas, count(*) FILTER (WHERE status IN ('A_FAZER','EM_ANDAMENTO') AND prazo < ${h})::int AS vencidas, count(*) FILTER (WHERE status='CONCLUIDA')::int AS concluidas FROM action_plans WHERE status <> 'CANCELADA' ${u === null ? sql`` : sql`AND (unit_id IS NULL OR unit_id=${u})`} GROUP BY 1, 2, 3`,
  ]);
  const vig = ident.vigente; const perspectivas = cfg.estrategia.perspectivas as { chave: string; nome: string; descricao: string }[];
  const ativos = o.objetivos.filter(x => x.status === "ATIVO");
  const persp = (ob: typeof ativos[number]) => ob.perspectiva ?? (cfg.estrategia.perspectivaDoPilar as Record<string, string>)[ob.pilar ?? ""] ?? "OUTRAS";
  const acoesDe = (f: (a: typeof acoes[number]) => boolean) => acoes.filter(f).reduce((x, a) => ({ abertas: x.abertas + a.abertas, vencidas: x.vencidas + a.vencidas, concluidas: x.concluidas + a.concluidas }), { abertas: 0, vencidas: 0, concluidas: 0 });
  const ResumoAcoes = ({ r, href }: { r: { abertas: number; vencidas: number; concluidas: number }; href: string }) => r.abertas + r.concluidas === 0 ? <span className="text-[11px] text-slate-400">sem ações</span> : <Link href={href} className="text-[11px] text-slate-600 hover:underline">{r.abertas} ação(ões) aberta(s){r.vencidas ? <b className="text-erro"> · {r.vencidas} vencida(s)</b> : null} · {r.concluidas} concluída(s)</Link>;
  const soltos = projetos.filter(p => !p.objective_id && ATIVOS_PROJ.includes(p.status));
  const acoesSoltas = acoesDe(a => !a.objective_id && !a.project_id && !a.indicator_id);
  const grupos = [...perspectivas.map(p => ({ chave: p.chave, nome: p.nome, descricao: p.descricao })), { chave: "OUTRAS", nome: "Sem perspectiva", descricao: "" }].map(g => ({ ...g, objetivos: ativos.filter(ob => persp(ob) === g.chave) })).filter(g => g.objetivos.length);
  return (
    <Page title="Alinhamento estratégico" sub={`Ciclo ${ciclo}: da missão às ações de cada dia. Progresso do objetivo = média dos seus resultados-chave.`} actions={<div className="flex flex-wrap gap-2 print:hidden"><Btn kind="ghost" href="/estrategia/okrs">OKRs</Btn><Btn kind="ghost" href="/estrategia/mapa">Mapa estratégico</Btn></div>}>
      <SubNav atual="alinhamento" />
      <Card className="mb-4">
        {vig ? <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2"><div><div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Missão</div><p className="text-ink">{vig.missao ?? "—"}</p></div><div><div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Visão</div><p className="text-ink">{vig.visao ?? "—"}</p></div>{vig.valores?.length ? <div className="md:col-span-2"><div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Valores</div><p className="text-ink">{vig.valores.map(v => v.nome).join(" · ")}</p></div> : null}</div>
          : <p className="text-sm text-slate-600">A identidade institucional ainda não foi publicada. <Link className="text-acao underline" href="/estrategia/identidade">Publicar missão, visão e valores</Link>.</p>}
        <p className="mt-3 border-t border-line pt-2 text-sm">Progresso do ciclo: <Barra p={o.progressoCiclo} /> <b>{o.progressoCiclo === null ? "—" : `${o.progressoCiclo}%`}</b> · {ativos.length} objetivo(s) · {o.totalKRs} resultado(s)-chave{o.krsSemMedicao ? <span className="text-aviso"> · {o.krsSemMedicao} sem medição</span> : null}</p>
      </Card>
      {grupos.length === 0 && <Card><p className="text-sm text-slate-600">Nenhum objetivo ativo no ciclo {ciclo}. <Link className="text-acao underline" href="/estrategia/okrs">Cadastrar OKRs</Link>.</p></Card>}
      <div className="space-y-4">
        {grupos.map(g => (
          <section key={g.chave} aria-label={g.nome}>
            <h2 className="mb-2 flex flex-wrap items-baseline gap-2 text-sm font-semibold text-navy">{g.nome}<span className="text-xs font-normal text-slate-500">{g.descricao}</span></h2>
            <ol className="space-y-3 border-l-2 border-sky-200 pl-4">
              {g.objetivos.map(ob => { const prjs = projetos.filter(p => p.objective_id === ob.id); const ra = acoesDe(a => a.objective_id === ob.id); return (
                <li key={ob.id} className="relative rounded-md border border-line bg-white p-3 before:absolute before:-left-[18px] before:top-5 before:h-0.5 before:w-4 before:bg-sky-200">
                  <div className="flex flex-wrap items-center justify-between gap-2"><Link href={`/estrategia/okrs/${ob.id}`} className="font-semibold text-acao hover:underline">{ob.titulo}</Link><span className="flex items-center gap-2 text-xs"><Barra p={ob.progresso} /><b className="tabular-nums">{ob.progresso === null ? "—" : `${ob.progresso}%`}</b></span></div>
                  <div className="text-[11px] text-slate-500">{[ob.pilar, ob.owner ? `dono: ${ob.owner}` : null, ob.unidade ?? "rede"].filter(Boolean).join(" · ")}</div>
                  {ob.krs.length > 0 && <ul className="mt-2 space-y-1 border-l border-line pl-3">{ob.krs.map(k => <li key={k.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs"><span className="min-w-0 flex-1">{k.titulo}{k.fonte?.startsWith("SISTEMA:") && <span className="ml-1 text-[10px] text-acao">automático</span>}</span><span className="flex items-center gap-2"><Barra p={k.progresso} /><span className={`w-20 whitespace-nowrap text-right tabular-nums ${k.progresso === null ? "text-[11px] text-slate-400" : ""}`}>{k.progresso === null ? "sem medição" : `${k.progresso}%`}</span>{k.confianca ? <Selo tom={k.confianca === 3 ? "bom" : k.confianca === 2 ? "atencao" : "ruim"} texto={`confiança ${CONFIANCA[k.confianca]}`} /> : null}</span></li>)}</ul>}
                  <div className="mt-2 grid grid-cols-1 gap-2 border-t border-line pt-2 sm:grid-cols-2">
                    <div><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Projetos</div>{prjs.length === 0 ? <span className="text-[11px] text-slate-400">nenhum projeto ligado</span> : <ul className="space-y-0.5">{prjs.map(p => { const rp = acoesDe(a => a.project_id === p.id); return <li key={p.id} className="text-xs"><span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: p.status === "CONCLUIDO" ? COR.neutro : p.saude === "VERMELHO" ? COR.erro : p.saude === "AMARELO" ? COR.aviso : COR.ok }} /><Link href={`/estrategia/projetos/${p.id}`} className="text-acao hover:underline">{p.nome}</Link> <span className="text-slate-400">{p.status === "CONCLUIDO" ? "concluído" : SAUDE[p.saude]}</span>{rp.abertas + rp.concluidas > 0 && <span className="block pl-3"><ResumoAcoes r={rp} href={`/estrategia/projetos/${p.id}`} /></span>}</li>; })}</ul>}</div>
                    <div><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Ações ligadas ao objetivo</div><ResumoAcoes r={ra} href={`/estrategia/okrs/${ob.id}`} /></div>
                  </div>
                </li>); })}
            </ol>
          </section>
        ))}
      </div>
      {(soltos.length > 0 || acoesSoltas.abertas > 0) && <Card title="O que ainda está solto" className="mt-4">
        {soltos.length > 0 && <p className="text-sm"><b>{soltos.length} projeto(s) ativo(s) sem objetivo:</b> {soltos.map((p, i) => <span key={p.id}>{i ? ", " : ""}<Link href={`/estrategia/projetos/${p.id}`} className="text-acao hover:underline">{p.nome}</Link></span>)}.</p>}
        {acoesSoltas.abertas > 0 && <p className="mt-1 text-sm"><b>{acoesSoltas.abertas} ação(ões) aberta(s)</b> sem objetivo, projeto ou indicador{acoesSoltas.vencidas ? <> — {acoesSoltas.vencidas} vencida(s)</> : null}. <Link href="/estrategia/acoes" className="text-acao hover:underline">Ver plano de ação</Link>.</p>}
        <p className="mt-2 text-xs text-slate-500">Ligar projetos e ações aos objetivos mostra para a equipe por que cada tarefa importa — e deixa o progresso do ciclo mais fiel.</p>
      </Card>}
    </Page>
  );
}
