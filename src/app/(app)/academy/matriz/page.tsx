import Link from "next/link";
import { requireStaff, scopeUnit } from "@/lib/auth";
import { db, schema } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Table, Td, Badge, Flash, Field, Select, Btn, Stat } from "@/components/ui";
import { fmtData } from "@/lib/utils";
import { matrizTreinamento } from "@/lib/clima-academy";

export const dynamic = "force-dynamic";

export default async function Matriz({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const sp = await searchParams; const scope = scopeUnit(s); const unitId = scope ?? (sp.unidade ? Number(sp.unidade) : null);
  const m = await matrizTreinamento(unitId); const units = scope ? [] : await db.select().from(schema.units).orderBy(asc(schema.units.nome));
  const so = sp.so ?? "";
  const linhas = so === "PENDENTES" ? m.linhas.filter(l => l.ok < l.total) : m.linhas;
  return (
    <Page title="Matriz de treinamento" sub="Quem precisa de quê (obrigatórios para todos, por cargo ou por regime) e a situação de cada um. Ciência de POP vigente conta como concluído.">
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4"><Stat label="Conformidade" value={m.conformidade === null ? "—" : `${m.conformidade}%`} /><Stat label="Pendências" value={m.pendentes} /><Stat label="Vencendo em 60 dias" value={m.vencendo} /><Stat label="Vencidos" value={m.vencidos} /></div>
      <form className="mb-3 flex flex-wrap items-end gap-2">{!scope && <Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Todas</option>{units.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field>}<Field label="Mostrar"><Select name="so" defaultValue={so}><option value="">Todos</option><option value="PENDENTES">Só com pendências</option></Select></Field><Btn kind="ghost">Filtrar</Btn></form>
      <div className="overflow-x-auto rounded-md border border-line bg-white"><table className="w-full text-xs"><thead className="bg-mist text-slate-600"><tr><th className="px-2 py-2 text-left">Colaborador</th><th className="px-2 py-2 text-left">Unidade</th><th className="px-2 py-2 text-left">Cargo</th><th className="px-2 py-2">%</th>{m.cursos.map(c => <th key={c.id} className="px-1 py-2 text-center" title={c.titulo}>{c.codigo}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{linhas.length === 0 && <tr><td colSpan={4 + m.cursos.length} className="px-3 py-6 text-center text-slate-500">Nenhum colaborador neste filtro.</td></tr>}{linhas.map(l => <tr key={l.emp.id}><td className="px-2 py-1"><Link className="text-acao" href={`/colaboradores/${l.emp.id}`}>{l.emp.nome}</Link></td><td className="px-2 py-1">{l.emp.unidade}</td><td className="px-2 py-1">{l.emp.cargo ?? "—"}</td><td className={`px-2 py-1 text-center font-medium ${l.pct === null ? "text-slate-400" : l.pct === 100 ? "text-ok" : l.pct >= 70 ? "text-aviso" : "text-erro"}`}>{l.pct === null ? "—" : `${l.pct}%`}</td>
          {m.cursos.map(c => { const it = l.itens.find(i => i.curso.id === c.id); return <td key={c.id} className="px-1 py-1 text-center">{!it ? <span className="text-slate-300">·</span> : <Badge v={it.status === "CONCLUIDO" ? (it.vencendo ? "VENCE_EM_BREVE" : "APROVADA") : it.status === "VENCIDO" ? "VENCIDO" : it.status === "EM_ANDAMENTO" ? "EM_ADMISSAO" : "PENDENTE"} label={it.status === "CONCLUIDO" ? (it.validoAte ? `ok · ${fmtData(it.validoAte).slice(3)}` : "ok") : it.status === "VENCIDO" ? "venc." : it.status === "EM_ANDAMENTO" ? "and." : "pend."} />}</td>; })}</tr>)}</tbody></table></div>
    </Page>
  );
}
