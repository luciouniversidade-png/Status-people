"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit, can, type Session } from "@/lib/auth";
import { audit, str, strOrNull, int, hoje, addDays, getSettings, fmtData, caminhoSeguro, localParaUtc } from "@/lib/utils";
import { notificar, usuariosPorPerfil } from "@/lib/comunicacao";
import { podePrivacidade, PEDIDO_TIPO, TITULAR_TIPO, PEDIDO_STATUS, INC_RISCO, INC_STATUS, CATEGORIAS_DADOS, EXIGE_IDENTIDADE, novoProtocolo, prazoIncidente } from "@/lib/privacidade";
import { comMensagem } from "@/lib/redirecionar";

const go = (b: string, k: "ok" | "erro", msg: string) => comMensagem(b, k, msg);
const back = (fd: FormData, fb: string) => caminhoSeguro(str(fd, "voltar"), fb);
const BP = "/governanca/privacidade";
const exigir = async (s: Session) => assert(await podePrivacidade(s), "Só a Direção, o RH e o encarregado (DPO) tratam privacidade.");
const hist = (h: unknown, s: Session, texto: string) => JSON.stringify([...((h as unknown[]) ?? []), { em: new Date().toISOString(), por: s.nome, texto }]);
/** Data e hora digitadas (horário da escola) — validadas; guarde com `utc()`, que converte para o instante em UTC usado pelo banco. */
const dataHora = (v: string | null) => { if (!v) return null; const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(v); if (!m) throw new Error("Data e hora inválidas."); return `${m[1]} ${m[2]}:00`; };
const utc = (local: string | null) => (local ? localParaUtc(local) : null);

export async function salvarConfigPrivacidade(fd: FormData) {
  const s = await requireSession();
  try {
    assert(can.configurar(s), "Só Direção/RH configuram a privacidade.");
    const dpo = int(fd, "dpoUserId"); if (dpo) { const [u] = await sql`SELECT 1 FROM users WHERE id=${dpo} AND ativo`; if (!u) throw new Error("Usuário do encarregado inválido."); }
    const email = strOrNull(fd, "encarregadoEmail"); if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("E-mail do encarregado inválido.");
    const prazo = Number(str(fd, "prazoPedidoDias")); if (!Number.isInteger(prazo) || prazo < 1 || prazo > 15) throw new Error("Prazo de resposta: de 1 a 15 dias (LGPD, art. 19).");
    const dias = Number(str(fd, "prazoIncidenteDiasUteis")); if (!Number.isInteger(dias) || dias < 1 || dias > 3) throw new Error("Prazo do incidente: de 1 a 3 dias úteis (Res. CD/ANPD nº 15/2024).");
    const v = { dpoUserId: dpo || null, encarregadoNome: str(fd, "encarregadoNome"), encarregadoEmail: email ?? "", encarregadoTelefone: str(fd, "encarregadoTelefone"), prazoPedidoDias: prazo, prazoIncidenteDiasUteis: dias, pequenoPorte: str(fd, "pequenoPorte") === "1" };
    await sql`INSERT INTO settings (key, value) VALUES ('privacidade', ${JSON.stringify(v)}::jsonb) ON CONFLICT (key) DO UPDATE SET value=settings.value || EXCLUDED.value`; await audit(s, "configurar privacidade", "settings", null, null, v);
  } catch (e) { redirect(go(BP, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(BP, "ok", "Configuração de privacidade salva."));
}

export async function salvarFinalidade(fd: FormData) {
  const s = await requireSession(); let msg = "";
  try {
    await exigir(s); const id = int(fd, "id"); const titulo = str(fd, "titulo"); const texto = str(fd, "texto");
    if (!titulo || texto.length < 30) throw new Error("Informe o título e o texto completo que o responsável vai ler (específico e em destaque).");
    const d = { titulo, texto, ativo: str(fd, "ativo") !== "0", naRematricula: str(fd, "naRematricula") !== "0", ordem: int(fd, "ordem") ?? 0 };
    if (id) {
      const [f] = await sql<{ texto: string; versao: number }[]>`SELECT texto, versao FROM consent_purposes WHERE id=${id}`; if (!f) throw new Error("Finalidade não encontrada.");
      const versao = f.texto === texto ? f.versao : f.versao + 1;
      await sql`UPDATE consent_purposes SET titulo=${titulo}, texto=${texto}, versao=${versao}, ativo=${d.ativo}, na_rematricula=${d.naRematricula}, ordem=${d.ordem}, updated_at=now() WHERE id=${id}`;
      msg = versao !== f.versao ? `Texto alterado: versão ${versao}. Autorizações anteriores continuam valendo para a versão que foi aceita.` : "Finalidade salva.";
    } else {
      const codigo = str(fd, "codigo").toUpperCase().replace(/[^A-Z0-9_]/g, "_"); if (codigo.length < 3) throw new Error("Código da finalidade (ex.: IMAGEM_EVENTOS).");
      const [dup] = await sql`SELECT 1 FROM consent_purposes WHERE codigo=${codigo}`; if (dup) throw new Error("Código já existe.");
      await sql`INSERT INTO consent_purposes (codigo, titulo, texto, ativo, na_rematricula, ordem) VALUES (${codigo}, ${titulo}, ${texto}, ${d.ativo}, ${d.naRematricula}, ${d.ordem})`; msg = "Finalidade criada.";
    }
    await audit(s, id ? "editar finalidade de consentimento" : "criar finalidade de consentimento", "consent_purposes", id, null, { titulo, ativo: d.ativo });
  } catch (e) { redirect(go(BP, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(BP, "ok", msg));
}

/** Registro pela secretaria (papel assinado, pedido do responsável). Revogação de algo que estava autorizado avisa quem publica (marketing) e a direção da unidade. */
export async function registrarConsentimento(fd: FormData) {
  const s = await requireSession(); const sid = int(fd, "studentId") ?? 0; const b = back(fd, `/matriculas/alunos/${sid}`); let msg = "";
  try {
    assert(can.reservar(s) || await podePrivacidade(s), "Seu acesso não registra autorizações.");
    const [st] = await sql<{ id: number; nome: string; unit_atual_id: number | null }[]>`SELECT id, nome, unit_atual_id FROM students WHERE id=${sid}`; if (!st) throw new Error("Aluno não encontrado.");
    const u = scopeUnit(s); if (u !== null && st.unit_atual_id !== u) throw new Error("Sem acesso a este aluno.");
    const [f] = await sql<{ id: number; titulo: string; versao: number; codigo: string }[]>`SELECT id, titulo, versao, codigo FROM consent_purposes WHERE id=${int(fd, "purposeId") ?? 0} AND ativo`; if (!f) throw new Error("Escolha a finalidade.");
    const status = str(fd, "status"); if (!["CONCEDIDO", "NEGADO", "REVOGADO"].includes(status)) throw new Error("Escolha a situação.");
    const titular = str(fd, "titularNome"); if (titular.split(/\s+/).filter(Boolean).length < 2) throw new Error("Nome completo do responsável que autorizou ou revogou.");
    const [ant] = await sql<{ status: string }[]>`SELECT status FROM consents WHERE student_id=${sid} AND purpose_id=${f.id} ORDER BY id DESC LIMIT 1`;
    if (status === "REVOGADO" && ant?.status !== "CONCEDIDO") throw new Error("Só se revoga o que estava autorizado.");
    await sql`INSERT INTO consents (student_id, purpose_id, versao, status, titular_nome, origem, evidencia, user_id, user_nome) VALUES (${sid}, ${f.id}, ${f.versao}, ${status}, ${titular}, ${str(fd, "origem") === "PEDIDO_TITULAR" ? "PEDIDO_TITULAR" : "SECRETARIA"}, ${JSON.stringify({ obs: strOrNull(fd, "obs"), pedido: int(fd, "pedidoId") })}::jsonb, ${s.id}, ${s.nome})`;
    await audit(s, `consentimento: ${status.toLowerCase()}`, "consents", sid, { status: ant?.status ?? null }, { finalidade: f.codigo, status });
    if (status === "REVOGADO") await notificar([...await usuariosPorPerfil(["COMERCIAL"]), ...(st.unit_atual_id ? await usuariosPorPerfil(["DIRETOR_UNIDADE"], st.unit_atual_id) : []), ...await usuariosPorPerfil(["DIRECAO"])], `Autorização revogada: ${st.nome}`, `${f.titulo}. Não usar em novas publicações e avaliar a retirada do que já foi publicado.`, `/governanca/privacidade/consentimentos?aluno=${sid}`, "ALERTA");
    msg = status === "REVOGADO" ? "Revogação registrada; marketing e direção avisados." : "Autorização registrada.";
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}

// ---------- Pedidos de titulares ----------
export async function registrarPedido(fd: FormData) {
  const s = await requireSession(); let id = 0;
  try {
    await exigir(s); const cfg = await getSettings();
    const tipo = str(fd, "tipo"); if (!PEDIDO_TIPO[tipo]) throw new Error("Escolha o tipo do pedido.");
    const titular = str(fd, "titularNome"); if (titular.length < 5) throw new Error("Nome do titular.");
    const titularTipo = str(fd, "titularTipo"); if (!TITULAR_TIPO[titularTipo]) throw new Error("Quem é o titular.");
    const recebido = str(fd, "recebidoEm") || hoje(); if (recebido > hoje()) throw new Error("Data de recebimento no futuro.");
    const protocolo = await novoProtocolo("LGPD", "privacy_requests", "protocolo");
    const [r] = await sql<{ id: number }[]>`INSERT INTO privacy_requests (protocolo, tipo, titular_nome, titular_tipo, aluno_nome, contato_email, contato_telefone, descricao, canal, student_id, employee_id, prazo, responsavel_user_id, historico, created_at) VALUES (${protocolo}, ${tipo}, ${titular}, ${titularTipo}, ${strOrNull(fd, "alunoNome")}, ${strOrNull(fd, "email")}, ${strOrNull(fd, "telefone")}, ${strOrNull(fd, "descricao")}, ${str(fd, "canal") || "EMAIL"}, ${int(fd, "studentId")}, ${int(fd, "employeeId")}, ${addDays(recebido, cfg.privacidade.prazoPedidoDias as number)}, ${s.id}, ${JSON.stringify([{ em: new Date().toISOString(), por: s.nome, texto: `Pedido registrado (recebido em ${fmtData(recebido)} por ${str(fd, "canal") || "e-mail"})` }])}::jsonb, ${`${recebido} 12:00:00`}) RETURNING id`;
    id = r.id; await audit(s, "registrar pedido de titular", "privacy_requests", id, null, { protocolo, tipo });
  } catch (e) { redirect(go(BP, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`${BP}/pedidos/${id}`, "ok", "Pedido registrado."));
}
export async function atualizarPedido(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const b = `${BP}/pedidos/${id}`; let msg = "";
  try {
    await exigir(s);
    const [p] = await sql<{ id: number; tipo: string; status: string; historico: unknown; identidade_verificada: boolean; responsavel_user_id: number | null; protocolo: string }[]>`SELECT id, tipo, status, historico, identidade_verificada, responsavel_user_id, protocolo FROM privacy_requests WHERE id=${id}`; if (!p) throw new Error("Pedido não encontrado.");
    const novo = str(fd, "status") || p.status; if (!PEDIDO_STATUS[novo]) throw new Error("Situação inválida.");
    if (["RESPONDIDA", "INDEFERIDA"].includes(p.status)) throw new Error("Pedido encerrado.");
    const ident = str(fd, "identidade") === "1" || p.identidade_verificada; const resposta = strOrNull(fd, "resposta"); const nota = strOrNull(fd, "nota");
    if (["RESPONDIDA", "INDEFERIDA"].includes(novo)) {
      if (!resposta || resposta.length < 20) throw new Error("Escreva a resposta ao titular (o que foi feito, ou por que não foi atendido).");
      if (novo === "RESPONDIDA" && EXIGE_IDENTIDADE.includes(p.tipo) && !ident) throw new Error("Confira a identidade do titular antes de entregar, corrigir ou apagar dados.");
    }
    const resp = int(fd, "responsavelUserId") ?? p.responsavel_user_id;
    const texto = [novo !== p.status ? `Situação: ${PEDIDO_STATUS[novo]}` : "", ident && !p.identidade_verificada ? "identidade conferida" : "", nota ?? ""].filter(Boolean).join(" · ") || "Atualização";
    await sql`UPDATE privacy_requests SET status=${novo}, identidade_verificada=${ident}, responsavel_user_id=${resp}, resposta=coalesce(${resposta}::text, resposta), respondida_em=${["RESPONDIDA", "INDEFERIDA"].includes(novo) ? sql`now()` : null}, historico=${hist(p.historico, s, texto)}::jsonb, updated_at=now() WHERE id=${id}`;
    if (resp && resp !== p.responsavel_user_id && resp !== s.id) await notificar([resp], `Pedido de titular ${p.protocolo} com você`, PEDIDO_TIPO[p.tipo], b, "ACAO");
    await audit(s, "atualizar pedido de titular", "privacy_requests", id, { status: p.status }, { status: novo, identidade: ident }); msg = "Pedido atualizado.";
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}

// ---------- Incidentes ----------
export async function registrarIncidente(fd: FormData) {
  const s = await requireSession(); let id = 0;
  try {
    await exigir(s);
    const titulo = str(fd, "titulo"); if (titulo.length < 5) throw new Error("Descreva o incidente em uma linha.");
    const ciencia = dataHora(strOrNull(fd, "cienciaEm")); if (!ciencia) throw new Error("Informe quando a escola tomou ciência (o prazo conta daí).");
    if (ciencia.slice(0, 10) > hoje()) throw new Error("Ciência no futuro.");
    const detectado = dataHora(strOrNull(fd, "detectadoEm"));
    const cats = fd.getAll("categorias").map(String).filter(c => CATEGORIAS_DADOS.includes(c));
    const unitId = int(fd, "unitId"); if (unitId) { const u = scopeUnit(s); if (u !== null && u !== unitId) throw new Error("Sem acesso a esta unidade."); }
    const prazo = await prazoIncidente(ciencia); const codigo = await novoProtocolo("INC", "privacy_incidents", "codigo");
    const [r] = await sql<{ id: number }[]>`INSERT INTO privacy_incidents (codigo, titulo, descricao, unit_id, detectado_em, ciencia_em, categorias_dados, titulares_estimados, envolve_criancas, dados_sensiveis, prazo_anpd, medidas, responsavel_user_id, historico, created_by) VALUES (${codigo}, ${titulo}, ${strOrNull(fd, "descricao")}, ${unitId}, ${utc(detectado)}, ${utc(ciencia)}, ${JSON.stringify(cats)}::jsonb, ${int(fd, "titulares")}, ${str(fd, "criancas") === "1"}, ${str(fd, "sensiveis") === "1"}, ${prazo}, ${strOrNull(fd, "medidas")}, ${s.id}, ${JSON.stringify([{ em: new Date().toISOString(), por: s.nome, texto: `Registrado; prazo de comunicação ${fmtData(prazo)}` }])}::jsonb, ${s.id}) RETURNING id`;
    id = r.id; await audit(s, "registrar incidente de dados", "privacy_incidents", id, null, { codigo, prazo });
    // aviso sem o conteúdo do incidente (vai também para o celular): só o código e o prazo, para quem trata privacidade
    const cfgp = (await getSettings()).privacidade;
    await notificar([...await usuariosPorPerfil(cfgp.perfis as string[]), ...(cfgp.dpoUserId ? [cfgp.dpoUserId as number] : [])].filter(u => u !== s.id), `Incidente de dados registrado: ${codigo}`, `Avaliar o risco e decidir a comunicação à ANPD e aos titulares até ${fmtData(prazo)}.`, `${BP}/incidentes/${id}`, "ALERTA");
  } catch (e) { redirect(go(BP, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`${BP}/incidentes/${id}`, "ok", "Incidente registrado. Avalie o risco e decida a comunicação dentro do prazo."));
}
export async function atualizarIncidente(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const b = `${BP}/incidentes/${id}`; let msg = "";
  try {
    await exigir(s);
    const [i] = await sql<{ id: number; status: string; risco: string; comunicar: boolean | null; comunicado_anpd_em: string | null; historico: unknown; justificativa_nao_comunicar: string | null }[]>`SELECT id, status, risco, comunicar, comunicado_anpd_em::text, historico, justificativa_nao_comunicar FROM privacy_incidents WHERE id=${id}`; if (!i) throw new Error("Incidente não encontrado.");
    if (i.status === "ENCERRADO") throw new Error("Incidente encerrado: o registro é mantido sem alterações.");
    const risco = str(fd, "risco") || i.risco; if (!INC_RISCO[risco]) throw new Error("Risco inválido.");
    const decisao = str(fd, "comunicar"); const comunicar = decisao === "1" ? true : decisao === "0" ? false : i.comunicar;
    const just = strOrNull(fd, "justificativa") ?? i.justificativa_nao_comunicar;
    if (comunicar === false && (!just || just.length < 20)) throw new Error("Decidir não comunicar exige justificativa (por que não há risco ou dano relevante).");
    if (risco === "RELEVANTE" && comunicar === false) throw new Error("Com risco ou dano relevante, a comunicação à ANPD e aos titulares é obrigatória.");
    const anpd = dataHora(strOrNull(fd, "comunicadoAnpdEm")); const tit = dataHora(strOrNull(fd, "comunicadoTitularesEm"));
    const novo = str(fd, "status") || i.status; if (!INC_STATUS[novo]) throw new Error("Situação inválida.");
    if (novo === "ENCERRADO") {
      if (risco === "EM_AVALIACAO") throw new Error("Antes de encerrar, registre a avaliação de risco.");
      if (comunicar === null) throw new Error("Antes de encerrar, registre a decisão sobre a comunicação.");
      if (comunicar && !(anpd ?? i.comunicado_anpd_em)) throw new Error("Antes de encerrar, registre quando a ANPD foi comunicada.");
    }
    const nota = [risco !== i.risco ? `Risco: ${INC_RISCO[risco]}` : "", decisao ? `Decisão: ${comunicar ? "comunicar ANPD e titulares" : "não comunicar (justificado)"}` : "", anpd ? "ANPD comunicada" : "", tit ? "titulares comunicados" : "", novo !== i.status ? `Situação: ${INC_STATUS[novo]}` : "", strOrNull(fd, "nota") ?? ""].filter(Boolean).join(" · ") || "Atualização";
    await sql`UPDATE privacy_incidents SET risco=${risco}, comunicar=${comunicar}, justificativa_nao_comunicar=${just}, comunicado_anpd_em=coalesce(${utc(anpd)}::timestamp, comunicado_anpd_em), comunicado_titulares_em=coalesce(${utc(tit)}::timestamp, comunicado_titulares_em), medidas=coalesce(${strOrNull(fd, "medidas")}::text, medidas), causa=coalesce(${strOrNull(fd, "causa")}::text, causa), status=${novo}, encerrado_em=${novo === "ENCERRADO" ? sql`now()` : null}, historico=${hist(i.historico, s, nota)}::jsonb, updated_at=now() WHERE id=${id}`;
    await audit(s, "atualizar incidente de dados", "privacy_incidents", id, { status: i.status, risco: i.risco }, { status: novo, risco, comunicar }); msg = "Incidente atualizado.";
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}
