"use server";
// v30 · Benefícios: catálogo (regra de elegibilidade e carência), adesões com dependentes e bolsa de filho(a), encerramento e recálculo
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, can, assert } from "@/lib/auth";
import { audit, str, strOrNull, num, int, hoje, getSettings } from "@/lib/utils";
import { comMensagem } from "@/lib/redirecionar";
import { notificar } from "@/lib/comunicacao";
import { elegivel, calcularAdesao, type Plano, type PessoaBenef } from "@/lib/beneficios";

const go = (b: string, k: "ok" | "erro", msg: string, hash = "") => comMensagem(b, k, msg, hash);
const msgErro = (e: unknown) => (e instanceof Error ? e.message : "Erro");
const voltar = (fd: FormData, padrao: string) => { const v = str(fd, "voltar"); return v.startsWith("/") ? v : padrao; };

async function plano(id: number) { const [p] = await sql<Plano[]>`SELECT id, nome, tipo, fornecedor, custo_empresa::float, custo_empresa_pct::float, desconto_colab::float, desconto_colab_pct::float, custo_dependente::float, elegibilidade, carencia_dias, ativo, obs FROM benefit_plans WHERE id=${id}`; return p ?? null; }
async function pessoa(id: number) { const [e] = await sql<PessoaBenef[]>`SELECT id, nome, vinculo, unit_id, position_id, jornada_min_dia, admissao::text, salario::float, situacao FROM employees WHERE id=${id}`; return e ?? null; }

export async function salvarPlano(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id"); const back = "/beneficios?aba=catalogo";
  try {
    assert(can.editar(s) && can.verSalario(s), "Benefícios são configurados pelo RH ou pela Direção.");
    const cfg = await getSettings(); const tipos = cfg.beneficios.tipos as Record<string, string>;
    const nome = str(fd, "nome"); if (nome.length < 3) throw new Error("Dê um nome ao benefício."); const tipo = str(fd, "tipo"); if (!tipos[tipo]) throw new Error("Tipo inválido.");
    const pct = num(fd, "custoEmpresaPct"); if (pct !== null && (pct < 0 || pct > 100)) throw new Error("O % pago pela escola vai de 0 a 100.");
    const descPct = num(fd, "descontoColabPct"); const vtMax = Number(cfg.beneficios.vtDescontoMaxPct) || 6;
    if (tipo === "VT" && descPct !== null && descPct > vtMax) throw new Error(`O desconto do vale-transporte é de no máximo ${vtMax}% do salário-base (Lei 7.418/1985).`);
    const depPct = num(fd, "depPctEmpresa"); if (depPct !== null && (depPct < 0 || depPct > 100)) throw new Error("O % da escola nos dependentes vai de 0 a 100.");
    const jorn = num(fd, "jornadaMinH"); const carencia = int(fd, "carenciaDias") ?? 0; if (carencia < 0 || carencia > 365) throw new Error("Carência de 0 a 365 dias.");
    const eleg = { vinculos: fd.getAll("vinculos").map(String).filter(Boolean), unidades: fd.getAll("unidades").map(Number).filter(Boolean), jornadaMinDia: jorn ? Math.round(jorn * 60) : null, depPctEmpresa: depPct ?? 0 };
    const v = { nome, tipo, fornecedor: strOrNull(fd, "fornecedor"), custo_empresa: num(fd, "custoEmpresa"), custo_empresa_pct: pct ?? 100, desconto_colab: num(fd, "descontoColab"), desconto_colab_pct: descPct, custo_dependente: num(fd, "custoDependente"), carencia_dias: carencia, ativo: str(fd, "ativo") !== "0", obs: strOrNull(fd, "obs") };
    if (id) {
      const antes = await plano(id); if (!antes) throw new Error("Benefício não encontrado.");
      await sql`UPDATE benefit_plans SET nome=${v.nome}, tipo=${v.tipo}, fornecedor=${v.fornecedor}, custo_empresa=${v.custo_empresa}, custo_empresa_pct=${v.custo_empresa_pct}, desconto_colab=${v.desconto_colab}, desconto_colab_pct=${v.desconto_colab_pct}, custo_dependente=${v.custo_dependente}, elegibilidade=${JSON.stringify(eleg)}::jsonb, carencia_dias=${v.carencia_dias}, ativo=${v.ativo}, obs=${v.obs} WHERE id=${id}`;
      await audit(s, "editar benefício", "benefit_plans", id, antes, { ...v, elegibilidade: eleg });
    } else {
      const [n] = await sql<{ id: number }[]>`INSERT INTO benefit_plans (nome, tipo, fornecedor, custo_empresa, custo_empresa_pct, desconto_colab, desconto_colab_pct, custo_dependente, elegibilidade, carencia_dias, ativo, obs) VALUES (${v.nome}, ${v.tipo}, ${v.fornecedor}, ${v.custo_empresa}, ${v.custo_empresa_pct}, ${v.desconto_colab}, ${v.desconto_colab_pct}, ${v.custo_dependente}, ${JSON.stringify(eleg)}::jsonb, ${v.carencia_dias}, ${v.ativo}, ${v.obs}) RETURNING id`;
      await audit(s, "criar benefício", "benefit_plans", n.id, null, { ...v, elegibilidade: eleg });
    }
  } catch (e) { redirect(go(back, "erro", msgErro(e))); }
  redirect(go(back, "ok", id ? "Benefício atualizado." : "Benefício criado."));
}

export async function aderirBeneficio(fd: FormData) {
  const s = await requireSession(); const back = voltar(fd, "/beneficios?aba=adesoes");
  try {
    assert(can.editar(s) && can.verSalario(s), "Adesões são registradas pelo RH ou pela Direção.");
    const cfg = await getSettings(); const p = await plano(Number(fd.get("planId"))); if (!p?.ativo) throw new Error("Escolha um benefício ativo.");
    const e = await pessoa(Number(fd.get("employeeId"))); if (!e || !["ATIVO", "FERIAS", "AFASTADO", "EM_ADMISSAO"].includes(e.situacao)) throw new Error("Escolha um colaborador ativo.");
    const inicio = str(fd, "inicio") || hoje(); if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio)) throw new Error("Data de início inválida."); if (inicio < e.admissao) throw new Error("O início não pode ser antes da admissão.");
    const [ja] = await sql`SELECT 1 FROM benefit_enrollments WHERE employee_id=${e.id} AND plan_id=${p.id} AND status='ATIVO' AND (${p.tipo}::text <> 'BOLSA_DEPENDENTE')`; if (ja) throw new Error("Esta pessoa já tem este benefício ativo.");
    const el = elegivel(p, e, inicio); const excecao = str(fd, "excecao") === "1"; const obs = strOrNull(fd, "obs");
    if (!el.ok && !excecao) throw new Error(`Fora da regra do benefício: ${el.motivos.join("; ")}. Para conceder mesmo assim, marque exceção e justifique.`);
    if (!el.ok && (!obs || obs.length < 10)) throw new Error("Exceção à regra exige justificativa (10+ caracteres).");
    const dependentes = Math.max(0, int(fd, "dependentes") ?? 0); if (dependentes > 10) throw new Error("No máximo 10 dependentes.");
    let valorInf = num(fd, "valor"); let studentId: number | null = null; let bolsaPct: number | null = null;
    if (p.tipo === "VT" && (valorInf === null || valorInf <= 0)) throw new Error("Informe o custo mensal do transporte da pessoa (ida e volta, dias úteis).");
    if (p.tipo === "BOLSA_DEPENDENTE") {
      const m = /#(\d+)\)?\s*$/.exec(str(fd, "aluno")); studentId = m ? Number(m[1]) : null; if (!studentId) throw new Error("Escolha o(a) aluno(a) na lista (nome com o número).");
      const [st] = await sql<{ id: number; unit_atual_id: number | null; serie_atual_id: number | null }[]>`SELECT id, unit_atual_id, serie_atual_id FROM students WHERE id=${studentId}`; if (!st) throw new Error("Aluno(a) não encontrado(a).");
      const [dup] = await sql`SELECT 1 FROM benefit_enrollments WHERE student_id=${studentId} AND status='ATIVO'`; if (dup) throw new Error("Este(a) aluno(a) já tem bolsa ativa.");
      bolsaPct = num(fd, "bolsaPct"); if (bolsaPct === null || bolsaPct <= 0 || bolsaPct > 100) throw new Error("Informe o % da bolsa (1 a 100).");
      if (valorInf === null) { const [tp] = await sql<{ v: number }[]>`SELECT valor_mensal::float AS v FROM tuition_prices WHERE unit_id=${st.unit_atual_id ?? 0} AND (grade_id=${st.serie_atual_id ?? 0} OR grade_id IS NULL) AND modalidade='REGULAR' ORDER BY abs(ano - ${Number(inicio.slice(0, 4))}), grade_id NULLS LAST LIMIT 1`; if (!tp) throw new Error("Não achei a mensalidade da série do aluno — informe o valor mensal da bolsa."); valorInf = (tp.v * bolsaPct) / 100; }
    }
    const vtMax = Number(cfg.beneficios.vtDescontoMaxPct) || 6; const c = calcularAdesao(p, e.salario, dependentes, valorInf, vtMax);
    let empresa = num(fd, "valorEmpresa") ?? c.empresa; let colab = num(fd, "valorColab") ?? (p.tipo === "BOLSA_DEPENDENTE" ? 0 : c.colab);
    if (p.tipo === "BOLSA_DEPENDENTE" && num(fd, "valorEmpresa") === null) { empresa = Math.round((valorInf ?? 0) * 100) / 100; colab = 0; }
    if (p.tipo === "VT" && e.salario && colab > (e.salario * vtMax) / 100 + 0.01) throw new Error(`Desconto do VT acima de ${vtMax}% do salário-base.`);
    if (empresa < 0 || colab < 0) throw new Error("Valores não podem ser negativos.");
    const [n] = await sql<{ id: number }[]>`INSERT INTO benefit_enrollments (plan_id, employee_id, inicio, status, dependentes, student_id, bolsa_pct, valor_empresa, valor_colab, obs, criado_por) VALUES (${p.id}, ${e.id}, ${inicio}, 'ATIVO', ${dependentes}, ${studentId}, ${bolsaPct}, ${empresa}, ${colab}, ${!el.ok ? `EXCEÇÃO À REGRA (${el.motivos.join("; ")}): ${obs}` : obs}, ${s.id}) RETURNING id`;
    await audit(s, "aderir benefício", "benefit_enrollments", n.id, null, { plano: p.nome, employeeId: e.id, inicio, dependentes, excecao: !el.ok });
    const [u] = await sql<{ id: number }[]>`SELECT id FROM users WHERE employee_id=${e.id} AND ativo LIMIT 1`; if (u) await notificar([u.id], "Benefício registrado", "Um benefício foi incluído para você. Veja em Meu espaço.", "/eu#beneficios", "INFO", `benef:${n.id}`);
  } catch (e) { redirect(go(back, "erro", msgErro(e))); }
  redirect(go(back, "ok", "Adesão registrada — entra nas movimentações do mês da folha."));
}

export async function encerrarAdesao(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const back = voltar(fd, "/beneficios?aba=adesoes");
  try {
    assert(can.editar(s) && can.verSalario(s), "Só o RH ou a Direção encerram benefícios.");
    const [a] = await sql<{ inicio: string; status: string }[]>`SELECT inicio::text, status FROM benefit_enrollments WHERE id=${id}`; if (!a || a.status !== "ATIVO") throw new Error("Adesão não encontrada ou já encerrada.");
    const fim = str(fd, "fim") || hoje(); if (fim < a.inicio) throw new Error("O fim não pode ser antes do início."); const motivo = str(fd, "motivo"); if (motivo.length < 3) throw new Error("Diga o motivo do encerramento.");
    await sql`UPDATE benefit_enrollments SET status='ENCERRADO', fim=${fim}, motivo_fim=${motivo}, encerrado_por=${s.id} WHERE id=${id}`;
    await audit(s, "encerrar benefício", "benefit_enrollments", id, { status: "ATIVO" }, { status: "ENCERRADO", fim, motivo });
  } catch (e) { redirect(go(back, "erro", msgErro(e))); }
  redirect(go(back, "ok", "Benefício encerrado."));
}

export async function atualizarAdesao(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const back = voltar(fd, "/beneficios?aba=adesoes");
  try {
    assert(can.editar(s) && can.verSalario(s), "Só o RH ou a Direção alteram benefícios.");
    const [a] = await sql<{ plan_id: number; employee_id: number; status: string; dependentes: number; valor_empresa: number | null; valor_colab: number | null }[]>`SELECT plan_id, employee_id, status, dependentes, valor_empresa::float, valor_colab::float FROM benefit_enrollments WHERE id=${id}`; if (!a || a.status !== "ATIVO") throw new Error("Adesão não encontrada ou encerrada.");
    const p = (await plano(a.plan_id))!; const e = (await pessoa(a.employee_id))!; const cfg = await getSettings(); const vtMax = Number(cfg.beneficios.vtDescontoMaxPct) || 6;
    const dependentes = Math.max(0, int(fd, "dependentes") ?? a.dependentes); const valorInf = num(fd, "valor") ?? (p.tipo === "VT" || p.tipo === "BOLSA_DEPENDENTE" ? Number(a.valor_empresa ?? 0) + Number(a.valor_colab ?? 0) : null);
    const c = calcularAdesao(p, e.salario, dependentes, valorInf, vtMax);
    const empresa = num(fd, "valorEmpresa") ?? (p.tipo === "BOLSA_DEPENDENTE" ? valorInf ?? 0 : c.empresa); const colab = num(fd, "valorColab") ?? (p.tipo === "BOLSA_DEPENDENTE" ? 0 : c.colab);
    if (p.tipo === "VT" && e.salario && colab > (e.salario * vtMax) / 100 + 0.01) throw new Error(`Desconto do VT acima de ${vtMax}% do salário-base.`);
    await sql`UPDATE benefit_enrollments SET dependentes=${dependentes}, valor_empresa=${empresa}, valor_colab=${colab} WHERE id=${id}`;
    await audit(s, "alterar benefício", "benefit_enrollments", id, { dependentes: a.dependentes, valor_empresa: a.valor_empresa, valor_colab: a.valor_colab }, { dependentes, valor_empresa: empresa, valor_colab: colab });
  } catch (e) { redirect(go(back, "erro", msgErro(e))); }
  redirect(go(back, "ok", "Adesão atualizada."));
}

/** Recalcula as adesões ativas pelas regras e salários atuais (depois de um reajuste ou de mudar o preço do plano). Bolsas ficam como estão. */
export async function recalcularAdesoes(fd: FormData) {
  const s = await requireSession(); const back = "/beneficios?aba=adesoes"; let n = 0;
  try {
    assert(can.editar(s) && can.verSalario(s), "Só o RH ou a Direção recalculam benefícios.");
    const cfg = await getSettings(); const vtMax = Number(cfg.beneficios.vtDescontoMaxPct) || 6; const planId = int(fd, "planId");
    const xs = await sql<{ id: number; plan_id: number; employee_id: number; dependentes: number; valor_empresa: number | null; valor_colab: number | null }[]>`SELECT a.id, a.plan_id, a.employee_id, a.dependentes, a.valor_empresa::float, a.valor_colab::float FROM benefit_enrollments a JOIN benefit_plans p ON p.id=a.plan_id WHERE a.status='ATIVO' AND p.tipo <> 'BOLSA_DEPENDENTE' ${planId ? sql`AND a.plan_id=${planId}` : sql``}`;
    for (const a of xs) {
      const p = (await plano(a.plan_id))!; const e = await pessoa(a.employee_id); if (!e) continue;
      const c = calcularAdesao(p, e.salario, a.dependentes, p.tipo === "VT" ? Number(a.valor_empresa ?? 0) + Number(a.valor_colab ?? 0) : null, vtMax);
      if (Math.abs(c.empresa - Number(a.valor_empresa ?? 0)) > 0.005 || Math.abs(c.colab - Number(a.valor_colab ?? 0)) > 0.005) { await sql`UPDATE benefit_enrollments SET valor_empresa=${c.empresa}, valor_colab=${c.colab} WHERE id=${a.id}`; n++; }
    }
    await audit(s, "recalcular benefícios", "benefit_enrollments", null, null, { planId, alteradas: n });
  } catch (e) { redirect(go(back, "erro", msgErro(e))); }
  redirect(go(back, "ok", n ? `${n} adesão(ões) recalculada(s) pelas regras e salários atuais.` : "Nada mudou: as adesões já estão pelas regras atuais."));
}
