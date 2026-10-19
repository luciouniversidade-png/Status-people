import { sql } from "@/db";
import { hoje, addDays } from "./utils";
import { notificar, usuariosPorPerfil } from "./comunicacao";
import { varrerAlertas, escalarAlertas, unidadesComGestorLocal, encerrarEscopoSemGestor } from "./alertas";
import { gerarPedidosExplicacao } from "./orcamento-v24";
import { avisosObrigacoes } from "./obrigacoes";
import { somaMeses } from "./gestao-calc";
import { REL } from "./relatorios-rh";
import { enviarEmail, emailDoUsuario } from "./notify";

/**
 * Rotina diária v24 (chamada por /api/tarefas): central de alertas (varredura da rede e de cada unidade + escalonamento por SLA),
 * pedidos de explicação do orçamento do mês encerrado, lembretes do onboarding, avisos D-7/D-3/D0 das obrigações fiscais e
 * os relatórios agendados. Cada bloco roda isolado: um módulo com problema não derruba os outros.
 */
export async function rotinaV24(h = hoje()) {
  const out: Record<string, unknown> = {}; const falhas: string[] = [];
  const bloco = async (nome: string, f: () => Promise<unknown>) => { try { out[nome] = await f(); } catch (e) { falhas.push(`${nome}: ${e instanceof Error ? e.message : String(e)}`); } };
  // rede sempre; unidade só quando alguém a acompanha no recorte local (senão os alertas duplicariam o agregado da rede num dono que não os vê)
  await bloco("alertas", async () => { const units = await sql<{ id: number }[]>`SELECT id FROM units ORDER BY id`; const locais = new Set(await unidadesComGestorLocal()); const r = [await varrerAlertas(0, { forcar: true })]; let encerrados = 0;
    for (const u of units) { if (locais.has(u.id)) r.push(await varrerAlertas(u.id, { forcar: true })); else encerrados += await encerrarEscopoSemGestor(u.id); }
    return { varreduras: r.length, unidadesSemGestorLocal: units.length - (r.length - 1), encerradosSemGestor: encerrados }; });
  await bloco("escalonamento", async () => escalarAlertas());
  await bloco("explicacoes", async () => { const ant = somaMeses(h.slice(0, 7), -1); const [a, m] = ant.split("-").map(Number); return gerarPedidosExplicacao(a, m); });
  await bloco("onboarding", async () => {
    // itens que vencem em até 2 dias ou já venceram: lembrete ao responsável (no máximo 1 por item a cada 3 dias)
    const itens = await sql<{ id: number; titulo: string; prazo: string; responsavel: string; plan_id: number; gestor_user_id: number | null; buddy_user: number | null; novato_user: number | null; unit_id: number; nome: string }[]>`SELECT i.id, i.titulo, i.prazo::text, i.responsavel, i.plan_id, p.gestor_user_id,
        (SELECT u.id FROM users u WHERE u.employee_id=p.buddy_employee_id AND u.ativo LIMIT 1) AS buddy_user, (SELECT u.id FROM users u WHERE u.employee_id=p.employee_id AND u.ativo LIMIT 1) AS novato_user, e.unit_id, e.nome
      FROM onboarding_items i JOIN onboarding_plans p ON p.id=i.plan_id JOIN employees e ON e.id=p.employee_id
      WHERE p.status='EM_ANDAMENTO' AND i.concluido_em IS NULL AND i.prazo <= ${addDays(h, 2)}::date AND (i.lembrado_em IS NULL OR i.lembrado_em <= ${addDays(h, -3)}::date)`;
    const rh = await usuariosPorPerfil(["RH"]); let n = 0;
    for (const i of itens) {
      const para = i.responsavel === "GESTOR" ? [i.gestor_user_id ?? 0] : i.responsavel === "BUDDY" ? [i.buddy_user ?? 0] : i.responsavel === "NOVATO" ? [i.novato_user ?? 0] : rh;
      const alvo = para.filter(Boolean); if (!alvo.length) continue;
      await notificar(alvo, i.prazo < h ? `Onboarding atrasado: ${i.titulo}` : `Onboarding vence em breve: ${i.titulo}`, `${i.responsavel === "NOVATO" ? "Seu plano de integração" : `Integração de ${i.nome}`} · prazo ${i.prazo.split("-").reverse().join("/")}`, `/onboarding/${i.plan_id}`, i.prazo < h ? "ALERTA" : "ACAO", `onb:${i.id}:${h}`);
      await sql`UPDATE onboarding_items SET lembrado_em=${h} WHERE id=${i.id}`; n++;
    }
    return { lembretes: n };
  });
  await bloco("obrigacoes", async () => ({ avisos: await avisosObrigacoes(notificar) }));
  await bloco("relatoriosAgendados", async () => {
    const dia = Number(h.slice(8, 10)); const mesAnt = somaMeses(h.slice(0, 7), -1);
    const ags = await sql<{ id: number; user_id: number; relatorio: string; params: { unitId?: number | null } | null; ultimo_envio: string | null }[]>`SELECT id, user_id, relatorio, params, ultimo_envio::text FROM report_schedules WHERE ativo AND dia <= ${dia} AND (ultimo_envio IS NULL OR ultimo_envio < ${`${h.slice(0, 7)}-01`}::date)`;
    let n = 0;
    for (const a of ags) {
      const def = REL[a.relatorio]; if (!def) continue;
      const link = `/relatorios/biblioteca?r=${a.relatorio}&mes=${mesAnt}${a.params?.unitId ? `&unidade=${a.params.unitId}` : ""}`;
      await notificar([a.user_id], `Relatório agendado: ${def.nome}`, `O relatório de ${mesAnt.split("-").reverse().join("/")} está pronto para conferir e exportar.`, link, "INFO", `relag:${a.id}:${h.slice(0, 7)}`);
      const emails = await emailDoUsuario(a.user_id); if (emails.length) await enviarEmail(emails, `STATUS ONE · ${def.nome} (${mesAnt.split("-").reverse().join("/")})`, `O relatório "${def.nome}" de ${mesAnt.split("-").reverse().join("/")} está pronto no STATUS ONE: ${process.env.APP_URL ?? ""}${link}`).catch(() => false);
      await sql`UPDATE report_schedules SET ultimo_envio=${h} WHERE id=${a.id}`; n++;
    }
    return { enviados: n };
  });
  return { ...out, falhas };
}
