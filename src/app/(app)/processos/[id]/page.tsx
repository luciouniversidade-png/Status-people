import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaff, can, scopeUnit } from "@/lib/auth";
import { Page, Card, Badge, Btn, Flash, Field, Input } from "@/components/ui";
import { fmtData, fmtDataHora, PROC_LABEL, PROC_STATUS, getSettings, hoje } from "@/lib/utils";
import { alternarItem, adicionarItem, concluirProcesso, cancelarProcesso } from "../actions";

export const dynamic = "force-dynamic";

export default async function Processo({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const { id } = await params; const sp = await searchParams; const pid = Number(id);
  const [p] = await db.select().from(schema.processes).where(eq(schema.processes.id, pid)); if (!p) notFound();
  const [e] = await db.select().from(schema.employees).where(eq(schema.employees.id, p.employeeId));
  const scope = scopeUnit(s); if (e && scope !== null && scope !== e.unitId) notFound();
  const itens = await db.select().from(schema.processItems).where(eq(schema.processItems.processId, pid)).orderBy(asc(schema.processItems.ordem), asc(schema.processItems.id));
  const users = await db.select({ id: schema.users.id, nome: schema.users.nome }).from(schema.users);
  const nomeUser = (uid: number | null) => users.find(u => u.id === uid)?.nome ?? "";
  const cfg = await getSettings(); const podeConcluir = can.aprovar(s, cfg.alcadas.processos);
  const feitos = itens.filter(i => i.concluido).length; const aberto = p.status === "ABERTO"; const h = hoje();

  return (
    <Page title={`${PROC_LABEL[p.tipo]} — ${e?.nome ?? "?"}`}
      sub={<span className="flex flex-wrap items-center gap-2"><Badge v={p.status} label={PROC_STATUS[p.status]} /> Início {fmtData(p.inicio)} · Prazo <span className={aberto && p.prazo && p.prazo < h ? "font-medium text-erro" : ""}>{fmtData(p.prazo)}</span> · {feitos}/{itens.length} itens{e && <> · <Link className="text-acao" href={`/colaboradores/${e.id}`}>ver ficha</Link></>}</span>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <Card title="Checklist">
          <ul className="divide-y divide-line">
            {itens.map(i => (
              <li key={i.id} className="flex items-start gap-3 py-2">
                <form action={alternarItem}><input type="hidden" name="processId" value={pid} /><input type="hidden" name="itemId" value={i.id} />
                  <button disabled={!aberto || !can.solicitar(s)} aria-label={i.concluido ? "Reabrir item" : "Concluir item"} className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded border text-xs ${i.concluido ? "border-ok bg-ok text-white" : "border-slate-400 bg-white"} disabled:opacity-50`}>{i.concluido ? "✓" : ""}</button>
                </form>
                <div className="flex-1 text-sm">
                  <div className={i.concluido ? "text-slate-500 line-through" : "text-ink"}>{i.titulo}{!i.obrigatorio && <span className="ml-1 text-xs text-slate-400">opcional</span>}</div>
                  {i.concluido && <div className="text-xs text-slate-500">{nomeUser(i.concluidoPor)} · {fmtDataHora(i.concluidoEm)}</div>}
                </div>
              </li>
            ))}
          </ul>
          {aberto && can.solicitar(s) && (
            <form action={adicionarItem} className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
              <input type="hidden" name="processId" value={pid} />
              <Field label="Adicionar item" className="flex-1 min-w-[220px]"><Input name="titulo" placeholder="Ex.: entregar chave do armário" required /></Field>
              <label className="mb-2 flex items-center gap-1 text-xs"><input type="checkbox" name="obrigatorio" value="1" defaultChecked /> obrigatório</label>
              <Btn kind="ghost">Adicionar</Btn>
            </form>
          )}
        </Card>
        <div className="space-y-4">
          {aberto && podeConcluir && (
            <Card title="Encerrar">
              <form action={concluirProcesso} className="space-y-2"><input type="hidden" name="processId" value={pid} />
                <p className="text-xs text-slate-600">{p.tipo === "ADMISSAO" ? "Ao concluir, o colaborador passa a Ativo." : "Ao concluir, o vínculo é encerrado e o colaborador passa a Desligado."} Todos os itens obrigatórios precisam estar marcados.</p>
                <Btn>Concluir {PROC_LABEL[p.tipo].toLowerCase()}</Btn>
              </form>
              {can.editar(s) && <form action={cancelarProcesso} className="mt-4 space-y-2 border-t border-line pt-3"><input type="hidden" name="processId" value={pid} />
                <Field label="Cancelar processo (motivo)"><Input name="motivo" placeholder="Ex.: candidato desistiu" /></Field><Btn kind="ghost" danger>Cancelar processo</Btn></form>}
            </Card>
          )}
          <Card title="Registro">
            <dl className="space-y-1 text-sm">
              <div><dt className="text-xs text-slate-500">Responsável</dt><dd>{nomeUser(p.responsavelUserId) || "—"}</dd></div>
              <div><dt className="text-xs text-slate-500">Encerrado em</dt><dd>{fmtDataHora(p.concluidoEm)}</dd></div>
              {p.obs && <div><dt className="text-xs text-slate-500">Observação</dt><dd>{p.obs}</dd></div>}
            </dl>
          </Card>
        </div>
      </div>
    </Page>
  );
}
