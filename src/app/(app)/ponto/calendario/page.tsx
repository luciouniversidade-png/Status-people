import { requireStaff, can } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Table, Td, Flash, Field, Btn, Input, Select } from "@/components/ui";
import { fmtData, hoje } from "@/lib/utils";
import { CAL_TIPOS } from "@/lib/ponto";
import { salvarDiaCalendario, excluirDiaCalendario } from "../actions";

export const dynamic = "force-dynamic";

export default async function Calendario({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const sp = await searchParams; const ano = sp.ano ? Number(sp.ano) : Number(hoje().slice(0, 4));
  const rows = await sql<{ id: number; data: string; tipo: string; descricao: string | null; publico: string; unidade: string | null }[]>`SELECT c.id, c.data::text, c.tipo, c.descricao, c.publico, u.nome AS unidade FROM calendar_days c LEFT JOIN units u ON u.id=c.unit_id WHERE extract(year FROM c.data)=${ano} ORDER BY c.data, c.publico`;
  const units = await db.select().from(schema.units).orderBy(asc(schema.units.nome));
  // agrupa períodos contíguos do mesmo tipo/publico
  const grupos: { ini: string; fim: string; tipo: string; descricao: string | null; publico: string; unidade: string | null; ids: number[] }[] = [];
  for (const r of rows) { const g = grupos[grupos.length - 1]; const prox = g && new Date(new Date(g.fim + "T00:00:00Z").getTime() + 86400000).toISOString().slice(0, 10); if (g && g.tipo === r.tipo && g.publico === r.publico && g.descricao === r.descricao && prox === r.data) { g.fim = r.data; g.ids.push(r.id); } else grupos.push({ ini: r.data, fim: r.data, tipo: r.tipo, descricao: r.descricao, publico: r.publico, unidade: r.unidade, ids: [r.id] }); }
  return (
    <Page title={`Calendário institucional ${ano}`} sub="Feriados, dias não letivos, recesso, férias coletivas e dispensas. Define a carga esperada de cada dia na folha de ponto.">
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-4 flex items-end gap-2"><Field label="Ano"><Input name="ano" type="number" defaultValue={ano} className="w-28" /></Field><Btn kind="ghost">Ver</Btn></form>
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Table head={["Período", "Tipo", "Descrição", "Aplica-se a", "Unidade", ""]} empty={`Nenhum dia cadastrado em ${ano}.`}>
          {grupos.map((g, i) => <tr key={i}><Td className="whitespace-nowrap">{g.ini === g.fim ? fmtData(g.ini) : `${fmtData(g.ini)} – ${fmtData(g.fim)}`}</Td><Td>{CAL_TIPOS[g.tipo] ?? g.tipo}</Td><Td>{g.descricao ?? "—"}</Td><Td className="text-xs">{g.publico === "TODOS" ? "Todos" : g.publico === "DOCENTE" ? "Docentes" : "Administrativos"}</Td><Td>{g.unidade ?? "rede"}</Td>
            <Td>{can.configurar(s) && <form action={excluirDiaCalendario} className="flex gap-1">{g.ids.slice(0, 1).map(id => <input key={id} type="hidden" name="id" value={id} />)}{g.ids.length === 1 ? <Btn small danger>Excluir</Btn> : <span className="text-xs text-slate-400">{g.ids.length} dias — exclua por dia em Configurações avançadas ou recadastre o período</span>}</form>}</Td></tr>)}
        </Table>
        {can.configurar(s) && <Card title="Adicionar dia ou período">
          <form action={salvarDiaCalendario} className="space-y-2">
            <div className="grid grid-cols-2 gap-2"><Field label="De"><Input name="data" type="date" required /></Field><Field label="Até (opcional)"><Input name="dataFim" type="date" /></Field></div>
            <Field label="Tipo"><Select name="tipo" defaultValue="FERIADO">{Object.entries(CAL_TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Descrição"><Input name="descricao" /></Field>
            <Field label="Aplica-se a"><Select name="publico" defaultValue="TODOS"><option value="TODOS">Todos</option><option value="DOCENTE">Docentes</option><option value="ADMINISTRATIVO">Administrativos</option></Select></Field>
            <Field label="Unidade"><Select name="unitId" defaultValue=""><option value="">Rede inteira</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>
            <Btn small>Salvar</Btn>
            <p className="text-xs text-slate-500">Feriado, não letivo, férias coletivas, dispensa e ponto facultativo zeram a carga do dia. Recesso mantém a carga e desconta do banco se não trabalhado.</p>
          </form>
        </Card>}
      </div>
    </Page>
  );
}
