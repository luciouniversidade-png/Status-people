import { sql } from "@/db";
import { escopoDo } from "./alertas";
import { scopeUnit, type Session } from "./auth";
import { hoje, addDays } from "./utils";
import type { Pendencia } from "./pendencias";

/**
 * Minhas pendências · v24: o que a Nova Arquitetura acrescentou à caixa de cada pessoa — alertas sob sua responsabilidade (com SLA),
 * pedidos de explicação do orçamento, obrigações fiscais, o passo da folha que espera você, onboarding, auditorias e prazos de
 * fiscalização. SST entra só como contagem (nunca nome nem dado clínico).
 */
const dl = (col: ReturnType<typeof sql>) => sql`((${col}) AT TIME ZONE 'UTC' AT TIME ZONE 'America/Campo_Grande')::date::text`;
export async function pendenciasV24(s: Session): Promise<{ itens: Pendencia[]; falhas: string[] }> {
  const h = hoje(); const me = s.id; const emp = s.employeeId; const escopo = scopeUnit(s); const itens: Pendencia[] = []; const falhas: string[] = [];
  const bloco = async (nome: string, f: () => Promise<Pendencia[]>) => { try { itens.push(...(await f())); } catch (e) { falhas.push(`${nome}: ${e instanceof Error ? e.message : String(e)}`); } };
  await Promise.all([
    bloco("alertas", async () => {
      const [a] = await sql<{ n: number; prazo: string | null; altos: number }[]>`SELECT count(*)::int AS n, min(${dl(sql`sla_ate`)}) AS prazo, count(*) FILTER (WHERE severidade='ALTO')::int AS altos FROM alerts WHERE status='ABERTO' AND dono_user_id=${me} AND escopo=${escopoDo(s)} AND (silenciado_ate IS NULL OR silenciado_ate < ${h}::date)`;
      return a.n ? [{ chave: "alertas", grupo: "GESTAO" as const, modulo: "Central de alertas", acao: "Tratar", titulo: `${a.n} alerta(s) sob sua responsabilidade`, sub: a.altos ? `${a.altos} crítico(s)` : null, href: "/alertas?dono=eu", prazo: a.prazo, quantidade: a.n }] : [];
    }),
    bloco("orçamento", async () => {
      const r = await sql<{ id: number; categoria: string; ano: number; mes: number; escopo: number; unidade: string | null; criado: string }[]>`SELECT p.id, p.categoria, p.ano, p.mes, p.escopo, u.nome AS unidade, ${dl(sql`p.created_at`)} AS criado FROM budget_explain_requests p LEFT JOIN units u ON u.id=p.escopo WHERE p.status='ABERTA' AND p.responsavel_user_id=${me} ORDER BY p.created_at LIMIT 30`;
      return r.map(x => ({ chave: `orcexp${x.id}`, grupo: "GESTAO" as const, modulo: "Orçado × real", acao: "Explicar o desvio", titulo: `${x.categoria} · ${x.unidade ?? "Rede"}`, sub: `acima da banda em ${String(x.mes).padStart(2, "0")}/${x.ano}`, href: `/financeiro/orcamento?ano=${x.ano}&mes=${x.mes}&visao=mes${x.escopo ? `&unidade=${x.escopo}` : ""}#explicacoes`, prazo: addDays(x.criado, 5) }));
    }),
    bloco("obrigações", async () => {
      const r = await sql<{ id: number; tipo: string; entidade: string | null; vencimento: string; status: string }[]>`SELECT o.id, o.tipo, c.nome AS entidade, o.vencimento::text, o.status FROM obligations o LEFT JOIN companies c ON c.id=o.company_id WHERE o.responsavel_user_id=${me} AND o.status IN ('PENDENTE','AGUARDA_COMPROVANTE') AND o.vencimento <= ${addDays(h, 7)}::date ORDER BY o.vencimento LIMIT 30`;
      return r.map(x => ({ chave: `obr${x.id}`, grupo: "ATENDER" as const, modulo: "Obrigações fiscais", acao: x.status === "AGUARDA_COMPROVANTE" ? "Anexar o comprovante" : "Pagar e comprovar", titulo: `${x.tipo}${x.entidade ? ` · ${x.entidade}` : ""}`, href: `/financeiro/obrigacoes?ctx_p=${x.vencimento.slice(0, 7)}#obr-${x.id}`, prazo: x.vencimento }));
    }),
    bloco("fiscalizações", async () => {
      const r = await sql<{ id: number; case_id: number; titulo: string; prazo: string }[]>`SELECT e.id, e.case_id, f.titulo, e.prazo::text FROM fiscal_case_events e JOIN fiscal_cases f ON f.id=e.case_id WHERE f.status <> 'ENCERRADO' AND f.responsavel_user_id=${me} AND e.prazo IS NOT NULL AND e.cumprido_em IS NULL ORDER BY e.prazo LIMIT 20`;
      return r.map(x => ({ chave: `fisc${x.id}`, grupo: "ATENDER" as const, modulo: "Fiscalizações", acao: "Cumprir o prazo", titulo: x.titulo, href: `/financeiro/obrigacoes?caso=${x.case_id}#fiscalizacoes`, prazo: x.prazo }));
    }),
    bloco("folha", async () => {
      const papelRh = ["RH", "DIRECAO"].includes(s.role), papelFin = ["FINANCEIRO", "DIRECAO"].includes(s.role); if (!papelRh && !papelFin) return [];
      const r = await sql<{ id: number; competencia: string; status: string; entidade: string | null; pacote_por: number | null }[]>`SELECT c.id, c.competencia, c.status, co.nome AS entidade, c.pacote_por FROM payroll_cycles c LEFT JOIN companies co ON co.id=c.company_id WHERE c.status IN ('PACOTE_ENVIADO','DEVOLVIDO','CONFERIDO','RESULTADO_IMPORTADO','ACEITO') ORDER BY c.competencia DESC LIMIT 40`;
      const PASSO: Record<string, { quem: "RH" | "FIN"; acao: string }> = { PACOTE_ENVIADO: { quem: "FIN", acao: "Conferir o pacote (Four-Eyes)" }, DEVOLVIDO: { quem: "RH", acao: "Resolver as divergências" }, CONFERIDO: { quem: "RH", acao: "Importar o resultado do contador" }, RESULTADO_IMPORTADO: { quem: "FIN", acao: "Aceitar o resultado" }, ACEITO: { quem: "RH", acao: "Arquivar holerites e guias" } };
      return r.filter(x => { const p = PASSO[x.status]; return p && ((p.quem === "RH" && papelRh) || (p.quem === "FIN" && papelFin && !(x.status === "PACOTE_ENVIADO" && x.pacote_por === me))); })
        .map(x => { const [a, m] = x.competencia.split("-").map(Number); const prox = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`; return { chave: `folha${x.id}`, grupo: "ATENDER" as const, modulo: "Folha (Payroll Bridge)", acao: PASSO[x.status].acao, titulo: `Folha ${x.competencia.split("-").reverse().join("/")}${x.entidade ? ` · ${x.entidade}` : ""}`, href: `/folha/${x.id}`, prazo: `${prox}-${x.status === "ACEITO" ? "15" : "10"}` }; });
    }),
    bloco("onboarding", async () => {
      const r = await sql<{ id: number; plan_id: number; titulo: string; prazo: string; nome: string; responsavel: string }[]>`SELECT i.id, i.plan_id, i.titulo, i.prazo::text, e.nome, i.responsavel FROM onboarding_items i JOIN onboarding_plans p ON p.id=i.plan_id JOIN employees e ON e.id=p.employee_id
        WHERE p.status='EM_ANDAMENTO' AND i.concluido_em IS NULL AND i.prazo <= ${addDays(h, 3)}::date AND ((i.responsavel='GESTOR' AND p.gestor_user_id=${me}) OR (i.responsavel='BUDDY' AND p.buddy_employee_id=${emp ?? 0}) OR (i.responsavel='NOVATO' AND p.employee_id=${emp ?? 0}) OR (i.responsavel='RH' AND ${["RH", "DIRECAO"].includes(s.role)}))
          ${escopo === null ? sql`` : sql`AND e.unit_id=${escopo}`} ORDER BY i.prazo LIMIT 30`;
      return r.map(x => ({ chave: `onb${x.id}`, grupo: x.responsavel === "NOVATO" ? "CIENCIA" as const : "ATENDER" as const, modulo: "Onboarding", acao: "Concluir o item", titulo: x.titulo, sub: x.responsavel === "NOVATO" ? "seu plano de integração" : `integração de ${x.nome}`, href: `/onboarding/${x.plan_id}`, prazo: x.prazo }));
    }),
    bloco("auditorias", async () => {
      const r = await sql<{ id: number; titulo: string; status: string; planejada_para: string; prazo_relatorio: string | null }[]>`SELECT id, titulo, status, planejada_para::text, prazo_relatorio::text FROM audits WHERE lead_user_id=${me} AND status IN ('PLANEJADA','EM_EXECUCAO','RELATORIO') AND (planejada_para <= ${addDays(h, 7)}::date OR status <> 'PLANEJADA') ORDER BY planejada_para LIMIT 20`;
      return r.map(x => ({ chave: `aud${x.id}`, grupo: "GESTAO" as const, modulo: "Auditorias", acao: x.status === "PLANEJADA" ? "Conduzir a auditoria" : "Concluir o relatório", titulo: x.titulo, href: `/governanca/auditorias?id=${x.id}`, prazo: x.status === "PLANEJADA" ? x.planejada_para : x.prazo_relatorio }));
    }),
    bloco("sst", async () => {
      if (!["RH", "DIRECAO"].includes(s.role)) return [];
      const [c] = await sql<{ cat: number; prazo: string | null; inv: number; prazo_inv: string | null }[]>`SELECT count(*) FILTER (WHERE cat_necessaria AND cat_emitida_em IS NULL)::int AS cat, min(cat_prazo) FILTER (WHERE cat_necessaria AND cat_emitida_em IS NULL)::text AS prazo, count(*) FILTER (WHERE investigado_em IS NULL AND investigacao_prazo IS NOT NULL)::int AS inv, min(investigacao_prazo) FILTER (WHERE investigado_em IS NULL)::text AS prazo_inv FROM sst_incidents`;
      const out: Pendencia[] = [];
      if (c.cat) out.push({ chave: "sstcat", grupo: "ATENDER", modulo: "SST", acao: "Emitir a CAT", titulo: `${c.cat} incidente(s) com CAT pendente`, href: "/sst/incidentes", prazo: c.prazo, quantidade: c.cat });
      if (c.inv) out.push({ chave: "sstinv", grupo: "ATENDER", modulo: "SST", acao: "Concluir a investigação", titulo: `${c.inv} incidente(s) em investigação`, href: "/sst/incidentes", prazo: c.prazo_inv, quantidade: c.inv });
      return out;
    }),
  ]);
  return { itens, falhas };
}
