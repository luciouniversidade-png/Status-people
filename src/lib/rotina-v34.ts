// v34 · rotina diária do autoatendimento e dos documentos (avisos só com contagem, sem nomes):
//  • lembrete de assinatura N dias antes do prazo (uma vez por documento) e aviso ao RH das assinaturas vencidas;
//  • links da ficha cadastral vencidos → expirados;
//  • pesquisas internas com o fim no passado → encerradas;
//  • estoque abaixo do mínimo, lotes vencendo e CA de EPI vencendo → aviso semanal (segunda-feira) a Operações e RH;
//  • escalas da próxima semana não publicadas → aviso ao responsável (sexta-feira).
import { sql } from "@/db";
import { notificar, usuariosPorPerfil } from "./comunicacao";
import { hoje, addDays, getSettings } from "./utils";
import { segunda } from "./escalas";

export async function rotinaV34(h = hoje()) {
  const r = { lembretes: 0, assinaturasVencidas: 0, convitesExpirados: 0, pesquisasEncerradas: 0, estoqueBaixo: 0, lotesVencendo: 0, caVencendo: 0, escalasSemPublicar: 0, falhas: [] as string[] };
  const cfg = await getSettings(); const dow = new Date(`${h}T12:00:00Z`).getUTCDay();
  try {
    const dias = Number(cfg.assinaturas.lembreteDiasAntes);
    const pend = await sql<{ id: number; employee_id: number }[]>`UPDATE sign_requests r SET lembrado_em=now() FROM sign_documents d WHERE d.id=r.document_id AND r.status='PENDENTE' AND d.status='ABERTO' AND r.lembrado_em IS NULL AND d.prazo IS NOT NULL AND d.prazo <= ${addDays(h, dias)} AND d.prazo >= ${h} RETURNING r.id, r.employee_id`;
    if (pend.length) { const us = (await sql<{ id: number }[]>`SELECT id FROM users WHERE ativo AND employee_id = ANY(${pend.map(p => p.employee_id)})`).map(x => x.id); await notificar(us, "Lembrete: documento para assinar", "O prazo está chegando. Veja no Meu espaço → Documentos para assinar.", "/eu/assinaturas", "ACAO"); r.lembretes = pend.length; }
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM sign_requests r JOIN sign_documents d ON d.id=r.document_id WHERE r.status='PENDENTE' AND d.status='ABERTO' AND d.prazo = ${addDays(h, -1)}`;
    r.assinaturasVencidas = n; if (n) await notificar(await usuariosPorPerfil(["RH"]), `${n} assinatura(s) venceram ontem sem resposta`, "Lembre quem falta ou trate pessoalmente.", "/documentos/assinaturas", "ACAO", `assin-venc:${h}`);
  } catch (e) { r.falhas.push(`assinaturas: ${e instanceof Error ? e.message : String(e)}`); }
  try { r.convitesExpirados = (await sql`UPDATE admission_invites SET estado='EXPIRADO' WHERE estado='ATIVO' AND expira_em < ${h}`).count; } catch (e) { r.falhas.push(`convites: ${e instanceof Error ? e.message : String(e)}`); }
  try { r.pesquisasEncerradas = (await sql`UPDATE custom_surveys SET status='ENCERRADA', encerrada_em=now() WHERE status='ABERTA' AND fim < ${h}`).count; } catch (e) { r.falhas.push(`pesquisas: ${e instanceof Error ? e.message : String(e)}`); }
  try {
    const [b] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM stock_levels v JOIN stock_items i ON i.id=v.item_id JOIN stock_locations l ON l.id=v.location_id WHERE i.ativo AND l.ativo AND coalesce(v.minimo, i.minimo_padrao) > 0 AND v.saldo < coalesce(v.minimo, i.minimo_padrao)`;
    const [l] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM stock_lots WHERE saldo > 0 AND validade IS NOT NULL AND validade <= ${addDays(h, Number(cfg.estoque.alertaValidadeDias))}`;
    const [c] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM epi_items WHERE ativo AND ca_validade IS NOT NULL AND ca_validade <= ${addDays(h, Number(cfg.estoque.alertaCaDias))}`;
    r.estoqueBaixo = b.n; r.lotesVencendo = l.n; r.caVencendo = c.n;
    if (dow === 1 && (b.n || l.n || c.n)) await notificar(await usuariosPorPerfil(["OPERACOES", "RH"]), "Estoque: o que repor e o que vence", [b.n ? `${b.n} item(ns) abaixo do mínimo` : null, l.n ? `${l.n} lote(s) vencendo` : null, c.n ? `${c.n} CA de EPI vencendo` : null].filter(Boolean).join(" · "), "/operacoes/estoque", "ACAO", `estoque:${h}`);
  } catch (e) { r.falhas.push(`estoque: ${e instanceof Error ? e.message : String(e)}`); }
  try {
    const prox = addDays(segunda(h), 7);
    const eq = await sql<{ id: number; responsavel_user_id: number | null; unit_id: number }[]>`SELECT t.id, t.responsavel_user_id, t.unit_id FROM shift_teams t WHERE t.ativo AND EXISTS (SELECT 1 FROM shift_team_members m WHERE m.team_id=t.id) AND NOT EXISTS (SELECT 1 FROM shift_publications p WHERE p.team_id=t.id AND p.semana=${prox})`;
    r.escalasSemPublicar = eq.length;
    if (dow === 5 && eq.length) {
      const resp = [...new Set(eq.map(t => t.responsavel_user_id).filter((x): x is number => !!x))];
      await notificar([...new Set([...resp, ...await usuariosPorPerfil(["OPERACOES"])])], `${eq.length} escala(s) da próxima semana sem publicar`, "Monte e publique para a equipe ver no Meu espaço.", "/ponto/escalas", "ACAO", `escalas:${prox}`);
    }
  } catch (e) { r.falhas.push(`escalas: ${e instanceof Error ? e.message : String(e)}`); }
  return r;
}
