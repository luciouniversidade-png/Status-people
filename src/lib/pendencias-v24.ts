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
    bloco("contratos com prazo", async () => {
      // v27 · RH/Direção/direção da unidade decidem; o gestor direto recomenda (só a própria equipe)
      const { prazosContratuais, TIPO_PRAZO } = await import("./contratos-prazo"); const out: Pendencia[] = [];
      if (["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role)) {
        const ps = (await prazosContratuais({ unitId: escopo })).filter(p => ["VENCIDO", "VENCENDO", "SEM_DATA"].includes(p.situacao)).slice(0, 30);
        out.push(...ps.map(p => ({ chave: `prazo${p.employee_id}-${p.tipo}-${p.etapa}`, grupo: "APROVAR" as const, modulo: "Contratos com prazo", acao: p.situacao === "SEM_DATA" ? "Cadastrar o término" : "Decidir", titulo: `${p.nome} · ${TIPO_PRAZO[p.tipo]}`, sub: `${p.rotulo}${p.recomendacao ? " · gestor já recomendou" : ""}`, href: "/contratos-prazo", prazo: p.vence_em })));
      }
      if (emp) {
        const ps = (await prazosContratuais({ unitId: null, gestorId: emp })).filter(p => ["VENCIDO", "VENCENDO"].includes(p.situacao) && !p.recomendacao).slice(0, 20);
        out.push(...ps.map(p => ({ chave: `prazorec${p.employee_id}-${p.tipo}-${p.etapa}`, grupo: "ATENDER" as const, modulo: "Contratos com prazo", acao: "Recomendar", titulo: `${p.nome} · ${TIPO_PRAZO[p.tipo]}`, sub: `${p.rotulo} — sua avaliação do período`, href: "/contratos-prazo", prazo: p.vence_em })));
      }
      return out;
    }),
    bloco("contas a pagar", async () => {
      // v27 · quem tem a alçada: títulos aguardando a sua aprovação (sem os que a pessoa lançou ou já aprovou); Financeiro/Direção: o que vence sem programação e o que está programado para hoje
      const { getSettings } = await import("./utils"); const cfg = await getSettings(); const out: Pendencia[] = []; const fu = escopo === null ? sql`` : sql`AND p.unit_id=${escopo}`;
      if (((cfg.alcadas.contasPagar ?? ["DIRECAO"]) as string[]).includes(s.role)) {
        const r = await sql<{ id: number; numero: number; descricao: string; categoria: string; total: number; criado: string; dupla: boolean }[]>`SELECT p.id, p.numero, p.descricao, p.categoria, coalesce((SELECT sum(i.valor) FROM payable_installments i WHERE i.payable_id=p.id AND i.status='A_PAGAR'), 0)::float AS total, ${dl(sql`p.created_at`)} AS criado, p.aprovacoes_necessarias > 1 AS dupla
          FROM payables p WHERE p.status='AGUARDANDO_APROVACAO' AND p.created_by IS DISTINCT FROM ${me} AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p.aprovacoes) x WHERE (x->>'userId')::int = ${me}) ${fu} ORDER BY p.created_at LIMIT 30`;
        out.push(...r.map(x => ({ chave: `cp${x.id}`, grupo: "APROVAR" as const, modulo: "Contas a pagar", acao: x.dupla ? "Aprovar (dupla checagem)" : "Aprovar", titulo: `CP-${String(x.numero).padStart(4, "0")} · ${x.descricao}`, sub: `${x.categoria} · ${x.total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`, href: `/financeiro/contas-a-pagar/${x.id}`, prazo: addDays(x.criado, 2) })));
      }
      if (["FINANCEIRO", "DIRECAO"].includes(s.role)) {
        const j = Number(cfg.contasPagar?.alertaDias ?? 3);
        const [c] = await sql<{ aprog: number; venc: string | null; hoje: number; vencidas: number; min_vencida: string | null }[]>`SELECT count(*) FILTER (WHERE NOT i.retida AND i.programado_para IS NULL AND i.vencimento BETWEEN ${h}::date AND ${addDays(h, j)}::date)::int AS aprog, min(i.vencimento) FILTER (WHERE NOT i.retida AND i.programado_para IS NULL AND i.vencimento BETWEEN ${h}::date AND ${addDays(h, j)}::date)::text AS venc,
            count(*) FILTER (WHERE i.programado_para = ${h}::date)::int AS hoje, count(*) FILTER (WHERE i.vencimento < ${h}::date)::int AS vencidas, min(i.vencimento) FILTER (WHERE i.vencimento < ${h}::date)::text AS min_vencida
          FROM payable_installments i JOIN payables p ON p.id=i.payable_id WHERE i.status='A_PAGAR' AND p.status='ATIVO' ${fu}`;
        if (c.aprog) out.push({ chave: "cpaprog", grupo: "ATENDER", modulo: "Contas a pagar", acao: "Programar o pagamento", titulo: `${c.aprog} parcela(s) vencendo em até ${j} dia(s) sem programação`, href: "/financeiro/contas-a-pagar?sit=aprogramar", prazo: c.venc, quantidade: c.aprog });
        if (c.hoje) out.push({ chave: "cphoje", grupo: "ATENDER", modulo: "Contas a pagar", acao: "Pagar e baixar pelo extrato", titulo: `${c.hoje} pagamento(s) programado(s) para hoje`, href: "/financeiro/contas-a-pagar?aba=programacao", prazo: h, quantidade: c.hoje });
        if (c.vencidas) out.push({ chave: "cpvenc", grupo: "ATENDER", modulo: "Contas a pagar", acao: "Regularizar", titulo: `${c.vencidas} parcela(s) vencida(s) sem baixa`, href: "/financeiro/contas-a-pagar?sit=vencidas", prazo: c.min_vencida, quantidade: c.vencidas });
      }
      return out;
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
    bloco("plano de contas e orçamento", async () => {
      // v28 · saídas sem conta na janela de classificação, critério de rateio aguardando a Direção e o orçamento do próximo ano na temporada
      if (!["FINANCEIRO", "DIRECAO"].includes(s.role)) return [];
      const { getSettings } = await import("./utils"); const cfg = await getSettings(); const out: Pendencia[] = [];
      const janela = Number(cfg.planoContas?.janelaClassificacaoDias ?? 120); const internas = [...(cfg.dre.internas as string[])];
      const [c] = await sql<{ n: number; v: number | null }[]>`SELECT count(*)::int AS n, sum(valor)::float AS v FROM cash_entries WHERE tipo='SAIDA' AND conta_id IS NULL AND data >= ${addDays(h, -janela)}::date AND NOT (categoria = ANY(${internas})) ${escopo === null ? sql`` : sql`AND unit_id=${escopo}`}`;
      if (c.n) out.push({ chave: "semconta", grupo: "ATENDER", modulo: "Plano de contas", acao: "Classificar", titulo: `${c.n} saída(s) sem conta do plano`, sub: `últimos ${janela} dias · ${(c.v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}`, href: "/financeiro/plano-de-contas?aba=classificacao", prazo: null, quantidade: c.n });
      if (s.role === "DIRECAO") {
        const [r] = await sql<{ n: number; criado: string | null }[]>`SELECT count(*)::int AS n, min(${dl(sql`created_at`)}) AS criado FROM allocation_rules WHERE status='RASCUNHO' AND criado_por IS DISTINCT FROM ${me}`;
        if (r.n) out.push({ chave: "rateio", grupo: "APROVAR", modulo: "Rateio", acao: "Aprovar o critério", titulo: `${r.n} regra(s) de rateio aguardando a Direção`, href: "/financeiro/rateio#regras", prazo: r.criado, quantidade: r.n });
      }
      const mes = Number(h.slice(5, 7)); const prox = Number(h.slice(0, 4)) + 1;
      if (mes >= 10) { const [b] = await sql<{ status: string }[]>`SELECT status FROM budget_plans WHERE ano=${prox}`;
        if (!b || b.status !== "APLICADO") out.push({ chave: `orc${prox}`, grupo: "GESTAO", modulo: "Orçamento", acao: s.role === "DIRECAO" ? "Aprovar a versão" : "Preparar pelo histórico", titulo: `Orçamento ${prox} ainda não aplicado`, sub: "higienizar a base, projetar e aplicar a versão", href: `/financeiro/orcamento/historico?ano=${prox}`, prazo: `${prox - 1}-12-15` }); }
      return out;
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
