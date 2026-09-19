import Link from "next/link";
import { requireStaff, scopeUnit } from "@/lib/auth";
import { sql, db, schema } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card } from "@/components/ui";

export const dynamic = "force-dynamic";

type Pos = { id: number; nome: string; area: string; parentId: number | null; regulamentado: boolean };

export default async function Organograma() {
  const s = await requireStaff(); const u = scopeUnit(s);
  const positions: Pos[] = await db.select({ id: schema.positions.id, nome: schema.positions.nome, area: schema.positions.area, parentId: schema.positions.parentId, regulamentado: schema.positions.regulamentado }).from(schema.positions).orderBy(asc(schema.positions.ordem));
  type Occ = { position_id: number; unidade: string; id: number; nome: string; nivel: string | null };
  const occ: Occ[] = await sql<Occ[]>`
    SELECT e.position_id, un.nome AS unidade, e.id, e.nome, e.nivel FROM employees e JOIN units un ON un.id=e.unit_id
    WHERE e.situacao <> 'DESLIGADO' AND e.position_id IS NOT NULL ${u === null ? sql`` : sql`AND e.unit_id=${u}`} ORDER BY e.nome`;
  const byPos = new Map<number, Occ[]>();
  for (const o of occ) byPos.set(o.position_id, [...(byPos.get(o.position_id) ?? []), o]);
  const children = (pid: number | null) => positions.filter(p => p.parentId === pid);
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
        {filhos.length > 0 && <ul>{filhos.map(f => <Node key={f.id} p={f} depth={depth + 1} />)}</ul>}
      </li>
    );
  };

  return (
    <Page title="Organograma" sub={`Estrutura de cargos com ocupação atual${u === null ? " — rede" : ""}. Os cargos são editados em Configurações.`}>
      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <ul>{children(null).map(p => <Node key={p.id} p={p} depth={0} />)}</ul>
        <Card title="Resumo">
          <dl className="space-y-2 text-sm">
            <div><dt className="text-xs text-slate-500">Cargos</dt><dd className="font-medium">{positions.length}</dd></div>
            <div><dt className="text-xs text-slate-500">Pessoas alocadas</dt><dd className="font-medium">{occ.length}</dd></div>
            <div><dt className="text-xs text-slate-500">Sem cargo definido</dt><dd className="font-medium">{semCargo[0].n} <Link className="text-xs text-acao" href="/colaboradores">revisar</Link></dd></div>
            <div><dt className="text-xs text-slate-500">Por área</dt><dd className="text-xs text-slate-700">{["Direção", "Pedagógica", "Administrativa", "Serviços"].map(a => `${a}: ${positions.filter(p => p.area === a).reduce((n, p) => n + (byPos.get(p.id)?.length ?? 0), 0)}`).join(" · ")}</dd></div>
          </dl>
        </Card>
      </div>
    </Page>
  );
}
