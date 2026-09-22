import { Modal } from "@/components/Modal";
import { requireSession, scopeUnit, can } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Table, Td, Badge, Flash, Field, Select, Btn, Input, Textarea } from "@/components/ui";
import { fmtData, getSettings } from "@/lib/utils";
import { ATIVO_STATUS, brl } from "@/lib/operacoes";
import { salvarAtivo, importarAtivos } from "../actions";

export const dynamic = "force-dynamic";

export default async function Ativos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams; const cfg = await getSettings(); const scope = scopeUnit(s); const unitId = scope ?? (sp.unidade ? Number(sp.unidade) : null); const q = (sp.q ?? "").trim();
  const rows = await sql<{ id: number; codigo: string | null; nome: string; categoria: string; unidade: string; unit_id: number; ambiente: string | null; aquisicao: string | null; valor: number | null; garantia_ate: string | null; status: string; preventiva_dias: number | null; ultima_preventiva: string | null; chamados_abertos: number; obs: string | null; fornecedor: string | null }[]>`SELECT a.id, a.codigo, a.nome, a.categoria, u.nome AS unidade, a.unit_id, a.ambiente, a.aquisicao::text, a.valor::float, a.garantia_ate::text, a.status, a.preventiva_dias, a.ultima_preventiva::text, (SELECT count(*) FROM work_orders w WHERE w.asset_id=a.id AND w.status IN ('ABERTO','EM_EXECUCAO','AGUARDANDO'))::int AS chamados_abertos, a.obs, a.fornecedor FROM assets a JOIN units u ON u.id=a.unit_id WHERE 1=1 ${unitId === null ? sql`` : sql`AND a.unit_id=${unitId}`} ${q ? sql`AND (a.nome ILIKE ${"%" + q + "%"} OR a.codigo ILIKE ${"%" + q + "%"} OR a.ambiente ILIKE ${"%" + q + "%"})` : sql``} ORDER BY a.status='BAIXADO', u.nome, a.ambiente, a.nome LIMIT 500`;
  const units = await db.select().from(schema.units).orderBy(asc(schema.units.nome)); const gest = can.operacoes(s);
  const Form = ({ a }: { a?: typeof rows[number] }) => <form action={salvarAtivo} className="grid grid-cols-2 gap-2">{a && <input type="hidden" name="id" value={a.id} />}
    <Field label="Patrimônio"><Input name="codigo" defaultValue={a?.codigo ?? ""} /></Field><Field label="Nome"><Input name="nome" required defaultValue={a?.nome ?? ""} /></Field>
    <Field label="Categoria"><Select name="categoria" defaultValue={a?.categoria ?? cfg.operacoes.categoriasAtivo[0]}>{cfg.operacoes.categoriasAtivo.map(c => <option key={c}>{c}</option>)}</Select></Field><Field label="Unidade"><Select name="unitId" defaultValue={a?.unit_id ?? scope ?? ""} required>{units.filter(u => scope === null || u.id === scope).map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>
    <Field label="Ambiente"><Input name="ambiente" defaultValue={a?.ambiente ?? ""} /></Field><Field label="Situação"><Select name="status" defaultValue={a?.status ?? "EM_USO"}>{Object.entries(ATIVO_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
    <Field label="Aquisição"><Input name="aquisicao" type="date" defaultValue={a?.aquisicao ?? ""} /></Field><Field label="Valor (R$)"><Input name="valor" type="number" step="0.01" defaultValue={a?.valor ?? ""} /></Field>
    <Field label="Fornecedor"><Input name="fornecedor" defaultValue={a?.fornecedor ?? ""} /></Field><Field label="Garantia até"><Input name="garantiaAte" type="date" defaultValue={a?.garantia_ate ?? ""} /></Field>
    <Field label="Preventiva a cada (dias)"><Input name="preventivaDias" type="number" defaultValue={a?.preventiva_dias ?? ""} /></Field><Field label="Última preventiva"><Input name="ultimaPreventiva" type="date" defaultValue={a?.ultima_preventiva ?? ""} /></Field>
    <Field label="Observações" className="col-span-2"><Textarea name="obs" className="min-h-[40px]" defaultValue={a?.obs ?? ""} /></Field><div className="col-span-2"><Btn small>{a ? "Salvar" : "Cadastrar ativo"}</Btn></div></form>;
  return (
    <Page title="Ativos e patrimônio" sub="Equipamentos, mobiliário e instalações por unidade e ambiente, com garantia e manutenção preventiva programada." actions={gest ? <Btn kind="ghost" href="/api/export/ativos">Exportar CSV</Btn> : undefined}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className={`grid gap-4 ${gest ? "lg:grid-cols-[1fr_360px]" : ""} lg:items-start`}>
        <div>
          <form className="mb-3 flex flex-wrap items-end gap-2">{!scope && <Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Todas</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}<Field label="Buscar"><Input name="q" defaultValue={q} placeholder="Nome, patrimônio ou ambiente" /></Field><Btn kind="ghost">Filtrar</Btn></form>
          <Table head={["Patrimônio", "Ativo", "Categoria", "Unidade · ambiente", "Valor", "Garantia", "Preventiva", "Situação", ""]} empty="Nenhum ativo cadastrado.">{rows.map(a => <tr key={a.id} className={a.status === "BAIXADO" ? "opacity-50" : ""}><Td className="text-xs">{a.codigo ?? "—"}</Td><Td className="font-medium">{a.nome}{a.chamados_abertos ? <div className="text-xs text-aviso">{a.chamados_abertos} chamado(s) aberto(s)</div> : null}</Td><Td className="text-xs">{a.categoria}</Td><Td className="text-xs">{a.unidade}{a.ambiente ? ` · ${a.ambiente}` : ""}</Td><Td className="tabular-nums text-xs">{brl(a.valor)}</Td><Td className="text-xs">{fmtData(a.garantia_ate)}</Td><Td className="text-xs">{a.preventiva_dias ? `a cada ${a.preventiva_dias}d${a.ultima_preventiva ? ` · última ${fmtData(a.ultima_preventiva)}` : ""}` : "—"}</Td><Td><Badge v={a.status === "EM_USO" ? "ATIVO" : a.status === "MANUTENCAO" ? "PENDENTE" : "CANCELADA"} label={ATIVO_STATUS[a.status]} /></Td><Td>{gest && <Modal label={"Editar"} kind="link"><div className=""><Form a={a} /></div></Modal>}</Td></tr>)}</Table>
        </div>
        {gest && <div className="space-y-4"><Card title="Novo ativo"><Form /></Card><Card title="Importar inventário (CSV)"><form action={importarAtivos} className="space-y-2"><Field label="Unidade padrão"><Select name="unitId" defaultValue={scope ?? ""}><option value="">—</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Field label="patrimonio;nome;categoria;unidade;ambiente;aquisicao;valor;fornecedor;preventiva_dias"><Textarea name="csv" className="min-h-[90px] font-mono text-xs" /></Field><Field label="Ou envie o arquivo (.xlsx/.xls/.csv)"><input type="file" name="arquivo" accept=".xlsx,.xls,.xlsm,.csv,.txt" className="block w-full rounded-md border border-line bg-white px-2 py-1.5 text-xs file:mr-2 file:rounded file:border-0 file:bg-acao file:px-2 file:py-1 file:text-xs file:text-white" /></Field><Btn small kind="ghost">Importar</Btn></form></Card></div>}
      </div>
    </Page>
  );
}
