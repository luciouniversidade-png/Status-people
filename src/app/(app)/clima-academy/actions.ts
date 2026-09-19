"use server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db, schema, sql } from "@/db";
import { requireSession, can, assert, assertScope, scopeUnit } from "@/lib/auth";
import { audit, str, strOrNull, int, num, hoje, getSettings } from "@/lib/utils";
import { perguntasPadrao, validadeFinal, type Pergunta } from "@/lib/clima-academy";

const go = (b: string, k: "ok" | "erro", msg: string, hash = "") => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}${hash}`;
const GESTAO = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"];

// ======================= CLIMA =======================
export async function criarPesquisa(fd: FormData) {
  const s = await requireSession(); let id = 0;
  try { assert(can.editar(s), "Só RH e Direção criam pesquisas."); const cfg = await getSettings(); const nome = str(fd, "nome"); const tipo = str(fd, "tipo") || "CLIMA"; const inicio = str(fd, "inicio"); const fim = str(fd, "fim"); if (!nome || !inicio || !fim) throw new Error("Informe nome e período.");
    let perguntas: Pergunta[];
    const texto = str(fd, "perguntas");
    if (texto) { perguntas = texto.split("\n").map(l => l.trim()).filter(Boolean).map((l, i) => { const [d, t] = l.includes("|") ? l.split("|").map(x => x.trim()) : ["Geral", l]; return { id: `q${i + 1}`, dimensao: d, texto: t, tipo: "ESCALA" as const }; }); perguntas.push(...perguntasPadrao([], "ENPS")); }
    else perguntas = perguntasPadrao(cfg.clima.dimensoes as [string, string][], tipo);
    const [r] = await db.insert(schema.climateSurveys).values({ nome, tipo, inicio, fim, unitId: int(fd, "unitId"), perguntas, token: randomBytes(12).toString("hex"), minimoAnonimato: int(fd, "minimoAnonimato") ?? cfg.clima.minimoAnonimato }).returning({ id: schema.climateSurveys.id });
    id = r.id; await audit(s, "criar pesquisa", "climate_surveys", id, null, { nome, tipo, perguntas: perguntas.length });
  } catch (e) { redirect(go("/clima", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`/clima/${id}`, "ok", "Pesquisa criada. Abra-a para liberar o link."));
}
export async function statusPesquisa(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const novo = str(fd, "status"); const b = `/clima/${id}`;
  try { assert(can.editar(s)); if (!["ABERTA", "ENCERRADA", "RASCUNHO"].includes(novo)) throw new Error("Situação inválida."); await db.update(schema.climateSurveys).set({ status: novo }).where(eq(schema.climateSurveys.id, id)); await audit(s, "status pesquisa", "climate_surveys", id, null, { status: novo }); }
  catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", novo === "ABERTA" ? "Pesquisa aberta — compartilhe o link com a equipe." : novo === "ENCERRADA" ? "Pesquisa encerrada." : "Pesquisa voltou a rascunho."));
}
/** Resposta anônima pelo link público (sem login). */
export async function responderPesquisa(fd: FormData) {
  const token = str(fd, "token"); let ok = false;
  try {
    const [sv] = await db.select().from(schema.climateSurveys).where(eq(schema.climateSurveys.token, token)); if (!sv || sv.status !== "ABERTA") throw new Error("Pesquisa indisponível.");
    const jar = await cookies(); if (jar.get(`clima_${sv.id}`)) throw new Error("Este navegador já enviou uma resposta para esta pesquisa. Obrigado!");
    const perguntas = sv.perguntas as Pergunta[]; const respostas: Record<string, number | string> = {}; let algum = false;
    for (const q of perguntas) { const v = str(fd, q.id); if (!v) continue; if (q.tipo === "TEXTO") respostas[q.id] = v.slice(0, 2000); else { const n = Number(v); if (Number.isNaN(n)) continue; respostas[q.id] = n; algum = true; } }
    if (!algum) throw new Error("Responda ao menos uma pergunta.");
    const comentario = perguntas.filter(q => q.tipo === "TEXTO").map(q => respostas[q.id]).filter(Boolean).join("\n") || null;
    await db.insert(schema.climateResponses).values({ surveyId: sv.id, unitId: int(fd, "unitId"), regime: strOrNull(fd, "regime"), respostas, comentario });
    jar.set(`clima_${sv.id}`, "1", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 120 }); ok = true;
  } catch (e) { redirect(`/pesquisa/${token}?erro=${encodeURIComponent(e instanceof Error ? e.message : "Erro")}`); }
  if (ok) redirect(`/pesquisa/${token}?obrigado=1`);
}
export async function salvarAcaoClima(fd: FormData) {
  const s = await requireSession(); const surveyId = Number(fd.get("surveyId")); const id = int(fd, "id"); const b = `/clima/${surveyId}`;
  try { assert(GESTAO.includes(s.role)); const acao = str(fd, "acao"); if (!acao) throw new Error("Descreva a ação."); const unitId = int(fd, "unitId"); if (unitId) assertScope(s, unitId);
    const d = { surveyId, dimensao: strOrNull(fd, "dimensao"), unitId, acao, responsavelUserId: int(fd, "responsavelUserId") ?? s.id, prazo: strOrNull(fd, "prazo"), status: str(fd, "status") || "PLANEJADA" };
    if (id) await db.update(schema.climateActions).set(d).where(eq(schema.climateActions.id, id)); else await db.insert(schema.climateActions).values(d);
    await audit(s, "plano de ação clima", "climate_actions", id, null, d);
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro", "#acoes")); }
  redirect(go(b, "ok", "Ação salva.", "#acoes"));
}

// ======================= ACADEMY =======================
export async function salvarCurso(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id"); let cid = id ?? 0;
  try { assert(can.editar(s) || s.role === "DIRETOR_UNIDADE", "Só RH, Direção e diretores criam treinamentos."); const codigo = str(fd, "codigo"); const titulo = str(fd, "titulo"); if (!codigo || !titulo) throw new Error("Informe código e título.");
    const cargos = fd.getAll("paraCargos").map(Number).filter(Boolean);
    const d = { codigo, titulo, area: strOrNull(fd, "area"), descricao: strOrNull(fd, "descricao"), tipo: str(fd, "tipo") || "OPCIONAL", formato: str(fd, "formato") || "ONLINE", cargaHoras: num(fd, "cargaHoras") === null ? null : String(num(fd, "cargaHoras")), link: strOrNull(fd, "link"), procedureId: int(fd, "procedureId"), validadeMeses: int(fd, "validadeMeses"), paraTodos: str(fd, "paraTodos") === "1", paraCargos: cargos.length ? cargos : null, paraRegime: strOrNull(fd, "paraRegime"), ativo: str(fd, "ativo") !== "0" };
    if (d.formato === "POP" && !d.procedureId) throw new Error("Treinamento por ciência de POP precisa do POP vinculado.");
    if (id) { await db.update(schema.courses).set(d).where(eq(schema.courses.id, id)); } else { const [r] = await db.insert(schema.courses).values(d).returning({ id: schema.courses.id }); cid = r.id; }
    await audit(s, id ? "editar treinamento" : "criar treinamento", "courses", cid, null, { codigo, titulo, tipo: d.tipo });
  } catch (e) { redirect(go(id ? `/academy/cursos/${id}` : "/academy", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`/academy/cursos/${cid}`, "ok", "Treinamento salvo."));
}
export async function registrarConclusao(fd: FormData) {
  const s = await requireSession(); const courseId = Number(fd.get("courseId")); const b = str(fd, "voltar") || `/academy/cursos/${courseId}`; let n = 0;
  try { assert(GESTAO.includes(s.role)); const [c] = await db.select().from(schema.courses).where(eq(schema.courses.id, courseId)); if (!c) throw new Error("Treinamento não encontrado."); if (c.formato === "POP") throw new Error("Este treinamento é concluído pela ciência do POP.");
    const ids = fd.getAll("employeeId").map(Number).filter(Boolean); if (!ids.length) throw new Error("Selecione ao menos um colaborador."); const data = str(fd, "concluidoEm") || hoje(); const status = str(fd, "status") || "CONCLUIDO";
    for (const eid of ids) { const [e] = await db.select({ unitId: schema.employees.unitId }).from(schema.employees).where(eq(schema.employees.id, eid)); if (!e) continue; assertScope(s, e.unitId);
      await sql`INSERT INTO training_progress (course_id, employee_id, status, inicio_em, concluido_em, valido_ate, nota, evidencia, registrado_por, updated_at) VALUES (${courseId}, ${eid}, ${status}, ${status === "EM_ANDAMENTO" ? data : null}, ${status === "CONCLUIDO" ? data : null}, ${status === "CONCLUIDO" ? validadeFinal(data, c.validadeMeses) : null}, ${num(fd, "nota")}, ${strOrNull(fd, "evidencia")}, ${s.id}, now())
        ON CONFLICT (course_id, employee_id) DO UPDATE SET status=EXCLUDED.status, inicio_em=coalesce(training_progress.inicio_em, EXCLUDED.inicio_em), concluido_em=EXCLUDED.concluido_em, valido_ate=EXCLUDED.valido_ate, nota=EXCLUDED.nota, evidencia=EXCLUDED.evidencia, registrado_por=EXCLUDED.registrado_por, updated_at=now()`; n++; }
    await audit(s, "registrar treinamento", "training_progress", courseId, null, { colaboradores: n, status, data });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", `${n} registro(s) atualizado(s).`));
}
export async function salvarSessao(fd: FormData) {
  const s = await requireSession(); const courseId = Number(fd.get("courseId")); const b = `/academy/cursos/${courseId}`;
  try { assert(GESTAO.includes(s.role)); const data = str(fd, "data"); if (!data) throw new Error("Informe a data."); const unitId = int(fd, "unitId"); if (unitId) assertScope(s, unitId);
    const [r] = await db.insert(schema.trainingSessions).values({ courseId, data, horario: strOrNull(fd, "horario"), local: strOrNull(fd, "local"), instrutor: strOrNull(fd, "instrutor"), unitId, vagas: int(fd, "vagas"), obs: strOrNull(fd, "obs") }).returning({ id: schema.trainingSessions.id });
    await audit(s, "criar turma de treinamento", "training_sessions", r.id, null, { courseId, data });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Turma agendada.", "#turmas"));
}
export async function registrarPresenca(fd: FormData) {
  const s = await requireSession(); const sessionId = Number(fd.get("sessionId")); let courseId = 0; let n = 0;
  try { assert(GESTAO.includes(s.role)); const [ses] = await db.select().from(schema.trainingSessions).where(eq(schema.trainingSessions.id, sessionId)); if (!ses) throw new Error("Turma não encontrada."); courseId = ses.courseId;
    const [c] = await db.select().from(schema.courses).where(eq(schema.courses.id, courseId)); const ids = fd.getAll("employeeId").map(Number).filter(Boolean);
    for (const eid of ids) { await sql`INSERT INTO session_attendance (session_id, employee_id, presente) VALUES (${sessionId}, ${eid}, true) ON CONFLICT (session_id, employee_id) DO UPDATE SET presente=true`;
      await sql`INSERT INTO training_progress (course_id, employee_id, status, concluido_em, valido_ate, evidencia, registrado_por, updated_at) VALUES (${courseId}, ${eid}, 'CONCLUIDO', ${ses.data}, ${validadeFinal(ses.data, c?.validadeMeses ?? null)}, ${`Presença na turma de ${ses.data}`}, ${s.id}, now()) ON CONFLICT (course_id, employee_id) DO UPDATE SET status='CONCLUIDO', concluido_em=EXCLUDED.concluido_em, valido_ate=EXCLUDED.valido_ate, evidencia=EXCLUDED.evidencia, registrado_por=EXCLUDED.registrado_por, updated_at=now()`; n++; }
    await audit(s, "presença em treinamento", "training_sessions", sessionId, null, { presentes: n });
  } catch (e) { redirect(go(`/academy/cursos/${courseId}`, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`/academy/cursos/${courseId}`, "ok", `${n} presença(s) registrada(s) — treinamento concluído para eles.`, "#turmas"));
}
export async function salvarNecessidade(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id"); const b = str(fd, "voltar") || "/academy#lnt";
  try { assert(GESTAO.includes(s.role)); const descricao = str(fd, "descricao"); if (!descricao) throw new Error("Descreva a necessidade."); const unitId = int(fd, "unitId") ?? scopeUnit(s);
    const d = { employeeId: int(fd, "employeeId"), unitId, descricao, origem: str(fd, "origem") || "GESTOR", prioridade: str(fd, "prioridade") || "NORMAL", courseId: int(fd, "courseId"), status: str(fd, "status") || "ABERTA" };
    if (id) await db.update(schema.trainingNeeds).set(d).where(eq(schema.trainingNeeds.id, id)); else await db.insert(schema.trainingNeeds).values({ ...d, createdBy: s.id });
    await audit(s, "necessidade de treinamento", "training_needs", id, null, d);
  } catch (e) { redirect(go(b.split("#")[0], "erro", e instanceof Error ? e.message : "Erro", "#lnt")); }
  redirect(go(b.split("#")[0], "ok", "Necessidade registrada.", "#lnt"));
}
