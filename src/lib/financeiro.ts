import { sql } from "@/db";
import { hoje, getSettings, addMonths } from "./utils";

export const REC_STATUS: Record<string, string> = { ABERTO: "Em aberto", PAGO: "Pago", NEGOCIADO: "Negociado", CANCELADO: "Cancelado" };
export const REC_TIPO: Record<string, string> = { MENSALIDADE: "Mensalidade", INTEGRAL: "Integral", MATERIAL: "Material", TAXA: "Taxa", OUTRO: "Outro" };
export const ETAPA_COB: Record<string, string> = { LEMBRETE: "Lembrete", CONTATO: "Contato", NEGOCIACAO: "Negociação", AVISO_FORMAL: "Aviso formal", JURIDICO: "Jurídico" };
export const RESULTADO_COB: Record<string, string> = { SEM_RETORNO: "Sem retorno", PROMESSA: "Promessa de pagamento", ACORDO: "Acordo fechado", PAGO: "Pagou", RECUSA: "Recusou" };
export const DESC_STATUS: Record<string, string> = { SOLICITADO: "Aguardando aprovação", APROVADO: "Aprovado", REJEITADO: "Rejeitado", EXPIRADO: "Expirado" };
export const ACORDO_STATUS: Record<string, string> = { ATIVO: "Ativo", CUMPRIDO: "Cumprido", QUEBRADO: "Quebrado", CANCELADO: "Cancelado" };
export const FAIXAS = [[1, 30], [31, 60], [61, 90], [91, 100000]] as const;
export const faixaLabel = (i: number) => ["1–30 dias", "31–60 dias", "61–90 dias", "+90 dias"][i];

export const brl = (v: number | string | null | undefined) => v === null || v === undefined || v === "" ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function etapaDaRegua(diasAtraso: number, regua: [number, string, string][]) {
  let atual: [number, string, string] | null = null;
  for (const r of regua) if (diasAtraso >= r[0]) atual = r;
  return atual;
}

export async function inadimplencia(unitId: number | null) {
  const cfg = await getSettings(); const h = hoje();
  const rows = await sql<{ id: number; aluno_nome: string; student_id: number | null; responsavel: string | null; telefone: string | null; unidade: string; unit_id: number; tipo: string; competencia: string | null; vencimento: string; valor: number; dias: number; ultima_etapa: string | null; ultima_acao: string | null; ultimo_resultado: string | null; agreement_id: number | null }[]>`
    SELECT r.id, r.aluno_nome, r.student_id, r.responsavel, r.telefone, u.nome AS unidade, r.unit_id, r.tipo, r.competencia, r.vencimento::text, r.valor::float, (${h}::date - r.vencimento)::int AS dias,
      (SELECT etapa FROM collection_actions a WHERE a.receivable_id=r.id ORDER BY a.at DESC LIMIT 1) AS ultima_etapa, (SELECT a.at::text FROM collection_actions a WHERE a.receivable_id=r.id ORDER BY a.at DESC LIMIT 1) AS ultima_acao, (SELECT a.resultado FROM collection_actions a WHERE a.receivable_id=r.id ORDER BY a.at DESC LIMIT 1) AS ultimo_resultado, r.agreement_id
    FROM receivables r JOIN units u ON u.id=r.unit_id WHERE r.status='ABERTO' AND r.vencimento < ${h} ${unitId === null ? sql`` : sql`AND r.unit_id=${unitId}`} ORDER BY r.vencimento`;
  const regua = cfg.financeiro.regua as [number, string, string][];
  const itens = rows.map(r => { const et = etapaDaRegua(r.dias, regua); const faixa = FAIXAS.findIndex(([a, b]) => r.dias >= a && r.dias <= b); const atrasada = et && (!r.ultima_etapa || regua.findIndex(x => x[1] === r.ultima_etapa) < regua.findIndex(x => x[1] === et[1])); return { ...r, etapa: et?.[1] ?? null, canal: et?.[2] ?? null, faixa, acaoPendente: !!atrasada }; });
  const aging = FAIXAS.map((_, i) => ({ faixa: faixaLabel(i), n: itens.filter(x => x.faixa === i).length, valor: itens.filter(x => x.faixa === i).reduce((a, x) => a + x.valor, 0) }));
  const familias = new Set(itens.map(x => x.aluno_nome)).size;
  const [[tot]] = await Promise.all([sql<{ emitido: number; recebido: number }[]>`SELECT coalesce(sum(valor),0)::float AS emitido, coalesce(sum(valor) FILTER (WHERE status='PAGO'),0)::float AS recebido FROM receivables r WHERE r.vencimento >= ${h}::date - 90 AND r.vencimento <= ${h} AND r.status <> 'CANCELADO' ${unitId === null ? sql`` : sql`AND r.unit_id=${unitId}`}`]);
  const porUnidade = await sql<{ unidade: string; n: number; valor: number }[]>`SELECT u.nome AS unidade, count(*)::int AS n, sum(r.valor)::float AS valor FROM receivables r JOIN units u ON u.id=r.unit_id WHERE r.status='ABERTO' AND r.vencimento < ${h} ${unitId === null ? sql`` : sql`AND r.unit_id=${unitId}`} GROUP BY u.nome ORDER BY valor DESC`;
  return { itens, aging, total: itens.reduce((a, x) => a + x.valor, 0), familias, taxa90: tot.emitido ? Math.round(1000 * (tot.emitido - tot.recebido) / tot.emitido) / 10 : null, porUnidade, acoesPendentes: itens.filter(x => x.acaoPendente).length };
}

export async function receita(ano: number, unitId: number | null) {
  const cfg = await getSettings(); void cfg;
  const uf = unitId === null ? sql`` : sql`AND c.unit_id=${unitId}`;
  // previsto: matriculados confirmados × valor da série (menos descontos aprovados)
  const prev = await sql<{ unidade: string; unit_id: number; serie: string | null; modalidade: string; alunos: number; valor: number | null; parcelas: number | null; desconto_pct: number }[]>`
    SELECT u.nome AS unidade, c.unit_id, g.nome AS serie, c.modalidade, count(e.id)::int AS alunos, tp.valor_mensal::float AS valor, tp.parcelas,
      coalesce(avg((SELECT max(d.percentual) FROM discounts d WHERE d.status='APROVADO' AND d.ano=${ano} AND (d.student_id=e.student_id))),0)::float AS desconto_pct
    FROM enrollments e JOIN classes c ON c.id=e.class_id JOIN units u ON u.id=c.unit_id LEFT JOIN grades g ON g.id=c.grade_id
    LEFT JOIN tuition_prices tp ON tp.ano=c.ano AND tp.unit_id=c.unit_id AND tp.modalidade=c.modalidade AND (tp.grade_id=c.grade_id OR (tp.grade_id IS NULL AND c.grade_id IS NULL))
    WHERE e.ano=${ano} AND e.status='CONFIRMADA' ${uf} GROUP BY u.nome, c.unit_id, g.nome, g.ordem, c.modalidade, tp.valor_mensal, tp.parcelas ORDER BY u.nome, c.modalidade, g.ordem`;
  const linhas = prev.map(p => ({ ...p, mensal: p.valor ? p.alunos * p.valor * (1 - p.desconto_pct / 100) : null, anual: p.valor ? p.alunos * p.valor * (1 - p.desconto_pct / 100) * (p.parcelas ?? 12) : null }));
  const semPreco = linhas.filter(l => l.valor === null).reduce((a, l) => a + l.alunos, 0);
  // realizado: títulos pagos por competência (importados)
  const real = await sql<{ competencia: string; emitido: number; recebido: number; inadimplente: number }[]>`SELECT r.competencia, sum(r.valor)::float AS emitido, coalesce(sum(r.valor_pago) FILTER (WHERE r.status='PAGO'),0)::float AS recebido, coalesce(sum(r.valor) FILTER (WHERE r.status='ABERTO' AND r.vencimento < ${hoje()}),0)::float AS inadimplente FROM receivables r WHERE r.competencia LIKE ${String(ano) + "-%"} AND r.status <> 'CANCELADO' ${unitId === null ? sql`` : sql`AND r.unit_id=${unitId}`} GROUP BY r.competencia ORDER BY r.competencia`;
  const descontos = await sql<{ tipo: string; n: number; pct_medio: number }[]>`SELECT d.tipo, count(*)::int AS n, avg(d.percentual)::float AS pct_medio FROM discounts d WHERE d.status='APROVADO' AND d.ano=${ano} ${unitId === null ? sql`` : sql`AND d.unit_id=${unitId}`} GROUP BY d.tipo ORDER BY n DESC`;
  return { linhas, semPreco, mensal: linhas.reduce((a, l) => a + (l.mensal ?? 0), 0), anual: linhas.reduce((a, l) => a + (l.anual ?? 0), 0), alunos: linhas.reduce((a, l) => a + l.alunos, 0), real, descontos };
}

export async function caixaMes(mes: string, unitId: number | null) {
  const ini = `${mes}-01`; const fim = addMonths(ini, 1);
  const uf = unitId === null ? sql`` : sql`AND c.unit_id=${unitId}`;
  const [porCat, porForma, [tot], saldos, dias] = await Promise.all([
    sql<{ tipo: string; categoria: string; valor: number; n: number }[]>`SELECT c.tipo, c.categoria, sum(c.valor)::float AS valor, count(*)::int AS n FROM cash_entries c WHERE c.data >= ${ini} AND c.data < ${fim} ${uf} GROUP BY c.tipo, c.categoria ORDER BY c.tipo, valor DESC`,
    sql<{ forma: string; valor: number }[]>`SELECT coalesce(c.forma,'OUTRO') AS forma, sum(c.valor)::float AS valor FROM cash_entries c WHERE c.tipo='ENTRADA' AND c.data >= ${ini} AND c.data < ${fim} ${uf} GROUP BY 1 ORDER BY valor DESC`,
    sql<{ entradas: number; saidas: number; transf: number }[]>`SELECT coalesce(sum(c.valor) FILTER (WHERE c.tipo='ENTRADA'),0)::float AS entradas, coalesce(sum(c.valor) FILTER (WHERE c.tipo='SAIDA'),0)::float AS saidas, coalesce(sum(c.valor) FILTER (WHERE c.tipo='TRANSFERENCIA'),0)::float AS transf FROM cash_entries c WHERE c.data >= ${ini} AND c.data < ${fim} ${uf}`,
    sql<{ unit_id: number; saldo_inicial: number }[]>`SELECT unit_id, saldo_inicial::float FROM cash_balances WHERE mes=${mes} ${unitId === null ? sql`` : sql`AND unit_id=${unitId}`}`,
    sql<{ data: string; entradas: number; saidas: number }[]>`SELECT c.data::text, coalesce(sum(c.valor) FILTER (WHERE c.tipo='ENTRADA'),0)::float AS entradas, coalesce(sum(c.valor) FILTER (WHERE c.tipo='SAIDA'),0)::float AS saidas FROM cash_entries c WHERE c.data >= ${ini} AND c.data < ${fim} ${uf} GROUP BY c.data ORDER BY c.data`,
  ]);
  const saldoInicial = saldos.length ? saldos.reduce((a, s) => a + s.saldo_inicial, 0) : null;
  return { porCat, porForma, tot, saldoInicial, saldoFinal: saldoInicial === null ? null : saldoInicial + tot.entradas - tot.saidas, dias, temSaldo: saldos.length > 0 };
}

export async function orcamentoAno(ano: number, unitId: number | null) {
  const cfg = await getSettings(); const h = hoje(); const mesesDecorridos = Number(h.slice(0, 4)) === ano ? Number(h.slice(5, 7)) : Number(h.slice(0, 4)) > ano ? 12 : 0;
  const uf = (col: string) => unitId === null ? sql`` : sql`AND ${sql(col)}=${unitId}`;
  const [orc, real, [pessoal], [alunos]] = await Promise.all([
    sql<{ tipo: string; categoria: string; valor_mensal: number }[]>`SELECT b.tipo, b.categoria, sum(b.valor_mensal)::float AS valor_mensal FROM budgets b WHERE b.ano=${ano} ${uf("b.unit_id")} GROUP BY b.tipo, b.categoria ORDER BY b.tipo, valor_mensal DESC`,
    sql<{ tipo: string; categoria: string; valor: number }[]>`SELECT c.tipo, c.categoria, sum(c.valor)::float AS valor FROM cash_entries c WHERE extract(year FROM c.data)=${ano} AND c.tipo IN ('ENTRADA','SAIDA') ${uf("c.unit_id")} GROUP BY c.tipo, c.categoria`,
    sql<{ folha: number | null; n: number }[]>`SELECT sum(e.salario)::float AS folha, count(*)::int AS n FROM employees e WHERE e.situacao='ATIVO' ${uf("e.unit_id")}`,
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM students st WHERE st.aluno_atual ${uf("st.unit_atual_id")}`,
  ]);
  const cats = [...new Set([...orc.map(o => `${o.tipo}|${o.categoria}`), ...real.map(r => `${r.tipo}|${r.categoria}`)])].map(k => { const [tipo, categoria] = k.split("|"); const o = orc.find(x => x.tipo === tipo && x.categoria === categoria); const r = real.find(x => x.tipo === tipo && x.categoria === categoria); const previstoAteAgora = o ? o.valor_mensal * mesesDecorridos : null; return { tipo, categoria, previstoMensal: o?.valor_mensal ?? null, previstoAteAgora, realizado: r?.valor ?? 0, variacao: previstoAteAgora ? Math.round(100 * ((r?.valor ?? 0) - previstoAteAgora) / previstoAteAgora) : null }; });
  const entradas = cats.filter(c => c.tipo === "ENTRADA").reduce((a, c) => a + c.realizado, 0), saidas = cats.filter(c => c.tipo === "SAIDA").reduce((a, c) => a + c.realizado, 0);
  const custoPessoalMensal = pessoal.folha ? pessoal.folha * (1 + cfg.financeiro.encargosPct / 100) : null;
  return { cats, mesesDecorridos, entradas, saidas, resultado: entradas - saidas, custoPessoalMensal, alunos: alunos.n, custoPorAlunoMensal: custoPessoalMensal && alunos.n ? custoPessoalMensal / alunos.n : null, colaboradores: pessoal.n };
}

export function normNome(v: string) { return v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim(); }
export function parseValor(v: string) { const t = v.replace(/[R$\s]/g, ""); if (/,\d{1,2}$/.test(t)) return Number(t.replace(/\./g, "").replace(",", ".")); return Number(t.replace(",", "")); }
export function parseData(v: string) { const t = v.trim(); const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10); return null; }
