import { Modal } from "@/components/Modal";
import Link from "next/link";
import { scopeUnit } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Table, Td, Badge, Flash, Field, Btn, Input, Select, Textarea } from "@/components/ui";
import { fmtData, getSettings, hoje } from "@/lib/utils";
import { FREQ, NC_STATUS, NC_ORIGEM } from "@/lib/governanca";
import { salvarControle, registrarExecucao, salvarNc } from "../actions";
import { requireGestao, popsLista, usuariosGestao } from "../_shared";

export const dynamic = "force-dynamic";

export default async function Controles({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireGestao(); const sp = await searchParams; const cfg = await getSettings(); const u = scopeUnit(s); const h = hoje(); const ncStatus = sp.nc ?? "ABERTAS";
  const [controles, ncs, pops, users, units] = await Promise.all([
    sql<{ id: number; titulo: string; area: string; frequencia: string; unidade: string | null; unit_id: number | null; responsavel: string | null; proxima_em: string | null; ativo: boolean; pop: string | null; ultima: string | null; ultimo_resultado: string | null; nao_conformes: number; descricao: string | null }[]>`
      SELECT c.id, c.titulo, c.area, c.frequencia, un.nome AS unidade, c.unit_id, us.nome AS responsavel, c.proxima_em::text, c.ativo, p.codigo AS pop, c.descricao,
        (SELECT r.data::text FROM control_runs r WHERE r.control_id=c.id ORDER BY r.data DESC, r.id DESC LIMIT 1) AS ultima,
        (SELECT r.resultado FROM control_runs r WHERE r.control_id=c.id ORDER BY r.data DESC, r.id DESC LIMIT 1) AS ultimo_resultado,
        (SELECT count(*) FROM control_runs r WHERE r.control_id=c.id AND r.resultado='NAO_CONFORME' AND r.data >= ${h}::date - 90)::int AS nao_conformes
      FROM controls c LEFT JOIN units un ON un.id=c.unit_id LEFT JOIN users us ON us.id=c.responsavel_user_id LEFT JOIN procedures p ON p.id=c.procedure_id
      WHERE 1=1 ${u === null ? sql`` : sql`AND (c.unit_id IS NULL OR c.unit_id=${u})`} ORDER BY c.ativo DESC, (c.proxima_em < ${h}) DESC, c.proxima_em NULLS LAST, c.titulo`,
    sql<{ id: number; titulo: string; origem: string; gravidade: number; status: string; prazo: string | null; unidade: string | null; responsavel: string | null; causa_raiz: string | null; acao_corretiva: string | null; acao_preventiva: string | null; descricao: string | null; eficacia: boolean; created_at: Date; pop: string | null; procedure_id: number | null; unit_id: number | null; responsavel_id: number | null; case_id: number | null }[]>`
      SELECT n.id, n.titulo, n.origem, n.gravidade, n.status, n.prazo::text, un.nome AS unidade, us.nome AS responsavel, n.causa_raiz, n.acao_corretiva, n.acao_preventiva, n.descricao, n.eficacia_verificada AS eficacia, n.created_at, p.codigo AS pop, n.procedure_id, n.unit_id, n.responsavel_user_id AS responsavel_id, n.case_id
      FROM nonconformities n LEFT JOIN units un ON un.id=n.unit_id LEFT JOIN users us ON us.id=n.responsavel_user_id LEFT JOIN procedures p ON p.id=n.procedure_id
      WHERE 1=1 ${u === null ? sql`` : sql`AND (n.unit_id IS NULL OR n.unit_id=${u})`} ${ncStatus === "ABERTAS" ? sql`AND n.status <> 'ENCERRADA'` : ncStatus ? sql`AND n.status=${ncStatus}` : sql``} ORDER BY (n.status<>'ENCERRADA') DESC, n.gravidade DESC, n.prazo NULLS LAST LIMIT 200`,
    popsLista(), usuariosGestao(), db.select().from(schema.units).orderBy(asc(schema.units.nome)),
  ]);
  const NcForm = ({ n }: { n?: typeof ncs[number] }) => (
    <form action={salvarNc} className="space-y-2">{n && <input type="hidden" name="id" value={n.id} />}
      <Field label="Título"><Input name="titulo" required defaultValue={n?.titulo ?? ""} /></Field>
      <div className="grid grid-cols-2 gap-2"><Field label="Origem"><Select name="origem" defaultValue={n?.origem ?? "OUTRO"}>{Object.entries(NC_ORIGEM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Gravidade"><Select name="gravidade" defaultValue={n?.gravidade ?? 2}><option value="1">1 · leve</option><option value="2">2 · moderada</option><option value="3">3 · grave</option></Select></Field></div>
      <div className="grid grid-cols-2 gap-2"><Field label="POP"><Select name="procedureId" defaultValue={n?.procedure_id ?? ""}><option value="">—</option>{pops.map(p => <option key={p.id} value={p.id}>{p.codigo}</option>)}</Select></Field><Field label="Unidade"><Select name="unitId" defaultValue={n?.unit_id ?? u ?? ""}><option value="">Rede</option>{units.filter(x => u === null || x.id === u).map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field></div>
      <div className="grid grid-cols-2 gap-2"><Field label="Responsável"><Select name="responsavelUserId" defaultValue={n?.responsavel_id ?? s.id}>{users.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field><Field label="Prazo"><Input name="prazo" type="date" defaultValue={n?.prazo ?? ""} /></Field></div>
      <Field label="Descrição"><Textarea name="descricao" className="min-h-[50px]" defaultValue={n?.descricao ?? ""} /></Field>
      <Field label="Causa raiz"><Input name="causaRaiz" defaultValue={n?.causa_raiz ?? ""} /></Field><Field label="Ação corretiva"><Input name="acaoCorretiva" defaultValue={n?.acao_corretiva ?? ""} /></Field><Field label="Ação preventiva"><Input name="acaoPreventiva" defaultValue={n?.acao_preventiva ?? ""} /></Field>
      <div className="grid grid-cols-2 gap-2"><Field label="Situação"><Select name="status" defaultValue={n?.status ?? "ABERTA"}>{Object.entries(NC_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><label className="mt-6 flex items-center gap-2 text-xs"><input type="checkbox" name="eficaciaVerificada" value="1" defaultChecked={n?.eficacia} /> Eficácia verificada</label></div>
      <Btn small>{n ? "Salvar" : "Abrir não conformidade"}</Btn>
    </form>
  );
  return (
    <Page title="Controles e não conformidades" sub="Verificações periódicas com evidência; o que falha vira não conformidade com causa raiz, ação corretiva e verificação de eficácia." actions={<Btn kind="ghost" href="/api/export/ncs">Exportar NCs (CSV)</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px] lg:items-start">
        <div className="space-y-6">
          <div>
            <h2 className="mb-2 text-sm font-semibold text-navy">Controles</h2>
            <Table head={["Controle", "Área", "Frequência", "Responsável", "Última", "Próxima", ""]} empty="Nenhum controle cadastrado.">
              {controles.map(c => <tr key={c.id} className={!c.ativo ? "opacity-50" : ""}><Td><div className="font-medium">{c.titulo}</div><div className="text-xs text-slate-500">{c.pop ?? ""}{c.unidade ? ` · ${c.unidade}` : ""}{c.descricao ? ` · ${c.descricao}` : ""}</div></Td><Td className="text-xs">{c.area}</Td><Td className="text-xs">{FREQ[c.frequencia]}</Td><Td className="text-xs">{c.responsavel ?? "—"}</Td>
                <Td className="text-xs">{c.ultima ? <>{fmtData(c.ultima)} <Badge v={c.ultimo_resultado === "CONFORME" ? "APROVADA" : "REJEITADA"} label={c.ultimo_resultado === "CONFORME" ? "conforme" : "não conforme"} /></> : "—"}{c.nao_conformes ? <div className="text-erro">{c.nao_conformes} NC em 90 dias</div> : null}</Td>
                <Td className={`text-xs ${c.ativo && c.proxima_em && c.proxima_em < h ? "font-medium text-erro" : ""}`}>{fmtData(c.proxima_em)}{c.ativo && c.proxima_em && c.proxima_em < h ? " · atrasado" : ""}</Td>
                <Td>{c.ativo && <Modal label={"Registrar"} kind="primary"><form action={registrarExecucao} className="space-y-2"><input type="hidden" name="controlId" value={c.id} />
                  <Field label="Data"><Input name="data" type="date" defaultValue={h} /></Field><Field label="Resultado"><Select name="resultado" defaultValue="CONFORME"><option value="CONFORME">Conforme</option><option value="NAO_CONFORME">Não conforme</option></Select></Field><Field label="Evidência (link, documento, contagem)"><Input name="evidencia" /></Field><Field label="Observação"><Input name="obs" /></Field>
                  <label className="flex items-center gap-2"><input type="checkbox" name="abrirNc" value="1" defaultChecked /> Se não conforme, abrir não conformidade</label><Field label="Gravidade da NC"><Select name="gravidade" defaultValue="2"><option value="1">1</option><option value="2">2</option><option value="3">3</option></Select></Field><Btn small>Salvar execução</Btn></form></Modal>}</Td></tr>)}
            </Table>
          </div>
          <div>
            <div id="ncs" />
            <div className="mb-2 flex flex-wrap items-end justify-between gap-2"><h2 className="text-sm font-semibold text-navy">Não conformidades</h2><form className="flex items-end gap-2"><Field label="Situação"><Select name="nc" defaultValue={ncStatus} className="!py-1 !text-xs"><option value="ABERTAS">Abertas</option>{Object.entries(NC_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}<option value="">Todas</option></Select></Field><Btn small kind="ghost">Filtrar</Btn></form></div>
            <Table head={["#", "Não conformidade", "Origem", "Gravidade", "Responsável", "Prazo", "Situação", ""]} empty="Nenhuma não conformidade neste filtro.">
              {ncs.map(n => <tr key={n.id}><Td className="text-slate-500">{n.id}</Td><Td><div className="font-medium">{n.titulo}</div><div className="text-xs text-slate-500">{n.pop ?? ""}{n.unidade ? ` · ${n.unidade}` : ""}{n.case_id ? <> · <Link className="text-acao" href={`/atendimento/casos/${n.case_id}`}>caso #{n.case_id}</Link></> : ""}</div>{n.causa_raiz && <div className="text-xs">Causa: {n.causa_raiz}</div>}{n.acao_corretiva && <div className="text-xs">Ação: {n.acao_corretiva}</div>}</Td><Td className="text-xs">{NC_ORIGEM[n.origem]}</Td><Td><Badge v={n.gravidade === 3 ? "REJEITADA" : n.gravidade === 2 ? "PENDENTE" : "EM_AQUISICAO"} label={String(n.gravidade)} /></Td><Td className="text-xs">{n.responsavel ?? "—"}</Td>
                <Td className={`text-xs ${n.status !== "ENCERRADA" && n.prazo && n.prazo < h ? "font-medium text-erro" : ""}`}>{fmtData(n.prazo)}</Td><Td><Badge v={n.status === "ENCERRADA" ? "APROVADA" : n.status === "VERIFICACAO" ? "PENDENTE" : "EM_ADMISSAO"} label={NC_STATUS[n.status]} /></Td>
                <Td><Modal label={"Tratar"} kind="ghost"><div className=""><NcForm n={n} /></div></Modal></Td></tr>)}
            </Table>
          </div>
        </div>
        <div className="space-y-4">
          <Card title="Novo controle"><form action={salvarControle} className="space-y-2">
            <Field label="Título"><Input name="titulo" required placeholder="Ex.: Conciliação bancária semanal" /></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="Área"><Select name="area" defaultValue={cfg.governanca.areas[0]}>{cfg.governanca.areas.map(a => <option key={a}>{a}</option>)}</Select></Field><Field label="Frequência"><Select name="frequencia" defaultValue="MENSAL">{Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field></div>
            <div className="grid grid-cols-2 gap-2"><Field label="POP"><Select name="procedureId" defaultValue=""><option value="">—</option>{pops.map(p => <option key={p.id} value={p.id}>{p.codigo}</option>)}</Select></Field><Field label="Unidade"><Select name="unitId" defaultValue={u ?? ""}><option value="">Rede</option>{units.filter(x => u === null || x.id === u).map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field></div>
            <div className="grid grid-cols-2 gap-2"><Field label="Responsável"><Select name="responsavelUserId" defaultValue={s.id}>{users.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field><Field label="Primeira verificação"><Input name="proximaEm" type="date" defaultValue={h} /></Field></div>
            <Field label="O que verificar"><Textarea name="descricao" className="min-h-[50px]" /></Field><Btn small>Criar controle</Btn></form></Card>
          <Card title="Nova não conformidade"><NcForm /></Card>
        </div>
      </div>
    </Page>
  );
}
