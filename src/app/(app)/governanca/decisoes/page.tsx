import { scopeUnit, can } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Table, Td, Badge, Flash, Field, Btn, Input, Select, Textarea } from "@/components/ui";
import { fmtData, getSettings, hoje } from "@/lib/utils";
import { DEC_STATUS } from "@/lib/governanca";
import { salvarDecisao, encerrarDecisao } from "../actions";
import { requireGestao, usuariosGestao } from "../_shared";

export const dynamic = "force-dynamic";

export default async function Decisoes({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireGestao(); const sp = await searchParams; const cfg = await getSettings(); const u = scopeUnit(s); const q = (sp.q ?? "").trim(); const status = sp.status ?? "VIGENTE"; const h = hoje();
  const rows = await sql<{ id: number; data: string; titulo: string; area: string; unidade: string | null; contexto: string | null; decisao: string; alternativas: string | null; consequencias: string | null; responsavel: string | null; status: string; revisar_em: string | null; link: string | null; substituida_por: number | null }[]>`
    SELECT d.id, d.data::text, d.titulo, d.area, un.nome AS unidade, d.contexto, d.decisao, d.alternativas, d.consequencias, us.nome AS responsavel, d.status, d.revisar_em::text, d.link, d.substituida_por
    FROM decisions d LEFT JOIN units un ON un.id=d.unit_id LEFT JOIN users us ON us.id=d.responsavel_user_id
    WHERE 1=1 ${u === null ? sql`` : sql`AND (d.unit_id IS NULL OR d.unit_id=${u})`} ${status ? sql`AND d.status=${status}` : sql``} ${q ? sql`AND (d.titulo ILIKE ${"%" + q + "%"} OR d.decisao ILIKE ${"%" + q + "%"} OR d.contexto ILIKE ${"%" + q + "%"})` : sql``} ORDER BY d.data DESC, d.id DESC LIMIT 300`;
  const [users, units] = await Promise.all([usuariosGestao(), db.select().from(schema.units).orderBy(asc(schema.units.nome))]);
  const podeRegistrar = can.aprovar(s, cfg.alcadas.pops);
  return (
    <Page title="Registro de decisões" sub="Decision Log da Direção: o que foi decidido, em que contexto, quais alternativas foram descartadas e quando revisar." actions={<Btn kind="ghost" href="/api/export/decisoes">Exportar CSV</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className={`grid gap-4 ${podeRegistrar ? "lg:grid-cols-[1fr_360px]" : ""} lg:items-start`}>
        <div>
          <form className="mb-3 flex flex-wrap items-end gap-2"><Field label="Buscar"><Input name="q" defaultValue={q} /></Field><Field label="Situação"><Select name="status" defaultValue={status}>{Object.entries(DEC_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}<option value="">Todas</option></Select></Field><Btn kind="ghost">Filtrar</Btn></form>
          <div className="space-y-3">{rows.length === 0 && <Card><p className="text-sm text-slate-500">Nenhuma decisão neste filtro.</p></Card>}
            {rows.map(d => <Card key={d.id} title={<span>{fmtData(d.data)} · {d.titulo} <span className="ml-2 font-normal text-slate-500">{d.area}{d.unidade ? ` · ${d.unidade}` : ""}</span></span>} actions={<span className="flex items-center gap-2"><Badge v={d.status === "VIGENTE" ? "APROVADA" : "CANCELADA"} label={DEC_STATUS[d.status]} />{d.status === "VIGENTE" && d.revisar_em && d.revisar_em <= h && <Badge v="PENDENTE" label="revisar" />}</span>}>
              <p className="text-sm font-medium text-ink">{d.decisao}</p>
              <dl className="mt-2 grid gap-2 text-xs text-slate-700 sm:grid-cols-3">{d.contexto && <div><dt className="font-medium text-slate-500">Contexto</dt><dd>{d.contexto}</dd></div>}{d.alternativas && <div><dt className="font-medium text-slate-500">Alternativas descartadas</dt><dd>{d.alternativas}</dd></div>}{d.consequencias && <div><dt className="font-medium text-slate-500">Consequências / custos</dt><dd>{d.consequencias}</dd></div>}</dl>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500"><span>Responsável: {d.responsavel ?? "—"}</span>{d.revisar_em && <span>Revisar em {fmtData(d.revisar_em)}</span>}{d.link && <a className="text-acao" href={d.link} target="_blank" rel="noreferrer">documento</a>}{d.substituida_por && <span>substituída pela decisão #{d.substituida_por}</span>}
                {podeRegistrar && d.status === "VIGENTE" && <form action={encerrarDecisao} className="ml-auto flex items-center gap-1"><input type="hidden" name="id" value={d.id} /><Input name="substituidaPor" placeholder="# nova" className="!w-20 !py-0.5 !text-xs" /><Btn small kind="ghost" name="status" value="SUBSTITUIDA">Substituir</Btn><Btn small danger name="status" value="REVOGADA">Revogar</Btn></form>}</div>
            </Card>)}
          </div>
        </div>
        {podeRegistrar && <Card title="Registrar decisão"><form action={salvarDecisao} className="space-y-2">
          <div className="grid grid-cols-[130px_1fr] gap-2"><Field label="Data"><Input name="data" type="date" defaultValue={h} /></Field><Field label="Título"><Input name="titulo" required /></Field></div>
          <div className="grid grid-cols-2 gap-2"><Field label="Área"><Select name="area" defaultValue={cfg.governanca.areas[cfg.governanca.areas.length - 1]}>{cfg.governanca.areas.map(a => <option key={a}>{a}</option>)}</Select></Field><Field label="Unidade"><Select name="unitId" defaultValue=""><option value="">Rede</option>{units.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field></div>
          <Field label="Contexto (problema, restrições)"><Textarea name="contexto" className="min-h-[60px]" /></Field>
          <Field label="Decisão"><Textarea name="decisao" className="min-h-[60px]" required /></Field>
          <Field label="Alternativas consideradas e descartadas"><Textarea name="alternativas" className="min-h-[50px]" /></Field>
          <Field label="Consequências, custos, o que passa a ser proibido ou obrigatório"><Textarea name="consequencias" className="min-h-[50px]" /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Responsável"><Select name="responsavelUserId" defaultValue={s.id}>{users.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field><Field label="Revisar em"><Input name="revisarEm" type="date" /></Field></div>
          <Field label="Link (ata, documento)"><Input name="link" /></Field>
          <Btn small>Registrar</Btn></form></Card>}
      </div>
    </Page>
  );
}
