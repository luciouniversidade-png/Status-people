import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession, scopeUnit, can } from "@/lib/auth";
import { Page, Card, Badge, Btn, Flash, Field, Input, Select, Textarea } from "@/components/ui";
import { fmtDataHora } from "@/lib/utils";
import { OS_TIPO, OS_STATUS, OS_PRIO, ABERTAS, brl } from "@/lib/operacoes";
import { atualizarChamado } from "../../actions";
import { usuariosOps } from "../../_shared";

export const dynamic = "force-dynamic";

export default async function Chamado({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const { id } = await params; const sp = await searchParams; const wid = Number(id);
  const [w] = await db.select().from(schema.workOrders).where(eq(schema.workOrders.id, wid)); if (!w) notFound();
  const gestor = can.operacoes(s); const dono = w.solicitanteUserId === s.id; if (!gestor && !dono) notFound(); const scope = scopeUnit(s); if (gestor && scope !== null && scope !== w.unitId) notFound();
  const [[unit], eventos, users, suppliers, [ativo], [solic]] = await Promise.all([db.select().from(schema.units).where(eq(schema.units.id, w.unitId)), db.select().from(schema.workOrderEvents).where(eq(schema.workOrderEvents.workOrderId, wid)).orderBy(asc(schema.workOrderEvents.at)), usuariosOps(), db.select().from(schema.suppliers).orderBy(asc(schema.suppliers.nome)), w.assetId ? db.select().from(schema.assets).where(eq(schema.assets.id, w.assetId)) : Promise.resolve([undefined]), w.solicitanteUserId ? db.select({ nome: schema.users.nome }).from(schema.users).where(eq(schema.users.id, w.solicitanteUserId)) : Promise.resolve([undefined])]);
  const aberto = ABERTAS.includes(w.status); const atrasado = aberto && w.slaAte && w.slaAte.getTime() < Date.now(); const responsavel = users.find(u => u.id === w.responsavelUserId)?.nome; const fornecedor = suppliers.find(x => x.id === w.supplierId)?.nome;
  return (
    <Page title={`#${w.id} · ${w.titulo}`} sub={<span className="flex flex-wrap items-center gap-2"><Badge v={w.status === "CONCLUIDO" ? "APROVADA" : w.status === "CANCELADO" ? "CANCELADA" : "EM_ADMISSAO"} label={OS_STATUS[w.status]} /><Badge v={w.prioridade === "URGENTE" ? "REJEITADA" : w.prioridade === "ALTA" ? "PENDENTE" : "EM_AQUISICAO"} label={OS_PRIO[w.prioridade]} />{OS_TIPO[w.tipo]} · {unit?.nome}{w.ambiente ? ` · ${w.ambiente}` : ""}{ativo ? ` · ${ativo.nome}` : ""} · <Link className="text-acao" href="/operacoes/chamados">chamados</Link></span>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px] lg:items-start">
        <div className="space-y-4">
          <Card title="Detalhes"><dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4"><div><dt className="text-xs text-slate-500">Solicitante</dt><dd>{solic?.nome ?? "—"}</dd></div><div><dt className="text-xs text-slate-500">Responsável</dt><dd>{responsavel ?? "—"}{fornecedor ? ` · ${fornecedor}` : ""}</dd></div><div><dt className="text-xs text-slate-500">Aberto em</dt><dd>{fmtDataHora(w.createdAt)}</dd></div><div><dt className="text-xs text-slate-500">Prazo (SLA)</dt><dd className={atrasado ? "font-medium text-erro" : ""}>{aberto ? fmtDataHora(w.slaAte) : w.concluidoEm ? `concluído ${fmtDataHora(w.concluidoEm)}` : "—"}</dd></div><div><dt className="text-xs text-slate-500">Custo previsto</dt><dd>{brl(w.custoPrevisto)}</dd></div><div><dt className="text-xs text-slate-500">Custo real</dt><dd>{brl(w.custoReal)}</dd></div>{w.avaliacao && <div><dt className="text-xs text-slate-500">Avaliação</dt><dd>{w.avaliacao} / 5</dd></div>}{w.inspectionId && <div><dt className="text-xs text-slate-500">Origem</dt><dd><Link className="text-acao" href="/operacoes/vistorias">vistoria #{w.inspectionId}</Link></dd></div>}</dl>{w.descricao && <p className="mt-3 whitespace-pre-wrap rounded bg-mist px-3 py-2 text-sm">{w.descricao}</p>}{w.evidencia && <p className="mt-2 text-sm"><span className="text-xs text-slate-500">Evidência · </span>{w.evidencia}</p>}</Card>
          <Card title="Linha do tempo"><ul className="space-y-2 text-sm">{eventos.map(e => <li key={e.id} className="flex gap-3"><span className="w-32 shrink-0 text-xs text-slate-500">{fmtDataHora(e.at)}</span><span><span className="font-medium">{e.userNome}</span> <span className="text-xs text-slate-500">{e.tipo.toLowerCase()}</span><div>{e.texto}</div></span></li>)}</ul></Card>
        </div>
        <div className="space-y-4">
          {gestor && aberto && <Card title="Atualizar"><form action={atualizarChamado} className="space-y-2"><input type="hidden" name="id" value={wid} />
            <Field label="Situação"><Select name="status" defaultValue={w.status}>{Object.entries(OS_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Responsável"><Select name="responsavelUserId" defaultValue={w.responsavelUserId ?? ""}><option value="">—</option>{users.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>
            <Field label="Fornecedor"><Select name="supplierId" defaultValue={w.supplierId ?? ""}><option value="">—</option>{suppliers.filter(x => x.ativo).map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field>
            <Field label="Prioridade"><Select name="prioridade" defaultValue={w.prioridade}>{Object.entries(OS_PRIO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="Custo previsto"><Input name="custoPrevisto" type="number" step="0.01" defaultValue={w.custoPrevisto ?? ""} /></Field><Field label="Custo real"><Input name="custoReal" type="number" step="0.01" defaultValue={w.custoReal ?? ""} /></Field></div>
            <Field label="Evidência (foto/link/nota fiscal)"><Input name="evidencia" defaultValue={w.evidencia ?? ""} /></Field><Field label="Registro"><Textarea name="nota" className="min-h-[50px]" /></Field><Btn small>Salvar</Btn></form></Card>}
          {dono && !gestor && aberto && <Card title="Acompanhar"><form action={atualizarChamado} className="space-y-2"><input type="hidden" name="id" value={wid} /><Field label="Comentário"><Textarea name="nota" className="min-h-[50px]" /></Field><div className="flex gap-1"><Btn small>Comentar</Btn><Btn small kind="ghost" danger name="status" value="CANCELADO">Cancelar chamado</Btn></div></form></Card>}
          {w.status === "CONCLUIDO" && (dono || gestor) && !w.avaliacao && <Card title="Como foi o atendimento?"><form action={atualizarChamado} className="flex items-end gap-2"><input type="hidden" name="id" value={wid} /><Field label="Nota (1–5)"><Select name="avaliacao" defaultValue="5">{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}</Select></Field><Btn small>Avaliar</Btn></form></Card>}
        </div>
      </div>
    </Page>
  );
}
