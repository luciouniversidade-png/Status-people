"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, type Session } from "@/lib/auth";
import { audit, str, strOrNull, int, getSettings, addDays, hoje } from "@/lib/utils";
import { notificar } from "@/lib/comunicacao";
import { ETICA_STATUS, RESULTADO_ETICA, podeTratarRelato, responsaveisRelato, comite, impedidosDoRelato, impedidosEfetivos, candidatosEtica } from "@/lib/etica";
import { appUrl } from "@/lib/url";

const go = (b: string, k: "ok" | "erro", msg: string) => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}`;
const BE = "/governanca/etica";
type Rel = { id: number; protocolo: string; status: string; impedidos: number[] | null; liberados: number[] | null; envolvidos: string | null; relato: string; responsavel_user_id: number | null; categoria: string };
/** Relato que a pessoa pode tratar, com os impedidos efetivos (registrados + citados entre quem pode tratar hoje). */
async function relato(s: Session, id: number): Promise<Rel & { imp: number[] }> {
  const [r] = await sql<Rel[]>`SELECT id, protocolo, status, impedidos, liberados, envolvidos, relato, responsavel_user_id, categoria FROM ethics_reports WHERE id=${id}`;
  if (!r || !(await podeTratarRelato(s, r))) throw new Error("Relato não encontrado ou você está impedido de tratá-lo.");
  return { ...r, imp: await impedidosDoRelato(r) };
}
const log = (id: number, s: Session, texto: string) => sql`INSERT INTO ethics_messages (report_id, autor, texto, user_id, user_nome) VALUES (${id}, 'NOTA_INTERNA', ${texto}, ${s.id}, ${s.nome})`;

export async function tratarRelato(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const b = `${BE}/${id}`; let msg = "";
  try {
    const r = await relato(s, id); if (!["RECEBIDA", "EM_APURACAO"].includes(r.status)) throw new Error("Relato encerrado.");
    const novo = str(fd, "status") || r.status; if (!["RECEBIDA", "EM_APURACAO"].includes(novo)) throw new Error("Use concluir ou arquivar para encerrar.");
    const grav = int(fd, "gravidade"); if (grav !== null && (grav < 1 || grav > 3)) throw new Error("Gravidade de 1 a 3.");
    // "—" limpa o responsável; um responsável que deixou de poder tratar o relato (saiu do comitê, ficou impedido) sai sozinho
    const elegiveis = await responsaveisRelato(r.imp);
    let resp = fd.has("responsavelUserId") ? (int(fd, "responsavelUserId") || null) : r.responsavel_user_id;
    if (resp && !elegiveis.some(m => m.id === resp)) { if (resp === r.responsavel_user_id) resp = null; else throw new Error("O responsável precisa ser do comitê e não estar impedido."); }
    await sql`UPDATE ethics_reports SET status=${novo}, gravidade=coalesce(${grav}::int, gravidade), responsavel_user_id=${resp}, updated_at=now() WHERE id=${id}`;
    const partes = [novo !== r.status ? `Situação: ${ETICA_STATUS[novo]}` : "", grav ? `gravidade ${grav}` : "", resp && resp !== r.responsavel_user_id ? "responsável definido" : ""].filter(Boolean);
    if (partes.length) await log(id, s, partes.join(" · "));
    if (resp && resp !== r.responsavel_user_id && resp !== s.id) await notificar([resp], "Relato do canal de ética com você", `Protocolo ${r.protocolo}.`, b, "ACAO");
    await audit(s, "tratar relato de ética", "ethics_reports", id, { status: r.status }, { status: novo }); msg = "Relato atualizado.";
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}

/** Mensagem ao denunciante (aparece no acompanhamento) ou nota interna do comitê. */
export async function mensagemComite(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const b = `${BE}/${id}`;
  try {
    const r = await relato(s, id); const texto = str(fd, "texto"); if (texto.length < 3) throw new Error("Escreva a mensagem.");
    const interna = str(fd, "interna") === "1"; if (!interna && !["RECEBIDA", "EM_APURACAO"].includes(r.status)) throw new Error("Relato encerrado.");
    await sql`INSERT INTO ethics_messages (report_id, autor, texto, user_id, user_nome) VALUES (${id}, ${interna ? "NOTA_INTERNA" : "COMITE"}, ${texto.slice(0, 5000)}, ${s.id}, ${s.nome})`; await sql`UPDATE ethics_reports SET updated_at=now() WHERE id=${id}`;
    await audit(s, interna ? "nota interna em relato" : "mensagem ao denunciante", "ethics_reports", id);
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Registrado."));
}

/** Marca um membro do comitê como impedido (conflito de interesse). Ele perde o acesso ao relato. Só a Direção desfaz — e nunca para si. */
export async function impedimentoRelato(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const alvo = int(fd, "userId") ?? 0; const desfazer = str(fd, "desfazer") === "1"; let destino = `${BE}/${id}`; let msg = "";
  try {
    const r = await relato(s, id); const imp = new Set(r.impedidos ?? []); const lib = new Set(r.liberados ?? []);
    // desfazer (só a Direção, nunca para si): tira do registro e libera da detecção automática (homônimo); marcar: o contrário
    if (desfazer) { assert(s.role === "DIRECAO", "Só a Direção desfaz um impedimento."); if (alvo === s.id) throw new Error("Ninguém desfaz o próprio impedimento."); if (!r.imp.includes(alvo)) throw new Error("Esta pessoa não está impedida."); imp.delete(alvo); lib.add(alvo); }
    else {
      // cada um pode se declarar impedido; marcar outra pessoa é só da Direção (um membro não tira os colegas do caso)
      if (alvo !== s.id) assert(s.role === "DIRECAO", "Só a Direção marca outra pessoa como impedida. Você pode se declarar impedido(a).");
      const c = await comite(); if (!c.membros.some(m => m.id === alvo) && alvo !== s.id) throw new Error("Escolha um membro do comitê."); imp.add(alvo); lib.delete(alvo);
    }
    const efetivos = impedidosEfetivos({ ...r, impedidos: [...imp], liberados: [...lib] }, await candidatosEtica());
    if (!(await responsaveisRelato(efetivos)).length) throw new Error("Não sobraria ninguém para tratar o relato.");
    await sql`UPDATE ethics_reports SET impedidos=${JSON.stringify([...imp])}::jsonb, liberados=${JSON.stringify([...lib])}::jsonb, responsavel_user_id=CASE WHEN responsavel_user_id = ANY(${efetivos}::int[]) THEN NULL ELSE responsavel_user_id END, updated_at=now() WHERE id=${id}`;
    await log(id, s, desfazer ? "Impedimento desfeito pela Direção" : "Membro do comitê marcado como impedido"); await audit(s, desfazer ? "desfazer impedimento" : "marcar impedimento", "ethics_reports", id, null, { userId: alvo });
    msg = desfazer ? "Impedimento desfeito." : "Impedimento registrado."; if (!desfazer && alvo === s.id) { destino = BE; msg = "Você se declarou impedido: o relato saiu da sua lista."; }
  } catch (e) { redirect(go(`${BE}/${id}`, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(destino, "ok", msg));
}

export async function concluirRelato(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const b = `${BE}/${id}`;
  try {
    const r = await relato(s, id); if (!["RECEBIDA", "EM_APURACAO"].includes(r.status)) throw new Error("Relato já encerrado.");
    const arquivar = str(fd, "arquivar") === "1";
    const resultado = arquivar ? null : str(fd, "resultado"); if (!arquivar && !RESULTADO_ETICA[resultado ?? ""]) throw new Error("Escolha o resultado da apuração.");
    const conclusao = str(fd, "conclusao"); if (conclusao.length < 20) throw new Error(arquivar ? "Explique por que o relato é arquivado (ex.: fora do escopo do canal, duplicado)." : "Registre a conclusão da apuração.");
    await sql`UPDATE ethics_reports SET status=${arquivar ? "ARQUIVADA" : "CONCLUIDA"}, resultado=${resultado}, conclusao=${conclusao}, medidas=${strOrNull(fd, "medidas")}, concluida_em=now(), updated_at=now() WHERE id=${id}`;
    const retorno = strOrNull(fd, "retorno"); if (retorno) await sql`INSERT INTO ethics_messages (report_id, autor, texto, user_id, user_nome) VALUES (${id}, 'COMITE', ${retorno}, ${s.id}, ${s.nome})`;
    await log(id, s, arquivar ? "Arquivado" : `Concluído: ${RESULTADO_ETICA[resultado!]}`); await audit(s, arquivar ? "arquivar relato" : "concluir relato", "ethics_reports", id, null, { resultado });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Relato encerrado."));
}

export async function salvarConfigEtica(fd: FormData) {
  const s = await requireSession();
  try {
    assert(s.role === "DIRECAO", "Só a Direção define o comitê de ética.");
    const ids = fd.getAll("comite").map(Number).filter(Boolean);
    if (ids.length) { const ok = await sql<{ id: number }[]>`SELECT id FROM users WHERE ativo AND id = ANY(${ids}) AND role NOT IN ('LEITURA','COLABORADOR')`; if (ok.length !== ids.length) throw new Error("O comitê só pode ter usuários ativos de gestão."); }
    const t = Number(str(fd, "prazoTriagemDias")), c = Number(str(fd, "prazoConclusaoDias"));
    if (!Number.isInteger(t) || t < 1 || t > 30) throw new Error("Prazo de triagem: 1 a 30 dias."); if (!Number.isInteger(c) || c < 5 || c > 180) throw new Error("Prazo de conclusão: 5 a 180 dias.");
    const v = { comite: ids, prazoTriagemDias: t, prazoConclusaoDias: c };
    await sql`INSERT INTO settings (key, value) VALUES ('etica', ${JSON.stringify(v)}::jsonb) ON CONFLICT (key) DO UPDATE SET value=settings.value || EXCLUDED.value`; await audit(s, "configurar canal de ética", "settings", null, null, v);
  } catch (e) { redirect(go(BE, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(BE, "ok", "Comitê e prazos salvos."));
}

/** Lei 14.457/2022, art. 23: regras de conduta divulgadas (comunicado com ciência) e capacitação ao menos a cada 12 meses (curso no Academy). */
export async function publicarRegrasEtica(fd: FormData) {
  const s = await requireSession(); let msg = "";
  try {
    assert(["DIRECAO", "RH"].includes(s.role), "Só Direção/RH.");
    const cfg = await getSettings(); const url = `${await appUrl()}/etica`;
    if (str(fd, "o") === "comunicado") {
      const texto = str(fd, "texto"); if (texto.length < 100) throw new Error("Escreva as regras de conduta (prevenção ao assédio sexual e às demais formas de violência, sanções e o canal de relato).");
      const [a] = await sql<{ id: number }[]>`INSERT INTO announcements (titulo, texto, publico, requer_ciencia, prazo_ciencia, fixado, autor_user_id, autor_nome) VALUES ('Regras de conduta e canal de ética', ${`${texto}\n\nCanal de ética (anônimo): ${url}`}, 'TODOS', true, ${addDays(hoje(), 15)}, true, ${s.id}, ${s.nome}) RETURNING id`;
      await sql`INSERT INTO settings (key, value) VALUES ('etica', ${JSON.stringify({ comunicadoId: a.id })}::jsonb) ON CONFLICT (key) DO UPDATE SET value=settings.value || EXCLUDED.value`;
      const alvo = await sql<{ id: number }[]>`SELECT id FROM users WHERE ativo AND role <> 'LEITURA'`; await notificar(alvo.map(x => x.id), "Comunicado: Regras de conduta e canal de ética", "Requer sua ciência.", `/comunicacao/comunicados#c${a.id}`, "ACAO");
      await audit(s, "publicar regras de conduta", "announcements", a.id); msg = "Regras publicadas como comunicado com ciência obrigatória.";
    } else {
      if (cfg.etica.cursoId) { const [c] = await sql`SELECT 1 FROM courses WHERE id=${cfg.etica.cursoId} AND ativo`; if (c) throw new Error("O treinamento já existe no Academy."); }
      const [c] = await sql<{ id: number }[]>`INSERT INTO courses (codigo, titulo, area, descricao, tipo, formato, carga_horas, validade_meses, para_todos, ativo) VALUES ('ETICA-ASSEDIO', 'Prevenção ao assédio e uso do canal de ética', 'Integração institucional', ${`Regras de conduta, prevenção e enfrentamento do assédio sexual e de outras formas de violência no trabalho, e como usar o canal de ética (${url}). Renovação anual.`}, 'OBRIGATORIO', 'ONLINE', 1, 12, true, true) RETURNING id`;
      await sql`INSERT INTO settings (key, value) VALUES ('etica', ${JSON.stringify({ cursoId: c.id })}::jsonb) ON CONFLICT (key) DO UPDATE SET value=settings.value || EXCLUDED.value`;
      await audit(s, "criar treinamento de ética", "courses", c.id); msg = "Treinamento anual obrigatório criado no Academy para toda a equipe.";
    }
  } catch (e) { redirect(go(BE, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(BE, "ok", msg));
}
