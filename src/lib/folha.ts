import { createHash } from "crypto";
import { sql } from "@/db";
import type { Session } from "./auth";
import { getSettings, hoje, LEAVE_LABEL } from "./utils";
import { custoLinha, encargosLinha, provisoesLinha, folhaEsperada, competenciaAnterior, type LinhaResultado } from "./folha-calc";

/**
 * Payroll Bridge — consultas e montagem do pacote (Nova Arquitetura, Cap. 25). Regras puras em folha-calc.ts.
 * Quem pode: RH prepara (pacote e arquivo); Financeiro confere a prévia e importa o resultado; Direção acompanha e decide exceções.
 */
export const podeFolha = (s: Session) => ["RH", "DIRECAO", "FINANCEIRO"].includes(s.role);
export const podePreparar = (s: Session) => ["RH", "DIRECAO"].includes(s.role);
export const podeConferir = (s: Session) => ["FINANCEIRO", "DIRECAO"].includes(s.role);
export const podeHolerites = (s: Session) => ["RH", "DIRECAO"].includes(s.role);

const fimDoMes = (mes: string) => { const [a, m] = mes.split("-").map(Number); return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10); };
const lim = (mes: string) => ({ ini: `${mes}-01`, fim: fimDoMes(mes) });

// ------------------------------------------------------------------ fechamento do ponto por unidade (passo 1)
export type LockRow = { id: number; unit_id: number; mes: string; status: string; fechado_por_nome: string | null; fechado_em: string; ressalva: string | null; motivo_reabertura: string | null; reaberto_em: string | null };
export async function locksDoMes(mes: string) {
  const rows = await sql<LockRow[]>`SELECT id, unit_id, mes, status, fechado_por_nome, fechado_em::text, ressalva, motivo_reabertura, reaberto_em::text FROM timesheet_locks WHERE mes=${mes}`;
  return new Map(rows.map(r => [r.unit_id, r]));
}
export async function mesFechado(unitId: number, data: string) {
  const [r] = await sql<{ status: string }[]>`SELECT status FROM timesheet_locks WHERE unit_id=${unitId} AND mes=${data.slice(0, 7)}`;
  return r?.status === "FECHADO";
}
/** Bloqueia escrita no ponto/banco de um mês já fechado na unidade do colaborador (CRQ-TMP-V3-04). */
export async function assertMesAberto(employeeId: number, datas: string[]) {
  const meses = [...new Set(datas.map(d => d.slice(0, 7)))]; if (!meses.length) return;
  const [r] = await sql<{ mes: string; unidade: string }[]>`SELECT l.mes, u.nome AS unidade FROM employees e JOIN timesheet_locks l ON l.unit_id=e.unit_id AND l.status='FECHADO' AND l.mes = ANY(${meses}) JOIN units u ON u.id=e.unit_id WHERE e.id=${employeeId} LIMIT 1`;
  if (r) throw new Error(`O ponto de ${r.mes.split("-").reverse().join("/")} está fechado na unidade ${r.unidade}. Para alterar, reabra o mês com justificativa (Ponto e jornada → Fechamento).`);
}
/** Pendências que impedem fechar o mês na unidade: quem não tem folha, quem não tem jornada e lançamentos do banco aguardando aprovação. */
export async function pendenciasFechamento(unitId: number, mes: string) {
  const { ini, fim } = lim(mes);
  const [r] = await sql<{ ativos: number; sem_folha: number; sem_jornada: number; pendentes: number }[]>`
    SELECT count(*)::int AS ativos,
      count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM timesheet_days t WHERE t.employee_id=e.id AND t.data BETWEEN ${ini} AND ${fim}))::int AS sem_folha,
      count(*) FILTER (WHERE e.jornada_min_dia IS NULL AND NOT EXISTS (SELECT 1 FROM schedules sc WHERE sc.employee_id=e.id AND sc.vigencia_inicio <= ${fim} AND (sc.vigencia_fim IS NULL OR sc.vigencia_fim >= ${ini})))::int AS sem_jornada,
      (SELECT count(*) FROM hour_entries h JOIN employees e2 ON e2.id=h.employee_id WHERE e2.unit_id=${unitId} AND h.status='PENDENTE' AND h.data BETWEEN ${ini} AND ${fim})::int AS pendentes
    FROM employees e WHERE e.unit_id=${unitId} AND e.situacao <> 'EM_ADMISSAO' AND e.admissao <= ${fim} AND (e.desligamento IS NULL OR e.desligamento >= ${ini}) AND (e.situacao <> 'DESLIGADO' OR e.desligamento >= ${ini})`;
  let divergencias = 0; try { const { abertasNoMes } = await import("./auditoria-ponto"); divergencias = await abertasNoMes(unitId, mes); } catch { /* banco anterior à v25 */ }
  return { ...r, divergencias, total: r.sem_folha + r.sem_jornada + r.pendentes + divergencias };
}

// ------------------------------------------------------------------ entidades e pessoas da competência
export type PessoaFolha = { id: number; nome: string; cpf: string | null; unit_id: number; unidade: string; cargo: string | null; area: string | null; vinculo: string; admissao: string; desligamento: string | null; motivo_desligamento: string | null; jornada_min_dia: number | null; salario: number | null };
/** Quem esteve no quadro da entidade (CNPJ empregador) em algum dia da competência, com o salário vigente no fim do mês. */
export async function pessoasDaEntidade(companyId: number, mes: string) {
  const { ini, fim } = lim(mes);
  return sql<PessoaFolha[]>`SELECT e.id, e.nome, e.cpf, e.unit_id, u.nome AS unidade, p.nome AS cargo, p.area, e.vinculo, e.admissao::text, e.desligamento::text, e.motivo_desligamento, e.jornada_min_dia,
      coalesce((SELECT sh.salario FROM salary_history sh WHERE sh.employee_id=e.id AND sh.data <= ${fim} ORDER BY sh.data DESC, sh.id DESC LIMIT 1),
               (SELECT sh.salario_anterior FROM salary_history sh WHERE sh.employee_id=e.id AND sh.data > ${fim} ORDER BY sh.data, sh.id LIMIT 1), e.salario)::float AS salario
    FROM employees e JOIN units u ON u.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id
    WHERE e.company_id=${companyId} AND e.situacao <> 'EM_ADMISSAO' AND e.admissao <= ${fim} AND (e.desligamento IS NULL OR e.desligamento >= ${ini}) AND (e.situacao <> 'DESLIGADO' OR e.desligamento IS NOT NULL)
    ORDER BY u.nome, e.nome`;
}
/** Unidades onde a entidade tem gente na competência (são as que precisam do ponto fechado para o pacote sair). */
export async function unidadesDaEntidade(companyId: number, mes: string) {
  const ps = await pessoasDaEntidade(companyId, mes);
  return [...new Map(ps.map(p => [p.unit_id, { id: p.unit_id, nome: p.unidade }])).values()].sort((a, b) => a.nome.localeCompare(b.nome));
}

export type Pendencias = { bloqueios: { texto: string; href: string }[]; avisos: { texto: string; href: string }[]; unidades: { id: number; nome: string; fechado: boolean; lock: LockRow | null }[]; pessoas: number };
/** Pendências que travam o pacote (padrão ADP: to-dos obrigatórios antes do envio) e avisos que não travam. */
export async function pendenciasPacote(companyId: number, mes: string): Promise<Pendencias> {
  const cfg = await getSettings(); const { ini, fim } = lim(mes);
  const [pessoas, locks] = await Promise.all([pessoasDaEntidade(companyId, mes), locksDoMes(mes)]);
  const unidades = [...new Map(pessoas.map(p => [p.unit_id, p.unidade])).entries()].map(([id, nome]) => ({ id, nome, lock: locks.get(id) ?? null, fechado: locks.get(id)?.status === "FECHADO" })).sort((a, b) => a.nome.localeCompare(b.nome));
  const ids = pessoas.map(p => p.id); const bloqueios: Pendencias["bloqueios"] = []; const avisos: Pendencias["avisos"] = [];
  const abertas = unidades.filter(u => !u.fechado);
  if (cfg.folha.exigirLockTodas && abertas.length) bloqueios.push({ texto: `Ponto de ${mes.split("-").reverse().join("/")} aberto em: ${abertas.map(u => u.nome).join(", ")}`, href: `/ponto?mes=${mes}#fechamento` });
  if (ids.length) {
    const [[hp], [lp], [ad], [semCpf], [semSal]] = await Promise.all([
      sql<{ n: number }[]>`SELECT count(*)::int AS n FROM hour_entries WHERE employee_id = ANY(${ids}) AND status='PENDENTE' AND data BETWEEN ${ini} AND ${fim}`,
      sql<{ n: number }[]>`SELECT count(*)::int AS n FROM leave_requests WHERE employee_id = ANY(${ids}) AND status='SOLICITADA' AND inicio <= ${fim} AND fim >= ${ini}`,
      sql<{ n: number }[]>`SELECT count(*)::int AS n FROM processes WHERE employee_id = ANY(${ids}) AND tipo='ADMISSAO' AND status='ABERTO'`,
      sql<{ n: number }[]>`SELECT count(*)::int AS n FROM employees WHERE id = ANY(${ids}) AND (cpf IS NULL OR cpf='')`,
      sql<{ n: number }[]>`SELECT count(*)::int AS n FROM employees WHERE id = ANY(${ids}) AND salario IS NULL`,
    ]);
    if (hp.n) bloqueios.push({ texto: `${hp.n} lançamento(s) do banco de horas do mês aguardando aprovação`, href: "/aprovacoes?aba=banco" });
    if (lp.n) bloqueios.push({ texto: `${lp.n} pedido(s) de férias/afastamento no mês sem decisão`, href: "/aprovacoes?aba=ferias" });
    if (ad.n) avisos.push({ texto: `${ad.n} admissão(ões) com checklist em aberto`, href: "/processos" });
    if (semCpf.n) avisos.push({ texto: `${semCpf.n} pessoa(s) sem CPF no cadastro`, href: "/colaboradores" });
    if (semSal.n) avisos.push({ texto: `${semSal.n} pessoa(s) sem salário cadastrado (ficam fora da folha esperada)`, href: "/colaboradores" });
  }
  const [orf] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM employees WHERE company_id IS NULL AND situacao IN ('ATIVO','FERIAS','AFASTADO')`;
  if (orf.n) avisos.push({ texto: `${orf.n} colaborador(es) ativo(s) sem CNPJ empregador — ficam fora de todos os pacotes`, href: "/colaboradores" });
  return { bloqueios, avisos, unidades, pessoas: pessoas.length };
}

// ------------------------------------------------------------------ pacote ao contador (passo 2)
export type PacoteFolha = {
  versao: 1; geradoEm: string; competencia: string; entidade: { id: number; nome: string; cnpj: string | null };
  unidades: { id: number; nome: string; fechadoEm: string | null; fechadoPor: string | null; ressalva: string | null }[];
  headcount: number; admissoes: Record<string, string | number | null>[]; desligamentos: Record<string, string | number | null>[]; afastamentos: Record<string, string | number | null>[];
  ferias: Record<string, string | number | null>[]; banco: Record<string, string | number | null>[]; horasExtras: Record<string, string | number | null>[]; faltas: Record<string, string | number | null>[];
  /** v30 · adesões, encerramentos e descontos de benefícios da competência (pacotes antigos não têm) */
  beneficios?: Record<string, string | number | null>[];
  semFonte: string[]; hash?: string;
};
const diasNoMes = (ini: string, fim: string, mIni: string, mFim: string) => { const a = ini > mIni ? ini : mIni; const b = fim < mFim ? fim : mFim; return a > b ? 0 : Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000) + 1; };
export async function montarPacote(companyId: number, mes: string): Promise<PacoteFolha> {
  const { ini, fim } = lim(mes);
  const [[ent], pessoas, locks] = await Promise.all([sql<{ id: number; nome: string; cnpj: string | null }[]>`SELECT id, nome, cnpj FROM companies WHERE id=${companyId}`, pessoasDaEntidade(companyId, mes), locksDoMes(mes)]);
  if (!ent) throw new Error("Entidade não encontrada.");
  const ids = pessoas.map(p => p.id); const por = new Map(pessoas.map(p => [p.id, p]));
  const base = (id: number) => { const p = por.get(id)!; return { nome: p.nome, cpf: p.cpf, unidade: p.unidade }; };
  const [leaves, banco, faltas] = ids.length ? await Promise.all([
    sql<{ employee_id: number; tipo: string; inicio: string; fim: string; dias: number; periodo_ref: string | null }[]>`SELECT employee_id, tipo, inicio::text, fim::text, dias, periodo_ref::text FROM leave_requests WHERE employee_id = ANY(${ids}) AND status='APROVADA' AND inicio <= ${fim} AND fim >= ${ini} ORDER BY inicio`,
    sql<{ employee_id: number; creditos: number; debitos: number; extras: number; saldo: number }[]>`SELECT h.employee_id, coalesce(sum(h.minutos) FILTER (WHERE h.minutos > 0 AND h.data BETWEEN ${ini} AND ${fim}),0)::int AS creditos, coalesce(-sum(h.minutos) FILTER (WHERE h.minutos < 0 AND h.data BETWEEN ${ini} AND ${fim}),0)::int AS debitos, coalesce(sum(h.minutos) FILTER (WHERE h.tipo='EXTRA' AND h.data BETWEEN ${ini} AND ${fim}),0)::int AS extras, coalesce(sum(h.minutos) FILTER (WHERE h.data <= ${fim}),0)::int AS saldo FROM hour_entries h WHERE h.employee_id = ANY(${ids}) AND h.status='APROVADO' GROUP BY h.employee_id`,
    sql<{ employee_id: number; faltas: number; abonados: number }[]>`SELECT employee_id, count(*) FILTER (WHERE status='FALTA')::int AS faltas, count(*) FILTER (WHERE status='ATESTADO')::int AS abonados FROM timesheet_days WHERE employee_id = ANY(${ids}) AND data BETWEEN ${ini} AND ${fim} GROUP BY employee_id`,
  ]) : [[], [], []];
  const { movimentosBeneficios } = await import("./beneficios"); const benef = await movimentosBeneficios(ids, ini, fim);
  const ex = (s: string | null | undefined) => s ? s.split("-").reverse().join("/") : null;
  const p: PacoteFolha = {
    versao: 1, geradoEm: new Date().toISOString(), competencia: mes, entidade: ent,
    unidades: [...new Set(pessoas.map(x => x.unit_id))].map(uid => { const l = locks.get(uid); return { id: uid, nome: pessoas.find(x => x.unit_id === uid)!.unidade, fechadoEm: l?.fechado_em ?? null, fechadoPor: l?.fechado_por_nome ?? null, ressalva: l?.ressalva ?? null }; }),
    headcount: pessoas.filter(x => !x.desligamento || x.desligamento > fim).length,
    admissoes: pessoas.filter(x => x.admissao >= ini && x.admissao <= fim).map(x => ({ ...base(x.id), cargo: x.cargo, admissao: ex(x.admissao), vinculo: x.vinculo, jornada_min_dia: x.jornada_min_dia, salario: x.salario })),
    desligamentos: pessoas.filter(x => x.desligamento && x.desligamento >= ini && x.desligamento <= fim).map(x => ({ ...base(x.id), cargo: x.cargo, desligamento: ex(x.desligamento), motivo: x.motivo_desligamento })),
    // tipo genérico: nenhum detalhe clínico sai no pacote (o contador recebe só o que a folha precisa)
    afastamentos: leaves.filter(l => l.tipo !== "FERIAS").map(l => ({ ...base(l.employee_id), tipo: l.tipo === "AFASTAMENTO_SAUDE" ? "Afastamento (atestado/INSS)" : LEAVE_LABEL[l.tipo] ?? l.tipo, inicio: ex(l.inicio), fim: ex(l.fim), dias_no_mes: diasNoMes(l.inicio, l.fim, ini, fim) })),
    ferias: leaves.filter(l => l.tipo === "FERIAS").map(l => ({ ...base(l.employee_id), inicio: ex(l.inicio), fim: ex(l.fim), dias: l.dias, dias_no_mes: diasNoMes(l.inicio, l.fim, ini, fim), periodo_aquisitivo: ex(l.periodo_ref) })),
    banco: banco.filter(b => b.creditos || b.debitos || b.saldo).map(b => ({ ...base(b.employee_id), creditos_min: b.creditos, debitos_min: b.debitos, saldo_acumulado_min: b.saldo })),
    horasExtras: banco.filter(b => b.extras > 0).map(b => ({ ...base(b.employee_id), extras_aprovadas_min: b.extras })),
    faltas: faltas.filter(f => f.faltas || f.abonados).map(f => ({ ...base(f.employee_id), faltas: f.faltas, dias_abonados: f.abonados })),
    beneficios: benef.map(b => ({ ...base(b.employee_id), beneficio: b.plano, movimento: b.movimento === "ADESAO" ? "Adesão" : b.movimento === "ENCERRAMENTO" ? "Encerramento" : "Desconto em folha", inicio: ex(b.inicio), fim: ex(b.fim), dependentes: b.dependentes, desconto_colaborador: b.valor_colab, custo_escola: b.valor_empresa })),
    semFonte: ["Pensões alimentícias e descontos autorizados: não há registro no sistema — informe ao contador por fora.", "Horas extras: no regime de banco de horas viram crédito; pague apenas o que estiver combinado (a lista vai para conferência)."],
  };
  p.hash = createHash("sha256").update(JSON.stringify({ ...p, geradoEm: null })).digest("hex").slice(0, 16);
  return p;
}
/** Pacote em CSV (seções separadas por título), pronto para o contador. */
export function pacoteCsv(p: PacoteFolha) {
  const linhas: string[] = []; const esc = (v: unknown) => { const t = v === null || v === undefined ? "" : String(v); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const secao = (titulo: string, itens: Record<string, unknown>[]) => { linhas.push(""); linhas.push(`## ${titulo} (${itens.length})`); if (!itens.length) { linhas.push("nenhum"); return; } const cols = Object.keys(itens[0]); linhas.push(cols.join(";")); for (const it of itens) linhas.push(cols.map(c => esc(it[c])).join(";")); };
  linhas.push(`Pacote da folha;${p.competencia.split("-").reverse().join("/")}`); linhas.push(`Entidade;${esc(p.entidade.nome)};CNPJ;${esc(p.entidade.cnpj ?? "")}`); linhas.push(`Gerado em;${p.geradoEm};Conferência (hash);${p.hash ?? ""}`); linhas.push(`Headcount no fim do mês;${p.headcount}`);
  linhas.push(`Ponto fechado;${p.unidades.map(u => `${u.nome} ${u.fechadoEm ? `em ${u.fechadoEm.slice(0, 10)}` : "ABERTO"}${u.ressalva ? ` (ressalva: ${u.ressalva})` : ""}`).join(" | ")}`);
  secao("Admissões", p.admissoes); secao("Desligamentos", p.desligamentos); secao("Afastamentos e licenças", p.afastamentos); secao("Férias", p.ferias);
  secao("Banco de horas (minutos aprovados)", p.banco); secao("Horas extras aprovadas (minutos)", p.horasExtras); secao("Faltas e dias abonados", p.faltas); if (p.beneficios) secao("Benefícios (adesões, encerramentos e descontos)", p.beneficios);
  linhas.push(""); linhas.push("## Sem fonte no sistema"); p.semFonte.forEach(t => linhas.push(esc(t)));
  return "﻿" + linhas.join("\r\n");
}

// ------------------------------------------------------------------ ciclo
export type Ciclo = { id: number; competencia: string; company_id: number; status: string; pacote: PacoteFolha | null; pacote_em: string | null; pacote_por: number | null; pacote_por_nome: string | null; previa: Previa | null; conferencia: Conferencia | null; conferido_em: string | null; conferido_por: number | null; conferido_por_nome: string | null; resultado_em: string | null; resultado_por_nome: string | null; total: number | null; total_anterior: number | null; variacao_pct: number | null; aceito_em: string | null; arquivado_em: string | null; obs: string | null };
export type Previa = { headcount: number | null; proventos: number | null; encargos: number | null; informadaEm: string; por: string };
export type Conferencia = { headcountOk: boolean | null; amostra: { employee_id: number; nome: string; ok: boolean | null; obs: string | null }[]; resultado: "APROVADA" | "DEVOLVIDA" | null; esperado: { proventos: number; encargos: number; total: number; headcountFim: number; semSalario: number } | null };
const COLS_CICLO = sql`id, competencia, company_id, status, pacote, pacote_em::text, pacote_por, pacote_por_nome, previa, conferencia, conferido_em::text, conferido_por, conferido_por_nome, resultado_em::text, resultado_por_nome, total::float, total_anterior::float, variacao_pct::float, aceito_em::text, arquivado_em::text, obs`;
export async function cicloPorId(id: number) { const [c] = await sql<Ciclo[]>`SELECT ${COLS_CICLO} FROM payroll_cycles WHERE id=${id}`; return c ?? null; }
export async function ciclosDaCompetencia(mes: string) { return sql<Ciclo[]>`SELECT ${COLS_CICLO} FROM payroll_cycles WHERE competencia=${mes}`; }
export async function garantirCiclo(companyId: number, mes: string) {
  const [c] = await sql<{ id: number }[]>`INSERT INTO payroll_cycles (competencia, company_id) VALUES (${mes}, ${companyId}) ON CONFLICT (competencia, company_id) DO UPDATE SET updated_at=payroll_cycles.updated_at RETURNING id`;
  return c.id;
}
export async function eventoFolha(cycleId: number | null, mes: string, companyId: number | null, s: Session | null, tipo: string, texto: string) {
  await sql`INSERT INTO payroll_events (cycle_id, competencia, company_id, user_id, user_nome, tipo, texto) VALUES (${cycleId}, ${mes}, ${companyId}, ${s?.id ?? null}, ${s?.nome ?? "sistema"}, ${tipo}, ${texto})`;
}
/** Linhas do resultado importado do ciclo, com o custo de cada uma. */
export async function resultadoDoCiclo(cycleId: number) {
  const rows = await sql<(LinhaResultado & { id: number })[]>`SELECT r.id, u.nome AS unidade, r.unit_id, r.area, r.headcount, r.salarios::float, r.inss::float, r.fgts::float, r.irrf::float, r.provisao_13::float, r.provisao_ferias::float, r.beneficios::float, r.rescisoes::float, r.outros::float FROM payroll_results r LEFT JOIN units u ON u.id=r.unit_id WHERE r.cycle_id=${cycleId} ORDER BY u.nome NULLS LAST, r.area NULLS LAST`;
  const total = rows.reduce((a, r) => a + custoLinha(r), 0);
  return { rows, total: rows.length ? Math.round(total * 100) / 100 : null, encargos: rows.reduce((a, r) => a + encargosLinha(r), 0), provisoes: rows.reduce((a, r) => a + provisoesLinha(r), 0), headcount: rows.some(r => r.headcount !== null) ? rows.reduce((a, r) => a + (r.headcount ?? 0), 0) : null };
}
/** Total aceito (REAL) da entidade na competência — base da variação do mês seguinte. */
export async function totalAceito(companyId: number, mes: string): Promise<number | null> {
  const [c] = await sql<{ id: number }[]>`SELECT id FROM payroll_cycles WHERE company_id=${companyId} AND competencia=${mes} AND aceito_em IS NOT NULL`;
  if (!c) return null; return (await resultadoDoCiclo(c.id)).total;
}
export async function totalAnteriorAceito(companyId: number, mes: string) { return totalAceito(companyId, competenciaAnterior(mes)); }

/** Folha esperada da entidade pelo cadastro (estimativa da conferência). */
export async function esperadaDaEntidade(companyId: number, mes: string) {
  const cfg = await getSettings(); const ps = await pessoasDaEntidade(companyId, mes);
  return { ...folhaEsperada(ps, mes, Number(cfg.financeiro.encargosPct)), pessoas: ps };
}

/**
 * Custo REAL de pessoal (resultado aceito) por unidade e mês — só ciclos aceitos entram. Linha sem unidade fica em unit_id 0.
 * Alimenta a DRE (substitui as saídas de caixa "Pessoal" e "Encargos e benefícios" do mês/unidade) e o KPI-13.
 */
export async function custoRealPorUnidadeMes(ano: number) {
  const rows = await sql<{ mes: string; unit_id: number; custo: number; encargos: number; provisoes: number; headcount: number | null }[]>`
    SELECT c.competencia AS mes, coalesce(r.unit_id, 0) AS unit_id, sum(r.salarios + r.inss + r.fgts + r.provisao_13 + r.provisao_ferias + r.beneficios + r.rescisoes + r.outros)::float AS custo,
      sum(r.inss + r.fgts)::float AS encargos, sum(r.provisao_13 + r.provisao_ferias)::float AS provisoes, sum(r.headcount)::int AS headcount
    FROM payroll_cycles c JOIN payroll_results r ON r.cycle_id=c.id WHERE c.aceito_em IS NOT NULL AND c.competencia LIKE ${`${ano}-%`} GROUP BY 1, 2`;
  return rows;
}

/** Linha do tempo C13: estado dos 5 passos de cada entidade nos últimos N meses. */
export async function timelineFolha(meses: string[]) {
  const [ciclos, locks] = await Promise.all([
    sql<{ competencia: string; company_id: number; status: string }[]>`SELECT competencia, company_id, status FROM payroll_cycles WHERE competencia = ANY(${meses})`,
    sql<{ mes: string; n: number }[]>`SELECT mes, count(*) FILTER (WHERE status='FECHADO')::int AS n FROM timesheet_locks WHERE mes = ANY(${meses}) GROUP BY mes`,
  ]);
  return { ciclos, locks: new Map(locks.map(l => [l.mes, l.n])) };
}

/** Competência padrão da tela: a mais antiga dos últimos 3 meses que ainda não está completa em todas as entidades; senão o mês anterior. */
export async function competenciaPadrao() {
  const h = hoje().slice(0, 7); const ms = [competenciaAnterior(competenciaAnterior(h)), competenciaAnterior(h), h];
  const [{ n: ents }] = await sql<{ n: number }[]>`SELECT count(DISTINCT company_id)::int AS n FROM employees WHERE company_id IS NOT NULL`;
  const feitos = await sql<{ competencia: string; n: number }[]>`SELECT competencia, count(*)::int AS n FROM payroll_cycles WHERE competencia = ANY(${ms}) AND status='ARQUIVADO' GROUP BY 1`;
  const algum = await sql<{ competencia: string }[]>`SELECT DISTINCT competencia FROM payroll_cycles WHERE competencia = ANY(${ms})`;
  for (const m of ms) if (algum.some(a => a.competencia === m) && (feitos.find(f => f.competencia === m)?.n ?? 0) < ents) return m;
  return competenciaAnterior(h);
}

// ------------------------------------------------------------------ T-056 · custo de folha por dimensão (só resultado aceito)
export type LinhaCusto = { competencia: string; company_id: number; entidade: string; unit_id: number | null; unidade: string | null; area: string | null; headcount: number | null; salarios: number; encargos: number; provisao_13: number; provisao_ferias: number; beneficios: number; rescisoes: number; outros: number; custo: number };
export async function custosAceitos(meses: string[], filtro: { companyId: number | null; unitId: number | null }) {
  return sql<LinhaCusto[]>`SELECT c.competencia, c.company_id, co.nome AS entidade, r.unit_id, u.nome AS unidade, r.area, r.headcount, r.salarios::float, (r.inss + r.fgts)::float AS encargos, r.provisao_13::float, r.provisao_ferias::float, r.beneficios::float, r.rescisoes::float, r.outros::float,
      (r.salarios + r.inss + r.fgts + r.provisao_13 + r.provisao_ferias + r.beneficios + r.rescisoes + r.outros)::float AS custo
    FROM payroll_cycles c JOIN payroll_results r ON r.cycle_id=c.id JOIN companies co ON co.id=c.company_id LEFT JOIN units u ON u.id=r.unit_id
    WHERE c.aceito_em IS NOT NULL AND c.competencia = ANY(${meses}) ${filtro.companyId ? sql`AND c.company_id=${filtro.companyId}` : sql``} ${filtro.unitId ? sql`AND r.unit_id=${filtro.unitId}` : sql``}`;
}
/** Receita de caixa por mês nas unidades do recorte (para a folha ÷ receita — KPI-13). */
export async function receitaPorMes(meses: string[], unitIds: number[] | null) {
  if (unitIds && !unitIds.length) return new Map<string, number>();
  const rows = await sql<{ mes: string; v: number }[]>`SELECT to_char(data, 'YYYY-MM') AS mes, sum(valor)::float AS v FROM cash_entries WHERE tipo='ENTRADA' AND to_char(data, 'YYYY-MM') = ANY(${meses}) ${unitIds ? sql`AND unit_id = ANY(${unitIds})` : sql``} GROUP BY 1`;
  return new Map(rows.map(r => [r.mes, r.v]));
}
