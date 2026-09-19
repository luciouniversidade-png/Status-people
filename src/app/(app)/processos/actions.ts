"use server";
import { redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession, can, assert, assertScope } from "@/lib/auth";
import { audit, str, erroMsg, getSettings } from "@/lib/utils";

async function carregar(pid: number) {
  const [p] = await db.select().from(schema.processes).where(eq(schema.processes.id, pid));
  if (!p) throw new Error("Processo não encontrado.");
  const [e] = await db.select().from(schema.employees).where(eq(schema.employees.id, p.employeeId));
  return { p, e };
}

export async function alternarItem(fd: FormData) {
  const s = await requireSession(); const pid = Number(fd.get("processId")); const itemId = Number(fd.get("itemId"));
  try {
    assert(can.solicitar(s));
    const { p, e } = await carregar(pid); if (e) assertScope(s, e.unitId);
    assert(p.status === "ABERTO", "Processo encerrado.");
    const [it] = await db.select().from(schema.processItems).where(and(eq(schema.processItems.id, itemId), eq(schema.processItems.processId, pid)));
    if (!it) throw new Error("Item não encontrado.");
    const concluido = !it.concluido;
    await db.update(schema.processItems).set({ concluido, concluidoEm: concluido ? new Date() : null, concluidoPor: concluido ? s.id : null }).where(eq(schema.processItems.id, itemId));
    await audit(s, concluido ? "concluir item" : "reabrir item", "process_items", itemId, { concluido: it.concluido }, { concluido, titulo: it.titulo, processo: pid });
  } catch (e) { redirect(`/processos/${pid}?erro=${erroMsg(e)}`); }
  redirect(`/processos/${pid}`);
}

export async function adicionarItem(fd: FormData) {
  const s = await requireSession(); const pid = Number(fd.get("processId"));
  try {
    assert(can.solicitar(s));
    const { p, e } = await carregar(pid); if (e) assertScope(s, e.unitId);
    assert(p.status === "ABERTO", "Processo encerrado.");
    const titulo = str(fd, "titulo"); if (!titulo) throw new Error("Informe o item.");
    const [{ id }] = await db.insert(schema.processItems).values({ processId: pid, titulo, obrigatorio: str(fd, "obrigatorio") === "1", ordem: 999 }).returning({ id: schema.processItems.id });
    await audit(s, "adicionar item", "process_items", id, null, { titulo, processo: pid });
  } catch (e) { redirect(`/processos/${pid}?erro=${erroMsg(e)}`); }
  redirect(`/processos/${pid}`);
}

export async function concluirProcesso(fd: FormData) {
  const s = await requireSession(); const pid = Number(fd.get("processId"));
  try {
    const cfg = await getSettings();
    assert(can.aprovar(s, cfg.alcadas.processos), "Só RH/Direção concluem admissões e desligamentos.");
    const { p, e } = await carregar(pid);
    assert(p.status === "ABERTO", "Processo já encerrado.");
    const itens = await db.select().from(schema.processItems).where(eq(schema.processItems.processId, pid));
    const pendentes = itens.filter(i => i.obrigatorio && !i.concluido);
    if (pendentes.length) throw new Error(`Ainda há ${pendentes.length} item(ns) obrigatório(s) pendente(s): ${pendentes.map(i => i.titulo).join("; ")}`);
    await db.update(schema.processes).set({ status: "CONCLUIDO", concluidoEm: new Date() }).where(eq(schema.processes.id, pid));
    if (e) {
      if (p.tipo === "ADMISSAO") await db.update(schema.employees).set({ situacao: "ATIVO", updatedAt: new Date() }).where(eq(schema.employees.id, e.id));
      if (p.tipo === "DESLIGAMENTO") await db.update(schema.employees).set({ situacao: "DESLIGADO", desligamento: e.desligamento ?? p.inicio, updatedAt: new Date() }).where(eq(schema.employees.id, e.id));
      await audit(s, "concluir processo", "employees", e.id, { situacao: e.situacao }, { situacao: p.tipo === "ADMISSAO" ? "ATIVO" : "DESLIGADO", processo: pid });
    }
    await audit(s, "concluir", "processes", pid, { status: p.status }, { status: "CONCLUIDO" });
  } catch (e) { redirect(`/processos/${pid}?erro=${erroMsg(e)}`); }
  redirect(`/processos/${pid}?ok=${encodeURIComponent("Processo concluído.")}`);
}

export async function cancelarProcesso(fd: FormData) {
  const s = await requireSession(); const pid = Number(fd.get("processId"));
  try {
    assert(can.editar(s));
    const { p, e } = await carregar(pid);
    assert(p.status === "ABERTO", "Processo já encerrado.");
    await db.update(schema.processes).set({ status: "CANCELADO", concluidoEm: new Date(), obs: str(fd, "motivo") || null }).where(eq(schema.processes.id, pid));
    if (e && p.tipo === "DESLIGAMENTO") await db.update(schema.employees).set({ desligamento: null, motivoDesligamento: null, updatedAt: new Date() }).where(eq(schema.employees.id, e.id));
    await audit(s, "cancelar", "processes", pid, { status: p.status }, { status: "CANCELADO", motivo: str(fd, "motivo") });
  } catch (e) { redirect(`/processos/${pid}?erro=${erroMsg(e)}`); }
  redirect(`/processos/${pid}?ok=${encodeURIComponent("Processo cancelado.")}`);
}
