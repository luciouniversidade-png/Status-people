"use server";
// v34 · pesquisas internas: criar e editar (rascunho), abrir (avisa o público), encerrar; resposta no Meu espaço.
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert } from "@/lib/auth";
import { audit, str, int, hoje } from "@/lib/utils";
import { comMensagem } from "@/lib/redirecionar";
import * as P from "@/lib/pesquisas";
import { notificar } from "@/lib/comunicacao";

const go = (b: string, k: "ok" | "erro", m: string) => comMensagem(b, k, m);
const msgErro = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado.");
const BASE = "/clima/pesquisas";

export async function salvarPesquisa(fd: FormData) {
  const s = await requireSession(); let id = int(fd, "id") ?? 0;
  try {
    assert(P.podePesquisas(s), "Só RH e Direção criam pesquisas.");
    const titulo = str(fd, "titulo").slice(0, 160); assert(titulo.length >= 5, "Dê um título à pesquisa.");
    const perguntas = P.lerPerguntas(str(fd, "perguntas")); const identificada = str(fd, "identificada") === "1";
    const minimo = Math.max(3, Math.min(30, int(fd, "minimo") ?? 5));
    const publico = str(fd, "publico"); assert(!!P.PUBLICO[publico], "Escolha o público.");
    const unitId = publico === "UNIDADE" ? int(fd, "unitId") : null; const positionId = publico === "CARGO" ? int(fd, "positionId") : null;
    assert(publico !== "UNIDADE" || !!unitId, "Escolha a unidade."); assert(publico !== "CARGO" || !!positionId, "Escolha o cargo.");
    const inicio = str(fd, "inicio") || hoje(); const fim = str(fd, "fim"); assert(/^\d{4}-\d{2}-\d{2}$/.test(fim) && fim >= inicio, "O fim precisa ser depois do início.");
    if (id) {
      const [sv] = await sql<{ status: string }[]>`SELECT status FROM custom_surveys WHERE id=${id}`; assert(!!sv, "Pesquisa não encontrada."); assert(sv!.status === "RASCUNHO", "Só rascunho pode ser editado (as respostas dependem das perguntas).");
      await sql`UPDATE custom_surveys SET titulo=${titulo}, descricao=${str(fd, "descricao").slice(0, 800) || null}, identificada=${identificada}, minimo_anonimato=${minimo}, perguntas=${JSON.stringify(perguntas)}::jsonb, publico=${publico}, unit_id=${unitId}, position_id=${positionId}, inicio=${inicio}, fim=${fim} WHERE id=${id}`;
    } else {
      const [r] = await sql<{ id: number }[]>`INSERT INTO custom_surveys (titulo, descricao, identificada, minimo_anonimato, perguntas, publico, unit_id, position_id, inicio, fim, criado_por, criado_nome) VALUES (${titulo}, ${str(fd, "descricao").slice(0, 800) || null}, ${identificada}, ${minimo}, ${JSON.stringify(perguntas)}::jsonb, ${publico}, ${unitId}, ${positionId}, ${inicio}, ${fim}, ${s.id}, ${s.nome}) RETURNING id`; id = r.id;
    }
    await audit(s, "salvar pesquisa interna", "custom_surveys", id, null, { titulo, perguntas: perguntas.length, identificada, publico });
  } catch (e) { redirect(go(id ? `${BASE}/${id}` : BASE, "erro", msgErro(e))); }
  redirect(go(`${BASE}/${id}`, "ok", "Pesquisa salva como rascunho. Confira e abra quando estiver pronta."));
}

export async function mudarStatusPesquisa(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const acao = str(fd, "acao"); let msg = "";
  try {
    assert(P.podePesquisas(s), "Só RH e Direção.");
    const [sv] = await sql<{ status: string; titulo: string; publico: string; unit_id: number | null; position_id: number | null; identificada: boolean }[]>`SELECT status, titulo, publico, unit_id, position_id, identificada FROM custom_surveys WHERE id=${id}`; assert(!!sv, "Pesquisa não encontrada.");
    if (acao === "ABRIR") {
      assert(sv!.status === "RASCUNHO", "Só rascunho pode ser aberto."); await sql`UPDATE custom_surveys SET status='ABERTA', aberta_em=now() WHERE id=${id}`;
      const users = (await sql<{ id: number }[]>`SELECT u.id FROM users u JOIN employees e ON e.id=u.employee_id WHERE u.ativo AND e.situacao <> 'DESLIGADO' ${sv!.publico === "UNIDADE" ? sql`AND e.unit_id=${sv!.unit_id}` : sv!.publico === "CARGO" ? sql`AND e.position_id=${sv!.position_id}` : sql``}`).map(r => r.id);
      await notificar(users, "Nova pesquisa para responder", `${sv!.identificada ? "Pesquisa identificada" : "Pesquisa anônima"}: responda no Meu espaço.`, `/eu/pesquisas/${id}`, "ACAO", `pesquisa:${id}`);
      msg = `Pesquisa aberta; ${users.length} pessoa(s) avisada(s).`;
    } else if (acao === "ENCERRAR") { assert(sv!.status === "ABERTA", "Só pesquisa aberta pode ser encerrada."); await sql`UPDATE custom_surveys SET status='ENCERRADA', encerrada_em=now() WHERE id=${id}`; msg = "Pesquisa encerrada."; }
    else if (acao === "EXCLUIR") { assert(sv!.status === "RASCUNHO", "Só rascunho pode ser excluído."); await sql`DELETE FROM custom_surveys WHERE id=${id}`; await audit(s, "excluir rascunho de pesquisa", "custom_surveys", id, null, { titulo: sv!.titulo }); redirect(go(BASE, "ok", "Rascunho excluído.")); }
    else throw new Error("Ação inválida.");
    await audit(s, `${acao.toLowerCase()} pesquisa interna`, "custom_surveys", id, { status: sv!.status }, null);
  } catch (e) { if (e instanceof Error && (e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e; redirect(go(`${BASE}/${id}`, "erro", msgErro(e))); }
  redirect(go(`${BASE}/${id}`, "ok", msg));
}

/** Resposta no Meu espaço. Anônima: grava só a unidade (para o recorte com mínimo) e nenhuma data; a marca de “já respondeu” fica à parte. */
export async function responderPesquisaInterna(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const volta = `/eu/pesquisas/${id}`;
  try {
    const [sv] = await sql<{ status: string; inicio: string; fim: string; identificada: boolean; perguntas: P.Pergunta[] }[]>`SELECT status, inicio::text, fim::text, identificada, perguntas FROM custom_surveys WHERE id=${id}`;
    assert(!!sv && sv.status === "ABERTA" && sv.inicio <= hoje() && sv.fim >= hoje(), "Pesquisa fechada."); assert(await P.noPublico(id, s.employeeId), "Esta pesquisa não é para o seu grupo.");
    const [ja] = await sql`SELECT 1 FROM custom_survey_marks WHERE survey_id=${id} AND user_id=${s.id}`; assert(!ja, "Você já respondeu esta pesquisa. Obrigado!");
    const respostas: Record<string, unknown> = {};
    for (const q of sv!.perguntas) {
      if (q.tipo === "MULTIPLA") { const vs = fd.getAll(q.id).map(String).filter(v => q.opcoes!.includes(v)); if (vs.length) respostas[q.id] = vs; }
      else if (q.tipo === "UNICA") { const v = str(fd, q.id); if (v && q.opcoes!.includes(v)) respostas[q.id] = v; }
      else if (q.tipo === "ESCALA") { const n = Number(str(fd, q.id)); if (Number.isInteger(n) && n >= 1 && n <= 5) respostas[q.id] = n; }
      else { const t = str(fd, q.id).slice(0, 2000); if (t) respostas[q.id] = t; }
      if (q.obrigatoria && respostas[q.id] === undefined) throw new Error(`Responda: “${q.texto.slice(0, 80)}”.`);
    }
    assert(Object.keys(respostas).length > 0, "Responda ao menos uma pergunta.");
    const [e] = await sql<{ unit_id: number }[]>`SELECT unit_id FROM employees WHERE id=${s.employeeId}`;
    await sql.begin(async tx => {
      const m = await tx`INSERT INTO custom_survey_marks (survey_id, user_id) VALUES (${id}, ${s.id}) ON CONFLICT DO NOTHING`; if (m.count === 0) throw new Error("Você já respondeu esta pesquisa. Obrigado!");
      if (sv!.identificada) await tx`INSERT INTO custom_survey_responses (survey_id, user_id, employee_id, unit_id, respostas, respondido_em) VALUES (${id}, ${s.id}, ${s.employeeId}, ${e?.unit_id ?? null}, ${JSON.stringify(respostas)}::jsonb, now())`;
      else await tx`INSERT INTO custom_survey_responses (survey_id, unit_id, respostas) VALUES (${id}, ${e?.unit_id ?? null}, ${JSON.stringify(respostas)}::jsonb)`;
    });
  } catch (e) { redirect(go(volta, "erro", msgErro(e))); }
  redirect(go("/eu/pesquisas", "ok", "Resposta enviada. Obrigado!"));
}
