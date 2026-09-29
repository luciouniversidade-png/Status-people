import Link from "@/components/Link";
import { requireStaff, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge, Flash, Field, Input, Select, Btn } from "@/components/ui";
import { fmtDataHora } from "@/lib/utils";
import { CANAL, MSG_STATUS, foneWa, linkWa } from "@/lib/comunicacao";
import { EnviarMensagem } from "@/components/EnviarMensagem";
import { marcarEnviada } from "../actions";

export const dynamic = "force-dynamic";

export default async function Mensagens({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const sp = await searchParams; const u = scopeUnit(s); const q = (sp.q ?? "").trim(); const canal = sp.canal ?? "";
  const rows = await sql<{ id: number; canal: string; destinatario_nome: string; destinatario_contato: string | null; texto: string; status: string; entidade: string | null; entidade_id: number | null; user_nome: string | null; created_at: Date | string; enviada_em: Date | string | null; erro: string | null; template: string | null; student_id: number | null; employee_id: number | null }[]>`SELECT m.*, t.codigo AS template FROM messages m LEFT JOIN message_templates t ON t.id=m.template_id WHERE 1=1 ${u === null ? sql`` : sql`AND (m.unit_id IS NULL OR m.unit_id=${u})`} ${q ? sql`AND (m.destinatario_nome ILIKE ${"%" + q + "%"} OR m.texto ILIKE ${"%" + q + "%"})` : sql``} ${canal ? sql`AND m.canal=${canal}` : sql``} ORDER BY m.created_at DESC LIMIT 200`;
  const destaque = sp.msg ? rows.find(r => r.id === Number(sp.msg)) : undefined; const wa = destaque && destaque.canal === "WHATSAPP" && destaque.status !== "ENVIADA" ? linkWa(foneWa(destaque.destinatario_contato), destaque.texto) : null;
  const [tot] = await sql<{ hoje: number; mes: number; falhas: number }[]>`SELECT count(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS hoje, count(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS mes, count(*) FILTER (WHERE status='FALHOU')::int AS falhas FROM messages ${u === null ? sql`` : sql`WHERE unit_id=${u}`}`;
  const entLink = (e: string | null, id: number | null) => !e || !id ? null : e === "caso" ? `/atendimento/casos/${id}` : e === "receivable" ? "/financeiro/inadimplencia" : e === "work_order" ? `/operacoes/chamados/${id}` : e === "student" ? `/matriculas/alunos/${id}` : e === "employee" ? `/colaboradores/${id}` : null;
  return (
    <Page title="Mensagens" sub={`Histórico de contatos com famílias e equipe por WhatsApp, e-mail e telefone. ${tot.hoje} hoje · ${tot.mes} no mês${tot.falhas ? ` · ${tot.falhas} falha(s)` : ""}. ${process.env.WHATSAPP_TOKEN ? "API do WhatsApp ativa." : "Sem API do WhatsApp: o envio abre o WhatsApp do celular com o texto pronto."}`} actions={<><Btn kind="ghost" href="/comunicacao/modelos">Modelos</Btn><Btn kind="ghost" href="/comunicacao/comunicados">Comunicados</Btn></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {wa && <Card className="mb-4 border-emerald-200"><p className="text-sm">Mensagem para <b>{destaque!.destinatario_nome}</b> pronta. <a className="inline-flex items-center rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700" href={wa} target="_blank" rel="noreferrer">Abrir no WhatsApp</a></p><form action={marcarEnviada} className="mt-2"><input type="hidden" name="id" value={destaque!.id} /><input type="hidden" name="voltar" value="/comunicacao/mensagens" /><Btn small kind="ghost">Marcar como enviada</Btn></form></Card>}
      <div className="grid gap-4 lg:grid-cols-[1fr_380px] lg:items-start">
        <div>
          <form className="mb-3 flex flex-wrap items-end gap-2"><Field label="Buscar"><Input name="q" defaultValue={q} placeholder="Nome ou texto" /></Field><Field label="Canal"><Select name="canal" defaultValue={canal}><option value="">Todos</option>{Object.entries(CANAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Btn kind="ghost">Filtrar</Btn></form>
          <Table head={["Quando", "Para", "Canal", "Mensagem", "Situação", "Por", ""]} empty="Nenhuma mensagem registrada.">{rows.map(m => { const l = entLink(m.entidade, m.entidade_id); const link = m.canal === "WHATSAPP" && m.status !== "ENVIADA" ? linkWa(foneWa(m.destinatario_contato), m.texto) : null; return <tr key={m.id} className={destaque?.id === m.id ? "bg-emerald-50/40" : ""}><Td className="whitespace-nowrap text-xs">{fmtDataHora(m.created_at)}</Td><Td><div className="font-medium">{m.destinatario_nome}</div><div className="text-xs text-slate-500">{m.destinatario_contato ?? ""}{l && <> · <Link className="text-acao" href={l}>{m.entidade === "caso" ? `caso #${m.entidade_id}` : m.entidade === "work_order" ? `chamado #${m.entidade_id}` : m.entidade}</Link></>}</div></Td><Td className="text-xs">{CANAL[m.canal]}{m.template ? <div className="text-slate-500">{m.template}</div> : null}</Td><Td className="max-w-[380px] text-xs text-slate-700">{m.texto}</Td><Td><Badge v={m.status === "ENVIADA" || m.status === "ENTREGUE" ? "APROVADA" : m.status === "FALHOU" ? "REJEITADA" : "PENDENTE"} label={MSG_STATUS[m.status]} />{m.erro && <div className="text-xs text-erro">{m.erro}</div>}</Td><Td className="text-xs">{m.user_nome ?? "—"}</Td><Td>{link && <a className="text-xs text-emerald-700 underline" href={link} target="_blank" rel="noreferrer">abrir WhatsApp</a>}</Td></tr>; })}</Table>
        </div>
        <Card title="Nova mensagem"><EnviarMensagem nome="" voltar="/comunicacao/mensagens" unitId={u} /></Card>
      </div>
    </Page>
  );
}
