// v34 · pendências do autoatendimento e dos documentos: assinar (e o espelho do mês), responder pesquisa e termômetro,
// aprovar e lançar ajuste de ponto, conferir atestado, revisar alteração cadastral, dividir/publicar a folha, responder
// contestação, publicar escala e repor estoque. Sempre contagem ou o mínimo de dado pessoal no título.
import { sql } from "@/db";
import type { Session } from "./auth";
import { scopeUnit } from "./auth";
import { hoje, addDays, getSettings } from "./utils";
import type { Pendencia } from "./pendencias";
import { filtroAprovaAjuste } from "./autoatendimento";
import { pesquisasPendentes } from "./pesquisas";
import { semanaDe } from "./humor";
import { segunda } from "./escalas";

export async function pendenciasV34(s: Session): Promise<{ itens: Pendencia[]; falhas: string[] }> {
  const itens: Pendencia[] = []; const falhas: string[] = []; const h = hoje(); const rh = ["RH", "DIRECAO"].includes(s.role);
  const passo = async (nome: string, f: () => Promise<void>) => { try { await f(); } catch (e) { falhas.push(`v34 ${nome}: ${e instanceof Error ? e.message : String(e)}`); } };
  await passo("pessoal", async () => {
    if (!s.employeeId) return;
    const ass = await sql<{ id: number; titulo: string; tipo: string; prazo: string | null }[]>`SELECT r.id, d.titulo, d.tipo, d.prazo::text FROM sign_requests r JOIN sign_documents d ON d.id=r.document_id WHERE r.employee_id=${s.employeeId} AND r.status='PENDENTE' AND d.status='ABERTO' ORDER BY d.prazo NULLS LAST LIMIT 10`;
    for (const a of ass) itens.push({ chave: `assinar${a.id}`, grupo: "ATENDER", modulo: "Assinaturas", acao: a.tipo === "ESPELHO" ? "Conferir e assinar o espelho" : "Ler e assinar", titulo: a.titulo, href: `/eu/assinaturas/${a.id}`, prazo: a.prazo });
    for (const p of await pesquisasPendentes(s)) itens.push({ chave: `pesq${p.id}`, grupo: "CIENCIA", modulo: "Pesquisas", acao: "Responder", titulo: p.titulo, sub: p.identificada ? "identificada" : "anônima", href: `/eu/pesquisas/${p.id}`, prazo: p.fim });
    const cfg = await getSettings();
    if (cfg.termometro.ativo !== false) { const sem = semanaDe(h); const [ja] = await sql`SELECT 1 FROM mood_marks WHERE user_id=${s.id} AND dia=${sem}`; if (!ja) itens.push({ chave: `humor${sem}`, grupo: "CIENCIA", modulo: "Termômetro", acao: "Responder (anônimo, 10 segundos)", titulo: "Como foi a sua semana?", href: "/eu", prazo: null }); } // sem prazo: convite, nunca urgência nem lembrete
  });
  await passo("ajustes", async () => {
    if (!["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role) && !s.employeeId) return;
    const [r] = await sql<{ n: number; antigo: string | null }[]>`SELECT count(*)::int AS n, min(r.created_at)::date::text AS antigo FROM timesheet_adjust_requests r JOIN employees e ON e.id=r.employee_id WHERE r.status='PENDENTE' AND ${filtroAprovaAjuste(s)}`;
    if (r?.n) itens.push({ chave: "ajuste-aprovar", grupo: "APROVAR", modulo: "Ponto", acao: "Aprovar ajuste de ponto", titulo: `${r.n} pedido(s) de ajuste de ponto`, href: "/ponto/ajustes", prazo: r.antigo ? addDays(r.antigo, 2) : null, quantidade: r.n });
    if (rh) { const [l] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM timesheet_adjust_requests WHERE status='APROVADO'`; if (l?.n) itens.push({ chave: "ajuste-lancar", grupo: "ATENDER", modulo: "Ponto", acao: "Lançar no ponto", titulo: `${l.n} ajuste(s) aprovado(s) para lançar`, href: "/ponto/ajustes?aba=lancar", prazo: h, quantidade: l.n }); }
  });
  if (rh) await passo("rh", async () => {
    const [a] = await sql<{ n: number; antigo: string | null }[]>`SELECT count(*)::int AS n, min(created_at)::date::text AS antigo FROM medical_certificates WHERE status='ENVIADO'`;
    if (a?.n) itens.push({ chave: "atestados", grupo: "ATENDER", modulo: "Ponto", acao: "Conferir atestado", titulo: `${a.n} atestado(s) recebido(s) pelo Meu espaço`, href: "/ponto/atestados", prazo: a.antigo ? addDays(a.antigo, 1) : null, quantidade: a.n });
    const [c] = await sql<{ n: number; antigo: string | null }[]>`SELECT count(*)::int AS n, min(created_at)::date::text AS antigo FROM employee_change_requests WHERE status='PENDENTE'`;
    if (c?.n) itens.push({ chave: "cadastro", grupo: "APROVAR", modulo: "Cadastro", acao: "Revisar campo a campo", titulo: `${c.n} alteração(ões) cadastral(is) ou ficha(s) de admissão`, href: "/colaboradores/alteracoes", prazo: c.antigo ? addDays(c.antigo, 3) : null, quantidade: c.n });
    const [x] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM sign_requests WHERE status IN ('RECUSADO','CONTESTADO') AND resolvido_em IS NULL`;
    if (x?.n) itens.push({ chave: "contestacoes", grupo: "ATENDER", modulo: "Assinaturas", acao: "Responder", titulo: `${x.n} recusa(s) ou contestação(ões) de espelho`, href: "/documentos/assinaturas?status=ABERTO", prazo: h, quantidade: x.n });
    const [p] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM pdf_splits WHERE status='PREVIA' AND created_at < now() - interval '1 day'`;
    if (p?.n) itens.push({ chave: "divisao", grupo: "ATENDER", modulo: "Folha", acao: "Conferir e publicar", titulo: `${p.n} divisão(ões) do PDF da folha em prévia`, href: "/folha/dividir", prazo: h, quantidade: p.n });
    const [v] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM sign_requests r JOIN sign_documents d ON d.id=r.document_id WHERE r.status='PENDENTE' AND d.status='ABERTO' AND d.prazo < ${h}`;
    if (v?.n) itens.push({ chave: "assin-vencidas", grupo: "GESTAO", modulo: "Assinaturas", acao: "Lembrar quem falta", titulo: `${v.n} assinatura(s) com prazo vencido`, href: "/documentos/assinaturas", prazo: null, quantidade: v.n });
  });
  await passo("escalas", async () => {
    const cfg = await getSettings(); const prox = addDays(segunda(h), 7); if (h < addDays(prox, -Number(cfg.escalas.diasAvisoPublicacao))) return;
    const u = scopeUnit(s);
    const eq = await sql<{ id: number; nome: string; unit_id: number; responsavel_user_id: number | null }[]>`SELECT t.id, t.nome, t.unit_id, t.responsavel_user_id FROM shift_teams t WHERE t.ativo AND EXISTS (SELECT 1 FROM shift_team_members m WHERE m.team_id=t.id) AND NOT EXISTS (SELECT 1 FROM shift_publications p WHERE p.team_id=t.id AND p.semana=${prox})
      AND (${["RH", "DIRECAO", "OPERACOES"].includes(s.role)} OR t.responsavel_user_id=${s.id} OR (${s.role === "DIRETOR_UNIDADE"} AND t.unit_id=${u ?? -1}))`;
    for (const t of eq) itens.push({ chave: `escala${t.id}-${prox}`, grupo: "GESTAO", modulo: "Escalas", acao: "Montar e publicar", titulo: `Escala da semana de ${prox.slice(8)}/${prox.slice(5, 7)} — ${t.nome}`, href: `/ponto/escalas?equipe=${t.id}&semana=${prox}`, prazo: addDays(prox, -1) });
  });
  await passo("estoque", async () => {
    if (!["RH", "DIRECAO", "DIRETOR_UNIDADE", "OPERACOES"].includes(s.role)) return; const u = scopeUnit(s);
    const [b] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM stock_levels v JOIN stock_items i ON i.id=v.item_id JOIN stock_locations l ON l.id=v.location_id WHERE i.ativo AND l.ativo AND coalesce(v.minimo, i.minimo_padrao) > 0 AND v.saldo < coalesce(v.minimo, i.minimo_padrao) ${u === null ? sql`` : sql`AND l.unit_id=${u}`}`;
    if (b?.n) itens.push({ chave: "estoque-min", grupo: "GESTAO", modulo: "Estoque", acao: "Repor", titulo: `${b.n} item(ns) abaixo do mínimo`, href: "/operacoes/estoque", prazo: null, quantidade: b.n });
    const cfg = await getSettings();
    const [l] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM stock_lots t JOIN stock_locations l ON l.id=t.location_id WHERE t.saldo > 0 AND t.validade IS NOT NULL AND t.validade <= ${addDays(h, Number(cfg.estoque.alertaValidadeDias))} ${u === null ? sql`` : sql`AND l.unit_id=${u}`}`;
    if (l?.n) itens.push({ chave: "estoque-val", grupo: "GESTAO", modulo: "Estoque", acao: "Usar antes ou dar baixa", titulo: `${l.n} lote(s) vencendo ou vencido(s)`, href: "/operacoes/estoque", prazo: null, quantidade: l.n });
  });
  return { itens, falhas };
}
