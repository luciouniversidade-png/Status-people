import Link from "@/components/Link";
import { requireStaff, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Field, Select, Btn, Input, Stat } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { quemEstaFora, rotuloVisivel, corVisivel, FORA_LABEL, type TipoFora } from "@/lib/quem-fora";
import { hoje, fmtData } from "@/lib/utils";
import { mesPorExtenso } from "@/lib/formato";

export const dynamic = "force-dynamic";

const DIA_SEM = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** Quem está fora: o mês da equipe numa grade (pessoa × dia), com a concentração por unidade — para planejar férias e coberturas. */
export default async function QuemEstaFora({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const sp = await searchParams; const escopo = scopeUnit(s); const h = hoje();
  const units = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`;
  const unitId = escopo ?? (units.some(u => u.id === Number(sp.unidade)) ? Number(sp.unidade) : null);
  const mes = sp.mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes) ? sp.mes : h.slice(0, 7);
  const todos = sp.todos === "1"; const sensivel = ["DIRECAO", "RH", "DIRETOR_UNIDADE"].includes(s.role);
  const q = await quemEstaFora(mes, unitId, todos);
  const foraHoje = q.pessoas.filter(p => p.dias.get(h) && !p.dias.get(h)!.pendente);
  const feriado = new Map(q.feriados.map(f => [f.data, f]));
  const tipos = [...new Set(q.pessoas.flatMap(p => [...p.dias.values()].map(d => rotuloVisivel(d.tipo, sensivel))))];
  const legenda = (Object.keys(FORA_LABEL) as TipoFora[]).filter(t => tipos.includes(rotuloVisivel(t, sensivel))).filter((t, i, a) => a.findIndex(x => rotuloVisivel(x, sensivel) === rotuloVisivel(t, sensivel)) === i);
  const ant = (() => { const [y, m] = mes.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; })(); const prox = (() => { const [y, m] = mes.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; })();
  const link = (m: string) => `/ferias/calendario?mes=${m}${unitId ? `&unidade=${unitId}` : ""}${todos ? "&todos=1" : ""}`;
  const diasFerias = q.pessoas.reduce((a, p) => a + [...p.dias.values()].filter(d => d.tipo === "FERIAS" && !d.pendente).length, 0);
  const pendentes = q.pessoas.filter(p => [...p.dias.values()].some(d => d.pendente)).length;
  const tom = (pct: number) => pct >= 20 ? "bg-red-100 text-erro" : pct >= 10 ? "bg-amber-50 text-aviso" : pct > 0 ? "bg-sky-50 text-acao" : "text-slate-300";
  return (
    <Page title="Quem está fora" sub={`${mesPorExtenso(mes)} · férias, folgas, afastamentos, licenças, ausências registradas para substituição e faltas do ponto. Pedidos ainda não aprovados aparecem tracejados.`}
      actions={<div className="flex gap-2 print:hidden"><Btn kind="ghost" href="/ferias">Férias e afastamentos</Btn><PrintButton /></div>}>
      <form className="mb-4 flex flex-wrap items-end gap-2 print:hidden">
        <Btn kind="ghost" href={link(ant)}>← {mesPorExtenso(ant).split(" de ")[0]}</Btn>
        <Field label="Mês"><Input type="month" name="mes" defaultValue={mes} /></Field>
        {!escopo && <Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Rede</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="todos" value="1" defaultChecked={todos} /> mostrar toda a equipe</label>
        <Btn kind="ghost">Ver</Btn>
        <Btn kind="ghost" href={link(prox)}>{mesPorExtenso(prox).split(" de ")[0]} →</Btn>
      </form>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Fora hoje" value={mes === h.slice(0, 7) ? foraHoje.length : "—"} hint={mes === h.slice(0, 7) ? (foraHoje.slice(0, 3).map(p => p.nome.split(" ")[0]).join(", ") || "ninguém") : "outro mês"} />
        <Stat label="Pessoas com ausência no mês" value={q.pessoas.filter(p => p.dias.size).length} />
        <Stat label="Dias de férias no mês" value={diasFerias} hint={pendentes ? `${pendentes} pessoa(s) com pedido aguardando aprovação` : undefined} />
        <Stat label="Maior concentração" value={q.pico && q.pico.n ? `${Math.round(q.pico.pct)}%` : "—"} hint={q.pico && q.pico.n ? `${q.pico.unidade} · ${fmtData(q.pico.data)} · ${q.pico.n} pessoa(s)` : "sem ausências em dias úteis"} />
      </div>
      <Card title="Concentração por unidade (pessoas fora ÷ equipe, dias úteis)" className="mb-4">
        <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]"><table className="w-full min-w-[720px] text-center text-[11px]">
          <thead><tr><th className="sticky left-0 z-[1] bg-white px-2 py-1 text-left font-medium text-slate-600">Unidade</th>{q.dias.map(d => { const w = new Date(`${d}T12:00:00Z`).getUTCDay(); return <th key={d} className={`px-0.5 py-1 font-normal ${w === 0 || w === 6 || feriado.has(d) ? "text-slate-300" : "text-slate-500"} ${d === h ? "text-acao font-semibold" : ""}`}>{Number(d.slice(8))}</th>; })}</tr></thead>
          <tbody>{q.unidades.map(u => <tr key={u.id}><th scope="row" className="sticky left-0 z-[1] whitespace-nowrap bg-white px-2 py-1 text-left font-medium">{u.nome} <span className="font-normal text-slate-400">({u.quadro})</span></th>{u.porDia.map(x => <td key={x.data} title={`${fmtData(x.data)}: ${x.n} pessoa(s) fora · ${Math.round(x.pct)}%`} className={`px-0.5 py-1 tabular-nums ${!x.util || feriado.has(x.data) ? "bg-slate-50 text-slate-300" : tom(x.pct)}`}>{x.n || "·"}</td>)}</tr>)}</tbody>
        </table></div>
        <p className="mt-2 text-[11px] text-slate-500">Âmbar: 10% ou mais da equipe fora · vermelho: 20% ou mais. Planeje férias e coberturas fugindo dos picos.</p>
      </Card>
      <Card title={`Calendário da equipe (${q.pessoas.length} ${todos ? "pessoas" : "pessoas com ausência"})`}>
        {q.pessoas.length === 0 ? <p className="text-sm text-slate-500">Ninguém fora neste mês.</p> : <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]"><table className="w-full min-w-[900px] text-[11px]">
          <thead><tr><th className="sticky left-0 z-[1] bg-white px-2 py-1 text-left font-medium text-slate-600">Pessoa</th>{q.dias.map(d => { const w = new Date(`${d}T12:00:00Z`).getUTCDay(); return <th key={d} className={`w-6 px-0 py-1 text-center font-normal ${w === 0 || w === 6 ? "text-slate-300" : "text-slate-500"} ${d === h ? "text-acao font-semibold" : ""}`} title={feriado.get(d)?.descricao ?? undefined}><div>{Number(d.slice(8))}</div><div className="text-[9px]">{DIA_SEM[w]}</div></th>; })}</tr></thead>
          <tbody className="divide-y divide-line">{q.pessoas.map(p => <tr key={p.id}>
            <th scope="row" className="sticky left-0 z-[1] max-w-[13rem] bg-white px-2 py-1 text-left font-medium"><Link href={`/colaboradores/${p.id}`} className="block truncate text-acao hover:underline">{p.nome}</Link><span className="block truncate font-normal text-slate-500">{p.cargo ?? "—"}{unitId === null ? ` · ${p.unidade}` : ""}</span></th>
            {q.dias.map(d => { const x = p.dias.get(d); const w = new Date(`${d}T12:00:00Z`).getUTCDay(); const fds = w === 0 || w === 6 || feriado.has(d);
              return <td key={d} className={`h-7 px-px py-0.5 ${fds ? "bg-slate-50" : ""}`} title={x ? `${fmtData(d)} · ${rotuloVisivel(x.tipo, sensivel)}${x.pendente ? " (aguardando aprovação)" : ""} · ${x.origem}` : feriado.get(d)?.descricao ?? undefined}>{x && <span className="block h-5 w-full rounded-sm" style={x.pendente ? { border: `1.5px dashed ${corVisivel(x.tipo, sensivel)}`, background: "transparent" } : { background: corVisivel(x.tipo, sensivel), opacity: fds ? 0.45 : 1 }} />}</td>; })}
          </tr>)}</tbody>
        </table></div>}
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">{legenda.map(t => <li key={t} className="flex items-center gap-1.5"><span className="inline-block h-3 w-4 rounded-sm" style={{ background: corVisivel(t, sensivel) }} />{rotuloVisivel(t, sensivel)}</li>)}<li className="flex items-center gap-1.5"><span className="inline-block h-3 w-4 rounded-sm border border-dashed border-slate-500" />aguardando aprovação</li><li className="flex items-center gap-1.5"><span className="inline-block h-3 w-4 rounded-sm bg-slate-100" />fim de semana ou feriado</li></ul>
      </Card>
    </Page>
  );
}
