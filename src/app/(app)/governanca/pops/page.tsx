import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Table, Td, Badge, Flash, Field, Btn, Input, Select } from "@/components/ui";
import { fmtData, getSettings, hoje } from "@/lib/utils";
import { POP_STATUS } from "@/lib/governanca";
import { salvarPop } from "../actions";
import { GESTAO, usuariosGestao } from "../_shared";

export const dynamic = "force-dynamic";

export default async function Pops({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams; const cfg = await getSettings(); const q = (sp.q ?? "").trim(); const area = sp.area ?? ""; const status = sp.status ?? (GESTAO.includes(s.role) ? "" : "VIGENTE");
  const rows = await sql<{ id: number; codigo: string; titulo: string; area: string; status: string; versao: number; owner: string | null; unidade: string | null; revisar_em: string | null; publicado_em: Date | null; acks: number; minha: boolean }[]>`
    SELECT p.id, p.codigo, p.titulo, p.area, p.status, p.versao, u.nome AS owner, un.nome AS unidade, p.revisar_em::text, p.publicado_em,
      (SELECT count(*) FROM procedure_acks a WHERE a.procedure_id=p.id AND a.versao=p.versao)::int AS acks,
      EXISTS (SELECT 1 FROM procedure_acks a WHERE a.procedure_id=p.id AND a.versao=p.versao AND a.user_id=${s.id}) AS minha
    FROM procedures p LEFT JOIN users u ON u.id=p.owner_user_id LEFT JOIN units un ON un.id=p.unit_id
    WHERE 1=1 ${q ? sql`AND (p.titulo ILIKE ${"%" + q + "%"} OR p.codigo ILIKE ${"%" + q + "%"} OR p.passos ILIKE ${"%" + q + "%"})` : sql``} ${area ? sql`AND p.area=${area}` : sql``} ${status ? sql`AND p.status=${status}` : sql`AND p.status <> 'OBSOLETO'`}
    ORDER BY p.codigo`;
  const [users, units] = await Promise.all([usuariosGestao(), db.select().from(schema.units).orderBy(asc(schema.units.nome))]);
  const gestao = GESTAO.includes(s.role); const h = hoje();
  return (
    <Page title="POPs e processos" sub="Biblioteca de procedimentos operacionais padrão. Vigentes pedem ciência da equipe; cada publicação vira uma versão." actions={gestao ? <Btn kind="ghost" href="/api/export/pops">Exportar CSV</Btn> : undefined}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className={`grid gap-4 ${gestao ? "lg:grid-cols-[1fr_340px]" : ""} lg:items-start`}>
        <div>
          <form className="mb-3 grid gap-2 rounded-md border border-line bg-white p-3 sm:grid-cols-[1fr_200px_170px_auto]">
            <Field label="Buscar"><Input name="q" defaultValue={q} placeholder="Código, título ou texto dos passos" /></Field>
            <Field label="Área"><Select name="area" defaultValue={area}><option value="">Todas</option>{cfg.governanca.areas.map(a => <option key={a}>{a}</option>)}</Select></Field>
            <Field label="Situação"><Select name="status" defaultValue={status}><option value="">Todas (exceto obsoletos)</option>{Object.entries(POP_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <div className="flex items-end"><Btn kind="ghost">Filtrar</Btn></div>
          </form>
          <Table head={["Código", "Título", "Área", "Situação", "Versão", "Dono", "Revisar em", "Ciência"]} empty="Nenhum POP neste filtro.">
            {rows.map(p => <tr key={p.id} className="hover:bg-mist/60"><Td className="whitespace-nowrap font-medium">{p.codigo}</Td><Td><Link className="text-acao" href={`/governanca/pops/${p.id}`}>{p.titulo}</Link>{p.unidade && <div className="text-xs text-slate-500">{p.unidade}</div>}</Td><Td className="text-xs">{p.area}</Td>
              <Td><Badge v={p.status === "VIGENTE" ? "APROVADA" : p.status === "EM_REVISAO" ? "PENDENTE" : p.status === "OBSOLETO" ? "CANCELADA" : "EM_AQUISICAO"} label={POP_STATUS[p.status]} /></Td><Td>v{p.versao}</Td><Td className="text-xs">{p.owner ?? <span className="text-aviso">sem dono</span>}</Td>
              <Td className={`text-xs ${p.revisar_em && p.revisar_em < h && p.status === "VIGENTE" ? "font-medium text-erro" : ""}`}>{fmtData(p.revisar_em)}</Td>
              <Td className="text-xs">{p.status === "VIGENTE" ? <>{p.acks} pessoa(s) {p.minha ? <Badge v="APROVADA" label="você ✓" /> : <Link className="text-acao" href={`/governanca/pops/${p.id}`}>ler e dar ciência</Link>}</> : "—"}</Td></tr>)}
          </Table>
        </div>
        {gestao && <Card title="Novo POP">
          <form action={salvarPop} className="space-y-2">
            <div className="grid grid-cols-[110px_1fr] gap-2"><Field label="Código"><Input name="codigo" required placeholder="POP-010" /></Field><Field label="Título"><Input name="titulo" required /></Field></div>
            <Field label="Área"><Select name="area" defaultValue={cfg.governanca.areas[0]}>{cfg.governanca.areas.map(a => <option key={a}>{a}</option>)}</Select></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="Dono"><Select name="ownerUserId" defaultValue={s.id}>{users.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Field label="Unidade"><Select name="unitId" defaultValue=""><option value="">Rede</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field></div>
            <Field label="Objetivo"><Input name="objetivo" /></Field>
            <Btn small>Criar rascunho</Btn>
            <p className="text-xs text-slate-500">Depois, na página do POP: passos, RACI, indicadores, e publicação.</p>
          </form>
        </Card>}
      </div>
    </Page>
  );
}
