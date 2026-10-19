import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, scopeUnit } from "@/lib/auth";
import { Page, Card, Flash, Stat, Table, Td, Btn, Field, Select, Input, Badge } from "@/components/ui";
import { BarrasH, COR } from "@/components/graficos";
import { conformidadeSst, podeSst } from "@/lib/sst";
import { situacaoBrigada } from "@/lib/seguranca";
import { salvarEpi, registrarEntregaEpi, convocarReciclagem } from "../actions";
import { SstNav } from "../_nav";
import { fmtData, hoje, addDays, getSettings } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** T-103 · Treinamentos NR, brigada e EPI: a conformidade de segurança como matriz viva — quem precisa, quem tem e o que vence. */
export default async function Conformidade({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!podeSst(s)) redirect("/"); const sp = await searchParams; const u = scopeUnit(s); const h = hoje(); const cfg = await getSettings();
  const [c, brig, epis, entregas, emps] = await Promise.all([conformidadeSst(u), situacaoBrigada(u).catch(() => null),
    sql<{ id: number; nome: string; ca: string | null; troca_dias: number | null }[]>`SELECT id, nome, ca, troca_dias FROM epi_items WHERE ativo ORDER BY nome`,
    sql<{ id: number; nome: string; epi: string; data: string; proxima_troca: string | null; termo_assinado: boolean }[]>`SELECT d.id, e.nome, i.nome AS epi, d.data::text, d.proxima_troca::text, d.termo_assinado FROM epi_deliveries d JOIN employees e ON e.id=d.employee_id JOIN epi_items i ON i.id=d.epi_id WHERE d.devolvido_em IS NULL ${u === null ? sql`` : sql`AND e.unit_id=${u}`} AND NOT EXISTS (SELECT 1 FROM epi_deliveries d2 WHERE d2.employee_id=d.employee_id AND d2.epi_id=d.epi_id AND d2.data > d.data) ORDER BY d.proxima_troca NULLS LAST LIMIT 60`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM employees WHERE situacao IN ('ATIVO','FERIAS','AFASTADO') ${u === null ? sql`` : sql`AND unit_id=${u}`} ORDER BY nome`]);
  const total = c.linhas.reduce((a, l) => a + l.itens.length, 0); const ok = c.linhas.reduce((a, l) => a + l.itens.filter(i => i.status === "CONCLUIDO").length, 0);
  const porCurso = c.cursos.map(cu => ({ cu, pend: c.pendentes.filter(p => p.curso.id === cu.id) })).filter(x => x.pend.length);
  return (
    <Page title="Treinamentos NR, brigada e EPI" sub={`Matriz de conformidade: cursos obrigatórios das áreas ${(cfg.sst.areasCursos as string[]).join(", ")} da Academy por cargo, brigada de emergência e entrega de EPI com termo e troca.`}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <SstNav atual="/sst/conformidade" />
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Conformidade de treinamentos" value={total ? `${Math.round((100 * ok) / total)}%` : "—"} hint={total ? `${ok} de ${total} exigências` : "nenhum curso de segurança obrigatório cadastrado"} />
        <Stat label="Pendentes ou vencidos" value={<span className={c.pendentes.length ? "text-aviso" : "text-ok"}>{c.pendentes.length}</span>} hint={`${c.vencendo.length} vencendo em breve`} />
        <Stat label="Brigada" value={brig ? `${brig.membros.filter(m => m.situacao !== "VENCIDO").length} em dia` : "—"} hint={brig ? `${brig.porUnidade.filter(x => x.abaixo).length} unidade(s) abaixo do mínimo` : "módulo de portaria indisponível"} href="/operacoes/seguranca/brigada" />
        <Stat label="EPI com troca vencida" value={<span className={c.epiVencidos ? "text-erro" : ""}>{c.epiVencidos}</span>} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:items-start">
        <Card title="Conformidade por unidade">{c.porUnidade.length ? <BarrasH rotulo="Conformidade de segurança por unidade" max={100} formato={v => `${v}%`} itens={c.porUnidade.map(x => ({ rotulo: x.nome, valor: x.pct, sub: `${x.ok}/${x.total}`, cor: (x.pct ?? 0) >= 95 ? COR.ok : (x.pct ?? 0) >= 80 ? COR.aviso : COR.erro }))} /> : <p className="text-sm text-slate-600">Cadastre na Academy os cursos obrigatórios de segurança (área “{(cfg.sst.areasCursos as string[])[0]}”) com os cargos que precisam deles — NR-10, NR-35, brigada, primeiros socorros…</p>}</Card>
        <Card title="Quem falta, por curso" className="xl:col-span-2">
          {porCurso.length === 0 ? <p className="text-sm text-slate-600">{total ? "Todos em dia. ✓" : "Sem exigências cadastradas."}</p> : <div className="space-y-3">{porCurso.map(({ cu, pend }) => <div key={cu.id} className="rounded-md border border-line p-3"><div className="flex flex-wrap items-center gap-2"><b className="text-sm">{cu.codigo} · {cu.titulo}</b><Badge v="PENDENTE" label={`${pend.length} pendente(s)`} />
            <form action={convocarReciclagem} className="ml-auto flex items-center gap-1"><input type="hidden" name="courseId" value={cu.id} /><input type="hidden" name="unitId" value={u ?? ""} /><input type="hidden" name="ids" value={pend.map(p => p.emp.id).join(",")} /><Input type="date" name="data" defaultValue={addDays(h, 7)} className="h-8 w-36 text-xs" /><Btn small>Convocar reciclagem</Btn></form></div>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">{pend.map(p => <li key={p.emp.id}><Link href={`/colaboradores/${p.emp.id}`} className="text-acao">{p.emp.nome}</Link> <span className="text-slate-500">({p.emp.unidade} · {p.status === "VENCIDO" ? `vencido ${fmtData(p.validoAte)}` : "pendente"})</span></li>)}</ul></div>)}</div>}
        </Card>
      </div>
      <div id="epi" className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3 xl:items-start">
        <Card title="Entregas de EPI (última por pessoa e item)" className="xl:col-span-2">
          <Table head={["Colaborador", "EPI", "Entregue em", "Próxima troca", "Termo"]} empty="Nenhuma entrega registrada.">{entregas.map(d => <tr key={d.id}><Td>{d.nome}</Td><Td className="text-xs">{d.epi}</Td><Td className="whitespace-nowrap text-xs">{fmtData(d.data)}</Td><Td className={`whitespace-nowrap text-xs ${d.proxima_troca && d.proxima_troca < h ? "font-medium text-erro" : ""}`}>{fmtData(d.proxima_troca)}</Td><Td>{d.termo_assinado ? <Badge v="APROVADA" label="assinado" /> : <Badge v="PENDENTE" label="sem termo" />}</Td></tr>)}</Table>
          <form action={registrarEntregaEpi} className="mt-3 grid grid-cols-1 gap-2 border-t border-line pt-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_9rem_5rem_auto]"><Field label="Colaborador"><Select name="employeeId">{emps.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</Select></Field><Field label="EPI"><Select name="epiId">{epis.map(e => <option key={e.id} value={e.id}>{e.nome}{e.ca ? ` (CA ${e.ca})` : ""}</option>)}</Select></Field><Field label="Data"><Input type="date" name="data" defaultValue={h} /></Field><Field label="Qtde"><Input type="number" name="quantidade" min={1} defaultValue={1} /></Field><div className="flex items-end gap-2"><label className="flex items-center gap-1 text-xs"><input type="checkbox" name="termo" value="1" /> termo</label><Btn small kind="ghost">Registrar</Btn></div></form>
        </Card>
        <Card title="Catálogo de EPI">{epis.length === 0 ? <p className="text-sm text-slate-600">Cadastre os EPIs usados (cozinha, limpeza, manutenção) com o número do CA e a periodicidade de troca.</p> : <ul className="space-y-1 text-sm">{epis.map(e => <li key={e.id}>{e.nome} <span className="text-xs text-slate-500">{e.ca ? `CA ${e.ca}` : "CA a informar"} · {e.troca_dias ? `troca a cada ${e.troca_dias} dias` : "sem troca programada"}</span></li>)}</ul>}
          <form action={salvarEpi} className="mt-3 space-y-2 border-t border-line pt-3"><Field label="EPI"><Input name="nome" required placeholder="ex.: luva nitrílica (cozinha)" /></Field><div className="grid grid-cols-2 gap-2"><Field label="CA"><Input name="ca" /></Field><Field label="Troca (dias)"><Input name="troca" type="number" min={1} /></Field></div><Btn small kind="ghost">Cadastrar</Btn></form></Card>
      </div>
    </Page>
  );
}
