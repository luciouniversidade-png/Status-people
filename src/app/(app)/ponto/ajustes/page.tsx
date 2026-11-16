import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Flash, Badge, Btn, Field, Input, Stat } from "@/components/ui";
import { fmtData, fmtDataHora } from "@/lib/utils";
import { filtroAprovaAjuste, TIPO_AJUSTE, STATUS_AJUSTE, TOM_AJUSTE } from "@/lib/autoatendimento";
import { decidirAjuste, lancarAjuste } from "./actions";

export const dynamic = "force-dynamic";
const ABAS: [string, string][] = [["aprovar", "Para aprovar"], ["lancar", "Para lançar (RH)"], ["historico", "Histórico"]];

/** v34 · Ajustes de ponto pedidos no Meu espaço: o(a) gestor(a) direto(a) ou a direção da unidade aprova; o RH lança no ponto. */
export default async function Ajustes({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams;
  if (!["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role) && !s.employeeId) redirect("/sem-acesso?t=%2Fponto%2Fajustes");
  const rh = ["RH", "DIRECAO"].includes(s.role); const aba = ABAS.some(a => a[0] === sp.aba) && (sp.aba !== "lancar" || rh) ? sp.aba! : "aprovar";
  const filtro = filtroAprovaAjuste(s);
  const cond = aba === "aprovar" ? sql`r.status='PENDENTE'` : aba === "lancar" ? sql`r.status='APROVADO'` : sql`r.status IN ('AJUSTADO','RECUSADO','CANCELADO')`;
  const [lista, [tot]] = await Promise.all([
    sql<{ id: number; employee_id: number; nome: string; unidade: string; data: string; tipo: string; marcacoes: string; motivo: string; status: string; created_at: string; aprovado_nome: string | null; aprovado_em: string | null; resposta: string | null; ajustado_nome: string | null; atual: string | null; situacao: string | null }[]>`
      SELECT r.id, r.employee_id, e.nome, u.nome AS unidade, r.data::text, r.tipo, r.marcacoes, r.motivo, r.status, r.created_at::text, r.aprovado_nome, r.aprovado_em::text, r.resposta, r.ajustado_nome, t.marcacoes AS atual, t.status AS situacao
      FROM timesheet_adjust_requests r JOIN employees e ON e.id=r.employee_id JOIN units u ON u.id=e.unit_id LEFT JOIN timesheet_days t ON t.employee_id=r.employee_id AND t.data=r.data
      WHERE ${cond} AND ${filtro} ORDER BY ${aba === "historico" ? sql`r.created_at DESC` : sql`r.created_at`} LIMIT 300`,
    sql<{ aprovar: number; lancar: number }[]>`SELECT count(*) FILTER (WHERE r.status='PENDENTE')::int AS aprovar, count(*) FILTER (WHERE r.status='APROVADO')::int AS lancar FROM timesheet_adjust_requests r JOIN employees e ON e.id=r.employee_id WHERE ${filtro}`,
  ]);
  return (
    <Page title="Ajustes de ponto" sub="Pedidos feitos pelo Meu espaço (esqueci de marcar, marcação errada, serviço externo). Quem aprova: gestor(a) direto(a), direção da unidade ou RH. O RH lança no espelho do ONE — e no relógio, quando o ponto vem de lá.">
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Para aprovar" value={tot?.aprovar ?? 0} />{rh ? <Stat label="Aprovados, para lançar" value={tot?.lancar ?? 0} /> : null}</div>
      <div className="mb-3 flex flex-wrap gap-2 text-xs">{ABAS.filter(a => a[0] !== "lancar" || rh).map(([k, r]) => <Link key={k} href={`/ponto/ajustes?aba=${k}`} className={`rounded-full border px-2.5 py-1 ${aba === k ? "border-acao bg-sky-50 text-acao" : "border-line text-slate-600"}`}>{r}</Link>)}</div>
      {lista.length === 0 ? <Card><p className="text-sm text-slate-500">{aba === "aprovar" ? "Nenhum pedido aguardando você." : aba === "lancar" ? "Nada para lançar." : "Sem histórico."}</p></Card> :
        <div className="space-y-3">{lista.map(r => <Card key={r.id}>
          <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><Link className="font-medium text-acao" href={`/colaboradores/${r.employee_id}`}>{r.nome}</Link><span className="block text-xs text-slate-500">{r.unidade} · pedido em {fmtDataHora(r.created_at)}</span></div><Badge v={TOM_AJUSTE[r.status] ?? "PENDENTE"} label={STATUS_AJUSTE[r.status] ?? r.status} /></div>
          <div className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <div><span className="block text-[11px] text-slate-500">Dia</span><b>{fmtData(r.data)}</b> · {TIPO_AJUSTE[r.tipo] ?? r.tipo}</div>
            <div><span className="block text-[11px] text-slate-500">Hoje no espelho</span>{r.atual ?? (r.situacao ? r.situacao.toLowerCase() : "sem marcação importada")}</div>
            <div><span className="block text-[11px] text-slate-500">Pedido</span><b className="tabular-nums">{r.marcacoes}</b></div>
          </div>
          <p className="mt-2 text-sm text-slate-700 [overflow-wrap:anywhere]">“{r.motivo}”</p>
          {r.aprovado_nome ? <p className="mt-1 text-xs text-slate-500">{r.status === "RECUSADO" ? "Recusado" : "Aprovado"} por {r.aprovado_nome} em {fmtDataHora(r.aprovado_em)}{r.resposta ? ` — ${r.resposta}` : ""}{r.ajustado_nome ? ` · lançado por ${r.ajustado_nome}` : ""}</p> : null}
          {aba === "aprovar" ? <form action={decidirAjuste} className="mt-2 flex flex-wrap items-end gap-2"><input type="hidden" name="id" value={r.id} />
            <Field label="Resposta (obrigatória para recusar)" className="min-w-[14rem] flex-1"><Input name="resposta" maxLength={500} /></Field>
            {rh ? <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="lancar" value="1" defaultChecked /> já lançar no espelho do ONE</label> : null}
            <Btn small name="decisao" value="APROVAR">Aprovar</Btn><Btn small kind="ghost" name="decisao" value="RECUSAR">Recusar</Btn>
          </form> : null}
          {aba === "lancar" ? <div className="mt-2 flex flex-wrap gap-2"><form action={lancarAjuste}><input type="hidden" name="id" value={r.id} /><Btn small>Lançar no espelho do ONE</Btn></form><form action={lancarAjuste}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="modo" value="RELOGIO" /><Btn small kind="ghost">Ajustei no relógio (vem na importação)</Btn></form></div> : null}
        </Card>)}</div>}
    </Page>
  );
}
