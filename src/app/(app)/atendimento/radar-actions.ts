"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit, can, type Session } from "@/lib/auth";
import { audit, str, strOrNull, int, hoje, getSettings } from "@/lib/utils";
import { notificar } from "@/lib/comunicacao";
import { CANAIS } from "@/lib/atendimento";
import { lerJornada, type EtapaCfg } from "@/lib/gestao-calc";
import { CONTATO_TIPO, PERCEPCAO } from "@/lib/radar-familia";

const go = (b: string, k: "ok" | "erro", m: string) => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(m)}`;
const erro = (e: unknown) => e instanceof Error ? e.message : "Erro";
/** Quem atende famílias (mesmo grupo do módulo Atendimento). */
const ATENDE = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR", "COMERCIAL"];
/** Quem distribui a carteira de famílias. */
const DISTRIBUI = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"];

/** Aluno no escopo de quem age: perfis de unidade só atuam nos alunos da própria unidade. */
async function alunoNoEscopo(s: Session, id: number) {
  const [st] = await sql<{ id: number; nome: string; unit_atual_id: number | null; aluno_atual: boolean; carteira_user_id: number | null; origem: string | null; indicado_por_id: number | null }[]>`SELECT id, nome, unit_atual_id, aluno_atual, carteira_user_id, origem, indicado_por_id FROM students WHERE id=${id}`;
  if (!st) throw new Error("Aluno não encontrado.");
  const u = scopeUnit(s); if (u !== null && st.unit_atual_id !== u) throw new Error(`${st.nome} não é da sua unidade.`);
  return st;
}

/** Distribui (ou retira) famílias da carteira de um responsável. Aceita várias de uma vez. */
export async function atribuirCarteira(fd: FormData) {
  const s = await requireSession(); const b = str(fd, "voltar") || "/atendimento/radar"; let msg = "";
  try { assert(DISTRIBUI.includes(s.role), "A carteira de famílias é distribuída pela Direção, RH, diretor ou gestor da unidade.");
    const ids = [...new Set([...fd.getAll("studentIds"), fd.get("studentId")].map(Number).filter(n => Number.isInteger(n) && n > 0))]; if (!ids.length) throw new Error("Marque ao menos uma família.");
    const userId = int(fd, "userId");
    let dest: { id: number; nome: string; role: string; unit_id: number | null } | undefined;
    if (userId) { [dest] = await sql<{ id: number; nome: string; role: string; unit_id: number | null }[]>`SELECT id, nome, role, unit_id FROM users WHERE id=${userId} AND ativo`; if (!dest) throw new Error("Responsável não encontrado ou inativo."); if (!ATENDE.includes(dest.role)) throw new Error(`${dest.nome} não tem perfil de atendimento às famílias.`); }
    // Tudo ou nada: valida todas as famílias marcadas antes de mudar qualquer carteira
    const mudar: { id: number; antes: number | null }[] = [];
    for (const id of ids) {
      const st = await alunoNoEscopo(s, id); if (!st.aluno_atual) throw new Error(`${st.nome} é candidato: a carteira é das famílias que já estudam na rede.`);
      if (dest && ["DIRETOR_UNIDADE", "GESTOR"].includes(dest.role) && dest.unit_id !== st.unit_atual_id) throw new Error(`${dest.nome} atua em outra unidade e não enxergaria ${st.nome}.`);
      if (st.carteira_user_id !== (userId ?? null)) mudar.push({ id, antes: st.carteira_user_id });
    }
    for (const m of mudar) { await sql`UPDATE students SET carteira_user_id=${userId ?? null} WHERE id=${m.id}`; await audit(s, "carteira da família", "students", m.id, { carteira: m.antes }, { carteira: userId ?? null }); }
    const n = mudar.length;
    if (dest && n && dest.id !== s.id) await notificar([dest.id], "Famílias na sua carteira", `${n} família(s) passaram a ser acompanhadas por você no Radar da família.`, "/atendimento/radar?carteira=me", "INFO", `carteira:${dest.id}:${hoje()}:${ids.join(",").slice(0, 80)}`);
    msg = n ? `${n} família(s) ${dest ? `na carteira de ${dest.nome}` : "sem responsável"}.` : "Nada mudou: as famílias já estavam nessa carteira.";
  } catch (e) { redirect(go(b, "erro", erro(e))); }
  redirect(go(b, "ok", msg));
}

/** Interação com a família: canal, tipo, resumo, percepção e próximo passo combinado (com data). Pode cumprir uma etapa da jornada. */
export async function registrarInteracao(fd: FormData) {
  const s = await requireSession(); const sid = Number(fd.get("studentId")); const b = str(fd, "voltar") || `/matriculas/alunos/${sid}#relacionamento`; let msg = "";
  try { assert(ATENDE.includes(s.role), "Seu perfil não registra interações com famílias."); const st = await alunoNoEscopo(s, sid); if (!st.aluno_atual) throw new Error("Interações do radar são das famílias que já estudam na rede (candidato segue em Matrículas e Atendimento)."); const cfg = await getSettings(); const h = hoje();
    const data = str(fd, "data") || h; if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error("Data inválida."); if (data > h) throw new Error("A interação não pode ter data futura.");
    const resumo = str(fd, "resumo"); if (!resumo) throw new Error("Resuma a conversa.");
    const tipo = str(fd, "tipo") || "LIGACAO"; if (!CONTATO_TIPO[tipo]) throw new Error("Tipo de interação inválido.");
    const canal = strOrNull(fd, "canal"); if (canal && !(CANAIS as readonly string[]).includes(canal)) throw new Error("Canal inválido.");
    const percepcao = strOrNull(fd, "percepcao"); if (percepcao && !PERCEPCAO[percepcao]) throw new Error("Percepção inválida.");
    const proximoPasso = strOrNull(fd, "proximoPasso"); const proximoEm = strOrNull(fd, "proximoEm");
    if (proximoPasso && !proximoEm) throw new Error("Combine a data do próximo passo."); if (proximoEm && !proximoPasso) throw new Error("Descreva o próximo passo combinado."); if (proximoEm && proximoEm < data) throw new Error("O próximo passo não pode ser antes da interação.");
    const etapa = strOrNull(fd, "etapa"); const etapas = cfg.atendimento.jornada as EtapaCfg[]; const et = etapa ? etapas.find(e => e.chave === etapa) : null; if (etapa && !et) throw new Error("Etapa da jornada inválida.");
    const [c] = await sql<{ id: number }[]>`INSERT INTO family_contacts (student_id, data, canal, tipo, etapa, resumo, percepcao, proximo_passo, proximo_em, user_id, user_nome) VALUES (${sid}, ${data}, ${canal}, ${tipo}, ${etapa}, ${resumo}, ${percepcao}, ${proximoPasso}, ${proximoEm}, ${s.id}, ${s.nome}) RETURNING id`;
    let etapaMsg = "";
    if (et) { const ano = Number(data.slice(0, 4)); const r = await sql`INSERT INTO family_journey (student_id, ano, etapa, concluida_em, contact_id, user_id) VALUES (${sid}, ${ano}, ${et.chave}, ${data}, ${c.id}, ${s.id}) ON CONFLICT (student_id, ano, etapa) DO NOTHING RETURNING id`; etapaMsg = r.length ? ` Etapa “${et.nome}” cumprida.` : ` A etapa “${et.nome}” já estava cumprida em ${ano}.`; }
    await audit(s, "interação com a família", "students", sid, null, { contato: c.id, tipo, percepcao, etapa, proximoEm });
    if (percepcao === "NEGATIVA" && st.carteira_user_id && st.carteira_user_id !== s.id) await notificar([st.carteira_user_id], "Interação com percepção negativa", `${st.nome}: ${resumo.slice(0, 140)}`, `/matriculas/alunos/${sid}#relacionamento`, "ALERTA", `contatoneg:${c.id}`);
    msg = `Interação registrada.${etapaMsg}${proximoEm ? ` Próximo passo em ${proximoEm.split("-").reverse().join("/")}.` : ""}`;
  } catch (e) { redirect(go(b, "erro", erro(e))); }
  redirect(go(b, "ok", msg));
}

/** Marca uma etapa da jornada como cumprida (sem precisar de interação), ou desfaz — desfazer é da Direção/RH/diretor. */
export async function marcarEtapa(fd: FormData) {
  const s = await requireSession(); const sid = Number(fd.get("studentId")); const b = str(fd, "voltar") || `/matriculas/alunos/${sid}#relacionamento`; let msg = "";
  try { assert(ATENDE.includes(s.role), "Seu perfil não registra etapas da jornada."); const st = await alunoNoEscopo(s, sid); if (!st.aluno_atual) throw new Error("A jornada é das famílias que já estudam na rede."); const cfg = await getSettings(); const h = hoje();
    const etapa = str(fd, "etapa"); const et = (cfg.atendimento.jornada as EtapaCfg[]).find(e => e.chave === etapa); const ano = int(fd, "ano") ?? Number(h.slice(0, 4));
    if (str(fd, "desfazer") === "1") {
      assert(["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role), "Desfazer etapa é da Direção, RH ou diretor da unidade.");
      const r = await sql`DELETE FROM family_journey WHERE student_id=${sid} AND ano=${ano} AND etapa=${etapa} RETURNING id`; if (!r.length) throw new Error("Etapa não estava registrada.");
      await audit(s, "desfazer etapa da jornada", "students", sid, { etapa, ano }, null); msg = "Etapa desmarcada (fica na auditoria).";
    } else {
      if (!et) throw new Error("Etapa da jornada inválida."); const data = str(fd, "data") || h; if (data > h) throw new Error("A etapa não pode ser cumprida em data futura.");
      const r = await sql`INSERT INTO family_journey (student_id, ano, etapa, concluida_em, user_id, obs) VALUES (${sid}, ${Number(data.slice(0, 4))}, ${et.chave}, ${data}, ${s.id}, ${strOrNull(fd, "obs")}) ON CONFLICT (student_id, ano, etapa) DO NOTHING RETURNING id`;
      if (!r.length) throw new Error(`A etapa “${et.nome}” já está cumprida neste ano.`);
      await audit(s, "etapa da jornada cumprida", "students", sid, null, { etapa, data }); msg = `Etapa “${et.nome}” cumprida.`;
    }
  } catch (e) { redirect(go(b, "erro", erro(e))); }
  redirect(go(b, "ok", msg));
}

/** Quem indicou o candidato (família da rede). Sem origem definida, a origem passa a ser Indicação. */
export async function definirIndicacao(fd: FormData) {
  const s = await requireSession(); const sid = Number(fd.get("studentId")); const b = str(fd, "voltar") || `/matriculas/alunos/${sid}`; let msg = "";
  try { assert(can.reservar(s), "Seu perfil não edita o cadastro de Matrículas.");
    // Candidato ainda sem unidade é da rede (mesma regra do cadastro de Matrículas); com unidade, perfis de unidade só atuam na sua.
    const [st] = await sql<{ id: number; nome: string; unit_atual_id: number | null; origem: string | null; indicado_por_id: number | null }[]>`SELECT id, nome, unit_atual_id, origem, indicado_por_id FROM students WHERE id=${sid}`; if (!st) throw new Error("Aluno não encontrado.");
    const u = scopeUnit(s); if (u !== null && st.unit_atual_id !== null && st.unit_atual_id !== u) throw new Error(`${st.nome} não é da sua unidade.`);
    // Aceita o id direto ou o texto escolhido na lista (“Nome — Unidade (#123)”); nome exato e único também vale.
    let por = int(fd, "indicadoPorId"); const texto = str(fd, "indicadoPor");
    if (!por && texto) { const m = texto.match(/#(\d+)\)?\s*$/); if (m) por = Number(m[1]); else { const xs = await sql<{ id: number }[]>`SELECT id FROM students WHERE aluno_atual AND lower(nome)=lower(${texto})`; if (xs.length !== 1) throw new Error(xs.length ? "Há mais de uma família com esse nome: escolha na lista." : "Família indicadora não encontrada: escolha um nome da lista."); por = xs[0].id; } }
    if (por) { if (por === sid) throw new Error("O aluno não pode indicar a si mesmo."); const [p] = await sql<{ id: number; nome: string; indicado_por_id: number | null }[]>`SELECT id, nome, indicado_por_id FROM students WHERE id=${por} AND aluno_atual`; if (!p) throw new Error("Família indicadora não encontrada entre os alunos da rede."); if (p.indicado_por_id === sid) throw new Error(`${p.nome} foi indicada por ${st.nome}: a indicação não pode ser recíproca.`); }
    await sql`UPDATE students SET indicado_por_id=${por}, origem = CASE WHEN ${por}::int IS NOT NULL AND origem IS NULL THEN 'INDICACAO' ELSE origem END WHERE id=${sid}`;
    await audit(s, "indicação do candidato", "students", sid, { indicadoPor: st.indicado_por_id }, { indicadoPor: por });
    msg = por ? `Indicação registrada${st.origem ? "" : " (origem definida como Indicação)"}.` : "Indicação removida.";
  } catch (e) { redirect(go(b, "erro", erro(e))); }
  redirect(go(b, "ok", msg));
}

/** Jornada da família e limites do radar (Configurações): etapas “Nome | DD/MM”, dias sem contato e aviso de etapa. */
export async function configurarJornada(fd: FormData) {
  const s = await requireSession(); const b = str(fd, "voltar") || "/atendimento/radar"; let msg = "";
  try { assert(can.configurar(s), "A jornada é configurada pela Direção/RH."); const cfg = await getSettings();
    const jornada = lerJornada(str(fd, "jornada")); if (!jornada.length) throw new Error("Informe ao menos uma etapa (uma por linha: Nome | DD/MM).");
    const semContatoDias = int(fd, "semContatoDias") ?? cfg.atendimento.semContatoDias; const avisoEtapaDias = int(fd, "avisoEtapaDias") ?? cfg.atendimento.avisoEtapaDias;
    if (!Number.isFinite(semContatoDias) || semContatoDias < 7 || semContatoDias > 365) throw new Error("Dias sem contato: entre 7 e 365."); if (!Number.isFinite(avisoEtapaDias) || avisoEtapaDias < 1 || avisoEtapaDias > 90) throw new Error("Aviso de etapa: entre 1 e 90 dias.");
    const novo = { ...cfg.atendimento, jornada, semContatoDias, avisoEtapaDias };
    await sql`INSERT INTO settings (key, value) VALUES ('atendimento', ${JSON.stringify(novo)}::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`;
    await audit(s, "configurar jornada da família", "settings", null, { jornada: cfg.atendimento.jornada, semContatoDias: cfg.atendimento.semContatoDias }, { jornada, semContatoDias });
    msg = `Jornada salva com ${jornada.length} etapa(s). Etapas já cumpridas continuam valendo pela chave do nome.`;
  } catch (e) { redirect(go(b, "erro", erro(e))); }
  redirect(go(b, "ok", msg));
}
