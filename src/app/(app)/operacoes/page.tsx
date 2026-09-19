import Link from "next/link";
import { requireSession, scopeUnit, can } from "@/lib/auth";
import { db, schema } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Table, Td, Flash, Field, Select, Btn, Stat } from "@/components/ui";
import { fmtData, getSettings } from "@/lib/utils";
import { painelOperacoes, OS_TIPO, brl } from "@/lib/operacoes";
import { abrirPreventiva } from "./actions";
import { NovoChamadoForm } from "./_shared";

export const dynamic = "force-dynamic";

export default async function Operacoes({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams; const cfg = await getSettings(); const scope = scopeUnit(s); const unitId = scope ?? (sp.unidade ? Number(sp.unidade) : null);
  const [p, units] = await Promise.all([painelOperacoes(unitId), scope ? Promise.resolve([]) : db.select().from(schema.units).orderBy(asc(schema.units.nome))]);
  return (
    <Page title="Operações e manutenção" sub="Chamados com SLA, ordens de serviço, patrimônio com preventivas, vistorias por checklist e fornecedores — nas quatro unidades." actions={<><Btn kind="ghost" href="/operacoes/chamados">Chamados</Btn><Btn kind="ghost" href="/operacoes/ativos">Ativos</Btn><Btn kind="ghost" href="/operacoes/vistorias">Vistorias</Btn><Btn kind="ghost" href="/operacoes/fornecedores">Fornecedores</Btn></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {!scope && <form className="mb-4 flex items-end gap-2"><Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Rede</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Btn kind="ghost">Ver</Btn></form>}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Chamados abertos" value={p.os.abertas} hint={`${p.os.urgentes} urgente(s)`} href="/operacoes/chamados" /><Stat label="Com SLA vencido" value={<span className={p.os.atrasadas ? "text-erro" : ""}>{p.os.atrasadas}</span>} href="/operacoes/chamados?filtro=ATRASADOS" /><Stat label="Concluídos (30 dias)" value={p.os.concluidas_30} hint={p.os.tempo_medio_h !== null ? `tempo médio ${p.os.tempo_medio_h} h` : undefined} /><Stat label="Preventivas vencidas" value={<span className={p.preventivas.filter(x => x.dias >= 0).length ? "text-aviso" : ""}>{p.preventivas.filter(x => x.dias >= 0).length}</span>} hint={`${p.preventivas.filter(x => x.dias < 0).length} vencem em 15 dias`} /><Stat label="Custo no mês" value={brl(p.custo.mes)} hint={`${brl(p.custo.ano)} no ano`} /><Stat label="Vistorias (90 dias)" value={p.vist.media === null ? "—" : `${p.vist.media}%`} hint={`${p.vist.mes} no mês · ${p.vist.ncs} não conformes em 30 dias`} href="/operacoes/vistorias" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_340px] lg:items-start">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card title="Por tipo"><Table head={["Tipo", "Abertos", "No mês"]} empty="Sem chamados.">{p.porTipo.map(t => <tr key={t.tipo}><Td>{OS_TIPO[t.tipo] ?? t.tipo}</Td><Td>{t.abertas || "—"}</Td><Td>{t.mes || "—"}</Td></tr>)}</Table></Card>
          {!scope && <Card title="Por unidade"><Table head={["Unidade", "Abertos", "Atrasados", "Custo no mês"]}>{p.porUnidade.map(u => <tr key={u.unidade}><Td>{u.unidade}</Td><Td>{u.abertas || "—"}</Td><Td className={u.atrasadas ? "text-erro" : ""}>{u.atrasadas || "—"}</Td><Td className="tabular-nums">{brl(u.custo_mes)}</Td></tr>)}</Table></Card>}
          <Card title="Preventivas vencidas ou a vencer (15 dias)" className="sm:col-span-2"><Table head={["Ativo", "Unidade", "Ambiente", "Prevista", "Atraso", ""]} empty="Nenhuma preventiva pendente.">{p.preventivas.map(a => <tr key={a.id}><Td>{a.nome}</Td><Td>{a.unidade}</Td><Td className="text-xs">{a.ambiente ?? "—"}</Td><Td>{fmtData(a.proxima)}</Td><Td className={a.dias > 0 ? "font-medium text-erro" : "text-slate-500"}>{a.dias > 0 ? `${a.dias} dia(s)` : a.dias === 0 ? "hoje" : `em ${-a.dias} dia(s)`}</Td><Td>{can.operacoes(s) && <form action={abrirPreventiva}><input type="hidden" name="assetId" value={a.id} /><Btn small kind="ghost">Abrir preventiva</Btn></form>}</Td></tr>)}</Table></Card>
          {p.garantias.length > 0 && <Card title="Garantias vencendo em 60 dias" className="sm:col-span-2"><Table head={["Ativo", "Unidade", "Garantia até"]}>{p.garantias.map((g, i) => <tr key={i}><Td>{g.nome}</Td><Td>{g.unidade}</Td><Td>{fmtData(g.garantia_ate)}</Td></tr>)}</Table></Card>}
          <Card title="Satisfação com os atendimentos (90 dias)"><p className="text-3xl font-semibold text-navy">{p.aval.media ?? "—"}<span className="text-base font-normal text-slate-500"> / 5</span></p><p className="text-xs text-slate-500">{p.aval.n} avaliação(ões) dos solicitantes</p></Card>
        </div>
        <NovoChamadoForm s={s} voltar="/operacoes" cfg={cfg.operacoes} />
      </div>
    </Page>
  );
}
