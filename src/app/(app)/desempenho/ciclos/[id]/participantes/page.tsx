// v31 · Participantes do ciclo (360°): todos os pares avaliador › avaliado com progresso e situação, inclusão manual (com ⇄) e sugestão automática.
import Link from "@/components/Link";
import { notFound, redirect } from "next/navigation";
import { sql } from "@/db";
import { requireStaff, scopeUnit } from "@/lib/auth";
import { Page, Card, Flash, Field, Input, Select, Btn, Badge, Stat } from "@/components/ui";
import { ParAvaliador } from "@/components/ParAvaliador";
import { getSettings } from "@/lib/utils";
import { iniciais } from "@/lib/pessoas-v30";
import { paresDoCiclo, sugerirPares, RELACAO_360, COR_RELACAO, SIT_360 } from "@/lib/participantes360";
import { adicionarPar, removerPar, convidarSugeridos } from "../../../participantes-actions";
import { NavCiclo } from "../_nav";

export const dynamic = "force-dynamic";
const Av = ({ nome }: { nome: string }) => <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-mist text-[9px] font-semibold text-navy shadow-[0_0_0_1px_#dbe3ee]" aria-hidden>{iniciais(nome)}</span>;

export default async function Participantes({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); if (!["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR", "LEITURA"].includes(s.role)) redirect("/desempenho");
  const { id } = await params; const sp = await searchParams; const cid = Number(id); const cfg = await getSettings(); const u = scopeUnit(s);
  const [c] = await sql<{ id: number; nome: string; fase: string }[]>`SELECT id, nome, fase FROM perf_cycles WHERE id=${cid}`; if (!c) notFound();
  const soEquipe = s.role === "GESTOR" ? s.employeeId ?? -1 : null; const conduz = ["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role);
  const { pares, fontes } = await paresDoCiclo(cid, u, soEquipe);
  const q = (sp.q ?? "").trim().toLowerCase(); const rel = sp.relacao && RELACAO_360[sp.relacao] ? sp.relacao : ""; const sit = sp.situacao && SIT_360[sp.situacao] ? sp.situacao : "";
  const vis = pares.filter(p => (!q || p.avaliador.toLowerCase().includes(q) || p.avaliado.toLowerCase().includes(q)) && (!rel || p.relacao === rel) && (!sit || p.situacao === sit));
  const aberto = !["CONCLUSAO", "ARQUIVADO"].includes(c.fase); const gruposExt = Object.keys(fontes ?? {}).filter(k => k !== "GESTOR");
  const usuarios = aberto && gruposExt.length && (conduz || s.role === "GESTOR") ? await sql<{ id: number; nome: string; employee_id: number | null; extra: string }[]>`SELECT u.id, u.nome, u.employee_id, coalesce(un.nome, '') AS extra FROM users u LEFT JOIN employees e ON e.id=u.employee_id LEFT JOIN units un ON un.id=e.unit_id WHERE u.ativo AND u.employee_id IS NOT NULL ${u === null ? sql`` : sql`AND e.unit_id=${u}`} ORDER BY u.nome` : [];
  const avaliados = [...new Map(pares.filter(p => p.relacao === "GESTOR" && p.situacao !== "COMPLETA" && (conduz || p.avaliador_user_id === s.id)).map(p => [p.review_id, { review_id: p.review_id, employee_id: p.employee_id, nome: p.avaliado, extra: p.unidade ?? "" }])).values()];
  const sug = sp.sugerir === "1" && conduz && aberto ? await sugerirPares(cid, u, Number(cfg.desempenho.paresSugeridos) || 4, Number(cfg.desempenho.maxConvitesPorAvaliador) || 6) : [];
  const conta = (k: string) => pares.filter(p => p.situacao === k).length;
  const qs = (extra: Record<string, string>) => { const p = new URLSearchParams(Object.entries({ q: sp.q ?? "", relacao: rel, situacao: sit, ...extra }).filter(([, v]) => v)); const t = p.toString(); return `/desempenho/ciclos/${cid}/participantes${t ? `?${t}` : ""}`; };
  return (
    <Page title={`[360°] ${c.nome}`} sub={<>Quem avalia quem neste ciclo — autoavaliação, líder › liderado{gruposExt.includes("PAR") ? ", pares" : ""}{gruposExt.includes("LIDERADO") ? " e liderados avaliando o líder" : ""} — com o progresso de cada um. <Link className="text-acao" href="/desempenho">ciclos</Link></>}>
      <NavCiclo cid={cid} atual="/participantes" />
      <Flash ok={sp.ok} erro={sp.erro} />
      {gruposExt.length === 0 && <Card className="mb-4" title="Este ciclo avalia só com o gestor e a autoavaliação"><p className="text-sm text-slate-600">Pares e liderados (múltiplas fontes) são opcionais e ligados na página do ciclo, ainda no planejamento — com peso e mínimo de respondentes (nunca menos de 3, pelo anonimato). A lista abaixo mostra a autoavaliação e o líder › liderado de cada pessoa.</p></Card>}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Pares no ciclo" value={pares.length} hint={`avaliador › avaliado · ${new Set(pares.map(p => p.review_id)).size} avaliado(s)`} />
        {(["NAO_INICIADA", "ANDAMENTO", "ENVIADA", "COMPLETA"] as const).map(k => <Stat key={k} label={SIT_360[k].rotulo} value={conta(k)} href={qs({ situacao: k })} />)}
      </div>
      {sp.sugerir === "1" && aberto && gruposExt.length > 0 && conduz && <Card className="mb-4" title={`360° automático — pares sugeridos (${sug.length})`}>{sug.length === 0 ? <p className="text-sm text-slate-500">Nada a sugerir: todos já têm os pares do alvo, ou não há colegas com acesso ao ONE abaixo do teto de convites.</p> :
        <form action={convidarSugeridos} className="space-y-3"><input type="hidden" name="cycleId" value={cid} /><p className="text-sm text-slate-600">{sug.length} convite(s) sugerido(s) para {new Set(sug.map(x => x.review_id)).size} avaliado(s) — colegas com o mesmo gestor e da mesma área primeiro, sem passar de {cfg.desempenho.maxConvitesPorAvaliador} convites por pessoa. Desmarque o que não fizer sentido.</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">{[...new Set(sug.map(x => x.review_id))].map(rid => { const xs = sug.filter(x => x.review_id === rid); return <div key={rid} className="rounded-md border border-line p-2"><div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-navy"><Av nome={xs[0].avaliado} />{xs[0].avaliado}</div>{xs.map(x => <label key={`${x.user_id}${x.grupo}`} className="flex items-start gap-2 py-0.5 text-xs"><input type="checkbox" name="par" value={`${x.review_id}:${x.user_id}:${x.grupo}`} defaultChecked className="mt-0.5" /><span>{x.nome} <span className="text-slate-500">· {RELACAO_360[x.grupo]} · {x.porque}</span></span></label>)}</div>; })}</div>
          <div className="flex flex-wrap gap-2"><Btn small>Convidar os marcados</Btn><Btn small kind="ghost" href={qs({})}>Cancelar</Btn></div></form>}</Card>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <Card title={`Pares avaliador › avaliado (${vis.length})`} actions={(q || rel || sit) ? <Link className="text-xs text-acao" href={`/desempenho/ciclos/${cid}/participantes`}>limpar filtros</Link> : undefined}>
          <form className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_10rem_auto] sm:items-end"><Field label="Buscar"><Input name="q" defaultValue={sp.q ?? ""} placeholder="Nome de quem avalia ou de quem é avaliado" /></Field><Field label="Relação"><Select name="relacao" defaultValue={rel}><option value="">Todas</option>{Object.entries(RELACAO_360).filter(([k]) => ["AUTO", "GESTOR", ...gruposExt].includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Situação"><Select name="situacao" defaultValue={sit}><option value="">Todas</option>{Object.entries(SIT_360).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}</Select></Field><Btn small kind="ghost">Filtrar</Btn></form>
          {vis.length === 0 ? <p className="text-sm text-slate-500">Nenhum par com esses filtros.</p> : <ul className="divide-y divide-line">{vis.map(p => <li key={p.chave} className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[minmax(0,1fr)_10rem_7.5rem] sm:items-center sm:gap-3">
            <div className="min-w-0"><div className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm"><Av nome={p.avaliador} /><span className="font-medium text-ink">{p.avaliador}</span><span className="text-slate-400">→</span><Av nome={p.avaliado} /><Link className="font-medium text-acao" href={`/desempenho/avaliacoes/${p.review_id}`}>{p.avaliado}</Link></div>
              <div className={`mt-0.5 text-[11px] font-semibold ${COR_RELACAO[p.relacao]}`}>{RELACAO_360[p.relacao]}{p.motivo ? <span className="font-normal text-slate-500"> · {p.motivo}</span> : null}{p.unidade ? <span className="font-normal text-slate-500"> · {p.unidade}</span> : null}</div></div>
            <div className="flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded bg-mist"><div className="h-1.5 rounded bg-navy" style={{ width: `${p.progresso}%` }} /></div><span className="w-9 text-right text-xs tabular-nums text-slate-600">{p.progresso}%</span></div>
            <div className="flex items-center gap-2"><Badge v={SIT_360[p.situacao].tom} label={SIT_360[p.situacao].rotulo} />{p.removivel && p.rater_id && (conduz || avaliados.some(a => a.review_id === p.review_id)) && <form action={removerPar}><input type="hidden" name="cycleId" value={cid} /><input type="hidden" name="raterId" value={p.rater_id} /><button className="text-[11px] text-slate-400 hover:text-erro" title={`${p.avaliador} deixa de avaliar ${p.avaliado} (fica na auditoria)`}>remover</button></form>}</div>
          </li>)}</ul>}
          <p className="mt-2 text-[11px] text-slate-500">Progresso = critérios respondidos. As notas de pares e liderados só aparecem agregadas, por grupo, quando o grupo tem o mínimo de respondentes — ninguém vê a nota de um colega específico.</p>
        </Card>
        <div className="space-y-4">
          {aberto && gruposExt.length > 0 && avaliados.length > 0 && usuarios.length > 0 && <Card title="Adicionar um novo par avaliador › avaliado"><form action={adicionarPar} className="space-y-2"><input type="hidden" name="cycleId" value={cid} />
            <ParAvaliador usuarios={usuarios} avaliados={avaliados} />
            <Field label="Relação"><Select name="grupo" defaultValue={gruposExt[0]}>{gruposExt.map(g => <option key={g} value={g}>{RELACAO_360[g]}</option>)}</Select></Field>
            <Field label="Oportunidade de observação"><Input name="motivo" placeholder="Ex.: dividem a coordenação do 6º ano" /></Field>
            <Btn small>+ Adicionar</Btn><p className="text-[11px] text-slate-500">Teto de {cfg.desempenho.maxConvitesPorAvaliador} convites por avaliador no ciclo. Liderado › líder só para quem é da equipe direta.</p></form></Card>}
          {aberto && gruposExt.length > 0 && conduz && <Card title="360° automático">
            <p className="text-sm text-slate-600">Sugere {cfg.desempenho.paresSugeridos} pares para cada avaliado que ainda tem menos que isso (colegas com o mesmo gestor e da mesma área primeiro{gruposExt.includes("LIDERADO") ? "; e a equipe direta de cada líder" : ""}), sem passar do teto de convites. Você confere antes de convidar.</p>{sp.sugerir === "1" ? <p className="mt-2 text-xs font-medium text-acao">As sugestões estão no alto da página.</p> : <div className="mt-2"><Btn small kind="ghost" href={qs({ sugerir: "1" })}>Sugerir pares</Btn></div>}
          </Card>}
          <Card title="Por relação"><ul className="space-y-1 text-sm">{Object.entries(RELACAO_360).filter(([k]) => pares.some(p => p.relacao === k)).map(([k, v]) => { const xs = pares.filter(p => p.relacao === k); const ok = xs.filter(p => ["ENVIADA", "COMPLETA"].includes(p.situacao)).length; return <li key={k} className="flex justify-between gap-2"><Link className={`font-medium ${COR_RELACAO[k]}`} href={qs({ relacao: k })}>{v}</Link><span className="tabular-nums text-slate-600">{ok}/{xs.length} respondidos</span></li>; })}</ul></Card>
        </div>
      </div>
    </Page>
  );
}
