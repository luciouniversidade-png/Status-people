import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Flash, Badge, Btn, Field, Input, Stat } from "@/components/ui";
import { fmtData, fmtDataHora } from "@/lib/utils";
import { podeAtestados, STATUS_ATESTADO, TOM_ATESTADO } from "@/lib/autoatendimento";
import { decidirAtestado } from "./actions";

export const dynamic = "force-dynamic";

/** v34 · Atestados enviados pelo Meu espaço (foto ou PDF). Só RH e Direção. O ONE não pede nem guarda o CID. */
export default async function Atestados({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!podeAtestados(s)) redirect("/sem-acesso?t=%2Fponto%2Fatestados"); const sp = await searchParams;
  const ver = sp.ver === "todos" ? "todos" : "enviados";
  const [lista, [tot]] = await Promise.all([
    sql<{ id: number; employee_id: number; nome: string; unidade: string; tipo: string; inicio: string; fim: string; dias: number | null; horas: string | null; obs: string | null; status: string; attachment_id: number | null; created_at: string; decidido_nome: string | null; decidido_em: string | null; resposta: string | null; soma60: number }[]>`
      SELECT m.id, m.employee_id, e.nome, u.nome AS unidade, m.tipo, m.inicio::text, m.fim::text, m.dias, m.horas, m.obs, m.status, m.attachment_id, m.created_at::text, m.decidido_nome, m.decidido_em::text, m.resposta,
        (SELECT coalesce(sum(x.dias),0) FROM medical_certificates x WHERE x.employee_id=m.employee_id AND x.status='ACEITO' AND x.tipo='DIAS' AND x.fim >= (m.inicio - 60) AND x.id <> m.id)::int AS soma60
      FROM medical_certificates m JOIN employees e ON e.id=m.employee_id JOIN units u ON u.id=e.unit_id WHERE ${ver === "enviados" ? sql`m.status='ENVIADO'` : sql`true`} ORDER BY m.created_at ${ver === "enviados" ? sql`ASC` : sql`DESC`} LIMIT 300`,
    sql<{ enviados: number; mes: number; dias30: number }[]>`SELECT count(*) FILTER (WHERE status='ENVIADO')::int AS enviados, count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS mes, coalesce(sum(dias) FILTER (WHERE status='ACEITO' AND inicio > current_date - 30),0)::int AS dias30 FROM medical_certificates`,
  ]);
  return (
    <Page title="Atestados recebidos" sub="Enviados pelo Meu espaço com foto ou PDF. Aceitar registra o afastamento e, se quiser, abona no espelho os dias importados como falta. Sem CID: o ONE não pede nem guarda.">
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3"><Stat label="Para conferir" value={tot?.enviados ?? 0} /><Stat label="Recebidos em 30 dias" value={tot?.mes ?? 0} /><Stat label="Dias de atestado aceitos (30 dias)" value={tot?.dias30 ?? 0} /></div>
      <div className="mb-3 flex gap-2 text-xs">{[["enviados", "Para conferir"], ["todos", "Todos"]].map(([k, r]) => <Link key={k} href={`/ponto/atestados${k === "todos" ? "?ver=todos" : ""}`} className={`rounded-full border px-2.5 py-1 ${ver === k ? "border-acao bg-sky-50 text-acao" : "border-line text-slate-600"}`}>{r}</Link>)}</div>
      {lista.length === 0 ? <Card><p className="text-sm text-slate-500">{ver === "enviados" ? "Nenhum atestado aguardando." : "Nenhum atestado recebido."}</p></Card> :
        <div className="space-y-3">{lista.map(m => { const total = (m.dias ?? 0) + m.soma60; return <Card key={m.id}>
          <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><Link className="font-medium text-acao" href={`/colaboradores/${m.employee_id}`}>{m.nome}</Link><span className="block text-xs text-slate-500">{m.unidade} · enviado em {fmtDataHora(m.created_at)}</span></div><Badge v={TOM_ATESTADO[m.status] ?? "PENDENTE"} label={STATUS_ATESTADO[m.status] ?? m.status} /></div>
          <p className="mt-2 text-sm">{m.tipo === "DIAS" ? <><b>{m.dias} dia(s)</b> · {fmtData(m.inicio)}{m.fim !== m.inicio ? ` a ${fmtData(m.fim)}` : ""}</> : <><b>Comparecimento</b> · {fmtData(m.inicio)} · {m.horas}</>}{m.attachment_id ? <> · <a className="text-acao underline" href={`/api/anexos/${m.attachment_id}`} target="_blank" rel="noopener">ver o atestado</a></> : null}</p>
          {m.obs ? <p className="mt-1 text-xs text-slate-600 [overflow-wrap:anywhere]">Obs.: {m.obs}</p> : null}
          {m.tipo === "DIAS" && total > 15 ? <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">{total} dias de atestado em 60 dias (com este). Se for a mesma doença, do 16º dia em diante o afastamento é pago pelo INSS: encaminhe para a perícia.</p> : null}
          {m.decidido_nome ? <p className="mt-1 text-xs text-slate-500">{m.status === "ACEITO" ? "Aceito" : "Recusado"} por {m.decidido_nome} em {fmtDataHora(m.decidido_em)}{m.resposta ? ` — ${m.resposta}` : ""}</p> : null}
          {m.status === "ENVIADO" ? <form action={decidirAtestado} className="mt-2 flex flex-wrap items-end gap-2"><input type="hidden" name="id" value={m.id} />
            <Field label="Resposta (obrigatória para recusar)" className="min-w-[14rem] flex-1"><Input name="resposta" maxLength={500} /></Field>
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="abonar" value="1" defaultChecked /> abonar no espelho os dias já importados</label>
            <Btn small name="decisao" value="ACEITAR">Aceitar</Btn><Btn small kind="ghost" name="decisao" value="RECUSAR">Recusar</Btn>
          </form> : null}
        </Card>; })}</div>}
    </Page>
  );
}
