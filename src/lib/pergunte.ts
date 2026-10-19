import { sql } from "@/db";
import { scopeUnit, type Session } from "./auth";
import { kpisVisiveis, visoes, vePainelExecutivo, CATALOGO } from "./kpi";
import { nomeKpi } from "./kpi-catalogo";
import { fmtKpi, variacao, rotuloMes, MESES_LONGOS } from "./formato";
import { somaMeses } from "./gestao-calc";
import { getSettings, hoje } from "./utils";

/**
 * T-099 · Pergunte ao Status (modo pergunta da busca ⌘K): pergunta em linguagem natural → indicador do catálogo, unidade, período e
 * comparação → resposta com o número, a FONTE, o PERÍODO declarado, um minigráfico e o link que abre a tela com o mesmo filtro.
 * Determinístico (sem IA): o que não reconhece, recusa explicando; perguntas sobre pessoas específicas não são respondidas aqui.
 */
const n = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w\s/+÷.-]/g, " ").replace(/\s+/g, " ").trim();
/** Sinônimos → chave do catálogo (a ordem importa: o mais específico primeiro). */
export const SINONIMOS: [string[], string][] = [
  [["folha sobre receita", "folha/receita", "folha ÷ receita", "folha por receita", "peso da folha"], "financeiro.folha_receita"],
  [["custo por aluno"], "financeiro.custo_aluno"], [["receita por aluno"], "financeiro.receita_aluno"],
  [["inadimplencia 30", "inadimplencia acima de 30", "inadimplencia", "calote", "inadimplentes"], "financeiro.inadimplencia30"],
  [["ebitda"], "financeiro.ebitda"], [["margem"], "financeiro.margem"], [["resultado", "lucro", "sobra de caixa"], "financeiro.resultado"],
  [["receita", "faturamento", "entradas", "arrecadacao", "arrecadou", "faturou"], "financeiro.receita"], [["despesa", "despesas", "gastos", "gastou", "saidas"], "financeiro.despesa"],
  [["saldo de caixa", "caixa"], "financeiro.caixa"], [["mensalidade media", "ticket medio", "ticket"], "financeiro.ticket"], [["custo de pessoal", "custo da folha", "folha"], "financeiro.custo_pessoal"],
  [["matriculas novas", "novas matriculas", "captacao", "alunos novos"], "matriculas.novas"], [["rematricula", "rematriculas"], "matriculas.rematricula"],
  [["lista de espera", "fila de espera"], "matriculas.lista_espera"], [["ocupacao", "vagas ocupadas", "lotacao"], "matriculas.ocupacao"], [["cancelamentos", "matriculas canceladas"], "matriculas.cancelamentos"],
  [["alunos", "aluno", "estudantes", "matriculados"], "matriculas.alunos"],
  [["turnover", "rotatividade"], "pessoas.turnover"], [["absenteismo", "faltas"], "pessoas.absenteismo"], [["horas extras", "hora extra"], "pessoas.horas_extras"], [["banco de horas"], "pessoas.banco_horas"],
  [["enps", "clima"], "pessoas.enps"], [["colaboradores", "funcionarios", "headcount", "quadro de pessoal", "equipe"], "pessoas.quadro"], [["vagas abertas", "vagas em aberto"], "pessoas.vagas_abertas"],
  [["nps", "satisfacao das familias"], "familias.nps"], [["reclamacoes"], "familias.reclamacoes"], [["chamados"], "operacoes.chamados"], [["okr", "okrs"], "estrategia.okrs"],
];
const MESES_N = MESES_LONGOS.map(m => n(m));
export type Interpretacao = { kpi: string | null; unitId: number | null; unidade: string | null; periodo: string | null; comparar: string | null; recusa: string | null; termoKpi: string | null };

/** Interpreta a pergunta (função pura — testável). `mesAtual` = AAAA-MM de hoje. */
export function interpretar(pergunta: string, units: { id: number; nome: string; codigo: string }[], mesAtual: string): Interpretacao {
  const t = ` ${n(pergunta)} `; const out: Interpretacao = { kpi: null, unitId: null, unidade: null, periodo: null, comparar: null, recusa: null, termoKpi: null };
  if (/\b(cpf|salario de|salario do|salario da|quem (e|eh|foi|esta)|qual (colaborador|professor|funcionario|aluno)|telefone d|endereco d)\b/.test(t)) { out.recusa = "pessoa"; return out; }
  for (const [termos, chave] of SINONIMOS) { const achou = termos.find(x => t.includes(` ${n(x)} `) || t.includes(` ${n(x)}?`) || t.includes(` ${n(x)}`)); if (achou) { out.kpi = chave; out.termoKpi = achou; break; } }
  if (!out.kpi && /\b(cresceu|crescimento|cresce|aumentou|diminuiu|caiu)\b/.test(t)) { out.kpi = "matriculas.alunos"; out.termoKpi = "alunos (padrão para crescimento)"; }
  // unidade: o nome mais longo primeiro (TV Morena II antes de TV Morena I)
  const us = [...units].sort((a, b) => b.nome.length - a.nome.length);
  for (const u of us) { const nm = n(u.nome); if (t.includes(` ${nm} `) || t.includes(` ${nm}?`) || (u.codigo && t.includes(` ${n(u.codigo)} `))) { out.unitId = u.id; out.unidade = u.nome; break; } }
  // período: "mes de ano", "mes", "mes passado", "este mes", "ano"
  const [anoAtual] = mesAtual.split("-").map(Number);
  const mm = t.match(new RegExp(`\\b(${MESES_N.join("|")})\\b(?:\\s+(?:de\\s+)?(\\d{4}))?`));
  if (mm) { const m = MESES_N.indexOf(mm[1]) + 1; const a = mm[2] ? Number(mm[2]) : (m <= Number(mesAtual.slice(5, 7)) ? anoAtual : anoAtual - 1); out.periodo = `${a}-${String(m).padStart(2, "0")}`; }
  else if (/\b(mes passado|ultimo mes|mes anterior)\b/.test(t)) out.periodo = somaMeses(mesAtual, -1);
  else if (/\b(este mes|esse mes|neste mes|agora|hoje|atual|atualmente)\b/.test(t)) out.periodo = mesAtual;
  // comparação: "vs 2026", "em relação a 2025", "comparado com 2025", "cresceu" sem ano = mesmo mês do ano anterior
  const cmp = t.match(/\b(?:vs\.?|versus|x|em relacao (?:a|ao)|comparad[oa] (?:a|ao|com)|frente a|contra|desde)\s+(?:o\s+|a\s+)?(?:ano\s+(?:de\s+)?)?(\d{4})\b/);
  if (cmp) out.comparar = cmp[1];
  else if (/\b(vs|versus|comparado|em relacao)\b.*\b(mes passado|mes anterior)\b/.test(t)) out.comparar = "MES_ANTERIOR";
  else if (/\b(cresceu|crescimento|aumentou|diminuiu|caiu|variou|evoluiu)\b/.test(t)) out.comparar = "ANO_ANTERIOR";
  if (!out.kpi) out.recusa = "indicador";
  return out;
}
/** Período de comparação: ano anterior ao atual → mesmo mês daquele ano; o próprio ano → início do ano (janeiro); mês anterior; ano anterior. */
export function periodoComparacao(periodo: string, comparar: string | null): { periodo: string; rotulo: string } | null {
  if (!comparar) return null; const [a, m] = periodo.split("-").map(Number);
  if (comparar === "MES_ANTERIOR") return { periodo: somaMeses(periodo, -1), rotulo: `vs ${rotuloMes(somaMeses(periodo, -1))}` };
  if (comparar === "ANO_ANTERIOR") return { periodo: somaMeses(periodo, -12), rotulo: `vs ${rotuloMes(somaMeses(periodo, -12))}` };
  const y = Number(comparar); if (!y) return null;
  if (y < a) return { periodo: `${y}-${String(m).padStart(2, "0")}`, rotulo: `vs ${rotuloMes(`${y}-${String(m).padStart(2, "0")}`)} (mesmo mês de ${y})` };
  if (y === a && m > 1) return { periodo: `${y}-01`, rotulo: `desde ${rotuloMes(`${y}-01`)} (início de ${y})` };
  return null;
}

export type Resposta = { ok: true; titulo: string; texto: string; valor: string; fonte: string; periodo: string; comparacao: string | null; serie: (number | null)[]; href: string; interpretacao: Interpretacao }
  | { ok: false; recusa: string; sugestoes: string[]; interpretacao: Interpretacao };
export const EXEMPLOS = ["quanto a Cultura cresceu vs 2025?", "inadimplência do Carandá este mês", "receita da rede em setembro", "turnover da TV Morena I", "ocupação das vagas"];

export async function responder(s: Session, pergunta: string): Promise<Resposta> {
  const units = await sql<{ id: number; nome: string; codigo: string }[]>`SELECT id, nome, codigo FROM units ORDER BY nome`; const h = hoje(); const mesAtual = h.slice(0, 7);
  const it = interpretar(pergunta, units, mesAtual);
  if (it.recusa === "pessoa") return { ok: false, recusa: "Perguntas sobre uma pessoa específica (salário, CPF, contato, desempenho) não são respondidas aqui: abra a ficha, que aplica a permissão e registra o acesso.", sugestoes: EXEMPLOS, interpretacao: it };
  if (!vePainelExecutivo(s)) return { ok: false, recusa: "Seu perfil não acessa a base de indicadores: o Pergunte ao Status responde só indicadores com fonte.", sugestoes: [], interpretacao: it };
  if (!it.kpi) return { ok: false, recusa: "Não reconheci o indicador da pergunta. Use um destes termos: alunos, ocupação, rematrícula, receita, despesa, EBITDA, inadimplência, caixa, folha ÷ receita, colaboradores, turnover, absenteísmo, NPS…", sugestoes: EXEMPLOS, interpretacao: it };
  const visiveis = await kpisVisiveis(s); const def = visiveis.find(k => k.chave === it.kpi);
  if (!def) { const nome = CATALOGO.find(k => k.chave === it.kpi)?.nome ?? it.kpi; return { ok: false, recusa: `Seu perfil não vê o indicador “${nome}”.`, sugestoes: EXEMPLOS, interpretacao: it }; }
  const escopo = scopeUnit(s); if (escopo !== null && it.unitId !== null && it.unitId !== escopo) return { ok: false, recusa: `Seu acesso é à sua unidade: a pergunta citou ${it.unidade}.`, sugestoes: EXEMPLOS, interpretacao: it };
  const unitId = escopo ?? it.unitId; if (unitId && def.porUnidade === false) return { ok: false, recusa: `“${def.nome}” só existe para a rede (sem quebra por unidade).`, sugestoes: EXEMPLOS, interpretacao: it };
  const cfg = await getSettings(); const anoLetivo = cfg.matriculas.anoLetivo as number;
  const estoque = def.agregacao === "ESTOQUE" || def.historico === "RETRATO";
  const periodo = it.periodo && it.periodo <= mesAtual ? it.periodo : estoque ? mesAtual : somaMeses(mesAtual, -1);
  const [v] = await visoes([def], periodo, unitId ?? 0, 24);
  const unidade = unitId ? units.find(u => u.id === unitId)!.nome : "Rede";
  const cmp = periodoComparacao(periodo, it.comparar); const vc = cmp ? v.serie.find(p => p.periodo === cmp.periodo)?.valor ?? null : null;
  const valor = fmtKpi(v.valor, def.unidade); const nome = nomeKpi(def, anoLetivo);
  const varTxt = cmp ? (v.valor !== null && vc !== null ? (() => { const x = variacao(v.valor, vc, def.unidade); return x ? `${x.texto} ${cmp.rotulo} (${fmtKpi(vc, def.unidade)})` : null; })() : `sem dado para comparar ${cmp.rotulo}`) : null;
  const texto = v.valor === null ? `${nome} · ${unidade} · ${rotuloMes(periodo)}: sem fonte para o período (o número não vira zero).` : `${nome} · ${unidade} · ${rotuloMes(periodo)}: ${valor}${varTxt ? ` — ${varTxt}` : ""}.`;
  const href = `/executivo/indicador/${encodeURIComponent(def.chave)}?${new URLSearchParams({ periodo, ...(unitId ? { unidade: String(unitId) } : {}) })}`;
  return { ok: true, titulo: nome, texto, valor, fonte: def.fonte, periodo: rotuloMes(periodo), comparacao: varTxt, serie: v.serie.slice(-13).map(p => p.valor), href, interpretacao: it };
}
