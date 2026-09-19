import Link from "next/link";
import { requireStaff, scopeUnit } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Table, Td, Badge, Flash, Field, Input, Select, Textarea, Btn } from "@/components/ui";
import { fmtData, getSettings } from "@/lib/utils";
import { portfolio, PROJ_STATUS, SAUDE } from "@/lib/estrategia";
import { brl } from "@/lib/operacoes";
import { salvarProjeto } from "../actions";

export const dynamic = "force-dynamic";

export default async function Projetos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const sp = await searchParams; const cfg = await getSettings(); const u = scopeUnit(s); const filtro = sp.filtro ?? "ATIVOS";
  const [pf, units, users, objetivos] = await Promise.all([portfolio(u), db.select().from(schema.units).orderBy(asc(schema.units.nome)), sql<{ id: number; nome: string }[]>`SELECT id, nome FROM users WHERE ativo AND role <> 'LEITURA' ORDER BY nome`, sql<{ id: number; titulo: string }[]>`SELECT id, titulo FROM objectives WHERE status='ATIVO' AND ciclo=${cfg.estrategia.cicloAtual} ORDER BY ordem`]);
  const rows = filtro === "ATIVOS" ? pf.rows.filter(r => ["PLANEJADO", "EM_ANDAMENTO", "PAUSADO"].includes(r.status)) : filtro === "TODOS" ? pf.rows : pf.rows.filter(r => r.status === filtro);
  const gestao = ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "FINANCEIRO", "OPERACOES", "COMERCIAL"].includes(s.role);
  return (
    <Page title="Portfólio de projetos" sub="Cada projeto tem dono, prazo, marcos, riscos e um status report periódico com saúde (no rumo · atenção · em risco). Ligue ao objetivo que ele serve." actions={<><Btn kind="ghost" href="/api/export/projetos">Exportar CSV</Btn><Btn kind="ghost" href="/estrategia">Painel</Btn></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className={`grid gap-4 ${gestao ? "lg:grid-cols-[1fr_340px]" : ""} lg:items-start`}>
        <div>
          <form className="mb-3 flex items-end gap-2"><Field label="Mostrar"><Select name="filtro" defaultValue={filtro}><option value="ATIVOS">Ativos</option>{Object.entries(PROJ_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}<option value="TODOS">Todos</option></Select></Field><Btn kind="ghost">Filtrar</Btn></form>
          <Table head={["Projeto", "Objetivo", "Dono · unidade", "Situação", "Saúde", "Marcos", "Prazo", "Orçamento", "Última atualização"]} empty="Nenhum projeto neste filtro.">{rows.map(r => <tr key={r.id}><Td><Link className="font-medium text-acao" href={`/estrategia/projetos/${r.id}`}>{r.nome}</Link>{r.prioridade === "ALTA" && <Badge v="REJEITADA" label="alta" />}</Td><Td className="text-xs">{r.objetivo ?? "—"}</Td><Td className="text-xs">{r.owner ?? "—"} · {r.unidade ?? "rede"}</Td><Td className="text-xs">{PROJ_STATUS[r.status]}</Td><Td><Badge v={r.saude === "VERDE" ? "APROVADA" : r.saude === "AMARELO" ? "PENDENTE" : "REJEITADA"} label={SAUDE[r.saude]} /></Td><Td className="text-xs">{r.marcos ? `${r.marcos_ok}/${r.marcos}` : "—"}{r.marcos_atrasados ? <span className="text-erro"> · {r.marcos_atrasados} atrasado(s)</span> : null}</Td><Td className="text-xs">{fmtData(r.fim)}</Td><Td className="text-xs tabular-nums">{r.orcamento ? `${brl(r.gasto ?? 0)} / ${brl(r.orcamento)}` : "—"}</Td><Td className="text-xs">{fmtData(r.ultima_atualizacao) || "—"}</Td></tr>)}</Table>
        </div>
        {gestao && <Card title="Novo projeto"><form action={salvarProjeto} className="space-y-2"><Field label="Nome"><Input name="nome" required /></Field><Field label="Objetivo que ele serve"><Select name="objectiveId" defaultValue=""><option value="">—</option>{objetivos.map(o => <option key={o.id} value={o.id}>{o.titulo}</option>)}</Select></Field><Field label="Resultado esperado"><Textarea name="resultadoEsperado" className="min-h-[50px]" placeholder="O que muda quando o projeto terminar" /></Field><div className="grid grid-cols-2 gap-2"><Field label="Dono"><Select name="ownerUserId" defaultValue={s.id}>{users.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field><Field label="Unidade"><Select name="unitId" defaultValue={u ?? ""}>{u === null && <option value="">Rede</option>}{units.filter(x => u === null || x.id === u).map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field></div><div className="grid grid-cols-3 gap-2"><Field label="Situação"><Select name="status" defaultValue="PLANEJADO">{Object.entries(PROJ_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Prioridade"><Select name="prioridade" defaultValue="NORMAL"><option value="NORMAL">Normal</option><option value="ALTA">Alta</option><option value="BAIXA">Baixa</option></Select></Field><Field label="Orçamento (R$)"><Input name="orcamento" type="number" step="0.01" /></Field></div><div className="grid grid-cols-2 gap-2"><Field label="Início"><Input name="inicio" type="date" /></Field><Field label="Fim previsto"><Input name="fim" type="date" /></Field></div><Field label="Descrição"><Textarea name="descricao" className="min-h-[50px]" /></Field><Btn small>Criar projeto</Btn></form></Card>}
      </div>
    </Page>
  );
}
