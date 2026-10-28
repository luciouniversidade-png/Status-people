import Link from "@/components/Link";
import { requireSession, scopeUnit, canSeeEmployee } from "@/lib/auth";
import { sql, db, schema } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Input, Select, Btn } from "@/components/ui";
import { arvorePessoas, iniciais, type NoPessoa } from "@/lib/pessoas-v30";
import { fmtData, hoje } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Pos = { id: number; nome: string; area: string; parentId: number | null; regulamentado: boolean };
const EQUIPE = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR", "LEITURA"];
const norm = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const tempoCasa = (adm: string, h: string) => { const m = (Number(h.slice(0, 4)) - Number(adm.slice(0, 4))) * 12 + (Number(h.slice(5, 7)) - Number(adm.slice(5, 7))) - (Number(h.slice(8, 10)) < Number(adm.slice(8, 10)) ? 1 : 0); if (m < 1) return "menos de 1 mês"; const a = Math.floor(m / 12), r = m % 12; return [a ? `${a} ano${a > 1 ? "s" : ""}` : "", r ? `${r} ${r > 1 ? "meses" : "mês"}` : ""].filter(Boolean).join(" e "); };

/**
 * v30 · Organograma de pessoas (quem responde a quem) e quem é quem — para todos, com o perfil público (nome, cargo, unidade, ramal e
 * e-mail institucional). A estrutura de cargos (a de sempre, com a ocupação) continua para as atuações de pessoas.
 */
export default async function Organograma({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams; const equipe = EQUIPE.includes(s.role);
  const ver = equipe && sp.ver === "cargos" ? "cargos" : "pessoas";
  const abas = <div className="mb-4 flex flex-wrap gap-2">{[["pessoas", "Pessoas — quem responde a quem"], ...(equipe ? [["cargos", "Cargos e ocupação"]] : [])].map(([k, r]) => <Link key={k} href={`/organograma${k === "cargos" ? "?ver=cargos" : ""}`} className={`rounded-full border px-3 py-1 text-xs font-medium ${ver === k ? "border-acao bg-acao text-white" : "border-line bg-white text-navy hover:bg-mist"}`}>{r}</Link>)}</div>;
  if (ver === "cargos") return <Cargos s={s} abas={abas} />;

  const h = hoje(); const unidade = sp.u ? Number(sp.u) : null; const q = (sp.q ?? "").trim();
  const [rows, units] = await Promise.all([
    sql<{ id: number; nome: string; cargo: string | null; area: string | null; familia: string | null; unidade: string; unit_id: number; gestor_id: number | null; admissao: string; ramal: string | null; email_inst: string | null; no_diretorio: boolean }[]>`
      SELECT e.id, e.nome, p.nome AS cargo, p.area, p.familia, u.nome AS unidade, e.unit_id, e.gestor_id, e.admissao::text, e.ramal, e.email_institucional AS email_inst, e.no_diretorio
      FROM employees e JOIN units u ON u.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id WHERE e.situacao <> 'DESLIGADO' ORDER BY e.nome`,
    db.select({ id: schema.units.id, nome: schema.units.nome }).from(schema.units).orderBy(asc(schema.units.nome)),
  ]);
  const todos: (NoPessoa & { area: string | null })[] = rows.map(r => ({ id: r.id, nome: r.nome, cargo: r.cargo, area: r.area, unidade: r.unidade, unitId: r.unit_id, gestorId: r.gestor_id, familia: r.familia, admissao: r.admissao, ramal: r.ramal, emailInst: r.email_inst, noDiretorio: r.no_diretorio }));
  const arv = arvorePessoas(todos);
  const sel = sp.p ? todos.find(t => t.id === Number(sp.p)) ?? null : null;
  const gestores = todos.filter(t => arv.diretos(t.id) > 0); const amplitude = gestores.length ? gestores.reduce((n, g) => n + arv.diretos(g.id), 0) / gestores.length : null;
  const semGestor = todos.filter(t => !t.gestorId).length;
  const busca = q ? todos.filter(t => [t.nome, t.cargo ?? "", t.area ?? "", t.unidade, t.ramal ?? ""].some(v => norm(v).includes(norm(q)))) : [];
  const cadeia = (t: NoPessoa) => { const out: NoPessoa[] = []; let g = t.gestorId ? todos.find(x => x.id === t.gestorId) : undefined; const vistos = new Set<number>(); while (g && !vistos.has(g.id) && out.length < 8) { vistos.add(g.id); out.unshift(g); g = g.gestorId ? todos.find(x => x.id === g!.gestorId) : undefined; } return out; };
  // com unidade escolhida, mostra quem é da unidade e a cadeia de gestores acima deles (para a árvore não quebrar)
  const manter = new Set<number>(); if (unidade !== null) for (const t of todos.filter(x => x.unitId === unidade)) { manter.add(t.id); for (const g of cadeia(t)) manter.add(g.id); }
  const naUnidade = (t: NoPessoa) => unidade === null || manter.has(t.id);
  const link = (id: number) => `/organograma?${new URLSearchParams({ ...(q ? { q } : {}), ...(unidade !== null ? { u: String(unidade) } : {}), p: String(id) }).toString()}#pessoa`;

  const Cartao = ({ t }: { t: NoPessoa }) => { const d = arv.diretos(t.id), b = arv.abaixo(t.id); return (
    <Link href={link(t.id)} className={`flex min-w-0 items-center gap-2 rounded-md border bg-white px-2.5 py-1.5 hover:border-acao ${sel?.id === t.id ? "border-acao ring-1 ring-acao" : "border-line"}`}>
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-mist text-xs font-semibold text-navy" aria-hidden>{iniciais(t.nome)}</span>
      <span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{t.nome}</span><span className="block truncate text-[11px] text-slate-500">{t.cargo ?? "cargo a definir"} · {t.unidade}</span></span>
      {d > 0 && <span className="ml-auto flex-none whitespace-nowrap rounded bg-mist px-1.5 py-0.5 text-[10px] tabular-nums text-slate-600" title={`${d} na equipe direta · ${b} no total abaixo`}>👥 {d}{b > d ? ` · ${b}` : ""}</span>}
    </Link>); };
  const No = ({ t, nivel }: { t: NoPessoa; nivel: number }): React.ReactNode => {
    const filhos = arv.filhos(t.id).filter(f => unidade === null || naUnidade(f));
    if (!filhos.length) return <li className={nivel ? "ml-3 border-l border-line pl-3 pt-1.5" : "pt-1.5"}><Cartao t={t} /></li>;
    return <li className={nivel ? "ml-3 border-l border-line pl-3 pt-1.5" : "pt-1.5"}><details open={nivel < 1 || (unidade !== null && nivel < 2)}><summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden"><Cartao t={t} /></summary><ul>{filhos.map(f => <No key={f.id} t={f} nivel={nivel + 1} />)}</ul></details></li>;
  };
  const raizes = arv.raizes.filter(r => unidade === null || naUnidade(r));

  return (
    <Page title="Organograma e quem é quem" sub="Quem responde a quem, pelo gestor direto da ficha. Toque numa pessoa para ver cargo, unidade, equipe, ramal e e-mail institucional.">
      {abas}
      <form className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_200px_auto]"><Input name="q" defaultValue={q} placeholder="Buscar por nome, cargo, área, unidade ou ramal" aria-label="Buscar" /><Select name="u" defaultValue={unidade ?? ""} aria-label="Unidade"><option value="">Rede inteira</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select><Btn kind="ghost">Filtrar</Btn></form>
      <div className="mb-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {[["Pessoas", String(todos.length)], ["Gestores com equipe", String(gestores.length)], ["Amplitude média de controle", amplitude === null ? "—" : `${amplitude.toFixed(1).replace(".", ",")} por gestor`], ...(equipe ? [["Sem gestor definido", String(semGestor)]] : [])].map(([k, v]) => <div key={k} className="rounded-md border border-line bg-white px-3 py-2"><div className="text-[11px] text-slate-500">{k}</div><div className="font-semibold text-navy">{v}</div></div>)}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <Card title={q ? `${busca.length} resultado(s) para “${q}”` : "Estrutura"}>
          {q ? (busca.length === 0 ? <p className="text-sm text-slate-500">Ninguém encontrado.</p> : <ul className="space-y-2">{busca.slice(0, 60).map(t => <li key={t.id}><Cartao t={t} />{cadeia(t).length > 0 && <div className="mt-0.5 pl-11 text-[11px] text-slate-500">{cadeia(t).map(g => g.nome.split(" ")[0]).join(" › ")} › <b>{t.nome.split(" ")[0]}</b></div>}</li>)}</ul>)
            : <ul className="-mt-1.5">{raizes.map(r => <No key={r.id} t={r} nivel={0} />)}</ul>}
          {!q && <p className="mt-3 text-[11px] text-slate-500">👥 equipe direta · total abaixo. Quem não tem gestor definido na ficha aparece no topo{equipe ? " — complete em Colaboradores → Editar → Gestor direto" : ""}.</p>}
        </Card>
        <div id="pessoa" className={`lg:sticky lg:top-4 ${sel ? "order-first lg:order-none" : ""}`}>
          {sel ? <Pessoa t={sel} /> : <Card title="Quem é quem"><p className="text-sm text-slate-600">Toque numa pessoa para ver o cargo, a unidade, a quem ela responde, a equipe e como falar com ela.</p></Card>}
        </div>
      </div>
    </Page>
  );

  function Pessoa({ t }: { t: NoPessoa & { area?: string | null } }) {
    const g = t.gestorId ? todos.find(x => x.id === t.gestorId) : undefined; const eq = arv.filhos(t.id); const podeFicha = (equipe && canSeeEmployee(s, { id: t.id, unitId: t.unitId })) || s.employeeId === t.id;
    return <Card title="Quem é quem">
      <div className="flex items-center gap-3"><span className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-acao text-base font-semibold text-white" aria-hidden>{iniciais(t.nome)}</span><div className="min-w-0"><div className="font-semibold text-navy [overflow-wrap:anywhere]">{t.nome}</div><div className="text-xs text-slate-600">{t.cargo ?? "cargo a definir"}</div></div></div>
      <dl className="mt-3 space-y-1.5 text-sm">
        <div><dt className="text-[11px] text-slate-500">Unidade{t.area ? " · área" : ""}</dt><dd>{t.unidade}{t.area ? ` · ${t.area}` : ""}</dd></div>
        <div><dt className="text-[11px] text-slate-500">Responde a</dt><dd>{g ? <Link className="text-acao" href={link(g.id)}>{g.nome}</Link> : "—"}</dd></div>
        <div><dt className="text-[11px] text-slate-500">Equipe direta</dt><dd>{eq.length ? <span className="flex flex-wrap gap-x-2 gap-y-0.5">{eq.map(f => <Link key={f.id} className="text-acao" href={link(f.id)}>{f.nome.split(" ")[0]} {f.nome.split(" ").slice(-1)[0]}</Link>)}</span> : "—"}{arv.abaixo(t.id) > eq.length ? <span className="text-xs text-slate-500"> · {arv.abaixo(t.id)} no total abaixo</span> : null}</dd></div>
        <div><dt className="text-[11px] text-slate-500">Na escola desde</dt><dd>{fmtData(t.admissao).slice(3)} · {tempoCasa(t.admissao, h)}</dd></div>
        {t.noDiretorio || equipe ? <><div><dt className="text-[11px] text-slate-500">Ramal</dt><dd>{t.ramal ?? "—"}</dd></div><div><dt className="text-[11px] text-slate-500">E-mail institucional</dt><dd className="[overflow-wrap:anywhere]">{t.emailInst ? <a className="text-acao" href={`mailto:${t.emailInst}`}>{t.emailInst}</a> : "—"}</dd></div></> : <p className="text-xs text-slate-500">Contato fora do quem é quem (preferência da pessoa).</p>}
      </dl>
      {podeFicha && <div className="mt-3"><Btn small kind="ghost" href={`/colaboradores/${t.id}`}>Abrir ficha</Btn></div>}
    </Card>;
  }
}

async function Cargos({ s, abas }: { s: Awaited<ReturnType<typeof requireSession>>; abas: React.ReactNode }) {
  const u = scopeUnit(s);
  const positions: Pos[] = await db.select({ id: schema.positions.id, nome: schema.positions.nome, area: schema.positions.area, parentId: schema.positions.parentId, regulamentado: schema.positions.regulamentado }).from(schema.positions).orderBy(asc(schema.positions.ordem));
  type Occ = { position_id: number; unidade: string; id: number; nome: string; nivel: string | null };
  const occ: Occ[] = await sql<Occ[]>`
    SELECT e.position_id, un.nome AS unidade, e.id, e.nome, e.nivel FROM employees e JOIN units un ON un.id=e.unit_id
    WHERE e.situacao <> 'DESLIGADO' AND e.position_id IS NOT NULL ${u === null ? sql`` : sql`AND e.unit_id=${u}`} ORDER BY e.nome`;
  const byPos = new Map<number, Occ[]>();
  for (const o of occ) byPos.set(o.position_id, [...(byPos.get(o.position_id) ?? []), o]);
  const children = (pid: number | null) => positions.filter(p => p.parentId === pid);
  const agentes = await sql<{ id: number; nome: string; nivel: string; position_id: number; dono: string | null; status: string }[]>`SELECT a.id, a.nome, a.nivel, a.position_id, us.nome AS dono, a.status FROM ai_agents a LEFT JOIN users us ON us.id=a.dono_user_id WHERE a.status IN ('ATIVO','PILOTO') AND a.position_id IS NOT NULL ${u === null ? sql`` : sql`AND (a.unit_id IS NULL OR a.unit_id=${u})`} ORDER BY a.nome`;
  const semCargo = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM employees WHERE situacao <> 'DESLIGADO' AND position_id IS NULL ${u === null ? sql`` : sql`AND unit_id=${u}`}`;

  const Node = ({ p, depth }: { p: Pos; depth: number }) => {
    const pessoas = byPos.get(p.id) ?? [];
    const filhos = children(p.id);
    return (
      <li className={depth ? "ml-4 border-l border-line pl-4" : ""}>
        <div className="my-1.5 flex flex-wrap items-baseline gap-2 rounded-md bg-white px-3 py-2 shadow-[0_0_0_1px_#dbe3ee]">
          <span className="font-medium text-navy">{p.nome}</span>
          <span className="text-xs text-slate-500">{p.area}{p.regulamentado ? " · regulamentado" : ""}</span>
          <span className="ml-auto rounded bg-mist px-1.5 py-0.5 text-xs tabular-nums text-slate-700">{pessoas.length} {pessoas.length === 1 ? "pessoa" : "pessoas"}</span>
        </div>
        {pessoas.length > 0 && pessoas.length <= 12 && (
          <div className="mb-1 ml-3 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600">
            {pessoas.map(x => <Link key={x.id} href={`/colaboradores/${x.id}`} className="hover:text-acao">{x.nome}{x.nivel ? ` (${x.nivel[0]})` : ""} <span className="text-slate-400">· {x.unidade}</span></Link>)}
          </div>
        )}
        {pessoas.length > 12 && <div className="mb-1 ml-3 text-xs text-slate-500"><Link className="text-acao" href={`/colaboradores?q=${encodeURIComponent(p.nome)}`}>ver os {pessoas.length} nomes</Link></div>}
        {agentes.some(a => a.position_id === p.id) && <div className="mb-1 ml-3 flex flex-wrap gap-1">{agentes.filter(a => a.position_id === p.id).map(a => <Link key={a.id} href="/governanca/agentes" className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[11px] text-violet-900">🤖 {a.nome} · {a.nivel}{a.dono ? ` · dono: ${a.dono}` : ""}{a.status === "PILOTO" ? " · piloto" : ""}</Link>)}</div>}
        {filhos.length > 0 && <ul>{filhos.map(f => <Node key={f.id} p={f} depth={depth + 1} />)}</ul>}
      </li>
    );
  };

  return (
    <Page title="Organograma e quem é quem" sub={`Estrutura de cargos com ocupação atual${u === null ? " — rede" : ""}. Os cargos são editados em Configurações.`}>
      {abas}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <ul>{children(null).map(p => <Node key={p.id} p={p} depth={0} />)}</ul>
        <Card title="Resumo">
          <dl className="space-y-2 text-sm">
            <div><dt className="text-xs text-slate-500">Cargos</dt><dd className="font-medium">{positions.length}</dd></div>
            <div><dt className="text-xs text-slate-500">Pessoas alocadas</dt><dd className="font-medium">{occ.length}</dd></div>
            <div><dt className="text-xs text-slate-500">Agentes de IA vinculados a cargos</dt><dd className="font-medium">{agentes.length} <Link className="text-xs text-acao" href="/governanca/agentes">inventário</Link></dd></div>
            <div><dt className="text-xs text-slate-500">Sem cargo definido</dt><dd className="font-medium">{semCargo[0].n} <Link className="text-xs text-acao" href="/colaboradores">revisar</Link></dd></div>
            <div><dt className="text-xs text-slate-500">Por área</dt><dd className="text-xs text-slate-700">{["Direção", "Pedagógica", "Administrativa", "Serviços"].map(a => `${a}: ${positions.filter(p => p.area === a).reduce((n, p) => n + (byPos.get(p.id)?.length ?? 0), 0)}`).join(" · ")}</dd></div>
          </dl>
        </Card>
      </div>
    </Page>
  );
}
