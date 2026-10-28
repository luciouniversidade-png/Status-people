"use server";
// v26 · aderência com evidências e decisão humana sobre a shortlist
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireSession, assert, assertScope } from "@/lib/auth";
import { audit, str, strOrNull, int, getSettings } from "@/lib/utils";
import { criteriosDoTexto, avaliarPorRegras, avaliarComIA, FIT_VERSAO, DECISAO_LABEL, type ResultadoFit } from "@/lib/recrutamento-fit";
import { criteriosDaVaga, rankingVaga, fontesDoCandidato, ETAPAS_FORA } from "@/lib/recrutamento-ranking";
import { comMensagem } from "@/lib/redirecionar";

const GESTAO = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"];
const go = (b: string, k: "ok" | "erro", msg: string) => comMensagem(b, k, msg, "#aderencia");

async function vagaAberta(rid: number) {
  const [r] = await db.select().from(schema.requisitions).where(eq(schema.requisitions.id, rid));
  if (!r) throw new Error("Vaga não encontrada."); return r;
}

export async function salvarCriteriosFit(fd: FormData) {
  const s = await requireSession(); const rid = Number(fd.get("requisitionId")); const b = `/recrutamento/vagas/${rid}`; let n = 0;
  try { assert(GESTAO.includes(s.role)); const r = await vagaAberta(rid); assertScope(s, r.unitId);
    const cs = criteriosDoTexto(str(fd, "criterios")); n = cs.length;
    await db.update(schema.requisitions).set({ criteriosFit: cs.length ? cs : null }).where(eq(schema.requisitions.id, rid));
    await audit(s, "critérios de aderência", "requisitions", rid, null, { criterios: cs.map(c => `${c.tipo}: ${c.texto}`) });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", n ? `${n} critério(s) salvos. Recalcule a aderência para aplicar.` : "Critérios limpos — a vaga volta a usar o texto dos requisitos."));
}

export async function calcularAderencia(fd: FormData) {
  const s = await requireSession(); const rid = Number(fd.get("requisitionId")); const aid = int(fd, "applicationId"); const modo = str(fd, "modo") === "IA" ? "IA" : "REGRAS";
  const b = aid && str(fd, "volta") === "candidato" ? `/recrutamento/candidatos/${int(fd, "candidateId")}` : `/recrutamento/vagas/${rid}`; let msg = "";
  try { assert(GESTAO.includes(s.role)); const r = await vagaAberta(rid); assertScope(s, r.unitId); const cfg = await getSettings(); const fit = cfg.recrutamento.fit;
    const criterios = criteriosDaVaga(r); if (!criterios.length) throw new Error("A vaga não tem critérios: escreva os requisitos (um por linha) ou cadastre os critérios de aderência.");
    const alvos = await sql<{ id: number }[]>`SELECT id FROM applications WHERE requisition_id=${rid} AND etapa NOT IN ('REPROVADO','DESISTIU','CONTRATADO') AND retirada_em IS NULL ${aid ? sql`AND id=${aid}` : sql``}`;
    if (!alvos.length) throw new Error("Nenhuma candidatura em processo para calcular.");
    const pesos = { obrigatorio: fit.pesoObrigatorio, desejavel: fit.pesoDesejavel }; let ia = 0, regras = 0, semTexto = 0, avisoIA = "";
    for (const a of alvos) {
      const f = await fontesDoCandidato(a.id); if (!f || !f.fontes.length) { semTexto++; continue; }
      let res: ResultadoFit;
      if (modo === "IA" && fit.usarIA && !avisoIA) { try { res = await avaliarComIA(criterios, f.fontes, pesos); ia++; } catch (e) { avisoIA = e instanceof Error ? e.message : "IA indisponível"; res = avaliarPorRegras(criterios, f.fontes, pesos); regras++; } }
      else { res = avaliarPorRegras(criterios, f.fontes, pesos); regras++; }
      await sql`INSERT INTO application_fit (application_id, score, atende, total, obrigatorios_faltando, detalhes, metodo, modelo, versao, mascarados, calculado_em, calculado_por)
        VALUES (${a.id}, ${res.score}, ${res.atende}, ${res.total}, ${res.obrigatoriosFaltando}, ${JSON.stringify(res.detalhes)}::jsonb, ${res.metodo}, ${res.modelo}, ${FIT_VERSAO}, ${res.mascarados}, now(), ${s.id})
        ON CONFLICT (application_id) DO UPDATE SET score=EXCLUDED.score, atende=EXCLUDED.atende, total=EXCLUDED.total, obrigatorios_faltando=EXCLUDED.obrigatorios_faltando, detalhes=EXCLUDED.detalhes, metodo=EXCLUDED.metodo, modelo=EXCLUDED.modelo, versao=EXCLUDED.versao, mascarados=EXCLUDED.mascarados, calculado_em=now(), calculado_por=EXCLUDED.calculado_por`;
      await db.insert(schema.applicationEvents).values({ applicationId: a.id, userNome: s.nome, texto: `Aderência calculada: ${res.score}% (${res.atende}/${res.total} critérios${res.obrigatoriosFaltando ? `, ${res.obrigatoriosFaltando} obrigatório(s) não comprovado(s)` : ""}) · ${res.metodo === "IA" ? "IA com trechos conferidos" : "regras"}` });
    }
    await audit(s, "calcular aderência", "requisitions", rid, null, { modo, ia, regras, semTexto });
    msg = `Aderência calculada para ${ia + regras} candidatura(s)${ia ? ` (${ia} com IA)` : ""}.${semTexto ? ` ${semTexto} sem texto para analisar — cole o currículo na ficha.` : ""}${avisoIA ? ` IA não usada: ${avisoIA} Feito por regras.` : ""}`;
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}

/** Decisão humana sobre um candidato da lista. Toda decisão fica registrada; contrariar a sugestão exige justificativa. */
export async function decidirShortlist(fd: FormData) {
  const s = await requireSession(); const aid = Number(fd.get("applicationId")); const decisao = str(fd, "decisao"); let rid = 0; let msg = "";
  try { assert(GESTAO.includes(s.role)); if (!DECISAO_LABEL[decisao]) throw new Error("Decisão inválida.");
    const [a] = await db.select().from(schema.applications).where(eq(schema.applications.id, aid)); if (!a) throw new Error("Candidatura não encontrada."); rid = a.requisitionId;
    const r = await vagaAberta(rid); assertScope(s, r.unitId); if (r.status !== "ABERTA") throw new Error("A vaga não está aberta.");
    if (ETAPAS_FORA.includes(a.etapa)) throw new Error("Esta candidatura já saiu do processo.");
    const cfg = await getSettings(); const rk = await rankingVaga(rid, cfg.recrutamento.fit); const linha = rk.find(x => x.application_id === aid);
    const justificativa = strOrNull(fd, "justificativa"); const motivo = strOrNull(fd, "motivo");
    const divergiu = decisao === "AVANCAR" ? !linha?.sugerido : decisao === "REPROVAR" ? !!linha?.sugerido : false;
    if (divergiu && (justificativa ?? "").length < 10) throw new Error(decisao === "AVANCAR" ? "Este candidato não está entre os sugeridos (aderência baixa ou obrigatório não comprovado). Escreva em uma frase por que ele avança — fica registrado." : "Este candidato está entre os sugeridos. Escreva em uma frase por que ele não segue — fica registrado.");
    if (decisao === "REPROVAR" && !motivo) throw new Error("Informe o motivo da reprovação (o candidato pode pedir retorno).");
    const etapas = cfg.recrutamento.etapas; let nova = a.etapa;
    if (decisao === "AVANCAR") { nova = etapas[etapas.indexOf(a.etapa) + 1] ?? a.etapa; if (nova === "CONTRATADO") throw new Error("A próxima etapa é a contratação — use “mover / avaliar” no pipeline, que pede a data de admissão e a proposta."); }
    if (decisao === "REPROVAR") nova = "REPROVADO";
    await db.insert(schema.shortlistDecisions).values({ applicationId: aid, decisao, scoreNoMomento: linha?.score ?? null, posicao: linha?.posicao ?? null, divergiu, justificativa, decididoPor: s.id, decididoNome: s.nome });
    if (nova !== a.etapa) await db.update(schema.applications).set({ etapa: nova, updatedAt: new Date(), motivoReprovacao: decisao === "REPROVAR" ? motivo : a.motivoReprovacao }).where(eq(schema.applications.id, aid));
    if (decisao === "RESERVAR") await sql`UPDATE candidates SET tags = trim(both ', ' from concat_ws(', ', nullif(tags,''), ${`reserva vaga #${rid}`}::text)) WHERE id=${a.candidateId} AND coalesce(tags,'') NOT LIKE ${`%reserva vaga #${rid}%`}`;
    const txt = decisao === "AVANCAR" ? `Shortlist: avançou → ${nova}` : decisao === "REPROVAR" ? `Shortlist: reprovado (${motivo})` : "Shortlist: reservado (banco de talentos)";
    await db.insert(schema.applicationEvents).values({ applicationId: aid, userNome: s.nome, texto: `${txt}${linha?.score != null ? ` · aderência ${linha.score}% · ${linha.posicao}º da lista` : " · sem aderência calculada"}${divergiu ? ` · contrariou a sugestão: ${justificativa}` : ""}` });
    await audit(s, "decisão shortlist", "applications", aid, { etapa: a.etapa }, { etapa: nova, decisao, divergiu, score: linha?.score ?? null });
    msg = `${DECISAO_LABEL[decisao]}: decisão registrada${divergiu ? " (com justificativa)" : ""}.`;
  } catch (e) { redirect(go(`/recrutamento/vagas/${rid || ""}`, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`/recrutamento/vagas/${rid}`, "ok", msg));
}
