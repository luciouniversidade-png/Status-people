"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit } from "@/lib/auth";
import { audit, str, int, caminhoSeguro } from "@/lib/utils";
import { notificar, usuariosPorPerfil } from "@/lib/comunicacao";
import { progressoEtapas, proximoLembrete, NOME_ETAPA, garantirEtapas } from "@/lib/ciclo-etapas";
import { comMensagem } from "@/lib/redirecionar";

const go = (b: string, k: "ok" | "erro", m: string) => comMensagem(b, k, m);
const msg = (e: unknown) => e instanceof Error ? e.message : "Erro inesperado.";
const dataOk = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
async function conduz() { const s = await requireSession(); assert(["RH", "DIRECAO"].includes(s.role), "O ciclo é conduzido pelo RH (e pela Direção)."); return s; }

export async function criarEtapas(fd: FormData) {
  const cid = int(fd, "cycleId") ?? 0; const b = `/desempenho/ciclos/${cid}/etapas`;
  try { const s = await conduz(); await garantirEtapas(cid); await audit(s, "configurar etapas do ciclo", "perf_cycle_stages", null, null, { cycleId: cid }); } catch (e) { redirect(go(b, "erro", msg(e))); }
  redirect(go(b, "ok", "Etapas criadas com as janelas-padrão: ajuste as datas se precisar (cada mudança fica registrada)."));
}

/** Move a janela da etapa: motivo obrigatório, autor e datas registrados, participantes notificados da nova data (aceite T-059). */
export async function moverJanela(fd: FormData) {
  const id = int(fd, "stageId") ?? 0; let b = "/desempenho"; let avisados = 0;
  try {
    const s = await conduz(); const [e] = await sql<{ cycle_id: number; etapa: string; inicio: string; fim: string; status: string; nome: string }[]>`SELECT st.cycle_id, st.etapa, st.inicio::text, st.fim::text, st.status, c.nome FROM perf_cycle_stages st JOIN perf_cycles c ON c.id=st.cycle_id WHERE st.id=${id}`;
    assert(!!e, "Etapa não encontrada."); b = `/desempenho/ciclos/${e.cycle_id}/etapas`; assert(e.status !== "FECHADA", "Etapa fechada não muda de janela.");
    const inicio = str(fd, "inicio") || e.inicio; const fim = str(fd, "fim"); assert(dataOk(inicio) && dataOk(fim) && fim >= inicio, "Informe início e fim válidos (fim ≥ início).");
    const motivo = str(fd, "motivo"); assert(motivo.length >= 10, "Explique o motivo da mudança (mín. 10 caracteres).");
    assert(inicio !== e.inicio || fim !== e.fim, "As datas são as mesmas.");
    await sql.begin(async tx => {
      await tx`UPDATE perf_cycle_stages SET inicio=${inicio}, fim=${fim} WHERE id=${id}`;
      await tx`INSERT INTO perf_stage_changes (stage_id, de_fim, para_fim, motivo, user_id, user_nome) VALUES (${id}, ${e.fim}, ${fim}, ${`${motivo}${inicio !== e.inicio ? ` (início ${e.inicio.split("-").reverse().join("/")} → ${inicio.split("-").reverse().join("/")})` : ""}`}, ${s.id}, ${s.nome})`;
    });
    const p = await progressoEtapas(e.cycle_id, null); const alvo = [...new Set((p.por[e.etapa] ?? []).map(x => x.responsavel_user_id).filter((x): x is number => !!x))]; avisados = alvo.length;
    await notificar(alvo, `${NOME_ETAPA[e.etapa]} · ${e.nome}: nova data`, `A janela agora vai até ${fim.split("-").reverse().join("/")}. Motivo: ${motivo.slice(0, 140)}`, `/desempenho`, "INFO", `etapa:${id}:${fim}`);
    await audit(s, "mover janela de etapa do ciclo", "perf_cycle_stages", id, { inicio: e.inicio, fim: e.fim }, { inicio, fim, motivo });
  } catch (err) { redirect(go(b, "erro", msg(err))); }
  redirect(go(b, "ok", `Janela movida; ${avisados} participante(s) avisado(s) da nova data.`));
}

export async function fecharEtapa(fd: FormData) {
  const id = int(fd, "stageId") ?? 0; let b = "/desempenho";
  try {
    const s = await conduz(); const [e] = await sql<{ cycle_id: number; etapa: string; status: string }[]>`SELECT cycle_id, etapa, status FROM perf_cycle_stages WHERE id=${id}`; assert(!!e, "Etapa não encontrada."); b = `/desempenho/ciclos/${e.cycle_id}/etapas`;
    assert(e.status !== "FECHADA", "Etapa já fechada.");
    const p = await progressoEtapas(e.cycle_id, null); const pend = (p.por[e.etapa] ?? []).filter(x => !x.feito).length; const just = str(fd, "justificativa");
    assert(pend === 0 || just.length >= 10, `${pend} pendência(s) na etapa: para fechar assim mesmo, registre a justificativa (mín. 10 caracteres).`);
    await sql`UPDATE perf_cycle_stages SET status='FECHADA', fechada_em=now(), fechada_por=${s.id} WHERE id=${id}`;
    if (pend) await sql`INSERT INTO perf_stage_changes (stage_id, de_fim, para_fim, motivo, user_id, user_nome) SELECT id, fim, fim, ${`Fechada com ${pend} pendência(s): ${just}`}, ${s.id}, ${s.nome} FROM perf_cycle_stages WHERE id=${id}`;
    await audit(s, "fechar etapa do ciclo", "perf_cycle_stages", id, null, { etapa: e.etapa, pendentes: pend, justificativa: just || null });
  } catch (err) { redirect(go(b, "erro", msg(err))); }
  redirect(go(b, "ok", "Etapa fechada."));
}

/** Lembrete aos pendentes da etapa: máx. 2 por pessoa; o 2º registra escalonamento ao diretor da unidade (ou à Direção). */
export async function lembrarPendentes(fd: FormData) {
  const id = int(fd, "stageId") ?? 0; let b = "/desempenho"; let enviados = 0, escalados = 0, bloqueados = 0;
  try {
    const s = await requireSession(); assert(["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role), "Lembretes: RH, Direção ou direção da unidade.");
    const [e] = await sql<{ cycle_id: number; etapa: string; fim: string; nome: string }[]>`SELECT st.cycle_id, st.etapa, st.fim::text, c.nome FROM perf_cycle_stages st JOIN perf_cycles c ON c.id=st.cycle_id WHERE st.id=${id}`; assert(!!e, "Etapa não encontrada."); b = `/desempenho/ciclos/${e.cycle_id}/etapas?etapa=${e.etapa}`;
    const escolhidos = new Set(fd.getAll("employeeId").map(Number).filter(Boolean)); const todos = str(fd, "todos") === "1";
    const p = await progressoEtapas(e.cycle_id, scopeUnit(s)); const pend = (p.por[e.etapa] ?? []).filter(x => !x.feito && (todos || escolhidos.has(x.employee_id)));
    assert(pend.length > 0, "Nenhuma pendência escolhida."); const porEmp = new Map<number, typeof pend>(); for (const x of pend) porEmp.set(x.employee_id, [...(porEmp.get(x.employee_id) ?? []), x]);
    const escalarPorUnidade = new Map<number | null, number>();
    for (const [emp, itens] of porEmp) {
      const prox = proximoLembrete(itens[0].lembretes); if (!prox.permitido) { bloqueados++; continue; }
      const alvos = [...new Set(itens.map(x => x.responsavel_user_id).filter((x): x is number => !!x))];
      if (alvos.length) await notificar(alvos, `Lembrete: ${NOME_ETAPA[e.etapa]} · ${e.nome}`, `Pendente${e.etapa === "AUTO" || e.etapa === "PUBLICACAO" ? "" : ` (${itens[0].nome})`} — a janela vai até ${e.fim.split("-").reverse().join("/")}.`, e.etapa === "PARES" ? "/contribuicoes" : "/pendencias", "ACAO", `lemb:${id}:${emp}:${prox.n}`);
      await sql`INSERT INTO perf_reminders (cycle_id, etapa, employee_id, n, escalado, user_id) VALUES (${e.cycle_id}, ${e.etapa}, ${emp}, ${prox.n}, ${prox.escala}, ${s.id}) ON CONFLICT (cycle_id, etapa, employee_id) DO UPDATE SET n=EXCLUDED.n, escalado=perf_reminders.escalado OR EXCLUDED.escalado, user_id=EXCLUDED.user_id, at=now()`;
      enviados++; if (prox.escala) { escalados++; escalarPorUnidade.set(itens[0].unit_id, (escalarPorUnidade.get(itens[0].unit_id) ?? 0) + 1); }
    }
    // escalonamento: só a contagem vai ao diretor (nada nominal na notificação)
    for (const [unit, n] of escalarPorUnidade) { const dir = await usuariosPorPerfil(["DIRETOR_UNIDADE"], unit); const para = dir.length ? dir : await usuariosPorPerfil(["DIRECAO"]); await notificar(para, `Escalonamento: ${NOME_ETAPA[e.etapa]} · ${e.nome}`, `${n} pendência(s) receberam o 2º lembrete sem resposta.`, `/desempenho/ciclos/${e.cycle_id}/etapas?etapa=${e.etapa}`, "ALERTA", `esc:${id}:${unit ?? 0}:${new Date().toISOString().slice(0, 10)}`); }
    await audit(s, "lembrar pendentes da etapa", "perf_reminders", null, null, { stageId: id, enviados, escalados, bloqueados });
  } catch (err) { redirect(go(b, "erro", msg(err))); }
  redirect(go(b, "ok", `${enviados} lembrete(s) enviado(s)${escalados ? `, ${escalados} escalado(s) ao diretor` : ""}${bloqueados ? `; ${bloqueados} já tinham 2 lembretes (limite)` : ""}.`));
}
