"use server";
// v31 · 360°: incluir e remover pares avaliador › avaliado no ciclo e convidar os pares sugeridos automaticamente.
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit, type Session } from "@/lib/auth";
import { audit, str, strOrNull, int, getSettings } from "@/lib/utils";
import { notificar } from "@/lib/comunicacao";
import { comMensagem } from "@/lib/redirecionar";
import { sugerirPares } from "@/lib/participantes360";

const go = (b: string, k: "ok" | "erro", m: string) => comMensagem(b, k, m);
const erro = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado.");
const CONDUZ = ["RH", "DIRECAO", "DIRETOR_UNIDADE"];

async function ciclo(cid: number) {
  const [c] = await sql<{ id: number; fase: string; fontes: Record<string, { peso: number; minimo: number }> | null }[]>`SELECT id, fase, fontes FROM perf_cycles WHERE id=${cid}`;
  assert(!!c, "Ciclo não encontrado."); assert(!["CONCLUSAO", "ARQUIVADO"].includes(c.fase), "Ciclo encerrado: os pares não mudam."); return c;
}
async function podeNoReview(s: Session, reviewId: number) {
  const [r] = await sql<{ id: number; cycle_id: number; employee_id: number; unit_id: number; gestor_id: number | null; avaliador_user_id: number | null; estado: string; status: string; nome: string }[]>`SELECT r.id, r.cycle_id, r.employee_id, e.unit_id, e.gestor_id, r.avaliador_user_id, r.estado, r.status, e.nome FROM perf_reviews r JOIN employees e ON e.id=r.employee_id WHERE r.id=${reviewId}`;
  assert(!!r, "Avaliação não encontrada."); const u = scopeUnit(s);
  const ok = ["RH", "DIRECAO"].includes(s.role) || (s.role === "DIRETOR_UNIDADE" && u === r.unit_id) || r.avaliador_user_id === s.id;
  assert(ok, "Só o RH, a direção da unidade ou o avaliador designado mexem nos pares desta avaliação.");
  assert(!["PUBLICADA", "CONTESTADA", "INCONCLUSIVA"].includes(r.estado) && r.status !== "CONCLUIDA", "Avaliação encerrada."); return r;
}

export async function adicionarPar(fd: FormData) {
  const s = await requireSession(); const cid = Number(str(fd, "cycleId")); const volta = `/desempenho/ciclos/${cid}/participantes`;
  try {
    const c = await ciclo(cid); const r = await podeNoReview(s, Number(str(fd, "reviewId"))); assert(r.cycle_id === cid, "A avaliação é de outro ciclo.");
    const grupo = str(fd, "grupo"); assert(["PAR", "LIDERADO"].includes(grupo) && !!c.fontes?.[grupo], "Este ciclo não tem essa fonte habilitada (pares e liderados são opcionais e ligados no planejamento).");
    const uid = int(fd, "userId") ?? 0; const [u] = await sql<{ id: number; nome: string; employee_id: number | null; gestor_id: number | null }[]>`SELECT u.id, u.nome, u.employee_id, e.gestor_id FROM users u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.id=${uid} AND u.ativo`;
    assert(!!u, "Escolha quem avalia."); assert(u.employee_id !== r.employee_id, "O avaliado não é par de si mesmo — a autoavaliação já está no ciclo.");
    assert(u.id !== r.avaliador_user_id, `${u.nome} já é o avaliador designado (líder › liderado).`);
    if (grupo === "LIDERADO") assert(u.gestor_id === r.employee_id, `${u.nome} não é da equipe direta de ${r.nome} — use “Pares”.`);
    const [dup] = await sql`SELECT 1 FROM review_raters WHERE review_id=${r.id} AND user_id=${u.id}`; assert(!dup, `${u.nome} já está convidado(a) para esta avaliação.`);
    const cfg = await getSettings(); const teto = Number(cfg.desempenho.maxConvitesPorAvaliador) || 6;
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM review_raters rr JOIN perf_reviews x ON x.id=rr.review_id WHERE x.cycle_id=${cid} AND rr.user_id=${u.id}`;
    assert(n < teto, `${u.nome} já tem ${n} convite(s) neste ciclo (teto ${teto}) — escolha outra pessoa para não sobrecarregar.`);
    const motivo = str(fd, "motivo") || (grupo === "LIDERADO" ? "Equipe direta (liderado avalia o líder)" : "Trabalham juntos no dia a dia");
    const ins = await sql`INSERT INTO review_raters (review_id, user_id, grupo, motivo) VALUES (${r.id}, ${u.id}, ${grupo}, ${motivo.slice(0, 200)}) ON CONFLICT (review_id, user_id) DO NOTHING`;
    assert(ins.count === 1, `${u.nome} já está convidado(a) para esta avaliação.`);
    await notificar([u.id], "Você foi convidado a contribuir com uma avaliação", "Responda apenas o que teve oportunidade de observar.", "/contribuicoes", "ACAO", `rater:${r.id}:${u.id}`);
    await audit(s, "incluir par no 360", "perf_reviews", r.id, null, { grupo, avaliador: u.id });
  } catch (e) { redirect(go(volta, "erro", erro(e))); }
  redirect(go(volta, "ok", "Par incluído e convite enviado."));
}

export async function removerPar(fd: FormData) {
  const s = await requireSession(); const cid = Number(str(fd, "cycleId")); const volta = `/desempenho/ciclos/${cid}/participantes`;
  try {
    await ciclo(cid); const id = Number(str(fd, "raterId"));
    const [x] = await sql<{ review_id: number; status: string; user_id: number }[]>`SELECT review_id, status, user_id FROM review_raters WHERE id=${id}`; assert(!!x, "Par não encontrado.");
    await podeNoReview(s, x.review_id); assert(x.status === "CONVIDADO", "Quem já respondeu não sai — a resposta faz parte do registro do ciclo.");
    await sql`DELETE FROM review_raters WHERE id=${id}`; await audit(s, "remover par do 360", "perf_reviews", x.review_id, { avaliador: x.user_id, motivo: strOrNull(fd, "motivo") }, null);
  } catch (e) { redirect(go(volta, "erro", erro(e))); }
  redirect(go(volta, "ok", "Par removido."));
}

/** Convida os pares sugeridos marcados (cada um recebe um único aviso com a quantidade de convites). */
export async function convidarSugeridos(fd: FormData) {
  const s = await requireSession(); const cid = Number(str(fd, "cycleId")); const volta = `/desempenho/ciclos/${cid}/participantes`; let n = 0;
  try {
    assert(CONDUZ.includes(s.role), "Os pares sugeridos são convidados pelo RH ou pela direção da unidade."); await ciclo(cid);
    const cfg = await getSettings(); const marcados = new Set(fd.getAll("par").map(String));
    const sug = (await sugerirPares(cid, scopeUnit(s), Number(cfg.desempenho.paresSugeridos) || 4, Number(cfg.desempenho.maxConvitesPorAvaliador) || 6)).filter(x => marcados.has(`${x.review_id}:${x.user_id}:${x.grupo}`));
    assert(sug.length > 0, "Marque ao menos um par sugerido.");
    const porUser = new Map<number, number>();
    for (const x of sug) { const r = await sql`INSERT INTO review_raters (review_id, user_id, grupo, motivo) VALUES (${x.review_id}, ${x.user_id}, ${x.grupo}, ${`sugestão automática: ${x.porque}`}) ON CONFLICT (review_id, user_id) DO NOTHING`; if (r.count) { n++; porUser.set(x.user_id, (porUser.get(x.user_id) ?? 0) + 1); } }
    for (const [uid, q] of porUser) await notificar([uid], `Você foi convidado a contribuir com ${q} avaliação(ões)`, "Responda apenas o que teve oportunidade de observar.", "/contribuicoes", "ACAO", `rater-lote:${cid}:${uid}:${q}`);
    await audit(s, "convidar pares sugeridos (360)", "perf_cycles", cid, null, { convites: n, avaliadores: porUser.size });
  } catch (e) { redirect(go(volta, "erro", erro(e))); }
  redirect(go(volta, "ok", `${n} convite(s) enviados — o 360 deste ciclo está montado.`));
}
