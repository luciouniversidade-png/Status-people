"use server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireSession, can, assert, assertScope, scopeUnit } from "@/lib/auth";
import { audit, str, strOrNull, int, num, hoje, addDays, getSettings } from "@/lib/utils";
import { abrirProcesso } from "@/lib/processos";
import { nivelDesempenho, mediaNotas } from "@/lib/talento";

const go = (b: string, k: "ok" | "erro", msg: string, hash = "") => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}${hash}`;
const GESTAO = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"];
const notas = (fd: FormData, prefix: string, comps: string[]) => { const o: Record<string, number> = {}; comps.forEach((c, i) => { const v = int(fd, `${prefix}${i}`); if (v) o[c] = v; }); return o; };

// ======================= CARGOS E SALÁRIOS =======================
export async function salvarFaixa(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id"); const b = "/cargos-salarios/faixas";
  try { const cfg = await getSettings(); assert(can.aprovar(s, cfg.alcadas.remuneracao), "Alterar faixas exige: " + cfg.alcadas.remuneracao.join(", "));
    const minimo = num(fd, "minimo"), maximo = num(fd, "maximo"); let medio = num(fd, "medio"); const codigo = str(fd, "codigo");
    if (!codigo || minimo === null || maximo === null) throw new Error("Informe código, mínimo e máximo."); if (maximo < minimo) throw new Error("Máximo menor que mínimo."); if (medio === null) medio = Math.round((minimo + maximo) / 2 * 100) / 100;
    const d = { codigo, nome: strOrNull(fd, "nome"), minimo: String(minimo), medio: String(medio), maximo: String(maximo), pontosMin: int(fd, "pontosMin"), pontosMax: int(fd, "pontosMax"), ordem: int(fd, "ordem") ?? 100, vigenciaInicio: strOrNull(fd, "vigenciaInicio"), obs: strOrNull(fd, "obs") };
    if (id) { await db.update(schema.salaryGrades).set(d).where(eq(schema.salaryGrades.id, id)); await audit(s, "editar faixa", "salary_grades", id, null, d); } else { const [r] = await db.insert(schema.salaryGrades).values(d).returning({ id: schema.salaryGrades.id }); await audit(s, "criar faixa", "salary_grades", r.id, null, d); }
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Faixa salva."));
}
export async function excluirFaixa(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const b = "/cargos-salarios/faixas";
  try { const cfg = await getSettings(); assert(can.aprovar(s, cfg.alcadas.remuneracao)); const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM positions WHERE grade_id=${id}`; if (n) throw new Error("Faixa em uso por cargos."); await db.delete(schema.salaryGrades).where(eq(schema.salaryGrades.id, id)); await audit(s, "excluir faixa", "salary_grades", id, null, null); }
  catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Faixa excluída."));
}
export async function reajustarFaixas(fd: FormData) {
  const s = await requireSession(); const b = "/cargos-salarios/faixas"; let msg = "";
  try { const cfg = await getSettings(); assert(can.aprovar(s, cfg.alcadas.remuneracao)); const pct = num(fd, "pct"); if (pct === null || pct <= -50 || pct > 100) throw new Error("Percentual inválido."); if (str(fd, "confirmo") !== "1") throw new Error("Marque a confirmação.");
    const f = 1 + pct / 100; await sql`UPDATE salary_grades SET minimo=round(minimo*${f},2), medio=round(medio*${f},2), maximo=round(maximo*${f},2), vigencia_inicio=${str(fd, "vigenciaInicio") || hoje()}`;
    let sal = 0;
    if (str(fd, "aplicarSalarios") === "1") { const emps = await sql<{ id: number; salario: number }[]>`SELECT id, salario::float FROM employees WHERE situacao <> 'DESLIGADO' AND salario IS NOT NULL`; for (const e of emps) { const novo = Math.round(e.salario * f * 100) / 100; await sql`UPDATE employees SET salario=${novo}, updated_at=now() WHERE id=${e.id}`; await sql`INSERT INTO salary_history (employee_id, data, salario_anterior, salario, motivo, obs, user_id) VALUES (${e.id}, ${str(fd, "vigenciaInicio") || hoje()}, ${e.salario}, ${novo}, 'DISSIDIO', ${`Reajuste coletivo de ${pct}%`}, ${s.id})`; sal++; } }
    await audit(s, "reajuste coletivo", "salary_grades", null, null, { pct, salarios: sal });
    msg = `Faixas reajustadas em ${pct}%${sal ? ` e ${sal} salário(s) atualizados com histórico` : ""}.`;
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}
export async function avaliarCargo(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const b = `/cargos-salarios/${id}`;
  try { const cfg = await getSettings(); assert(can.aprovar(s, cfg.alcadas.remuneracao));
    const avaliacao: Record<string, number> = {}; let pontos = 0; cfg.remuneracao.fatores.forEach((f, i) => { const v = int(fd, `f_${i}`) ?? 0; avaliacao[f] = v; pontos += v; });
    const d = { avaliacao, pontos: pontos || null, gradeId: int(fd, "gradeId"), descricao: strOrNull(fd, "descricao"), requisitos: strOrNull(fd, "requisitos") };
    await db.update(schema.positions).set(d).where(eq(schema.positions.id, id)); await audit(s, "avaliar cargo", "positions", id, null, d);
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Cargo atualizado."));
}
export async function reajustarSalario(fd: FormData) {
  const s = await requireSession(); const employeeId = Number(fd.get("employeeId")); const b = str(fd, "voltar") || `/colaboradores/${employeeId}`;
  try { const cfg = await getSettings(); assert(can.aprovar(s, cfg.alcadas.remuneracao), "Alterar salário exige: " + cfg.alcadas.remuneracao.join(", ")); const novo = num(fd, "salario"); const motivo = str(fd, "motivo"); if (novo === null || novo < 0 || !motivo) throw new Error("Informe o novo salário e o motivo.");
    const [e] = await sql<{ salario: number | null; nivel: string | null }[]>`SELECT salario::float, nivel FROM employees WHERE id=${employeeId}`; if (!e) throw new Error("Colaborador não encontrado.");
    await sql`UPDATE employees SET salario=${novo}, nivel=${strOrNull(fd, "nivel") ?? e.nivel}, updated_at=now() WHERE id=${employeeId}`;
    await sql`INSERT INTO salary_history (employee_id, data, salario_anterior, salario, motivo, obs, user_id) VALUES (${employeeId}, ${str(fd, "data") || hoje()}, ${e.salario}, ${novo}, ${motivo}, ${strOrNull(fd, "obs")}, ${s.id})`;
    await audit(s, "reajustar salário", "employees", employeeId, { salario: "***" }, { motivo, data: str(fd, "data") || hoje() });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Salário atualizado com histórico."));
}

// ======================= DESEMPENHO =======================
export async function salvarCiclo(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id"); let cid = id ?? 0;
  try { assert(can.editar(s), "Só RH e Direção criam ciclos."); const cfg = await getSettings(); const nome = str(fd, "nome"); const inicio = str(fd, "inicio"); const fim = str(fd, "fim"); if (!nome || !inicio || !fim) throw new Error("Informe nome e período.");
    const comps = str(fd, "competencias") ? str(fd, "competencias").split("\n").map(x => x.trim()).filter(Boolean) : cfg.desempenho.competencias;
    const d = { nome, inicio, fim, competencias: comps, unitId: int(fd, "unitId"), descricao: strOrNull(fd, "descricao") };
    if (id) { await db.update(schema.perfCycles).set(d).where(eq(schema.perfCycles.id, id)); } else { const [r] = await db.insert(schema.perfCycles).values(d).returning({ id: schema.perfCycles.id }); cid = r.id; }
    await audit(s, id ? "editar ciclo" : "criar ciclo", "perf_cycles", cid, null, d);
  } catch (e) { redirect(go("/desempenho", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`/desempenho/ciclos/${cid}`, "ok", "Ciclo salvo."));
}
export async function gerarAvaliacoes(fd: FormData) {
  const s = await requireSession(); const cid = Number(fd.get("cycleId")); const b = `/desempenho/ciclos/${cid}`; let n = 0;
  try { assert(can.editar(s)); const [c] = await db.select().from(schema.perfCycles).where(eq(schema.perfCycles.id, cid)); if (!c) throw new Error("Ciclo não encontrado.");
    const emps = await sql<{ id: number; gestor_user: number | null }[]>`SELECT e.id, (SELECT u.id FROM users u WHERE u.employee_id=e.gestor_id AND u.ativo LIMIT 1) AS gestor_user FROM employees e WHERE e.situacao='ATIVO' ${c.unitId ? sql`AND e.unit_id=${c.unitId}` : sql``} AND NOT EXISTS (SELECT 1 FROM perf_reviews r WHERE r.cycle_id=${cid} AND r.employee_id=e.id)`;
    for (const e of emps) { await db.insert(schema.perfReviews).values({ cycleId: cid, employeeId: e.id, avaliadorUserId: e.gestor_user ?? s.id }); n++; }
    if (c.status === "PLANEJADO") await db.update(schema.perfCycles).set({ status: "ABERTO" }).where(eq(schema.perfCycles.id, cid));
    await audit(s, "gerar avaliações", "perf_cycles", cid, null, { geradas: n });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", `${n} avaliação(ões) gerada(s). Ciclo aberto.`));
}
export async function mudarStatusCiclo(fd: FormData) {
  const s = await requireSession(); const cid = Number(fd.get("cycleId")); const novo = str(fd, "status"); const b = `/desempenho/ciclos/${cid}`;
  try { const cfg = await getSettings(); assert(can.aprovar(s, cfg.alcadas.calibracao), "Mudar fase do ciclo exige: " + cfg.alcadas.calibracao.join(", ")); if (!["ABERTO", "CALIBRACAO", "ENCERRADO"].includes(novo)) throw new Error("Fase inválida.");
    if (novo === "ENCERRADO") { const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM perf_reviews WHERE cycle_id=${cid} AND status IN ('PENDENTE','AUTOAVALIADA')`; if (n) throw new Error(`${n} avaliação(ões) ainda sem nota do gestor.`); await sql`UPDATE perf_reviews SET status='CONCLUIDA', concluida_em=now() WHERE cycle_id=${cid} AND status IN ('AVALIADA','CALIBRADA')`; }
    await db.update(schema.perfCycles).set({ status: novo }).where(eq(schema.perfCycles.id, cid)); await audit(s, "fase do ciclo", "perf_cycles", cid, null, { status: novo });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Fase do ciclo atualizada."));
}
async function review(id: number) { const [r] = await db.select().from(schema.perfReviews).where(eq(schema.perfReviews.id, id)); if (!r) throw new Error("Avaliação não encontrada."); const [c] = await db.select().from(schema.perfCycles).where(eq(schema.perfCycles.id, r.cycleId)); const [e] = await db.select().from(schema.employees).where(eq(schema.employees.id, r.employeeId)); return { r, c, e }; }
export async function autoavaliar(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const b = str(fd, "voltar") || `/desempenho/avaliacoes/${id}`;
  try { const { r, c, e } = await review(id); assert(s.employeeId === e.id || can.editar(s), "Só o próprio colaborador faz a autoavaliação."); assert(c.status === "ABERTO", "Ciclo não está aberto."); const comps = c.competencias as string[];
    const auto = { notas: notas(fd, "a_", comps), comentario: strOrNull(fd, "autoComentario"), realizacoes: strOrNull(fd, "realizacoes") };
    await db.update(schema.perfReviews).set({ auto, status: r.status === "PENDENTE" ? "AUTOAVALIADA" : r.status, updatedAt: new Date() }).where(eq(schema.perfReviews.id, id)); await audit(s, "autoavaliação", "perf_reviews", id, null, { competencias: Object.keys(auto.notas).length });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Autoavaliação registrada."));
}
export async function avaliarGestor(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const b = `/desempenho/avaliacoes/${id}`;
  try { const cfg = await getSettings(); const { r, c, e } = await review(id); assert(GESTAO.includes(s.role), "Seu perfil não avalia."); assert(r.avaliadorUserId === s.id || can.editar(s) || scopeUnit(s) === e.unitId, "Você não é o avaliador deste colaborador."); assert(["ABERTO", "CALIBRACAO"].includes(c.status), "Ciclo fechado."); const comps = c.competencias as string[];
    const g = { notas: notas(fd, "g_", comps), comentario: strOrNull(fd, "gestorComentario"), pontosFortes: strOrNull(fd, "pontosFortes"), melhorias: strOrNull(fd, "melhorias") };
    if (Object.keys(g.notas).length < comps.length) throw new Error("Avalie todas as competências.");
    const media = mediaNotas(g.notas); const potencial = int(fd, "potencial"); if (!potencial) throw new Error("Informe o potencial (1–3).");
    const pdi = [1, 2, 3].map(i => ({ acao: str(fd, `pdi_${i}`), prazo: strOrNull(fd, `pdiPrazo_${i}`), status: "EM_ANDAMENTO" })).filter(x => x.acao);
    await db.update(schema.perfReviews).set({ gestor: g, notaFinal: media === null ? null : String(media), potencial, desempenhoNivel: nivelDesempenho(media, cfg.desempenho), pdi, status: r.status === "CALIBRADA" ? "CALIBRADA" : "AVALIADA", updatedAt: new Date() }).where(eq(schema.perfReviews.id, id));
    await audit(s, "avaliação do gestor", "perf_reviews", id, null, { notaFinal: media, potencial });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Avaliação do gestor registrada."));
}
export async function calibrar(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const b = str(fd, "voltar") || `/desempenho/avaliacoes/${id}`;
  try { const cfg = await getSettings(); assert(can.aprovar(s, cfg.alcadas.calibracao), "Calibrar exige: " + cfg.alcadas.calibracao.join(", ")); const { r } = await review(id); assert(["AVALIADA", "CALIBRADA"].includes(r.status), "Só avaliações com nota do gestor são calibradas.");
    const d = { desempenhoNivel: int(fd, "desempenhoNivel") ?? r.desempenhoNivel, potencial: int(fd, "potencial") ?? r.potencial, calibracaoNota: strOrNull(fd, "nota"), status: "CALIBRADA", updatedAt: new Date() };
    await db.update(schema.perfReviews).set(d).where(eq(schema.perfReviews.id, id)); await audit(s, "calibrar", "perf_reviews", id, { desempenhoNivel: r.desempenhoNivel, potencial: r.potencial }, d);
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Calibração registrada."));
}
export async function atualizarPdi(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const idx = Number(fd.get("idx")); const b = str(fd, "voltar") || `/desempenho/avaliacoes/${id}`;
  try { const { r, e } = await review(id); assert(s.employeeId === e.id || r.avaliadorUserId === s.id || can.editar(s)); const pdi = (r.pdi as { acao: string; prazo: string | null; status: string }[] | null) ?? []; if (!pdi[idx]) throw new Error("Item não encontrado."); pdi[idx].status = pdi[idx].status === "CONCLUIDA" ? "EM_ANDAMENTO" : "CONCLUIDA"; await db.update(schema.perfReviews).set({ pdi, updatedAt: new Date() }).where(eq(schema.perfReviews.id, id)); }
  catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(b);
}
export async function salvarMeta(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id"); const b = str(fd, "voltar") || "/desempenho";
  try { assert(GESTAO.includes(s.role) || !!s.employeeId); const cycleId = int(fd, "cycleId"); const employeeId = int(fd, "employeeId"); if (!cycleId || !employeeId) throw new Error("Ciclo e colaborador obrigatórios."); if (s.role === "COLABORADOR" && s.employeeId !== employeeId) throw new Error("Sem acesso.");
    const d = { cycleId, employeeId, titulo: str(fd, "titulo"), indicador: strOrNull(fd, "indicador"), meta: strOrNull(fd, "meta"), resultado: strOrNull(fd, "resultado"), peso: int(fd, "peso") ?? 1, atingimento: int(fd, "atingimento"), status: str(fd, "status") || "EM_ANDAMENTO" }; if (!d.titulo) throw new Error("Informe a meta.");
    if (id) await db.update(schema.perfGoals).set(d).where(eq(schema.perfGoals.id, id)); else await db.insert(schema.perfGoals).values(d);
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Meta salva."));
}
export async function registrarCheckin(fd: FormData) {
  const s = await requireSession(); const employeeId = Number(fd.get("employeeId")); const b = str(fd, "voltar") || `/colaboradores/${employeeId}`;
  try { assert(GESTAO.includes(s.role)); const [e] = await db.select().from(schema.employees).where(eq(schema.employees.id, employeeId)); if (!e) throw new Error("Colaborador não encontrado."); assertScope(s, e.unitId);
    await db.insert(schema.perfCheckins).values({ employeeId, data: str(fd, "data") || hoje(), userId: s.id, temas: strOrNull(fd, "temas"), combinados: strOrNull(fd, "combinados") }); await audit(s, "1:1", "perf_checkins", employeeId, null, { data: str(fd, "data") || hoje() });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Conversa 1:1 registrada."));
}

// ======================= RECRUTAMENTO =======================
export async function salvarRequisicao(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id"); let rid = id ?? 0;
  try { assert(GESTAO.includes(s.role), "Seu perfil não solicita vagas."); const titulo = str(fd, "titulo"); const unitId = int(fd, "unitId"); if (!titulo || !unitId) throw new Error("Informe título e unidade."); assertScope(s, unitId);
    const d = { titulo, positionId: int(fd, "positionId"), unitId, quantidade: int(fd, "quantidade") ?? 1, tipo: str(fd, "tipo") || "SUBSTITUICAO", justificativa: strOrNull(fd, "justificativa"), requisitos: strOrNull(fd, "requisitos"), regime: str(fd, "regime") || "CLT", jornada: strOrNull(fd, "jornada"), faixa: strOrNull(fd, "faixa"), prazo: strOrNull(fd, "prazo") };
    if (id) { await db.update(schema.requisitions).set(d).where(eq(schema.requisitions.id, id)); } else { const [r] = await db.insert(schema.requisitions).values({ ...d, solicitanteUserId: s.id, responsavelUserId: s.id }).returning({ id: schema.requisitions.id }); rid = r.id; }
    await audit(s, id ? "editar vaga" : "solicitar vaga", "requisitions", rid, null, d);
  } catch (e) { redirect(go("/recrutamento", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`/recrutamento/vagas/${rid}`, "ok", id ? "Vaga atualizada." : "Requisição enviada para aprovação."));
}
export async function decidirRequisicao(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const decisao = str(fd, "decisao"); const b = `/recrutamento/vagas/${id}`;
  try { const cfg = await getSettings(); const [r] = await db.select().from(schema.requisitions).where(eq(schema.requisitions.id, id)); if (!r) throw new Error("Vaga não encontrada.");
    if (decisao === "ABERTA") { assert(can.aprovar(s, cfg.alcadas.vagas), "Aprovar vaga exige: " + cfg.alcadas.vagas.join(", ")); assert(r.status === "SOLICITADA", "Vaga já decidida."); await db.update(schema.requisitions).set({ status: "ABERTA", aprovadorUserId: s.id, abertaEm: hoje(), responsavelUserId: int(fd, "responsavelUserId") ?? r.responsavelUserId }).where(eq(schema.requisitions.id, id)); }
    else if (decisao === "CANCELADA") { assert(can.aprovar(s, cfg.alcadas.vagas) || r.solicitanteUserId === s.id); await db.update(schema.requisitions).set({ status: "CANCELADA", fechadaEm: hoje() }).where(eq(schema.requisitions.id, id)); }
    else if (decisao === "PREENCHIDA") { assert(can.editar(s)); await db.update(schema.requisitions).set({ status: "PREENCHIDA", fechadaEm: hoje() }).where(eq(schema.requisitions.id, id)); }
    else throw new Error("Decisão inválida.");
    await audit(s, "decidir vaga", "requisitions", id, { status: r.status }, { status: decisao });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", decisao === "ABERTA" ? "Vaga aprovada e aberta para seleção." : decisao === "CANCELADA" ? "Vaga cancelada." : "Vaga marcada como preenchida."));
}
export async function salvarCandidato(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id"); const reqId = int(fd, "requisitionId"); let cid = id ?? 0;
  try { assert(GESTAO.includes(s.role)); const nome = str(fd, "nome"); if (!nome) throw new Error("Informe o nome.");
    const d = { nome, email: strOrNull(fd, "email"), telefone: strOrNull(fd, "telefone"), cidade: strOrNull(fd, "cidade"), curriculoLink: strOrNull(fd, "curriculoLink"), origem: strOrNull(fd, "origem"), formacao: strOrNull(fd, "formacao"), tags: strOrNull(fd, "tags"), obs: strOrNull(fd, "obs"), consentimentoLgpd: str(fd, "consentimentoLgpd") === "1" };
    if (id) { await db.update(schema.candidates).set(d).where(eq(schema.candidates.id, id)); } else { const [r] = await db.insert(schema.candidates).values(d).returning({ id: schema.candidates.id }); cid = r.id; }
    await audit(s, id ? "editar candidato" : "criar candidato", "candidates", cid, null, { nome, origem: d.origem });
    if (reqId) { await sql`INSERT INTO applications (requisition_id, candidate_id) VALUES (${reqId}, ${cid}) ON CONFLICT DO NOTHING`; const [a] = await sql<{ id: number }[]>`SELECT id FROM applications WHERE requisition_id=${reqId} AND candidate_id=${cid}`; await db.insert(schema.applicationEvents).values({ applicationId: a.id, userNome: s.nome, texto: "Candidatura registrada (triagem)" }); }
  } catch (e) { redirect(go(reqId ? `/recrutamento/vagas/${reqId}` : "/recrutamento/candidatos", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(reqId ? `/recrutamento/vagas/${reqId}` : `/recrutamento/candidatos/${cid}`, "ok", reqId ? "Candidato incluído na vaga." : "Candidato salvo."));
}
export async function inscrever(fd: FormData) {
  const s = await requireSession(); const reqId = Number(fd.get("requisitionId")); const candidateId = Number(fd.get("candidateId")); const b = `/recrutamento/vagas/${reqId}`;
  try { assert(GESTAO.includes(s.role)); const [dup] = await sql<{ id: number }[]>`SELECT id FROM applications WHERE requisition_id=${reqId} AND candidate_id=${candidateId}`; if (dup) throw new Error("Candidato já está nesta vaga.");
    const [a] = await db.insert(schema.applications).values({ requisitionId: reqId, candidateId }).returning({ id: schema.applications.id }); await db.insert(schema.applicationEvents).values({ applicationId: a.id, userNome: s.nome, texto: "Candidatura registrada (triagem)" }); await audit(s, "inscrever candidato", "applications", a.id, null, { reqId, candidateId });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Candidato incluído na vaga."));
}
export async function moverEtapa(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const etapa = str(fd, "etapa"); let reqId = 0; let msg = "";
  try { assert(GESTAO.includes(s.role)); const cfg = await getSettings(); const [a] = await db.select().from(schema.applications).where(eq(schema.applications.id, id)); if (!a) throw new Error("Candidatura não encontrada."); reqId = a.requisitionId;
    const [r] = await db.select().from(schema.requisitions).where(eq(schema.requisitions.id, reqId)); if (!r || r.status !== "ABERTA") throw new Error("A vaga não está aberta.");
    if (![...cfg.recrutamento.etapas, "REPROVADO", "DESISTIU"].includes(etapa)) throw new Error("Etapa inválida.");
    const upd: Partial<typeof schema.applications.$inferInsert> = { etapa, updatedAt: new Date(), notas: strOrNull(fd, "notas") ?? a.notas, motivoReprovacao: etapa === "REPROVADO" ? strOrNull(fd, "motivo") : a.motivoReprovacao };
    const sc = notas(fd, "sc_", cfg.recrutamento.criterios); if (Object.keys(sc).length) upd.scorecard = { ...(a.scorecard as object ?? {}), ...sc };
    const pv = num(fd, "propostaValor"); if (pv !== null) upd.propostaValor = String(pv);
    if (etapa === "CONTRATADO") {
      if (!a.employeeId) {
        const [c] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, a.candidateId)); const admissao = str(fd, "admissao") || hoje();
        const [emp] = await db.insert(schema.employees).values({ nome: c.nome, email: c.email, telefone: c.telefone, unitId: r.unitId, positionId: r.positionId, vinculo: r.regime, admissao, situacao: "EM_ADMISSAO", salario: pv !== null ? String(pv) : a.propostaValor }).returning({ id: schema.employees.id });
        await db.insert(schema.documents).values(cfg.documentos.map(([tipo, obrigatorio]) => ({ employeeId: emp.id, tipo: String(tipo), obrigatorio: Boolean(obrigatorio) })));
        const pid = await abrirProcesso(s.id, emp.id, "ADMISSAO", admissao, cfg.admissao); upd.employeeId = emp.id;
        if (pv !== null || a.propostaValor) await sql`INSERT INTO salary_history (employee_id, data, salario, motivo, obs, user_id) VALUES (${emp.id}, ${admissao}, ${pv ?? Number(a.propostaValor)}, 'ADMISSAO', ${`Proposta aceita — vaga #${reqId}`}, ${s.id})`;
        msg = ` Colaborador pré-cadastrado (admissão #${pid}).`;
      }
      const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM applications WHERE requisition_id=${reqId} AND etapa='CONTRATADO' AND id<>${id}`;
      if (n + 1 >= r.quantidade) { await db.update(schema.requisitions).set({ status: "PREENCHIDA", fechadaEm: hoje() }).where(eq(schema.requisitions.id, reqId)); msg += " Vaga preenchida."; }
    }
    await db.update(schema.applications).set(upd).where(eq(schema.applications.id, id));
    await db.insert(schema.applicationEvents).values({ applicationId: id, userNome: s.nome, texto: `${etapa === "REPROVADO" ? "Reprovado" : etapa === "DESISTIU" ? "Desistiu" : "→ " + etapa}${strOrNull(fd, "notas") ? `: ${str(fd, "notas")}` : ""}${etapa === "REPROVADO" && strOrNull(fd, "motivo") ? ` (${str(fd, "motivo")})` : ""}` });
    await audit(s, "mover etapa", "applications", id, { etapa: a.etapa }, { etapa });
  } catch (e) { redirect(go(`/recrutamento/vagas/${reqId || ""}`, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`/recrutamento/vagas/${reqId}`, "ok", `Candidato movido para ${etapa}.${msg}`));
}
export async function importarCandidatos(fd: FormData) {
  const s = await requireSession(); let resumo = "";
  try { assert(can.editar(s)); const texto = str(fd, "csv"); if (!texto) throw new Error("Cole o CSV."); const linhas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean); const sep = linhas[0].includes(";") ? ";" : ","; const head = linhas[0].split(sep).map(h => h.trim().toLowerCase()); const idx = (k: string) => head.indexOf(k); if (idx("nome") < 0) throw new Error("Cabeçalho precisa ter nome.");
    let ok = 0, pulados = 0; for (const l of linhas.slice(1)) { const c = l.split(sep).map(x => x.trim()); const g = (k: string) => (idx(k) >= 0 ? c[idx(k)] ?? "" : ""); if (!g("nome")) continue; const [dup] = await sql<{ id: number }[]>`SELECT id FROM candidates WHERE lower(nome)=lower(${g("nome")}) AND (${g("email") || null}::text IS NULL OR email=${g("email") || null})`; if (dup) { pulados++; continue; } await db.insert(schema.candidates).values({ nome: g("nome"), email: g("email") || null, telefone: g("telefone") || null, cidade: g("cidade") || null, curriculoLink: g("curriculo") || null, origem: (g("origem") || "BANCO_TALENTOS").toUpperCase(), formacao: g("formacao") || null, tags: g("tags") || null, consentimentoLgpd: /^(1|sim|s|x)$/i.test(g("consentimento")) }); ok++; }
    await audit(s, "importar candidatos", "candidates", null, null, { ok, pulados }); resumo = `${ok} candidato(s) importado(s), ${pulados} já existiam.`;
  } catch (e) { redirect(go("/recrutamento/candidatos", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go("/recrutamento/candidatos", "ok", resumo));
}
