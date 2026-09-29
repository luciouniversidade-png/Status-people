import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Badge, Btn } from "@/components/ui";
import { fmtDataHora } from "@/lib/utils";
import { lerNotificacoes } from "../comunicacao/actions";

export const dynamic = "force-dynamic";

export default async function Notificacoes() {
  const s = await requireSession();
  const rows = await sql<{ id: number; tipo: string; titulo: string; texto: string | null; link: string | null; lida_em: Date | string | null; created_at: Date | string }[]>`SELECT id, tipo, titulo, texto, link, lida_em, created_at FROM notifications WHERE user_id=${s.id} ORDER BY (lida_em IS NULL) DESC, created_at DESC LIMIT 100`;
  const naoLidas = rows.filter(r => !r.lida_em);
  return (
    <Page title="Notificações" sub={`${naoLidas.length} não lida(s). Aprovações pendentes, prazos vencendo, comunicados e atribuições chegam aqui — e no resumo diário por e-mail, quando ativo.`} actions={naoLidas.length > 0 ? <form action={lerNotificacoes}><Btn kind="ghost">Marcar todas como lidas</Btn></form> : undefined}>
      {rows.length === 0 ? <Card><p className="text-sm text-slate-500">Nenhuma notificação.</p></Card> : <ul className="space-y-2">{rows.map(n => <li key={n.id} className={`rounded-md border px-4 py-3 ${n.lida_em ? "border-line bg-white" : n.tipo === "ALERTA" ? "border-red-200 bg-red-50/40" : n.tipo === "ACAO" ? "border-amber-200 bg-amber-50/40" : "border-sky-200 bg-sky-50/40"}`}><div className="flex flex-wrap items-center gap-2"><Badge v={n.tipo === "ALERTA" ? "REJEITADA" : n.tipo === "ACAO" ? "PENDENTE" : "ATIVO"} label={n.tipo === "ALERTA" ? "alerta" : n.tipo === "ACAO" ? "ação" : "aviso"} /><span className={`text-sm ${n.lida_em ? "text-slate-700" : "font-medium text-ink"}`}>{n.titulo}</span><span className="text-xs text-slate-500">{fmtDataHora(n.created_at)}</span>{n.link && <form action={lerNotificacoes} className="ml-auto"><input type="hidden" name="id" value={n.id} /><input type="hidden" name="link" value={n.link} /><button className="text-xs text-acao underline">abrir</button></form>}</div>{n.texto && <p className="mt-1 text-xs text-slate-600">{n.texto}</p>}</li>)}</ul>}
      <p className="mt-4 text-xs text-slate-500">Para os alertas de prazo chegarem sozinhos todo dia, a hospedagem precisa chamar <code>/api/tarefas?token=…</code> uma vez por dia (veja o LEIA-ME). <Link className="text-acao" href="/comunicacao/comunicados">Comunicados</Link></p>
    </Page>
  );
}
