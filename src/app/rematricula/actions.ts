"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { str, strOrNull, int, hoje, addDays, getSettings, auditComo, fmtDataHora } from "@/lib/utils";
import { notificar, usuariosPorPerfil } from "@/lib/comunicacao";
import { slaAte } from "@/lib/atendimento";
import { origemRequisicao } from "@/lib/url";
import { erroAssinado } from "@/lib/aviso";
import { opcoesTurmas, contratoDoLink, sha256, cpfValido, soDigitos, MOTIVOS_RECUSA, type Rascunho } from "@/lib/rematricula";

const CANAL = "Família (link de rematrícula)";
const volta = (token: string, q: string) => `/rematricula/${encodeURIComponent(token)}${q}`;
const erroQ = (e: unknown) => `?${erroAssinado(e instanceof Error ? e.message : "Não foi possível concluir. Tente de novo.")}`;
type Link = { id: number; student_id: number; ano: number; unit_id: number | null; grade_id: number | null; status: string; expira_em: string; rascunho: Rascunho | null; criado_por: number | null };

async function linkAtivo(token: string, lock = false, tx: typeof sql = sql): Promise<Link> {
  const rows = lock
    ? await tx<Link[]>`SELECT id, student_id, ano, unit_id, grade_id, status, expira_em::text, rascunho, criado_por FROM rematricula_links WHERE token=${token} FOR UPDATE`
    : await tx<Link[]>`SELECT id, student_id, ano, unit_id, grade_id, status, expira_em::text, rascunho, criado_por FROM rematricula_links WHERE token=${token}`;
  const l = rows[0];
  if (!l) throw new Error("Link inválido.");
  if (l.status === "CONCLUIDA") throw new Error("Esta rematrícula já foi concluída.");
  if (l.status !== "PENDENTE" || l.expira_em < hoje()) throw new Error("Este link não está mais ativo. Fale com a secretaria para receber um novo.");
  return l;
}
const telefoneOk = (v: string) => { const d = soDigitos(v); return d.length >= 10 && d.length <= 13; };

/** Etapa 1: confere os dados do responsável e escolhe a turma (e, se quiser, o Integral). A vaga é conferida de novo no aceite. */
export async function escolherRematricula(fd: FormData) {
  const token = str(fd, "token");
  try {
    const l = await linkAtivo(token); const cfg = await getSettings();
    const responsavel = str(fd, "responsavel"); const telefone = str(fd, "telefone"); const email = strOrNull(fd, "email");
    if (responsavel.split(/\s+/).filter(Boolean).length < 2) throw new Error("Informe o nome completo do responsável financeiro.");
    if (!telefoneOk(telefone)) throw new Error("Informe um telefone com DDD.");
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("E-mail inválido.");
    const classId = int(fd, "classId"); if (!classId) throw new Error("Escolha a turma.");
    const integralClassId = int(fd, "integralClassId") || null;
    const op = await opcoesTurmas(l); const t = op.regulares.find(x => x.id === classId);
    if (!t) throw new Error("Turma indisponível para esta rematrícula.");
    if (t.livres <= 0) throw new Error(`A turma ${t.nome} (${t.turno}) está sem vaga. Escolha outra ou fale com a secretaria para entrar na lista de espera.`);
    if (integralClassId) {
      const i = op.integrais.find(x => x.id === integralClassId); if (!i || i.unit_id !== t.unit_id) throw new Error("Grupo do Integral indisponível para esta série e unidade.");
      if (i.livres <= 0) throw new Error(`O grupo ${i.nome} está sem vaga. Escolha outro ou siga sem o Integral.`);
      if (cfg.rematricula.integralContraturno && i.turno === t.turno) throw new Error(`O Integral acontece no contraturno: com a turma da ${t.turno.toLowerCase()}, escolha um grupo de outro turno.`);
    }
    const r: Rascunho = { classId, integralClassId, responsavel, telefone, email };
    await sql`UPDATE rematricula_links SET rascunho=${JSON.stringify(r)}::jsonb, class_id=${classId}, integral_class_id=${integralClassId}, updated_at=now() WHERE id=${l.id} AND status='PENDENTE'`;
  } catch (e) { redirect(volta(token, erroQ(e))); }
  redirect(volta(token, "?etapa=contrato"));
}

/** Etapa 2: aceite do contrato (nome + CPF do responsável financeiro), consentimentos opcionais, reserva da vaga com contrato assinado. */
export async function aceitarRematricula(fd: FormData) {
  const token = str(fd, "token"); const meta = await origemRequisicao(); let ok = false;
  try {
    const cfg = await getSettings(); const h = hoje();
    const pre = await linkAtivo(token);
    const [{ falhas }] = await sql<{ falhas: number }[]>`SELECT count(*)::int AS falhas FROM login_attempts WHERE email=${`REMATRICULA:${pre.id}`} AND ok=false AND at > now() - interval '15 minutes'`;
    if (falhas >= 5) throw new Error("Muitas tentativas com CPF que não confere. Aguarde 15 minutos ou fale com a secretaria.");
    if (str(fd, "aceito") !== "1") throw new Error("Para concluir, marque que leu e aceita o contrato.");
    const nome = str(fd, "assinatura"); if (nome.split(/\s+/).filter(Boolean).length < 2) throw new Error("Digite o nome completo do responsável financeiro como assinatura.");
    const cpf = soDigitos(str(fd, "cpf")); if (!cpfValido(cpf)) throw new Error("CPF inválido.");
    const res = await sql.begin(async tx => {
      const l = await linkAtivo(token, true, tx as unknown as typeof sql);
      if (!l.rascunho) throw new Error("Escolha a turma antes de aceitar o contrato.");
      const doc = await contratoDoLink(l, tx as unknown as typeof sql); if (!doc) throw new Error("A rematrícula online está indisponível no momento (sem contrato publicado). Fale com a secretaria.");
      if (doc.hash !== str(fd, "hash")) throw new Error("O contrato foi atualizado pela escola enquanto você lia. Revise o texto novo e aceite de novo.");
      const [st] = await tx<{ id: number; nome: string; responsavel: string | null; telefone: string | null; email: string | null; cpf_responsavel: string | null; unit_atual_id: number | null; carteira_user_id: number | null }[]>`SELECT id, nome, responsavel, telefone, email, cpf_responsavel, unit_atual_id, carteira_user_id FROM students WHERE id=${l.student_id} FOR UPDATE`;
      if (st.cpf_responsavel && soDigitos(st.cpf_responsavel) !== cpf) { await tx`INSERT INTO login_attempts (email, ip, ok) VALUES (${`REMATRICULA:${l.id}`}, ${meta.ip}, false)`; return { cpfErrado: true as const }; }
      const [dup] = await tx<{ id: number }[]>`SELECT id FROM enrollments WHERE student_id=${l.student_id} AND ano=${l.ano} AND modalidade='REGULAR' AND (status='CONFIRMADA' OR (status='RESERVADA' AND reserva_ate >= ${h}))`;
      if (dup) throw new Error("Já existe reserva ou matrícula para este ano. Fale com a secretaria.");
      const reservar = async (classId: number, modalidade: string) => {
        const [c] = await tx<{ id: number; vagas: number; status: string; nome: string; ano: number; modalidade: string }[]>`SELECT id, vagas, status, nome, ano, modalidade FROM classes WHERE id=${classId} FOR UPDATE`;
        if (!c || c.status !== "ABERTA" || c.ano !== l.ano || c.modalidade !== modalidade) throw new Error("A turma escolhida não está mais disponível. Volte e escolha outra.");
        const [{ ocup }] = await tx<{ ocup: number }[]>`SELECT count(*)::int AS ocup FROM enrollments WHERE class_id=${c.id} AND (status='CONFIRMADA' OR (status='RESERVADA' AND reserva_ate >= ${h}))`;
        if (ocup >= c.vagas) throw new Error(`A turma ${c.nome} acabou de lotar. Volte e escolha outra opção.`);
        const [e] = await tx<{ id: number }[]>`INSERT INTO enrollments (student_id, class_id, ano, modalidade, status, reserva_ate, contrato_assinado, financeiro_ok, responsavel_user_id, obs) VALUES (${l.student_id}, ${c.id}, ${l.ano}, ${modalidade}, 'RESERVADA', ${addDays(h, cfg.rematricula.reservaDias as number)}, true, false, ${l.criado_por}, ${`Rematrícula pelo link: contrato aceito em ${fmtDataHora(new Date())}. Aguardando o financeiro (ActiveSoft) para confirmar.`}) RETURNING id`;
        return e.id;
      };
      const enr = await reservar(l.rascunho.classId, "REGULAR");
      let enrInt: number | null = null;
      if (l.rascunho.integralClassId) { const [d2] = await tx<{ id: number }[]>`SELECT id FROM enrollments WHERE student_id=${l.student_id} AND ano=${l.ano} AND modalidade='INTEGRAL' AND (status='CONFIRMADA' OR (status='RESERVADA' AND reserva_ate >= ${h}))`; if (!d2) enrInt = await reservar(l.rascunho.integralClassId, "INTEGRAL"); }
      await tx`UPDATE waitlist SET status='CONVERTIDA' WHERE student_id=${l.student_id} AND ano=${l.ano} AND status IN ('AGUARDANDO','OFERTADA')`;
      // dados do responsável: o que mudou fica registrado no link (de → para)
      const novo = { responsavel: l.rascunho.responsavel, telefone: l.rascunho.telefone, email: l.rascunho.email, cpf_responsavel: st.cpf_responsavel ? null : cpf };
      const mud: Record<string, { de: string | null; para: string | null }> = {};
      if ((st.responsavel ?? "") !== novo.responsavel) mud.responsavel = { de: st.responsavel, para: novo.responsavel };
      if (soDigitos(st.telefone) !== soDigitos(novo.telefone)) mud.telefone = { de: st.telefone, para: novo.telefone };
      if ((st.email ?? "") !== (novo.email ?? "") && novo.email) mud.email = { de: st.email, para: novo.email };
      if (novo.cpf_responsavel) mud.cpf_responsavel = { de: null, para: "informado no aceite" };
      await tx`UPDATE students SET responsavel=${novo.responsavel}, telefone=${novo.telefone}, email=${novo.email ?? st.email}, cpf_responsavel=${st.cpf_responsavel ?? cpf} WHERE id=${st.id}`;
      // consentimentos opcionais (específicos e em destaque): marcado = concedido; desmarcado = negado (fica o registro de que foi oferecido)
      const fins = await tx<{ id: number; versao: number }[]>`SELECT id, versao FROM consent_purposes WHERE ativo AND na_rematricula ORDER BY ordem, id`;
      const ev = { ip: meta.ip, userAgent: meta.userAgent, em: new Date().toISOString(), link: l.id };
      for (const f of fins) await tx`INSERT INTO consents (student_id, purpose_id, versao, status, titular_nome, origem, evidencia, user_nome) VALUES (${st.id}, ${f.id}, ${f.versao}, ${str(fd, `consent_${f.id}`) === "1" ? "CONCEDIDO" : "NEGADO"}, ${nome}, 'REMATRICULA_LINK', ${JSON.stringify(ev)}::jsonb, ${CANAL})`;
      const aceite = { nome, cpfFinal: cpf.slice(-2), cpfHash: sha256(cpf), ip: meta.ip, userAgent: meta.userAgent, em: new Date().toISOString() };
      await tx`UPDATE rematricula_links SET status='CONCLUIDA', concluido_em=now(), enrollment_id=${enr}, integral_enrollment_id=${enrInt}, class_id=${l.rascunho.classId}, integral_class_id=${l.rascunho.integralClassId}, contrato_id=${doc.contrato.id}, contrato_versao=${doc.contrato.versao}, contrato_hash=${doc.hash}, contrato_texto=${doc.texto}, aceite=${JSON.stringify(aceite)}::jsonb, dados_atualizados=${JSON.stringify(mud)}::jsonb, updated_at=now() WHERE id=${l.id}`;
      await tx`INSERT INTO family_contacts (student_id, data, canal, tipo, resumo, user_nome) VALUES (${st.id}, ${h}, 'PORTAL', 'CONTATO', ${`Rematrícula ${l.ano} concluída pelo link: ${doc.turma.nome} (${doc.turma.turno})${doc.integral ? ` + Integral ${doc.integral.nome}` : ""}; contrato versão ${doc.contrato.versao} aceito por ${nome}.`}, ${CANAL})`;
      return { cpfErrado: false as const, l, st, turma: doc.turma, enr, mud };
    });
    if (res.cpfErrado) throw new Error("O CPF informado não confere com o do responsável financeiro no cadastro da escola. Confira ou fale com a secretaria.");
    await auditComo(CANAL, "rematrícula pelo link", "rematricula_links", res.l.id, null, { aluno: res.st.nome, turma: res.turma.nome, enrollment: res.enr, dadosAtualizados: Object.keys(res.mud) });
    const unit = res.st.unit_atual_id ?? res.l.unit_id;
    await notificar([res.st.carteira_user_id ?? 0, res.l.criado_por ?? 0, ...await usuariosPorPerfil(["COMERCIAL"]), ...(unit ? await usuariosPorPerfil(["DIRETOR_UNIDADE"], unit) : [])], `Rematrícula feita pelo link: ${res.st.nome}`, `${res.turma.nome} (${res.turma.turno}) · reserva com contrato aceito; falta o financeiro confirmar.`, `/matriculas/alunos/${res.st.id}`, "INFO", `remconc:${res.l.id}`);
    ok = true;
  } catch (e) { redirect(volta(token, `?etapa=contrato&${erroQ(e).slice(1)}`)); }
  if (ok) redirect(volta(token, "?concluida=1"));
}

/** A família avisa que não vai continuar: abre um pedido de saída no Atendimento (protocolo de retenção) e avisa quem cuida da família. */
export async function recusarRematricula(fd: FormData) {
  const token = str(fd, "token");
  try {
    const motivo = str(fd, "motivo"); if (!MOTIVOS_RECUSA.includes(motivo)) throw new Error("Escolha o motivo.");
    const obs = strOrNull(fd, "obs")?.slice(0, 2000) ?? null; const cfg = await getSettings(); const sla = (await slaAte("ALTA")).toISOString();
    // tudo o que vem de fora (configurações, SLA) é lido antes da transação: dentro dela só a conexão da própria transação
    const pre = await linkAtivo(token); const meta = await origemRequisicao();
    const [{ falhas }] = await sql<{ falhas: number }[]>`SELECT count(*)::int AS falhas FROM login_attempts WHERE email=${`REMATRICULA:${pre.id}`} AND ok=false AND at > now() - interval '15 minutes'`;
    if (falhas >= 5) throw new Error("Muitas tentativas com CPF que não confere. Aguarde 15 minutos ou fale com a secretaria.");
    const r = await sql.begin(async tx => {
      const l = await linkAtivo(token, true, tx as unknown as typeof sql);
      const [st] = await tx<{ id: number; nome: string; responsavel: string | null; telefone: string | null; unit_atual_id: number | null; carteira_user_id: number | null; cpf_responsavel: string | null }[]>`SELECT id, nome, responsavel, telefone, unit_atual_id, carteira_user_id, cpf_responsavel FROM students WHERE id=${l.student_id}`;
      // com CPF no cadastro, a recusa também é confirmada por ele (quem só tem o link não abre um pedido de saída em nome da família)
      if (st.cpf_responsavel && soDigitos(st.cpf_responsavel) !== soDigitos(str(fd, "cpf"))) { await tx`INSERT INTO login_attempts (email, ip, ok) VALUES (${`REMATRICULA:${l.id}`}, ${meta.ip}, false)`; return { cpfErrado: true as const }; }
      const unit = st.unit_atual_id ?? l.unit_id; let caseId: number | null = null;
      if (unit) {
        const resp = st.carteira_user_id ?? l.criado_por;
        const [c] = await tx<{ id: number }[]>`INSERT INTO cases (student_id, unit_id, contato_nome, contato_telefone, tipo, canal, assunto, descricao, prioridade, status, responsavel_user_id, sla_ate, checklist, resultado, motivo_saida)
          VALUES (${st.id}, ${unit}, ${st.responsavel}, ${st.telefone}, 'SAIDA', 'PORTAL', ${`Rematrícula ${l.ano}: família informou pelo link que não pretende continuar`}, ${`Motivo informado: ${motivo}.${obs ? ` Comentário da família: ${obs}` : ""}`}, 'ALTA', 'ABERTO', ${resp}, ${sla}, ${JSON.stringify(cfg.atendimento.retencao.map(t => ({ titulo: t, feito: false })))}::jsonb, 'EM_ANDAMENTO', ${motivo}) RETURNING id`;
        caseId = c.id;
        await tx`INSERT INTO case_events (case_id, user_nome, tipo, texto) VALUES (${c.id}, ${CANAL}, 'STATUS', 'Pedido de saída aberto automaticamente pela resposta da família no link de rematrícula — siga o protocolo de retenção.')`;
      }
      await tx`UPDATE rematricula_links SET status='RECUSADA', recusa_motivo=${motivo}, recusa_obs=${obs}, case_id=${caseId}, concluido_em=now(), updated_at=now() WHERE id=${l.id}`;
      return { cpfErrado: false as const, l, st, unit, caseId };
    });
    if (r.cpfErrado) throw new Error("O CPF informado não confere com o do responsável financeiro no cadastro da escola. Confira ou fale com a secretaria.");
    await auditComo(CANAL, "recusa de rematrícula", "rematricula_links", r.l.id, null, { aluno: r.st.nome, motivo, caso: r.caseId });
    await notificar([r.st.carteira_user_id ?? 0, r.l.criado_por ?? 0, ...(r.unit ? await usuariosPorPerfil(["DIRETOR_UNIDADE"], r.unit) : []), ...(r.unit ? [] : await usuariosPorPerfil(["DIRECAO"]))], `Família não vai rematricular: ${r.st.nome}`, `Motivo: ${motivo}. Pedido de saída aberto para o protocolo de retenção.`, r.caseId ? `/atendimento/casos/${r.caseId}` : `/matriculas/alunos/${r.st.id}`, "ALERTA", `remrecusa:${r.l.id}`);
  } catch (e) { redirect(volta(token, erroQ(e))); }
  redirect(volta(token, "?recusada=1"));
}
