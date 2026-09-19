import Link from "next/link";
import { requireStaff, scopeUnit, can } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { asc, desc } from "drizzle-orm";
import { Page, Card, Table, Td, Badge, Flash, Field, Input, Textarea, Select, Btn } from "@/components/ui";
import { fmtData, getSettings } from "@/lib/utils";
import { CYCLE_STATUS } from "@/lib/talento";
import { salvarCiclo } from "../talento/actions";

export const dynamic = "force-dynamic";

export default async function Desempenho({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const sp = await searchParams; const cfg = await getSettings(); const u = scopeUnit(s);
  const ciclos = await sql<{ id: number; nome: string; inicio: string; fim: string; status: string; unidade: string | null; total: number; concluidas: number; avaliadas: number; media: number | null }[]>`SELECT c.id, c.nome, c.inicio::text, c.fim::text, c.status, un.nome AS unidade, (SELECT count(*) FROM perf_reviews r WHERE r.cycle_id=c.id)::int AS total, (SELECT count(*) FROM perf_reviews r WHERE r.cycle_id=c.id AND r.status='CONCLUIDA')::int AS concluidas, (SELECT count(*) FROM perf_reviews r WHERE r.cycle_id=c.id AND r.status IN ('AVALIADA','CALIBRADA','CONCLUIDA'))::int AS avaliadas, (SELECT avg(nota_final)::float FROM perf_reviews r WHERE r.cycle_id=c.id) AS media FROM perf_cycles c LEFT JOIN units un ON un.id=c.unit_id WHERE 1=1 ${u === null ? sql`` : sql`AND (c.unit_id IS NULL OR c.unit_id=${u})`} ORDER BY c.inicio DESC`;
  const minhas = await sql<{ id: number; nome: string; ciclo: string; status: string; unidade: string }[]>`SELECT r.id, e.nome, c.nome AS ciclo, r.status, un.nome AS unidade FROM perf_reviews r JOIN employees e ON e.id=r.employee_id JOIN perf_cycles c ON c.id=r.cycle_id JOIN units un ON un.id=e.unit_id WHERE c.status IN ('ABERTO','CALIBRACAO') AND (r.avaliador_user_id=${s.id} ${u === null ? sql`` : sql`OR e.unit_id=${u}`}) AND r.status IN ('PENDENTE','AUTOAVALIADA') ORDER BY e.nome LIMIT 100`;
  const units = await db.select().from(schema.units).orderBy(asc(schema.units.nome));
  return (
    <Page title="Desempenho" sub="Ciclos de avaliação: autoavaliação, avaliação do gestor por competências, potencial, calibração, Nine Box e PDI.">
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className={`grid gap-4 ${can.editar(s) ? "lg:grid-cols-[1fr_340px]" : ""} lg:items-start`}>
        <div className="space-y-4">
          <Table head={["Ciclo", "Período", "Unidade", "Fase", "Avaliações", "Média"]} empty="Nenhum ciclo. Crie o primeiro ao lado.">
            {ciclos.map(c => <tr key={c.id}><Td><Link className="font-medium text-acao" href={`/desempenho/ciclos/${c.id}`}>{c.nome}</Link></Td><Td className="whitespace-nowrap text-xs">{fmtData(c.inicio)} – {fmtData(c.fim)}</Td><Td>{c.unidade ?? "rede"}</Td><Td><Badge v={c.status === "ENCERRADO" ? "APROVADA" : c.status === "ABERTO" ? "EM_ADMISSAO" : c.status === "CALIBRACAO" ? "PENDENTE" : "EM_AQUISICAO"} label={CYCLE_STATUS[c.status]} /></Td><Td className="text-xs">{c.total ? `${c.avaliadas}/${c.total} avaliadas · ${c.concluidas} concluídas` : "—"}</Td><Td className="tabular-nums">{c.media ? c.media.toFixed(2) : "—"}</Td></tr>)}
          </Table>
          {minhas.length > 0 && <Card title={`Avaliações que aguardam você (${minhas.length})`}><Table head={["Colaborador", "Unidade", "Ciclo", "Situação"]}>{minhas.map(m => <tr key={m.id}><Td><Link className="text-acao" href={`/desempenho/avaliacoes/${m.id}`}>{m.nome}</Link></Td><Td>{m.unidade}</Td><Td className="text-xs">{m.ciclo}</Td><Td><Badge v="PENDENTE" label={m.status === "PENDENTE" ? "aguarda gestor" : "autoavaliação feita"} /></Td></tr>)}</Table></Card>}
        </div>
        {can.editar(s) && <Card title="Novo ciclo"><form action={salvarCiclo} className="space-y-2">
          <Field label="Nome"><Input name="nome" required placeholder="Ciclo 2026.2" /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Início"><Input name="inicio" type="date" required /></Field><Field label="Fim"><Input name="fim" type="date" required /></Field></div>
          <Field label="Unidade"><Select name="unitId" defaultValue=""><option value="">Rede inteira</option>{units.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field>
          <Field label="Competências avaliadas (uma por linha)"><Textarea name="competencias" className="min-h-[130px]" defaultValue={cfg.desempenho.competencias.join("\n")} /></Field>
          <Field label="Descrição / orientações"><Input name="descricao" /></Field>
          <Btn small>Criar ciclo</Btn><p className="text-xs text-slate-500">Depois: gerar as avaliações (uma por colaborador ativo, com o gestor da ficha como avaliador).</p></form></Card>}
      </div>
    </Page>
  );
}
