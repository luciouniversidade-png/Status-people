// v31 · pendências novas: 1:1 de hoje e as que falta registrar, equipe sem conversa em dia, pedidos de feedback para responder,
// metas aguardando aprovação (gestor) e metas devolvidas (colaborador), convites do 360 e PDIs propostos a validar.
import { sql } from "@/db";
import { scopeUnit, type Session } from "./auth";
import { getSettings, hoje, addDays } from "./utils";
import type { Pendencia } from "./pendencias";

export async function pendenciasV31(s: Session): Promise<{ itens: Pendencia[]; falhas: string[] }> {
  const itens: Pendencia[] = []; const falhas: string[] = []; const emp = s.employeeId; const me = s.id; const h = hoje();
  const bloco = async (nome: string, f: () => Promise<Pendencia[]>) => { try { itens.push(...(await f())); } catch (e) { falhas.push(`${nome}: ${e instanceof Error ? e.message : String(e)}`); } };
  const cfg = await getSettings();
  await Promise.all([
    bloco("1:1", async () => {
      const r = await sql<{ id: number; titulo: string; data: string; inicio: string; outro: string | null }[]>`SELECT o.id, o.titulo, o.data::text, o.inicio, CASE WHEN o.organizador_user_id=${me} THEN e.nome ELSE o.organizador_nome END AS outro FROM one_on_ones o JOIN employees e ON e.id=o.employee_id
        WHERE o.status='MARCADA' AND (o.organizador_user_id=${me} OR o.employee_id=${emp ?? -1}) AND o.data <= ${h} ORDER BY o.data, o.inicio LIMIT 30`;
      return r.map(x => x.data === h
        ? { chave: `1a1-hoje${x.id}`, grupo: "GESTAO" as const, modulo: "1:1", acao: `Conversar às ${x.inicio}`, titulo: `${x.titulo} · ${x.outro ?? ""}`, sub: "veja a pauta antes", href: `/um-a-um/${x.id}`, prazo: x.data }
        : { chave: `1a1-reg${x.id}`, grupo: "GESTAO" as const, modulo: "1:1", acao: "Registrar os combinados", titulo: `${x.titulo} · ${x.outro ?? ""}`, sub: "a conversa já aconteceu (ou cancele)", href: `/um-a-um/${x.id}`, prazo: x.data });
    }),
    bloco("equipe sem 1:1", async () => {
      if (!emp) return [];
      const dias = cfg.desempenho.checkinDias as Record<string, number>;
      const r = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM employees e LEFT JOIN positions p ON p.id=e.position_id WHERE e.gestor_id=${emp} AND e.situacao IN ('ATIVO','FERIAS')
        AND NOT EXISTS (SELECT 1 FROM one_on_ones o WHERE o.employee_id=e.id AND o.status='MARCADA' AND o.data >= ${h})
        AND coalesce(greatest((SELECT max(o.data) FROM one_on_ones o WHERE o.employee_id=e.id AND o.status='REALIZADA'), (SELECT max(c.data) FROM perf_checkins c WHERE c.employee_id=e.id AND c.tipo='REUNIAO')), '1900-01-01'::date)
          < ${h}::date - coalesce((${JSON.stringify(dias)}::jsonb ->> coalesce(p.familia, 'PADRAO'))::int, (${JSON.stringify(dias)}::jsonb ->> 'PADRAO')::int, 45)`;
      return r[0].n ? [{ chave: "equipe-1a1", grupo: "GESTAO" as const, modulo: "1:1", acao: "Marcar 1:1", titulo: `${r[0].n} ${r[0].n === 1 ? "pessoa da equipe" : "pessoas da equipe"} sem conversa em dia`, sub: "nem 1:1 marcada", href: "/um-a-um?aba=colegas", prazo: null, quantidade: r[0].n }] : [];
    }),
    bloco("pedidos de feedback", async () => {
      const r = await sql<{ id: number; solicitante_nome: string | null; assunto: string; prazo: string | null }[]>`SELECT id, solicitante_nome, assunto, prazo::text FROM feedback_requests WHERE para_user_id=${me} AND status='PENDENTE' ORDER BY prazo NULLS LAST LIMIT 30`;
      return r.map(x => ({ chave: `fbq${x.id}`, grupo: "ATENDER" as const, modulo: "Feedback", acao: "Responder ao pedido", titulo: `${x.solicitante_nome ?? "Um colega"} · ${x.assunto}`, href: `/feedback/novo?pedido=${x.id}`, prazo: x.prazo }));
    }),
    bloco("metas para aprovar", async () => {
      if (!["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role) && !emp) return [];
      const u = scopeUnit(s); const soEquipe = s.role === "GESTOR" || !["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role);
      const [r] = await sql<{ n: number; desde: string | null }[]>`SELECT count(*)::int AS n, min(g.created_at)::date::text AS desde FROM perf_goals g JOIN employees e ON e.id=g.employee_id JOIN perf_cycles c ON c.id=g.cycle_id
        WHERE g.aprovacao='PROPOSTA' AND c.fase NOT IN ('CONCLUSAO','ARQUIVADO') AND e.id IS DISTINCT FROM ${emp ?? null} ${soEquipe ? sql`AND e.gestor_id=${emp ?? -1}` : u === null ? sql`` : sql`AND e.unit_id=${u}`}`;
      return r.n ? [{ chave: "metas-aprovar", grupo: "APROVAR" as const, modulo: "Metas", acao: "Aprovar ou devolver", titulo: `${r.n} ${r.n === 1 ? "meta proposta" : "metas propostas"} pela equipe`, href: "/desempenho/metas#aprovacao", prazo: r.desde ? addDays(r.desde, 7) : null, quantidade: r.n }] : [];
    }),
    bloco("metas devolvidas", async () => {
      if (!emp) return [];
      const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM perf_goals g JOIN perf_cycles c ON c.id=g.cycle_id WHERE g.employee_id=${emp} AND g.aprovacao='DEVOLVIDA' AND c.fase NOT IN ('CONCLUSAO','ARQUIVADO')`;
      return r.n ? [{ chave: "metas-devolvidas", grupo: "CIENCIA" as const, modulo: "Metas", acao: "Ajustar e propor de novo", titulo: `${r.n} ${r.n === 1 ? "meta devolvida" : "metas devolvidas"} pelo gestor`, href: `/colaboradores/${emp}/painel?aba=metas`, prazo: null, quantidade: r.n }] : [];
    }),
    bloco("PDI proposto", async () => {
      if (!emp) return [];
      const r = await sql<{ id: number; nome: string; employee_id: number; competencia: string }[]>`SELECT p.id, e.nome, e.id AS employee_id, p.competencia FROM pdi_plans p JOIN employees e ON e.id=p.employee_id WHERE p.status='ATIVO' AND p.validado_em IS NULL AND e.gestor_id=${emp} LIMIT 30`;
      return r.map(x => ({ chave: `pdi-prop${x.id}`, grupo: "APROVAR" as const, modulo: "PDI", acao: "Validar o plano", titulo: `${x.nome} · ${x.competencia}`, href: `/colaboradores/${x.employee_id}/painel?aba=pdi`, prazo: null }));
    }),
  ]);
  return { itens, falhas };
}
