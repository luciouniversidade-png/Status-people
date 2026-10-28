import { sql } from "@/db";
import { can, scopeUnit, aprovaSoEquipe, type Session } from "./auth";
import { veTela, alcadaDesconto, type Alcada } from "./acesso";
import { getSettings, hoje, addDays } from "./utils";
import { podePrivacidade, PEDIDO_TIPO, PEDIDO_ABERTO } from "./privacidade";
import { ehComite, ETICA_ABERTO } from "./etica";
import { matrizTreinamento } from "./clima-academy";
import { ABERTOS as CASOS_ABERTOS } from "./atendimento";
import { ABERTAS as OS_ABERTAS } from "./operacoes";

/**
 * Minhas pendências (v23): tudo o que espera a pessoa, de todos os módulos, numa caixa só — aprovar, atender, executar,
 * dar ciência e se desenvolver. Cada item tem prazo (quando existe), a ação e o link de onde resolver.
 * Regras: só o que a pessoa já pode ver e fazer no módulo de origem, no escopo da unidade dela. Ética e LGPD aparecem só pelo
 * protocolo (nenhum conteúdo). Cada bloco roda isolado: um módulo com problema não derruba a caixa.
 */
export type GrupoPend = "APROVAR" | "ATENDER" | "GESTAO" | "CIENCIA";
export const GRUPO_PEND: Record<GrupoPend, { nome: string; descricao: string }> = {
  APROVAR: { nome: "Aprovar e decidir", descricao: "Pedidos que aguardam a sua decisão." },
  ATENDER: { nome: "Atender e resolver", descricao: "Casos, chamados, pedidos e processos sob sua responsabilidade." },
  GESTAO: { nome: "Gestão e estratégia", descricao: "Plano de ação, OKRs, projetos, rituais, controles e contratos." },
  CIENCIA: { nome: "Ciência e desenvolvimento", descricao: "POPs, comunicados, treinamentos, avaliações e PDI." },
};
export const ORDEM_GRUPOS: GrupoPend[] = ["APROVAR", "ATENDER", "GESTAO", "CIENCIA"];

export type Pendencia = {
  chave: string; grupo: GrupoPend; modulo: string; acao: string; titulo: string; sub?: string | null; href: string;
  prazo: string | null;          // data local (AAAA-MM-DD) — vence no fim do dia
  quantidade?: number;           // item agregado ("12 lançamentos aguardando aprovação")
};
export type SituacaoPend = "VENCIDA" | "HOJE" | "PROXIMA" | "FUTURA" | "SEM_PRAZO";
export const SITUACAO_PEND: Record<SituacaoPend, { rotulo: string; tom: "ruim" | "atencao" | "bom" | "neutro" }> = {
  VENCIDA: { rotulo: "Vencida", tom: "ruim" }, HOJE: { rotulo: "Vence hoje", tom: "atencao" }, PROXIMA: { rotulo: "Próximos 3 dias", tom: "atencao" }, FUTURA: { rotulo: "No prazo", tom: "bom" }, SEM_PRAZO: { rotulo: "Sem prazo", tom: "neutro" },
};
export function situacaoPend(prazo: string | null, h: string): SituacaoPend {
  if (!prazo) return "SEM_PRAZO"; if (prazo < h) return "VENCIDA"; if (prazo === h) return "HOJE"; if (prazo <= addDays(h, 3)) return "PROXIMA"; return "FUTURA";
}
const PESO: Record<SituacaoPend, number> = { VENCIDA: 0, HOJE: 1, PROXIMA: 2, FUTURA: 3, SEM_PRAZO: 4 };
/** Ordem da caixa: vencidas primeiro, depois as que vencem antes; sem prazo no fim. */
export function ordenar(xs: Pendencia[], h: string) {
  return [...xs].sort((a, b) => PESO[situacaoPend(a.prazo, h)] - PESO[situacaoPend(b.prazo, h)] || (a.prazo ?? "9999").localeCompare(b.prazo ?? "9999") || a.titulo.localeCompare(b.titulo));
}

/** Data local (Campo Grande) de um instante gravado em UTC. */
const diaLocal = (col: ReturnType<typeof sql>) => sql`((${col}) AT TIME ZONE 'UTC' AT TIME ZONE 'America/Campo_Grande')::date::text`;
const ESTADO_LEAVE: Record<string, string> = { FERIAS: "Férias", AFASTAMENTO_SAUDE: "Afastamento", LICENCA: "Licença", FOLGA_BANCO: "Folga do banco", OUTRO: "Ausência" };

export async function minhasPendencias(s: Session, opcoes: { semTreinamentos?: boolean } = {}): Promise<{ itens: Pendencia[]; falhas: string[] }> {
  const cfg = await getSettings(); const h = hoje(); const escopo = scopeUnit(s); const itens: Pendencia[] = []; const falhas: string[] = [];
  const bloco = async (nome: string, f: () => Promise<Pendencia[]>) => { try { itens.push(...(await f())); } catch (e) { falhas.push(`${nome}: ${e instanceof Error ? e.message : String(e)}`); } };
  const uf = (col: string) => escopo === null ? sql`` : sql`AND ${sql(col)}=${escopo}`;
  const tem = (k: string) => can.aprovar(s, k as Alcada); // v29: aprovações do cargo
  const staff = s.role !== "COLABORADOR";
  const me = s.id; const emp = s.employeeId;

  await Promise.all([
    // ---------------------------------------------------------------- APROVAR
    bloco("solicitações", async () => {
      const r = await sql<{ id: number; numero: string; titulo: string; tipo: string; prazo: string | null; solicitante: string }[]>`SELECT r.id, r.numero, r.titulo, t.nome AS tipo, r.prazo_etapa::text AS prazo, r.solicitante_nome AS solicitante FROM requests r JOIN request_types t ON t.id=r.type_id
        WHERE r.status='EM_APROVACAO' AND (r.etapas->r.etapa_atual->'aprovadores') @> ${JSON.stringify([me])}::jsonb ORDER BY r.prazo_etapa NULLS LAST LIMIT 100`;
      const d = await sql<{ id: number; numero: string; titulo: string }[]>`SELECT id, numero, titulo FROM requests WHERE status='DEVOLVIDA' AND solicitante_user_id=${me} ORDER BY updated_at DESC LIMIT 50`;
      return [...r.map(x => ({ chave: `req${x.id}`, grupo: "APROVAR" as const, modulo: "Solicitações", acao: "Decidir", titulo: `${x.numero} · ${x.titulo}`, sub: `${x.tipo} · pedido por ${x.solicitante}`, href: `/solicitacoes/${x.id}`, prazo: x.prazo })),
        ...d.map(x => ({ chave: `dev${x.id}`, grupo: "ATENDER" as const, modulo: "Solicitações", acao: "Ajustar e reenviar", titulo: `${x.numero} · ${x.titulo}`, sub: "Devolvida para ajuste", href: `/solicitacoes/${x.id}`, prazo: null }))];
    }),
    bloco("férias", async () => {
      if (!staff || !tem("ferias")) return [];
      const r = await sql<{ id: number; nome: string; tipo: string; inicio: string; fim: string; criado: string }[]>`SELECT l.id, e.nome, l.tipo, l.inicio::text, l.fim::text, ${diaLocal(sql`l.created_at`)} AS criado FROM leave_requests l JOIN employees e ON e.id=l.employee_id
        WHERE l.status='SOLICITADA' AND e.id IS DISTINCT FROM ${emp ?? null} ${uf("e.unit_id")} ${aprovaSoEquipe(s) ? sql`AND e.gestor_id=${emp ?? 0}` : sql``} ORDER BY l.inicio LIMIT 100`;
      const pf = Number((cfg as { fluxos?: { prazoFeriasDias?: number } }).fluxos?.prazoFeriasDias ?? 3);
      return r.map(x => { const lim = addDays(x.criado, pf); const vesp = addDays(x.inicio, -1); return { chave: `fer${x.id}`, grupo: "APROVAR" as const, modulo: "Férias e afastamentos", acao: "Aprovar", titulo: `${x.nome} · ${ESTADO_LEAVE[x.tipo] ?? x.tipo}`, sub: `${x.inicio.split("-").reverse().join("/")} a ${x.fim.split("-").reverse().join("/")}`, href: aprovaSoEquipe(s) ? "/aprovacoes?aba=ferias" : "/ferias", prazo: lim < vesp ? lim : vesp }; });
    }),
    bloco("banco de horas", async () => {
      if (!staff || !tem("banco")) return [];
      const [r] = await sql<{ n: number; desde: string | null }[]>`SELECT count(*)::int AS n, min(${sql.unsafe("(h.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Campo_Grande')::date")})::text AS desde FROM hour_entries h JOIN employees e ON e.id=h.employee_id WHERE h.status='PENDENTE' AND e.id IS DISTINCT FROM ${emp ?? null} ${uf("e.unit_id")} ${aprovaSoEquipe(s) ? sql`AND e.gestor_id=${emp ?? 0}` : sql``}`;
      return r.n ? [{ chave: "banco", grupo: "APROVAR" as const, modulo: "Banco de horas", acao: "Aprovar", titulo: `${r.n} ${r.n === 1 ? "lançamento aguardando" : "lançamentos aguardando"} aprovação`, sub: r.desde ? `o mais antigo desde ${r.desde.split("-").reverse().join("/")}` : null, href: aprovaSoEquipe(s) ? "/aprovacoes?aba=banco" : "/banco-de-horas", prazo: r.desde ? addDays(r.desde, 7) : null, quantidade: r.n }] : [];
    }),
    bloco("descontos", async () => {
      const lim = alcadaDesconto(s, cfg.financeiro.alcadaDescontoPct as Record<string, number>); if (!lim) return []; // v29: alçada de desconto do cargo
      const pd = Number((cfg as { fluxos?: { prazoDecisaoDias?: number } }).fluxos?.prazoDecisaoDias ?? 2);
      const r = await sql<{ id: number; aluno: string; pct: number; tipo: string; criado: string }[]>`SELECT d.id, d.aluno_nome AS aluno, d.percentual::float AS pct, d.tipo, ${diaLocal(sql`d.created_at`)} AS criado FROM discounts d WHERE d.status='SOLICITADO' AND d.percentual <= ${lim} AND d.solicitante_user_id IS DISTINCT FROM ${me} ${uf("d.unit_id")} ORDER BY d.created_at LIMIT 100`;
      return r.map(x => ({ chave: `desc${x.id}`, grupo: "APROVAR" as const, modulo: "Descontos e bolsas", acao: "Aprovar", titulo: `${x.aluno} · ${x.pct.toLocaleString("pt-BR")}%`, sub: x.tipo, href: "/financeiro/descontos", prazo: addDays(x.criado, pd) }));
    }),
    bloco("exceções", async () => {
      if (!tem("excecao")) return [];
      const pd = Number((cfg as { fluxos?: { prazoDecisaoDias?: number } }).fluxos?.prazoDecisaoDias ?? 2);
      const r = await sql<{ id: number; regra: string; criado: string }[]>`SELECT x.id, x.regra, ${diaLocal(sql`x.created_at`)} AS criado FROM exceptions x WHERE x.status='SOLICITADA' AND x.solicitante_user_id IS DISTINCT FROM ${me} ORDER BY x.created_at LIMIT 100`;
      return r.map(x => ({ chave: `exc${x.id}`, grupo: "APROVAR" as const, modulo: "Exceções a POPs", acao: "Decidir", titulo: x.regra, href: "/governanca/excecoes", prazo: addDays(x.criado, pd) }));
    }),
    bloco("vagas", async () => {
      if (!tem("vagas")) return [];
      const pd = Number((cfg as { fluxos?: { prazoDecisaoDias?: number } }).fluxos?.prazoDecisaoDias ?? 2);
      const r = await sql<{ id: number; titulo: string; unidade: string | null; criado: string }[]>`SELECT r.id, r.titulo, u.nome AS unidade, ${diaLocal(sql`r.created_at`)} AS criado FROM requisitions r LEFT JOIN units u ON u.id=r.unit_id WHERE r.status='SOLICITADA' AND r.solicitante_user_id IS DISTINCT FROM ${me} ORDER BY r.created_at LIMIT 50`;
      return r.map(x => ({ chave: `vag${x.id}`, grupo: "APROVAR" as const, modulo: "Recrutamento", acao: "Aprovar vaga", titulo: x.titulo, sub: x.unidade, href: `/recrutamento/${x.id}`, prazo: addDays(x.criado, pd) }));
    }),

    // ---------------------------------------------------------------- ATENDER
    bloco("casos", async () => {
      const r = await sql<{ id: number; assunto: string; tipo: string; prazo: string | null; status: string }[]>`SELECT c.id, c.assunto, c.tipo, ${sql.unsafe("(c.sla_ate AT TIME ZONE 'UTC' AT TIME ZONE 'America/Campo_Grande')::date::text")} AS prazo, c.status FROM cases c WHERE c.responsavel_user_id=${me} AND c.status = ANY(${CASOS_ABERTOS}) ORDER BY c.sla_ate NULLS LAST LIMIT 100`;
      return r.map(x => ({ chave: `caso${x.id}`, grupo: "ATENDER" as const, modulo: "Atendimento", acao: x.status === "AGUARDANDO_FAMILIA" ? "Acompanhar" : "Atender", titulo: x.assunto, sub: x.tipo === "SAIDA" ? "Pedido de saída" : null, href: `/atendimento/casos/${x.id}`, prazo: x.prazo }));
    }),
    bloco("chamados", async () => {
      const r = await sql<{ id: number; titulo: string; prioridade: string; prazo: string | null; unidade: string | null }[]>`SELECT w.id, w.titulo, w.prioridade, ${sql.unsafe("(w.sla_ate AT TIME ZONE 'UTC' AT TIME ZONE 'America/Campo_Grande')::date::text")} AS prazo, u.nome AS unidade FROM work_orders w LEFT JOIN units u ON u.id=w.unit_id WHERE w.responsavel_user_id=${me} AND w.status = ANY(${OS_ABERTAS}) ORDER BY w.sla_ate NULLS LAST LIMIT 100`;
      return r.map(x => ({ chave: `os${x.id}`, grupo: "ATENDER" as const, modulo: "Chamados", acao: "Resolver", titulo: x.titulo, sub: [x.prioridade === "URGENTE" ? "urgente" : x.prioridade === "ALTA" ? "prioridade alta" : null, x.unidade].filter(Boolean).join(" · ") || null, href: `/operacoes/chamados/${x.id}`, prazo: x.prazo }));
    }),
    bloco("processos", async () => {
      const r = await sql<{ id: number; tipo: string; nome: string; prazo: string | null; faltam: number }[]>`SELECT p.id, p.tipo, e.nome, p.prazo::text, (SELECT count(*) FROM process_items i WHERE i.process_id=p.id AND NOT i.concluido)::int AS faltam FROM processes p JOIN employees e ON e.id=p.employee_id WHERE p.responsavel_user_id=${me} AND p.status='ABERTO' ORDER BY p.prazo NULLS LAST LIMIT 50`;
      return r.map(x => ({ chave: `proc${x.id}`, grupo: "ATENDER" as const, modulo: x.tipo === "ADMISSAO" ? "Admissões" : "Desligamentos", acao: "Concluir etapas", titulo: x.nome, sub: `${x.faltam} item(ns) do checklist em aberto`, href: `/processos/${x.id}`, prazo: x.prazo }));
    }),
    bloco("lgpd", async () => {
      if (!(await podePrivacidade(s).catch(() => false))) return [];
      const r = await sql<{ id: number; protocolo: string; tipo: string; prazo: string | null }[]>`SELECT id, protocolo, tipo, prazo::text FROM privacy_requests WHERE responsavel_user_id=${me} AND status = ANY(${PEDIDO_ABERTO}) AND respondida_em IS NULL ORDER BY prazo LIMIT 50`;
      const i = await sql<{ id: number; codigo: string; prazo: string | null }[]>`SELECT id, codigo, ${sql.unsafe("(prazo_anpd AT TIME ZONE 'UTC' AT TIME ZONE 'America/Campo_Grande')::date::text")} AS prazo FROM privacy_incidents WHERE responsavel_user_id=${me} AND status <> 'ENCERRADO' ORDER BY prazo_anpd NULLS LAST LIMIT 20`;
      return [...r.map(x => ({ chave: `lgpd${x.id}`, grupo: "ATENDER" as const, modulo: "Privacidade (LGPD)", acao: "Responder ao titular", titulo: `Pedido ${x.protocolo}`, sub: PEDIDO_TIPO[x.tipo] ?? null, href: `/governanca/privacidade/pedidos/${x.id}`, prazo: x.prazo })),
        ...i.map(x => ({ chave: `inc${x.id}`, grupo: "ATENDER" as const, modulo: "Privacidade (LGPD)", acao: "Tratar incidente", titulo: `Incidente ${x.codigo}`, sub: "prazo de comunicação à ANPD", href: `/governanca/privacidade/incidentes/${x.id}`, prazo: x.prazo }))];
    }),
    bloco("ética", async () => {
      if (!(await ehComite(s).catch(() => false))) return [];
      const r = await sql<{ id: number; protocolo: string; status: string; prazo: string | null }[]>`SELECT id, protocolo, status, (CASE WHEN status='RECEBIDA' THEN prazo_triagem ELSE prazo_conclusao END)::text AS prazo FROM ethics_reports WHERE responsavel_user_id=${me} AND status = ANY(${ETICA_ABERTO}) ORDER BY 4 NULLS LAST LIMIT 30`;
      const [sem] = await sql<{ n: number; prazo: string | null }[]>`SELECT count(*)::int AS n, min(prazo_triagem)::text AS prazo FROM ethics_reports WHERE responsavel_user_id IS NULL AND status='RECEBIDA'`;
      return [...r.map(x => ({ chave: `eti${x.id}`, grupo: "ATENDER" as const, modulo: "Canal de ética", acao: x.status === "RECEBIDA" ? "Fazer a triagem" : "Concluir a apuração", titulo: `Relato ${x.protocolo}`, href: `/governanca/etica/${x.id}`, prazo: x.prazo })),
        ...(sem.n ? [{ chave: "etisem", grupo: "ATENDER" as const, modulo: "Canal de ética", acao: "Distribuir", titulo: `${sem.n} ${sem.n === 1 ? "relato sem responsável" : "relatos sem responsável"}`, href: "/governanca/etica", prazo: sem.prazo, quantidade: sem.n }] : [])];
    }),
    bloco("substituições", async () => {
      const out: Pendencia[] = [];
      if (emp) {
        const r = await sql<{ id: number; data: string; turma: string | null; disciplina: string | null; inicio: string | null }[]>`SELECT id, data::text, turma, disciplina, inicio::text FROM cover_assignments WHERE cobertura_employee_id=${emp} AND status='CONVIDADO' AND data >= ${h}::date ORDER BY data, inicio LIMIT 30`;
        out.push(...r.map(x => ({ chave: `conv${x.id}`, grupo: "ATENDER" as const, modulo: "Substituição de professores", acao: "Aceitar ou recusar", titulo: `Cobrir ${x.turma ?? "turma"}${x.disciplina ? ` · ${x.disciplina}` : ""}`, sub: x.inicio ? `às ${x.inicio.slice(0, 5)}` : null, href: "/cobertura/minha", prazo: x.data })));
      }
      if (["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role)) {
        const [a] = await sql<{ n: number; prox: string | null }[]>`SELECT count(*)::int AS n, min(data)::text AS prox FROM cover_assignments WHERE status IN ('ABERTA','CONVIDADO') AND data BETWEEN ${h}::date AND ${addDays(h, 2)}::date ${uf("unit_id")}`;
        if (a.n) out.push({ chave: "semprof", grupo: "ATENDER", modulo: "Substituição de professores", acao: "Garantir cobertura", titulo: `${a.n} ${a.n === 1 ? "aula ainda sem substituto confirmado" : "aulas ainda sem substituto confirmado"}`, sub: "hoje e nos próximos 2 dias", href: `/cobertura?data=${a.prox ?? h}`, prazo: a.prox, quantidade: a.n });
      }
      return out;
    }),
    bloco("matrículas", async () => {
      if (!["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "COMERCIAL"].includes(s.role)) return [];
      const r = await sql<{ id: number; aluno: string; ate: string }[]>`SELECT e.id, st.nome AS aluno, e.reserva_ate::text AS ate FROM enrollments e JOIN students st ON st.id=e.student_id JOIN classes c ON c.id=e.class_id
        WHERE e.status='RESERVADA' AND e.reserva_ate BETWEEN ${h}::date AND ${addDays(h, 3)}::date AND (e.responsavel_user_id=${me} OR st.carteira_user_id=${me}) ${uf("c.unit_id")} ORDER BY e.reserva_ate LIMIT 50`;
      const contatos = await sql<{ student_id: number; aluno: string; proximo: string; passo: string | null }[]>`SELECT DISTINCT ON (fc.student_id) fc.student_id, st.nome AS aluno, fc.proximo_em::text AS proximo, fc.proximo_passo AS passo FROM family_contacts fc JOIN students st ON st.id=fc.student_id
        WHERE fc.user_id=${me} AND fc.proximo_em IS NOT NULL AND fc.proximo_em <= ${addDays(h, 2)}::date AND NOT EXISTS (SELECT 1 FROM family_contacts f2 WHERE f2.student_id=fc.student_id AND f2.data > fc.data) ORDER BY fc.student_id, fc.data DESC LIMIT 50`;
      return [...r.map(x => ({ chave: `res${x.id}`, grupo: "ATENDER" as const, modulo: "Matrículas", acao: "Confirmar matrícula", titulo: x.aluno, sub: "reserva vence", href: "/matriculas/reservas", prazo: x.ate })),
        ...contatos.map(x => ({ chave: `ctt${x.student_id}`, grupo: "ATENDER" as const, modulo: "Radar da família", acao: "Retornar contato", titulo: x.aluno, sub: x.passo, href: `/matriculas/alunos/${x.student_id}`, prazo: x.proximo }))];
    }),

    // ---------------------------------------------------------------- GESTÃO
    bloco("plano de ação", async () => {
      const r = await sql<{ id: number; titulo: string; status: string; prazo: string | null; bloqueio: string | null }[]>`SELECT id, titulo, status, prazo::text, bloqueio FROM action_plans WHERE responsavel_user_id=${me} AND status IN ('A_FAZER','EM_ANDAMENTO','BLOQUEADA') ORDER BY prazo NULLS LAST LIMIT 100`;
      return r.map(x => ({ chave: `acao${x.id}`, grupo: "GESTAO" as const, modulo: "Plano de ação", acao: x.status === "BLOQUEADA" ? "Destravar" : x.status === "A_FAZER" ? "Iniciar" : "Concluir", titulo: x.titulo, sub: x.status === "BLOQUEADA" ? `bloqueada${x.bloqueio ? `: ${x.bloqueio}` : ""}` : null, href: `/estrategia/acoes/${x.id}`, prazo: x.prazo }));
    }),
    bloco("não conformidades", async () => {
      const r = await sql<{ id: number; titulo: string; prazo: string | null }[]>`SELECT id, titulo, prazo::text FROM nonconformities WHERE responsavel_user_id=${me} AND status <> 'ENCERRADA' ORDER BY prazo NULLS LAST LIMIT 50`;
      return r.map(x => ({ chave: `nc${x.id}`, grupo: "GESTAO" as const, modulo: "Não conformidades", acao: "Tratar", titulo: x.titulo, href: "/governanca/controles", prazo: x.prazo }));
    }),
    bloco("controles", async () => {
      const r = await sql<{ id: number; titulo: string; proxima: string | null }[]>`SELECT id, titulo, proxima_em::text AS proxima FROM controls WHERE responsavel_user_id=${me} AND ativo AND proxima_em IS NOT NULL AND proxima_em <= ${addDays(h, 3)}::date ORDER BY proxima_em LIMIT 50`;
      return r.map(x => ({ chave: `ctl${x.id}`, grupo: "GESTAO" as const, modulo: "Controles", acao: "Executar controle", titulo: x.titulo, href: "/governanca/controles", prazo: x.proxima }));
    }),
    bloco("OKRs", async () => {
      const r = await sql<{ id: number; titulo: string; objetivo: string; ultimo: string | null }[]>`SELECT k.id, k.titulo, o.titulo AS objetivo, ${sql.unsafe("(k.atualizado_em AT TIME ZONE 'UTC' AT TIME ZONE 'America/Campo_Grande')::date::text")} AS ultimo FROM key_results k JOIN objectives o ON o.id=k.objective_id
        WHERE k.owner_user_id=${me} AND o.status='ATIVO' AND o.ciclo=${cfg.estrategia.cicloAtual} AND coalesce(k.fonte, '') NOT LIKE 'SISTEMA:%' AND (k.atualizado_em IS NULL OR k.atualizado_em < now() - interval '30 days') LIMIT 30`;
      return r.map(x => ({ chave: `kr${x.id}`, grupo: "GESTAO" as const, modulo: "OKRs", acao: "Registrar check-in", titulo: x.titulo, sub: `${x.objetivo}${x.ultimo ? ` · último em ${x.ultimo.split("-").reverse().join("/")}` : " · sem check-in"}`, href: "/estrategia/okrs", prazo: x.ultimo ? addDays(x.ultimo, 30) : null }));
    }),
    bloco("projetos", async () => {
      const dias = Number(cfg.estrategia.atualizacaoProjetoDias ?? 14);
      const p = await sql<{ id: number; nome: string; ultima: string | null; inicio: string | null }[]>`SELECT p.id, p.nome, (SELECT max(pu.data)::text FROM project_updates pu WHERE pu.project_id=p.id) AS ultima, p.inicio::text FROM projects p WHERE p.owner_user_id=${me} AND p.status='EM_ANDAMENTO'`;
      const m = await sql<{ id: number; titulo: string; projeto: string; project_id: number; prazo: string }[]>`SELECT m.id, m.titulo, p.nome AS projeto, p.id AS project_id, m.prazo::text FROM milestones m JOIN projects p ON p.id=m.project_id WHERE m.responsavel_user_id=${me} AND m.concluido_em IS NULL AND m.prazo IS NOT NULL AND m.prazo <= ${addDays(h, 7)}::date AND p.status NOT IN ('CONCLUIDO','CANCELADO') ORDER BY m.prazo LIMIT 30`;
      return [...p.filter(x => { const base = x.ultima ?? x.inicio; return !base || addDays(base, dias) <= h; }).map(x => ({ chave: `prj${x.id}`, grupo: "GESTAO" as const, modulo: "Projetos", acao: "Registrar status report", titulo: x.nome, sub: x.ultima ? `último em ${x.ultima.split("-").reverse().join("/")}` : "sem status report", href: `/estrategia/projetos/${x.id}`, prazo: x.ultima ? addDays(x.ultima, dias) : null })),
        ...m.map(x => ({ chave: `mar${x.id}`, grupo: "GESTAO" as const, modulo: "Projetos", acao: "Entregar marco", titulo: x.titulo, sub: x.projeto, href: `/estrategia/projetos/${x.project_id}`, prazo: x.prazo }))];
    }),
    bloco("rituais", async () => {
      const tol = Number(cfg.estrategia.toleranciaRitualDias ?? 2), ata = Number(cfg.estrategia.ataPendenteDias ?? 2);
      const r = await sql<{ id: number; nome: string; proxima: string | null }[]>`SELECT id, nome, proxima_data::text AS proxima FROM rituals WHERE dono_user_id=${me} AND ativo AND proxima_data IS NOT NULL AND proxima_data <= ${addDays(h, 2)}::date ORDER BY proxima_data LIMIT 20`;
      const a = await sql<{ id: number; nome: string; data: string; ritual_id: number }[]>`SELECT m.id, r.nome, m.data::text, r.id AS ritual_id FROM ritual_meetings m JOIN rituals r ON r.id=m.ritual_id WHERE r.dono_user_id=${me} AND m.status='REALIZADA' AND coalesce(trim(m.ata), '')='' ORDER BY m.data LIMIT 20`;
      return [...r.map(x => ({ chave: `rit${x.id}`, grupo: "GESTAO" as const, modulo: "Rituais de gestão", acao: "Realizar a reunião", titulo: x.nome, href: `/estrategia/rituais/${x.id}`, prazo: x.proxima ? addDays(x.proxima, tol) : null })),
        ...a.map(x => ({ chave: `ata${x.id}`, grupo: "GESTAO" as const, modulo: "Rituais de gestão", acao: "Registrar a ata", titulo: x.nome, sub: `reunião de ${x.data.split("-").reverse().join("/")}`, href: `/estrategia/rituais/${x.ritual_id}`, prazo: addDays(x.data, ata) }))];
    }),
    bloco("contratos e licenças", async () => {
      const c = await sql<{ id: number; objeto: string; fim: string; aviso: number | null }[]>`SELECT id, objeto, fim::text, aviso_previo_dias AS aviso FROM contracts WHERE responsavel_user_id=${me} AND status='VIGENTE' AND fim IS NOT NULL AND fim <= ${addDays(h, 60)}::date ORDER BY fim LIMIT 20`;
      const l = await sql<{ id: number; nome: string | null; tipo: string; validade: string; antecedencia: number | null }[]>`SELECT id, nome, tipo, validade::text, antecedencia_dias AS antecedencia FROM licenses WHERE responsavel_user_id=${me} AND status <> 'SUBSTITUIDA' AND validade IS NOT NULL AND validade <= ${addDays(h, 90)}::date ORDER BY validade LIMIT 20`;
      return [...c.map(x => ({ chave: `ctr${x.id}`, grupo: "GESTAO" as const, modulo: "Contratos", acao: "Decidir renovação", titulo: x.objeto, sub: `vence em ${x.fim.split("-").reverse().join("/")}`, href: `/operacoes/contratos/${x.id}`, prazo: x.aviso ? addDays(x.fim, -x.aviso) : x.fim })),
        ...l.map(x => ({ chave: `lic${x.id}`, grupo: "GESTAO" as const, modulo: "Licenças e alvarás", acao: "Renovar", titulo: x.nome ?? x.tipo, sub: `validade ${x.validade.split("-").reverse().join("/")}`, href: `/operacoes/licencas/${x.id}`, prazo: x.antecedencia ? addDays(x.validade, -x.antecedencia) : x.validade }))];
    }),

    // ---------------------------------------------------------------- CIÊNCIA E DESENVOLVIMENTO
    bloco("POPs", async () => {
      if (s.role === "LEITURA") return [];
      const r = await sql<{ id: number; codigo: string; titulo: string }[]>`SELECT p.id, p.codigo, p.titulo FROM procedures p WHERE p.status='VIGENTE' AND NOT EXISTS (SELECT 1 FROM procedure_acks a WHERE a.procedure_id=p.id AND a.versao=p.versao AND a.user_id=${me}) ORDER BY p.publicado_em NULLS LAST, p.codigo LIMIT 100`;
      if (r.length > 3) return [{ chave: "pops", grupo: "CIENCIA" as const, modulo: "POPs e processos", acao: "Ler e dar ciência", titulo: `${r.length} POPs vigentes aguardando sua ciência`, sub: r.slice(0, 3).map(x => x.codigo).join(", ") + "…", href: "/governanca/pops", prazo: null, quantidade: r.length }];
      return r.map(x => ({ chave: `pop${x.id}`, grupo: "CIENCIA" as const, modulo: "POPs e processos", acao: "Ler e dar ciência", titulo: `${x.codigo} · ${x.titulo}`, href: `/governanca/pops/${x.id}`, prazo: null }));
    }),
    bloco("comunicados", async () => {
      const r = await sql<{ id: number; titulo: string; prazo: string | null }[]>`SELECT a.id, a.titulo, a.prazo_ciencia::text AS prazo FROM announcements a WHERE a.requer_ciencia AND (a.expira_em IS NULL OR a.expira_em >= ${h}::date)
        AND (a.publico='TODOS' OR (a.publico='UNIDADE' AND (${s.unitId === null} OR a.unit_id=${s.unitId ?? 0})) OR (a.publico='PERFIL' AND a.role=${s.role}) OR (a.publico='CARGO' AND a.position_id=${s.positionId ?? 0}))
        AND NOT EXISTS (SELECT 1 FROM announcement_acks k WHERE k.announcement_id=a.id AND k.user_id=${me}) ORDER BY a.prazo_ciencia NULLS LAST LIMIT 30`;
      return r.map(x => ({ chave: `com${x.id}`, grupo: "CIENCIA" as const, modulo: "Comunicados", acao: "Ler e dar ciência", titulo: x.titulo, href: "/comunicacao/comunicados", prazo: x.prazo }));
    }),
    bloco("treinamentos", async () => {
      if (!emp || opcoes.semTreinamentos) return [];
      const [e] = await sql<{ unit_id: number }[]>`SELECT unit_id FROM employees WHERE id=${emp} AND situacao='ATIVO'`; if (!e) return [];
      const m = await matrizTreinamento(e.unit_id); const linha = m.linhas.find(l => l.emp.id === emp); if (!linha) return [];
      return linha.itens.filter(i => i.status !== "CONCLUIDO" || i.vencendo).map(i => ({ chave: `trn${i.curso.id}`, grupo: "CIENCIA" as const, modulo: "Academy", acao: i.status === "VENCIDO" ? "Refazer (vencido)" : i.status === "CONCLUIDO" ? "Renovar antes de vencer" : "Concluir", titulo: `${i.curso.codigo} · ${i.curso.titulo}`, sub: i.curso.tipo === "OBRIGATORIO" ? "obrigatório" : "trilha do cargo", href: "/academy/minha", prazo: i.status === "VENCIDO" ? i.validoAte : i.vencendo ? i.validoAte : null }));
    }),
    bloco("desempenho", async () => {
      const out: Pendencia[] = [];
      const [conv] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM review_raters WHERE user_id=${me} AND status='CONVIDADO'`;
      if (conv.n) out.push({ chave: "contrib", grupo: "CIENCIA", modulo: "Desempenho", acao: "Responder", titulo: `${conv.n} ${conv.n === 1 ? "contribuição de avaliação solicitada" : "contribuições de avaliação solicitadas"} a você`, href: "/contribuicoes", prazo: null, quantidade: conv.n });
      const av = await sql<{ id: number; nome: string; ciclo: string; prazo: string | null }[]>`SELECT r.id, e.nome, c.nome AS ciclo, c.prazo_avaliacao::text AS prazo FROM perf_reviews r JOIN perf_cycles c ON c.id=r.cycle_id JOIN employees e ON e.id=r.employee_id WHERE r.avaliador_user_id=${me} AND r.estado='RASCUNHO' AND c.fase='AVALIACAO' ORDER BY e.nome LIMIT 60`;
      out.push(...av.map(x => ({ chave: `av${x.id}`, grupo: "CIENCIA" as const, modulo: "Desempenho", acao: "Concluir a avaliação", titulo: x.nome, sub: x.ciclo, href: `/desempenho/avaliacoes/${x.id}`, prazo: x.prazo })));
      if (emp) {
        const minhas = await sql<{ id: number; ciclo: string; estado: string; fase: string | null; auto_vazia: boolean; ciencia: boolean; prazo: string | null }[]>`SELECT r.id, c.nome AS ciclo, r.estado, c.fase, (coalesce(r.auto_criterios->'notas', '{}'::jsonb) = '{}'::jsonb) AS auto_vazia, r.ciencia_em IS NOT NULL AS ciencia, c.prazo_avaliacao::text AS prazo FROM perf_reviews r JOIN perf_cycles c ON c.id=r.cycle_id WHERE r.employee_id=${emp}`;
        for (const r of minhas) {
          if (r.estado === "RASCUNHO" && r.fase === "AVALIACAO" && r.auto_vazia) out.push({ chave: `auto${r.id}`, grupo: "CIENCIA", modulo: "Desempenho", acao: "Fazer a autoavaliação", titulo: r.ciclo, href: `/colaboradores/${emp}/painel?aba=avaliacoes`, prazo: r.prazo });
          if (["PUBLICADA", "CONTESTADA"].includes(r.estado) && !r.ciencia) out.push({ chave: `res${r.id}`, grupo: "CIENCIA", modulo: "Desempenho", acao: "Ver o resultado e dar ciência", titulo: r.ciclo, href: `/colaboradores/${emp}/painel?aba=avaliacoes`, prazo: null });
        }
        const [fb] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM feedbacks WHERE employee_id=${emp} AND ciencia_em IS NULL`;
        if (fb.n) out.push({ chave: "fb", grupo: "CIENCIA", modulo: "Desempenho", acao: "Dar ciência", titulo: `${fb.n} ${fb.n === 1 ? "feedback recebido" : "feedbacks recebidos"}`, href: `/colaboradores/${emp}/painel?aba=feedbacks`, prazo: null, quantidade: fb.n });
        const pdi = await sql<{ id: number; descricao: string; prazo: string | null }[]>`SELECT a.id, a.descricao, a.prazo::text FROM pdi_actions a JOIN pdi_plans p ON p.id=a.plan_id WHERE p.employee_id=${emp} AND a.status IN ('NAO_INICIADA','EM_ANDAMENTO') AND a.prazo IS NOT NULL AND a.prazo <= ${addDays(h, 7)}::date ORDER BY a.prazo LIMIT 20`;
        out.push(...pdi.map(x => ({ chave: `pdi${x.id}`, grupo: "CIENCIA" as const, modulo: "PDI", acao: "Avançar a ação", titulo: x.descricao, href: `/colaboradores/${emp}/painel?aba=pdi`, prazo: x.prazo })));
      }
      const val = await sql<{ id: number; descricao: string; status: string; nome: string; employee_id: number }[]>`SELECT a.id, a.descricao, a.status, e.nome, e.id AS employee_id FROM pdi_actions a JOIN pdi_plans p ON p.id=a.plan_id JOIN employees e ON e.id=p.employee_id WHERE a.responsavel_user_id=${me} AND a.status IN ('AGUARDANDO_VALIDACAO','AGUARDANDO_APOIO','AGUARDANDO_OBSERVACAO') AND e.id IS DISTINCT FROM ${emp ?? null} LIMIT 30`;
      out.push(...val.map(x => ({ chave: `pdiv${x.id}`, grupo: "CIENCIA" as const, modulo: "PDI", acao: x.status === "AGUARDANDO_VALIDACAO" ? "Validar a ação" : x.status === "AGUARDANDO_APOIO" ? "Providenciar apoio" : "Observar a prática", titulo: `${x.nome} · ${x.descricao}`, href: `/colaboradores/${x.employee_id}/painel?aba=pdi`, prazo: null })));
      return out;
    }),
  ]);
  // v24 · Nova Arquitetura: alertas com dono, orçamento, obrigações, folha, onboarding, auditorias, fiscalizações e SST (contagem)
  try { const { pendenciasV24 } = await import("./pendencias-v24"); const v = await pendenciasV24(s); itens.push(...v.itens); falhas.push(...v.falhas); } catch (e) { falhas.push(`v24: ${e instanceof Error ? e.message : String(e)}`); }
  // v30 · ciência de itens, formação a validar, avaliações de candidatos, satisfação com a contratação, inscrições, reação e transparência salarial
  try { const { pendenciasV30 } = await import("./pendencias-v30"); const v = await pendenciasV30(s); itens.push(...v.itens); falhas.push(...v.falhas); } catch (e) { falhas.push(`v30: ${e instanceof Error ? e.message : String(e)}`); }
  // sem duplicatas (o mesmo registro pode surgir por dois caminhos)
  // v29: pendência de uma tela fora do acesso do cargo não entra (a pessoa não teria onde resolvê-la)
  const vistos = new Set<string>(); const unicos = itens.filter(i => vistos.has(i.chave) ? false : (vistos.add(i.chave), true)).filter(i => veTela(s, i.href));
  return { itens: ordenar(unicos, h), falhas };
}

/** Resumo para o Início e o menu: total, vencidas e que vencem hoje. */
export function resumoPendencias(itens: Pendencia[], h = hoje()) {
  const st = itens.map(i => situacaoPend(i.prazo, h));
  return { total: itens.length, vencidas: st.filter(x => x === "VENCIDA").length, hoje: st.filter(x => x === "HOJE").length, proximas: st.filter(x => x === "PROXIMA").length };
}
