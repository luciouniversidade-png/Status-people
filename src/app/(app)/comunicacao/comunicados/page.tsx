import { requireSession, scopeUnit, can } from "@/lib/auth";
import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Badge, Flash, Field, Input, Select, Textarea, Btn } from "@/components/ui";
import { fmtData, fmtDataHora, hoje } from "@/lib/utils";
import { ROLE_LABEL } from "@/lib/auth";
import type { Role } from "@/lib/session";
import { PUBLICO } from "@/lib/comunicacao";
import { publicarComunicado, cienciaComunicado, removerComunicado } from "../actions";

export const dynamic = "force-dynamic";

export default async function Comunicados({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams; const u = scopeUnit(s); const h = hoje();
  const rows = await sql<{ id: number; titulo: string; texto: string; publico: string; unidade: string | null; role: string | null; requer_ciencia: boolean; prazo_ciencia: string | null; fixado: boolean; autor_nome: string | null; publicado_em: Date | string; expira_em: string | null; li: boolean; cientes: number; alvo: number }[]>`
    SELECT a.id, a.titulo, a.texto, a.publico, un.nome AS unidade, a.role, a.requer_ciencia, a.prazo_ciencia::text, a.fixado, a.autor_nome, a.publicado_em, a.expira_em::text,
      EXISTS (SELECT 1 FROM announcement_acks k WHERE k.announcement_id=a.id AND k.user_id=${s.id}) AS li,
      (SELECT count(*) FROM announcement_acks k WHERE k.announcement_id=a.id)::int AS cientes,
      (SELECT count(*) FROM users us WHERE us.ativo AND us.role <> 'LEITURA' AND (a.publico='TODOS' OR (a.publico='UNIDADE' AND (us.unit_id=a.unit_id OR us.unit_id IS NULL)) OR (a.publico='PERFIL' AND us.role=a.role)))::int AS alvo
    FROM announcements a LEFT JOIN units un ON un.id=a.unit_id
    WHERE (a.expira_em IS NULL OR a.expira_em >= ${h}) AND (a.publico='TODOS' OR (a.publico='UNIDADE' AND (${u === null} OR a.unit_id=${u ?? 0})) OR (a.publico='PERFIL' AND a.role=${s.role}) OR ${can.editar(s)})
    ORDER BY a.fixado DESC, a.publicado_em DESC LIMIT 100`;
  const units = await db.select().from(schema.units).orderBy(asc(schema.units.nome)); const pode = ["DIRECAO", "RH", "DIRETOR_UNIDADE"].includes(s.role);
  const pendentes = rows.filter(r => r.requer_ciencia && !r.li);
  return (
    <Page title="Comunicados internos" sub="Mural da equipe. Comunicados com ciência obrigatória mostram quem já leu." actions={<><Btn kind="ghost" href="/comunicacao/mensagens">Mensagens às famílias</Btn><Btn kind="ghost" href="/comunicacao/modelos">Modelos</Btn></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {pendentes.length > 0 && <Card className="mb-4 border-amber-200"><p className="text-sm">Você tem <b>{pendentes.length}</b> comunicado(s) aguardando sua ciência.</p></Card>}
      <div className={`grid grid-cols-1 gap-4 ${pode ? "lg:grid-cols-[minmax(0,1fr)_360px]" : ""} lg:items-start`}>
        <div className="space-y-3">{rows.length === 0 && <Card><p className="text-sm text-slate-500">Nenhum comunicado.</p></Card>}
          {rows.map(r => <Card key={r.id} className={r.fixado ? "border-sky-300" : ""} title={<span id={`c${r.id}`} className="flex flex-wrap items-center gap-2">{r.fixado && <Badge v="APROVADA" label="fixado" />}{r.titulo}<span className="text-xs font-normal text-slate-500">· {r.autor_nome} · {fmtDataHora(r.publicado_em)} · {r.publico === "TODOS" ? "toda a equipe" : r.publico === "UNIDADE" ? r.unidade : ROLE_LABEL[r.role as Role] ?? r.role}</span></span>}>
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
          <Field label="Perfil (se for o caso)"><Select name="role" defaultValue=""><option value="">—</option>{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Prazo de ciência"><Input name="prazoCiencia" type="date" /></Field><Field label="Expira em"><Input name="expiraEm" type="date" /></Field></div>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="requerCiencia" value="1" /> Exigir ciência (cada pessoa clica "Li e estou ciente")</label><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="fixado" value="1" /> Fixar no topo</label>
          <Btn small>Publicar</Btn><p className="text-xs text-slate-500">Todos do público recebem uma notificação no sistema (e no resumo por e-mail, quando ativo).</p></form></Card>}
      </div>
    </Page>
  );
}
