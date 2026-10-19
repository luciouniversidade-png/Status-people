import Link from "@/components/Link";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Badge, Btn } from "@/components/ui";
import { fmtDataHora } from "@/lib/utils";
import { lerNotificacoes } from "../comunicacao/actions";
import { lerGrupo } from "./actions";
import { agruparNotificacoes, type Notif } from "@/lib/notif-grupos";

export const dynamic = "force-dynamic";

export default async function Notificacoes() {
  const s = await requireSession();
  const rows = await sql<{ id: number; tipo: string; titulo: string; texto: string | null; link: string | null; lida_em: Date | string | null; created_at: Date | string }[]>`SELECT id, tipo, titulo, texto, link, lida_em, created_at FROM notifications WHERE user_id=${s.id} ORDER BY (lida_em IS NULL) DESC, created_at DESC LIMIT 100`;
  const naoLidas = rows.filter(r => !r.lida_em);
  return (
    <Page title="Notificações" sub={`${naoLidas.length} não lida(s). Aprovações pendentes, prazos vencendo, comunicados e atribuições chegam aqui — e no resumo diário por e-mail, quando ativo.`} actions={naoLidas.length > 0 ? <form action={lerNotificacoes}><Btn kind="ghost">Marcar todas como lidas</Btn></form> : undefined}>
      {rows.length === 0 ? <Card><p className="text-sm text-slate-500">Nenhuma notificação.</p></Card> : <ul className="space-y-2">{agruparNotificacoes(rows as Notif[]).map(it => it.tipo === "UNICA" ? <Item key={it.n.id} n={it.n} /> : (
        <li key={it.chave} className={`rounded-md border px-4 py-3 ${it.maisRecente.tipo === "ALERTA" ? "border-red-200 bg-red-50/40" : it.maisRecente.tipo === "ACAO" ? "border-amber-200 bg-amber-50/40" : "border-sky-200 bg-sky-50/40"}`}>
          <div className="flex flex-wrap items-center gap-2"><Badge v={it.maisRecente.tipo === "ALERTA" ? "REJEITADA" : it.maisRecente.tipo === "ACAO" ? "PENDENTE" : "ATIVO"} label={`${it.itens.length} ×`} /><span className="text-sm font-medium text-ink">{it.itens.length} × {it.rotulo}</span><span className="text-xs text-slate-500">a mais recente em {fmtDataHora(it.maisRecente.created_at)}</span>
            <form action={lerGrupo} className="ml-auto">{it.itens.map(x => <input key={x.id} type="hidden" name="id" value={x.id} />)}<button className="text-xs text-acao underline">marcar o grupo como lido</button></form></div>
          <details className="mt-1"><summary className="cursor-pointer text-xs text-slate-600">ver os {it.itens.length}</summary><ul className="mt-1 space-y-1">{it.itens.map(x => <li key={x.id} className="flex flex-wrap items-center gap-2 text-xs"><span className="text-ink">{x.titulo}</span>{x.texto && <span className="text-slate-500">{x.texto}</span>}{x.link && <form action={lerNotificacoes} className="ml-auto"><input type="hidden" name="id" value={x.id} /><input type="hidden" name="link" value={x.link} /><button className="text-acao underline">abrir</button></form>}</li>)}</ul></details>
        </li>))}</ul>}
      <p className="mt-4 text-xs text-slate-500">Para os alertas de prazo chegarem sozinhos todo dia, a hospedagem precisa chamar <code>/api/tarefas?token=…</code> uma vez por dia (veja o LEIA-ME). <Link className="text-acao" href="/comunicacao/comunicados">Comunicados</Link></p>
    </Page>
  );
}

function Item({ n }: { n: Notif }) {
  return <li className={`rounded-md border px-4 py-3 ${n.lida_em ? "border-line bg-white" : n.tipo === "ALERTA" ? "border-red-200 bg-red-50/40" : n.tipo === "ACAO" ? "border-amber-200 bg-amber-50/40" : "border-sky-200 bg-sky-50/40"}`}><div className="flex flex-wrap items-center gap-2"><Badge v={n.tipo === "ALERTA" ? "REJEITADA" : n.tipo === "ACAO" ? "PENDENTE" : "ATIVO"} label={n.tipo === "ALERTA" ? "alerta" : n.tipo === "ACAO" ? "ação" : "aviso"} /><span className={`text-sm ${n.lida_em ? "text-slate-700" : "font-medium text-ink"}`}>{n.titulo}</span><span className="text-xs text-slate-500">{fmtDataHora(n.created_at)}</span>{n.link && <form action={lerNotificacoes} className="ml-auto"><input type="hidden" name="id" value={n.id} /><input type="hidden" name="link" value={n.link} /><button className="text-xs text-acao underline">abrir</button></form>}</div>{n.texto && <p className="mt-1 text-xs text-slate-600">{n.texto}</p>}</li>;
}
