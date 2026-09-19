import Link from "next/link";
import { requireStaff, scopeUnit, can } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Table, Td, Badge, Flash, Field, Input, Select, Textarea, Btn, Stat } from "@/components/ui";
import { fmtData, getSettings } from "@/lib/utils";
import { SURVEY_TIPO, SURVEY_STATUS } from "@/lib/clima-academy";
import { criarPesquisa } from "../clima-academy/actions";

export const dynamic = "force-dynamic";

export default async function Clima({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const sp = await searchParams; const cfg = await getSettings(); const u = scopeUnit(s);
  const rows = await sql<{ id: number; nome: string; tipo: string; inicio: string; fim: string; status: string; unidade: string | null; respostas: number; ativos: number; enps: number | null }[]>`SELECT sv.id, sv.nome, sv.tipo, sv.inicio::text, sv.fim::text, sv.status, un.nome AS unidade, (SELECT count(*) FROM climate_responses r WHERE r.survey_id=sv.id)::int AS respostas, (SELECT count(*) FROM employees e WHERE e.situacao='ATIVO' AND (sv.unit_id IS NULL OR e.unit_id=sv.unit_id))::int AS ativos,
      (SELECT CASE WHEN count(*) >= sv.minimo_anonimato THEN round(100.0*(count(*) FILTER (WHERE (r.respostas->>'enps')::int >= 9) - count(*) FILTER (WHERE (r.respostas->>'enps')::int <= 6))/count(*)) END::int FROM climate_responses r WHERE r.survey_id=sv.id AND r.respostas ? 'enps') AS enps
    FROM climate_surveys sv LEFT JOIN units un ON un.id=sv.unit_id WHERE 1=1 ${u === null ? sql`` : sql`AND (sv.unit_id IS NULL OR sv.unit_id=${u})`} ORDER BY sv.inicio DESC`;
  const units = await db.select().from(schema.units).orderBy(asc(schema.units.nome)); const ultimo = rows.find(r => r.enps !== null);
  return (
    <Page title="Clima e eNPS" sub="Pesquisas anônimas por link. Resultados só aparecem com o mínimo de respostas por recorte — ninguém é identificado.">
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="eNPS mais recente" value={ultimo ? <span className={ultimo.enps! >= 50 ? "text-ok" : ultimo.enps! >= 0 ? "text-aviso" : "text-erro"}>{ultimo.enps}</span> : "—"} hint={ultimo?.nome} />
        <Stat label="Pesquisas abertas" value={rows.filter(r => r.status === "ABERTA").length} />
        <Stat label="Participação da última" value={rows[0] && rows[0].ativos ? `${Math.round(100 * rows[0].respostas / rows[0].ativos)}%` : "—"} hint={rows[0] ? `${rows[0].respostas} de ${rows[0].ativos} ativos` : undefined} />
      </div>
      <div className={`grid gap-4 ${can.editar(s) ? "lg:grid-cols-[1fr_360px]" : ""} lg:items-start`}>
        <Table head={["Pesquisa", "Tipo", "Período", "Abrangência", "Situação", "Respostas", "Participação", "eNPS"]} empty="Nenhuma pesquisa. Crie a primeira ao lado.">
          {rows.map(r => <tr key={r.id}><Td><Link className="font-medium text-acao" href={`/clima/${r.id}`}>{r.nome}</Link></Td><Td className="text-xs">{SURVEY_TIPO[r.tipo]}</Td><Td className="whitespace-nowrap text-xs">{fmtData(r.inicio)} – {fmtData(r.fim)}</Td><Td>{r.unidade ?? "rede"}</Td><Td><Badge v={r.status === "ABERTA" ? "EM_ADMISSAO" : r.status === "ENCERRADA" ? "APROVADA" : "EM_AQUISICAO"} label={SURVEY_STATUS[r.status]} /></Td><Td>{r.respostas}</Td><Td>{r.ativos ? `${Math.round(100 * r.respostas / r.ativos)}%` : "—"}</Td><Td className={`font-medium ${r.enps === null ? "text-slate-400" : r.enps >= 50 ? "text-ok" : r.enps >= 0 ? "text-aviso" : "text-erro"}`}>{r.enps ?? "—"}</Td></tr>)}
        </Table>
        {can.editar(s) && <Card title="Nova pesquisa"><form action={criarPesquisa} className="space-y-2">
          <Field label="Nome"><Input name="nome" required placeholder="Clima 2026 · 2º semestre" /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Tipo"><Select name="tipo" defaultValue="CLIMA">{Object.entries(SURVEY_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Abrangência"><Select name="unitId" defaultValue=""><option value="">Rede inteira</option>{units.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field></div>
          <div className="grid grid-cols-2 gap-2"><Field label="Início"><Input name="inicio" type="date" required /></Field><Field label="Fim"><Input name="fim" type="date" required /></Field></div>
          <Field label="Perguntas (opcional — padrão: 8 dimensões + eNPS + comentário)" hint="Uma por linha: Dimensão | pergunta. Escala 1–5."><Textarea name="perguntas" className="min-h-[90px] text-xs" placeholder={"Liderança | Meu gestor me dá orientação clara.\nComunicação | Recebo as informações que preciso."} /></Field>
          <Field label="Mínimo de respostas para exibir um recorte"><Input name="minimoAnonimato" type="number" min={3} defaultValue={cfg.clima.minimoAnonimato} /></Field>
          <Btn small>Criar</Btn></form></Card>}
      </div>
    </Page>
  );
}
