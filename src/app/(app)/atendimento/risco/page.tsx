import Link from "next/link";
import { requireMatriculas, scopeUnit, can } from "@/lib/auth";
import { db, schema } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Table, Td, Badge, Flash, Select, Field, Btn, Textarea } from "@/components/ui";
import { getSettings } from "@/lib/utils";
import { riscoFamilias } from "@/lib/atendimento";
import { importarInadimplencia } from "../actions";

export const dynamic = "force-dynamic";

export default async function Risco({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireMatriculas(); const sp = await searchParams; const cfg = await getSettings();
  const scope = scopeUnit(s); const unitId = scope ?? (sp.unidade ? Number(sp.unidade) : null); const nivel = sp.nivel ?? "";
  const [risco, units] = await Promise.all([riscoFamilias(unitId), scope ? Promise.resolve([]) : db.select().from(schema.units).orderBy(asc(schema.units.nome))]);
  const rows = nivel ? risco.filter(r => r.nivel === nivel) : risco;
  return (
    <Page title="Famílias em risco de saída" sub="Pontuação por sinais objetivos: pedido de saída, reclamações, SLA vencido, NPS detrator, inadimplência, ausência de rematrícula. Cada ponto mostra o motivo." actions={<Btn kind="ghost" href="/api/export/risco">Exportar CSV</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px] lg:items-start">
        <div>
          <form className="mb-3 flex flex-wrap items-end gap-2">
            {!scope && <Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Todas</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
            <Field label="Nível"><Select name="nivel" defaultValue={nivel}><option value="">Todos</option><option value="ALTO">Alto (≥ 50)</option><option value="MEDIO">Médio (25–49)</option><option value="BAIXO">Baixo</option></Select></Field><Btn kind="ghost">Filtrar</Btn>
          </form>
          <Table head={["Aluno", "Unidade", "Série", "Responsável", "Pontos", "Nível", "Por que este score?"]} empty="Nenhuma família com sinal de risco.">
            {rows.map(r => <tr key={r.studentId}><Td><Link className="font-medium text-acao" href={`/matriculas/alunos/${r.studentId}#atendimento`}>{r.nome}</Link></Td><Td>{r.unidade}</Td><Td>{r.serie ?? "—"}</Td><Td className="text-xs">{r.responsavel ?? "—"}<br />{r.telefone ?? ""}</Td><Td className="tabular-nums font-medium">{r.pontos}</Td><Td><Badge v={r.nivel === "ALTO" ? "REJEITADA" : r.nivel === "MEDIO" ? "PENDENTE" : "ATIVO"} label={r.nivel === "ALTO" ? "Alto" : r.nivel === "MEDIO" ? "Médio" : "Baixo"} /></Td><Td className="text-xs text-slate-600">{r.fatores.map(f => `${f.peso > 0 ? "+" : ""}${f.peso} ${f.texto}`).join(" · ")}</Td></tr>)}
          </Table>
        </div>
        <div className="space-y-4">
          <Card title="Pesos do score"><ul className="space-y-1 text-xs text-slate-700"><li>+50 pedido de saída em aberto</li><li>+30 reclamação em aberto · +15 grave nos últimos 90 dias</li><li>+25 NPS detrator (nota ≤ 6) nos últimos 6 meses</li><li>+25 inadimplência registrada</li><li>+20 caso com SLA vencido</li><li>+20 sem reserva/matrícula {cfg.matriculas.anoLetivo} (a partir de {cfg.atendimento.riscoRematriculaApos.split("-").reverse().join("/")})</li><li>+15 observação manual de risco</li><li>−10 elogio recente</li><li>Alto ≥ 50 · Médio 25–49 · Baixo &lt; 25</li></ul></Card>
          {can.editar(s) && <Card title="Inadimplência (do ActiveSoft)"><form action={importarInadimplencia} className="space-y-2"><Field label="Nomes dos alunos inadimplentes, um por linha"><Textarea name="csv" className="min-h-[120px] font-mono text-xs" placeholder={"Ana Souza\nBruno Lima"} /></Field><Field label="Ou envie o arquivo (.xlsx/.xls/.csv)"><input type="file" name="arquivo" accept=".xlsx,.xls,.xlsm,.csv,.txt" className="block w-full rounded-md border border-line bg-white px-2 py-1.5 text-xs file:mr-2 file:rounded file:border-0 file:bg-acao file:px-2 file:py-1 file:text-xs file:text-white" /></Field><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="zerar" value="1" defaultChecked /> Limpar marcações anteriores antes de aplicar</label><Btn small>Aplicar lista</Btn></form></Card>}
        </div>
      </div>
    </Page>
  );
}
