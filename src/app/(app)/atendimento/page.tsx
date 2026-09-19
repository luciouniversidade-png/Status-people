import Link from "next/link";
import { requireMatriculas, scopeUnit } from "@/lib/auth";
import { db, schema } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Stat, Table, Td, Badge, Flash, Select, Field, Btn, Input } from "@/components/ui";
import { fmtMin, getSettings } from "@/lib/utils";
import { estatisticas, escalarVencidos, riscoFamilias, CASE_TIPO_LABEL } from "@/lib/atendimento";
import { mesRef } from "@/lib/relatorio";

export const dynamic = "force-dynamic";

export default async function Painel({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireMatriculas(); const sp = await searchParams; await getSettings();
  await escalarVencidos();
  const scope = scopeUnit(s); const unitId = scope ?? (sp.unidade ? Number(sp.unidade) : null); const m = mesRef(sp.mes);
  const [st, risco, units] = await Promise.all([estatisticas(unitId, m.ini, m.fim), riscoFamilias(unitId), scope ? Promise.resolve([]) : db.select().from(schema.units).orderBy(asc(schema.units.nome))]);
  const altos = risco.filter(r => r.nivel === "ALTO"); const taxa = st.ret.retidos + st.ret.perdidos ? Math.round(100 * st.ret.retidos / (st.ret.retidos + st.ret.perdidos)) : null;
  void fmtMin;
  return (
    <Page title="Atendimento e retenção" sub={`Painel de ${m.rotulo.toLowerCase()} · casos, reclamações, NPS e risco de saída`}
      actions={<><Btn kind="ghost" href="/atendimento/risco">Famílias em risco</Btn><Btn kind="ghost" href="/atendimento/pesquisas">Pesquisas</Btn><Btn href="/atendimento/casos">Casos</Btn></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-4 flex flex-wrap items-end gap-2 rounded-md border border-line bg-white p-3">
        {!scope && <Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Todas</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
        <Field label="Mês"><Input type="month" name="mes" defaultValue={m.ini.slice(0, 7)} /></Field><Btn kind="ghost">Ver</Btn>
      </form>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Casos abertos" value={st.cas.abertos} href="/atendimento/casos" />
        <Stat label="Com SLA vencido" value={<span className={st.cas.atrasados ? "text-erro" : ""}>{st.cas.atrasados}</span>} hint={`${st.cas.escalados} escalado(s)`} href="/atendimento/casos?filtro=ATRASADOS" />
        <Stat label="Resolvidos no mês" value={st.cas.resolvidos_periodo} hint={st.cas.tempo_medio_h !== null ? `tempo médio ${st.cas.tempo_medio_h} h` : undefined} />
        <Stat label="NPS do mês" value={st.nps.nps === null ? "—" : <span className={st.nps.nps >= 50 ? "text-ok" : st.nps.nps >= 0 ? "text-aviso" : "text-erro"}>{st.nps.nps}</span>} hint={st.nps.n ? `${st.nps.n} respostas · ${st.nps.promotores} promotores · ${st.nps.detratores} detratores` : "sem respostas"} href="/atendimento/pesquisas" />
        <Stat label="Retenção no mês" value={taxa === null ? "—" : `${taxa}%`} hint={`${st.ret.retidos} retidas · ${st.ret.perdidos} perdidas · ${st.ret.abertos} em andamento`} href="/atendimento/casos?tipo=SAIDA" />
        <Stat label="Famílias em risco alto" value={<span className={altos.length ? "text-erro" : ""}>{altos.length}</span>} hint={`${risco.length} com algum sinal`} href="/atendimento/risco" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Card title="Casos do mês por tipo">
          <Table head={["Tipo", "Registrados", "Ainda abertos"]} empty="Nenhum caso no mês.">{st.porTipo.map(t => <tr key={t.tipo}><Td>{CASE_TIPO_LABEL[t.tipo] ?? t.tipo}</Td><Td>{t.n}</Td><Td>{t.abertos || "—"}</Td></tr>)}</Table>
        </Card>
        <Card title="Reclamações por categoria (mês)">
          <Table head={["Categoria", "Quantidade", "Graves"]} empty="Nenhuma reclamação no mês.">{st.porCat.map(c => <tr key={c.categoria}><Td>{c.categoria}</Td><Td>{c.n}</Td><Td className={c.graves ? "text-erro" : ""}>{c.graves || "—"}</Td></tr>)}</Table>
        </Card>
        <Card title="Famílias em risco — maiores pontuações" actions={<Link href="/atendimento/risco" className="text-xs text-acao">Ver todas</Link>}>
          <Table head={["Aluno", "Unidade", "Pontos", "Nível", "Sinais"]} empty="Nenhum sinal de risco registrado.">
            {risco.slice(0, 8).map(r => <tr key={r.studentId}><Td><Link className="text-acao" href={`/matriculas/alunos/${r.studentId}#atendimento`}>{r.nome}</Link></Td><Td>{r.unidade}</Td><Td className="tabular-nums font-medium">{r.pontos}</Td><Td><Badge v={r.nivel === "ALTO" ? "REJEITADA" : r.nivel === "MEDIO" ? "PENDENTE" : "ATIVO"} label={r.nivel === "ALTO" ? "Alto" : r.nivel === "MEDIO" ? "Médio" : "Baixo"} /></Td><Td className="text-xs text-slate-600">{r.fatores.map(f => f.texto).join(" · ")}</Td></tr>)}
          </Table>
        </Card>
        <Card title="Satisfação (CSAT) no mês">
          <p className="text-3xl font-semibold text-navy">{st.csat.media ?? "—"}<span className="text-base font-normal text-slate-500"> / 5</span></p><p className="text-xs text-slate-500">{st.csat.n} avaliação(ões) após atendimento</p>
        </Card>
      </div>
    </Page>
  );
}
