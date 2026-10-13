"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit, type Session } from "@/lib/auth";
import { audit, str, strOrNull, int, hoje, addDays, getSettings, fmtData, detectarSeparador, normalizarCabecalho, caminhoSeguro } from "@/lib/utils";
import { textoImportacao } from "@/lib/importacao";
import { notificar, usuariosPorPerfil } from "@/lib/comunicacao";
import { MOTIVO_AUS, SOLUCOES, minutos, turnoDe, diaSemana, sobrepoe, lerDia, gerarAulasDaAusencia, impedimento } from "@/lib/cobertura";

const go = (b: string, k: "ok" | "erro", msg: string) => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}`;
const back = (fd: FormData, fb = "/cobertura") => caminhoSeguro(str(fd, "voltar"), fb);
const COORD = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"];
const coordena = (s: Session) => COORD.includes(s.role);
const br = (iso: string) => fmtData(iso);

/** Professor dentro do escopo de quem coordena: lotado na unidade ou com aulas nela. */
async function professorNoEscopo(s: Session, employeeId: number) {
  const [e] = await sql<{ id: number; nome: string; unit_id: number; situacao: string }[]>`SELECT id, nome, unit_id, situacao FROM employees WHERE id=${employeeId}`;
  if (!e) throw new Error("Professor não encontrado.");
  const u = scopeUnit(s);
  if (u !== null && e.unit_id !== u) { const [t] = await sql`SELECT 1 FROM teacher_slots WHERE employee_id=${employeeId} AND unit_id=${u} AND ativo`; if (!t) throw new Error("Sem acesso a este professor."); }
  return e;
}
async function aulaNoEscopo(s: Session, id: number) {
  const [a] = await sql<{ id: number; absence_id: number; data: string; unit_id: number; turma: string; disciplina: string | null; inicio: string; fim: string; status: string; ausente_id: number; cobertura_id: number | null; convidado_por: number | null; minutos: number; recusas: unknown[] | null; ausente: string }[]>`SELECT ca.id, ca.absence_id, ca.data::text, ca.unit_id, ca.turma, ca.disciplina, ca.inicio, ca.fim, ca.status, ca.ausente_employee_id AS ausente_id, ca.cobertura_employee_id AS cobertura_id, ca.convidado_por, ca.minutos, ca.recusas, e.nome AS ausente FROM cover_assignments ca JOIN employees e ON e.id=ca.ausente_employee_id WHERE ca.id=${id}`;
  if (!a) throw new Error("Aula não encontrada.");
  const u = scopeUnit(s); if (u !== null && a.unit_id !== u) throw new Error("Sem acesso a esta unidade.");
  return a;
}
const usuarioDe = async (employeeId: number | null) => { if (!employeeId) return 0; const [u] = await sql<{ id: number }[]>`SELECT id FROM users WHERE employee_id=${employeeId} AND ativo ORDER BY id LIMIT 1`; return u?.id ?? 0; };
const coordenadores = async (unitId: number) => [...await usuariosPorPerfil(["GESTOR", "DIRETOR_UNIDADE"], unitId)];
function lerPeriodo(fd: FormData) {
  const de = str(fd, "de"); const ate = str(fd, "ate") || de; if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) throw new Error("Informe a data (ou o período) da ausência.");
  if (ate < de) throw new Error("A data final é anterior à inicial."); if (addDays(de, 31) < ate) throw new Error("Período máximo de 31 dias por registro — para afastamentos longos, use Férias e afastamentos.");
  const inicio = strOrNull(fd, "inicio"), fim = strOrNull(fd, "fim");
  if ((inicio || fim) && (minutos(inicio) === null || minutos(fim) === null || (minutos(fim) ?? 0) <= (minutos(inicio) ?? 0))) throw new Error("Período parcial: informe início e fim (HH:MM), com o fim depois do início.");
  return { de, ate, inicio, fim };
}
async function criarAusencias(employeeId: number, unitId: number, p: { de: string; ate: string; inicio: string | null; fim: string | null }, motivo: string, origem: string, obs: string | null, por: number) {
  let dias = 0, aulas = 0, jaTinha = 0; const unidades = new Set<number>();
  for (let d = p.de; d <= p.ate; d = addDays(d, 1)) {
    if (diaSemana(d) === 0) continue;
    const [x] = await sql<{ id: number }[]>`INSERT INTO cover_absences (employee_id, unit_id, data, inicio, fim, motivo, origem, obs, registrado_por) VALUES (${employeeId}, ${unitId}, ${d}, ${p.inicio}, ${p.fim}, ${motivo}, ${origem}, ${obs}, ${por}) ON CONFLICT (employee_id, data) WHERE status='ATIVA' DO NOTHING RETURNING id`;
    if (!x) { jaTinha++; continue; }
    dias++; aulas += await gerarAulasDaAusencia(x.id);
  }
  (await sql<{ unit_id: number }[]>`SELECT DISTINCT ca.unit_id FROM cover_assignments ca JOIN cover_absences ab ON ab.id=ca.absence_id WHERE ab.employee_id=${employeeId} AND ca.data BETWEEN ${p.de} AND ${p.ate} AND ca.status='ABERTA'`).forEach(r => unidades.add(r.unit_id));
  return { dias, aulas, jaTinha, unidades: [...unidades] };
}

export async function registrarAusencia(fd: FormData) {
  const s = await requireSession(); const b = back(fd); let msg = "";
  try {
    assert(coordena(s), "Só a coordenação e a direção registram ausências de professores.");
    const e = await professorNoEscopo(s, int(fd, "employeeId") ?? 0); const motivo = str(fd, "motivo"); if (!MOTIVO_AUS[motivo]) throw new Error("Escolha o motivo.");
    const p = lerPeriodo(fd); const r = await criarAusencias(e.id, e.unit_id, p, motivo, "COORDENACAO", strOrNull(fd, "obs"), s.id);
    await audit(s, "registrar ausência de professor", "cover_absences", null, null, { employeeId: e.id, ...p, motivo, dias: r.dias, aulas: r.aulas });
    if (!r.dias && r.jaTinha) throw new Error(`${e.nome} já tem ausência registrada nesse período.`);
    for (const u of r.unidades) if (u !== scopeUnit(s)) await notificar(await coordenadores(u), `Aulas a cobrir: ${e.nome}`, `Ausência registrada (${MOTIVO_AUS[motivo]}) em ${br(p.de)}${p.ate !== p.de ? ` a ${br(p.ate)}` : ""}.`, `/cobertura?data=${p.de}`, "ACAO", `ausencia:${e.id}:${p.de}`);
    msg = r.aulas ? `${e.nome}: ${r.aulas} aula(s) a cobrir em ${r.dias} dia(s).` : `${e.nome}: ausência registrada, sem aulas na grade nesse período (confira a grade horária).`;
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}

/** O próprio professor avisa que vai faltar (a coordenação vê as aulas a cobrir na hora). */
export async function avisarAusencia(fd: FormData) {
  const s = await requireSession(); const b = "/cobertura/minha"; let msg = "";
  try {
    assert(!!s.employeeId, "Seu acesso não está ligado a uma ficha de colaborador."); assert(s.role !== "LEITURA", "Perfil somente leitura não registra ausências.");
    const motivo = str(fd, "motivo"); if (!["FALTA", "ATESTADO", "FORMACAO", "OUTRO"].includes(motivo)) throw new Error("Escolha o motivo.");
    const p = lerPeriodo(fd); if (p.de < hoje()) throw new Error("Para ausências passadas (mesmo em parte do período), fale com a coordenação.");
    const [e] = await sql<{ nome: string; unit_id: number }[]>`SELECT nome, unit_id FROM employees WHERE id=${s.employeeId!}`;
    const r = await criarAusencias(s.employeeId!, e.unit_id, p, motivo, "PROFESSOR", strOrNull(fd, "obs"), s.id);
    if (!r.dias) throw new Error(r.jaTinha ? "Você já avisou ausência nesse período." : "Nenhum dia letivo no período.");
    await audit(s, "avisar ausência", "cover_absences", null, null, { ...p, motivo, aulas: r.aulas });
    const units = r.unidades.length ? r.unidades : [e.unit_id];
    for (const u of units) await notificar(await coordenadores(u), `${e.nome} avisou ausência`, `${MOTIVO_AUS[motivo]} em ${br(p.de)}${p.ate !== p.de ? ` a ${br(p.ate)}` : ""}: ${r.aulas} aula(s) a cobrir.`, `/cobertura?data=${p.de}`, "ALERTA", `avisoaus:${s.employeeId}:${p.de}`);
    msg = `Aviso enviado à coordenação: ${r.aulas} aula(s) a cobrir.`;
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}

export async function cancelarAusencia(fd: FormData) {
  const s = await requireSession(); const b = back(fd);
  try {
    const [a] = await sql<{ id: number; employee_id: number; data: string; status: string; origem: string; registrado_por: number | null }[]>`SELECT id, employee_id, data::text, status, origem, registrado_por FROM cover_absences WHERE id=${int(fd, "id") ?? 0}`;
    if (!a || a.status !== "ATIVA") throw new Error("Ausência não encontrada.");
    if (a.origem === "AFASTAMENTO") throw new Error("Ausência gerada de afastamento aprovado: cancele o afastamento em Férias e afastamentos.");
    const proprio = s.employeeId === a.employee_id && a.origem === "PROFESSOR";
    if (proprio && a.data < hoje()) throw new Error("Ausência de dia que já passou: só a coordenação ajusta (o histórico e as horas de quem cobriu dependem dela).");
    if (proprio && a.data === hoje()) { const [cob] = await sql`SELECT 1 FROM cover_assignments WHERE absence_id=${a.id} AND status IN ('CONFIRMADA','REALIZADA')`; if (cob) throw new Error("Já há colega cobrindo suas aulas hoje: fale com a coordenação para desfazer."); }
    if (!proprio) { assert(coordena(s), "Sem permissão."); await professorNoEscopo(s, a.employee_id); }
    const afetadas = await sql<{ cobertura_employee_id: number | null; turma: string; inicio: string }[]>`UPDATE cover_assignments SET status='CANCELADA', updated_at=now() WHERE absence_id=${a.id} AND status NOT IN ('REALIZADA','CANCELADA') RETURNING cobertura_employee_id, turma, inicio`;
    await sql`UPDATE cover_absences SET status='CANCELADA' WHERE id=${a.id}`;
    for (const x of afetadas.filter(x => x.cobertura_employee_id)) await notificar([await usuarioDe(x.cobertura_employee_id)], "Cobertura cancelada", `A aula de ${x.turma} (${br(a.data)}, ${x.inicio}) não precisa mais de cobertura.`, "/cobertura/minha", "INFO");
    await audit(s, "cancelar ausência de professor", "cover_absences", a.id, { status: "ATIVA" }, { status: "CANCELADA", motivo: strOrNull(fd, "motivo") });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Ausência cancelada; as aulas a cobrir foram retiradas."));
}

/** Convida (o professor aceita pelo celular) ou designa direto quem cobre a aula. */
export async function convidarCobertura(fd: FormData) {
  const s = await requireSession(); const b = back(fd); let msg = "";
  try {
    assert(coordena(s), "Só a coordenação e a direção distribuem coberturas.");
    const a = await aulaNoEscopo(s, int(fd, "id") ?? 0); if (!["ABERTA", "CONVIDADO"].includes(a.status)) throw new Error("Esta aula já está resolvida — reabra antes de trocar.");
    const emp = int(fd, "employeeId") ?? 0; const designar = str(fd, "modo") === "DESIGNAR";
    // quem cobre: colaborador ativo do escopo de quem distribui — e nunca a própria pessoa (as horas viram crédito no banco)
    const e = await professorNoEscopo(s, emp); if (e.situacao === "DESLIGADO") throw new Error(`${e.nome} está desligado(a).`);
    if (s.employeeId && emp === s.employeeId) throw new Error("Você não pode se designar para cobrir: peça a outra pessoa da coordenação ou da direção.");
    const imp = await impedimento(emp, { id: a.id, data: a.data, inicio: a.inicio, fim: a.fim, ausente_id: a.ausente_id }); if (imp) throw new Error(`Não dá: ${imp}.`);
    const uid = await usuarioDe(emp);
    if (!designar && !uid) throw new Error(`${e.nome} não tem acesso ao sistema para aceitar: use “Designar” e avise por WhatsApp.`);
    const anterior = a.status === "CONVIDADO" && a.cobertura_id !== emp ? a.cobertura_id : null;
    await sql`UPDATE cover_assignments SET cobertura_employee_id=${emp}, status=${designar ? "CONFIRMADA" : "CONVIDADO"}, convidado_por=${s.id}, convidado_em=now(), respondido_em=${designar ? sql`now()` : null}, updated_at=now() WHERE id=${a.id}`;
    if (anterior) await notificar([await usuarioDe(anterior)], "Convite de cobertura retirado", `A aula de ${a.turma} (${br(a.data)}, ${a.inicio}) foi passada para outra pessoa.`, "/cobertura/minha", "INFO");
    const texto = `${a.turma}${a.disciplina ? ` · ${a.disciplina}` : ""} — ${br(a.data)}, ${a.inicio}–${a.fim}, no lugar de ${a.ausente}.`;
    await notificar([uid], designar ? "Você vai cobrir uma aula" : "Convite para cobrir uma aula", texto, "/cobertura/minha", "ACAO", `cobconv:${a.id}:${emp}`);
    await audit(s, designar ? "designar cobertura" : "convidar para cobertura", "cover_assignments", a.id, { status: a.status, cobertura: a.cobertura_id }, { status: designar ? "CONFIRMADA" : "CONVIDADO", cobertura: emp });
    msg = designar ? `${e.nome} designado(a) para cobrir ${a.turma}.` : `Convite enviado a ${e.nome}.`;
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}

/** Resposta do professor convidado (aceitar ou recusar com motivo). */
export async function responderConvite(fd: FormData) {
  const s = await requireSession(); const b = "/cobertura/minha"; let msg = "";
  try {
    const [a] = await sql<{ id: number; status: string; cobertura_id: number | null; convidado_por: number | null; turma: string; data: string; inicio: string; recusas: unknown[] | null; unit_id: number }[]>`SELECT id, status, cobertura_employee_id AS cobertura_id, convidado_por, turma, data::text, inicio, recusas, unit_id FROM cover_assignments WHERE id=${int(fd, "id") ?? 0}`;
    if (!a || a.status !== "CONVIDADO" || !s.employeeId || a.cobertura_id !== s.employeeId) throw new Error("Convite não encontrado (pode ter sido retirado).");
    const aceitar = str(fd, "resposta") === "ACEITAR";
    // a condição repete "o convite é seu e ainda está aberto": se a coordenação passou a aula para outra pessoa no meio do caminho, nada muda
    if (aceitar) { const u = await sql`UPDATE cover_assignments SET status='CONFIRMADA', respondido_em=now(), updated_at=now() WHERE id=${a.id} AND status='CONVIDADO' AND cobertura_employee_id=${s.employeeId!} RETURNING id`; if (!u.length) throw new Error("Convite não encontrado (pode ter sido retirado)."); msg = "Cobertura confirmada. Obrigado!"; }
    else {
      const rec = [...(a.recusas ?? []), { employeeId: s.employeeId, nome: s.nome, em: new Date().toISOString(), motivo: strOrNull(fd, "motivo") }];
      const u = await sql`UPDATE cover_assignments SET status='ABERTA', cobertura_employee_id=NULL, recusas=${JSON.stringify(rec)}::jsonb, respondido_em=now(), updated_at=now() WHERE id=${a.id} AND status='CONVIDADO' AND cobertura_employee_id=${s.employeeId!} RETURNING id`; if (!u.length) throw new Error("Convite não encontrado (pode ter sido retirado)."); msg = "Recusa registrada; a coordenação foi avisada.";
    }
    await notificar([a.convidado_por ?? 0, ...(aceitar ? [] : await coordenadores(a.unit_id))], aceitar ? `${s.nome} aceitou cobrir ${a.turma}` : `${s.nome} recusou cobrir ${a.turma}`, `${br(a.data)}, ${a.inicio}${!aceitar && strOrNull(fd, "motivo") ? ` · motivo: ${strOrNull(fd, "motivo")}` : ""}`, `/cobertura?data=${a.data}`, aceitar ? "INFO" : "ALERTA");
    await audit(s, aceitar ? "aceitar cobertura" : "recusar cobertura", "cover_assignments", a.id, null, { motivo: strOrNull(fd, "motivo") });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}

export async function semProfessor(fd: FormData) {
  const s = await requireSession(); const b = back(fd);
  try {
    assert(coordena(s)); const a = await aulaNoEscopo(s, int(fd, "id") ?? 0); if (!["ABERTA", "CONVIDADO"].includes(a.status)) throw new Error("Esta aula já está resolvida.");
    const solucao = str(fd, "solucao"); if (!SOLUCOES[solucao]) throw new Error("Escolha a solução adotada.");
    const obs = strOrNull(fd, "obs"); if (solucao === "OUTRA" && !obs) throw new Error("Descreva a solução.");
    if (a.status === "CONVIDADO" && a.cobertura_id) await notificar([await usuarioDe(a.cobertura_id)], "Convite de cobertura retirado", `${a.turma} (${br(a.data)}, ${a.inicio}) foi resolvida sem professor substituto.`, "/cobertura/minha", "INFO");
    await sql`UPDATE cover_assignments SET status='SEM_PROFESSOR', solucao=${solucao}, obs=${obs}, cobertura_employee_id=NULL, updated_at=now() WHERE id=${a.id}`;
    await audit(s, "aula sem professor substituto", "cover_assignments", a.id, null, { solucao, obs });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Solução registrada."));
}

export async function reabrirCobertura(fd: FormData) {
  const s = await requireSession(); const b = back(fd);
  try {
    assert(coordena(s)); const a = await aulaNoEscopo(s, int(fd, "id") ?? 0); if (!["CONVIDADO", "CONFIRMADA", "SEM_PROFESSOR"].includes(a.status)) throw new Error("Só coberturas não realizadas podem ser reabertas.");
    if (a.cobertura_id) await notificar([await usuarioDe(a.cobertura_id)], "Cobertura desfeita", `Você não precisa mais cobrir ${a.turma} (${br(a.data)}, ${a.inicio}).`, "/cobertura/minha", "INFO");
    await sql`UPDATE cover_assignments SET status='ABERTA', cobertura_employee_id=NULL, solucao=NULL, updated_at=now() WHERE id=${a.id}`; await audit(s, "reabrir cobertura", "cover_assignments", a.id, { status: a.status }, { status: "ABERTA" });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Aula reaberta para nova cobertura."));
}

/** Aula coberta e dada: vira crédito no banco de horas de quem cobriu (pendente ou aprovado, conforme a configuração). */
export async function marcarRealizada(fd: FormData) {
  const s = await requireSession(); const b = back(fd); let msg = "";
  try {
    assert(coordena(s)); const a = await aulaNoEscopo(s, int(fd, "id") ?? 0); if (a.status !== "CONFIRMADA" || !a.cobertura_id) throw new Error("Só aulas com cobertura confirmada podem ser marcadas como realizadas.");
    if (a.data > hoje()) throw new Error("A aula ainda não aconteceu.");
    if (s.employeeId && a.cobertura_id === s.employeeId) throw new Error("Quem cobriu não confirma a própria cobertura: peça a outra pessoa da coordenação ou da direção.");
    const cfg = await getSettings(); const st = cfg.substituicao.creditoAprovado ? "APROVADO" : "PENDENTE"; const creditar = cfg.substituicao.creditarBanco && a.minutos > 0;
    const he = await sql.begin(async tx => {
      const ok = await tx`UPDATE cover_assignments SET status='REALIZADA', realizada_em=now(), updated_at=now() WHERE id=${a.id} AND status='CONFIRMADA' AND cobertura_employee_id=${a.cobertura_id} RETURNING id`;
      if (!ok.length) throw new Error("Esta cobertura já foi marcada como realizada (ou mudou). Atualize a página.");
      if (!creditar) return null;
      const [h] = await tx<{ id: number }[]>`INSERT INTO hour_entries (employee_id, data, minutos, tipo, descricao, status, lancado_por, aprovado_por) VALUES (${a.cobertura_id}, ${a.data}, ${a.minutos}, 'EXTRA', ${`Cobertura de aula: ${a.turma}${a.disciplina ? ` (${a.disciplina})` : ""}, ${a.inicio}–${a.fim}, no lugar de ${a.ausente}`}, ${st}, ${s.id}, ${st === "APROVADO" ? s.id : null}) RETURNING id`;
      await tx`UPDATE cover_assignments SET hour_entry_id=${h.id} WHERE id=${a.id}`; return h.id;
    });
    await audit(s, "cobertura realizada", "cover_assignments", a.id, null, { minutos: a.minutos, lancamentoBanco: he });
    msg = he ? `Realizada: ${a.minutos} min lançados no banco de horas${cfg.substituicao.creditoAprovado ? "" : " (aguardando aprovação)"}.` : "Realizada.";
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}

// ---------- Grade horária ----------
async function validarSlot(s: Session, d: { employeeId: number; unitId: number; dia: number; inicio: string; fim: string; turma: string; spaceId: number | null }, ignorarId?: number) {
  const u = scopeUnit(s); if (u !== null && d.unitId !== u) throw new Error("Sem acesso a esta unidade.");
  const [e] = await sql<{ situacao: string }[]>`SELECT situacao FROM employees WHERE id=${d.employeeId}`; if (!e) throw new Error("Professor não encontrado.");
  if (d.dia < 1 || d.dia > 6) throw new Error("Dia da semana inválido (segunda a sábado).");
  if (minutos(d.inicio) === null || minutos(d.fim) === null || (minutos(d.fim) ?? 0) <= (minutos(d.inicio) ?? 0)) throw new Error("Horário inválido: use HH:MM, com o fim depois do início.");
  if (!d.turma) throw new Error("Informe a turma.");
  const conflito = (await sql<{ inicio: string; fim: string; turma: string }[]>`SELECT inicio, fim, turma FROM teacher_slots WHERE employee_id=${d.employeeId} AND ativo AND dia_semana=${d.dia} ${ignorarId ? sql`AND id <> ${ignorarId}` : sql``}`).find(x => sobrepoe(x.inicio, x.fim, d.inicio, d.fim));
  if (conflito) throw new Error(`Choque de horário com a aula de ${conflito.turma} (${conflito.inicio}–${conflito.fim}).`);
  if (d.spaceId) { const [sp] = await sql<{ unit_id: number }[]>`SELECT unit_id FROM spaces WHERE id=${d.spaceId}`; if (!sp || sp.unit_id !== d.unitId) throw new Error("A sala precisa ser da mesma unidade."); }
}
export async function salvarAula(fd: FormData) {
  const s = await requireSession(); const b = back(fd, "/cobertura/grade");
  try {
    assert(coordena(s), "Só a coordenação e a direção editam a grade."); const id = int(fd, "id");
    const d = { employeeId: int(fd, "employeeId") ?? 0, unitId: int(fd, "unitId") ?? 0, dia: int(fd, "dia") ?? 0, inicio: str(fd, "inicio"), fim: str(fd, "fim"), turma: str(fd, "turma"), disciplina: strOrNull(fd, "disciplina"), spaceId: int(fd, "spaceId") };
    if (id) { const [old] = await sql<{ unit_id: number }[]>`SELECT unit_id FROM teacher_slots WHERE id=${id}`; if (!old) throw new Error("Aula não encontrada."); const u = scopeUnit(s); if (u !== null && old.unit_id !== u) throw new Error("Sem acesso a esta unidade."); }
    await validarSlot(s, d, id ?? undefined);
    if (id) await sql`UPDATE teacher_slots SET employee_id=${d.employeeId}, unit_id=${d.unitId}, dia_semana=${d.dia}, inicio=${d.inicio}, fim=${d.fim}, turno=${turnoDe(d.inicio)}, turma=${d.turma}, disciplina=${d.disciplina}, space_id=${d.spaceId} WHERE id=${id}`;
    else await sql`INSERT INTO teacher_slots (employee_id, unit_id, dia_semana, inicio, fim, turno, turma, disciplina, space_id) VALUES (${d.employeeId}, ${d.unitId}, ${d.dia}, ${d.inicio}, ${d.fim}, ${turnoDe(d.inicio)}, ${d.turma}, ${d.disciplina}, ${d.spaceId})`;
    await audit(s, id ? "editar aula da grade" : "incluir aula na grade", "teacher_slots", id, null, d);
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Grade atualizada."));
}
export async function removerAula(fd: FormData) {
  const s = await requireSession(); const b = back(fd, "/cobertura/grade"); let msg = "";
  try {
    assert(coordena(s)); const [t] = await sql<{ id: number; unit_id: number }[]>`SELECT id, unit_id FROM teacher_slots WHERE id=${int(fd, "id") ?? 0}`; if (!t) throw new Error("Aula não encontrada.");
    const u = scopeUnit(s); if (u !== null && t.unit_id !== u) throw new Error("Sem acesso a esta unidade.");
    const [usada] = await sql`SELECT 1 FROM cover_assignments WHERE slot_id=${t.id} LIMIT 1`;
    if (usada) { await sql`UPDATE teacher_slots SET ativo=false WHERE id=${t.id}`; msg = "Aula retirada da grade (o histórico de coberturas fica)."; } else { await sql`DELETE FROM teacher_slots WHERE id=${t.id}`; msg = "Aula removida."; }
    await audit(s, "remover aula da grade", "teacher_slots", t.id, null, null);
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}

/** Importa a grade (planilha ou CSV): professor (nome, e-mail ou CPF), unidade, dia, início, fim, turma, disciplina, sala. Com "substituir", a grade anterior das unidades do arquivo sai. */
export async function importarGrade(fd: FormData) {
  const s = await requireSession(); const b = "/cobertura/grade"; let msg = "";
  try {
    assert(coordena(s), "Só a coordenação e a direção importam a grade.");
    const texto = await textoImportacao(fd); if (!texto) throw new Error("Envie a planilha ou cole o conteúdo.");
    const linhas = texto.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.trim()); const sep = detectarSeparador(linhas[0]);
    const head = linhas[0].split(sep).map(normalizarCabecalho); const idx = (...k: string[]) => head.findIndex(h => k.includes(h));
    const cP = idx("professor", "nome", "docente"), cU = idx("unidade"), cD = idx("dia", "dia_da_semana"), cI = idx("inicio", "hora_inicio", "entrada"), cF = idx("fim", "termino", "hora_fim", "saida"), cT = idx("turma"), cDi = idx("disciplina", "materia", "componente"), cS = idx("sala", "espaco");
    if ([cP, cU, cD, cI, cF, cT].some(i => i < 0)) throw new Error("Cabeçalho precisa ter: professor, unidade, dia, inicio, fim, turma (disciplina e sala são opcionais).");
    const norm = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    const units = await sql<{ id: number; nome: string; codigo: string }[]>`SELECT id, nome, codigo FROM units`;
    const emps = await sql<{ id: number; nome: string; email: string | null; cpf: string | null }[]>`SELECT id, nome, email, cpf FROM employees WHERE situacao <> 'DESLIGADO'`;
    const spaces = await sql<{ id: number; nome: string; unit_id: number }[]>`SELECT id, nome, unit_id FROM spaces WHERE ativo`;
    const escopo = scopeUnit(s); const erros: string[] = []; const validas: { employeeId: number; unitId: number; dia: number; inicio: string; fim: string; turma: string; disciplina: string | null; spaceId: number | null; linha: number }[] = [];
    for (const [i, l] of linhas.slice(1).entries()) {
      const c = l.split(sep).map(x => x.trim().replace(/^"(.*)"$/, "$1")); const g = (k: number) => (k >= 0 ? c[k] ?? "" : "");
      try {
        const pv = norm(g(cP)); const e = emps.filter(x => norm(x.nome) === pv || (x.email && norm(x.email) === pv) || (x.cpf && x.cpf.replace(/\D/g, "") === pv.replace(/\D/g, "") && pv.replace(/\D/g, "").length === 11));
        if (e.length !== 1) throw new Error(e.length ? `professor "${g(cP)}" ambíguo (use e-mail)` : `professor "${g(cP)}" não encontrado`);
        const u = units.find(x => norm(x.nome) === norm(g(cU)) || norm(x.codigo) === norm(g(cU))); if (!u) throw new Error(`unidade "${g(cU)}" não encontrada`);
        if (escopo !== null && u.id !== escopo) throw new Error("unidade fora do seu escopo");
        const dia = lerDia(g(cD)); if (!dia) throw new Error(`dia "${g(cD)}" inválido`);
        const ini = g(cI).padStart(5, "0"), fim = g(cF).padStart(5, "0"); if (minutos(ini) === null || minutos(fim) === null || (minutos(fim) ?? 0) <= (minutos(ini) ?? 0)) throw new Error(`horário ${g(cI)}–${g(cF)} inválido`);
        if (!g(cT)) throw new Error("turma vazia");
        const sp = g(cS) ? spaces.find(x => x.unit_id === u.id && norm(x.nome) === norm(g(cS))) : undefined; if (g(cS) && !sp) throw new Error(`sala "${g(cS)}" não cadastrada na unidade`);
        validas.push({ employeeId: e[0].id, unitId: u.id, dia, inicio: ini, fim, turma: g(cT), disciplina: g(cDi) || null, spaceId: sp?.id ?? null, linha: i + 2 });
      } catch (e) { erros.push(`Linha ${i + 2}: ${e instanceof Error ? e.message : e}`); }
    }
    // choques dentro do próprio arquivo
    for (const [k, a] of validas.entries()) { const b2 = validas.slice(0, k).find(x => x.employeeId === a.employeeId && x.dia === a.dia && sobrepoe(x.inicio, x.fim, a.inicio, a.fim)); if (b2) erros.push(`Linha ${a.linha}: choque de horário com a linha ${b2.linha}`); }
    if (erros.length) throw new Error(`${erros.length} linha(s) com erro — nada foi importado. ${erros.slice(0, 6).join(" · ")}${erros.length > 6 ? " …" : ""}`);
    const substituir = str(fd, "substituir") === "1"; const unidadesArq = [...new Set(validas.map(v => v.unitId))];
    let n = 0;
    await sql.begin(async tx => {
      if (substituir) for (const u of unidadesArq) { await tx`UPDATE teacher_slots SET ativo=false WHERE unit_id=${u} AND ativo AND EXISTS (SELECT 1 FROM cover_assignments ca WHERE ca.slot_id=teacher_slots.id)`; await tx`DELETE FROM teacher_slots WHERE unit_id=${u} AND NOT EXISTS (SELECT 1 FROM cover_assignments ca WHERE ca.slot_id=teacher_slots.id)`; }
      for (const v of validas) {
        const choque = (await tx<{ inicio: string; fim: string; turma: string }[]>`SELECT inicio, fim, turma FROM teacher_slots WHERE employee_id=${v.employeeId} AND ativo AND dia_semana=${v.dia}`).find(x => sobrepoe(x.inicio, x.fim, v.inicio, v.fim));
        if (choque) throw new Error(`Linha ${v.linha}: choque com a aula já cadastrada de ${choque.turma} (${choque.inicio}–${choque.fim}). Use "substituir a grade" ou corrija.`);
        await tx`INSERT INTO teacher_slots (employee_id, unit_id, dia_semana, inicio, fim, turno, turma, disciplina, space_id) VALUES (${v.employeeId}, ${v.unitId}, ${v.dia}, ${v.inicio}, ${v.fim}, ${turnoDe(v.inicio)}, ${v.turma}, ${v.disciplina}, ${v.spaceId})`; n++;
      }
    });
    await audit(s, "importar grade horária", "teacher_slots", null, null, { aulas: n, substituir, unidades: unidadesArq });
    msg = `${n} aula(s) importada(s)${substituir ? " (grade anterior das unidades substituída)" : ""}.`;
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}
