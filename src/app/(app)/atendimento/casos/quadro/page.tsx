import { requireMatriculas, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Field, Select, Btn } from "@/components/ui";
import { KpiCard, BarrasH, COR } from "@/components/graficos";
import { Quadro, type ColunaQuadro, type CartaoQuadro } from "@/components/Quadro";
import { CASE_TIPOS, CASE_TIPO_LABEL, CASE_PRIO, ABERTOS, escalarVencidos } from "@/lib/atendimento";
import { seloSla } from "@/lib/sla-texto";

export const dynamic = "force-dynamic";

const COLS = [
  { chave: "ABERTO", titulo: "Aberto", cor: "#94a3b8" }, { chave: "EM_ATENDIMENTO", titulo: "Em atendimento", cor: COR.acao },
  { chave: "AGUARDANDO_FAMILIA", titulo: "Aguardando a família", cor: COR.aviso }, { chave: "REABERTO", titulo: "Reaberto", cor: COR.erro },
  { chave: "RESOLVIDO", titulo: "Resolvido (7 dias)", cor: COR.ok },
];

/** Casos das famílias em quadro: cada caso na etapa em que está, com o prazo (SLA), a prioridade e quem cuida. */
export default async function QuadroCasos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireMatriculas(); const sp = await searchParams; await escalarVencidos();
  const scope = scopeUnit(s); const units = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`;
  const unitId = scope ?? (units.some(u => u.id === Number(sp.unidade)) ? Number(sp.unidade) : null);
  const tipo = (CASE_TIPOS as readonly string[]).includes(sp.tipo ?? "") ? sp.tipo! : ""; const meus = sp.meus === "1";
  const rows = await sql<{ id: number; assunto: string; tipo: string; status: string; prioridade: string; unidade: string; aluno: string | null; responsavel: string | null; sla_ate: Date | null; escalado: boolean; created_at: Date; resolvido_em: Date | null }[]>`
    SELECT c.id, c.assunto, c.tipo, c.status, c.prioridade, u.nome AS unidade, st.nome AS aluno, us.nome AS responsavel, c.sla_ate, (c.escalado_em IS NOT NULL) AS escalado, c.created_at, c.resolvido_em
    FROM cases c JOIN units u ON u.id=c.unit_id LEFT JOIN students st ON st.id=c.student_id LEFT JOIN users us ON us.id=c.responsavel_user_id
    WHERE (c.status = ANY(${ABERTOS}) OR (c.status IN ('RESOLVIDO','FECHADO') AND coalesce(c.resolvido_em, c.updated_at) >= now() - interval '7 days'))
      ${unitId === null ? sql`` : sql`AND c.unit_id=${unitId}`} ${tipo ? sql`AND c.tipo=${tipo}` : sql``} ${meus ? sql`AND c.responsavel_user_id=${s.id}` : sql``}
    ORDER BY c.sla_ate NULLS LAST, c.created_at LIMIT 600`;
  const agora = Date.now();
  const cartao = (c: typeof rows[number]): CartaoQuadro => { const aberto = ABERTOS.includes(c.status); const sla = aberto ? seloSla(c.sla_ate, agora) : null; return {
    chave: String(c.id), titulo: c.assunto, href: `/atendimento/casos/${c.id}`, responsavel: c.responsavel,
    linhas: [[c.aluno, CASE_TIPO_LABEL[c.tipo] ?? c.tipo].filter(Boolean).join(" · "), unitId === null ? c.unidade : null],
    selos: [...(sla ? [sla] : []), ...(["ALTA", "URGENTE"].includes(c.prioridade) ? [{ texto: CASE_PRIO[c.prioridade].toLowerCase(), tom: c.prioridade === "URGENTE" ? "ruim" as const : "atencao" as const }] : []), ...(c.escalado && aberto ? [{ texto: "escalado", tom: "ruim" as const }] : [])],
    destaque: sla?.tom === "ruim" ? "ruim" : sla?.tom === "atencao" ? "atencao" : c.status === "RESOLVIDO" || c.status === "FECHADO" ? "bom" : null,
  }; };
  const colunas: ColunaQuadro[] = COLS.map(c => { const xs = rows.filter(r => c.chave === "RESOLVIDO" ? ["RESOLVIDO", "FECHADO"].includes(r.status) : r.status === c.chave); return { ...c, itens: xs.map(cartao), descricao: c.chave !== "RESOLVIDO" ? `${xs.filter(x => x.sla_ate && new Date(x.sla_ate).getTime() < agora).length} com SLA vencido` : undefined }; });
  const abertos = rows.filter(r => ABERTOS.includes(r.status)); const vencidos = abertos.filter(r => r.sla_ate && new Date(r.sla_ate).getTime() < agora);
  const carga = new Map<string, { ok: number; venc: number }>(); for (const r of abertos) { const k = r.responsavel ?? "Sem responsável"; const x = carga.get(k) ?? { ok: 0, venc: 0 }; if (r.sla_ate && new Date(r.sla_ate).getTime() < agora) x.venc++; else x.ok++; carga.set(k, x); }
  return (
    <Page title="Casos das famílias — quadro" sub="Cada caso na etapa em que está, ordenado pelo prazo (SLA). Vermelho: SLA vencido; âmbar: vence em até 24 horas." actions={<div className="flex flex-wrap gap-2 print:hidden"><Btn kind="ghost" href="/atendimento/casos">Ver em lista</Btn><Btn kind="ghost" href="/fluxos?fluxo=CASO">Central de fluxos</Btn></div>}>
      <form className="mb-3 flex flex-wrap items-end gap-2 print:hidden">
        {scope === null && <Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Todas</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
        <Field label="Tipo"><Select name="tipo" defaultValue={tipo}><option value="">Todos</option>{CASE_TIPOS.map(t => <option key={t} value={t}>{CASE_TIPO_LABEL[t]}</option>)}</Select></Field>
        <label className="flex items-center gap-1.5 pb-2 text-xs"><input type="checkbox" name="meus" value="1" defaultChecked={meus} /> só os meus</label>
        <Btn kind="ghost">Ver</Btn>
      </form>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard titulo="Em aberto" valor={String(abertos.length)} />
        <KpiCard titulo="SLA vencido" valor={String(vencidos.length)} tom={vencidos.length ? "ruim" : "bom"} />
        <KpiCard titulo="Aguardando a família" valor={String(abertos.filter(r => r.status === "AGUARDANDO_FAMILIA").length)} tom="neutro" />
        <KpiCard titulo="Resolvidos em 7 dias" valor={String(rows.length - abertos.length)} tom="bom" />
      </div>
      <Quadro rotulo="Quadro dos casos" colunas={colunas} />
      {carga.size > 0 && <Card title="Carga por responsável (em aberto)" className="mt-4"><BarrasH rotulo="Casos em aberto por responsável" largRotulo="10rem" itens={[...carga.entries()].sort((a, b) => b[1].venc - a[1].venc || (b[1].ok + b[1].venc) - (a[1].ok + a[1].venc)).slice(0, 12).map(([k, x]) => ({ chave: k, rotulo: k, valor: x.ok + x.venc, texto: `${x.ok + x.venc}${x.venc ? ` · ${x.venc} vencido(s)` : ""}`, segmentos: [{ valor: x.ok, cor: COR.acao, rotulo: "No prazo" }, { valor: x.venc, cor: COR.erro, rotulo: "SLA vencido" }] }))} formato={x => String(x)} /></Card>}
    </Page>
  );
}
