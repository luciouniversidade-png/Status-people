"use server";
import { quemAprovaTexto } from "@/lib/acesso";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireSession, can, assert, assertScope } from "@/lib/auth";
import { audit, str, strOrNull, int, num, hoje, getSettings } from "@/lib/utils";
import { modeloInicial, FASES_ORDEM, validarFaixas, FAIXAS_PADRAO, type Criterio, type Notas } from "@/lib/avaliacao";
import { calcularRevisao } from "@/lib/avaliacao-server";
import { notificar, usuariosPorPerfil } from "@/lib/comunicacao";
import { acessoColaborador } from "@/lib/desenvolvimento";
import { comMensagem } from "@/lib/redirecionar";

const go = (b: string, k: "ok" | "erro", msg: string, hash = "") => comMensagem(b, k, msg, hash);
const RH = ["DIRECAO", "RH"]; const GESTOR = ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR"];
type Review = typeof schema.perfReviews.$inferSelect; type Cycle = typeof schema.perfCycles.$inferSelect;

async function carregar(rid: number): Promise<{ r: Review; c: Cycle; criterios: Criterio[] }> {
  const [r] = await db.select().from(schema.perfReviews).where(eq(schema.perfReviews.id, rid)); if (!r) throw new Error("Avaliação não encontrada.");
  const [c] = await db.select().from(schema.perfCycles).where(eq(schema.perfCycles.id, r.cycleId)); if (!c) throw new Error("Ciclo não encontrado.");
  return { r, c, criterios: (c.criterios as Criterio[] | null) ?? [] };
}
/** Quem pode avaliar: avaliador designado, RH/Direção e diretor da unidade do avaliado (por snapshot). */
function podeAvaliar(s: { id: number; role: string; unitId: number | null }, r: Review) { const snap = (r.snapshot as { unitId?: number } | null); return RH.includes(s.role) || r.avaliadorUserId === s.id || (s.role === "DIRETOR_UNIDADE" && snap?.unitId === s.unitId); }
/** Versão para concorrência otimista: o formulário envia a versão que carregou. */
async function trava(rid: number, versaoForm: number | null) { const [x] = await sql<{ versao: number }[]>`SELECT versao FROM perf_reviews WHERE id=${rid}`; if (versaoForm !== null && x && x.versao !== versaoForm) throw new Error("Esta avaliação foi alterada por outra pessoa enquanto você editava. Recarregue a página e confira antes de salvar."); }

// ---------- Modelos ----------
export async function salvarModelo(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id"); let mid = id ?? 0;
  try { assert(RH.includes(s.role), "Modelos são mantidos por RH/Direção."); const nome = str(fd, "nome"); const familia = str(fd, "familia"); if (!nome || !familia) throw new Error("Informe nome e família de cargos.");
    const pr = int(fd, "pesoResultados") ?? 60, pa = int(fd, "pesoAtitudes") ?? 40; if (pr + pa !== 100) throw new Error("Os pesos de Resultados e Atitudes precisam somar 100%.");
    const composta = str(fd, "notaComposta") === "1"; const finalidade = strOrNull(fd, "finalidade"); if (composta && !finalidade) throw new Error("Nota composta exige descrever a finalidade (para que a nota será usada e seus limites).");
    const lim = (k: string, def: number[]) => { const t = str(fd, k); return t ? t.split(/[;/ ]+/).filter(Boolean).map(x => Number(x.replace(",", "."))) : def; };
    const faixas = validarFaixas({ matriz: lim("faixasMatriz", FAIXAS_PADRAO.matriz), final: lim("faixasFinal", FAIXAS_PADRAO.final) }); const cobMin = int(fd, "coberturaMinima") ?? 50; if (cobMin < 0 || cobMin > 100) throw new Error("Cobertura mínima entre 0 e 100%.");
    if (id) { const [m] = await db.select().from(schema.evalModels).where(eq(schema.evalModels.id, id)); if (!m) throw new Error("Modelo não encontrado."); if (m.congeladoEm) throw new Error("Modelo congelado (em uso por ciclo aberto). Crie uma nova versão."); await db.update(schema.evalModels).set({ nome, familia, pesoResultados: pr, pesoAtitudes: pa, status: str(fd, "status") || m.status, notaComposta: composta, finalidade, faixas, coberturaMinima: cobMin }).where(eq(schema.evalModels.id, id)); }
    else { const crit = modeloInicial(familia).map((c, i) => ({ ...c, id: `c${i + 1}`, naPermitido: c.eixo !== "ATITUDES" })); const [m] = await db.insert(schema.evalModels).values({ nome, familia, pesoResultados: pr, pesoAtitudes: pa, notaComposta: composta, finalidade, faixas, coberturaMinima: cobMin, criterios: str(fd, "vazio") === "1" ? [] : crit }).returning({ id: schema.evalModels.id }); mid = m.id; }
    await audit(s, id ? "editar modelo de avaliação" : "criar modelo de avaliação", "eval_models", mid, null, { nome, familia, pr, pa });
  } catch (e) { redirect(go(id ? `/desempenho/modelos/${id}` : "/desempenho/modelos", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`/desempenho/modelos/${mid}`, "ok", "Modelo salvo."));
}
export async function salvarCriterio(fd: FormData) {
  const s = await requireSession(); const mid = Number(fd.get("modelId")); const cid = strOrNull(fd, "criterioId"); const b = `/desempenho/modelos/${mid}`;
  try { assert(RH.includes(s.role)); const [m] = await db.select().from(schema.evalModels).where(eq(schema.evalModels.id, mid)); if (!m) throw new Error("Modelo não encontrado."); if (m.congeladoEm) throw new Error("Modelo congelado. Crie uma nova versão para alterar critérios.");
    const crit = (m.criterios as Criterio[]); const titulo = str(fd, "titulo"); const eixo = str(fd, "eixo") as Criterio["eixo"]; const peso = num(fd, "peso") ?? 1; if (!titulo || !eixo) throw new Error("Informe título e eixo."); if (peso <= 0) throw new Error("Peso deve ser maior que zero.");
    const niveis: Record<string, string> = {}; for (const n of [1, 2, 3, 4, 5]) { const v = str(fd, `n${n}`); if (v) niveis[String(n)] = v; }
    const novo: Criterio = { id: cid ?? `c${Date.now().toString(36)}`, eixo, titulo, descricao: strOrNull(fd, "descricao"), peso, niveis, evidencia: strOrNull(fd, "evidencia"), naPermitido: str(fd, "naPermitido") === "1" };
    const idx = crit.findIndex(c => c.id === cid); if (str(fd, "excluir") === "1") { if (idx >= 0) crit.splice(idx, 1); } else if (idx >= 0) crit[idx] = novo; else crit.push(novo);
    await db.update(schema.evalModels).set({ criterios: crit }).where(eq(schema.evalModels.id, mid)); await audit(s, "critério do modelo", "eval_models", mid, null, { criterio: novo.id, titulo, eixo, peso, excluir: str(fd, "excluir") === "1" });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Critério salvo."));
}
export async function novaVersaoModelo(fd: FormData) {
  const s = await requireSession(); const mid = Number(fd.get("modelId")); let novo = 0;
  try { assert(RH.includes(s.role)); const [m] = await db.select().from(schema.evalModels).where(eq(schema.evalModels.id, mid)); if (!m) throw new Error("Modelo não encontrado.");
    const [n] = await db.insert(schema.evalModels).values({ nome: m.nome, familia: m.familia, versao: m.versao + 1, status: "RASCUNHO", pesoResultados: m.pesoResultados, pesoAtitudes: m.pesoAtitudes, criterios: m.criterios, notaComposta: m.notaComposta, finalidade: m.finalidade, faixas: m.faixas, coberturaMinima: m.coberturaMinima }).returning({ id: schema.evalModels.id }); novo = n.id;
    await db.update(schema.evalModels).set({ status: "ARQUIVADO" }).where(eq(schema.evalModels.id, mid)); await audit(s, "nova versão do modelo", "eval_models", novo, { versao: m.versao }, { versao: m.versao + 1 });
  } catch (e) { redirect(go("/desempenho/modelos", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`/desempenho/modelos/${novo}`, "ok", "Nova versão criada como rascunho. Ciclos anteriores continuam com a versão congelada."));
}

// ---------- Ciclo: vincular modelo (congela critérios), fase, prazos ----------
export async function configurarCiclo(fd: FormData) {
  const s = await requireSession(); const cid = Number(fd.get("cycleId")); const b = `/desempenho/ciclos/${cid}`;
  try { const cfg = await getSettings(); assert(can.aprovar(s, "calibracao") || RH.includes(s.role)); const [c] = await db.select().from(schema.perfCycles).where(eq(schema.perfCycles.id, cid)); if (!c) throw new Error("Ciclo não encontrado.");
    const upd: Partial<typeof schema.perfCycles.$inferInsert> = { prazoAvaliacao: strOrNull(fd, "prazoAvaliacao"), prazoFeedback: strOrNull(fd, "prazoFeedback"), familias: fd.getAll("familias").map(String).filter(Boolean), piloto: str(fd, "piloto") === "1" };
    if (c.fase === "PLANEJAMENTO") { const fontes: Record<string, { peso: number; minimo: number }> = {}; for (const g of ["PAR", "LIDERADO"]) { const peso = int(fd, `peso_${g}`), minimo = int(fd, `min_${g}`); if (peso && peso > 0) fontes[g] = { peso, minimo: Math.max(3, minimo ?? 3) }; } if (Object.keys(fontes).length) { const pg = int(fd, "peso_GESTOR") ?? 100; fontes.GESTOR = { peso: pg, minimo: 1 }; } upd.fontes = Object.keys(fontes).length ? fontes : null; }
    const mudPrazo = (upd.prazoAvaliacao ?? null) !== (c.prazoAvaliacao ?? null) || (upd.prazoFeedback ?? null) !== (c.prazoFeedback ?? null); if (mudPrazo && c.fase !== "PLANEJAMENTO" && !str(fd, "justificativa")) throw new Error("Alterar prazos com o ciclo em andamento exige justificativa.");
    const modelId = int(fd, "modelId");
    if (modelId && modelId !== c.modelId) { if (c.fase !== "PLANEJAMENTO") throw new Error("O modelo só pode ser trocado na fase de planejamento."); const [m] = await db.select().from(schema.evalModels).where(eq(schema.evalModels.id, modelId)); if (!m) throw new Error("Modelo não encontrado."); if (m.status !== "ATIVO") throw new Error("Só modelos aprovados (situação Ativo) podem ser usados em ciclos."); if (!(m.criterios as Criterio[]).some(x => x.eixo === "RESULTADOS") || !(m.criterios as Criterio[]).some(x => x.eixo === "ATITUDES")) throw new Error("O modelo precisa ter critérios de Resultados e de Atitudes.");
      Object.assign(upd, { modelId, modelVersao: m.versao, criterios: m.criterios, pesoResultados: m.pesoResultados, pesoAtitudes: m.pesoAtitudes, notaComposta: m.notaComposta, faixas: m.faixas ?? FAIXAS_PADRAO, coberturaMinima: m.coberturaMinima }); }
    else if (c.fase === "PLANEJAMENTO") { const pr = int(fd, "pesoResultados"), pa = int(fd, "pesoAtitudes"); if (pr !== null && pa !== null) { if (pr + pa !== 100) throw new Error("Pesos precisam somar 100%."); Object.assign(upd, { pesoResultados: pr, pesoAtitudes: pa }); } }
    await db.update(schema.perfCycles).set(upd).where(eq(schema.perfCycles.id, cid)); await audit(s, "configurar ciclo", "perf_cycles", cid, { prazos: [c.prazoAvaliacao, c.prazoFeedback], familias: c.familias, fontes: c.fontes }, { modelId, prazos: [upd.prazoAvaliacao, upd.prazoFeedback], familias: upd.familias, fontes: upd.fontes, justificativa: strOrNull(fd, "justificativa") });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Ciclo configurado."));
}
export async function avancarFase(fd: FormData) {
  const s = await requireSession(); const cid = Number(fd.get("cycleId")); const nova = str(fd, "fase"); const b = `/desempenho/ciclos/${cid}`; const just = strOrNull(fd, "justificativa");
  try { const cfg = await getSettings(); if (!can.aprovar(s, "calibracao")) throw new Error("Mudar fase exige: " + (await quemAprovaTexto("calibracao"))); const [c] = await db.select().from(schema.perfCycles).where(eq(schema.perfCycles.id, cid)); if (!c) throw new Error("Ciclo não encontrado."); if (!FASES_ORDEM.includes(nova)) throw new Error("Fase inválida.");
    const de = FASES_ORDEM.indexOf(c.fase), para = FASES_ORDEM.indexOf(nova); if (para < de && !just) throw new Error("Voltar de fase exige justificativa."); if (para > de + 1) throw new Error("Avance uma fase por vez.");
    if (nova === "ACOMPANHAMENTO" && !c.criterios) throw new Error("Vincule um modelo de avaliação antes de sair do planejamento.");
    if (nova === "ACOMPANHAMENTO" && c.modelId) await db.update(schema.evalModels).set({ congeladoEm: new Date(), status: "ATIVO" }).where(eq(schema.evalModels.id, c.modelId)); // congela critérios, rubricas e pesos
    if (nova === "CONCLUSAO") { const [p] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM perf_reviews WHERE cycle_id=${cid} AND estado NOT IN ('PUBLICADA','CONTESTADA','INCONCLUSIVA')`; if (p.n) throw new Error(`${p.n} avaliação(ões) ainda não publicada(s).`); }
    const status = nova === "ARQUIVADO" || nova === "CONCLUSAO" ? "ENCERRADO" : nova === "CALIBRACAO" ? "CALIBRACAO" : nova === "PLANEJAMENTO" ? "PLANEJADO" : "ABERTO";
    await db.update(schema.perfCycles).set({ fase: nova, status }).where(eq(schema.perfCycles.id, cid)); await audit(s, "fase do ciclo", "perf_cycles", cid, { fase: c.fase }, { fase: nova, justificativa: just });
    if (nova === "AVALIACAO") { const avs = await sql<{ avaliador_user_id: number | null }[]>`SELECT DISTINCT avaliador_user_id FROM perf_reviews WHERE cycle_id=${cid} AND estado='RASCUNHO'`; await notificar(avs.map(a => a.avaliador_user_id ?? 0), `Avaliações do ciclo ${c.nome} liberadas`, c.prazoAvaliacao ? `Prazo: ${c.prazoAvaliacao}` : null, `/desempenho/ciclos/${cid}`, "ACAO", `aval:${cid}`); }
    if (nova === "FEEDBACK") { const avs = await sql<{ avaliador_user_id: number | null }[]>`SELECT DISTINCT avaliador_user_id FROM perf_reviews WHERE cycle_id=${cid}`; await notificar(avs.map(a => a.avaliador_user_id ?? 0), `Feedbacks do ciclo ${c.nome}: agende as devolutivas`, c.prazoFeedback ? `Prazo: ${c.prazoFeedback}` : null, `/desempenho/ciclos/${cid}`, "ACAO", `fb:${cid}`); }
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Fase atualizada."));
}
/** Gera avaliações (uma por colaborador elegível) com snapshot de unidade/cargo/gestor no momento. */
export async function gerarAvaliacoesCriterios(fd: FormData) {
  const s = await requireSession(); const cid = Number(fd.get("cycleId")); const b = `/desempenho/ciclos/${cid}`; let n = 0;
  try { assert(RH.includes(s.role)); const [c] = await db.select().from(schema.perfCycles).where(eq(schema.perfCycles.id, cid)); if (!c) throw new Error("Ciclo não encontrado."); if (!c.criterios) throw new Error("Vincule um modelo antes de gerar as avaliações.");
    const fam = (c.familias as string[] | null) ?? [];
    const emps = await sql<{ id: number; unit_id: number; unidade: string; position_id: number | null; cargo: string | null; familia: string | null; gestor_id: number | null; gestor_user: number | null }[]>`SELECT e.id, e.unit_id, un.nome AS unidade, e.position_id, p.nome AS cargo, p.familia, e.gestor_id, (SELECT u.id FROM users u WHERE u.employee_id=e.gestor_id AND u.ativo LIMIT 1) AS gestor_user FROM employees e JOIN units un ON un.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id WHERE e.situacao='ATIVO' ${c.unitId ? sql`AND e.unit_id=${c.unitId}` : sql``} ${fam.length ? sql`AND p.familia = ANY(${fam})` : sql``} AND NOT EXISTS (SELECT 1 FROM perf_reviews r WHERE r.cycle_id=${cid} AND r.employee_id=e.id)`;
    for (const e of emps) { await db.insert(schema.perfReviews).values({ cycleId: cid, employeeId: e.id, avaliadorUserId: e.gestor_user ?? s.id, estado: "RASCUNHO", snapshot: { unitId: e.unit_id, unidade: e.unidade, positionId: e.position_id, cargo: e.cargo, gestorId: e.gestor_id, familia: e.familia } }); n++; }
    await audit(s, "gerar avaliações (critérios)", "perf_cycles", cid, null, { geradas: n, familias: fam });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", `${n} avaliação(ões) gerada(s) com registro de unidade, cargo e gestor do momento.`));
}

// ---------- Avaliação por critérios ----------
function lerNotas(fd: FormData, criterios: Criterio[], prefixo: string, anteriores: Notas): Notas {
  const out: Notas = {};
  for (const c of criterios) { const v = str(fd, `${prefixo}${c.id}`); const ant = anteriores[c.id] ?? {}; const ev = strOrNull(fd, `ev_${c.id}`) ?? ant.evidencia ?? null;
    if (v === "NO") { out[c.id] = { naoObservado: true, evidencia: ev }; continue; }
    if (v === "NA") { if (!c.naPermitido) throw new Error(`“Não aplicável” não é permitido em: ${c.titulo}.`); const j = str(fd, `naj_${c.id}`) || ant.naJustificativa; if (!j) throw new Error(`Justifique o “não aplicável” em: ${c.titulo}.`); out[c.id] = { na: true, naJustificativa: j, naAprovado: !!ant.naAprovado && ant.na === true, evidencia: ev }; }
    else if (v === "") out[c.id] = { nota: null, evidencia: ev }; else { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error(`Nota inválida em ${c.titulo} (use 1 a 5).`); out[c.id] = { nota: n, evidencia: ev }; } }
  return out;
}
export async function salvarAvaliacaoCriterios(fd: FormData) {
  const s = await requireSession(); const rid = Number(fd.get("id")); const enviar = str(fd, "enviar") === "1"; const voltar = str(fd, "voltar") || `/desempenho/avaliacoes/${rid}`; let msg = "";
  try { const { r, c, criterios } = await carregar(rid); assert(podeAvaliar(s, r), "Só o avaliador designado, o diretor da unidade ou o RH avaliam."); if (!["ACOMPANHAMENTO", "AVALIACAO"].includes(c.fase)) throw new Error("O ciclo não está em fase de avaliação."); if (!["RASCUNHO"].includes(r.estado)) throw new Error("Avaliação já enviada; alterações só em calibração."); await trava(rid, int(fd, "versao"));
    const notas = lerNotas(fd, criterios, "n_", (r.notasCriterios as Notas | null) ?? {}); const mem = await calcularRevisao(r, c, notas);
    if (enviar && !mem.publicavel) throw new Error(`Não é possível enviar: ${mem.motivos.join(" ")}`);
    await db.update(schema.perfReviews).set({ iniciadaEm: r.iniciadaEm ?? new Date(), periodoObsInicio: strOrNull(fd, "periodoObsInicio") ?? r.periodoObsInicio, periodoObsFim: strOrNull(fd, "periodoObsFim") ?? r.periodoObsFim, notasCriterios: notas, calc: mem, estado: enviar ? "ENVIADA" : "RASCUNHO", enviadaEm: enviar ? new Date() : r.enviadaEm, status: enviar ? "AVALIADA" : r.status, versao: r.versao + 1, updatedAt: new Date(), gestor: { ...((r.gestor as object | null) ?? {}), pontosFortes: strOrNull(fd, "pontosFortes"), melhorias: strOrNull(fd, "melhorias"), comentario: strOrNull(fd, "comentario") } }).where(eq(schema.perfReviews.id, rid));
    await audit(s, enviar ? "enviar avaliação" : "salvar rascunho de avaliação", "perf_reviews", rid, null, { N: mem.N, R: mem.R, A: mem.A, provisoria: mem.provisoria });
    if (enviar) { await notificar(await usuariosPorPerfil(RH), `Avaliação enviada para calibração/publicação`, `Ciclo ${c.nome}`, `/desempenho/avaliacoes/${rid}`, "INFO", `env:${rid}`); msg = "Avaliação enviada. Aguarda calibração/publicação."; } else msg = mem.N !== null ? `Rascunho salvo (nota provisória ${mem.N.toFixed(2)}; ${mem.pendentes.length} pendente(s)).` : "Rascunho salvo.";
  } catch (e) { redirect(go(voltar, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(voltar, "ok", msg));
}
export async function autoavaliarCriterios(fd: FormData) {
  const s = await requireSession(); const rid = Number(fd.get("id")); const voltar = str(fd, "voltar") || `/colaboradores/${s.employeeId}/painel`;
  try { const { r, c, criterios } = await carregar(rid); assert(r.employeeId === s.employeeId, "Só o próprio colaborador faz a autoavaliação."); if (!["ACOMPANHAMENTO", "AVALIACAO"].includes(c.fase)) throw new Error("O ciclo não está em fase de avaliação.");
    const notas: Notas = {}; for (const cr of criterios) { const v = str(fd, `a_${cr.id}`); if (v) { const n = Number(v); if (n >= 1 && n <= 5) notas[cr.id] = { nota: n, evidencia: strOrNull(fd, `aev_${cr.id}`) }; } }
    await db.update(schema.perfReviews).set({ autoCriterios: { notas, comentario: strOrNull(fd, "comentario"), em: new Date().toISOString() }, versao: r.versao + 1, updatedAt: new Date() }).where(eq(schema.perfReviews.id, rid)); await audit(s, "autoavaliação (critérios)", "perf_reviews", rid, null, { criterios: Object.keys(notas).length });
  } catch (e) { redirect(go(voltar, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(voltar, "ok", "Autoavaliação registrada — é uma perspectiva separada, não entra na nota."));
}
export async function aprovarNA(fd: FormData) {
  const s = await requireSession(); const rid = Number(fd.get("id")); const critId = str(fd, "criterioId"); const voltar = `/desempenho/avaliacoes/${rid}`;
  try { assert(RH.includes(s.role), "Aprovar “não aplicável” é do RH/Direção."); const { r, c, criterios } = await carregar(rid); const notas = { ...((r.notasCriterios as Notas | null) ?? {}) }; if (!notas[critId]?.na) throw new Error("Este critério não está marcado como não aplicável.");
    notas[critId] = { ...notas[critId], naAprovado: str(fd, "decisao") === "APROVAR" }; if (str(fd, "decisao") !== "APROVAR") { notas[critId].na = false; notas[critId].nota = null; }
    const mem = await calcularRevisao(r, c, notas); await db.update(schema.perfReviews).set({ notasCriterios: notas, calc: mem, versao: r.versao + 1, updatedAt: new Date() }).where(eq(schema.perfReviews.id, rid));
    await audit(s, str(fd, "decisao") === "APROVAR" ? "aprovar não aplicável" : "recusar não aplicável", "perf_reviews", rid, null, { criterio: critId, justificativa: notas[critId]?.naJustificativa, pesosApos: mem.coberturaR });
  } catch (e) { redirect(go(voltar, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(voltar, "ok", "Decisão sobre “não aplicável” registrada; pesos recalculados."));
}
/** Calibração: exige justificativa, preserva notas originais, recalcula pelo motor oficial. */
export async function calibrarCriterios(fd: FormData) {
  const s = await requireSession(); const rid = Number(fd.get("id")); const voltar = `/desempenho/avaliacoes/${rid}`;
  try { const cfg = await getSettings(); if (!can.aprovar(s, "calibracao")) throw new Error("Calibrar exige: " + (await quemAprovaTexto("calibracao"))); const { r, c, criterios } = await carregar(rid); if (!["ENVIADA", "EM_CALIBRACAO"].includes(r.estado)) throw new Error("Só avaliações enviadas entram em calibração."); const just = str(fd, "justificativa"); if (!just) throw new Error("Calibração exige justificativa."); const evid = str(fd, "evidenciaCalibracao"); if (!evid) throw new Error("Mudança na calibração exige a evidência que a sustenta.");
    if (r.employeeId === s.employeeId) throw new Error("Conflito de interesse: ninguém calibra a própria avaliação."); await trava(rid, int(fd, "versao"));
    const atuais = (r.notasCriterios as Notas | null) ?? {}; const novas = lerNotas(fd, criterios, "n_", atuais); for (const k of Object.keys(novas)) if (atuais[k]?.na && atuais[k].naAprovado && novas[k].na) novas[k].naAprovado = true;
    const mem = await calcularRevisao(r, c, novas); if (!mem.publicavel) throw new Error(`Calibração deixaria a avaliação incompleta: ${mem.motivos.join(" ")}`);
    await db.update(schema.perfReviews).set({ notasOriginais: r.notasOriginais ?? atuais, notasCriterios: novas, calc: { ...mem, calibracao: { por: s.nome, em: new Date().toISOString(), justificativa: just, evidencia: evid } }, estado: "EM_CALIBRACAO", calibradoPor: s.id, calibracaoJustificativa: just, calibracaoEvidencia: evid, versao: r.versao + 1, updatedAt: new Date() }).where(eq(schema.perfReviews.id, rid));
    await audit(s, "calibrar avaliação", "perf_reviews", rid, { N: (r.calc as { N?: number } | null)?.N, R: (r.calc as { R?: number } | null)?.R, A: (r.calc as { A?: number } | null)?.A }, { N: mem.N, R: mem.R, A: mem.A, justificativa: just, evidencia: evid, conflito: s.id === r.avaliadorUserId ? "calibrador é o avaliador original" : null });
  } catch (e) { redirect(go(voltar, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(voltar, "ok", "Calibração registrada com as notas originais preservadas."));
}
export async function publicarAvaliacao(fd: FormData) {
  const s = await requireSession(); const rid = Number(fd.get("id")); const voltar = `/desempenho/avaliacoes/${rid}`;
  try { const cfg = await getSettings(); if (!can.aprovar(s, "calibracao")) throw new Error("Publicar exige: " + (await quemAprovaTexto("calibracao"))); const { r, c, criterios } = await carregar(rid); if (!["ENVIADA", "EM_CALIBRACAO"].includes(r.estado)) throw new Error("Só avaliações enviadas ou calibradas podem ser publicadas."); if (!["CALIBRACAO", "FEEDBACK", "AVALIACAO"].includes(c.fase)) throw new Error("Publique na fase de calibração ou feedback.");
    if (r.employeeId === s.employeeId) throw new Error("Conflito de interesse: ninguém publica a própria avaliação."); const mem = await calcularRevisao(r, c); if (!mem.publicavel) throw new Error(`Não publicável: ${mem.motivos.join(" ")}`);
    await db.update(schema.perfReviews).set({ calc: { ...((r.calc as object | null) ?? {}), ...mem, publicadaEm: new Date().toISOString(), modelVersao: c.modelVersao }, estado: "PUBLICADA", status: "CONCLUIDA", aprovadoPor: s.id, notaFinal: mem.N === null ? null : mem.N.toFixed(2), desempenhoNivel: mem.N === null ? null : mem.N >= ((c.faixas as { final?: number[] } | null)?.final?.[1] ?? 4) ? 3 : mem.N >= ((c.faixas as { final?: number[] } | null)?.final?.[0] ?? 3) ? 2 : 1, publicadaEm: new Date(), versao: r.versao + 1, updatedAt: new Date() }).where(eq(schema.perfReviews.id, rid));
    await audit(s, "publicar avaliação", "perf_reviews", rid, null, { N: mem.N }); const [u] = await sql<{ id: number }[]>`SELECT id FROM users WHERE employee_id=${r.employeeId} AND ativo`; if (u) await notificar([u.id], "Sua avaliação foi publicada", "Veja o resultado, registre ciência e, se quiser, comente.", `/colaboradores/${r.employeeId}/painel?aba=avaliacoes`, "INFO", `pub:${rid}`);
    if (r.avaliadorUserId) await notificar([r.avaliadorUserId], "Avaliação publicada — agende o feedback", null, `/colaboradores/${r.employeeId}/painel?aba=feedbacks`, "ACAO", `fbk:${rid}`);
  } catch (e) { redirect(go(voltar, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(voltar, "ok", "Avaliação publicada. Colaborador e avaliador notificados."));
}
export async function cienciaAvaliacao(fd: FormData) {
  const s = await requireSession(); const rid = Number(fd.get("id")); const voltar = str(fd, "voltar") || `/colaboradores/${s.employeeId}/painel?aba=avaliacoes`;
  try { const { r } = await carregar(rid); assert(r.employeeId === s.employeeId, "Só o avaliado registra ciência."); if (!["PUBLICADA", "CONTESTADA"].includes(r.estado)) throw new Error("A avaliação ainda não foi publicada.");
    const contestar = str(fd, "contestar") === "1"; const texto = strOrNull(fd, "texto");
    await db.update(schema.perfReviews).set({ cienciaEm: r.cienciaEm ?? new Date(), comentarioColaborador: contestar ? r.comentarioColaborador : (texto ?? r.comentarioColaborador), ...(contestar ? { contestacao: texto, contestacaoEm: new Date(), estado: "CONTESTADA" } : {}), versao: r.versao + 1, updatedAt: new Date() }).where(eq(schema.perfReviews.id, rid));
    await audit(s, contestar ? "contestar avaliação" : "ciência da avaliação", "perf_reviews", rid, null, { texto: texto ? "(registrado)" : null });
    if (contestar) await notificar([r.avaliadorUserId ?? 0, ...await usuariosPorPerfil(RH)], "Contestação de avaliação recebida", null, `/desempenho/avaliacoes/${rid}`, "ALERTA", `cont:${rid}`);
  } catch (e) { redirect(go(voltar, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(voltar, "ok", "Registrado. Ciência não significa concordância."));
}
export async function responderContestacao(fd: FormData) {
  const s = await requireSession(); const rid = Number(fd.get("id")); const voltar = `/desempenho/avaliacoes/${rid}`;
  try { assert(RH.includes(s.role) || can.aprovar(s, "calibracao")); const { r } = await carregar(rid); const resp = str(fd, "resposta"); if (!resp) throw new Error("Escreva a resposta."); await db.update(schema.perfReviews).set({ respostaContestacao: resp, versao: r.versao + 1, updatedAt: new Date() }).where(eq(schema.perfReviews.id, rid)); await audit(s, "responder contestação", "perf_reviews", rid, null, null);
    const [u] = await sql<{ id: number }[]>`SELECT id FROM users WHERE employee_id=${r.employeeId} AND ativo`; if (u) await notificar([u.id], "Sua contestação foi respondida", null, `/colaboradores/${r.employeeId}/painel?aba=avaliacoes`, "INFO", `resp:${rid}`);
  } catch (e) { redirect(go(voltar, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(voltar, "ok", "Resposta registrada; a avaliação publicada permanece como versão oficial."));
}
export async function adicionarEvidencia(fd: FormData) {
  const s = await requireSession(); const rid = Number(fd.get("reviewId")); const voltar = str(fd, "voltar") || `/desempenho/avaliacoes/${rid}`;
  try { const { r } = await carregar(rid); assert(podeAvaliar(s, r) || r.employeeId === s.employeeId, "Sem permissão para anexar evidência."); const titulo = str(fd, "titulo"); if (!titulo) throw new Error("Dê um título à evidência.");
    await db.insert(schema.evalEvidences).values({ reviewId: rid, criterioId: strOrNull(fd, "criterioId"), tipo: str(fd, "url") ? "LINK" : "TEXTO", titulo, texto: strOrNull(fd, "texto"), url: strOrNull(fd, "url"), userId: s.id, userNome: s.nome }); await audit(s, "evidência de avaliação", "perf_reviews", rid, null, { titulo });
  } catch (e) { redirect(go(voltar, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(voltar, "ok", "Evidência registrada."));
}

// ---------- Feedback ----------
export async function registrarFeedback(fd: FormData) {
  const s = await requireSession(); const employeeId = Number(fd.get("employeeId")); const voltar = str(fd, "voltar") || `/colaboradores/${employeeId}/painel?aba=feedbacks`;
  try { assert(GESTOR.includes(s.role), "Feedback estruturado é registrado por gestores e RH."); await acessoColaborador(s, employeeId);
    const situacao = str(fd, "situacao"), comportamento = str(fd, "comportamento"); if (!situacao || !comportamento) throw new Error("Situação e comportamento/entrega são obrigatórios.");
    const [f] = await db.insert(schema.feedbacks).values({ employeeId, cycleId: int(fd, "cycleId"), reviewId: int(fd, "reviewId"), tipo: str(fd, "tipo") || "DESENVOLVIMENTO", data: str(fd, "data") || hoje(), situacao, comportamento, impacto: strOrNull(fd, "impacto"), evidencia: strOrNull(fd, "evidencia"), acordo: strOrNull(fd, "acordo"), autorUserId: s.id, autorNome: s.nome }).returning({ id: schema.feedbacks.id });
    await audit(s, "feedback estruturado", "feedbacks", f.id, null, { employeeId, tipo: str(fd, "tipo") }); const [u] = await sql<{ id: number }[]>`SELECT id FROM users WHERE employee_id=${employeeId} AND ativo`; if (u) await notificar([u.id], "Você recebeu um feedback", null, `/colaboradores/${employeeId}/painel?aba=feedbacks`, "INFO", `fb:${f.id}`);
  } catch (e) { redirect(go(voltar, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(voltar, "ok", "Feedback registrado."));
}
export async function cienciaFeedback(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const voltar = str(fd, "voltar") || `/colaboradores/${s.employeeId}/painel?aba=feedbacks`;
  try { const [f] = await db.select().from(schema.feedbacks).where(eq(schema.feedbacks.id, id)); if (!f || f.employeeId !== s.employeeId) throw new Error("Feedback não encontrado."); await db.update(schema.feedbacks).set({ cienciaEm: f.cienciaEm ?? new Date(), comentarioColaborador: strOrNull(fd, "comentario") ?? f.comentarioColaborador }).where(eq(schema.feedbacks.id, id)); await audit(s, "ciência de feedback", "feedbacks", id, null, null); }
  catch (e) { redirect(go(voltar, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(voltar, "ok", "Ciência registrada."));
}

// ---------- PDI acionável ----------
export async function criarPdi(fd: FormData) {
  const s = await requireSession(); const employeeId = Number(fd.get("employeeId")); const voltar = str(fd, "voltar") || `/colaboradores/${employeeId}/painel?aba=pdi`; let msg = "";
  try { const { proprio } = await acessoColaborador(s, employeeId, true); const gestao = !proprio;
    const tipo = str(fd, "tipo") === "MELHORIA_FORMAL" ? "MELHORIA_FORMAL" : "CRESCIMENTO"; const natureza = str(fd, "natureza") === "FORTALEZA" ? "FORTALEZA" : "LACUNA";
    const competencia = str(fd, "competencia"), objetivo = str(fd, "objetivo"); if (!competencia || !objetivo) throw new Error("Informe a competência (ou ponto forte) e o objetivo.");
    if (tipo === "MELHORIA_FORMAL") { assert(gestao && ["DIRECAO", "RH", "DIRETOR_UNIDADE"].includes(s.role), "Plano formal de melhoria é aberto por RH, Direção ou diretor da unidade — fluxo próprio, separado do PDI de crescimento."); if (!strOrNull(fd, "expectativas") || !strOrNull(fd, "prazoFinal") || !str(fd, "acaoDescricao") || !strOrNull(fd, "acaoApoio")) throw new Error("Plano formal exige expectativas claras, prazo final e a primeira ação com o apoio oferecido."); }
    if (tipo === "CRESCIMENTO" && natureza === "LACUNA") { const max = (await getSettings()).desempenho.maxPrioridadesAtivas; const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM pdi_plans WHERE employee_id=${employeeId} AND status='ATIVO' AND tipo='CRESCIMENTO' AND natureza='LACUNA'`; if (n >= max) throw new Error(`Limite de ${max} prioridades de desenvolvimento ativas (configurável). Conclua ou reavalie uma antes de abrir outra.`); }
    let evidencia = strOrNull(fd, "evidencia"); const criterioId = strOrNull(fd, "criterioId"), reviewId = int(fd, "reviewId");
    if (!evidencia && criterioId && reviewId) { const [r] = await db.select({ notas: schema.perfReviews.notasCriterios, emp: schema.perfReviews.employeeId }).from(schema.perfReviews).where(eq(schema.perfReviews.id, reviewId)); if (r?.emp === employeeId) evidencia = ((r.notas as Notas | null) ?? {})[criterioId]?.evidencia ?? null; }
    const [p] = await db.insert(schema.pdiPlans).values({ employeeId, cycleId: int(fd, "cycleId"), reviewId, criterioId, competencia, evidencia, objetivo, situacaoInicial: strOrNull(fd, "situacaoInicial"), meta: strOrNull(fd, "meta"), indicador: strOrNull(fd, "indicador"), tipo, natureza, compartilhar: str(fd, "compartilhar") === "1", expectativas: strOrNull(fd, "expectativas"), prazoFinal: strOrNull(fd, "prazoFinal"), createdBy: s.id, ...(gestao ? { validadoPor: s.id, validadoEm: new Date() } : {}) }).returning({ id: schema.pdiPlans.id });
    const desc = str(fd, "acaoDescricao"); if (desc) await db.insert(schema.pdiActions).values({ planId: p.id, tipo: str(fd, "acaoTipo") || "TREINAMENTO_INTERNO", descricao: desc, responsavelUserId: int(fd, "acaoResponsavel") ?? s.id, apoio: strOrNull(fd, "acaoApoio"), prazo: strOrNull(fd, "acaoPrazo"), exigeEvidencia: str(fd, "acaoExigeEvidencia") !== "0", compromissoColaborador: strOrNull(fd, "compromissoColaborador"), compromissoGestor: strOrNull(fd, "compromissoGestor"), recursos: strOrNull(fd, "recursos"), tempoPrevisto: strOrNull(fd, "tempoPrevisto"), formaAcompanhamento: strOrNull(fd, "formaAcompanhamento") });
    await audit(s, tipo === "MELHORIA_FORMAL" ? "abrir plano formal de melhoria" : "criar PDI", "pdi_plans", p.id, null, { employeeId, competencia, natureza, tipo });
    if (tipo === "MELHORIA_FORMAL") { const [u] = await sql<{ id: number }[]>`SELECT id FROM users WHERE employee_id=${employeeId} AND ativo`; if (u) await notificar([u.id], "Plano formal de melhoria aberto", "Veja as expectativas, o apoio e os prazos; você pode se manifestar.", `/colaboradores/${employeeId}/painel?aba=pdi`, "ACAO", `pfm-open:${p.id}`); }
    msg = gestao ? (tipo === "MELHORIA_FORMAL" ? "Plano formal de melhoria aberto; o colaborador pode se manifestar." : "PDI criado e validado.") : "PDI proposto — aguarda validação do gestor.";
  } catch (e) { redirect(go(voltar, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(voltar, "ok", msg));
}
export async function validarPdi(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const voltar = str(fd, "voltar") || "/desempenho";
  try { const [p] = await db.select().from(schema.pdiPlans).where(eq(schema.pdiPlans.id, id)); if (!p) throw new Error("PDI não encontrado."); await acessoColaborador(s, p.employeeId); await db.update(schema.pdiPlans).set({ validadoPor: s.id, validadoEm: new Date(), status: str(fd, "status") || p.status }).where(eq(schema.pdiPlans.id, id)); await audit(s, "validar PDI", "pdi_plans", id, null, null); }
  catch (e) { redirect(go(voltar, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(voltar, "ok", "PDI validado."));
}
export async function salvarAcaoPdi(fd: FormData) {
  const s = await requireSession(); const planId = Number(fd.get("planId")); const id = int(fd, "id"); const voltar = str(fd, "voltar") || "/desempenho";
  try { const [p] = await db.select().from(schema.pdiPlans).where(eq(schema.pdiPlans.id, planId)); if (!p) throw new Error("PDI não encontrado."); await acessoColaborador(s, p.employeeId, true); const desc = str(fd, "descricao"); if (!desc && !id) throw new Error("Descreva a ação.");
    const d = { tipo: str(fd, "tipo") || "TREINAMENTO_INTERNO", descricao: desc || undefined, responsavelUserId: int(fd, "responsavelUserId") ?? s.id, apoio: strOrNull(fd, "apoio"), prazo: strOrNull(fd, "prazo"), exigeEvidencia: str(fd, "exigeEvidencia") !== "0", courseId: int(fd, "courseId"), compromissoColaborador: strOrNull(fd, "compromissoColaborador"), compromissoGestor: strOrNull(fd, "compromissoGestor"), recursos: strOrNull(fd, "recursos"), tempoPrevisto: strOrNull(fd, "tempoPrevisto"), formaAcompanhamento: strOrNull(fd, "formaAcompanhamento") };
    if (id) await db.update(schema.pdiActions).set(d).where(eq(schema.pdiActions.id, id)); else await db.insert(schema.pdiActions).values({ planId, ...d, descricao: desc });
    await audit(s, id ? "editar ação de PDI" : "criar ação de PDI", "pdi_actions", id, null, { planId, tipo: d.tipo });
  } catch (e) { redirect(go(voltar, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(voltar, "ok", "Ação salva."));
}
/** Transições de estado da ação: iniciar → concluir (com evidência, se exigida → aguarda validação) → validar; cancelar com justificativa. */
/** Estados da ação. Espera por apoio institucional, oportunidade ou observação não conta como atraso do colaborador. */
export async function moverAcaoPdi(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const para = str(fd, "para"); const voltar = str(fd, "voltar") || "/desempenho"; let msg = "";
  try { const [a] = await db.select().from(schema.pdiActions).where(eq(schema.pdiActions.id, id)); if (!a) throw new Error("Ação não encontrada."); const [p] = await db.select().from(schema.pdiPlans).where(eq(schema.pdiPlans.id, a.planId)); if (!p) throw new Error("PDI não encontrado.");
    let gestor = false; if (a.responsavelUserId === s.id && s.employeeId !== p.employeeId) gestor = GESTOR.includes(s.role); else { const r = await acessoColaborador(s, p.employeeId, true); gestor = !r.proprio; }
    const upd: Partial<typeof schema.pdiActions.$inferInsert> = {}; const emExec = ["NAO_INICIADA", "EM_ANDAMENTO"]; const espera = ["AGUARDANDO_APOIO", "AGUARDANDO_OPORTUNIDADE", "AGUARDANDO_OBSERVACAO"];
    const gestorUser = async () => { const [g] = await sql<{ id: number }[]>`SELECT u.id FROM employees e JOIN users u ON u.employee_id=e.gestor_id AND u.ativo WHERE e.id=${p.employeeId} LIMIT 1`; return g?.id ?? 0; };
    switch (para) {
      case "EM_ANDAMENTO": if (a.status !== "NAO_INICIADA") throw new Error("Só ações não iniciadas podem ser iniciadas."); upd.status = "EM_ANDAMENTO"; msg = "Ação iniciada."; break;
      case "AGUARDANDO_APOIO": { if (!emExec.includes(a.status)) throw new Error("Ação não está em execução."); const b = str(fd, "bloqueio"); if (!b) throw new Error("Descreva o apoio institucional que falta."); upd.status = para; upd.bloqueio = b; upd.bloqueioDesde = hoje(); msg = "Ação aguardando apoio institucional — não conta como atraso do colaborador. Gestão notificada."; await notificar([await gestorUser(), ...await usuariosPorPerfil(["RH"])], "Ação de PDI bloqueada por falta de apoio institucional", b, `/colaboradores/${p.employeeId}/painel?aba=pdi`, "ACAO", `pdib:${id}`); break; }
      case "AGUARDANDO_OPORTUNIDADE": case "AGUARDANDO_OBSERVACAO": if (!emExec.includes(a.status)) throw new Error("Ação não está em execução."); upd.status = para; upd.bloqueio = strOrNull(fd, "bloqueio"); upd.bloqueioDesde = hoje(); msg = para === "AGUARDANDO_OBSERVACAO" ? "Aguardando observação da prática pelo gestor." : "Aguardando oportunidade de aplicação."; if (para === "AGUARDANDO_OBSERVACAO") await notificar([await gestorUser()], "Ação de PDI aguardando sua observação", a.descricao, `/colaboradores/${p.employeeId}/painel?aba=pdi`, "ACAO", `pdio:${id}`); break;
      case "RETOMAR": if (!espera.includes(a.status)) throw new Error("A ação não está em espera."); upd.status = "EM_ANDAMENTO"; upd.bloqueio = null; msg = "Ação retomada (a espera fica registrada na auditoria)."; break;
      case "CONCLUIR": { if (![...emExec, "AGUARDANDO_OBSERVACAO"].includes(a.status)) throw new Error("Ação não está em execução."); const ev = strOrNull(fd, "evidencia"); if (a.exigeEvidencia && !ev) throw new Error("Esta ação exige evidência de conclusão."); upd.evidencia = ev ?? a.evidencia;
        if (a.exigeEvidencia) { upd.status = "AGUARDANDO_VALIDACAO"; msg = "Conclusão registrada — aguarda validação do gestor."; await notificar([p.validadoPor ?? await gestorUser()], "Ação de PDI aguardando validação", a.descricao, `/colaboradores/${p.employeeId}/painel?aba=pdi`, "ACAO", `pdiv:${id}`); } else { upd.status = "CONCLUIDA"; upd.concluidaEm = hoje(); msg = "Ação concluída."; } break; }
      case "VALIDAR": assert(gestor, "Só a gestão valida."); if (a.status !== "AGUARDANDO_VALIDACAO") throw new Error("Ação não está aguardando validação."); upd.status = "CONCLUIDA"; upd.concluidaEm = hoje(); upd.validadaPor = s.id; upd.validadaEm = new Date(); msg = "Ação validada. Concluir a ação não comprova, por si, evolução da competência."; break;
      case "DEVOLVER": assert(gestor, "Só a gestão devolve."); if (a.status !== "AGUARDANDO_VALIDACAO") throw new Error("Ação não está aguardando validação."); upd.status = "EM_ANDAMENTO"; msg = "Ação devolvida para complementar a evidência."; break;
      case "CANCELAR": { assert(gestor, "Só a gestão cancela ações."); const j = str(fd, "justificativa"); if (!j) throw new Error("Cancelar exige justificativa."); upd.status = "CANCELADA"; upd.cancelJustificativa = j; msg = "Ação cancelada (fora do cálculo de execução; histórico preservado)."; break; }
      default: throw new Error("Transição inválida.");
    }
    await db.update(schema.pdiActions).set(upd).where(eq(schema.pdiActions.id, id)); await audit(s, "ação de PDI", "pdi_actions", id, { status: a.status }, { status: upd.status, bloqueio: upd.bloqueio ?? null });
  } catch (e) { redirect(go(voltar, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(voltar, "ok", msg));
}
export async function checkinPdi(fd: FormData) {
  const s = await requireSession(); const actionId = Number(fd.get("actionId")); const voltar = str(fd, "voltar") || "/desempenho";
  try { const [a] = await db.select().from(schema.pdiActions).where(eq(schema.pdiActions.id, actionId)); if (!a) throw new Error("Ação não encontrada."); const [p] = await db.select().from(schema.pdiPlans).where(eq(schema.pdiPlans.id, a.planId)); assert(GESTOR.includes(s.role) || s.employeeId === p?.employeeId || a.responsavelUserId === s.id, "Sem permissão.");
    const novoPrazo = strOrNull(fd, "novoPrazo"); await db.insert(schema.pdiCheckins).values({ actionId, data: str(fd, "data") || hoje(), texto: strOrNull(fd, "texto"), obstaculo: strOrNull(fd, "obstaculo"), novoPrazo, userId: s.id, userNome: s.nome });
    if (novoPrazo) { assert(GESTOR.includes(s.role), "Só gestores revisam prazos."); await db.update(schema.pdiActions).set({ prazo: novoPrazo }).where(eq(schema.pdiActions.id, actionId)); } await audit(s, "check-in de PDI", "pdi_actions", actionId, null, { novoPrazo });
  } catch (e) { redirect(go(voltar, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(voltar, "ok", "Check-in registrado."));
}

// ---------- Perfil comportamental (instrumento identificado) ----------
export async function registrarPerfil(fd: FormData) {
  const s = await requireSession(); const employeeId = Number(fd.get("employeeId")); const voltar = `/colaboradores/${employeeId}/painel`;
  try { assert(RH.includes(s.role), "Perfis comportamentais são registrados pelo RH."); const instrumento = str(fd, "instrumento"), data = str(fd, "data"); if (!instrumento || !data) throw new Error("Informe o instrumento e a data.");
    const v = (k: string) => { const x = num(fd, k); return x === null ? null : String(x); };
    const [p] = await db.insert(schema.behaviorProfiles).values({ employeeId, instrumento, fornecedor: strOrNull(fd, "fornecedor"), versao: strOrNull(fd, "versao"), data, responsavelUserId: s.id, escala: strOrNull(fd, "escala"), d: v("d"), i: v("i"), s: v("s"), c: v("c"), relatorioUrl: strOrNull(fd, "relatorioUrl"), limitacoes: strOrNull(fd, "limitacoes") ?? "Uso restrito a conversas de comunicação e desenvolvimento. Não é nota de desempenho, diagnóstico ou critério de decisão de emprego.", obs: strOrNull(fd, "obs") }).returning({ id: schema.behaviorProfiles.id });
    await audit(s, "registrar perfil comportamental", "behavior_profiles", p.id, null, { employeeId, instrumento });
  } catch (e) { redirect(go(voltar, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(voltar, "ok", "Perfil comportamental registrado."));
}

/** Encerramento administrativo sem nota: evidências insuficientes. Exige aprovação (alçada de calibração) e justificativa; não gera nota final. */
export async function encerrarInconclusiva(fd: FormData) {
  const s = await requireSession(); const rid = Number(fd.get("id")); const voltar = `/desempenho/avaliacoes/${rid}`;
  try { const cfg = await getSettings(); if (!can.aprovar(s, "calibracao")) throw new Error("Encerrar como inconclusiva exige: " + (await quemAprovaTexto("calibracao"))); const { r, c } = await carregar(rid); if (r.employeeId === s.employeeId) throw new Error("Conflito de interesse.");
    if (["PUBLICADA", "CONTESTADA", "INCONCLUSIVA"].includes(r.estado)) throw new Error("Avaliação já encerrada."); const just = str(fd, "justificativa"); if (!just) throw new Error("Justifique o encerramento como inconclusiva.");
    const mem = await calcularRevisao(r, c); if (mem.publicavel) throw new Error("Há base suficiente para concluir: publique ou calibre em vez de encerrar como inconclusiva.");
    await db.update(schema.perfReviews).set({ estado: "INCONCLUSIVA", status: "CONCLUIDA", calc: { ...mem, N: null, inconclusiva: true }, notaFinal: null, inconclusivaJustificativa: just, inconclusivaAprovadaPor: s.id, versao: r.versao + 1, updatedAt: new Date() }).where(eq(schema.perfReviews.id, rid));
    await audit(s, "encerrar avaliação como inconclusiva", "perf_reviews", rid, null, { justificativa: just, motivos: mem.motivos });
    const [u] = await sql<{ id: number }[]>`SELECT id FROM users WHERE employee_id=${r.employeeId} AND ativo`; if (u) await notificar([u.id], "Avaliação do ciclo encerrada sem conclusão", "Não houve evidências suficientes para concluir — isso não é um resultado negativo.", `/colaboradores/${r.employeeId}/painel?aba=avaliacoes`, "INFO", `inc:${rid}`);
  } catch (e) { redirect(go(voltar, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(voltar, "ok", "Avaliação encerrada como inconclusiva, sem nota final."));
}
