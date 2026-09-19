"use server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireSession, can, assert, assertScope, assertEmployeeAccess } from "@/lib/auth";
import { audit, str, strOrNull, int, erroMsg, getSettings, diasEntre, periodosFerias, fmtData, LEAVE_LABEL } from "@/lib/utils";
import { enviarEmail, emailsPorPerfil, emailDoUsuario } from "@/lib/notify";

const voltar = (fd: FormData, fallback: string) => str(fd, "voltar") || fallback;

export async function solicitarAfastamento(fd: FormData) {
  const s = await requireSession(); const back = voltar(fd, "/ferias");
  try {
    assert(can.solicitar(s));
    const employeeId = int(fd, "employeeId"); const tipo = str(fd, "tipo"); const inicio = str(fd, "inicio"); const fim = str(fd, "fim");
    if (!employeeId || !tipo || !inicio || !fim) throw new Error("Preencha colaborador, tipo e período.");
    if (fim < inicio) throw new Error("A data final é anterior à inicial.");
    const [e] = await db.select().from(schema.employees).where(eq(schema.employees.id, employeeId));
    if (!e) throw new Error("Colaborador não encontrado.");
    assertEmployeeAccess(s, e);
    if (e.situacao === "DESLIGADO") throw new Error("Colaborador desligado.");
    const dias = diasEntre(inicio, fim);
    const [conflito] = await sql<{ id: number }[]>`SELECT id FROM leave_requests WHERE employee_id=${employeeId} AND status IN ('SOLICITADA','APROVADA') AND inicio <= ${fim} AND fim >= ${inicio}`;
    if (conflito) throw new Error("Já existe férias/afastamento neste período para o colaborador.");
    let periodoRef: string | null = null;
    if (tipo === "FERIAS") {
      const aprovadas = await db.select({ periodoRef: schema.leaveRequests.periodoRef, dias: schema.leaveRequests.dias }).from(schema.leaveRequests).where(eq(schema.leaveRequests.employeeId, employeeId));
      const usadas = aprovadas.filter(a => a.periodoRef).map(a => ({ periodoRef: a.periodoRef!, dias: a.dias }));
      const aberto = periodosFerias(e.admissao, usadas).find(p => (p.status === "ABERTO" || p.status === "VENCIDO") && p.saldo > 0);
      if (!aberto) throw new Error("Não há período aquisitivo com saldo de férias. Verifique a data de admissão ou registre como outro tipo de afastamento.");
      if (dias > aberto.saldo) throw new Error(`Saldo do período ${aberto.inicio.slice(0, 4)}: ${aberto.saldo} dia(s). Reduza o período.`);
      if (dias < 5) throw new Error("Períodos de férias devem ter ao menos 5 dias corridos.");
      periodoRef = aberto.inicio;
    }
    const [r] = await db.insert(schema.leaveRequests).values({ employeeId, tipo, inicio, fim, dias, periodoRef, justificativa: strOrNull(fd, "justificativa"), solicitadoPor: s.id }).returning({ id: schema.leaveRequests.id });
    await audit(s, "solicitar", "leave_requests", r.id, null, { employeeId, tipo, inicio, fim, dias, justificativa: tipo === "AFASTAMENTO_SAUDE" ? "(sensível)" : strOrNull(fd, "justificativa") });
    const cfg = await getSettings();
    await enviarEmail(await emailsPorPerfil(cfg.alcadas.ferias, e.unitId), `[STATUS People] Solicitação de ${LEAVE_LABEL[tipo].toLowerCase()} — ${e.nome}`,
      `${s.nome} solicitou ${LEAVE_LABEL[tipo].toLowerCase()} para ${e.nome} de ${fmtData(inicio)} a ${fmtData(fim)} (${dias} dia(s)).\nAprove ou rejeite em ${process.env.APP_URL ?? ""}/colaboradores/${employeeId}#ferias`);
  } catch (e) { redirect(`${back}${back.includes("?") ? "&" : "?"}erro=${erroMsg(e)}#ferias`); }
  redirect(`${back}${back.includes("?") ? "&" : "?"}ok=${encodeURIComponent("Solicitação registrada e enviada para aprovação.")}#ferias`);
}

export async function decidirAfastamento(fd: FormData) {
  const s = await requireSession(); const back = voltar(fd, "/ferias"); const id = Number(fd.get("id")); const decisao = str(fd, "decisao");
  try {
    const cfg = await getSettings();
    const [r] = await db.select().from(schema.leaveRequests).where(eq(schema.leaveRequests.id, id));
    if (!r) throw new Error("Solicitação não encontrada.");
    const [e] = await db.select().from(schema.employees).where(eq(schema.employees.id, r.employeeId));
    if (decisao === "CANCELADA") {
      assert(can.editar(s) || r.solicitadoPor === s.id, "Só quem solicitou ou o RH pode cancelar.");
      assert(r.status === "SOLICITADA" || r.status === "APROVADA", "Esta solicitação não pode mais ser cancelada.");
    } else {
      assert(can.aprovar(s, cfg.alcadas.ferias), "Seu perfil não aprova férias e afastamentos.");
      if (e) assertScope(s, e.unitId);
      assert(r.status === "SOLICITADA", "Solicitação já decidida.");
      assert(r.solicitadoPor !== s.id || can.editar(s), "Quem solicita não aprova a própria solicitação.");
    }
    await db.update(schema.leaveRequests).set({ status: decisao, aprovadoPor: s.id, decididoEm: new Date(), motivoDecisao: strOrNull(fd, "motivo") }).where(eq(schema.leaveRequests.id, id));
    await audit(s, decisao === "APROVADA" ? "aprovar" : decisao === "REJEITADA" ? "rejeitar" : "cancelar", "leave_requests", id, { status: r.status }, { status: decisao, motivo: strOrNull(fd, "motivo") });
    if (decisao !== "CANCELADA" && r.solicitadoPor !== s.id) await enviarEmail(await emailDoUsuario(r.solicitadoPor), `[STATUS People] ${LEAVE_LABEL[r.tipo]} de ${e?.nome ?? ""} — ${decisao === "APROVADA" ? "aprovada" : "rejeitada"}`,
      `A solicitação de ${LEAVE_LABEL[r.tipo].toLowerCase()} de ${fmtData(r.inicio)} a ${fmtData(r.fim)} foi ${decisao === "APROVADA" ? "aprovada" : "rejeitada"} por ${s.nome}.${strOrNull(fd, "motivo") ? ` Motivo: ${strOrNull(fd, "motivo")}` : ""}`);
  } catch (e) { redirect(`${back}${back.includes("?") ? "&" : "?"}erro=${erroMsg(e)}#ferias`); }
  redirect(`${back}${back.includes("?") ? "&" : "?"}ok=${encodeURIComponent(decisao === "APROVADA" ? "Solicitação aprovada." : decisao === "REJEITADA" ? "Solicitação rejeitada." : "Solicitação cancelada.")}#ferias`);
}
