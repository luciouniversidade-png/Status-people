import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, asc } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireMatriculas, scopeUnit } from "@/lib/auth";
import { Page, Card, Badge, Btn, Flash, Field, Input, Select, Textarea } from "@/components/ui";
import { fmtDataHora, getSettings, MOTIVOS_PERDA } from "@/lib/utils";
import { CASE_TIPO_LABEL, CASE_STATUS, CASE_PRIO, CANAL_LABEL, ABERTOS, escalarVencidos } from "@/lib/atendimento";
import { usuariosAtivos } from "../../_shared";
import { comentar, mudarStatus, atribuir, marcarItem } from "../../actions";

export const dynamic = "force-dynamic";
type Item = { titulo: string; feito: boolean };

export default async function Caso({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireMatriculas(); const { id } = await params; const sp = await searchParams; const cid = Number(id); const cfg = await getSettings(); await escalarVencidos();
  const [c] = await db.select().from(schema.cases).where(eq(schema.cases.id, cid)); if (!c) notFound();
  const scope = scopeUnit(s); if (scope !== null && scope !== c.unitId) notFound();
  const [[unit], [st], eventos, users] = await Promise.all([
    db.select().from(schema.units).where(eq(schema.units.id, c.unitId)),
    c.studentId ? db.select().from(schema.students).where(eq(schema.students.id, c.studentId)) : Promise.resolve([undefined]),
    db.select().from(schema.caseEvents).where(eq(schema.caseEvents.caseId, cid)).orderBy(asc(schema.caseEvents.at)),
    usuariosAtivos(),
  ]);
  const outros = c.studentId ? await sql<{ id: number; assunto: string; tipo: string; status: string; created_at: Date }[]>`SELECT id, assunto, tipo, status, created_at FROM cases WHERE student_id=${c.studentId} AND id<>${cid} ORDER BY created_at DESC LIMIT 8` : [];
  const aberto = ABERTOS.includes(c.status); const atrasado = aberto && c.slaAte && c.slaAte.getTime() < Date.now();
  const lista = (c.checklist as Item[] | null) ?? []; const responsavel = users.find(u => u.id === c.responsavelUserId)?.nome;
  const podeAtender = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR", "COMERCIAL"].includes(s.role);
  return (
    <Page title={`#${c.id} · ${c.assunto}`}
      sub={<span className="flex flex-wrap items-center gap-2"><Badge v={c.status === "FECHADO" || c.status === "RESOLVIDO" ? "APROVADA" : c.status === "AGUARDANDO_FAMILIA" ? "PENDENTE" : "EM_ADMISSAO"} label={CASE_STATUS[c.status]} /><Badge v={c.prioridade === "URGENTE" ? "REJEITADA" : c.prioridade === "ALTA" ? "PENDENTE" : "EM_AQUISICAO"} label={CASE_PRIO[c.prioridade]} />{CASE_TIPO_LABEL[c.tipo]}{c.categoria ? ` · ${c.categoria}` : ""}{c.gravidade ? ` · gravidade ${c.gravidade}` : ""} · {unit?.nome} · {CANAL_LABEL[c.canal] ?? c.canal} · <Link className="text-acao" href="/atendimento/casos">casos</Link></span>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px] lg:items-start">
        <div className="space-y-4">
          <Card title="Relato e situação">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-slate-500">Família</dt><dd>{st ? <Link className="text-acao" href={`/matriculas/alunos/${st.id}#atendimento`}>{st.nome}</Link> : c.contatoNome ?? "contato avulso"}{st?.responsavel && <div className="text-xs text-slate-500">{st.responsavel} · {st.telefone ?? ""}</div>}{!st && c.contatoTelefone && <div className="text-xs text-slate-500">{c.contatoTelefone}</div>}</dd></div>
              <div><dt className="text-xs text-slate-500">Responsável</dt><dd>{responsavel ?? "—"}</dd></div>
              <div><dt className="text-xs text-slate-500">Aberto em</dt><dd>{fmtDataHora(c.createdAt)}</dd></div>
              <div><dt className="text-xs text-slate-500">Prazo (SLA)</dt><dd className={atrasado ? "font-medium text-erro" : ""}>{aberto ? fmtDataHora(c.slaAte) : c.resolvidoEm ? `resolvido ${fmtDataHora(c.resolvidoEm)}` : "—"}{c.escaladoEm && aberto && <div className="text-xs text-erro">escalado em {fmtDataHora(c.escaladoEm)}</div>}</dd></div>
            </dl>
            {c.descricao && <p className="mt-3 whitespace-pre-wrap rounded bg-mist px-3 py-2 text-sm">{c.descricao}</p>}
            {(c.causaRaiz || c.acaoCorretiva || c.resultado) && <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">{c.causaRaiz && <div><dt className="text-xs text-slate-500">Causa raiz</dt><dd>{c.causaRaiz}</dd></div>}{c.acaoCorretiva && <div><dt className="text-xs text-slate-500">Ação corretiva</dt><dd>{c.acaoCorretiva}</dd></div>}{c.resultado && c.resultado !== "EM_ANDAMENTO" && <div><dt className="text-xs text-slate-500">Desfecho</dt><dd>{c.resultado === "RETIDO" ? "Família retida" : `Família perdida · ${c.motivoSaida ?? ""}`}</dd></div>}{c.satisfacao && <div><dt className="text-xs text-slate-500">Satisfação</dt><dd>{c.satisfacao} / 5</dd></div>}</dl>}
          </Card>
          {lista.length > 0 && <Card title={c.tipo === "SAIDA" ? "Protocolo de retenção" : "Service Recovery"}>
            <ul className="divide-y divide-line">{lista.map((it, i) => <li key={i} className="flex items-start gap-3 py-2"><form action={marcarItem}><input type="hidden" name="id" value={cid} /><input type="hidden" name="idx" value={i} /><button disabled={!aberto || !podeAtender} aria-label="marcar" className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded border text-xs ${it.feito ? "border-ok bg-ok text-white" : "border-slate-400 bg-white"} disabled:opacity-50`}>{it.feito ? "✓" : ""}</button></form><span className={`text-sm ${it.feito ? "text-slate-500 line-through" : ""}`}>{i + 1}. {it.titulo}</span></li>)}</ul>
          </Card>}
          <Card title="Linha do tempo">
            <ul className="space-y-2 text-sm">{eventos.map(e => <li key={e.id} className="flex gap-3"><span className="w-32 shrink-0 text-xs text-slate-500">{fmtDataHora(e.at)}</span><span><span className="font-medium">{e.userNome}</span> <span className="text-xs text-slate-500">{e.tipo === "CONTATO" ? "contato com a família" : e.tipo.toLowerCase()}</span><div className="whitespace-pre-wrap">{e.texto}</div></span></li>)}</ul>
            {podeAtender && aberto && <form action={comentar} className="mt-3 space-y-2 border-t border-line pt-3"><input type="hidden" name="id" value={cid} /><Field label="Novo registro"><Textarea name="texto" className="min-h-[60px]" required /></Field><div className="flex gap-2"><Btn small name="tipoEvento" value="COMENTARIO">Registrar</Btn><Btn small kind="ghost" name="tipoEvento" value="CONTATO">Registrar contato com a família</Btn></div></form>}
          </Card>
          {outros.length > 0 && <Card title="Outros casos desta família"><ul className="text-sm">{outros.map(o => <li key={o.id}><Link className="text-acao" href={`/atendimento/casos/${o.id}`}>#{o.id} {o.assunto}</Link> <span className="text-xs text-slate-500">· {CASE_TIPO_LABEL[o.tipo]} · {CASE_STATUS[o.status]} · {fmtDataHora(o.created_at)}</span></li>)}</ul></Card>}
        </div>
        {podeAtender && <div className="space-y-4">
          {aberto && <Card title="Mudar situação">
            <form action={mudarStatus} className="space-y-2"><input type="hidden" name="id" value={cid} />
              <Field label="Nova situação"><Select name="status" defaultValue={c.status === "ABERTO" ? "EM_ATENDIMENTO" : "RESOLVIDO"}>{["EM_ATENDIMENTO", "AGUARDANDO_FAMILIA", "RESOLVIDO", "FECHADO"].map(k => <option key={k} value={k}>{CASE_STATUS[k]}</option>)}</Select></Field>
              {c.tipo === "RECLAMACAO" && <><Field label="Causa raiz (obrigatória para resolver)"><Input name="causaRaiz" defaultValue={c.causaRaiz ?? ""} /></Field><Field label="Ação corretiva"><Input name="acaoCorretiva" defaultValue={c.acaoCorretiva ?? ""} /></Field></>}
              {c.tipo === "SAIDA" && <><Field label="Desfecho (obrigatório para resolver)"><Select name="resultado" defaultValue={c.resultado ?? "EM_ANDAMENTO"}><option value="EM_ANDAMENTO">Em andamento</option><option value="RETIDO">Família retida</option><option value="PERDIDO">Família perdida</option></Select></Field><Field label="Motivo da saída (se perdida)"><Select name="motivoSaida" defaultValue={c.motivoSaida ?? ""}><option value="">—</option>{MOTIVOS_PERDA.map(m => <option key={m}>{m}</option>)}</Select></Field></>}
              <Field label="Satisfação da família (1–5, opcional ao fechar)"><Select name="satisfacao" defaultValue=""><option value="">—</option>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}</Select></Field>
              <Field label="Nota"><Input name="nota" /></Field>
              <Btn small>Aplicar</Btn>
            </form>
          </Card>}
          {!aberto && <Card title="Reabrir"><form action={mudarStatus}><input type="hidden" name="id" value={cid} /><input type="hidden" name="status" value="REABERTO" /><Field label="Motivo"><Input name="nota" required /></Field><div className="mt-2"><Btn small kind="ghost">Reabrir caso</Btn></div></form></Card>}
          {aberto && <Card title="Responsável e prioridade">
            <form action={atribuir} className="space-y-2"><input type="hidden" name="id" value={cid} />
              <Field label="Responsável"><Select name="responsavelUserId" defaultValue={c.responsavelUserId ?? ""}>{users.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>
              <Field label="Prioridade"><Select name="prioridade" defaultValue={c.prioridade}>{Object.entries(CASE_PRIO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              {c.tipo === "RECLAMACAO" && <><Field label="Categoria"><Select name="categoria" defaultValue={c.categoria ?? ""}><option value="">—</option>{cfg.atendimento.categorias.map(x => <option key={x}>{x}</option>)}</Select></Field><Field label="Gravidade"><Select name="gravidade" defaultValue={c.gravidade ?? ""}><option value="">—</option><option value="1">1 · leve</option><option value="2">2 · moderada</option><option value="3">3 · grave</option></Select></Field></>}
              <Btn small kind="ghost">Salvar</Btn>
            </form>
          </Card>}
        </div>}
      </div>
    </Page>
  );
}
