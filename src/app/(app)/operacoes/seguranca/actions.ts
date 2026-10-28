"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit, can, type Session } from "@/lib/auth";
import { audit, str, strOrNull, int, hoje, addMonths, getSettings, fmtData, caminhoSeguro } from "@/lib/utils";
import { notificar, usuariosPorPerfil } from "@/lib/comunicacao";
import { VISITA_TIPO, FUNCAO_BRIGADA, GRAVIDADE, GESTAO_SEG, conferirRetirada, gruposChamada, podePortaria, normNome } from "@/lib/seguranca";
import { comMensagem } from "@/lib/redirecionar";

const go = (b: string, k: "ok" | "erro", msg: string) => comMensagem(b, k, msg);
const back = (fd: FormData, fb: string) => caminhoSeguro(str(fd, "voltar"), fb);
const naUnidade = (s: Session, unitId: number) => { const u = scopeUnit(s); if (u !== null && u !== unitId) throw new Error("Sem acesso a esta unidade."); };
const horaAgora = () => new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Campo_Grande", hour: "2-digit", minute: "2-digit" });
const gestaoUnidade = async (unitId: number) => [...await usuariosPorPerfil(["DIRETOR_UNIDADE", "GESTOR"], unitId), ...await usuariosPorPerfil(["DIRECAO"])];

// ---------- Visitantes ----------
export async function registrarVisita(fd: FormData) {
  const s = await requireSession(); const b = back(fd, "/operacoes/seguranca");
  try {
    assert(await podePortaria(s), "Seu acesso não opera a portaria.");
    const unitId = int(fd, "unitId") ?? scopeUnit(s) ?? 0; naUnidade(s, unitId); const [u] = await sql`SELECT 1 FROM units WHERE id=${unitId}`; if (!u) throw new Error("Escolha a unidade.");
    const tipo = str(fd, "tipo"); const nome = str(fd, "nome"); if (!VISITA_TIPO[tipo]) throw new Error("Escolha o tipo."); if (nome.length < 3) throw new Error("Informe o nome de quem entra.");
    const [v] = await sql<{ id: number }[]>`INSERT INTO visits (unit_id, tipo, nome, documento, empresa, motivo, visitado, cracha, registrado_por) VALUES (${unitId}, ${tipo}, ${nome}, ${strOrNull(fd, "documento")}, ${strOrNull(fd, "empresa")}, ${strOrNull(fd, "motivo")}, ${strOrNull(fd, "visitado")}, ${strOrNull(fd, "cracha")}, ${s.id}) RETURNING id`;
    await audit(s, "entrada de visitante", "visits", v.id, null, { tipo, unitId });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Entrada registrada."));
}
export async function registrarSaidaVisita(fd: FormData) {
  const s = await requireSession(); const b = back(fd, "/operacoes/seguranca");
  try {
    assert(await podePortaria(s), "Seu acesso não opera a portaria.");
    const [v] = await sql<{ id: number; unit_id: number; saida: string | null }[]>`SELECT id, unit_id, saida::text FROM visits WHERE id=${int(fd, "id") ?? 0}`; if (!v) throw new Error("Registro não encontrado."); naUnidade(s, v.unit_id); if (v.saida) throw new Error("Saída já registrada.");
    await sql`UPDATE visits SET saida=now(), saida_por=${s.id} WHERE id=${v.id}`;
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Saída registrada."));
}

// ---------- Quem pode buscar ----------
export async function salvarAutorizacao(fd: FormData) {
  const s = await requireSession(); const sid = int(fd, "studentId") ?? 0; const b = back(fd, `/matriculas/alunos/${sid}`);
  try {
    const [st] = await sql<{ unit_atual_id: number | null }[]>`SELECT unit_atual_id FROM students WHERE id=${sid}`; if (!st) throw new Error("Aluno não encontrado.");
    if (st.unit_atual_id) naUnidade(s, st.unit_atual_id); else if (scopeUnit(s) !== null) throw new Error("Sem acesso a este aluno.");
    const tipo = str(fd, "tipo") === "PROIBIDO" ? "PROIBIDO" : "AUTORIZADO";
    assert(tipo === "PROIBIDO" ? GESTAO_SEG.includes(s.role) : (can.reservar(s) || await podePortaria(s)), tipo === "PROIBIDO" ? "Restrição de retirada só é registrada pela coordenação ou direção." : "Sem permissão.");
    const nome = str(fd, "nome"); if (normNome(nome).split(" ").length < 2) throw new Error("Informe o nome completo.");
    const validade = strOrNull(fd, "validade"); if (validade && validade < hoje()) throw new Error("Validade no passado.");
    if (tipo === "PROIBIDO" && !strOrNull(fd, "restricaoObs")) throw new Error("Registre a base da restrição (ex.: decisão judicial, pedido formal do responsável legal).");
    const [dup] = await sql`SELECT 1 FROM pickup_authorizations WHERE student_id=${sid} AND ativo AND tipo=${tipo} AND lower(nome)=lower(${nome})`; if (dup) throw new Error("Esta pessoa já está na lista.");
    const [a] = await sql<{ id: number }[]>`INSERT INTO pickup_authorizations (student_id, nome, parentesco, documento, telefone, tipo, validade, restricao_obs, created_by) VALUES (${sid}, ${nome}, ${strOrNull(fd, "parentesco")}, ${strOrNull(fd, "documento")}, ${strOrNull(fd, "telefone")}, ${tipo}, ${validade}, ${tipo === "PROIBIDO" ? strOrNull(fd, "restricaoObs") : null}, ${s.id}) RETURNING id`;
    await audit(s, tipo === "PROIBIDO" ? "registrar restrição de retirada" : "autorizar retirada", "pickup_authorizations", a.id, null, { studentId: sid, tipo });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Lista de retirada atualizada."));
}
export async function desativarAutorizacao(fd: FormData) {
  const s = await requireSession(); const b = back(fd, "/matriculas/alunos");
  try {
    const [a] = await sql<{ id: number; tipo: string; unit: number | null }[]>`SELECT a.id, a.tipo, st.unit_atual_id AS unit FROM pickup_authorizations a JOIN students st ON st.id=a.student_id WHERE a.id=${int(fd, "id") ?? 0}`; if (!a) throw new Error("Registro não encontrado.");
    if (a.unit) naUnidade(s, a.unit); assert(a.tipo === "PROIBIDO" ? GESTAO_SEG.includes(s.role) : (can.reservar(s) || await podePortaria(s)), "Só a coordenação ou a direção retiram uma restrição.");
    await sql`UPDATE pickup_authorizations SET ativo=false, updated_at=now() WHERE id=${a.id}`; await audit(s, "desativar autorização de retirada", "pickup_authorizations", a.id, null, { tipo: a.tipo, motivo: strOrNull(fd, "motivo") });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Removido da lista."));
}

/** Saída antecipada (ou entrega à família numa emergência): restrição bloqueia sempre; pessoa fora da lista só com exceção da coordenação/direção, justificada. */
export async function registrarRetirada(fd: FormData) {
  const s = await requireSession(); const b = back(fd, "/operacoes/seguranca"); let msg = ""; let bloqueio = "";
  try {
    assert(await podePortaria(s), "Seu acesso não opera a portaria.");
    const [st] = await sql<{ id: number; nome: string; unit_atual_id: number | null; aluno_atual: boolean }[]>`SELECT id, nome, unit_atual_id, aluno_atual FROM students WHERE id=${int(fd, "studentId") ?? 0}`;
    if (!st || !st.aluno_atual || !st.unit_atual_id) throw new Error("Aluno não encontrado entre os alunos atuais."); naUnidade(s, st.unit_atual_id);
    const eventId = int(fd, "eventId");
    if (eventId) { const [ev] = await sql<{ unit_id: number; status: string }[]>`SELECT unit_id, status FROM emergency_events WHERE id=${eventId}`; if (!ev || ev.unit_id !== st.unit_atual_id) throw new Error("Evento de outra unidade."); if (ev.status !== "EM_ANDAMENTO") throw new Error("O evento já foi encerrado."); }
    const [ja] = await sql`SELECT 1 FROM early_departures WHERE student_id=${st.id} AND data=${hoje()} AND status='LIBERADA'`; if (ja) throw new Error(`${st.nome} já saiu hoje (veja a lista do dia).`);
    const authId = int(fd, "authorizationId"); let nome = str(fd, "retiradoPor"); const documento = strOrNull(fd, "documento");
    let conf: Awaited<ReturnType<typeof conferirRetirada>>;
    if (authId) { const [a] = await sql<{ nome: string; documento: string | null }[]>`SELECT nome, documento FROM pickup_authorizations WHERE id=${authId} AND student_id=${st.id}`; if (!a) throw new Error("Pessoa não encontrada na lista deste aluno."); nome = a.nome; conf = await conferirRetirada(st.id, a.nome, documento ?? a.documento); }
    else { if (normNome(nome).split(" ").length < 2) throw new Error("Informe o nome completo de quem está retirando."); conf = await conferirRetirada(st.id, nome, documento); }
    const base = { student_id: st.id, unit_id: st.unit_atual_id, nome, documento, motivo: strOrNull(fd, "motivo"), avisado: str(fd, "avisado") === "1" };
    if (conf.status === "PROIBIDO") {
      const [r] = await sql<{ id: number }[]>`INSERT INTO early_departures (student_id, unit_id, data, hora, retirado_por, documento, authorization_id, status, motivo, registrado_por, registrado_nome, emergency_event_id) VALUES (${base.student_id}, ${base.unit_id}, ${hoje()}, ${horaAgora()}, ${nome}, ${documento}, ${conf.autorizacao!.id}, 'BLOQUEADA', ${base.motivo}, ${s.id}, ${s.nome}, ${eventId}) RETURNING id`;
      await audit(s, "retirada bloqueada (restrição)", "early_departures", r.id, null, { studentId: st.id });
      await notificar(await gestaoUnidade(st.unit_atual_id), `Retirada BLOQUEADA: ${st.nome}`, `Pessoa com restrição tentou retirar o aluno (${horaAgora()}). Acione a coordenação/direção.`, `/operacoes/seguranca?studentId=${st.id}`, "ALERTA");
      bloqueio = "Retirada BLOQUEADA: esta pessoa tem restrição para retirar o aluno. Não entregue — acione a coordenação ou a direção."; throw new Error(bloqueio);
    }
    let excecao: string | null = null; let autorizadoPor: number | null = null;
    if (conf.status === "NAO_CADASTRADO") {
      excecao = strOrNull(fd, "excecao");
      if (!GESTAO_SEG.includes(s.role)) throw new Error("Pessoa fora da lista de autorizados: só a coordenação ou a direção liberam, com justificativa (ex.: confirmação por telefone com o responsável).");
      if (!excecao || excecao.length < 10) throw new Error("Pessoa fora da lista: escreva a justificativa da exceção (quem confirmou, como e quando).");
      autorizadoPor = s.id;
    }
    const [r] = await sql<{ id: number }[]>`INSERT INTO early_departures (student_id, unit_id, data, hora, retirado_por, documento, authorization_id, status, motivo, excecao_justificativa, autorizado_por, registrado_por, registrado_nome, responsavel_avisado, emergency_event_id) VALUES (${base.student_id}, ${base.unit_id}, ${hoje()}, ${horaAgora()}, ${nome}, ${documento}, ${conf.autorizacao?.id ?? null}, 'LIBERADA', ${base.motivo}, ${excecao}, ${autorizadoPor}, ${s.id}, ${s.nome}, ${base.avisado}, ${eventId}) RETURNING id`;
    await audit(s, eventId ? "entrega à família (emergência)" : "saída antecipada", "early_departures", r.id, null, { studentId: st.id, excecao: !!excecao });
    if (excecao) await notificar(await gestaoUnidade(st.unit_atual_id), `Saída por exceção: ${st.nome}`, `Retirado por ${nome}, fora da lista. Justificativa: ${excecao}`, `/operacoes/seguranca?studentId=${st.id}`, "INFO");
    msg = `${st.nome} liberado(a) com ${nome}${excecao ? " (exceção registrada)" : ""}.`;
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}

// ---------- Brigada ----------
export async function salvarBrigadista(fd: FormData) {
  const s = await requireSession(); const b = "/operacoes/seguranca/brigada";
  try {
    assert(can.operacoes(s) || s.role === "RH", "Sem permissão para a brigada.");
    const id = int(fd, "id"); const employeeId = int(fd, "employeeId") ?? 0;
    // edição: o registro precisa ser da unidade de quem edita (não basta a unidade nova informada)
    if (id) { const [atual] = await sql<{ unit_id: number }[]>`SELECT unit_id FROM brigade_members WHERE id=${id}`; if (!atual) throw new Error("Brigadista não encontrado."); naUnidade(s, atual.unit_id); }
    const [e] = await sql<{ unit_id: number; situacao: string }[]>`SELECT unit_id, situacao FROM employees WHERE id=${employeeId}`; if (!e || e.situacao === "DESLIGADO") throw new Error("Colaborador não encontrado.");
    naUnidade(s, e.unit_id); const unitId = int(fd, "unitId") ?? e.unit_id; naUnidade(s, unitId);
    const funcao = str(fd, "funcao") || "BRIGADISTA"; if (!FUNCAO_BRIGADA[funcao]) throw new Error("Função inválida.");
    const tr = strOrNull(fd, "treinamentoEm"); if (tr && tr > hoje()) throw new Error("Data de treinamento no futuro.");
    const validade = strOrNull(fd, "validade") ?? (tr ? addMonths(tr, 12) : null);
    if (id) await sql`UPDATE brigade_members SET employee_id=${employeeId}, unit_id=${unitId}, funcao=${funcao}, turno=${strOrNull(fd, "turno")}, treinamento_em=${tr}, validade=${validade}, ativo=${str(fd, "ativo") !== "0"}, obs=${strOrNull(fd, "obs")} WHERE id=${id}`;
    else { const [dup] = await sql`SELECT 1 FROM brigade_members WHERE employee_id=${employeeId} AND unit_id=${unitId} AND ativo`; if (dup) throw new Error("Já está na brigada desta unidade.");
      await sql`INSERT INTO brigade_members (employee_id, unit_id, funcao, turno, treinamento_em, validade, obs) VALUES (${employeeId}, ${unitId}, ${funcao}, ${strOrNull(fd, "turno")}, ${tr}, ${validade}, ${strOrNull(fd, "obs")})`; }
    await audit(s, id ? "editar brigadista" : "incluir brigadista", "brigade_members", id, null, { employeeId, unitId, funcao, validade });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Brigada atualizada."));
}

// ---------- Simulados e emergências ----------
export async function iniciarEmergencia(fd: FormData) {
  const s = await requireSession(); let id = 0;
  try {
    assert(await podePortaria(s) || can.operacoes(s), "Seu acesso não inicia simulados ou emergências.");
    const cfg = await getSettings(); const unitId = int(fd, "unitId") ?? scopeUnit(s) ?? 0; naUnidade(s, unitId);
    const tipo = str(fd, "tipo") === "REAL" ? "REAL" : "SIMULADO"; const cenario = str(fd, "cenario"); if (!cenario) throw new Error("Escolha o cenário.");
    const [ab] = await sql`SELECT 1 FROM emergency_events WHERE unit_id=${unitId} AND status='EM_ANDAMENTO'`; if (ab) throw new Error("Já há um evento em andamento nesta unidade: encerre-o antes.");
    const grupos = await gruposChamada(unitId);
    id = await sql.begin(async tx => {
      const [ev] = await tx<{ id: number }[]>`INSERT INTO emergency_events (unit_id, tipo, cenario, pontos_encontro, observacoes, meta_seg, coordenador_user_id, created_by) VALUES (${unitId}, ${tipo}, ${cenario}, ${strOrNull(fd, "pontosEncontro")}, ${strOrNull(fd, "observacoes")}, ${(cfg.portaria.metaEvacuacaoMin as number) * 60}, ${s.id}, ${s.id}) RETURNING id`;
      for (const [k, g] of grupos.entries()) await tx`INSERT INTO emergency_checks (event_id, grupo, ordem, esperado) VALUES (${ev.id}, ${g.grupo}, ${k}, ${g.esperado})`;
      return ev.id;
    });
    await audit(s, tipo === "REAL" ? "iniciar emergência" : "iniciar simulado", "emergency_events", id, null, { unitId, cenario, grupos: grupos.length });
    const [u] = await sql<{ nome: string }[]>`SELECT nome FROM units WHERE id=${unitId}`;
    if (tipo === "REAL") await notificar([...await gestaoUnidade(unitId), ...await usuariosPorPerfil(["RH", "OPERACOES"])], `EMERGÊNCIA em ${u.nome}: ${cenario}`, "Chamada por turma em andamento no sistema. Acompanhe e apoie a entrega às famílias.", `/operacoes/seguranca/emergencias/${id}`, "ALERTA");
    else await notificar(await usuariosPorPerfil(["DIRETOR_UNIDADE", "GESTOR"], unitId), `Simulado de abandono em ${u.nome}`, `${cenario} — registre a chamada de cada turma no ponto de encontro.`, `/operacoes/seguranca/emergencias/${id}`, "INFO");
  } catch (e) { redirect(go("/operacoes/seguranca/emergencias", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(`/operacoes/seguranca/emergencias/${id}`);
}
async function eventoAberto(s: Session, id: number) {
  const [ev] = await sql<{ id: number; unit_id: number; status: string; tipo: string; inicio: string; cenario: string }[]>`SELECT id, unit_id, status, tipo, inicio::text, cenario FROM emergency_events WHERE id=${id}`;
  if (!ev) throw new Error("Evento não encontrado."); naUnidade(s, ev.unit_id); if (ev.status !== "EM_ANDAMENTO") throw new Error("Evento encerrado."); return ev;
}
/** Chamada do grupo no ponto de encontro. Quando o último grupo é conferido, o tempo de evacuação é gravado. */
export async function registrarChamada(fd: FormData) {
  const s = await requireSession(); const [c] = await sql<{ id: number; event_id: number; esperado: number | null; grupo: string }[]>`SELECT id, event_id, esperado, grupo FROM emergency_checks WHERE id=${int(fd, "id") ?? 0}`; const b = `/operacoes/seguranca/emergencias/${c?.event_id ?? ""}`;
  try {
    if (!c) throw new Error("Grupo não encontrado."); assert(s.role !== "LEITURA" && s.role !== "COLABORADOR", "Sem permissão."); const ev = await eventoAberto(s, c.event_id);
    const todos = str(fd, "todos") === "1";
    const num0 = (k: string) => { const v = str(fd, k); if (v === "") return 0; const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 5000) throw new Error("Use números inteiros (0 ou mais)."); return n; };
    const presentes = todos ? (c.esperado ?? 0) : num0("presentes"); const feridos = todos ? 0 : num0("feridos"); const nao = todos ? 0 : num0("naoLocalizados");
    if (!todos && str(fd, "presentes") === "") throw new Error("Informe quantos estão presentes no ponto de encontro.");
    const status = feridos || nao ? "OCORRENCIA" : "SEGURO";
    await sql`UPDATE emergency_checks SET presentes=${presentes}, feridos=${feridos}, nao_localizados=${nao}, status=${status}, responsavel=${strOrNull(fd, "responsavel")}, obs=${strOrNull(fd, "obs")}, checado_em=now(), checado_por=${s.nome} WHERE id=${c.id}`;
    const [{ pend }] = await sql<{ pend: number }[]>`SELECT count(*)::int AS pend FROM emergency_checks WHERE event_id=${ev.id} AND status='PENDENTE'`;
    if (!pend) await sql`UPDATE emergency_events SET evacuacao_em=now(), tempo_evacuacao_seg=extract(epoch FROM now() - inicio)::int WHERE id=${ev.id} AND evacuacao_em IS NULL`;
    if (nao && ev.tipo === "REAL") await notificar(await gestaoUnidade(ev.unit_id), `NÃO LOCALIZADOS: ${c.grupo}`, `${nao} pessoa(s) não localizada(s) no ponto de encontro.`, `/operacoes/seguranca/emergencias/${ev.id}`, "ALERTA");
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(b + "#grupos");
}
export async function adicionarGrupo(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "eventId") ?? 0; const b = `/operacoes/seguranca/emergencias/${id}`;
  try { assert(s.role !== "LEITURA" && s.role !== "COLABORADOR"); await eventoAberto(s, id); const grupo = str(fd, "grupo"); if (!grupo) throw new Error("Nome do grupo.");
    const [{ o }] = await sql<{ o: number }[]>`SELECT coalesce(max(ordem), 0)::int + 1 AS o FROM emergency_checks WHERE event_id=${id}`;
    await sql`INSERT INTO emergency_checks (event_id, grupo, ordem, esperado) VALUES (${id}, ${grupo}, ${o}, ${int(fd, "esperado")})`; await sql`UPDATE emergency_events SET evacuacao_em=NULL, tempo_evacuacao_seg=NULL WHERE id=${id}`;
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Grupo incluído na chamada."));
}
export async function registrarFalha(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "eventId") ?? 0; const b = `/operacoes/seguranca/emergencias/${id}`; let msg = "";
  try {
    assert(s.role !== "LEITURA" && s.role !== "COLABORADOR");
    const [ev] = await sql<{ id: number; unit_id: number; tipo: string; cenario: string; inicio: string }[]>`SELECT id, unit_id, tipo, cenario, inicio::date::text AS inicio FROM emergency_events WHERE id=${id}`; if (!ev) throw new Error("Evento não encontrado."); naUnidade(s, ev.unit_id);
    const descricao = str(fd, "descricao"); if (descricao.length < 5) throw new Error("Descreva a falha observada."); const grav = str(fd, "gravidade") || "MEDIA"; if (!GRAVIDADE[grav]) throw new Error("Gravidade inválida.");
    let acao: number | null = null;
    if (str(fd, "criarAcao") === "1") {
      const resp = int(fd, "responsavelUserId"); const prazo = strOrNull(fd, "prazo"); if (!resp || !prazo) throw new Error("Para criar a ação, informe responsável e prazo."); if (prazo < hoje()) throw new Error("Prazo no passado.");
      const [u] = await sql<{ role: string; unit_id: number | null }[]>`SELECT role, unit_id FROM users WHERE id=${resp} AND ativo`; if (!u || ["LEITURA", "COLABORADOR"].includes(u.role) || (u.unit_id !== null && u.unit_id !== ev.unit_id)) throw new Error("Responsável inválido para esta unidade.");
      const [a] = await sql<{ id: number }[]>`INSERT INTO action_plans (titulo, porque, unit_id, prazo, responsavel_user_id, origem, created_by) VALUES (${`Corrigir: ${descricao}`.slice(0, 200)}, ${`Falha (${GRAVIDADE[grav].toLowerCase()}) no ${ev.tipo === "REAL" ? "atendimento à emergência" : "simulado de abandono"} — ${ev.cenario}, ${fmtData(ev.inicio)}`}, ${ev.unit_id}, ${prazo}, ${resp}, ${`${ev.tipo === "REAL" ? "Emergência" : "Simulado"} #${ev.id}`}, ${s.id}) RETURNING id`;
      acao = a.id; await notificar([resp], "Nova ação do plano (segurança)", `Corrigir: ${descricao} — prazo ${fmtData(prazo)}`, `/estrategia/acoes/${a.id}`, "ACAO");
    }
    await sql`INSERT INTO emergency_failures (event_id, descricao, gravidade, action_plan_id, created_by) VALUES (${id}, ${descricao}, ${grav}, ${acao}, ${s.id})`;
    await audit(s, "falha em simulado/emergência", "emergency_events", id, null, { descricao, grav, acao }); msg = acao ? "Falha registrada e ação criada no plano de ação." : "Falha registrada.";
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg) + "#falhas");
}
export async function encerrarEmergencia(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "eventId") ?? 0; const b = `/operacoes/seguranca/emergencias/${id}`;
  try {
    assert(s.role !== "LEITURA" && s.role !== "COLABORADOR"); const ev = await eventoAberto(s, id);
    const [{ pend, nao }] = await sql<{ pend: number; nao: number }[]>`SELECT count(*) FILTER (WHERE status='PENDENTE')::int AS pend, coalesce(sum(nao_localizados), 0)::int AS nao FROM emergency_checks WHERE event_id=${id}`;
    const just = strOrNull(fd, "justificativa");
    if ((pend || nao) && (!just || just.length < 10)) throw new Error(pend ? `${pend} grupo(s) sem chamada: justifique o encerramento.` : `Há ${nao} pessoa(s) não localizada(s): registre o desfecho antes de encerrar.`);
    await sql`UPDATE emergency_events SET status='ENCERRADO', encerrado_em=now(), observacoes=concat_ws(E'\n', observacoes, ${strOrNull(fd, "observacoes")}::text, ${just ? `Encerramento: ${just}` : null}::text) WHERE id=${id}`;
    await audit(s, ev.tipo === "REAL" ? "encerrar emergência" : "encerrar simulado", "emergency_events", id, null, { pendentes: pend, naoLocalizados: nao });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Evento encerrado."));
}
