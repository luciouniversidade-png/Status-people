"use server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireSession, can, assert, scopeUnit } from "@/lib/auth";
import { audit, str, strOrNull, int, num, hoje, getSettings } from "@/lib/utils";
import { notificar, usuariosPorPerfil } from "@/lib/comunicacao";
import { acessoColaborador, perfilVigente, GESTAO_ROLES, RH_ROLES } from "@/lib/desenvolvimento";
import { validarConversao, interpretarMeta, NATUREZA_EVID, HIPOTESE, ENCAMINHAMENTO, TIPO_META, DIRECAO_META, APLICACAO_STATUS, RESULTADO_STATUS, type Criterio } from "@/lib/avaliacao";
import { montarPromptIA, validarRespostaIA, chamarIA, CONFIG_IA_VERSAO, TAREFAS_IA, type FonteIA } from "@/lib/ia-desempenho";
import { slaOs } from "@/lib/operacoes";
import { comMensagem } from "@/lib/redirecionar";

const go = (b: string, k: "ok" | "erro", m: string) => comMensagem(b, k, m);
const erro = (e: unknown) => e instanceof Error ? e.message : "Erro";
const linhas = (fd: FormData, k: string) => str(fd, k).split(/\r?\n/).map(x => x.trim()).filter(Boolean);
async function faseCiclo(cycleId: number | null) { if (!cycleId) return null; const [c] = await db.select({ fase: schema.perfCycles.fase }).from(schema.perfCycles).where(eq(schema.perfCycles.id, cycleId)); return c?.fase ?? null; }
async function userDoColaborador(employeeId: number) { const [u] = await sql<{ id: number }[]>`SELECT id FROM users WHERE employee_id=${employeeId} AND ativo LIMIT 1`; return u?.id ?? null; }
async function userDoGestor(employeeId: number) { const [u] = await sql<{ id: number }[]>`SELECT u.id FROM employees e JOIN users u ON u.employee_id=e.gestor_id AND u.ativo WHERE e.id=${employeeId} LIMIT 1`; return u?.id ?? null; }

// ======================= Perfil de expectativas por cargo =======================
export async function salvarExpectativas(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id"); let pid = id ?? 0;
  try { assert(RH_ROLES.includes(s.role), "Perfis de expectativas são mantidos por RH/Direção."); const titulo = str(fd, "titulo"); if (!titulo) throw new Error("Dê um título ao perfil.");
    const competencias = linhas(fd, "competencias").map(l => { const [nome, nivel, descricao] = l.split("|").map(x => x.trim()); const n = Number(nivel); if (!nome || !Number.isInteger(n) || n < 1 || n > 5) throw new Error(`Competência inválida: “${l}”. Formato: Nome | nível requerido 1–5 | descrição`); return { nome, nivel: n, descricao: descricao || null }; });
    const d = { titulo, positionId: int(fd, "positionId"), familia: strOrNull(fd, "familia"), nivel: strOrNull(fd, "nivel"), finalidade: strOrNull(fd, "finalidade"), responsabilidades: linhas(fd, "responsabilidades"), entregas: linhas(fd, "entregas"), competencias, comportamentos: linhas(fd, "comportamentos"), evidencias: linhas(fd, "evidencias"), condicoes: linhas(fd, "condicoes"), vigenciaInicio: strOrNull(fd, "vigenciaInicio"), vigenciaFim: strOrNull(fd, "vigenciaFim") };
    if (!d.positionId && !d.familia) throw new Error("Vincule o perfil a um cargo ou a uma família de cargos.");
    if (id) { const [p] = await db.select().from(schema.roleProfiles).where(eq(schema.roleProfiles.id, id)); if (!p) throw new Error("Perfil não encontrado."); if (p.status !== "RASCUNHO") throw new Error("Perfil vigente ou arquivado não é editado: crie uma nova versão."); await db.update(schema.roleProfiles).set(d).where(eq(schema.roleProfiles.id, id)); }
    else { const [p] = await db.insert(schema.roleProfiles).values({ ...d, createdBy: s.id }).returning({ id: schema.roleProfiles.id }); pid = p.id; }
    await audit(s, id ? "editar perfil de expectativas" : "criar perfil de expectativas", "role_profiles", pid, null, { titulo });
  } catch (e) { redirect(go(id ? `/desempenho/expectativas/${id}` : "/desempenho/expectativas", "erro", erro(e))); }
  redirect(go(`/desempenho/expectativas/${pid}`, "ok", "Perfil salvo."));
}
export async function publicarExpectativas(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const b = `/desempenho/expectativas/${id}`; let n = 0;
  try { assert(RH_ROLES.includes(s.role), "Publicar perfis é do RH/Direção."); const [p] = await db.select().from(schema.roleProfiles).where(eq(schema.roleProfiles.id, id)); if (!p) throw new Error("Perfil não encontrado."); if (p.status !== "RASCUNHO") throw new Error("Só rascunhos são publicados.");
    await sql`UPDATE role_profiles SET status='ARQUIVADO', vigencia_fim=COALESCE(vigencia_fim, ${hoje()}) WHERE status='VIGENTE' AND id<>${id} AND COALESCE(position_id,0)=${p.positionId ?? 0} AND COALESCE(familia,'')=${p.familia ?? ""} AND COALESCE(nivel,'')=${p.nivel ?? ""}`;
    await db.update(schema.roleProfiles).set({ status: "VIGENTE", vigenciaInicio: p.vigenciaInicio ?? hoje() }).where(eq(schema.roleProfiles.id, id));
    const alvo = await sql<{ id: number }[]>`SELECT u.id FROM users u JOIN employees e ON e.id=u.employee_id JOIN positions ps ON ps.id=e.position_id WHERE u.ativo AND e.situacao='ATIVO' AND (ps.id=${p.positionId ?? 0} OR (${p.positionId === null} AND ps.familia=${p.familia ?? ""}))`;
    await notificar(alvo.map(x => x.id), "Expectativas do seu cargo foram publicadas", "Leia e registre ciência no seu painel.", "/meu-painel?aba=expectativas", "ACAO", `exp:${id}`); n = alvo.length;
    await audit(s, "publicar perfil de expectativas", "role_profiles", id, null, { versao: p.versao, notificados: n });
  } catch (e) { redirect(go(b, "erro", erro(e))); }
  redirect(go(b, "ok", `Perfil publicado como vigente; a versão anterior foi arquivada. ${n} colaborador(es) notificado(s).`));
}
export async function novaVersaoExpectativas(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); let novo = 0;
  try { assert(RH_ROLES.includes(s.role)); const [p] = await db.select().from(schema.roleProfiles).where(eq(schema.roleProfiles.id, id)); if (!p) throw new Error("Perfil não encontrado.");
    const { id: _i, createdAt: _c, status: _s, vigenciaInicio: _v, vigenciaFim: _f, versao, ...resto } = p; void _i; void _c; void _s; void _v; void _f;
    const [n] = await db.insert(schema.roleProfiles).values({ ...resto, versao: versao + 1, status: "RASCUNHO", createdBy: s.id }).returning({ id: schema.roleProfiles.id }); novo = n.id; await audit(s, "nova versão de perfil de expectativas", "role_profiles", novo, { versao }, { versao: versao + 1 });
  } catch (e) { redirect(go(`/desempenho/expectativas/${id}`, "erro", erro(e))); }
  redirect(go(`/desempenho/expectativas/${novo}`, "ok", "Nova versão criada como rascunho. A vigente continua valendo até você publicar esta."));
}
export async function cienciaExpectativas(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("profileId")); const voltar = str(fd, "voltar") || "/meu-painel?aba=expectativas";
  try { if (!s.employeeId) throw new Error("Seu usuário não está vinculado a um colaborador."); const [e] = await db.select().from(schema.employees).where(eq(schema.employees.id, s.employeeId)); const p = await perfilVigente(e?.positionId ?? null); if (!p || p.id !== id) throw new Error("Este não é o perfil vigente do seu cargo.");
    await sql`INSERT INTO role_profile_acks (profile_id, employee_id, comentario) VALUES (${id}, ${s.employeeId}, ${strOrNull(fd, "comentario")}) ON CONFLICT (profile_id, employee_id) DO NOTHING`; await audit(s, "ciência das expectativas do cargo", "role_profiles", id, null, null);
  } catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Ciência registrada. Ciência não é concordância: seu comentário fica registrado."));
}

// ======================= Metas com regra explícita =======================
function lerMeta(fd: FormData) {
  const tipo = str(fd, "tipo") || "OPERACIONAL", direcao = str(fd, "direcao") || "MAIOR_MELHOR"; if (!TIPO_META[tipo] || !DIRECAO_META[direcao]) throw new Error("Tipo ou regra de leitura inválidos.");
  const n = (k: string) => { const v = num(fd, k); return v === null ? null : String(v); };
  const d = { titulo: str(fd, "titulo"), tipo, direcao, indicador: strOrNull(fd, "indicador"), unidadeMedida: strOrNull(fd, "unidadeMedida"), linhaBase: n("linhaBase"), esperado: n("esperado"), faixaMin: n("faixaMin"), faixaMax: n("faixaMax"), prazo: strOrNull(fd, "prazo"), fonte: strOrNull(fd, "fonte"), responsavelUserId: int(fd, "responsavelUserId"), dependencias: strOrNull(fd, "dependencias"), periodicidade: strOrNull(fd, "periodicidade"), regraInterpretacao: strOrNull(fd, "regraInterpretacao"), participaAvaliacao: str(fd, "participaAvaliacao") === "1", criterioId: strOrNull(fd, "criterioId"), contribuicao: strOrNull(fd, "contribuicao"), peso: int(fd, "peso") ?? 1 };
  if (!d.titulo) throw new Error("Informe a meta."); if (!d.regraInterpretacao) throw new Error("Descreva a regra de interpretação (como o resultado será lido).");
  // v30 · vínculo opcional com a estratégia (objetivo ou resultado-chave)
  const cp = str(fd, "contribuiPara"); const okr = /^([ok]):(\d+)$/.exec(cp); Object.assign(d, { objectiveId: okr?.[1] === "o" ? Number(okr[2]) : null, keyResultId: okr?.[1] === "k" ? Number(okr[2]) : null });
  if (direcao === "FAIXA" && (d.faixaMin === null || d.faixaMax === null || Number(d.faixaMin) > Number(d.faixaMax))) throw new Error("Faixa desejável: informe mínimo ≤ máximo.");
  if ((direcao === "MAIOR_MELHOR" || direcao === "MENOR_MELHOR") && d.esperado === null) throw new Error("Informe o resultado esperado.");
  if (tipo === "COLETIVA" && !d.contribuicao) throw new Error("Meta coletiva: registre a contribuição individual esperada.");
  const marcos = direcao === "MARCOS" ? linhas(fd, "marcos") : []; if (direcao === "MARCOS" && !marcos.length) throw new Error("Liste os marcos, um por linha.");
  return { d, marcos };
}
const textoLegado = (d: ReturnType<typeof lerMeta>["d"], nMarcos: number) => d.direcao === "FAIXA" ? `${d.faixaMin} a ${d.faixaMax}` : d.direcao === "BINARIO" ? "sim/não" : d.direcao === "MARCOS" ? `${nMarcos} marco(s)` : `${d.esperado}${d.unidadeMedida ? " " + d.unidadeMedida : ""}`;
export async function salvarMeta(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id"); const employeeId = Number(fd.get("employeeId")); const cycleId = Number(fd.get("cycleId")); const voltar = str(fd, "voltar") || `/colaboradores/${employeeId}/painel?aba=metas`;
  try { await acessoColaborador(s, employeeId); const { d, marcos } = lerMeta(fd); const f = await faseCiclo(cycleId); if (!f) throw new Error("Ciclo não encontrado."); if (["CONCLUSAO", "ARQUIVADO"].includes(f)) throw new Error("Ciclo encerrado: metas não mudam.");
    if (id) { const [g] = await db.select().from(schema.perfGoals).where(eq(schema.perfGoals.id, id)); if (!g || g.employeeId !== employeeId) throw new Error("Meta não encontrada.");
      const andamento = f !== "PLANEJAMENTO"; const just = strOrNull(fd, "justificativa"); if (andamento && !just) throw new Error("Alterar meta com o ciclo em andamento exige justificativa (a meta original fica preservada).");
      const de = { tipo: g.tipo, direcao: g.direcao, linhaBase: g.linhaBase, esperado: g.esperado, faixaMin: g.faixaMin, faixaMax: g.faixaMax, prazo: g.prazo, regra: g.regraInterpretacao };
      const para = { tipo: d.tipo, direcao: d.direcao, linhaBase: d.linhaBase, esperado: d.esperado, faixaMin: d.faixaMin, faixaMax: d.faixaMax, prazo: d.prazo, regra: d.regraInterpretacao };
      const regraMudou = JSON.stringify(de) !== JSON.stringify(para); const antigos = (g.marcos as { titulo: string; feito: boolean }[] | null) ?? [];
      await db.update(schema.perfGoals).set({ ...d, meta: textoLegado(d, marcos.length), marcos: d.direcao === "MARCOS" ? marcos.map(t => ({ titulo: t, feito: antigos.find(a => a.titulo === t)?.feito ?? false })) : null, original: g.original ?? (andamento ? de : null), alteracoes: andamento && regraMudou ? [...((g.alteracoes as unknown[] | null) ?? []), { em: new Date().toISOString(), por: s.nome, de, para, justificativa: just }] : g.alteracoes, ...(regraMudou && g.conversaoAprovadaEm ? { conversaoAprovadaEm: null, conversaoAprovadaPor: null } : {}) }).where(eq(schema.perfGoals.id, id));
      await audit(s, "alterar meta", "perf_goals", id, de, { ...para, justificativa: just });
    } else { const [g] = await db.insert(schema.perfGoals).values({ cycleId, employeeId, ...d, meta: textoLegado(d, marcos.length), marcos: d.direcao === "MARCOS" ? marcos.map(t => ({ titulo: t, feito: false })) : null }).returning({ id: schema.perfGoals.id }); await audit(s, "criar meta", "perf_goals", g.id, null, { titulo: d.titulo, tipo: d.tipo, direcao: d.direcao }); }
  } catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Meta salva."));
}
export async function aprovarConversaoMeta(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const voltar = str(fd, "voltar") || "/desempenho";
  try { const cfg = await getSettings(); assert(RH_ROLES.includes(s.role) || can.aprovar(s, "calibracao"), "Aprovar conversão de meta em nota é do RH/Direção.");
    const [g] = await db.select().from(schema.perfGoals).where(eq(schema.perfGoals.id, id)); if (!g) throw new Error("Meta não encontrada."); if (["EXPLORATORIA", "APRENDIZAGEM", "COLETIVA"].includes(g.tipo)) throw new Error("Metas exploratórias, de aprendizagem e coletivas não são convertidas em nota individual.");
    if (await faseCiclo(g.cycleId) !== "PLANEJAMENTO") throw new Error("A conversão em nota precisa ser configurada e aprovada antes do ciclo (fase de planejamento).");
    const tabela = validarConversao(str(fd, "conversao").split(/[;\n]+/).map(x => x.trim()).filter(Boolean).map(p => { const [ate, nota] = p.split(/[:=]/).map(v => Number(v.replace(",", ".").trim())); return { ate, nota }; }));
    await db.update(schema.perfGoals).set({ conversao: tabela, conversaoAprovadaPor: s.id, conversaoAprovadaEm: new Date() }).where(eq(schema.perfGoals.id, id)); await audit(s, "aprovar conversão de meta em nota", "perf_goals", id, null, { tabela });
  } catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Conversão aprovada. Ela apenas sugere nota ao avaliador; não é aplicada automaticamente."));
}
export async function atualizarMeta(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const voltar = str(fd, "voltar") || "/desempenho"; let msg = "";
  try { const [g] = await db.select().from(schema.perfGoals).where(eq(schema.perfGoals.id, id)); if (!g) throw new Error("Meta não encontrada."); if (g.responsavelUserId !== s.id) await acessoColaborador(s, g.employeeId, true);
    if (["CONCLUSAO", "ARQUIVADO"].includes((await faseCiclo(g.cycleId)) ?? "")) throw new Error("Ciclo encerrado.");
    const valor = num(fd, "valorAtual"); const feitos = fd.getAll("marco").map(String); const marcos = ((g.marcos as { titulo: string; feito: boolean }[] | null) ?? []).map((m, i) => ({ ...m, feito: feitos.includes(String(i)) }));
    const nb = (v: string | null) => v === null ? null : Number(v);
    const it = interpretarMeta({ tipo: g.tipo, direcao: g.direcao, linhaBase: nb(g.linhaBase), esperado: nb(g.esperado), faixaMin: nb(g.faixaMin), faixaMax: nb(g.faixaMax), valorAtual: valor, marcos: marcos.length ? marcos : null, conversao: g.conversao as { ate: number; nota: number }[] | null, conversaoAprovada: !!g.conversaoAprovadaEm });
    await db.update(schema.perfGoals).set({ atualizadaEm: new Date(), valorAtual: valor === null ? null : String(valor), marcos: marcos.length ? marcos : g.marcos, resultado: strOrNull(fd, "resultado") ?? g.resultado, atingimento: it.progresso === null ? null : Math.max(-999, Math.min(999, Math.round(it.progresso))), status: it.progresso !== null && it.progresso >= 100 ? "ATINGIDA" : "EM_ANDAMENTO", fonte: strOrNull(fd, "fonte") ?? g.fonte }).where(eq(schema.perfGoals.id, id));
    await audit(s, "atualizar andamento de meta", "perf_goals", id, { valor: g.valorAtual }, { valor, situacao: it.situacao, progresso: it.progresso }); msg = `Andamento registrado: ${it.situacao}${it.progresso !== null ? ` (${it.progresso}%)` : ""}.${it.alerta ? " " + it.alerta : ""}`;
  } catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", msg));
}

// ======================= Acompanhamento contínuo =======================
export async function registrarCheckin(fd: FormData) {
  const s = await requireSession(); const employeeId = Number(fd.get("employeeId")); const voltar = str(fd, "voltar") || `/colaboradores/${employeeId}/painel?aba=acompanhamento`;
  try { const { proprio } = await acessoColaborador(s, employeeId, true); const tipo = str(fd, "tipo") === "ANDAMENTO" ? "ANDAMENTO" : "REUNIAO"; const v = (k: string) => strOrNull(fd, k);
    const avancou = v("avancou"), bloqueio = v("bloqueio"), pauta = v("pautaColaborador"); if (!avancou && !bloqueio && !pauta) throw new Error("Registre o que avançou, um bloqueio ou um ponto de pauta — nota não é necessária.");
    const [c] = await db.insert(schema.perfCheckins).values({ employeeId, data: str(fd, "data") || hoje(), userId: s.id, temas: avancou ?? pauta ?? "", combinados: v("proximoCompromisso") ?? "", tipo, cycleId: int(fd, "cycleId"), goalId: int(fd, "goalId"), avancou, evidencia: v("evidencia"), bloqueio, apoio: v("apoio"), proximoCompromisso: v("proximoCompromisso"), compromissoGestor: v("compromissoGestor"), compromissoColaborador: v("compromissoColaborador"), compromissoPrazo: v("compromissoPrazo"), pautaColaborador: pauta }).returning({ id: schema.perfCheckins.id });
    await audit(s, tipo === "ANDAMENTO" ? "atualização de andamento" : "reunião de acompanhamento", "perf_checkins", c.id, null, { employeeId, bloqueio: !!bloqueio });
    const outro = proprio ? await userDoGestor(employeeId) : await userDoColaborador(employeeId); if (outro) await notificar([outro], proprio ? "Atualização de acompanhamento registrada pela equipe" : "Seu gestor registrou um acompanhamento", bloqueio ? "Há bloqueio registrado que pede apoio." : null, `/colaboradores/${employeeId}/painel?aba=acompanhamento`, bloqueio ? "ACAO" : "INFO", `ck:${c.id}`);
  } catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Acompanhamento registrado. Registro de reunião não comprova, por si, desenvolvimento."));
}
export async function cumprirCompromisso(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const voltar = str(fd, "voltar") || "/desempenho";
  try { const [c] = await db.select().from(schema.perfCheckins).where(eq(schema.perfCheckins.id, id)); if (!c) throw new Error("Registro não encontrado."); await acessoColaborador(s, c.employeeId, true);
    const ok = str(fd, "cumprido") === "1"; await db.update(schema.perfCheckins).set({ compromissoCumprido: ok }).where(eq(schema.perfCheckins.id, id)); await audit(s, "compromisso de acompanhamento", "perf_checkins", id, { cumprido: c.compromissoCumprido }, { cumprido: ok });
  } catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Compromisso atualizado."));
}

// ======================= Evidências com origem e contraditório =======================
export async function registrarEvidencia(fd: FormData) {
  const s = await requireSession(); const employeeId = Number(fd.get("employeeId")); const voltar = str(fd, "voltar") || `/colaboradores/${employeeId}/painel?aba=metas`; let msg = "Evidência registrada.";
  try { const { proprio } = await acessoColaborador(s, employeeId, true); const reviewId = int(fd, "reviewId"); let cycleId = int(fd, "cycleId");
    if (reviewId) { const [r] = await db.select().from(schema.perfReviews).where(eq(schema.perfReviews.id, reviewId)); if (!r || r.employeeId !== employeeId) throw new Error("Avaliação não encontrada."); if (["PUBLICADA", "CONTESTADA", "INCONCLUSIVA"].includes(r.estado)) throw new Error("Avaliação encerrada: registre como complemento de contexto ou no ciclo seguinte."); cycleId = r.cycleId; }
    const natureza = str(fd, "natureza") || (proprio ? "AUTO" : "OBSERVACAO"); if (!NATUREZA_EVID[natureza]) throw new Error("Natureza inválida."); if (proprio && !["AUTO", "REGISTRO"].includes(natureza)) throw new Error("O colaborador registra entregas verificáveis ou autoavaliação.");
    const titulo = str(fd, "titulo"); if (!titulo) throw new Error("Dê um título à evidência."); const texto = strOrNull(fd, "texto"), url = strOrNull(fd, "url"); if (!texto && !url) throw new Error("Descreva a evidência ou informe o link.");
    const criterios = fd.getAll("criterios").map(String).filter(Boolean);
    const [ev] = await db.insert(schema.evalEvidences).values({ reviewId, employeeId, cycleId, criterioId: criterios[0] ?? null, criterios, natureza, dataFato: strOrNull(fd, "dataFato"), fonte: strOrNull(fd, "fonte"), contexto: strOrNull(fd, "contexto"), visibilidade: proprio ? "COLABORADOR" : (str(fd, "visibilidade") === "GESTAO" ? "GESTAO" : "COLABORADOR"), limitacoes: strOrNull(fd, "limitacoes"), tipo: url ? "LINK" : "TEXTO", titulo, texto, url, origemModulo: strOrNull(fd, "origemModulo"), origemRef: strOrNull(fd, "origemRef"), userId: s.id, userNome: s.nome }).returning({ id: schema.evalEvidences.id });
    await audit(s, "registrar evidência", "eval_evidences", ev.id, null, { employeeId, natureza, criterios: criterios.length }); if (criterios.length > 1) msg += " Ela apoia mais de um critério: verifique possível dupla contagem.";
  } catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", msg));
}
async function evidenciaDo(id: number) {
  const [e] = await db.select().from(schema.evalEvidences).where(eq(schema.evalEvidences.id, id)); if (!e) throw new Error("Evidência não encontrada."); let emp = e.employeeId;
  if (!emp && e.reviewId) { const [r] = await db.select({ employeeId: schema.perfReviews.employeeId }).from(schema.perfReviews).where(eq(schema.perfReviews.id, e.reviewId)); emp = r?.employeeId ?? null; }
  if (!emp) throw new Error("Evidência sem colaborador vinculado."); return { e, employeeId: emp };
}
export async function contestarEvidencia(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const voltar = str(fd, "voltar") || "/meu-painel?aba=metas";
  try { const { e, employeeId } = await evidenciaDo(id); if (s.employeeId !== employeeId) throw new Error("Só o colaborador contesta evidências sobre si."); if (e.visibilidade !== "COLABORADOR") throw new Error("Evidência não disponível ao colaborador."); const t = str(fd, "texto"); if (!t) throw new Error("Explique o contraditório ou o contexto.");
    await db.update(schema.evalEvidences).set({ validacao: "CONTESTADA", contestacao: t, contestadaEm: new Date() }).where(eq(schema.evalEvidences.id, id)); await audit(s, "contestar evidência", "eval_evidences", id, { validacao: e.validacao }, { validacao: "CONTESTADA" });
    await notificar([(await userDoGestor(employeeId)) ?? 0, ...await usuariosPorPerfil(["RH"])], "Evidência contestada pelo colaborador", e.titulo, `/colaboradores/${employeeId}/painel?aba=metas`, "ACAO", `evc:${id}`);
  } catch (err) { redirect(go(voltar, "erro", erro(err))); }
  redirect(go(voltar, "ok", "Contestação registrada; a evidência passa a aparecer como contestada na avaliação."));
}
export async function complementarEvidencia(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const voltar = str(fd, "voltar") || "/desempenho";
  try { const { e, employeeId } = await evidenciaDo(id); await acessoColaborador(s, employeeId, true); if (s.employeeId === employeeId && e.visibilidade !== "COLABORADOR") throw new Error("Evidência não disponível ao colaborador."); const t = str(fd, "texto"); if (!t) throw new Error("Escreva o complemento.");
    await db.update(schema.evalEvidences).set({ complemento: [e.complemento, `[${hoje()} · ${s.nome}] ${t}`].filter(Boolean).join("\n") }).where(eq(schema.evalEvidences.id, id)); await audit(s, "complementar contexto de evidência", "eval_evidences", id, null, null);
  } catch (err) { redirect(go(voltar, "erro", erro(err))); }
  redirect(go(voltar, "ok", "Contexto complementado."));
}
export async function validarEvidencia(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const voltar = str(fd, "voltar") || "/desempenho";
  try { const { e, employeeId } = await evidenciaDo(id); await acessoColaborador(s, employeeId); const d = str(fd, "decisao") === "VALIDADA" ? "VALIDADA" : "NAO_VALIDADA";
    await db.update(schema.evalEvidences).set({ validacao: d }).where(eq(schema.evalEvidences.id, id)); await audit(s, "validação de evidência", "eval_evidences", id, { validacao: e.validacao }, { validacao: d });
  } catch (err) { redirect(go(voltar, "erro", erro(err))); }
  redirect(go(voltar, "ok", "Situação da evidência atualizada."));
}

// ======================= Necessidades e encaminhamentos =======================
export async function criarEncaminhamento(fd: FormData) {
  const s = await requireSession(); const employeeId = int(fd, "employeeId"); const voltar = str(fd, "voltar") || "/desempenho/lideranca"; let msg = "";
  try { let unitId = int(fd, "unitId");
    if (employeeId) { const { e } = await acessoColaborador(s, employeeId); unitId = e.unitId; } else { assert(GESTAO_ROLES.includes(s.role), "Sem permissão."); const u = scopeUnit(s); if (u !== null) unitId = u; }
    const descricao = str(fd, "descricao"), hipotese = str(fd, "hipotese") || "CONTEXTO", enc = str(fd, "encaminhamento"); if (!descricao) throw new Error("Descreva a necessidade."); if (!HIPOTESE[hipotese] || !ENCAMINHAMENTO[enc]) throw new Error("Hipótese ou encaminhamento inválido.");
    const acao = str(fd, "acao"), resp = int(fd, "responsavelUserId"), prazo = strOrNull(fd, "prazo"), verificacao = str(fd, "verificacao"); if (!acao || !resp || !prazo || !verificacao) throw new Error("Registre ação, responsável, prazo e a forma de verificar o resultado.");
    if (enc === "PDI" && !employeeId) throw new Error("PDI individual exige um colaborador.");
    if (enc === "PDI" && ["PROCESSO", "RECURSO", "DEPENDENCIA"].includes(hipotese)) throw new Error("Hipótese de processo, recurso ou dependência de outra área não vira PDI individual: encaminhe à área responsável.");
    if (["INFRAESTRUTURA", "PROCESSO"].includes(enc) && !unitId) throw new Error("Informe a unidade.");
    let refModulo: string | null = null, refId: number | null = null; const titulo = acao.slice(0, 140);
    if (enc === "INFRAESTRUTURA") { const [w] = await sql<{ id: number }[]>`INSERT INTO work_orders (tipo, titulo, descricao, unit_id, prioridade, status, solicitante_user_id, responsavel_user_id, sla_ate) VALUES ('CORRETIVA', ${titulo}, ${descricao}, ${unitId}, 'NORMAL', 'ABERTO', ${s.id}, ${resp}, ${(await slaOs("NORMAL")).toISOString()}) RETURNING id`; refModulo = "work_orders"; refId = w.id; msg = ` Chamado #${w.id} aberto em Operações.`; }
    else if (enc === "FORMACAO_COLETIVA") { const [t] = await sql<{ id: number }[]>`INSERT INTO training_needs (employee_id, unit_id, descricao, origem, created_by) VALUES (${employeeId}, ${unitId}, ${`${descricao} — ${acao}`}, 'DESEMPENHO', ${s.id}) RETURNING id`; refModulo = "training_needs"; refId = t.id; msg = " Necessidade de formação registrada no Academy."; }
    else if (enc === "PROCESSO") { const [n] = await sql<{ id: number }[]>`INSERT INTO nonconformities (titulo, origem, descricao, unit_id, responsavel_user_id, prazo, status, created_by) VALUES (${titulo}, 'OUTRO', ${descricao}, ${unitId}, ${resp}, ${prazo}, 'ABERTA', ${s.id}) RETURNING id`; refModulo = "nonconformities"; refId = n.id; msg = ` Melhoria de processo aberta em Governança (#${n.id}).`; }
    else if (enc === "PDI") { const max = (await getSettings()).desempenho.maxPrioridadesAtivas; const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM pdi_plans WHERE employee_id=${employeeId} AND status='ATIVO' AND tipo='CRESCIMENTO' AND natureza='LACUNA'`; if (n >= max) throw new Error(`Limite de ${max} prioridades ativas atingido para este colaborador.`);
      const [p] = await db.insert(schema.pdiPlans).values({ employeeId: employeeId!, cycleId: int(fd, "cycleId"), reviewId: int(fd, "reviewId"), criterioId: strOrNull(fd, "criterioId"), competencia: descricao.slice(0, 120), evidencia: strOrNull(fd, "evidenciaEsperada"), objetivo: acao, createdBy: s.id, validadoPor: s.id, validadoEm: new Date() }).returning({ id: schema.pdiPlans.id });
      await db.insert(schema.pdiActions).values({ planId: p.id, descricao: acao, responsavelUserId: resp, prazo, apoio: strOrNull(fd, "apoio"), formaAcompanhamento: verificacao }); refModulo = "pdi_plans"; refId = p.id; msg = " PDI criado com a primeira ação."; }
    const [d] = await db.insert(schema.devNeeds).values({ employeeId, unitId, cycleId: int(fd, "cycleId"), reviewId: int(fd, "reviewId"), criterioId: strOrNull(fd, "criterioId"), origem: str(fd, "origem") || "GESTAO", descricao, hipotese, encaminhamento: enc, acao, responsavelUserId: resp, prazo, apoio: strOrNull(fd, "apoio"), evidenciaEsperada: strOrNull(fd, "evidenciaEsperada"), verificacao, refModulo, refId, createdBy: s.id }).returning({ id: schema.devNeeds.id });
    await notificar([resp], `Encaminhamento sob sua responsabilidade: ${ENCAMINHAMENTO[enc]}`, titulo, "/desempenho/lideranca#encaminhamentos", "ACAO", `need:${d.id}`); await audit(s, "encaminhamento de necessidade", "dev_needs", d.id, null, { hipotese, encaminhamento: enc, refModulo, refId });
  } catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Encaminhamento registrado." + msg));
}
export async function atualizarEncaminhamento(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const voltar = str(fd, "voltar") || "/desempenho/lideranca";
  try { const [d] = await db.select().from(schema.devNeeds).where(eq(schema.devNeeds.id, id)); if (!d) throw new Error("Encaminhamento não encontrado."); const u = scopeUnit(s);
    assert(d.responsavelUserId === s.id || (GESTAO_ROLES.includes(s.role) && (u === null || u === d.unitId)), "Sem permissão."); const st = str(fd, "status"); if (!["ABERTO", "EM_ANDAMENTO", "CONCLUIDO", "CANCELADO"].includes(st)) throw new Error("Situação inválida.");
    const res = strOrNull(fd, "resultadoVerificado"); if (st === "CONCLUIDO" && !res) throw new Error("Concluir exige registrar o resultado verificado (conforme a forma de verificação combinada).");
    await db.update(schema.devNeeds).set({ status: st, resultadoVerificado: res ?? d.resultadoVerificado, updatedAt: new Date() }).where(eq(schema.devNeeds.id, id)); await audit(s, "atualizar encaminhamento", "dev_needs", id, { status: d.status }, { status: st });
  } catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Encaminhamento atualizado."));
}

// ======================= PDI: aplicação e resultado (separados da execução) =======================
async function plano(id: number) { const [p] = await db.select().from(schema.pdiPlans).where(eq(schema.pdiPlans.id, id)); if (!p) throw new Error("PDI não encontrado."); return p; }
export async function registrarAplicacao(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("planId")); const voltar = str(fd, "voltar") || "/meu-painel?aba=pdi";
  try { const p = await plano(id); await acessoColaborador(s, p.employeeId, true); const st = str(fd, "aplicacaoStatus"); if (!APLICACAO_STATUS[st]) throw new Error("Situação inválida."); const ev = strOrNull(fd, "aplicacaoEvidencia");
    if (st === "APLICADA" && !ev) throw new Error("Descreva como a prática foi aplicada no trabalho (evidência de aplicação).");
    await db.update(schema.pdiPlans).set({ aplicacaoStatus: st, aplicacaoEvidencia: ev ?? p.aplicacaoEvidencia, aplicacaoEm: st === "APLICADA" ? hoje() : p.aplicacaoEm }).where(eq(schema.pdiPlans.id, id)); await audit(s, "aplicação do PDI", "pdi_plans", id, { aplicacao: p.aplicacaoStatus }, { aplicacao: st });
    if (st === "APLICADA") { const g = await userDoGestor(p.employeeId); if (g) await notificar([g], "Aplicação de PDI registrada — verifique o resultado observado", p.competencia, `/colaboradores/${p.employeeId}/painel?aba=pdi`, "ACAO", `pdiap:${id}`); }
  } catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Aplicação registrada."));
}
export async function verificarResultado(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("planId")); const voltar = str(fd, "voltar") || "/desempenho";
  try { const p = await plano(id); await acessoColaborador(s, p.employeeId); const st = str(fd, "resultadoStatus"); if (!RESULTADO_STATUS[st] || st === "NAO_VERIFICADO") throw new Error("Escolha o resultado observado."); const obs = str(fd, "resultadoObservado"); if (!obs) throw new Error("Descreva o que foi observado.");
    if (st === "MELHORA_OBSERVADA" && p.aplicacaoStatus !== "APLICADA") throw new Error("Registre a aplicação no trabalho antes de verificar melhora.");
    await db.update(schema.pdiPlans).set({ resultadoStatus: st, resultadoObservado: obs, resultadoVerificadoPor: s.id, resultadoVerificadoEm: new Date() }).where(eq(schema.pdiPlans.id, id)); await audit(s, "verificar resultado do PDI", "pdi_plans", id, { resultado: p.resultadoStatus }, { resultado: st });
  } catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Resultado registrado. Melhora observada depois de uma ação não prova que a ação a causou."));
}
export async function manifestarPlano(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("planId")); const voltar = str(fd, "voltar") || "/meu-painel?aba=pdi";
  try { const p = await plano(id); if (p.employeeId !== s.employeeId) throw new Error("Só o colaborador se manifesta sobre o próprio plano."); if (p.tipo !== "MELHORIA_FORMAL") throw new Error("Manifestação formal se aplica ao plano formal de melhoria."); const t = str(fd, "texto"); if (!t) throw new Error("Escreva sua manifestação.");
    await db.update(schema.pdiPlans).set({ manifestacao: t, manifestacaoEm: new Date() }).where(eq(schema.pdiPlans.id, id)); await audit(s, "manifestação no plano formal", "pdi_plans", id, null, null);
    await notificar(await usuariosPorPerfil(["RH"]), "Manifestação registrada em plano formal de melhoria", null, `/colaboradores/${p.employeeId}/painel?aba=pdi`, "ACAO", `pfm:${id}`);
  } catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Manifestação registrada."));
}

// ======================= Desenvolvimento docente (observação de prática) =======================
async function obs(id: number) { const [o] = await db.select().from(schema.teachingObservations).where(eq(schema.teachingObservations.id, id)); if (!o) throw new Error("Observação não encontrada."); return o; }
export async function planejarObservacao(fd: FormData) {
  const s = await requireSession(); const employeeId = Number(fd.get("employeeId")); const voltar = str(fd, "voltar") || `/colaboradores/${employeeId}/painel?aba=docente`;
  try { const { e } = await acessoColaborador(s, employeeId); const finalidade = str(fd, "finalidade") === "FORMAL" ? "FORMAL" : "FORMATIVA"; const turmaRef = strOrNull(fd, "turmaRef"); if (turmaRef && turmaRef.length > 40) throw new Error("Use só o rótulo da turma (ex.: 5º ano B) — nenhum dado de estudante.");
    const [o] = await db.insert(schema.teachingObservations).values({ employeeId, observadorUserId: s.id, unitId: e.unitId, segmento: strOrNull(fd, "segmento"), turmaRef, finalidade, podeCompor: finalidade === "FORMAL" && str(fd, "podeCompor") === "1", dataPlanejada: strOrNull(fd, "dataPlanejada"), focoPlanejado: strOrNull(fd, "focoPlanejado"), anteriorId: int(fd, "anteriorId") }).returning({ id: schema.teachingObservations.id });
    await audit(s, "planejar observação de prática", "teaching_observations", o.id, null, { employeeId, finalidade }); const u = await userDoColaborador(employeeId); if (u) await notificar([u], `Observação de prática planejada (${finalidade === "FORMAL" ? "formal" : "formativa"})`, strOrNull(fd, "dataPlanejada") ? `Data: ${str(fd, "dataPlanejada")}` : null, `/colaboradores/${employeeId}/painel?aba=docente`, "INFO", `obs:${o.id}`);
  } catch (err) { redirect(go(voltar, "erro", erro(err))); }
  redirect(go(voltar, "ok", "Observação planejada; o professor foi avisado da data e da finalidade."));
}
export async function registrarObservacao(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const voltar = str(fd, "voltar") || "/desempenho";
  try { const o = await obs(id); await acessoColaborador(s, o.employeeId); if (o.status !== "PLANEJADA") throw new Error("Esta observação já foi registrada.");
    const dims = (await getSettings()).desempenho.dimensoesDocentes; const rubrica = dims.map((d, i) => ({ dimensao: d, nivel: int(fd, `nv_${i}`), registro: strOrNull(fd, `rg_${i}`) })).filter(x => x.nivel !== null || x.registro);
    if (!rubrica.length) throw new Error("Registre ao menos uma dimensão observada."); if (rubrica.some(x => x.nivel !== null && (x.nivel < 1 || x.nivel > 4))) throw new Error("Níveis da rubrica vão de 1 a 4.");
    await db.update(schema.teachingObservations).set({ rubrica, status: "OBSERVADA", dataObservacao: str(fd, "dataObservacao") || hoje() }).where(eq(schema.teachingObservations.id, id));
    if (o.anteriorId) await db.update(schema.teachingObservations).set({ status: "REOBSERVADA" }).where(eq(schema.teachingObservations.id, o.anteriorId));
    await audit(s, "registrar observação de prática", "teaching_observations", id, null, { dimensoes: rubrica.length });
  } catch (err) { redirect(go(voltar, "erro", erro(err))); }
  redirect(go(voltar, "ok", "Observação registrada. Uma observação não é julgamento definitivo."));
}
export async function devolutivaObservacao(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const voltar = str(fd, "voltar") || "/desempenho";
  try { const o = await obs(id); await acessoColaborador(s, o.employeeId); if (o.status !== "OBSERVADA") throw new Error("Registre a observação antes da devolutiva."); const dev = str(fd, "devolutiva"), foco = str(fd, "focoDesenvolvimento"); if (!dev || !foco) throw new Error("Registre a devolutiva e o foco de desenvolvimento escolhido em conjunto.");
    await db.update(schema.teachingObservations).set({ devolutiva: dev, focoDesenvolvimento: foco, status: "FOCO" }).where(eq(schema.teachingObservations.id, id)); await audit(s, "devolutiva de observação", "teaching_observations", id, null, null);
    const u = await userDoColaborador(o.employeeId); if (u) await notificar([u], "Devolutiva da observação registrada", "Veja o foco de desenvolvimento combinado.", `/colaboradores/${o.employeeId}/painel?aba=docente`, "INFO", `obsd:${id}`);
  } catch (err) { redirect(go(voltar, "erro", erro(err))); }
  redirect(go(voltar, "ok", "Devolutiva e foco registrados."));
}
export async function aplicacaoObservacao(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const voltar = str(fd, "voltar") || "/meu-painel?aba=docente";
  try { const o = await obs(id); await acessoColaborador(s, o.employeeId, true); if (!["FOCO", "APLICACAO"].includes(o.status)) throw new Error("Defina o foco antes de registrar a aplicação."); const t = str(fd, "aplicacao"); if (!t) throw new Error("Descreva como o foco foi aplicado em aula.");
    await db.update(schema.teachingObservations).set({ aplicacao: t, status: "APLICACAO" }).where(eq(schema.teachingObservations.id, id)); await audit(s, "aplicação do foco docente", "teaching_observations", id, null, null);
    if (s.employeeId === o.employeeId && o.observadorUserId) await notificar([o.observadorUserId], "Professor registrou aplicação — planeje a nova observação", null, `/colaboradores/${o.employeeId}/painel?aba=docente`, "ACAO", `obsa:${id}`);
  } catch (err) { redirect(go(voltar, "erro", erro(err))); }
  redirect(go(voltar, "ok", "Aplicação registrada. Próximo passo: nova observação."));
}

// ======================= Preparação de avaliadores =======================
export async function criarTreinamento(fd: FormData) {
  const s = await requireSession(); let tid = 0;
  try { assert(RH_ROLES.includes(s.role), "Treinamentos de avaliadores são criados pelo RH."); const titulo = str(fd, "titulo"); if (!titulo) throw new Error("Dê um título.");
    const casos = linhas(fd, "casos").map((l, i) => { const [t, descricao, ref, just] = l.split("::").map(x => x.trim()); const n = Number(ref); if (!t || !descricao || !Number.isInteger(n) || n < 1 || n > 5) throw new Error(`Caso inválido na linha ${i + 1}. Formato: Título :: situação observada :: nota de referência 1–5 :: justificativa`); return { id: `k${i + 1}`, titulo: t, descricao, referencia: n, justificativa: just || null }; });
    if (!casos.length) throw new Error("Inclua ao menos um caso simulado."); const modelId = int(fd, "modelId"); let modelVersao: number | null = null; if (modelId) { const [m] = await db.select().from(schema.evalModels).where(eq(schema.evalModels.id, modelId)); modelVersao = m?.versao ?? null; }
    const [t] = await db.insert(schema.raterTrainings).values({ titulo, modelId, modelVersao, orientacoes: strOrNull(fd, "orientacoes"), casos, createdBy: s.id }).returning({ id: schema.raterTrainings.id }); tid = t.id; await audit(s, "criar treinamento de avaliadores", "rater_trainings", tid, null, { casos: casos.length });
  } catch (e) { redirect(go("/desempenho/treinamento", "erro", erro(e))); }
  redirect(go(`/desempenho/treinamento/${tid}`, "ok", "Treinamento criado. Cada avaliador responde os casos individualmente antes da discussão."));
}
export async function responderCaso(fd: FormData) {
  const s = await requireSession(); const tid = Number(fd.get("trainingId")); const voltar = `/desempenho/treinamento/${tid}`;
  try { assert(GESTAO_ROLES.includes(s.role), "Treinamento destinado a avaliadores."); const [t] = await db.select().from(schema.raterTrainings).where(eq(schema.raterTrainings.id, tid)); if (!t) throw new Error("Treinamento não encontrado."); if (t.status !== "ABERTO") throw new Error("Treinamento encerrado.");
    const casoId = str(fd, "casoId"); if (!(t.casos as { id: string }[]).some(c => c.id === casoId)) throw new Error("Caso inválido."); const nota = int(fd, "nota"); if (!nota || nota < 1 || nota > 5) throw new Error("Nota de 1 a 5."); const just = str(fd, "justificativa"); if (!just) throw new Error("Justifique com base no critério e na evidência.");
    const r = await sql`INSERT INTO rater_training_responses (training_id, user_id, caso_id, notas, justificativa) VALUES (${tid}, ${s.id}, ${casoId}, ${JSON.stringify({ nota })}::jsonb, ${just}) ON CONFLICT (training_id, user_id, caso_id) DO NOTHING RETURNING id`; if (!r.length) throw new Error("Resposta já registrada: a avaliação individual não muda depois de enviada.");
    await audit(s, "resposta a caso de treinamento", "rater_trainings", tid, null, { caso: casoId });
  } catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Resposta registrada. Agora você vê a referência e a distribuição das respostas deste caso."));
}
export async function registrarDiscussao(fd: FormData) {
  const s = await requireSession(); const tid = Number(fd.get("trainingId")); const voltar = `/desempenho/treinamento/${tid}`;
  try { assert(RH_ROLES.includes(s.role)); await db.update(schema.raterTrainings).set({ discussao: strOrNull(fd, "discussao"), status: str(fd, "encerrar") === "1" ? "ENCERRADO" : "ABERTO" }).where(eq(schema.raterTrainings.id, tid)); await audit(s, "discussão do treinamento de avaliadores", "rater_trainings", tid, null, null); }
  catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Discussão registrada."));
}

// ======================= Carreira e sucessão =======================
export async function registrarInteresse(fd: FormData) {
  const s = await requireSession(); const voltar = "/meu-painel?aba=carreira";
  try { if (!s.employeeId) throw new Error("Seu usuário não está vinculado a um colaborador."); const lid = str(fd, "lideranca"); if (!["SIM", "NAO", "TALVEZ", "NAO_INFORMADO"].includes(lid)) throw new Error("Opção inválida.");
    await db.insert(schema.careerInterests).values({ employeeId: s.employeeId, data: hoje(), interesses: strOrNull(fd, "interesses"), funcoes: strOrNull(fd, "funcoes"), lideranca: lid, mobilidade: strOrNull(fd, "mobilidade"), obs: strOrNull(fd, "obs"), registradoPor: s.id }); await audit(s, "interesses de carreira declarados", "career_interests", null, null, null);
  } catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Interesses registrados. Interesse em outra função não é exigência de bom desempenho."));
}
export async function atualizarSucessao(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const voltar = str(fd, "voltar") || "/sucessao";
  try { assert(RH_ROLES.includes(s.role), "Análise de sucessão é do RH/Direção."); const [x] = await db.select().from(schema.successors).where(eq(schema.successors.id, id)); if (!x) throw new Error("Registro não encontrado.");
    await db.update(schema.successors).set({ requisitos: strOrNull(fd, "requisitos"), evidencias: strOrNull(fd, "evidencias"), lacunas: strOrNull(fd, "lacunas"), experiencias: strOrNull(fd, "experiencias"), interesseDeclarado: strOrNull(fd, "interesseDeclarado"), revisaoEm: strOrNull(fd, "revisaoEm"), responsavelUserId: s.id }).where(eq(schema.successors.id, id)); await audit(s, "análise de preparação para sucessão", "successors", id, null, null);
  } catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Análise de preparação registrada (para uma função específica; não é índice de potencial)."));
}

// ======================= Múltiplas fontes (opt-in por ciclo) =======================
export async function convidarFonte(fd: FormData) {
  const s = await requireSession(); const rid = Number(fd.get("reviewId")); const voltar = `/desempenho/avaliacoes/${rid}`;
  try { const [r] = await db.select().from(schema.perfReviews).where(eq(schema.perfReviews.id, rid)); if (!r) throw new Error("Avaliação não encontrada."); const [c] = await db.select().from(schema.perfCycles).where(eq(schema.perfCycles.id, r.cycleId));
    assert(RH_ROLES.includes(s.role) || r.avaliadorUserId === s.id, "Só o RH ou o avaliador designado convida fontes."); if (["PUBLICADA", "CONTESTADA", "INCONCLUSIVA"].includes(r.estado)) throw new Error("Avaliação encerrada.");
    const grupo = str(fd, "grupo"); const cfg = (c?.fontes as Record<string, { peso: number; minimo: number }> | null) ?? {}; if (!cfg[grupo] || grupo === "GESTOR") throw new Error("Este ciclo não tem essa fonte habilitada (múltiplas fontes são opcionais e configuradas no planejamento).");
    const motivo = str(fd, "motivo"); if (!motivo) throw new Error("Informe a oportunidade de observação que justifica o convite."); const uid = int(fd, "userId"); const [u] = await sql<{ id: number; employee_id: number | null }[]>`SELECT id, employee_id FROM users WHERE id=${uid ?? 0} AND ativo`; if (!u) throw new Error("Usuário não encontrado."); if (u.employee_id === r.employeeId) throw new Error("O avaliado não é fonte de si mesmo (use a autoavaliação).");
    await sql`INSERT INTO review_raters (review_id, user_id, grupo, motivo) VALUES (${rid}, ${u.id}, ${grupo}, ${motivo}) ON CONFLICT (review_id, user_id) DO NOTHING`; await notificar([u.id], "Você foi convidado a contribuir com uma avaliação", "Responda apenas o que teve oportunidade de observar.", "/contribuicoes", "ACAO", `rater:${rid}:${u.id}`); await audit(s, "convidar fonte de avaliação", "perf_reviews", rid, null, { grupo });
  } catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Convite enviado."));
}
export async function responderFonte(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("raterId")); const voltar = "/contribuicoes";
  try { const [rt] = await db.select().from(schema.reviewRaters).where(eq(schema.reviewRaters.id, id)); if (!rt || rt.userId !== s.id) throw new Error("Convite não encontrado."); const [r] = await db.select().from(schema.perfReviews).where(eq(schema.perfReviews.id, rt.reviewId)); if (!r || ["PUBLICADA", "CONTESTADA", "INCONCLUSIVA"].includes(r.estado)) throw new Error("A avaliação já foi encerrada.");
    const [c] = await db.select().from(schema.perfCycles).where(eq(schema.perfCycles.id, r.cycleId)); const notas: Record<string, { nota?: number; naoObservado?: boolean }> = {};
    for (const cr of ((c?.criterios as Criterio[] | null) ?? []).filter(x => x.eixo !== "TECNICA")) { const v = str(fd, `f_${cr.id}`); if (v === "NO") notas[cr.id] = { naoObservado: true }; else if (v) { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error("Notas de 1 a 5."); notas[cr.id] = { nota: n }; } }
    if (!Object.keys(notas).length) throw new Error("Responda ao menos um critério ou marque “não tenho observação suficiente”.");
    await db.update(schema.reviewRaters).set({ notas, comentario: strOrNull(fd, "comentario"), status: "RESPONDIDO", respondidoEm: new Date() }).where(eq(schema.reviewRaters.id, id)); await audit(s, "resposta de fonte de avaliação", "review_raters", id, null, { criterios: Object.keys(notas).length });
  } catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Resposta registrada. Resultados por grupo só aparecem com o mínimo de respondentes."));
}

// ======================= IA como apoio (rascunhos com fontes, revisão humana) =======================
export async function gerarRascunhoIA(fd: FormData) {
  const s = await requireSession(); const employeeId = Number(fd.get("employeeId")); const voltar = str(fd, "voltar") || `/colaboradores/${employeeId}/painel`;
  try { const { e } = await acessoColaborador(s, employeeId); const tarefa = str(fd, "tarefa"); if (!TAREFAS_IA[tarefa]) throw new Error("Tarefa de IA inválida.");
    const ev = await sql<{ id: number; natureza: string; data: string | null; titulo: string; texto: string | null; validacao: string; contestacao: string | null }[]>`SELECT e.id, e.natureza, e.data_fato::text AS data, e.titulo, e.texto, e.validacao, e.contestacao FROM eval_evidences e LEFT JOIN perf_reviews r ON r.id=e.review_id WHERE (e.employee_id=${employeeId} OR r.employee_id=${employeeId}) ORDER BY e.created_at DESC LIMIT 40`;
    const fb = await sql<{ id: number; data: string; situacao: string; comportamento: string; impacto: string | null }[]>`SELECT id, data::text AS data, situacao, comportamento, impacto FROM feedbacks WHERE employee_id=${employeeId} ORDER BY data DESC LIMIT 15`;
    const ck = await sql<{ id: number; data: string; avancou: string | null; bloqueio: string | null }[]>`SELECT id, data::text AS data, avancou, bloqueio FROM perf_checkins WHERE employee_id=${employeeId} ORDER BY data DESC LIMIT 15`;
    const fontes: FonteIA[] = [...ev.map(x => ({ id: `v${x.id}`, natureza: x.natureza, data: x.data, texto: `${x.titulo}: ${x.texto ?? ""}${x.validacao === "CONTESTADA" ? ` [contestada pelo colaborador: ${x.contestacao ?? ""}]` : ""}` })), ...fb.map(x => ({ id: `f${x.id}`, natureza: "FEEDBACK", data: x.data, texto: `Situação: ${x.situacao}. Comportamento/entrega: ${x.comportamento}.${x.impacto ? ` Impacto: ${x.impacto}.` : ""}` })), ...ck.map(x => ({ id: `c${x.id}`, natureza: "ACOMPANHAMENTO", data: x.data, texto: `${x.avancou ?? ""}${x.bloqueio ? ` Bloqueio: ${x.bloqueio}` : ""}` }))];
    const p = montarPromptIA(tarefa, { nome: e.nome, cargo: null }, fontes); if (p.semDados) throw new Error("Sem evidências, feedbacks ou acompanhamentos registrados: a IA não foi acionada (dados insuficientes).");
    const r = await chamarIA(p.sistema, p.usuario); const v = validarRespostaIA(r.texto, fontes.map(f => f.id));
    const [d] = await db.insert(schema.aiDrafts).values({ employeeId, reviewId: int(fd, "reviewId"), tipo: tarefa, modelo: r.modelo, configVersao: CONFIG_IA_VERSAO, fontes: fontes.map(f => ({ id: f.id, natureza: f.natureza, data: f.data })), texto: v.texto, alertas: v.alertas, createdBy: s.id }).returning({ id: schema.aiDrafts.id });
    await audit(s, "rascunho de IA gerado", "ai_drafts", d.id, null, { tarefa, fontes: fontes.length, alertas: v.alertas.length, modelo: r.modelo });
  } catch (err) { redirect(go(voltar, "erro", erro(err))); }
  redirect(go(voltar, "ok", "Rascunho gerado — revisão humana obrigatória; nada foi publicado nem alterado."));
}
export async function decidirRascunhoIA(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const voltar = str(fd, "voltar") || "/desempenho";
  try { const [d] = await db.select().from(schema.aiDrafts).where(eq(schema.aiDrafts.id, id)); if (!d) throw new Error("Rascunho não encontrado."); await acessoColaborador(s, d.employeeId); if (d.status !== "RASCUNHO") throw new Error("Rascunho já decidido.");
    const aprovar = str(fd, "decisao") === "APROVAR"; await db.update(schema.aiDrafts).set(aprovar ? { status: "APROVADO", texto: str(fd, "texto") || d.texto, aprovadoPor: s.id, aprovadoEm: new Date() } : { status: "DESCARTADO" }).where(eq(schema.aiDrafts.id, id)); await audit(s, aprovar ? "aprovar rascunho de IA (versão revisada)" : "descartar rascunho de IA", "ai_drafts", id, null, null);
  } catch (err) { redirect(go(voltar, "erro", erro(err))); }
  redirect(go(voltar, "ok", "Decisão registrada. O texto aprovado não altera notas nem é publicado automaticamente."));
}
