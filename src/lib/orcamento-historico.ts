import { sql } from "@/db";
import { getSettings, hoje } from "./utils";
import { listarContas } from "./plano-contas";
import { metasMatricula } from "./metas-matricula";
import { custoRealPorUnidadeMes } from "./folha";
import {
  addMes, mesesDaBase, ym, detectarSinais, montarBase, projetar, totais, paramsDaVersao, atributosPorCategoria, attrDaConta, chaveGrupo, rotuloMes,
  VERSOES, type ParamsHist, type MovHist, type ContaAttr, type Decisao, type Versao, type Piso, type AttrConta, type LinhaProj, type ParamsVersao, type TotUnidade, type Flag,
} from "./orcamento-historico-calc";

/**
 * v28 · Orçamento pelo histórico (banco). Junta a base (24 meses de caixa: a base de 12 e os 12 anteriores), as decisões da
 * higienização, os alunos (atuais e de matrículas do ano do orçamento), os contratos e títulos já assumidos e os parâmetros do ano.
 * Tudo em regime de caixa e por unidade pagadora — o mesmo recorte do orçado × realizado, para a comparação fechar.
 */
export type PlanoOrc = { ano: number; params: Partial<ParamsHist>; status: string; versao_aplicada: string | null; resumo: ResumoAplicado | null; aplicado_por: string | null; aplicado_em: string | null; atualizado_por: string | null; updated_at: string };
export type ResumoAplicado = { versao: Versao; fimBase: string; aplicadoEm: string; totais: Record<Versao, { receita: number; despesa: number; resultado: number }>; porUnidade: { unit_id: number; nome: string; receita: number; despesa: number; resultado: number; alunos: number }[]; celulas: number; params: ParamsHist };

export const anoPadrao = (h = hoje()) => Number(h.slice(0, 4)) + 1;
/** Último mês completo, mas nunca dentro do ano do orçamento (a base termina antes de ele começar). */
export function fimBasePadrao(anoAlvo: number, h = hoje()) { const ultimo = addMes(h.slice(0, 7), -1); const max = ym(anoAlvo - 1, 12); return ultimo < max ? ultimo : max; }

export async function lerPlano(ano: number): Promise<PlanoOrc | null> {
  const [p] = await sql<PlanoOrc[]>`SELECT b.ano, b.params, b.status, b.versao_aplicada, b.resumo, ua.nome AS aplicado_por, b.aplicado_em::text, uu.nome AS atualizado_por, b.updated_at::text
    FROM budget_plans b LEFT JOIN users ua ON ua.id=b.aplicado_por LEFT JOIN users uu ON uu.id=b.updated_by WHERE b.ano=${ano}`;
  return p ?? null;
}

const num = (v: unknown, def: number, min: number, max: number) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : def; };
const delta = (v: unknown, d: { alunosPct: number; ipcaPp: number; dissidioPp: number; mensalidadePp: number }) => {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return { alunosPct: num(o.alunosPct, d.alunosPct, -50, 50), ipcaPp: num(o.ipcaPp, d.ipcaPp, -20, 20), dissidioPp: num(o.dissidioPp, d.dissidioPp, -20, 20), mensalidadePp: num(o.mensalidadePp, d.mensalidadePp, -20, 20) };
};
/** Parâmetros do ano: os salvos no orçamento do ano, senão os padrões de Configurações. */
export async function paramsDoAno(ano: number, plano?: PlanoOrc | null): Promise<ParamsHist> {
  const cfg = await getSettings(); const d = cfg.orcamentoHistorico as Record<string, unknown>; const p = (plano?.params ?? {}) as Record<string, unknown>;
  const v = (k: string) => (p[k] !== undefined && p[k] !== null ? p[k] : d[k]);
  const fimPad = fimBasePadrao(ano); const fb = String(p.fimBase ?? "");
  const fimBase = /^\d{4}-\d{2}$/.test(fb) && fb <= ym(ano - 1, 12) && fb <= addMes(hoje().slice(0, 7), -1) ? fb : fimPad;
  const mesesFerias = (Array.isArray(v("mesesFerias")) ? (v("mesesFerias") as unknown[]) : [1, 7]).map(Number).filter(m => m >= 1 && m <= 12);
  const alunos = (p.alunosAlvo && typeof p.alunosAlvo === "object" ? p.alunosAlvo : {}) as Record<string, unknown>;
  return {
    anoAlvo: ano, fimBase,
    ipcaPct: num(v("ipcaPct"), 4.5, -5, 50), dissidioPct: num(v("dissidioPct"), 6, -5, 50), reajusteMensalidadePct: num(v("reajusteMensalidadePct"), 6, -20, 50),
    mesDissidio: num(v("mesDissidio"), 3, 1, 12), mesReajusteMensalidade: num(v("mesReajusteMensalidade"), 1, 1, 12),
    nivelIpcaPct: num(v("nivelIpcaPct"), 4.5, -5, 50), nivelDissidioPct: num(v("nivelDissidioPct"), 6, -5, 50), nivelMensalidadePct: num(v("nivelMensalidadePct"), 6, -20, 50),
    fatorFerias: num(v("fatorFerias"), 0.6, 0, 1.5), mesesFerias, outlierFator: num(v("outlierFator"), 3, 1.5, 20), outlierMinimo: num(v("outlierMinimo"), 1000, 0, 1e7), eventoMinimo: num(v("eventoMinimo"), 5000, 0, 1e8),
    usarContratos: v("usarContratos") !== false,
    alunosAlvo: Object.fromEntries(Object.entries(alunos).map(([k, x]) => [k, Number(x)]).filter(([, x]) => Number.isFinite(x as number) && (x as number) >= 0)) as Record<string, number>,
    otimista: delta(v("otimista"), { alunosPct: 3, ipcaPp: -1, dissidioPp: 0, mensalidadePp: 1 }), estresse: delta(v("estresse"), { alunosPct: -5, ipcaPp: 2, dissidioPp: 1, mensalidadePp: -2 }),
  };
}

export type DecisaoReg = { decisao: Decisao; motivo: string | null; user_nome: string | null; decidido_em: string };
export type RefAlunos = { atuais: number; confirmadas: number; reservas: number; meta: number | null; potencial: number | null; vagas: number };
type PisoChave = Piso & { tipo: "ENTRADA" | "SAIDA"; categoria: string; unit_id: number; conta_id: number | null; attr: AttrConta };

export async function orcamentoPeloHistorico(ano: number, unitIds: number[] | null) {
  const cfg = await getSettings(); const plano = await lerPlano(ano); const p = await paramsDoAno(ano, plano);
  const internas = cfg.dre.internas as string[]; const naoDespesa = (cfg.dre.naoDespesa ?? []) as string[];
  const meses = mesesDaBase(p.fimBase); const iniBase = `${meses[0]}-01`; const fimBaseExcl = `${addMes(p.fimBase, 1)}-01`; const iniAnterior = `${addMes(meses[0], -12)}-01`;
  const todas = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`;
  const unidades = unitIds === null ? todas : todas.filter(u => unitIds.includes(u.id)); const ids = unidades.map(u => u.id);
  const iniAno = `${ano}-01-01`, fimAno = `${ano + 1}-01-01`;
  const [movsR, contasAll, decR, alunosR, parcR, ctrR, histR, orcR, nBm] = await Promise.all([
    sql<MovHist[]>`SELECT c.id, c.unit_id, c.data::text, c.tipo, c.categoria, c.valor::float, c.contraparte, c.descricao, c.conta_id, pi.id AS installment_id, pi.parcela, p.parcelas, p.natureza
      FROM cash_entries c
      LEFT JOIN (SELECT DISTINCT ON (cash_entry_id) cash_entry_id, payable_installment_id FROM bank_lines WHERE cash_entry_id IS NOT NULL AND payable_installment_id IS NOT NULL ORDER BY cash_entry_id, id) b ON b.cash_entry_id=c.id
      LEFT JOIN payable_installments pi ON pi.id=b.payable_installment_id LEFT JOIN payables p ON p.id=pi.payable_id
      WHERE c.data >= ${iniAnterior}::date AND c.data < ${fimBaseExcl}::date AND c.unit_id = ANY(${ids}::int[]) ORDER BY c.data, c.id`,
    listarContas(),
    sql<(DecisaoReg & { cash_entry_id: number })[]>`SELECT h.cash_entry_id, h.decisao, h.motivo, h.user_nome, h.decidido_em::text FROM budget_hygiene h JOIN cash_entries c ON c.id=h.cash_entry_id WHERE c.data >= ${iniBase}::date AND c.data < ${fimBaseExcl}::date AND c.unit_id = ANY(${ids}::int[])`,
    sql<{ unit_id: number; n: number }[]>`SELECT unit_atual_id AS unit_id, count(*)::int AS n FROM students WHERE aluno_atual AND unit_atual_id = ANY(${ids}::int[]) GROUP BY 1`,
    sql<{ unit_id: number; conta_id: number | null; categoria: string; mes: number; valor: number; fornecedor: string; n: number }[]>`SELECT p.unit_id, p.conta_id, p.categoria, extract(month FROM i.vencimento)::int AS mes, sum(i.valor)::float AS valor, min(p.fornecedor_nome) AS fornecedor, count(*)::int AS n
      FROM payable_installments i JOIN payables p ON p.id=i.payable_id WHERE p.status='ATIVO' AND i.status='A_PAGAR' AND p.natureza='OPERACAO' AND p.unit_id = ANY(${ids}::int[]) AND i.vencimento >= ${iniAno}::date AND i.vencimento < ${fimAno}::date GROUP BY 1, 2, 3, 4`,
    sql<{ id: number; unit_id: number; valor_mensal: number; inicio: string; fim: string | null; renovacao: string; fornecedor: string; objeto: string; conta_id: number | null; categoria: string }[]>`SELECT k.id, k.unit_id, k.valor_mensal::float, k.inicio::text, k.fim::text, k.renovacao, s.nome AS fornecedor, k.objeto, lp.conta_id, lp.categoria
      FROM contracts k JOIN suppliers s ON s.id=k.supplier_id JOIN LATERAL (SELECT p.conta_id, p.categoria FROM payables p WHERE p.contract_id=k.id AND p.status IN ('ATIVO','QUITADO') ORDER BY p.created_at DESC LIMIT 1) lp ON true
      WHERE k.status='VIGENTE' AND k.valor_mensal > 0 AND k.unit_id = ANY(${ids}::int[]) AND k.inicio < ${fimAno}::date AND (k.fim IS NULL OR k.fim >= ${iniAno}::date)`,
    sql<{ ano: number; tipo: string; fora: boolean; n: number; v: number; com_conta: number; meses: number }[]>`SELECT extract(year FROM data)::int AS ano, tipo, (tipo='TRANSFERENCIA' OR categoria = ANY(${[...internas, ...naoDespesa]})) AS fora, count(*)::int AS n, sum(valor)::float AS v, count(*) FILTER (WHERE conta_id IS NOT NULL)::int AS com_conta, count(DISTINCT date_trunc('month', data))::int AS meses
      FROM cash_entries WHERE data >= ${`${ano - 3}-01-01`}::date AND data < ${iniAno}::date AND unit_id = ANY(${ids}::int[]) GROUP BY 1, 2, 3 ORDER BY 1`,
    sql<{ unit_id: number; tipo: string; v: number }[]>`WITH cats AS (SELECT DISTINCT unit_id, tipo, categoria FROM budgets WHERE ano=${ano} UNION SELECT DISTINCT unit_id, tipo, categoria FROM budget_months WHERE ano=${ano})
      SELECT c.unit_id, c.tipo, sum(coalesce(bm.valor, b.valor_mensal))::float AS v FROM cats c CROSS JOIN generate_series(1, 12) AS ms(mes)
      LEFT JOIN budget_months bm ON bm.ano=${ano} AND bm.unit_id=c.unit_id AND bm.tipo=c.tipo AND bm.categoria=c.categoria AND bm.mes=ms.mes LEFT JOIN budgets b ON b.ano=${ano} AND b.unit_id=c.unit_id AND b.tipo=c.tipo AND b.categoria=c.categoria
      WHERE c.unit_id = ANY(${ids}::int[]) AND NOT (c.categoria = ANY(${[...internas, ...naoDespesa]})) GROUP BY 1, 2`,
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM budget_months WHERE ano=${ano} AND unit_id = ANY(${ids}::int[])`,
  ]);
  const movs = movsR.map(m => ({ ...m, unit_id: Number(m.unit_id), valor: Number(m.valor) }));
  const contasAttr: ContaAttr[] = contasAll.map(c => ({ id: c.id, codigo: c.codigo, nome: c.nome, tipo: c.tipo, categoria: c.categoria, tipo_economico: c.tipo_economico, comportamento: c.comportamento, recorrencia: c.recorrencia, indice: c.indice, driver: c.driver, custo: c.custo, ativo: c.ativo }));
  const contas = new Map(contasAttr.map(c => [c.id, c])); const porCat = atributosPorCategoria(contasAttr);
  const decisoesReg = new Map(decR.map(d => [Number(d.cash_entry_id), d])); const decisoes = new Map([...decisoesReg].map(([k, d]) => [k, d.decisao]));
  // 1 · higienização
  const { flags, auto } = detectarSinais(movs, { iniBase, fimBaseExcl, anoAlvo: ano, contas, porCat, internas, naoDespesa, outlierFator: p.outlierFator, outlierMinimo: p.outlierMinimo, eventoMinimo: p.eventoMinimo });
  const base = montarBase(movs, flags, auto, decisoes, { fimBase: p.fimBase, anoAlvo: ano, contas, porCat, nivelIpcaPct: p.nivelIpcaPct, nivelDissidioPct: p.nivelDissidioPct, nivelMensalidadePct: p.nivelMensalidadePct, mesDissidio: p.mesDissidio, mesReajusteMensalidade: p.mesReajusteMensalidade, fatorFerias: p.fatorFerias, mesesFerias: p.mesesFerias });
  const grupos = base.grupos.filter(g => g.n > 0);
  // 3 · pisos: contratos vigentes e títulos a pagar já assumidos no ano (operação do dia a dia), por conta — ou pela categoria quando o histórico ainda não tem conta
  const pisos = new Map<string, PisoChave>();
  if (p.usarContratos) {
    const chaves = new Set(grupos.map(g => g.chave));
    // peso do que ainda está sem conta em cada unidade × categoria: se a maior parte do histórico não tem conta, o contrato provavelmente
    // já está lá dentro (o piso vai para a categoria); se é só um resíduo, a conta do contrato ganha linha própria
    const somaCat = new Map<string, { sem: number; tot: number }>();
    for (const g of grupos) { if (g.tipo !== "SAIDA") continue; const k = `${g.unit_id}|${g.categoria}`; const x = somaCat.get(k) ?? { sem: 0, tot: 0 }; const v = g.limpo.reduce((a, b) => a + b, 0); x.tot += v; if (!g.conta_id) x.sem += v; somaCat.set(k, x); }
    const destino = (unit_id: number, conta_id: number | null, categoria: string) => {
      const c = conta_id ? contas.get(conta_id) : undefined; const cat = c?.categoria ?? categoria;
      const kConta = chaveGrupo({ unit_id, conta_id: c ? c.id : null, tipo: "SAIDA", categoria: cat }); if (chaves.has(kConta)) return { k: kConta, c, cat };
      const kCat = chaveGrupo({ unit_id, conta_id: null, tipo: "SAIDA", categoria: cat }); const pc = somaCat.get(`${unit_id}|${cat}`);
      if (chaves.has(kCat) && (!c || (pc && pc.tot > 0 && pc.sem >= 0.5 * pc.tot))) return { k: kCat, c: undefined, cat };
      return { k: kConta, c, cat };
    };
    const soma = new Map<string, { parc: number[]; ctr: number[]; origem: Set<string>; unit_id: number; conta_id: number | null; categoria: string; attr: AttrConta }>();
    const pega = (unit_id: number, conta_id: number | null, categoria: string) => {
      const d = destino(unit_id, conta_id, categoria); const x = soma.get(d.k) ?? { parc: Array(12).fill(0), ctr: Array(12).fill(0), origem: new Set<string>(), unit_id, conta_id: d.c ? d.c.id : null, categoria: d.cat, attr: d.c ? attrDaConta(d.c) : porCat.get(`SAIDA|${d.cat}`) ?? { indice: "IPCA", driver: "NENHUM", comportamento: "FIXO", recorrencia: "RECORRENTE", economico: "OPEX", custo: "INDIRETO" } };
      soma.set(d.k, x); return x;
    };
    for (const r of parcR) { const x = pega(Number(r.unit_id), r.conta_id, r.categoria); x.parc[r.mes - 1] += Number(r.valor); x.origem.add(`títulos a pagar: ${r.fornecedor}`); }
    for (const k of ctrR) {
      const x = pega(Number(k.unit_id), k.conta_id, k.categoria); const ate = k.fim && k.renovacao !== "AUTOMATICA" ? k.fim.slice(0, 7) : ym(ano, 12); let n = 0;
      for (let m = 1; m <= 12; m++) { const mes = ym(ano, m); if (mes >= k.inicio.slice(0, 7) && mes <= ate) { x.ctr[m - 1] += Number(k.valor_mensal); n++; } }
      if (n) x.origem.add(`contrato ${k.fornecedor} (${Number(k.valor_mensal).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/mês${k.fim && k.renovacao !== "AUTOMATICA" ? ` até ${rotuloMes(k.fim.slice(0, 7))}` : ""})`);
    }
    for (const [k, x] of soma) { const ms = x.parc.map((v, i) => Math.max(v, x.ctr[i])); if (ms.some(v => v > 0)) pisos.set(k, { meses: ms, origem: [...x.origem], tipo: "SAIDA", categoria: x.categoria, unit_id: x.unit_id, conta_id: x.conta_id, attr: x.attr }); }
  }
  // alunos: atuais e referências das matrículas do ano do orçamento (meta de ocupação, confirmadas, reservas, potencial)
  const alunosAtuais = new Map(alunosR.map(a => [Number(a.unit_id), a.n]));
  let mm: Awaited<ReturnType<typeof metasMatricula>> | null = null; try { mm = Number(cfg.matriculas.anoLetivo) === ano ? await metasMatricula(null) : null; } catch { mm = null; }
  const refsAlunos = new Map<number, RefAlunos>(ids.map(u => { const x = mm?.porUnidade.find(r => r.id === u); return [u, { atuais: alunosAtuais.get(u) ?? 0, confirmadas: x?.confirmadas ?? 0, reservas: x?.reservas ?? 0, meta: x?.metaMatriculas ?? null, potencial: x && Number.isFinite(x.potencial) ? x.potencial : null, vagas: x?.vagas ?? 0 }]; }));
  const alunosPadrao = new Map(ids.map(u => [u, refsAlunos.get(u)?.meta ?? alunosAtuais.get(u) ?? 0]));
  const pAlunos: ParamsHist = { ...p, alunosAlvo: Object.fromEntries(ids.map(u => [String(u), p.alunosAlvo[String(u)] ?? alunosPadrao.get(u) ?? 0])) };
  const versoes = {} as Record<Versao, { pv: ParamsVersao; linhas: LinhaProj[]; tot: ReturnType<typeof totais> }>;
  for (const v of VERSOES) {
    const pv = paramsDaVersao(pAlunos, v, ids, alunosAtuais);
    const linhas = projetar(grupos, meses, { anoAlvo: ano, fimBase: p.fimBase, mesDissidio: p.mesDissidio, mesReajusteMensalidade: p.mesReajusteMensalidade }, pv, alunosAtuais, pisos);
    versoes[v] = { pv, linhas, tot: totais(linhas, ids, pv.alunosAlvo) };
  }
  // lista de sinais (com o lançamento e a decisão)
  const porIdMov = new Map(movs.map(m => [m.id, m]));
  const sinais = [...flags.entries()].map(([id, f]) => ({ id, ...f, mov: porIdMov.get(id)!, decisao: decisoesReg.get(id) ?? null })).filter(x => x.mov).sort((a, b) => b.mov.valor - a.mov.valor);
  const naBase = (d: string) => d >= iniBase && d < fimBaseExcl;
  const autoBase = movs.filter(m => auto.has(m.id) && naBase(m.data)); const autoResumo = new Map<string, { n: number; v: number }>();
  for (const m of autoBase) { const r = auto.get(m.id)!; const x = autoResumo.get(r) ?? { n: 0, v: 0 }; x.n++; x.v += m.valor; autoResumo.set(r, x); }
  const movsBase = movs.filter(m => naBase(m.data) && m.tipo !== "TRANSFERENCIA");
  const semConta = movsBase.filter(m => !m.conta_id && !auto.has(m.id) && m.tipo === "SAIDA");
  const orcAtual = new Map<number, { receita: number; despesa: number }>();
  for (const r of orcR) { const x = orcAtual.get(Number(r.unit_id)) ?? { receita: 0, despesa: 0 }; if (r.tipo === "ENTRADA") x.receita += Number(r.v ?? 0); else x.despesa += Number(r.v ?? 0); orcAtual.set(Number(r.unit_id), x); }
  // folha aceita mais recente por unidade (referência para Pessoal)
  let folha = new Map<number, { mes: string; custo: number }>();
  try { const fr = [...(await custoRealPorUnidadeMes(ano - 1)), ...(await custoRealPorUnidadeMes(ano - 2))]; for (const f of fr) { const u = Number(f.unit_id); const x = folha.get(u); if (!x || f.mes > x.mes) folha.set(u, { mes: f.mes, custo: Number(f.custo) }); } } catch { folha = new Map(); }
  return {
    ano, plano, params: pAlunos, meses, iniBase, fimBaseExcl, unidades, alunosAtuais, refsAlunos, alunosPadrao, contas, contasAll, porCat,
    sinais, flags, decisoes: decisoesReg, auto: autoResumo, nAutoBase: autoBase.length, movsBase: movsBase.length, saidasBase: movsBase.filter(m => m.tipo === "SAIDA" && !auto.has(m.id)).reduce((a, m) => a + m.valor, 0),
    entradasBase: movsBase.filter(m => m.tipo === "ENTRADA" && !auto.has(m.id)).reduce((a, m) => a + m.valor, 0), semConta: { n: semConta.length, v: semConta.reduce((a, m) => a + m.valor, 0) },
    base: { ...base, grupos }, pisos, versoes, historico: histR, orcAtual, temOrcamentoMensal: (nBm[0]?.n ?? 0) > 0, folha,
  };
}
export type OrcHistorico = Awaited<ReturnType<typeof orcamentoPeloHistorico>>;
export type ItemSinal = OrcHistorico["sinais"][number];
export type { Flag, TotUnidade };
