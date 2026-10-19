import { requireSession, scopeUnit, can } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Field, Select, Btn } from "@/components/ui";
import { KpiCard, BarrasH, COR } from "@/components/graficos";
import { Quadro, type ColunaQuadro, type CartaoQuadro } from "@/components/Quadro";
import { OS_TIPO, OS_PRIO, ABERTAS } from "@/lib/operacoes";
import { fmtReais } from "@/lib/formato";
import { seloSla } from "@/lib/sla-texto";

export const dynamic = "force-dynamic";

const COLS = [{ chave: "ABERTO", titulo: "Aberto", cor: "#94a3b8" }, { chave: "EM_EXECUCAO", titulo: "Em execução", cor: COR.acao }, { chave: "AGUARDANDO", titulo: "Aguardando peça ou fornecedor", cor: COR.aviso }, { chave: "CONCLUIDO", titulo: "Concluído (7 dias)", cor: COR.ok }];

/** Chamados em quadro: aberto → em execução → aguardando → concluído, com prioridade, prazo (SLA) e responsável. Quem não é de operações vê só os próprios chamados. */
export default async function QuadroChamados({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams; const scope = scopeUnit(s); const meusPedidos = !can.operacoes(s);
  const units = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`;
  const unitId = scope ?? (units.some(u => u.id === Number(sp.unidade)) ? Number(sp.unidade) : null);
  const tipo = OS_TIPO[sp.tipo ?? ""] ? sp.tipo! : ""; const meus = sp.meus === "1";
  const rows = await sql<{ id: number; titulo: string; tipo: string; prioridade: string; status: string; unidade: string; ambiente: string | null; responsavel: string | null; sla_ate: Date | null; custo_previsto: number | null }[]>`SELECT w.id, w.titulo, w.tipo, w.prioridade, w.status, u.nome AS unidade, w.ambiente, ur.nome AS responsavel, w.sla_ate, w.custo_previsto::float
    FROM work_orders w JOIN units u ON u.id=w.unit_id LEFT JOIN users ur ON ur.id=w.responsavel_user_id
    WHERE (w.status = ANY(${ABERTAS}) OR (w.status='CONCLUIDO' AND w.concluido_em >= now() - interval '7 days')) ${unitId === null ? sql`` : sql`AND w.unit_id=${unitId}`} ${meusPedidos ? sql`AND w.solicitante_user_id=${s.id}` : sql``}
      ${tipo ? sql`AND w.tipo=${tipo}` : sql``} ${meus ? sql`AND w.responsavel_user_id=${s.id}` : sql``}
    ORDER BY (w.prioridade='URGENTE') DESC, w.sla_ate NULLS LAST, w.created_at LIMIT 600`;
  const agora = Date.now();
  const cartao = (w: typeof rows[number]): CartaoQuadro => { const aberto = ABERTAS.includes(w.status); const sla = aberto ? seloSla(w.sla_ate, agora) : null; return {
    chave: String(w.id), titulo: w.titulo, href: `/operacoes/chamados/${w.id}`, responsavel: w.responsavel,
    linhas: [[OS_TIPO[w.tipo] ?? w.tipo, w.ambiente].filter(Boolean).join(" · "), unitId === null ? w.unidade : null],
    selos: [...(sla ? [sla] : []), ...(["ALTA", "URGENTE"].includes(w.prioridade) ? [{ texto: (OS_PRIO[w.prioridade] ?? w.prioridade).toLowerCase(), tom: w.prioridade === "URGENTE" ? "ruim" as const : "atencao" as const }] : []), ...(w.custo_previsto ? [{ texto: fmtReais(w.custo_previsto, true), tom: "neutro" as const }] : [])],
    destaque: sla?.tom === "ruim" || w.prioridade === "URGENTE" && aberto ? "ruim" : sla?.tom === "atencao" ? "atencao" : w.status === "CONCLUIDO" ? "bom" : null,
  }; };
  const colunas: ColunaQuadro[] = COLS.map(c => { const xs = rows.filter(r => r.status === c.chave); return { ...c, itens: xs.map(cartao), descricao: c.chave !== "CONCLUIDO" ? `${xs.filter(x => x.sla_ate && new Date(x.sla_ate).getTime() < agora).length} com SLA vencido` : undefined }; });
  const abertos = rows.filter(r => ABERTAS.includes(r.status)); const vencidos = abertos.filter(r => r.sla_ate && new Date(r.sla_ate).getTime() < agora);
  const porTipo = new Map<string, number>(); for (const r of abertos) porTipo.set(r.tipo, (porTipo.get(r.tipo) ?? 0) + 1);
  return (
    <Page title="Chamados — quadro" sub={meusPedidos ? "Seus chamados, na etapa em que estão." : "Todos os chamados por etapa. Urgente = risco à segurança; vermelho: SLA vencido; âmbar: vence em até 24 horas."} actions={<div className="flex flex-wrap gap-2 print:hidden"><Btn kind="ghost" href="/operacoes/chamados">Ver em lista</Btn>{!meusPedidos && <Btn kind="ghost" href="/fluxos?fluxo=CHAMADO">Central de fluxos</Btn>}</div>}>
      <form className="mb-3 flex flex-wrap items-end gap-2 print:hidden">
        {scope === null && <Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Todas</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
        <Field label="Tipo"><Select name="tipo" defaultValue={tipo}><option value="">Todos</option>{Object.entries(OS_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        {!meusPedidos && <label className="flex items-center gap-1.5 pb-2 text-xs"><input type="checkbox" name="meus" value="1" defaultChecked={meus} /> só os que eu executo</label>}
        <Btn kind="ghost">Ver</Btn>
      </form>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard titulo="Em aberto" valor={String(abertos.length)} />
        <KpiCard titulo="SLA vencido" valor={String(vencidos.length)} tom={vencidos.length ? "ruim" : "bom"} />
        <KpiCard titulo="Urgentes em aberto" valor={String(abertos.filter(r => r.prioridade === "URGENTE").length)} tom={abertos.some(r => r.prioridade === "URGENTE") ? "ruim" : "neutro"} />
        <KpiCard titulo="Concluídos em 7 dias" valor={String(rows.length - abertos.length)} tom="bom" />
      </div>
      <Quadro rotulo="Quadro dos chamados" colunas={colunas} />
      {porTipo.size > 0 && <Card title="Em aberto por tipo" className="mt-4"><BarrasH rotulo="Chamados em aberto por tipo" itens={[...porTipo.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ chave: k, rotulo: OS_TIPO[k] ?? k, valor: v, cor: COR.acao }))} formato={x => String(x)} /></Card>}
    </Page>
  );
}
