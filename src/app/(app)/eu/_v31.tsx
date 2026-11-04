// v31 · Meu espaço: minhas 1:1 (próximas e a pauta), feedback (recebidos, pedidos para responder) e minhas metas em aprovação.
import Link from "@/components/Link";
import { sql } from "@/db";
import type { Session } from "@/lib/auth";
import { Card, Btn, Badge } from "@/components/ui";
import { hoje, fmtData } from "@/lib/utils";

export async function MeuEspacoV31({ s, eid }: { s: Session; eid: number }) {
  const h = hoje();
  const [proximas, pedidos, novos, metas, [g]] = await Promise.all([
    sql<{ id: number; titulo: string; data: string; inicio: string; outro: string | null; pauta: number }[]>`SELECT o.id, o.titulo, o.data::text, o.inicio, CASE WHEN o.organizador_user_id=${s.id} THEN e.nome ELSE o.organizador_nome END AS outro, jsonb_array_length(o.pauta)::int AS pauta FROM one_on_ones o JOIN employees e ON e.id=o.employee_id WHERE o.status='MARCADA' AND o.data >= ${h} AND (o.employee_id=${eid} OR o.organizador_user_id=${s.id}) ORDER BY o.data, o.inicio LIMIT 4`,
    sql<{ id: number; solicitante_nome: string | null; assunto: string; prazo: string | null }[]>`SELECT id, solicitante_nome, assunto, prazo::text FROM feedback_requests WHERE para_user_id=${s.id} AND status='PENDENTE' ORDER BY prazo NULLS LAST LIMIT 4`,
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM feedbacks WHERE employee_id=${eid} AND status='ENVIADO' AND ciencia_em IS NULL`,
    sql<{ aprovacao: string; n: number }[]>`SELECT g.aprovacao, count(*)::int AS n FROM perf_goals g JOIN perf_cycles c ON c.id=g.cycle_id WHERE g.employee_id=${eid} AND c.fase NOT IN ('CONCLUSAO','ARQUIVADO') GROUP BY 1`,
    sql<{ gestor_id: number | null }[]>`SELECT gestor_id FROM employees WHERE id=${eid}`,
  ]);
  const nm = (k: string) => metas.find(m => m.aprovacao === k)?.n ?? 0;
  return <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
    <Card title="Minhas 1:1" actions={<Link className="text-xs text-acao underline" href="/um-a-um?aba=agenda">agenda</Link>}>
      {proximas.length === 0 ? <p className="text-sm text-slate-500">Nenhuma 1:1 marcada.</p> : <ul className="space-y-1.5 text-sm">{proximas.map(o => <li key={o.id} className="flex flex-wrap items-center justify-between gap-2"><span><Link className="font-medium text-acao" href={`/um-a-um/${o.id}`}>{fmtData(o.data).slice(0, 5)} às {o.inicio}</Link> · {o.titulo} <span className="text-xs text-slate-500">com {o.outro ?? "—"}</span></span><span className="text-xs text-slate-500">{o.pauta ? `${o.pauta} ponto(s) de pauta` : "sem pauta — inclua os seus pontos"}</span></li>)}</ul>}
      <div className="mt-3 flex flex-wrap gap-2">{g?.gestor_id && <Btn small kind="ghost" href={`/um-a-um?marcar=${g.gestor_id}`}>Pedir 1:1 ao meu gestor</Btn>}<Btn small kind="ghost" href="/um-a-um">Minhas 1:1</Btn></div>
    </Card>
    <Card title="Feedback" actions={<Link className="text-xs text-acao underline" href="/feedback">abrir</Link>}>
      <ul className="space-y-1 text-sm">
        <li>{novos[0].n ? <Link className="text-acao" href="/feedback?aba=recebidos"><b>{novos[0].n}</b> feedback(s) novo(s) para ler</Link> : <span className="text-slate-500">Nenhum feedback novo.</span>}</li>
        {pedidos.map(p => <li key={p.id} className="flex flex-wrap items-center gap-2"><Badge v="PENDENTE" label="pedido" /> <span>{p.solicitante_nome ?? "Um colega"} pediu feedback sobre <b>{p.assunto}</b>{p.prazo ? <span className="text-xs text-slate-500"> · até {fmtData(p.prazo)}</span> : null}</span><Link className="text-xs text-acao" href={`/feedback/novo?pedido=${p.id}`}>responder</Link></li>)}
        {(nm("PROPOSTA") > 0 || nm("DEVOLVIDA") > 0) && <li className="pt-1"><Link className="text-acao" href={`/colaboradores/${eid}/painel?aba=metas`}>Minhas metas</Link>: {nm("PROPOSTA") ? `${nm("PROPOSTA")} aguardando o gestor` : ""}{nm("PROPOSTA") && nm("DEVOLVIDA") ? " · " : ""}{nm("DEVOLVIDA") ? <span className="text-erro">{nm("DEVOLVIDA")} devolvida(s) para ajuste</span> : ""}</li>}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2"><Btn small href="/feedback/novo">Mandar feedback</Btn><Btn small kind="ghost" href="/feedback?aba=pedidos#pedir">Pedir feedback</Btn><Btn small kind="ghost" href="/feedback/novo?formato=ELOGIO">Elogiar um colega</Btn></div>
    </Card>
  </div>;
}
