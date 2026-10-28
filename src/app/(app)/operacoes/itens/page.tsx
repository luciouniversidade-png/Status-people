import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { requireSession, scopeUnit, can, EQUIPE_FICHAS } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge, Flash, Btn, Field, Input, Select, Textarea, Stat } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { fmtData, hoje } from "@/lib/utils";
import { ITEM_TIPO, ITEM_STATUS, ITEM_TOM, podeItens } from "@/lib/pessoas-v30";
import { entregarItem, devolverItem } from "../../colaboradores/v30-actions";

export const dynamic = "force-dynamic";

/**
 * v30 · Itens com colaboradores (chaves, notebooks, crachás, uniformes, EPIs): quem está com o quê, desde quando, ciência do termo e
 * devolução — sem abrir a ficha da pessoa (Operações não vê dados pessoais). O desligamento só conclui com tudo devolvido ou baixado.
 */
export default async function ItensColaboradores({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!podeItens(s)) redirect("/"); const sp = await searchParams; const escopo = scopeUnit(s); const h = hoje();
  const u = escopo ?? (sp.u ? Number(sp.u) : null); const tipo = sp.tipo && ITEM_TIPO[sp.tipo] ? sp.tipo : null; const q = (sp.q ?? "").trim().toLowerCase(); const verTodos = sp.ver === "todos";
  const [units, itens, pessoas, ativos] = await Promise.all([
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`,
    sql<{ id: number; employee_id: number; nome: string; unidade: string; situacao: string; tipo: string; descricao: string; identificacao: string | null; patrimonio: string | null; entregue_em: string; ciencia_em: string | null; devolver_ate: string | null; status: string; devolvido_em: string | null }[]>`
      SELECT i.id, i.employee_id, e.nome, un.nome AS unidade, e.situacao, i.tipo, i.descricao, i.identificacao, a.codigo AS patrimonio, i.entregue_em::text, i.ciencia_em::text, i.devolver_ate::text, i.status, i.devolvido_em::text
      FROM employee_items i JOIN employees e ON e.id=i.employee_id JOIN units un ON un.id=e.unit_id LEFT JOIN assets a ON a.id=i.asset_id
      WHERE ${verTodos ? sql`TRUE` : sql`i.status='COM_COLABORADOR'`} ${u === null ? sql`` : sql`AND e.unit_id=${u}`} ${tipo ? sql`AND i.tipo=${tipo}` : sql``}
      ORDER BY i.status='COM_COLABORADOR' DESC, e.situacao='DESLIGADO' DESC, i.devolver_ate NULLS LAST, e.nome LIMIT 800`,
    sql<{ id: number; nome: string; unidade: string }[]>`SELECT e.id, e.nome, un.nome AS unidade FROM employees e JOIN units un ON un.id=e.unit_id WHERE e.situacao IN ('ATIVO','FERIAS','AFASTADO','EM_ADMISSAO') ${u === null ? sql`` : sql`AND e.unit_id=${u}`} ORDER BY e.nome`,
    sql<{ id: number; codigo: string; nome: string; unidade: string }[]>`SELECT a.id, a.codigo, a.nome, un.nome AS unidade FROM assets a JOIN units un ON un.id=a.unit_id WHERE a.status <> 'BAIXADO' ${u === null ? sql`` : sql`AND a.unit_id=${u}`} AND NOT EXISTS (SELECT 1 FROM employee_items i WHERE i.asset_id=a.id AND i.status='COM_COLABORADOR') ORDER BY a.codigo LIMIT 500`,
  ]);
  const lista = q ? itens.filter(i => `${i.nome} ${i.descricao} ${i.identificacao ?? ""} ${i.patrimonio ?? ""}`.toLowerCase().includes(q)) : itens;
  const com = itens.filter(i => i.status === "COM_COLABORADOR"); const semCiencia = com.filter(i => !i.ciencia_em).length; const atrasados = com.filter(i => i.devolver_ate && i.devolver_ate < h).length; const deDesligados = com.filter(i => i.situacao === "DESLIGADO").length;
  const fichas = EQUIPE_FICHAS.includes(s.role); const voltar = `/operacoes/itens${u && escopo === null ? `?u=${u}` : ""}`;
  return (
    <Page title="Itens com colaboradores" sub={<>Chaves, notebooks, crachás, uniformes e EPIs entregues às pessoas: quem está com o quê, a ciência do termo e a devolução. {can.editar(s) ? "Também aparece na ficha de cada pessoa." : "Sem acesso aos dados pessoais — só ao item."} <Link className="text-acao" href="/operacoes/ativos">Ativos e patrimônio</Link></>}
      actions={<Modal label="Registrar entrega" title="Registrar item entregue a um colaborador"><form action={entregarItem} className="space-y-2"><input type="hidden" name="voltar" value={voltar} />
        <Field label="Colaborador"><Select name="employeeId" required defaultValue="">{[<option key="" value="">Escolha</option>, ...pessoas.map(p => <option key={p.id} value={p.id}>{p.nome} · {p.unidade}</option>)]}</Select></Field>
        <div className="grid grid-cols-2 gap-2"><Field label="Tipo"><Select name="tipo" required defaultValue="">{[<option key="" value="">Escolha</option>, ...Object.entries(ITEM_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)]}</Select></Field><Field label="Entregue em"><Input name="entregueEm" type="date" defaultValue={h} max={h} /></Field></div>
        <Field label="Descrição"><Input name="descricao" placeholder="Ex.: Chave da sala 12 · Notebook" /></Field>
        <div className="grid grid-cols-2 gap-2"><Field label="Identificação (série, número)"><Input name="identificacao" /></Field><Field label="Valor (R$, opcional)"><Input name="valor" inputMode="decimal" /></Field></div>
        <Field label="Patrimônio (opcional)"><Select name="assetId" defaultValue="">{[<option key="" value="">— sem vínculo —</option>, ...ativos.map(a => <option key={a.id} value={a.id}>{a.codigo} · {a.nome} · {a.unidade}</option>)]}</Select></Field>
        <div className="grid grid-cols-2 gap-2"><Field label="Devolver até (opcional)"><Input name="devolverAte" type="date" /></Field><Field label="Observação"><Input name="obs" /></Field></div>
        <Btn small>Registrar entrega</Btn></form></Modal>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Itens com colaboradores" value={com.length} /><Stat label="Sem ciência do termo" value={<span className={semCiencia ? "text-aviso" : ""}>{semCiencia}</span>} hint="a pessoa dá ciência no Meu espaço" />
        <Stat label="Devolução atrasada" value={<span className={atrasados ? "text-erro" : ""}>{atrasados}</span>} /><Stat label="Com desligados" value={<span className={deDesligados ? "text-erro" : ""}>{deDesligados}</span>} hint="registre a devolução ou o extravio" />
      </div>
      <form className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <Input name="q" defaultValue={sp.q ?? ""} placeholder="Pessoa, item ou nº de série" aria-label="Buscar" />
        {escopo === null ? <Select name="u" defaultValue={u ?? ""} aria-label="Unidade"><option value="">Todas as unidades</option>{units.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select> : <span />}
        <Select name="tipo" defaultValue={tipo ?? ""} aria-label="Tipo"><option value="">Todos os tipos</option>{Object.entries(ITEM_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Select name="ver" defaultValue={verTodos ? "todos" : ""} aria-label="Situação"><option value="">Com alguém agora</option><option value="todos">Também devolvidos e baixados</option></Select><Btn kind="ghost" small>Filtrar</Btn>
      </form>
      <Card>
        <Table head={["Colaborador", "Item", "Desde", "Ciência", "Situação", ""]} empty="Nenhum item com estes filtros.">{lista.map(i => <tr key={i.id} className={i.situacao === "DESLIGADO" && i.status === "COM_COLABORADOR" ? "bg-red-50/40" : ""}>
          <Td>{fichas ? <Link className="text-acao" href={`/colaboradores/${i.employee_id}#itens`}>{i.nome}</Link> : i.nome}<div className="text-[11px] text-slate-500">{i.unidade}{i.situacao === "DESLIGADO" ? " · desligado(a)" : ""}</div></Td>
          <Td><div className="font-medium text-ink">{i.descricao}</div><div className="text-[11px] text-slate-500">{ITEM_TIPO[i.tipo] ?? i.tipo}{i.identificacao ? ` · ${i.identificacao}` : ""}{i.patrimonio ? ` · patrimônio ${i.patrimonio}` : ""}</div></Td>
          <Td className="whitespace-nowrap text-xs">{fmtData(i.entregue_em)}{i.devolver_ate && i.status === "COM_COLABORADOR" && <div className={`text-[11px] ${i.devolver_ate < h ? "text-erro" : "text-slate-500"}`}>devolver até {fmtData(i.devolver_ate)}</div>}</Td>
          <Td className="text-xs">{i.ciencia_em ? <span className="text-ok">{fmtData(i.ciencia_em.slice(0, 10))}</span> : i.status === "COM_COLABORADOR" ? <span className="text-aviso">pendente</span> : "—"}</Td>
          <Td><Badge v={ITEM_TOM[i.status] ?? "PENDENTE"} label={ITEM_STATUS[i.status] ?? i.status} />{i.devolvido_em && <div className="text-[11px] text-slate-500">{fmtData(i.devolvido_em)}</div>}</Td>
          <Td>{i.status === "COM_COLABORADOR" && <Modal label="Devolução" kind="link" title={`Devolução — ${i.descricao}`}><form action={devolverItem} className="space-y-2"><input type="hidden" name="id" value={i.id} /><input type="hidden" name="employeeId" value={i.employee_id} /><input type="hidden" name="voltar" value={voltar} />
            <div className="grid grid-cols-2 gap-2"><Field label="Situação"><Select name="status" defaultValue="DEVOLVIDO"><option value="DEVOLVIDO">Devolvido</option><option value="EXTRAVIADO">Extraviado / não devolvido</option><option value="BAIXADO">Baixado (consumo ou descarte)</option></Select></Field><Field label="Data"><Input name="data" type="date" defaultValue={h} max={h} /></Field></div>
            <Field label="Condição na devolução"><Select name="condicao" defaultValue="Em bom estado"><option>Em bom estado</option><option>Com desgaste normal</option><option>Danificado</option></Select></Field>
            <Field label="Observação" hint="Obrigatória no extravio e na baixa."><Textarea name="obs" /></Field><Btn small>Registrar</Btn></form></Modal>}</Td>
        </tr>)}</Table>
      </Card>
    </Page>
  );
}
