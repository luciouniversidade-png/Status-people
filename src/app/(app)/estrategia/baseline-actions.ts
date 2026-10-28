"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit } from "@/lib/auth";
import { audit, str, int, hoje } from "@/lib/utils";
import { comMensagem } from "@/lib/redirecionar";

const go = (b: string, k: "ok" | "erro", m: string) => comMensagem(b, k, m, "#cronograma");
const msg = (e: unknown) => e instanceof Error ? e.message : "Erro inesperado.";
const GESTAO = ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "FINANCEIRO", "OPERACOES", "COMERCIAL"];
async function projetoEditavel(projectId: number) {
  const s = await requireSession(); const [p] = await sql<{ id: number; unit_id: number | null; owner_user_id: number | null; baseline_versao: number; inicio: string | null; fim: string | null; nome: string }[]>`SELECT id, unit_id, owner_user_id, baseline_versao, inicio::text, fim::text, nome FROM projects WHERE id=${projectId}`;
  assert(!!p, "Projeto não encontrado."); assert(GESTAO.includes(s.role) || p.owner_user_id === s.id, "Só o dono do projeto ou gestores mexem no cronograma.");
  const u = scopeUnit(s); assert(u === null || p.unit_id === null || p.unit_id === u, "Projeto de outra unidade."); return { s, p };
}
async function congelar(projectId: number, versao: number, motivo: string, decisionId: number | null, s: { id: number; nome: string }, inicio: string | null, fim: string | null) {
  const itens = await sql<{ id: number; titulo: string; prazo: string }[]>`SELECT id, titulo, prazo::text FROM milestones WHERE project_id=${projectId} ORDER BY prazo, ordem, id`;
  await sql.begin(async tx => {
    await tx`UPDATE milestones SET baseline_prazo=prazo WHERE project_id=${projectId}`;
    await tx`UPDATE projects SET baseline_versao=${versao}, updated_at=now() WHERE id=${projectId}`;
    await tx`INSERT INTO project_baselines (project_id, versao, motivo, decision_id, marcos, user_id, user_nome) VALUES (${projectId}, ${versao}, ${motivo}, ${decisionId}, ${JSON.stringify({ inicio, fim, itens })}::jsonb, ${s.id}, ${s.nome})`;
  });
  return itens.length;
}

/** Baseline inicial: o plano aprovado vira a referência (sem decisão — é o próprio plano). */
export async function definirBaseline(fd: FormData) {
  const pid = int(fd, "projectId") ?? 0; const b = `/estrategia/projetos/${pid}`; let n = 0;
  try { const { s, p } = await projetoEditavel(pid); assert(p.baseline_versao === 0, "O projeto já tem baseline: uma nova exige decisão registrada.");
    n = await congelar(pid, 1, str(fd, "motivo") || "Baseline inicial (plano aprovado)", null, s, p.inicio, p.fim); assert(n > 0, "Cadastre os marcos antes de congelar a baseline.");
    await audit(s, "definir baseline do projeto", "projects", pid, null, { versao: 1, marcos: n }); }
  catch (e) { redirect(go(b, "erro", msg(e))); }
  redirect(go(b, "ok", `Baseline v1 congelada com ${n} marco(s).`));
}

/** Nova baseline: só com decisão registrada (escolhida no Decision Log ou registrada aqui pela Direção). */
export async function novaBaseline(fd: FormData) {
  const pid = int(fd, "projectId") ?? 0; const b = `/estrategia/projetos/${pid}`; let v = 0;
  try {
    const { s, p } = await projetoEditavel(pid); assert(p.baseline_versao > 0, "Defina a baseline inicial primeiro.");
    const motivo = str(fd, "motivo"); assert(motivo.length >= 10, "Explique por que o plano mudou (mín. 10 caracteres).");
    let decisionId = int(fd, "decisionId");
    if (decisionId) { const [d] = await sql`SELECT 1 FROM decisions WHERE id=${decisionId}`; assert(!!d, "Decisão não encontrada."); }
    else { const titulo = str(fd, "decisaoTitulo"), texto = str(fd, "decisaoTexto"); assert(titulo.length >= 4 && texto.length >= 10, "Nova baseline exige decisão: escolha uma do Decision Log ou registre a decisão (título e texto).");
      assert(s.role === "DIRECAO", "Registrar a decisão aqui é da Direção; os demais escolhem uma decisão já registrada.");
      const [d] = await sql<{ id: number }[]>`INSERT INTO decisions (data, titulo, area, contexto, decisao, responsavel_user_id, status) VALUES (${hoje()}, ${titulo}, 'Estratégia e projetos', ${`Rebaseline do projeto ${p.nome}: ${motivo}`}, ${texto}, ${s.id}, 'VIGENTE') RETURNING id`; decisionId = d.id;
      await audit(s, "registrar decisão (rebaseline)", "decisions", d.id, null, { projectId: pid }); }
    v = p.baseline_versao + 1; await congelar(pid, v, motivo, decisionId, s, p.inicio, p.fim);
    await audit(s, "nova baseline do projeto", "projects", pid, { versao: p.baseline_versao }, { versao: v, decisionId, motivo });
  } catch (e) { redirect(go(b, "erro", msg(e))); }
  redirect(go(b, "ok", `Baseline v${v} registrada com a decisão. O histórico das anteriores fica no projeto.`));
}

export async function vincularDependencia(fd: FormData) {
  const pid = int(fd, "projectId") ?? 0; const b = `/estrategia/projetos/${pid}`;
  try {
    const { s } = await projetoEditavel(pid); const id = int(fd, "id") ?? 0; const dep = int(fd, "dependeDe");
    const [m] = await sql<{ project_id: number }[]>`SELECT project_id FROM milestones WHERE id=${id}`; assert(m?.project_id === pid, "Marco não encontrado.");
    if (dep) { assert(dep !== id, "Um marco não depende de si mesmo."); const [d] = await sql<{ project_id: number }[]>`SELECT project_id FROM milestones WHERE id=${dep}`; assert(d?.project_id === pid, "A dependência precisa ser um marco do mesmo projeto.");
      // sem ciclos: subir a cadeia a partir da dependência não pode voltar ao marco
      let cur: number | null = dep; const vistos = new Set<number>(); while (cur) { assert(cur !== id, "Isso criaria uma dependência circular."); if (vistos.has(cur)) break; vistos.add(cur); const linhas: { depende_de: number | null }[] = await sql<{ depende_de: number | null }[]>`SELECT depende_de FROM milestones WHERE id=${cur}`; cur = linhas[0]?.depende_de ?? null; } }
    await sql`UPDATE milestones SET depende_de=${dep} WHERE id=${id}`; await audit(s, "vincular dependência de marco", "milestones", id, null, { dependeDe: dep });
  } catch (e) { redirect(go(b, "erro", msg(e))); }
  redirect(go(b, "ok", "Dependência atualizada."));
}
