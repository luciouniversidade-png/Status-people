"use server";
import { sincronizarPorFichas } from "@/lib/acesso";
import { redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db, schema, sql } from "@/db";
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
    // v24 · SST: o item do exame só conclui com o ASO registrado (T-101: sem ASO admissional não conclui admissão)
    if (concluido && e) {
      const cfg = await getSettings();
      if (p.tipo === "ADMISSAO" && cfg.sst.exigirAsoAdmissional && /exame admissional|\bASO\b/i.test(it.titulo)) { const { temAsoAdmissional } = await import("@/lib/sst"); assert(await temAsoAdmissional(e.id), "Registre o ASO admissional (apto) em Saúde e segurança → Exames ocupacionais antes de concluir este item."); }
      if (p.tipo === "DESLIGAMENTO" && /exame demissional/i.test(it.titulo)) { const { temAsoDemissional } = await import("@/lib/sst"); assert(await temAsoDemissional(e.id, String(p.inicio), Number(cfg.sst.dispensaDemissionalDias) || 135), "Registre o exame demissional em Saúde e segurança → Exames ocupacionais (ou um exame dentro do prazo de dispensa da NR-7)."); }
    }
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
    assert(can.aprovar(s, "processos"), "Só RH/Direção concluem admissões e desligamentos.");
    const { p, e } = await carregar(pid);
    assert(p.status === "ABERTO", "Processo já encerrado.");
    const itens = await db.select().from(schema.processItems).where(eq(schema.processItems.processId, pid));
    const pendentes = itens.filter(i => i.obrigatorio && !i.concluido);
    if (pendentes.length) throw new Error(`Ainda há ${pendentes.length} item(ns) obrigatório(s) pendente(s): ${pendentes.map(i => i.titulo).join("; ")}`);
    // v30 · itens sob responsabilidade (chaves, notebook, crachá…): o desligamento só conclui com a devolução (ou o extravio) registrada
    if (e && p.tipo === "DESLIGAMENTO") { const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM employee_items WHERE employee_id=${e.id} AND status='COM_COLABORADOR'`; if (n) throw new Error(`Há ${n} item(ns) com o colaborador (chaves, equipamentos, crachá…). Registre a devolução — ou o extravio — na ficha antes de concluir.`); }
    await db.update(schema.processes).set({ status: "CONCLUIDO", concluidoEm: new Date() }).where(eq(schema.processes.id, pid));
    if (e) {
      if (p.tipo === "ADMISSAO") { await db.update(schema.employees).set({ situacao: "ATIVO", updatedAt: new Date() }).where(eq(schema.employees.id, e.id)); try { const { criarPlanoOnboarding } = await import("@/lib/onboarding"); await criarPlanoOnboarding(e.id, s); } catch { /* onboarding é complemento: não trava a admissão */ } }
      if (p.tipo === "DESLIGAMENTO") { await db.update(schema.employees).set({ situacao: "DESLIGADO", desligamento: e.desligamento ?? p.inicio, updatedAt: new Date() }).where(eq(schema.employees.id, e.id)); const { garantirHistoricoBase } = await import("@/lib/pessoas-v30"); await garantirHistoricoBase([e.id]);
        // v30 · benefícios ativos terminam no desligamento (entram no pacote da folha como encerramento)
        const fimB = String(e.desligamento ?? p.inicio); const nb = await sql`UPDATE benefit_enrollments SET status='ENCERRADO', fim=GREATEST(inicio, ${fimB}::date), motivo_fim='Desligamento', encerrado_por=${s.id} WHERE employee_id=${e.id} AND status='ATIVO'`; if (nb.count) await audit(s, "encerrar benefícios no desligamento", "benefit_enrollments", e.id, null, { encerrados: nb.count, fim: fimB }); }
      await audit(s, "concluir processo", "employees", e.id, { situacao: e.situacao }, { situacao: p.tipo === "ADMISSAO" ? "ATIVO" : "DESLIGADO", processo: pid });
      await sincronizarPorFichas([e.id]); // v29: desligamento concluído → o login da pessoa deixa de entrar
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
