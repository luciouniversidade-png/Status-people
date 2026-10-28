import { requireSession, scopeUnit, can } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Badge, Flash, Field, Input, Select, Textarea, Btn } from "@/components/ui";
import { fmtData, fmtDataHora, hoje } from "@/lib/utils";
import { ROLE_LABEL } from "@/lib/auth";
import type { Role } from "@/lib/session";
import { PUBLICO } from "@/lib/comunicacao";
import { publicarComunicado, cienciaComunicado, removerComunicado, decidirComunicado } from "../actions";
import { getSettings } from "@/lib/utils";
import { Modal } from "@/components/Modal";

export const dynamic = "force-dynamic";

export default async function Comunicados({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams; const u = scopeUnit(s); const h = hoje();
  const cfg = await getSettings(); const aprova = can.aprovar(s, "massa");
  const rows = await sql<{ id: number; titulo: string; texto: string; publico: string; unidade: string | null; role: string | null; cargo: string | null; requer_ciencia: boolean; prazo_ciencia: string | null; fixado: boolean; autor_nome: string | null; publicado_em: Date | string; expira_em: string | null; li: boolean; cientes: number; alvo: number; status: string; destinatarios: number | null; disparo_em: string | null; motivo_rejeicao: string | null; autor_user_id: number | null }[]>`
    SELECT a.id, a.titulo, a.texto, a.publico, un.nome AS unidade, a.role, pc.nome AS cargo, a.requer_ciencia, a.prazo_ciencia::text, a.fixado, a.autor_nome, a.publicado_em, a.expira_em::text, a.status, a.destinatarios, to_char((a.disparo_em AT TIME ZONE 'UTC') AT TIME ZONE 'America/Campo_Grande', 'DD/MM HH24:MI') AS disparo_em, a.motivo_rejeicao, a.autor_user_id,
      EXISTS (SELECT 1 FROM announcement_acks k WHERE k.announcement_id=a.id AND k.user_id=${s.id}) AS li,
      (SELECT count(*) FROM announcement_acks k WHERE k.announcement_id=a.id)::int AS cientes,
      (SELECT count(*) FROM users us LEFT JOIN employees ue ON ue.id=us.employee_id WHERE us.ativo AND us.role <> 'LEITURA' AND (a.publico='TODOS' OR (a.publico='UNIDADE' AND (coalesce(ue.unit_id, us.unit_id)=a.unit_id OR (us.unit_id IS NULL AND us.role IN ('DIRECAO','RH')))) OR (a.publico='PERFIL' AND us.role=a.role) OR (a.publico='CARGO' AND ue.position_id=a.position_id)))::int AS alvo
    FROM announcements a LEFT JOIN units un ON un.id=a.unit_id LEFT JOIN positions pc ON pc.id=a.position_id
    WHERE (a.expira_em IS NULL OR a.expira_em >= ${h}) AND (a.status='PUBLICADO' OR a.autor_user_id=${s.id} OR (${aprova} AND a.status IN ('AGUARDANDO_APROVACAO','AGENDADO','APROVADO'))) AND (a.publico='TODOS' OR (a.publico='UNIDADE' AND (${u === null} OR a.unit_id=${u ?? 0})) OR (a.publico='PERFIL' AND a.role=${s.role}) OR (a.publico='CARGO' AND a.position_id=${s.positionId ?? 0}) OR ${can.editar(s)})
    ORDER BY a.fixado DESC, a.publicado_em DESC LIMIT 100`;
  const units = await db.select().from(schema.units).orderBy(asc(schema.units.nome)); const cargos = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM positions ORDER BY ordem, nome`; const pode = ["DIRECAO", "RH", "DIRETOR_UNIDADE"].includes(s.role);
  const pendentes = rows.filter(r => r.status === "PUBLICADO" && r.requer_ciencia && !r.li);
  const naFila = rows.filter(r => r.status !== "PUBLICADO"); const publicados = rows.filter(r => r.status === "PUBLICADO");
  return (
    <Page title="Comunicados internos" sub="Mural da equipe. Comunicados com ciência obrigatória mostram quem já leu." actions={<><Btn kind="ghost" href="/comunicacao/mensagens">Mensagens às famílias</Btn><Btn kind="ghost" href="/comunicacao/modelos">Modelos</Btn></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {pendentes.length > 0 && <Card className="mb-4 border-amber-200"><p className="text-sm">Você tem <b>{pendentes.length}</b> comunicado(s) aguardando sua ciência.</p></Card>}
      <div className={`grid grid-cols-1 gap-4 ${pode ? "lg:grid-cols-[minmax(0,1fr)_360px]" : ""} lg:items-start`}>
        <div className="space-y-3">
          {naFila.length > 0 && <Card title="Comunicação em massa — aprovação e agenda" className="border-amber-300"><ul className="divide-y divide-line text-sm">{naFila.map(r => <li key={r.id} id={`c${r.id}`} className="py-2"><div className="flex flex-wrap items-start justify-between gap-2"><span className="min-w-0"><b>{r.titulo}</b><span className="block text-xs text-slate-500">{r.autor_nome} · {r.destinatarios ?? r.alvo} destinatário(s) · {r.status === "AGUARDANDO_APROVACAO" ? "aguardando o segundo aprovador" : r.status === "AGENDADO" ? `aprovado — publica ${r.disparo_em} (horário comercial)` : r.status === "REJEITADO" ? `não aprovado: ${r.motivo_rejeicao ?? ""}` : r.status.toLowerCase()}</span></span>
            <Badge v={r.status === "REJEITADO" ? "REJEITADA" : r.status === "AGENDADO" ? "EM_ADMISSAO" : "PENDENTE"} label={r.status === "AGUARDANDO_APROVACAO" ? "aguardando aprovação" : r.status === "AGENDADO" ? "agendado" : r.status === "REJEITADO" ? "rejeitado" : r.status.toLowerCase()} /></div>
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-slate-600">{r.texto}</p>
            {aprova && r.status === "AGUARDANDO_APROVACAO" && r.autor_user_id !== s.id && <div className="mt-2 flex flex-wrap gap-2"><form action={decidirComunicado}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decisao" value="APROVAR" /><Btn small>Aprovar e publicar</Btn></form><Modal label="Rejeitar" title="Rejeitar comunicado em massa"><form action={decidirComunicado} className="space-y-2"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decisao" value="REJEITAR" /><Field label="Motivo"><Textarea name="motivo" required /></Field><Btn small danger>Rejeitar</Btn></form></Modal></div>}
            {r.status === "AGUARDANDO_APROVACAO" && r.autor_user_id === s.id && <p className="mt-1 text-[11px] text-slate-500">Você é o autor: a aprovação é de outra pessoa (Direção ou RH).</p>}</li>)}</ul></Card>}
          {publicados.length === 0 && <Card><p className="text-sm text-slate-500">Nenhum comunicado.</p></Card>}
          {publicados.map(r => <Card key={r.id} className={r.fixado ? "border-sky-300" : ""} title={<span id={`c${r.id}`} className="flex flex-wrap items-center gap-2">{r.fixado && <Badge v="APROVADA" label="fixado" />}{r.titulo}<span className="text-xs font-normal text-slate-500">· {r.autor_nome} · {fmtDataHora(r.publicado_em)} · {r.publico === "TODOS" ? "toda a equipe" : r.publico === "UNIDADE" ? r.unidade : r.publico === "CARGO" ? `cargo ${r.cargo ?? ""}` : ROLE_LABEL[r.role as Role] ?? r.role}</span></span>}>
            <p className="whitespace-pre-wrap text-sm">{r.texto}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-600">
              {r.requer_ciencia && (r.li ? <Badge v="APROVADA" label="você deu ciência" /> : <form action={cienciaComunicado}><input type="hidden" name="id" value={r.id} /><Btn small>Li e estou ciente</Btn></form>)}
              {r.requer_ciencia && can.editar(s) && <span>{r.cientes}/{r.alvo} cientes{r.prazo_ciencia ? ` · prazo ${fmtData(r.prazo_ciencia)}` : ""}</span>}
              {r.expira_em && <span>expira em {fmtData(r.expira_em)}</span>}
              {can.editar(s) && <form action={removerComunicado} className="ml-auto"><input type="hidden" name="id" value={r.id} /><button className="text-erro">remover</button></form>}
            </div></Card>)}
        </div>
        {pode && <Card title="Novo comunicado"><form action={publicarComunicado} className="space-y-2">
          <Field label="Título"><Input name="titulo" required /></Field><Field label="Texto"><Textarea name="texto" className="min-h-[120px]" required /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Público"><Select name="publico" defaultValue={s.role === "DIRETOR_UNIDADE" ? "UNIDADE" : "TODOS"}>{Object.entries(PUBLICO).filter(([k]) => s.role !== "DIRETOR_UNIDADE" || k === "UNIDADE").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Unidade (se for o caso)"><Select name="unitId" defaultValue={u ?? ""}><option value="">—</option>{units.filter(x => u === null || x.id === u).map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field></div>
          <div className="grid grid-cols-2 gap-2"><Field label="Cargo (se for o caso)"><Select name="positionId" defaultValue=""><option value="">—</option>{cargos.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select></Field><Field label="Atuação (se for o caso)"><Select name="role" defaultValue=""><option value="">—</option>{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field></div>
          <div className="grid grid-cols-2 gap-2"><Field label="Prazo de ciência"><Input name="prazoCiencia" type="date" /></Field><Field label="Expira em"><Input name="expiraEm" type="date" /></Field></div>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="requerCiencia" value="1" /> Exigir ciência (cada pessoa clica "Li e estou ciente")</label><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="fixado" value="1" /> Fixar no topo</label>
          <Btn small>Publicar</Btn><p className="text-xs text-slate-500">Todos do público recebem uma notificação no sistema (e no resumo por e-mail, quando ativo). Para {cfg.comunicacao.massaMinDestinatarios as number} pessoas ou mais é comunicação em massa: sai só depois da aprovação de outra pessoa (Direção ou RH) e em horário comercial.</p></form></Card>}
      </div>
    </Page>
  );
}
