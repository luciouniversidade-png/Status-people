// v30 · pendências novas: ciência de itens, formação a validar, avaliações de candidatos, satisfação com a contratação,
// inscrições em treinamento, avaliação de reação e o relatório semestral de transparência salarial.
import { sql } from "@/db";
import { can, scopeUnit, type Session } from "./auth";
import { getSettings, hoje, addDays } from "./utils";
import type { Pendencia } from "./pendencias";

export async function pendenciasV30(s: Session): Promise<{ itens: Pendencia[]; falhas: string[] }> {
  const itens: Pendencia[] = []; const falhas: string[] = []; const emp = s.employeeId; const me = s.id; const h = hoje(); const escopo = scopeUnit(s);
  const bloco = async (nome: string, f: () => Promise<Pendencia[]>) => { try { itens.push(...(await f())); } catch (e) { falhas.push(`${nome}: ${e instanceof Error ? e.message : String(e)}`); } };
  const cfg = await getSettings();
  await Promise.all([
    bloco("itens sob responsabilidade", async () => {
      if (!emp) return [];
      const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM employee_items WHERE employee_id=${emp} AND status='COM_COLABORADOR' AND ciencia_em IS NULL`;
      return r.n ? [{ chave: "itens-ciencia", grupo: "CIENCIA" as const, modulo: "Meu espaço", acao: "Dar ciência", titulo: `${r.n} ${r.n === 1 ? "item registrado com você" : "itens registrados com você"}`, sub: "termo de responsabilidade", href: "/eu#itens", prazo: null, quantidade: r.n }] : [];
    }),
    bloco("formação a validar", async () => {
      if (!can.editar(s)) return [];
      const [r] = await sql<{ n: number; mais_antiga: string | null }[]>`SELECT count(*)::int AS n, min(created_at)::date::text AS mais_antiga FROM employee_qualifications WHERE status='PENDENTE'`;
      return r.n ? [{ chave: "formacao-validar", grupo: "ATENDER" as const, modulo: "Pessoas", acao: "Validar", titulo: `${r.n} ${r.n === 1 ? "formação informada pelo colaborador" : "formações informadas pelos colaboradores"}`, href: "/analytics/composicao#formacao", prazo: r.mais_antiga ? addDays(r.mais_antiga, 7) : null, quantidade: r.n }] : [];
    }),
    bloco("avaliações de candidatos", async () => {
      const r = await sql<{ id: number; candidato: string; vaga: string; requisition_id: number; etapa: string; prazo: string | null }[]>`SELECT f.id, c.nome AS candidato, q.titulo AS vaga, q.id AS requisition_id, f.etapa, f.prazo::text FROM interview_feedback f JOIN applications a ON a.id=f.application_id JOIN candidates c ON c.id=a.candidate_id JOIN requisitions q ON q.id=a.requisition_id
        WHERE f.avaliador_user_id=${me} AND f.enviado_em IS NULL AND f.cancelado_em IS NULL AND a.etapa NOT IN ('REPROVADO','DESISTIU','CONTRATADO') ORDER BY f.prazo NULLS LAST LIMIT 50`;
      return r.map(x => ({ chave: `aval-cand${x.id}`, grupo: "ATENDER" as const, modulo: "Recrutamento", acao: "Dar as suas notas", titulo: x.candidato, sub: x.vaga, href: `/recrutamento/avaliar/${x.id}`, prazo: x.prazo }));
    }),
    bloco("satisfação com a contratação", async () => {
      const dias = Number(cfg.recrutamento.satisfacaoGestorDias) || 90; if (!emp && !can.editar(s)) return [];
      // o gestor direto da pessoa contratada (ou quem pediu a vaga) diz, aos 90 dias, como está a contratação
      const r = await sql<{ application_id: number; nome: string; admissao: string; vaga: string }[]>`SELECT a.id AS application_id, e.nome, e.admissao::text, q.titulo AS vaga FROM applications a JOIN employees e ON e.id=a.employee_id JOIN requisitions q ON q.id=a.requisition_id
        WHERE a.etapa='CONTRATADO' AND e.situacao <> 'EM_ADMISSAO' AND e.admissao <= ${addDays(h, -dias)}::date AND e.admissao > ${addDays(h, -dias - 120)}::date
          AND NOT EXISTS (SELECT 1 FROM hire_feedback f WHERE f.employee_id=e.id AND f.respondido_em IS NOT NULL)
          AND ((${emp ?? 0}::int <> 0 AND e.gestor_id=${emp ?? 0}::int) OR (e.gestor_id IS NULL AND q.solicitante_user_id=${me})) LIMIT 30`;
      return r.map(x => ({ chave: `qhire${x.application_id}`, grupo: "ATENDER" as const, modulo: "Recrutamento", acao: "Avaliar a contratação", titulo: x.nome, sub: `${x.vaga} · ${dias} dias de casa`, href: `/recrutamento/contratacao/${x.application_id}`, prazo: addDays(x.admissao, dias + 15) }));
    }),
    bloco("inscrições em treinamento", async () => {
      // gestor direto aprova a inscrição da própria equipe; RH/Direção aprovam a rede; Direção da unidade, a unidade
      const r = await sql<{ id: number; nome: string; curso: string; created_at: string }[]>`SELECT t.id, e.nome, c.titulo AS curso, t.created_at::date::text FROM training_enrollments t JOIN employees e ON e.id=t.employee_id JOIN courses c ON c.id=t.course_id
        WHERE t.status='AGUARDANDO_APROVACAO' AND (${emp ?? 0}::int <> 0 AND e.gestor_id=${emp ?? 0}::int ${can.editar(s) ? sql`OR TRUE` : s.role === "DIRETOR_UNIDADE" && escopo !== null ? sql`OR (e.gestor_id IS NULL AND e.unit_id=${escopo})` : sql``}) ORDER BY t.created_at LIMIT 50`;
      return r.map(x => ({ chave: `insc${x.id}`, grupo: "APROVAR" as const, modulo: "Academy", acao: "Aprovar a inscrição", titulo: `${x.nome} · ${x.curso}`, href: "/academy/aprovar", prazo: addDays(x.created_at, 3) }));
    }),
    bloco("avaliação de treinamento", async () => {
      if (!emp) return [];
      const r = await sql<{ course_id: number; titulo: string; concluido_em: string }[]>`SELECT p.course_id, c.titulo, p.concluido_em::text FROM training_progress p JOIN courses c ON c.id=p.course_id
        WHERE p.employee_id=${emp} AND p.status='CONCLUIDO' AND p.concluido_em >= ${addDays(h, -60)}::date AND c.formato <> 'POP' AND NOT EXISTS (SELECT 1 FROM training_feedback f WHERE f.course_id=p.course_id AND f.employee_id=${emp}) LIMIT 10`;
      return r.map(x => ({ chave: `reacao${x.course_id}`, grupo: "CIENCIA" as const, modulo: "Academy", acao: "Avaliar o treinamento", titulo: x.titulo, href: `/academy/minha#reacao${x.course_id}`, prazo: addDays(x.concluido_em, 30) }));
    }),
    bloco("transparência salarial", async () => {
      if (!can.editar(s)) return [];
      const { situacaoTransparencia } = await import("./igualdade"); const pend = await situacaoTransparencia(h);
      return pend.filter(p => p.obrigatorio && !p.publicado && p.prazo).map(p => ({ chave: `transp${p.companyId}-${p.ano}-${p.semestre}`, grupo: "GESTAO" as const, modulo: "Igualdade salarial", acao: "Publicar e registrar", titulo: `Relatório de transparência salarial · ${p.empresa}`, sub: `${p.semestre}º semestre de ${p.ano} · Lei 14.611/2023`, href: "/analytics/igualdade#transparencia", prazo: p.prazo }));
    }),
  ]);
  return { itens, falhas };
}
