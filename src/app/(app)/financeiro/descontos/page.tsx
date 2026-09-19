import { requireFinanceiro, scopeUnit } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Table, Td, Badge, Flash, Field, Select, Btn, Input, Stat } from "@/components/ui";
import { fmtData, fmtDataHora, getSettings } from "@/lib/utils";
import { DESC_STATUS } from "@/lib/financeiro";
import { solicitarDesconto, decidirDesconto } from "../actions";

export const dynamic = "force-dynamic";

export default async function Descontos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireFinanceiro(true); const sp = await searchParams; const cfg = await getSettings(); const scope = scopeUnit(s); const status = sp.status ?? "";
  const rows = await sql<{ id: number; aluno_nome: string; student_id: number | null; unidade: string; ano: number; tipo: string; percentual: number; motivo: string | null; validade_ate: string | null; status: string; solicitante: string | null; solicitante_id: number | null; aprovador: string | null; created_at: Date; motivo_decisao: string | null }[]>`SELECT d.id, d.aluno_nome, d.student_id, u.nome AS unidade, d.ano, d.tipo, d.percentual::float, d.motivo, d.validade_ate::text, d.status, us.nome AS solicitante, d.solicitante_user_id AS solicitante_id, ua.nome AS aprovador, d.created_at, d.motivo_decisao FROM discounts d JOIN units u ON u.id=d.unit_id LEFT JOIN users us ON us.id=d.solicitante_user_id LEFT JOIN users ua ON ua.id=d.aprovador_user_id WHERE 1=1 ${scope === null ? sql`` : sql`AND d.unit_id=${scope}`} ${status ? sql`AND d.status=${status}` : sql``} ORDER BY (d.status='SOLICITADO') DESC, d.created_at DESC LIMIT 300`;
  const [units, alunos, resumo] = await Promise.all([db.select().from(schema.units).orderBy(asc(schema.units.nome)), sql<{ id: number; nome: string; unidade: string | null }[]>`SELECT st.id, st.nome, u.nome AS unidade FROM students st LEFT JOIN units u ON u.id=st.unit_atual_id ${scope === null ? sql`` : sql`WHERE st.unit_atual_id=${scope}`} ORDER BY st.nome`, sql<{ tipo: string; n: number; pct: number }[]>`SELECT d.tipo, count(*)::int AS n, avg(d.percentual)::float AS pct FROM discounts d WHERE d.status='APROVADO' AND d.ano=${cfg.matriculas.anoLetivo} ${scope === null ? sql`` : sql`AND d.unit_id=${scope}`} GROUP BY d.tipo ORDER BY n DESC`]);
  const limite = (cfg.financeiro.alcadaDescontoPct as Record<string, number>)[s.role] ?? 0;
  return (
    <Page title="Descontos e bolsas" sub={`Todo desconto tem tipo, percentual, motivo, validade e quem aprovou. Sua alçada: até ${limite}% aprova na hora; acima, vai para quem tem alçada maior (${Object.entries(cfg.financeiro.alcadaDescontoPct).map(([k, v]) => `${k} ${v}%`).join(" · ")}).`} actions={<Btn kind="ghost" href="/api/export/descontos">Exportar CSV</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4"><Stat label="Aguardando aprovação" value={<span className={rows.some(r => r.status === "SOLICITADO") ? "text-aviso" : ""}>{rows.filter(r => r.status === "SOLICITADO").length}</span>} /><Stat label={`Aprovados ${cfg.matriculas.anoLetivo}`} value={resumo.reduce((a, r) => a + r.n, 0)} /><Stat label="Desconto médio" value={resumo.length ? `${Math.round(resumo.reduce((a, r) => a + r.pct * r.n, 0) / resumo.reduce((a, r) => a + r.n, 0))}%` : "—"} /><Stat label="Tipos" value={resumo.length} hint={resumo.map(r => `${r.tipo} ${r.n}`).join(" · ")} /></div>
      <div className="grid gap-4 lg:grid-cols-[1fr_340px] lg:items-start">
        <div>
          <form className="mb-3 flex items-end gap-2"><Field label="Situação"><Select name="status" defaultValue={status}><option value="">Todos</option>{Object.entries(DESC_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Btn kind="ghost">Filtrar</Btn></form>
          <Table head={["Aluno", "Unidade", "Ano", "Tipo", "%", "Motivo", "Validade", "Situação", "Solicitante", ""]} empty="Nenhum desconto registrado.">{rows.map(d => <tr key={d.id}><Td className="font-medium">{d.aluno_nome}</Td><Td>{d.unidade}</Td><Td>{d.ano}</Td><Td className="text-xs">{d.tipo}</Td><Td className="tabular-nums font-medium">{d.percentual}%</Td><Td className="text-xs">{d.motivo ?? "—"}</Td><Td className="text-xs">{fmtData(d.validade_ate)}</Td><Td><Badge v={d.status === "APROVADO" ? "APROVADA" : d.status === "SOLICITADO" ? "PENDENTE" : "REJEITADA"} label={DESC_STATUS[d.status]} />{d.aprovador && <div className="text-xs text-slate-500">{d.aprovador}{d.motivo_decisao ? `: ${d.motivo_decisao}` : ""}</div>}</Td><Td className="text-xs">{d.solicitante ?? "—"}<br />{fmtDataHora(d.created_at)}</Td>
            <Td>{d.status === "SOLICITADO" && d.percentual <= limite && d.solicitante_id !== s.id && <form action={decidirDesconto} className="flex gap-1"><input type="hidden" name="id" value={d.id} /><Btn small name="decisao" value="APROVADO">Aprovar</Btn><Btn small kind="ghost" name="decisao" value="REJEITADO">Rejeitar</Btn></form>}</Td></tr>)}</Table>
        </div>
        <Card title="Conceder / solicitar desconto"><form action={solicitarDesconto} className="space-y-2">
          <Field label="Aluno"><Select name="studentId" defaultValue=""><option value="">— (informe o nome abaixo)</option>{alunos.map(a => <option key={a.id} value={a.id}>{a.nome}{a.unidade ? ` · ${a.unidade}` : ""}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Nome (se não cadastrado)"><Input name="alunoNome" /></Field><Field label="Unidade"><Select name="unitId" defaultValue={scope ?? ""}><option value="">a do aluno</option>{units.filter(u => scope === null || u.id === scope).map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field></div>
          <div className="grid grid-cols-3 gap-2"><Field label="Tipo" className="col-span-2"><Select name="tipo">{cfg.financeiro.tiposDesconto.map(t => <option key={t}>{t}</option>)}</Select></Field><Field label="%"><Input name="percentual" type="number" step="0.5" min={0.5} max={100} required /></Field></div>
          <div className="grid grid-cols-2 gap-2"><Field label="Ano"><Input name="ano" type="number" defaultValue={cfg.matriculas.anoLetivo} /></Field><Field label="Validade"><Input name="validadeAte" type="date" /></Field></div>
          <Field label="Motivo"><Input name="motivo" required /></Field>
          <Btn small>Registrar</Btn><p className="text-xs text-slate-500">Até {limite}% é concedido na hora; acima disso fica aguardando quem tem alçada. Quem solicita não aprova o próprio.</p></form></Card>
      </div>
      <p className="mt-3 text-xs text-slate-500">Descontos aprovados entram na receita prevista do aluno — veja em Receita.</p>
    </Page>
  );
}
