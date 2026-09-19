import { requireSession, scopeUnit, can } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Table, Td, Badge, Flash, Field, Select, Btn, Input, Textarea } from "@/components/ui";
import { fmtData, getSettings, hoje } from "@/lib/utils";
import { registrarVistoria } from "../actions";

export const dynamic = "force-dynamic";

export default async function Vistorias({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams; const cfg = await getSettings(); const scope = scopeUnit(s); const unitId = scope ?? (sp.unidade ? Number(sp.unidade) : null); const tipo = sp.tipo ?? Object.keys(cfg.operacoes.checklists)[0];
  const rows = await sql<{ id: number; data: string; unidade: string; ambiente: string; tipo: string; conformes: number; total: number; inspetor: string | null; itens: { item: string; ok: boolean; obs: string | null }[]; chamados: number }[]>`SELECT i.id, i.data::text, u.nome AS unidade, i.ambiente, i.tipo, i.conformes, i.total, us.nome AS inspetor, i.itens, (SELECT count(*) FROM work_orders w WHERE w.inspection_id=i.id)::int AS chamados FROM inspections i JOIN units u ON u.id=i.unit_id LEFT JOIN users us ON us.id=i.inspetor_user_id WHERE 1=1 ${unitId === null ? sql`` : sql`AND i.unit_id=${unitId}`} ORDER BY i.data DESC, i.id DESC LIMIT 200`;
  const units = await db.select().from(schema.units).orderBy(asc(schema.units.nome)); const checklists = cfg.operacoes.checklists as Record<string, string[]>; const itens = checklists[tipo] ?? []; const gest = can.operacoes(s);
  const ultimaPorAmbiente = new Map<string, typeof rows[number]>(); rows.forEach(r => { const k = `${r.unidade}|${r.ambiente}`; if (!ultimaPorAmbiente.has(k)) ultimaPorAmbiente.set(k, r); });
  return (
    <Page title="Vistorias" sub="Checklists por tipo de ambiente. Item não conforme pode virar chamado automaticamente." actions={gest ? <Btn kind="ghost" href="/api/export/vistorias">Exportar CSV</Btn> : undefined}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className={`grid gap-4 ${gest ? "lg:grid-cols-[1fr_380px]" : ""} lg:items-start`}>
        <div className="space-y-4">
          {!scope && <form className="flex items-end gap-2"><Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Todas</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Btn kind="ghost">Filtrar</Btn></form>}
          <Card title="Situação por ambiente (última vistoria)"><Table head={["Unidade", "Ambiente", "Checklist", "Última", "Conformidade", "Inspetor"]} empty="Nenhuma vistoria registrada.">{[...ultimaPorAmbiente.values()].map(r => { const pct = Math.round(100 * r.conformes / (r.total || 1)); return <tr key={r.id}><Td>{r.unidade}</Td><Td className="font-medium">{r.ambiente}</Td><Td className="text-xs">{r.tipo}</Td><Td>{fmtData(r.data)}</Td><Td><Badge v={pct === 100 ? "APROVADA" : pct >= 80 ? "PENDENTE" : "REJEITADA"} label={`${pct}% · ${r.conformes}/${r.total}`} /></Td><Td className="text-xs">{r.inspetor ?? "—"}</Td></tr>; })}</Table></Card>
          <Card title="Histórico"><Table head={["Data", "Unidade · ambiente", "Checklist", "Conformes", "Não conformes", "Chamados"]} empty="—">{rows.map(r => <tr key={r.id}><Td>{fmtData(r.data)}</Td><Td>{r.unidade} · {r.ambiente}</Td><Td className="text-xs">{r.tipo}</Td><Td className="text-ok">{r.conformes}/{r.total}</Td><Td className="text-xs text-erro">{r.itens.filter(i => !i.ok).map(i => i.item).join(" · ") || "—"}</Td><Td>{r.chamados || "—"}</Td></tr>)}</Table></Card>
        </div>
        {gest && <Card title="Nova vistoria">
          <form className="mb-3 flex items-end gap-2"><Field label="Checklist"><Select name="tipo" defaultValue={tipo}>{Object.keys(checklists).map(k => <option key={k}>{k}</option>)}</Select></Field>{unitId && <input type="hidden" name="unidade" value={unitId} />}<Btn small kind="ghost">Trocar</Btn></form>
          <form action={registrarVistoria} className="space-y-2"><input type="hidden" name="tipo" value={tipo} />
            <div className="grid grid-cols-2 gap-2"><Field label="Unidade"><Select name="unitId" defaultValue={scope ?? ""} required>{units.filter(u => scope === null || u.id === scope).map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Field label="Data"><Input name="data" type="date" defaultValue={hoje()} /></Field></div>
            <Field label="Ambiente"><Input name="ambiente" required list="amb" placeholder="Sala 5, Banheiro térreo…" /><datalist id="amb">{cfg.operacoes.ambientesPadrao.map(a => <option key={a} value={a} />)}</datalist></Field>
            <div className="divide-y divide-line rounded border border-line">{itens.map((it, i) => <div key={i} className="flex items-start gap-2 px-2 py-1.5 text-xs"><label className="flex items-center gap-2"><input type="checkbox" name={`ok_${i}`} value="1" defaultChecked /> <span>{it}</span></label><input name={`obs_${i}`} placeholder="obs. se não conforme" className="ml-auto w-36 rounded border border-line px-1 py-0.5 text-xs" /></div>)}</div>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="abrirChamados" value="1" defaultChecked /> Abrir um chamado para cada item não conforme</label>
            <Field label="Observações"><Textarea name="obs" className="min-h-[40px]" /></Field><Btn small>Registrar vistoria</Btn></form></Card>}
      </div>
    </Page>
  );
}
