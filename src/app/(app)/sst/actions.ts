"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit } from "@/lib/auth";
import { audit, str, strOrNull, int, hoje, addDays, caminhoSeguro } from "@/lib/utils";
import { podeSst, podeIncidente, TIPOS_ASO, RESULTADO_ASO, TIPOS_INCIDENTE, GRAVIDADE_INCIDENTE, FUNCOES_CIPA, REPRESENTACAO_CIPA, prazoCat } from "@/lib/sst";
import { notificar, usuariosPorPerfil } from "@/lib/comunicacao";
import { getSettings } from "@/lib/utils";

const go = (b: string, k: "ok" | "erro", msg: string) => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}`;
const erro = (e: unknown) => e instanceof Error ? e.message : "Erro inesperado.";
const dataOk = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

// ------------------------------------------------------------------ ASO (T-101)
export async function registrarAso(fd: FormData) {
  const s = await requireSession(); const voltar = caminhoSeguro(str(fd, "voltar"), "/sst");
  try {
    assert(podeSst(s), "Exames ocupacionais: RH ou Direção."); const employeeId = int(fd, "employeeId") ?? 0; const tipo = str(fd, "tipo"); const data = str(fd, "data"); const resultado = str(fd, "resultado") || "APTO"; const agendado = str(fd, "agendado") === "1";
    assert(!!TIPOS_ASO[tipo], "Escolha o tipo do exame."); assert(dataOk(data), "Informe a data."); assert(!!RESULTADO_ASO[resultado], "Resultado inválido.");
    assert(agendado || data <= hoje(), "Exame realizado não pode ter data futura — marque como agendado."); const validade = strOrNull(fd, "validade"); if (validade) assert(dataOk(validade) && validade > data, "Validade inválida.");
    const restricao = strOrNull(fd, "restricao"); if (resultado === "APTO_RESTRICAO") assert(!!restricao, "Descreva a restrição administrativa (ex.: não carregar peso) — sem diagnóstico.");
    const [e] = await sql<{ id: number }[]>`SELECT id FROM employees WHERE id=${employeeId}`; assert(!!e, "Colaborador não encontrado.");
    const [r] = await sql<{ id: number }[]>`INSERT INTO sst_exams (employee_id, tipo, data, validade, resultado, restricao, clinica, situacao, user_id) VALUES (${employeeId}, ${tipo}, ${data}, ${validade}, ${agendado ? "APTO" : resultado}, ${agendado ? null : restricao}, ${strOrNull(fd, "clinica")}, ${agendado ? "AGENDADO" : "REALIZADO"}, ${s.id}) RETURNING id`;
    await audit(s, agendado ? "agendar ASO" : "registrar ASO", "sst_exams", r.id, null, { employeeId, tipo, data });
  } catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Exame registrado (sem dado clínico: só tipo, data, validade e aptidão)."));
}
export async function concluirAgendado(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const voltar = caminhoSeguro(str(fd, "voltar"), "/sst");
  try { assert(podeSst(s), "Sem permissão."); const resultado = str(fd, "resultado") || "APTO"; assert(!!RESULTADO_ASO[resultado], "Resultado inválido.");
    const [r] = await sql<{ id: number }[]>`UPDATE sst_exams SET situacao='REALIZADO', resultado=${resultado}, restricao=${strOrNull(fd, "restricao")}, data=least(data, ${hoje()}::date) WHERE id=${id} AND situacao='AGENDADO' RETURNING id`; assert(!!r, "Agendamento não encontrado.");
    await audit(s, "registrar resultado do ASO agendado", "sst_exams", id, null, { resultado }); }
  catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Resultado registrado."));
}
export async function excluirAso(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const voltar = caminhoSeguro(str(fd, "voltar"), "/sst");
  try { assert(podeSst(s), "Sem permissão."); const [r] = await sql<{ employee_id: number; tipo: string; data: string }[]>`DELETE FROM sst_exams WHERE id=${id} RETURNING employee_id, tipo, data::text`; assert(!!r, "Exame não encontrado."); await audit(s, "excluir registro de ASO", "sst_exams", id, r, null); }
  catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Registro excluído (fica na auditoria)."));
}
export async function salvarPeriodicidade(fd: FormData) {
  const s = await requireSession(); const voltar = "/sst#periodicidade";
  try { assert(podeSst(s), "Sem permissão."); const positionId = int(fd, "positionId") ?? 0; const meses = int(fd, "meses"); assert(meses === null || (meses >= 6 && meses <= 36), "Periodicidade entre 6 e 36 meses (ou vazio para o padrão).");
    await sql`UPDATE positions SET aso_meses=${meses} WHERE id=${positionId}`; await audit(s, "periodicidade do ASO por cargo", "positions", positionId, null, { meses }); }
  catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Periodicidade do cargo salva (o PCMSO prevalece)."));
}

// ------------------------------------------------------------------ incidentes e CAT (T-102)
export async function registrarIncidente(fd: FormData) {
  const s = await requireSession(); const voltar = caminhoSeguro(str(fd, "voltar"), "/sst/incidentes"); let msg = "";
  try {
    assert(podeIncidente(s), "Registram incidentes: RH, Direção ou diretor(a) da unidade.");
    const unitId = int(fd, "unitId") ?? 0; const u = scopeUnit(s); assert(u === null || u === unitId, "Fora da sua unidade.");
    const tipo = str(fd, "tipo"); const gravidade = str(fd, "gravidade") || "LEVE"; const data = str(fd, "data"); const descricao = str(fd, "descricao");
    assert(!!TIPOS_INCIDENTE[tipo], "Escolha o tipo."); assert(!!GRAVIDADE_INCIDENTE[gravidade], "Gravidade inválida."); assert(dataOk(data) && data <= hoje(), "Data inválida."); assert(descricao.length >= 10, "Descreva o que aconteceu (sem diagnóstico médico).");
    const employeeId = int(fd, "employeeId"); const comAfastamento = str(fd, "comAfastamento") === "1";
    const catNecessaria = tipo !== "QUASE_ACIDENTE" && !!employeeId;
    const feriados = (await sql<{ d: string }[]>`SELECT data::text AS d FROM calendar_days WHERE tipo='FERIADO' AND data BETWEEN ${data} AND ${addDays(data, 15)}`).map(r => r.d);
    const cfg = await getSettings();
    const [r] = await sql<{ id: number }[]>`INSERT INTO sst_incidents (unit_id, employee_id, data, hora, tipo, gravidade, com_afastamento, local, descricao, cat_necessaria, cat_prazo, investigacao_prazo, created_by) VALUES (${unitId}, ${employeeId}, ${data}, ${strOrNull(fd, "hora")}, ${tipo}, ${gravidade}, ${comAfastamento}, ${strOrNull(fd, "local")}, ${descricao}, ${catNecessaria}, ${catNecessaria ? prazoCat(data, feriados, gravidade === "OBITO") : null}, ${addDays(data, Number(cfg.sst.investigacaoDias) || 15)}, ${s.id}) RETURNING id`;
    await audit(s, "registrar incidente de SST", "sst_incidents", r.id, null, { tipo, gravidade, unitId }); // a descrição não vai para a auditoria
    if (catNecessaria) await notificar(await usuariosPorPerfil(["RH", "DIRECAO"]), "CAT a emitir — prazo legal correndo", `Incidente #${r.id}: emitir a CAT até o primeiro dia útil seguinte.`, `/sst/incidentes?id=${r.id}`, "ALERTA", `cat-${r.id}`);
    msg = catNecessaria ? "Incidente registrado. A CAT tem prazo legal: emita e registre o número." : "Quase acidente registrado. Investigue com a CIPA e transforme o aprendizado em medida.";
  } catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", msg));
}
export async function registrarCat(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const voltar = caminhoSeguro(str(fd, "voltar"), "/sst/incidentes");
  try { assert(podeSst(s), "A CAT é registrada pelo RH ou pela Direção."); const numero = str(fd, "numero"); const em = str(fd, "em") || hoje(); assert(numero.length >= 3, "Informe o número da CAT."); assert(dataOk(em) && em <= hoje(), "Data inválida.");
    const [r] = await sql<{ id: number }[]>`UPDATE sst_incidents SET cat_numero=${numero}, cat_emitida_em=${em}, updated_at=now() WHERE id=${id} AND cat_necessaria RETURNING id`; assert(!!r, "Incidente não encontrado ou sem CAT."); await audit(s, "registrar CAT", "sst_incidents", id, null, { em }); }
  catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "CAT registrada."));
}
export async function registrarInvestigacao(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const voltar = caminhoSeguro(str(fd, "voltar"), "/sst/incidentes"); let msg = "";
  try {
    assert(podeIncidente(s), "Sem permissão."); const causas = str(fd, "causas"); const medidas = str(fd, "medidas"); assert(causas.length >= 10 && medidas.length >= 10, "Descreva as causas e as medidas de controle.");
    const [inc] = await sql<{ unit_id: number; cat_necessaria: boolean; cat_emitida_em: string | null }[]>`SELECT unit_id, cat_necessaria, cat_emitida_em::text FROM sst_incidents WHERE id=${id}`; assert(!!inc, "Incidente não encontrado."); const u = scopeUnit(s); assert(u === null || u === inc.unit_id, "Fora da sua unidade.");
    let acao: number | null = null;
    if (str(fd, "criarAcao") === "1") { const resp = int(fd, "responsavelId"); const prazo = str(fd, "prazo") || addDays(hoje(), 30); const [a] = await sql<{ id: number }[]>`INSERT INTO action_plans (titulo, porque, unit_id, prazo, responsavel_user_id, como, status, origem, created_by) VALUES (${`SST: medida de controle do incidente #${id}`}, ${"Aprendizado da investigação com a CIPA"}, ${inc.unit_id}, ${prazo}, ${resp}, ${medidas.slice(0, 1000)}, 'A_FAZER', 'SST', ${s.id}) RETURNING id`; acao = a.id; }
    const concluido = !inc.cat_necessaria || !!inc.cat_emitida_em;
    await sql`UPDATE sst_incidents SET causas=${causas}, medidas=${medidas}, investigado_em=${hoje()}, action_plan_id=coalesce(${acao}, action_plan_id), status=${concluido ? "CONCLUIDO" : "INVESTIGADO"}, updated_at=now() WHERE id=${id}`;
    await audit(s, "registrar investigação de incidente", "sst_incidents", id, null, { acao });
    msg = acao ? "Investigação registrada e a medida virou ação com dono no plano de ação." : "Investigação registrada.";
  } catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", msg));
}

// ------------------------------------------------------------------ CIPA
export async function salvarMembroCipa(fd: FormData) {
  const s = await requireSession(); const voltar = "/sst/incidentes#cipa";
  try { assert(podeSst(s), "Sem permissão."); const unitId = int(fd, "unitId") ?? 0; const employeeId = int(fd, "employeeId") ?? 0; const representacao = str(fd, "representacao"); const funcao = str(fd, "funcao"); const ini = str(fd, "inicio"), fim = str(fd, "fim");
    assert(!!REPRESENTACAO_CIPA[representacao] && !!FUNCOES_CIPA[funcao], "Escolha representação e função."); assert(dataOk(ini) && dataOk(fim) && fim > ini, "Mandato inválido.");
    const [r] = await sql<{ id: number }[]>`INSERT INTO cipa_members (unit_id, employee_id, representacao, funcao, titular, mandato_inicio, mandato_fim) VALUES (${unitId}, ${employeeId}, ${representacao}, ${funcao}, ${str(fd, "titular") !== "0"}, ${ini}, ${fim}) RETURNING id`; await audit(s, "incluir membro da CIPA", "cipa_members", r.id, null, { unitId, funcao }); }
  catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Membro incluído na CIPA."));
}
export async function encerrarMembroCipa(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const voltar = "/sst/incidentes#cipa";
  try { assert(podeSst(s), "Sem permissão."); await sql`UPDATE cipa_members SET ativo=false WHERE id=${id}`; await audit(s, "encerrar membro da CIPA", "cipa_members", id, null, null); }
  catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Participação encerrada (a estabilidade do eleito continua contando)."));
}
export async function salvarReuniaoCipa(fd: FormData) {
  const s = await requireSession(); const voltar = "/sst/incidentes#cipa";
  try { assert(podeIncidente(s), "Sem permissão."); const id = int(fd, "id"); const unitId = int(fd, "unitId") ?? 0; const data = str(fd, "data"); assert(dataOk(data), "Data inválida.");
    if (id) { await sql`UPDATE cipa_meetings SET ata=${strOrNull(fd, "ata")}, realizada=${str(fd, "realizada") === "1"} WHERE id=${id}`; await audit(s, "registrar ata da CIPA", "cipa_meetings", id, null, null); }
    else { const [r] = await sql<{ id: number }[]>`INSERT INTO cipa_meetings (unit_id, data, tipo, pauta) VALUES (${unitId}, ${data}, ${str(fd, "tipo") || "ORDINARIA"}, ${strOrNull(fd, "pauta")}) RETURNING id`; await audit(s, "agendar reunião da CIPA", "cipa_meetings", r.id, null, { unitId, data }); } }
  catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Reunião da CIPA salva."));
}

// ------------------------------------------------------------------ EPI e reciclagem (T-103)
export async function salvarEpi(fd: FormData) {
  const s = await requireSession(); const voltar = "/sst/conformidade#epi";
  try { assert(podeSst(s), "Sem permissão."); const nome = str(fd, "nome"); assert(nome.length >= 3, "Informe o EPI."); const troca = int(fd, "troca"); assert(troca === null || (troca >= 1 && troca <= 3650), "Troca em dias inválida.");
    const [r] = await sql<{ id: number }[]>`INSERT INTO epi_items (nome, ca, troca_dias) VALUES (${nome}, ${strOrNull(fd, "ca")}, ${troca}) RETURNING id`; await audit(s, "cadastrar EPI", "epi_items", r.id, null, { nome }); }
  catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "EPI cadastrado."));
}
export async function registrarEntregaEpi(fd: FormData) {
  const s = await requireSession(); const voltar = "/sst/conformidade#epi";
  try { assert(podeSst(s) || s.role === "DIRETOR_UNIDADE", "Sem permissão."); const employeeId = int(fd, "employeeId") ?? 0; const epiId = int(fd, "epiId") ?? 0; const data = str(fd, "data") || hoje(); assert(dataOk(data), "Data inválida.");
    const [epi] = await sql<{ troca_dias: number | null }[]>`SELECT troca_dias FROM epi_items WHERE id=${epiId}`; assert(!!epi, "EPI não encontrado.");
    const [r] = await sql<{ id: number }[]>`INSERT INTO epi_deliveries (employee_id, epi_id, data, quantidade, termo_assinado, proxima_troca, user_id) VALUES (${employeeId}, ${epiId}, ${data}, ${Math.max(1, int(fd, "quantidade") ?? 1)}, ${str(fd, "termo") === "1"}, ${epi.troca_dias ? addDays(data, epi.troca_dias) : null}, ${s.id}) RETURNING id`;
    await audit(s, "registrar entrega de EPI", "epi_deliveries", r.id, null, { employeeId, epiId, termo: str(fd, "termo") === "1" }); }
  catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Entrega registrada. Anexe o termo assinado na ficha do colaborador quando for em papel."));
}
/** Convoca, num clique, a reciclagem de quem está pendente ou vencido no curso de segurança (cria a turma e a lista de presença). */
export async function convocarReciclagem(fd: FormData) {
  const s = await requireSession(); const voltar = "/sst/conformidade"; let msg = "";
  try {
    assert(podeSst(s), "Sem permissão."); const courseId = int(fd, "courseId") ?? 0; const data = str(fd, "data") || addDays(hoje(), 7); assert(dataOk(data) && data >= hoje(), "Data inválida."); const unitId = int(fd, "unitId");
    const ids = str(fd, "ids").split(",").map(Number).filter(n => n > 0); assert(ids.length > 0, "Ninguém pendente neste curso.");
    const [c] = await sql<{ titulo: string }[]>`SELECT titulo FROM courses WHERE id=${courseId}`; assert(!!c, "Curso não encontrado.");
    const [t] = await sql<{ id: number }[]>`INSERT INTO training_sessions (course_id, data, unit_id, obs) VALUES (${courseId}, ${data}, ${unitId}, 'Reciclagem convocada pela matriz de SST') RETURNING id`;
    for (const e of ids) await sql`INSERT INTO session_attendance (session_id, employee_id) VALUES (${t.id}, ${e}) ON CONFLICT DO NOTHING`;
    const us = await sql<{ id: number }[]>`SELECT id FROM users WHERE ativo AND employee_id = ANY(${ids})`;
    await notificar(us.map(u => u.id), `Convocação: ${c.titulo}`, `Reciclagem obrigatória em ${data.split("-").reverse().join("/")}.`, "/academy/minha", "ACAO");
    await audit(s, "convocar reciclagem de SST", "training_sessions", t.id, null, { courseId, pessoas: ids.length });
    msg = `Turma criada com ${ids.length} pessoa(s) convocada(s).`;
  } catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", msg));
}
