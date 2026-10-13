import { sql } from "@/db";
import { getSettings } from "./utils";
import { notificar as notificarBase } from "./comunicacao";
import { atualizarIndicadoresSistema, listarIndicadores } from "./gestao-estrategica";
import { etapasJornada, somaDias, periodoDe, nomePeriodo, type EtapaCfg } from "./gestao-calc";

const br = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Rotina diária da gestão estratégica e do relacionamento com as famílias (chamada por /api/tarefas).
 * Lê os indicadores do sistema e avisa quem precisa agir. Cada aviso tem chave própria: repetir a rotina no mesmo dia não duplica.
 */
export async function rotinaGestao(h: string) {
  const cfg = await getSettings(); const r = { leiturasSistema: 0, rituais: 0, atas: 0, acoes: 0, indicadores: 0, familias: 0, jornada: 0, falhas: [] as string[] };
  // Só avisa quem está ativo (participante desligado ou apagado não derruba a rotina) e cada bloco roda isolado: uma falha não impede os demais avisos
  const ativos = new Set((await sql<{ id: number }[]>`SELECT id FROM users WHERE ativo`).map(x => x.id));
  const notificar = (ids: number[], ...resto: Parameters<typeof notificarBase> extends [unknown, ...infer R] ? R : never) => { const ds = ids.filter(i => ativos.has(i)); return ds.length ? notificarBase(ds, ...resto) : Promise.resolve(); };
  const bloco = async (nome: string, f: () => Promise<void>) => { try { await f(); } catch (e) { r.falhas.push(`${nome}: ${e instanceof Error ? e.message : String(e)}`); } };
  r.leiturasSistema = await atualizarIndicadoresSistema(null, true).catch(e => { r.falhas.push(`leituras: ${e instanceof Error ? e.message : String(e)}`); return 0; });
  // unidades com indicadores próprios lidos do sistema
  for (const u of await sql<{ unit_id: number }[]>`SELECT DISTINCT unit_id FROM indicators WHERE ativo AND tipo='SISTEMA' AND unit_id IS NOT NULL`) r.leiturasSistema += await atualizarIndicadoresSistema(u.unit_id, true).catch(() => 0);

  // Rituais: reunião hoje (dono e participantes) e ritual atrasado (dono)
  await bloco("rituais", async () => {
    const tol = cfg.estrategia.toleranciaRitualDias as number;
    const rituais = await sql<{ id: number; nome: string; dono_user_id: number | null; participantes: number[] | null; proxima_data: string }[]>`SELECT id, nome, dono_user_id, participantes, proxima_data::text FROM rituals WHERE ativo AND proxima_data IS NOT NULL AND proxima_data <= ${h}`;
    for (const x of rituais) {
      if (x.proxima_data === h) { await notificar([x.dono_user_id ?? 0, ...(x.participantes ?? [])], `Ritual hoje: ${x.nome}`, "A pauta automática já está pronta na página do ritual.", `/estrategia/rituais/${x.id}`, "INFO", `ritualhoje:${x.id}:${h}`); r.rituais++; }
      else if (x.proxima_data < somaDias(h, -tol)) { await notificar([x.dono_user_id ?? 0], `Ritual atrasado: ${x.nome}`, `Previsto para ${br(x.proxima_data)}. Registre a reunião (ou o cancelamento, com motivo).`, `/estrategia/rituais/${x.id}`, "ALERTA", `ritualatraso:${x.id}:${x.proxima_data}`); r.rituais++; }
    }
  });
  // Atas pendentes
  await bloco("atas", async () => {
    const atas = await sql<{ id: number; nome: string; data: string; dono_user_id: number | null; created_by: number | null }[]>`SELECT m.id, r.nome, m.data::text, r.dono_user_id, m.created_by FROM ritual_meetings m JOIN rituals r ON r.id=m.ritual_id WHERE m.status='REALIZADA' AND coalesce(trim(m.ata),'')='' AND m.data <= ${h}::date - ${cfg.estrategia.ataPendenteDias}::int AND m.data >= ${h}::date - 60`;
    for (const m of atas) { await notificar([m.dono_user_id ?? 0, m.created_by ?? 0], `Ata pendente: ${m.nome}`, `Reunião de ${br(m.data)} sem ata registrada.`, `/estrategia/reunioes/${m.id}`, "ACAO", `ata:${m.id}`); r.atas++; }
  });
  // Plano de ação: vence em até 2 dias, vencida (uma vez por prazo) e bloqueada há mais de 7 dias (quem criou)
  await bloco("acoes", async () => {
    const acoes = await sql<{ id: number; titulo: string; prazo: string; status: string; responsavel_user_id: number | null; created_by: number | null; bloqueio: string | null; bloqueio_desde: string | null }[]>`SELECT id, titulo, prazo::text, status, responsavel_user_id, created_by, bloqueio, bloqueio_desde::text FROM action_plans WHERE status IN ('A_FAZER','EM_ANDAMENTO','BLOQUEADA') AND prazo IS NOT NULL`;
    for (const a of acoes) {
      if (a.status === "BLOQUEADA") { if (a.bloqueio_desde && a.bloqueio_desde <= somaDias(h, -7) && a.created_by && a.created_by !== a.responsavel_user_id) { await notificar([a.created_by], "Ação bloqueada há mais de 7 dias", `${a.titulo}: ${a.bloqueio ?? ""}`, `/estrategia/acoes/${a.id}`, "ALERTA", `acaobloq7:${a.id}:${a.bloqueio_desde}`); r.acoes++; } continue; }
      if (a.prazo < h) { await notificar([a.responsavel_user_id ?? 0], "Ação do plano vencida", `${a.titulo} — prazo era ${br(a.prazo)}. Conclua com evidência, registre o bloqueio ou renegocie o prazo.`, `/estrategia/acoes/${a.id}`, "ALERTA", `acaovenc:${a.id}:${a.prazo}`); r.acoes++; }
      else if (a.prazo <= somaDias(h, 2)) { await notificar([a.responsavel_user_id ?? 0], "Ação do plano vence em breve", `${a.titulo} — prazo ${br(a.prazo)}.`, `/estrategia/acoes/${a.id}`, "ACAO", `acaoprazo:${a.id}:${a.prazo}`); r.acoes++; }
    }
  });
  // Indicadores manuais sem medição em dia: avisa o responsável uma vez por mês
  await bloco("indicadores", async () => {
    const per = periodoDe(h);
    for (const i of (await listarIndicadores(null)).filter(i => i.tipo === "MANUAL" && !i.emDia && i.responsavel_user_id)) { await notificar([i.responsavel_user_id!], `Medição pendente: ${i.nome}`, `Última medição: ${i.ultimoPeriodo ? nomePeriodo(i.ultimoPeriodo) : "nenhuma"}. Registre o valor do período.`, `/estrategia/indicadores/${i.id}`, "ACAO", `indmed:${i.id}:${per}`); r.indicadores++; }
  });
  // Famílias: próximo passo combinado vencido (responsável da carteira; sem carteira, quem registrou)
  await bloco("familias", async () => {
    const passos = await sql<{ id: number; student_id: number; nome: string; proximo_passo: string; proximo_em: string; dest: number | null }[]>`SELECT DISTINCT ON (fc.student_id) fc.id, fc.student_id, st.nome, fc.proximo_passo, fc.proximo_em::text, coalesce(st.carteira_user_id, fc.user_id) AS dest
      FROM family_contacts fc JOIN students st ON st.id=fc.student_id WHERE st.aluno_atual ORDER BY fc.student_id, fc.data DESC, fc.id DESC`;
    for (const p of passos.filter(p => p.proximo_em && p.proximo_em < h && p.proximo_passo && p.dest)) { await notificar([p.dest!], `Próximo passo vencido: ${p.nome}`, `${p.proximo_passo} (combinado para ${br(p.proximo_em)}).`, `/matriculas/alunos/${p.student_id}#relacionamento`, "ALERTA", `passo:${p.id}`); r.familias++; }
  });
  // Jornada: etapa que vence em breve ou já venceu, com famílias da carteira pendentes (um aviso por responsável e etapa)
  await bloco("jornada", async () => {
    const ano = Number(h.slice(0, 4)); const etapas = etapasJornada(cfg.atendimento.jornada as EtapaCfg[], ano, new Set(), h, cfg.atendimento.avisoEtapaDias as number).filter(e => e.status === "PROXIMA" || (e.status === "ATRASADA" && e.prazo && e.prazo >= somaDias(h, -30)));
    for (const e of etapas) {
      const pend = await sql<{ dest: number; n: number }[]>`SELECT st.carteira_user_id AS dest, count(*)::int AS n FROM students st WHERE st.aluno_atual AND st.carteira_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM family_journey j WHERE j.student_id=st.id AND j.ano=${ano} AND j.etapa=${e.chave}) GROUP BY st.carteira_user_id`;
      for (const p of pend) { const venceu = e.status === "ATRASADA"; await notificar([p.dest], venceu ? `Jornada atrasada: ${e.nome}` : `Jornada: ${e.nome} até ${br(e.prazo!)}`, `${p.n} família(s) da sua carteira ainda sem esta etapa.`, "/atendimento/radar?visao=jornada&carteira=me", venceu ? "ALERTA" : "ACAO", `${venceu ? "jornadaatraso" : "jornada"}:${p.dest}:${e.chave}:${ano}`); r.jornada++; }
    }
  });
  return { gestao: r };
}
