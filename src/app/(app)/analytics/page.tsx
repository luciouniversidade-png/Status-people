import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff, scopeUnit, can } from "@/lib/auth";
import { db, schema } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Table, Td, Badge, Flash, Field, Select, Btn, Stat, Input } from "@/components/ui";
import { fmtMin } from "@/lib/utils";
import { peopleHealth, sinaisPessoas } from "@/lib/talentos-analytics";
import { fmtBRL } from "@/lib/talento";

export const dynamic = "force-dynamic";

export default async function Analytics({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); if (!["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role)) redirect("/"); const sp = await searchParams;
  const scope = scopeUnit(s); const unitId = scope ?? (sp.unidade ? Number(sp.unidade) : null); const dissidio = Number(sp.dissidio ?? 0) || 0; const novos = Number(sp.novos ?? 0) || 0;
  const [ph, risco, units, porUnidade] = await Promise.all([peopleHealth(unitId), sinaisPessoas(unitId), scope ? Promise.resolve([]) : db.select().from(schema.units).orderBy(asc(schema.units.nome)), scope ? Promise.resolve([]) : (async () => { const us = await db.select().from(schema.units).orderBy(asc(schema.units.nome)); return Promise.all(us.map(async u => ({ nome: u.nome, id: u.id, ph: await peopleHealth(u.id) }))); })()]);
  const emRisco = risco.filter(r => r.nivel !== "BAIXO").sort((a, b) => b.pontos - a.pontos); const verSal = can.verSalario(s);
  const folhaProj = ph.custo.folha ? ph.custo.folha * (1 + dissidio / 100) + novos * (ph.custo.media ?? 0) * (1 + dissidio / 100) : null;
  void fmtMin;
  return (
    <Page title="People Analytics" sub="People Health Score explicável, movimentação, absenteísmo, custo de pessoal e risco de saída — por unidade e rede." actions={<><Btn kind="ghost" href="/analytics/assistente">Perguntar ao People AI</Btn><Btn kind="ghost" href="/sucessao">Sucessão</Btn></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {!scope && <form className="mb-4 flex items-end gap-2"><Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Rede</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Btn kind="ghost">Ver</Btn></form>}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="People Health" value={<span className={ph.score >= 80 ? "text-ok" : ph.score >= 60 ? "text-aviso" : "text-erro"}>{ph.score}</span>} hint={ph.fatores.length ? `${ph.fatores.length} indicador(es) fora da meta` : "todos os indicadores na meta"} />
        <Stat label="Turnover 12 meses" value={ph.turnover === null ? "—" : `${ph.turnover}%`} hint={`${ph.desligados12} desligamento(s) · ${ph.hc.admitidos_12} admissões`} />
        <Stat label="Absenteísmo 90 dias" value={ph.absenteismo === null ? "—" : `${ph.absenteismo}%`} hint={ph.absenteismo === null ? "sem folhas de ponto" : `${ph.faltas90} falta(s)`} />
        <Stat label="eNPS" value={ph.enps ?? "—"} hint={ph.enpsNome ?? "sem pesquisa encerrada"} />
        <Stat label="Desempenho médio" value={ph.desempenho ? ph.desempenho.toFixed(2) : "—"} hint={ph.ciclo ?? "sem ciclo encerrado"} />
        <Stat label="Treinamento obrigatório" value={ph.treinamento === null ? "—" : `${ph.treinamento}%`} hint={`${ph.vagas} vaga(s) aberta(s) · ${ph.vagasPct}% do quadro`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Card title="Por que este People Health?">{ph.fatores.length === 0 ? <p className="text-sm text-slate-600">Nenhum desconto. Indicadores sem medição não descontam: {Object.entries(ph.semMedicao).filter(([, v]) => v).map(([k]) => k).join(", ") || "todos medidos"}.</p> : <ul className="space-y-1 text-sm">{ph.fatores.map((f, i) => <li key={i}><span className="inline-block w-10 tabular-nums text-erro">{f.peso}</span>{f.texto}</li>)}</ul>}<p className="mt-2 text-xs text-slate-500">Parte de 100. Metas e pesos em Configurações (analytics). Indicadores sem dados ainda ({Object.entries(ph.semMedicao).filter(([, v]) => v).map(([k]) => k).join(", ") || "nenhum"}) não descontam.</p></Card>
        {!scope && <Card title="Por unidade"><Table head={["Unidade", "Health", "Ativos", "Turnover", "Absent.", "eNPS", "Treinamento"]}>{porUnidade.map(u => <tr key={u.id}><Td><Link className="text-acao" href={`/analytics?unidade=${u.id}`}>{u.nome}</Link></Td><Td className={`font-medium ${u.ph.score >= 80 ? "text-ok" : u.ph.score >= 60 ? "text-aviso" : "text-erro"}`}>{u.ph.score}</Td><Td>{u.ph.hc.ativos}</Td><Td>{u.ph.turnover === null ? "—" : `${u.ph.turnover}%`}</Td><Td>{u.ph.absenteismo === null ? "—" : `${u.ph.absenteismo}%`}</Td><Td>{u.ph.enps ?? "—"}</Td><Td>{u.ph.treinamento === null ? "—" : `${u.ph.treinamento}%`}</Td></tr>)}</Table></Card>}
        <Card title="Movimentação nos últimos 12 meses"><Table head={["Mês", "Admissões", "Desligamentos", "Saldo"]}>{ph.meses.map(m => <tr key={m.mes}><Td>{m.mes.split("-").reverse().join("/")}</Td><Td className="text-ok">{m.admissoes || "—"}</Td><Td className="text-erro">{m.desligamentos || "—"}</Td><Td className="tabular-nums">{m.admissoes - m.desligamentos > 0 ? `+${m.admissoes - m.desligamentos}` : m.admissoes - m.desligamentos || "—"}</Td></tr>)}</Table></Card>
        {verSal && <Card title="Custo de pessoal (estimado pelos salários cadastrados)">
          <div className="grid grid-cols-2 gap-3 text-sm"><div><div className="text-xs text-slate-500">Folha mensal base</div><div className="text-xl font-semibold text-navy">{fmtBRL(ph.custo.folha)}</div><div className="text-xs text-slate-500">{ph.custo.com_salario} de {ph.hc.ativos} ativos com salário</div></div><div><div className="text-xs text-slate-500">Custo estimado de repor uma pessoa</div><div className="text-xl font-semibold text-navy">{fmtBRL(ph.custoReposicao)}</div><div className="text-xs text-slate-500">≈ 3 salários médios (recrutar, treinar, perda de produtividade)</div></div></div>
          <form className="mt-3 grid grid-cols-[1fr_1fr_auto] items-end gap-2 border-t border-line pt-3">{unitId && <input type="hidden" name="unidade" value={unitId} />}<Field label="Simular dissídio (%)"><Input name="dissidio" type="number" step="0.1" defaultValue={dissidio || ""} /></Field><Field label="+ pessoas no quadro"><Input name="novos" type="number" min={0} defaultValue={novos || ""} /></Field><Btn small kind="ghost">Simular</Btn></form>
          {(dissidio || novos) ? <p className="mt-2 text-sm">Folha projetada: <b>{fmtBRL(folhaProj)}</b> ({fmtBRL((folhaProj ?? 0) - (ph.custo.folha ?? 0))} a mais por mês · encargos não incluídos)</p> : null}
          <Table head={["Cargo", "Pessoas", "Folha"]}>{ph.porCargo.map(c => <tr key={c.cargo}><Td>{c.cargo}</Td><Td>{c.n}</Td><Td className="tabular-nums">{fmtBRL(c.folha)}</Td></tr>)}</Table>
        </Card>}
        <Card title={`People Risk Center — risco de saída (${emRisco.length})`} actions={<Btn small kind="ghost" href="/api/export/risco-pessoas">CSV</Btn>}>
          <Table head={["Colaborador", "Cargo · unidade", "Pontos", "Nível", "Sinais"]} empty="Ninguém com sinais de risco.">{emRisco.slice(0, 15).map(r => <tr key={r.id}><Td><Link className="text-acao" href={`/colaboradores/${r.id}`}>{r.nome}</Link></Td><Td className="text-xs">{r.cargo ?? "—"} · {r.unidade}</Td><Td className="tabular-nums font-medium">{r.pontos}</Td><Td><Badge v={r.nivel === "ALTO" ? "REJEITADA" : "PENDENTE"} label={r.nivel === "ALTO" ? "Alto" : "Médio"} /></Td><Td className="text-xs text-slate-600">{r.fatores.map(f => f.texto).join(" · ")}</Td></tr>)}</Table>
          <p className="mt-2 text-xs text-slate-500">Sinais: salário abaixo da faixa, alto desempenho sem reajuste, faltas, débito no banco, PDI atrasado, treinamento vencido, pouco tempo de casa, sem 1:1. É um alerta para conversar — não um rótulo.</p>
        </Card>
      </div>
    </Page>
  );
}
