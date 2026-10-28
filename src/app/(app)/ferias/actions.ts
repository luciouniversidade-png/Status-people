"use server";
import { emailsQueAprovam, usuariosQueAprovam } from "@/lib/acesso";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireSession, can, assert, assertScope, assertEmployeeAccess, naEquipe } from "@/lib/auth";
import { audit, str, strOrNull, int, erroMsg, getSettings, diasEntre, periodosFerias, fmtData, LEAVE_LABEL, hoje, detectarSeparador, normalizarCabecalho } from "@/lib/utils";
import { textoImportacao } from "@/lib/importacao";
import { enviarEmail, emailsPorPerfil, emailDoUsuario } from "@/lib/notify";
import { notificar, usuariosPorPerfil } from "@/lib/comunicacao";

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
      const aberto = periodosFerias(e.admissao, usadas, undefined, e.feriasQuitadasAte).find(p => (p.status === "ABERTO" || p.status === "VENCIDO") && p.saldo > 0);
      if (!aberto) throw new Error("Não há período aquisitivo com saldo de férias. Verifique a data de admissão ou registre como outro tipo de afastamento.");
      if (dias > aberto.saldo) throw new Error(`Saldo do período ${aberto.inicio.slice(0, 4)}: ${aberto.saldo} dia(s). Reduza o período.`);
      if (dias < 5) throw new Error("Períodos de férias devem ter ao menos 5 dias corridos.");
      periodoRef = aberto.inicio;
    }
    const [r] = await db.insert(schema.leaveRequests).values({ employeeId, tipo, inicio, fim, dias, periodoRef, justificativa: strOrNull(fd, "justificativa"), solicitadoPor: s.id }).returning({ id: schema.leaveRequests.id });
    await audit(s, "solicitar", "leave_requests", r.id, null, { employeeId, tipo, inicio, fim, dias, justificativa: tipo === "AFASTAMENTO_SAUDE" ? "(sensível)" : strOrNull(fd, "justificativa") });
    await notificar([...new Set([...await usuariosPorPerfil(["RH", "DIRECAO"]), ...await usuariosPorPerfil(["DIRETOR_UNIDADE"], e.unitId), ...await usuariosQueAprovam("ferias", e.unitId, e.id)])], "Pedido de férias/afastamento aguardando aprovação", `${e.nome} · ${inicio} a ${fim}`, `/ferias?status=SOLICITADA`, "ACAO");
    const cfg = await getSettings();
    await enviarEmail(await emailsQueAprovam("ferias", e.unitId, e.id), `[STATUS People] Solicitação de ${LEAVE_LABEL[tipo].toLowerCase()} — ${e.nome}`,
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
      assert(can.aprovar(s, "ferias"), "Seu acesso não aprova férias e afastamentos.");
      if (e) assertScope(s, e.unitId);
      assert(naEquipe(s, e), "Pela sua atuação, você aprova só a sua equipe (pessoas que têm você como gestor direto na ficha).");
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

/**
 * Carga inicial (v24.1): férias já gozadas antes do sistema, por planilha. Cada linha vira férias APROVADAS no período aquisitivo
 * mais antigo com saldo (iniciado até o primeiro dia das férias) — a mesma regra de um pedido novo —, sem notificar ninguém.
 * Linhas repetidas (mesma pessoa, início e fim) são ignoradas; sobreposição com outro afastamento é erro da linha.
 */
export async function importarHistoricoFerias(fd: FormData) {
  const s = await requireSession(); let resumo = "";
  try {
    assert(can.editar(s), "Só RH e Direção importam o histórico de férias.");
    const texto = await textoImportacao(fd); if (!texto) throw new Error("Envie a planilha ou cole o conteúdo.");
    const linhas = texto.split(/\r?\n/).map(l => l.replace(/\s+$/, "")).filter(l => l.trim());
    const sep = detectarSeparador(linhas[0]); const head = linhas[0].split(sep).map(normalizarCabecalho); const idx = (k: string) => head.indexOf(k);
    if (idx("nome") < 0 || idx("inicio") < 0 || idx("fim") < 0) throw new Error("Cabeçalho precisa ter: nome; inicio; fim (opcionais: dias; unidade).");
    const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
    const data = (v: string) => (v.includes("/") ? v.split("/").reverse().map(x => x.padStart(2, "0")).join("-") : v);
    const pessoas = await sql<{ id: number; nome: string; admissao: string; quitadas: string | null; unidade: string; codigo: string }[]>`SELECT e.id, e.nome, e.admissao::text, e.ferias_quitadas_ate::text AS quitadas, u.nome AS unidade, u.codigo FROM employees e JOIN units u ON u.id=e.unit_id WHERE e.situacao <> 'DESLIGADO'`;
    const h = hoje(); let ok = 0, pulados = 0; const erros: string[] = [];
    for (const [i, l] of linhas.slice(1).entries()) {
      const c = l.split(sep).map(x => x.trim().replace(/^"(.*)"$/, "$1").trim()); const g = (k: string) => (idx(k) >= 0 ? c[idx(k)] ?? "" : "");
      try {
        let cands = pessoas.filter(a => norm(a.nome) === norm(g("nome")));
        if (cands.length === 0) cands = pessoas.filter(a => norm(a.nome).startsWith(norm(g("nome"))));
        if (g("unidade")) cands = cands.filter(a => norm(a.unidade) === norm(g("unidade")) || norm(a.codigo) === norm(g("unidade")));
        if (!g("nome") || cands.length === 0) throw new Error(`"${g("nome")}" não encontrado`);
        if (cands.length > 1) throw new Error(`"${g("nome")}" é ambíguo (${cands.map(x => `${x.nome} · ${x.unidade}`).join(" / ")}) — informe a coluna unidade`);
        const e = cands[0]; const inicio = data(g("inicio")); const fim = data(g("fim"));
        if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim) || fim < inicio) throw new Error(`datas "${g("inicio")}"–"${g("fim")}" inválidas (use DD/MM/AAAA; o fim não pode ser antes do início)`);
        if (inicio > h) throw new Error("férias que ainda vão começar não são histórico — lance como pedido em Férias e afastamentos");
        if (inicio < e.admissao) throw new Error(`início antes da admissão (${fmtData(e.admissao)})`);
        const dias = g("dias") ? Number(g("dias").replace(",", ".")) : diasEntre(inicio, fim);
        if (!Number.isInteger(dias) || dias < 1 || dias > 30) throw new Error(`dias "${g("dias")}" inválido (1 a 30 — some aqui os dias vendidos em abono, se houver)`);
        const [ja] = await sql<{ id: number }[]>`SELECT id FROM leave_requests WHERE employee_id=${e.id} AND tipo='FERIAS' AND inicio=${inicio} AND fim=${fim} AND status IN ('APROVADA','SOLICITADA')`;
        if (ja) { pulados++; continue; }
        const [conf] = await sql<{ id: number }[]>`SELECT id FROM leave_requests WHERE employee_id=${e.id} AND status IN ('SOLICITADA','APROVADA') AND inicio <= ${fim} AND fim >= ${inicio}`;
        if (conf) throw new Error(`já existe férias/afastamento sobreposto a ${fmtData(inicio)}–${fmtData(fim)}`);
        const usadas = await sql<{ periodo_ref: string; dias: number }[]>`SELECT periodo_ref::text, dias FROM leave_requests WHERE employee_id=${e.id} AND tipo='FERIAS' AND status='APROVADA' AND periodo_ref IS NOT NULL`;
        const per = periodosFerias(e.admissao, usadas.map(u => ({ periodoRef: u.periodo_ref, dias: u.dias })), h, e.quitadas).find(p => p.inicio <= inicio && p.saldo >= dias);
        if (!per) throw new Error(`nenhum período aquisitivo iniciado até ${fmtData(inicio)} tem saldo de ${dias} dia(s) — confira a admissão e o campo “Férias quitadas até”`);
        await db.insert(schema.leaveRequests).values({ employeeId: e.id, tipo: "FERIAS", inicio, fim, dias, periodoRef: per.inicio, justificativa: "Histórico importado da planilha", status: "APROVADA", solicitadoPor: s.id, aprovadoPor: s.id, decididoEm: new Date(), motivoDecisao: "Carga inicial — férias gozadas antes do sistema" });
        ok++;
      } catch (err) { erros.push(`Linha ${i + 2}: ${err instanceof Error ? err.message : err}`); }
    }
    await audit(s, "importar histórico de férias", "leave_requests", null, null, { importadas: ok, repetidas: pulados, erros: erros.length });
    resumo = `${ok} férias do histórico importada(s), ${pulados} repetida(s) ignorada(s).` + (erros.length ? ` ${erros.length} linha(s) com erro: ${erros.slice(0, 5).join(" · ")}${erros.length > 5 ? " …" : ""}` : "");
  } catch (e) { redirect(`/ferias/importar?erro=${erroMsg(e)}`); }
  redirect(`/ferias?ok=${encodeURIComponent(resumo)}`);
}
