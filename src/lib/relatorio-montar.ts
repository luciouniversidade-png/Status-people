/**
 * v30 · Relatório sob medida (no estilo dos construtores de relatório das plataformas de RH): a pessoa escolhe a FONTE, as colunas,
 * os filtros, o agrupamento (linhas × colunas), a métrica (contar, somar, média) e o gráfico — e salva ou compartilha a definição.
 * Segurança: só colunas e filtros desta lista (expressões fixas no código; nada do usuário vira SQL), escopo da unidade aplicado no
 * servidor, salário só para quem vê salário, sexo/idade/motivo de desligamento só para RH/Direção/direção da unidade, desempenho só
 * RH/Direção, CPF nunca. Compartilhar um relatório compartilha a DEFINIÇÃO: cada pessoa vê o resultado com o próprio acesso.
 */
import { sql } from "@/db";
import { can, scopeUnit, type Session } from "./auth";
import { VINCULO_LABEL, SITUACAO_LABEL, LEAVE_LABEL, LEAVE_STATUS, fmtData } from "./utils";
import { MOV_TIPO, QUALIF_NIVEL } from "./pessoas-v30";
import { COURSE_TIPO, COURSE_FORMATO, PROG_STATUS } from "./clima-academy";
import { BENEF_TIPOS_PADRAO, ADESAO_STATUS } from "./beneficios";

export type TipoCol = "texto" | "numero" | "data" | "moeda";
export type Restricao = "salario" | "pessoal" | "rh";
export type ColDef = { chave: string; rotulo: string; expr: string; tipo: TipoCol; rotulos?: Record<string, string>; agrupar?: boolean; somar?: boolean; restrito?: Restricao };
export type FiltroDef = { chave: string; rotulo: string; tipo: "multi" | "periodo" | "texto"; expr: string; opcoes?: Record<string, string> | "cargos" | "cursos" | "ciclos"; restrito?: Restricao; padrao?: string[] };
export type Fonte = { chave: string; nome: string; descricao: string; from: string; unidade: string; contar: string; cols: ColDef[]; filtros: FiltroDef[]; padrao: string[]; restrito?: Restricao };

const NIVEL = () => `CASE ${Object.entries(QUALIF_NIVEL).map(([k, v]) => `WHEN q.tipo='${k}' THEN ${v}`).join(" ")} END`;
const TITULACAO = `(SELECT CASE WHEN max(n) >= 6 THEN 'Doutorado' WHEN max(n) = 5 THEN 'Mestrado' WHEN max(n) = 4 THEN 'Especialização' WHEN max(n) = 3 THEN CASE WHEN bool_or(tipo = 'LICENCIATURA') THEN 'Licenciatura' ELSE 'Bacharelado ou tecnólogo' END WHEN max(n) IS NOT NULL THEN 'Nível médio ou técnico' ELSE 'Sem formação registrada' END
  FROM (SELECT q.tipo, ${NIVEL()} AS n FROM employee_qualifications q WHERE q.employee_id = e.id AND q.status = 'VALIDADA' AND NOT q.em_andamento) t WHERE n IS NOT NULL)`;
const CASA = "((coalesce(e.desligamento, current_date) - e.admissao) / 365.25)";
const REGIME: Record<string, string> = { DOCENTE: "Docente", ADMINISTRATIVO: "Administrativo" };
const SEXO: Record<string, string> = { F: "Feminino", M: "Masculino", NI: "Não informado" };
const ORIGEM_MOV: Record<string, string> = { FICHA: "Edição da ficha", MANUAL: "Lançamento manual", SISTEMA: "Sistema", SALARIO: "Histórico salarial" };
const NIVEL_9: Record<string, string> = { "1": "Baixo", "2": "Médio", "3": "Alto" };
const REVIEW: Record<string, string> = { PENDENTE: "Pendente", AUTOAVALIACAO: "Autoavaliação", AVALIADA: "Avaliada", CALIBRADA: "Calibrada", CONCLUIDA: "Concluída" };

const nome: ColDef = { chave: "nome", rotulo: "Colaborador", expr: "e.nome", tipo: "texto" };
const unidade: ColDef = { chave: "unidade", rotulo: "Unidade", expr: "u.nome", tipo: "texto", agrupar: true };
const cargo: ColDef = { chave: "cargo", rotulo: "Cargo", expr: "coalesce(p.nome, '(sem cargo)')", tipo: "texto", agrupar: true };
const fNome: FiltroDef = { chave: "nomeq", rotulo: "Nome contém", tipo: "texto", expr: "e.nome" };

export const FONTES: Fonte[] = [
  { chave: "colaboradores", nome: "Colaboradores", descricao: "Uma linha por pessoa: cadastro, cargo, vínculo, tempo de casa, titulação, gestor e CNPJ.", contar: "Pessoas",
    from: "employees e JOIN units u ON u.id = e.unit_id LEFT JOIN positions p ON p.id = e.position_id LEFT JOIN companies co ON co.id = e.company_id LEFT JOIN employees g ON g.id = e.gestor_id", unidade: "e.unit_id",
    padrao: ["nome", "unidade", "cargo", "vinculo", "admissao"],
    cols: [nome, unidade, cargo,
      { chave: "area", rotulo: "Área do cargo", expr: "coalesce(p.area, '—')", tipo: "texto", agrupar: true }, { chave: "familia", rotulo: "Família do cargo", expr: "coalesce(p.familia, '—')", tipo: "texto", agrupar: true },
      { chave: "nivel", rotulo: "Nível", expr: "coalesce(e.nivel, '—')", tipo: "texto", agrupar: true }, { chave: "vinculo", rotulo: "Vínculo", expr: "e.vinculo", tipo: "texto", rotulos: VINCULO_LABEL, agrupar: true },
      { chave: "regime", rotulo: "Regime", expr: "e.regime", tipo: "texto", rotulos: REGIME, agrupar: true }, { chave: "situacao", rotulo: "Situação", expr: "e.situacao", tipo: "texto", rotulos: SITUACAO_LABEL, agrupar: true },
      { chave: "empresa", rotulo: "CNPJ empregador", expr: "coalesce(co.nome, '(sem CNPJ)')", tipo: "texto", agrupar: true }, { chave: "gestor", rotulo: "Gestor direto", expr: "coalesce(g.nome, '(sem gestor)')", tipo: "texto", agrupar: true },
      { chave: "turno", rotulo: "Turno", expr: "coalesce(e.turno, '—')", tipo: "texto", agrupar: true },
      { chave: "admissao", rotulo: "Admissão", expr: "e.admissao", tipo: "data" }, { chave: "ano_admissao", rotulo: "Ano de admissão", expr: "extract(year FROM e.admissao)::int::text", tipo: "texto", agrupar: true },
      { chave: "desligamento", rotulo: "Desligamento", expr: "e.desligamento", tipo: "data" }, { chave: "motivo_desligamento", rotulo: "Motivo do desligamento", expr: "coalesce(e.motivo_desligamento, '—')", tipo: "texto", agrupar: true, restrito: "pessoal" },
      { chave: "tempo_casa", rotulo: "Tempo de casa (anos)", expr: `round(${CASA}::numeric, 1)::float`, tipo: "numero", somar: true },
      { chave: "faixa_casa", rotulo: "Faixa de tempo de casa", expr: `CASE WHEN ${CASA} < 1 THEN '1 · menos de 1 ano' WHEN ${CASA} < 3 THEN '2 · 1 a 3 anos' WHEN ${CASA} < 5 THEN '3 · 3 a 5 anos' WHEN ${CASA} < 10 THEN '4 · 5 a 10 anos' ELSE '5 · 10 anos ou mais' END`, tipo: "texto", agrupar: true },
      { chave: "idade", rotulo: "Idade", expr: "extract(year FROM age(e.data_nascimento))::int", tipo: "numero", somar: true, restrito: "pessoal" },
      { chave: "faixa_etaria", rotulo: "Faixa etária", expr: "CASE WHEN e.data_nascimento IS NULL THEN '9 · não informada' WHEN age(e.data_nascimento) < interval '25 years' THEN '1 · até 24' WHEN age(e.data_nascimento) < interval '35 years' THEN '2 · 25 a 34' WHEN age(e.data_nascimento) < interval '45 years' THEN '3 · 35 a 44' WHEN age(e.data_nascimento) < interval '55 years' THEN '4 · 45 a 54' ELSE '5 · 55 ou mais' END", tipo: "texto", agrupar: true, restrito: "pessoal" },
      { chave: "sexo", rotulo: "Sexo (eSocial)", expr: "coalesce(e.sexo, 'NI')", tipo: "texto", rotulos: SEXO, agrupar: true, restrito: "pessoal" },
      { chave: "jornada_h", rotulo: "Jornada (h/dia)", expr: "round((e.jornada_min_dia / 60.0)::numeric, 2)::float", tipo: "numero", somar: true },
      { chave: "salario", rotulo: "Salário-base", expr: "e.salario::float", tipo: "moeda", somar: true, restrito: "salario" },
      { chave: "titulacao", rotulo: "Maior titulação", expr: TITULACAO, tipo: "texto", agrupar: true },
      { chave: "email_inst", rotulo: "E-mail institucional", expr: "coalesce(e.email_institucional, '—')", tipo: "texto" }, { chave: "ramal", rotulo: "Ramal", expr: "coalesce(e.ramal, '—')", tipo: "texto" },
    ],
    filtros: [
      { chave: "situacao", rotulo: "Situação", tipo: "multi", expr: "e.situacao", opcoes: SITUACAO_LABEL, padrao: ["ATIVO", "FERIAS", "AFASTADO"] }, { chave: "vinculo", rotulo: "Vínculo", tipo: "multi", expr: "e.vinculo", opcoes: VINCULO_LABEL },
      { chave: "regime", rotulo: "Regime", tipo: "multi", expr: "e.regime", opcoes: REGIME }, { chave: "cargo", rotulo: "Cargo", tipo: "multi", expr: "e.position_id::text", opcoes: "cargos" },
      { chave: "sexo", rotulo: "Sexo", tipo: "multi", expr: "coalesce(e.sexo, 'NI')", opcoes: SEXO, restrito: "pessoal" },
      { chave: "admissao", rotulo: "Admitidos entre", tipo: "periodo", expr: "e.admissao" }, { chave: "desligamento", rotulo: "Desligados entre", tipo: "periodo", expr: "e.desligamento" }, fNome,
    ] },
  { chave: "ausencias", nome: "Férias e ausências", descricao: "Uma linha por pedido de férias, licença, folga ou afastamento (sem justificativa nem detalhe de saúde).", contar: "Registros",
    from: "leave_requests l JOIN employees e ON e.id = l.employee_id JOIN units u ON u.id = e.unit_id LEFT JOIN positions p ON p.id = e.position_id", unidade: "e.unit_id",
    padrao: ["nome", "unidade", "tipo", "inicio", "fim", "dias"],
    cols: [nome, unidade, cargo, { chave: "tipo", rotulo: "Tipo", expr: "l.tipo", tipo: "texto", rotulos: LEAVE_LABEL, agrupar: true }, { chave: "status", rotulo: "Situação", expr: "l.status", tipo: "texto", rotulos: LEAVE_STATUS, agrupar: true },
      { chave: "inicio", rotulo: "Início", expr: "l.inicio", tipo: "data" }, { chave: "fim", rotulo: "Fim", expr: "l.fim", tipo: "data" }, { chave: "mes", rotulo: "Mês de início", expr: "to_char(l.inicio, 'YYYY-MM')", tipo: "texto", agrupar: true },
      { chave: "dias", rotulo: "Dias", expr: "l.dias", tipo: "numero", somar: true }],
    filtros: [{ chave: "tipo", rotulo: "Tipo", tipo: "multi", expr: "l.tipo", opcoes: LEAVE_LABEL }, { chave: "status", rotulo: "Situação", tipo: "multi", expr: "l.status", opcoes: LEAVE_STATUS, padrao: ["APROVADA"] }, { chave: "inicio", rotulo: "Início entre", tipo: "periodo", expr: "l.inicio" }, fNome] },
  { chave: "treinamentos", nome: "Treinamentos", descricao: "Uma linha por pessoa × treinamento: situação, conclusão, validade e horas.", contar: "Registros",
    from: "training_progress t JOIN courses c ON c.id = t.course_id JOIN employees e ON e.id = t.employee_id JOIN units u ON u.id = e.unit_id LEFT JOIN positions p ON p.id = e.position_id", unidade: "e.unit_id",
    padrao: ["nome", "unidade", "curso", "status", "concluido_em"],
    cols: [nome, unidade, cargo, { chave: "curso", rotulo: "Treinamento", expr: "c.codigo || ' ' || c.titulo", tipo: "texto", agrupar: true }, { chave: "tipo_curso", rotulo: "Tipo", expr: "c.tipo", tipo: "texto", rotulos: COURSE_TIPO, agrupar: true },
      { chave: "formato", rotulo: "Formato", expr: "c.formato", tipo: "texto", rotulos: COURSE_FORMATO, agrupar: true }, { chave: "status", rotulo: "Situação", expr: "CASE WHEN t.status = 'CONCLUIDO' AND t.valido_ate < current_date THEN 'VENCIDO' ELSE t.status END", tipo: "texto", rotulos: PROG_STATUS, agrupar: true },
      { chave: "concluido_em", rotulo: "Concluído em", expr: "t.concluido_em", tipo: "data" }, { chave: "mes", rotulo: "Mês de conclusão", expr: "to_char(t.concluido_em, 'YYYY-MM')", tipo: "texto", agrupar: true },
      { chave: "valido_ate", rotulo: "Válido até", expr: "t.valido_ate", tipo: "data" }, { chave: "horas", rotulo: "Horas concluídas", expr: "(CASE WHEN t.status = 'CONCLUIDO' THEN coalesce(c.carga_horas, 0) ELSE 0 END)::float", tipo: "numero", somar: true }],
    filtros: [{ chave: "status", rotulo: "Situação", tipo: "multi", expr: "t.status", opcoes: PROG_STATUS }, { chave: "tipo_curso", rotulo: "Tipo", tipo: "multi", expr: "c.tipo", opcoes: COURSE_TIPO }, { chave: "curso", rotulo: "Treinamento", tipo: "multi", expr: "c.id::text", opcoes: "cursos" }, { chave: "concluido", rotulo: "Concluídos entre", tipo: "periodo", expr: "t.concluido_em" }, fNome] },
  { chave: "movimentacoes", nome: "Movimentações (histórico funcional)", descricao: "Admissões, promoções, transferências, mudanças de cargo, vínculo, gestor e jornada, e desligamentos — pela data em que valeram.", contar: "Movimentações",
    from: "employee_moves m JOIN employees e ON e.id = m.employee_id JOIN units u ON u.id = e.unit_id LEFT JOIN positions p ON p.id = e.position_id", unidade: "e.unit_id",
    padrao: ["nome", "unidade", "tipo", "data", "motivo"],
    cols: [nome, { ...unidade, rotulo: "Unidade atual" }, { ...cargo, rotulo: "Cargo atual" }, { chave: "tipo", rotulo: "Movimentação", expr: "m.tipo", tipo: "texto", rotulos: MOV_TIPO, agrupar: true }, { chave: "data", rotulo: "Data", expr: "m.data", tipo: "data" },
      { chave: "mes", rotulo: "Mês", expr: "to_char(m.data, 'YYYY-MM')", tipo: "texto", agrupar: true }, { chave: "ano", rotulo: "Ano", expr: "extract(year FROM m.data)::int::text", tipo: "texto", agrupar: true },
      { chave: "motivo", rotulo: "Motivo", expr: "coalesce(m.motivo, '—')", tipo: "texto", agrupar: true }, { chave: "origem", rotulo: "Origem do registro", expr: "m.origem", tipo: "texto", rotulos: ORIGEM_MOV, agrupar: true }],
    filtros: [{ chave: "tipo", rotulo: "Movimentação", tipo: "multi", expr: "m.tipo", opcoes: MOV_TIPO }, { chave: "data", rotulo: "Entre", tipo: "periodo", expr: "m.data" }, fNome] },
  { chave: "beneficios", nome: "Benefícios", descricao: "Uma linha por adesão: benefício, situação, dependentes, o que a escola paga e o desconto em folha.", contar: "Adesões", restrito: "salario",
    from: "benefit_enrollments b JOIN benefit_plans pl ON pl.id = b.plan_id JOIN employees e ON e.id = b.employee_id JOIN units u ON u.id = e.unit_id LEFT JOIN positions p ON p.id = e.position_id", unidade: "e.unit_id",
    padrao: ["nome", "unidade", "beneficio", "inicio", "valor_empresa", "valor_colab"],
    cols: [nome, unidade, cargo, { chave: "beneficio", rotulo: "Benefício", expr: "pl.nome", tipo: "texto", agrupar: true }, { chave: "tipo", rotulo: "Tipo", expr: "pl.tipo", tipo: "texto", rotulos: BENEF_TIPOS_PADRAO, agrupar: true },
      { chave: "status", rotulo: "Situação", expr: "b.status", tipo: "texto", rotulos: ADESAO_STATUS, agrupar: true }, { chave: "inicio", rotulo: "Início", expr: "b.inicio", tipo: "data" }, { chave: "fim", rotulo: "Fim", expr: "b.fim", tipo: "data" },
      { chave: "dependentes", rotulo: "Dependentes", expr: "b.dependentes", tipo: "numero", somar: true }, { chave: "valor_empresa", rotulo: "A escola paga (mês)", expr: "b.valor_empresa::float", tipo: "moeda", somar: true }, { chave: "valor_colab", rotulo: "Desconto em folha (mês)", expr: "b.valor_colab::float", tipo: "moeda", somar: true }],
    filtros: [{ chave: "status", rotulo: "Situação", tipo: "multi", expr: "b.status", opcoes: ADESAO_STATUS, padrao: ["ATIVO"] }, { chave: "tipo", rotulo: "Tipo", tipo: "multi", expr: "pl.tipo", opcoes: BENEF_TIPOS_PADRAO }, { chave: "inicio", rotulo: "Início entre", tipo: "periodo", expr: "b.inicio" }, fNome] },
  { chave: "desempenho", nome: "Desempenho (avaliações)", descricao: "Uma linha por avaliação: ciclo, situação, nota final, desempenho e potencial (Nine Box).", contar: "Avaliações", restrito: "rh",
    from: "perf_reviews r JOIN perf_cycles cy ON cy.id = r.cycle_id JOIN employees e ON e.id = r.employee_id JOIN units u ON u.id = e.unit_id LEFT JOIN positions p ON p.id = e.position_id", unidade: "e.unit_id",
    padrao: ["nome", "unidade", "ciclo", "nota", "desempenho", "potencial"],
    cols: [nome, unidade, cargo, { chave: "ciclo", rotulo: "Ciclo", expr: "cy.nome", tipo: "texto", agrupar: true }, { chave: "status", rotulo: "Situação", expr: "r.status", tipo: "texto", rotulos: REVIEW, agrupar: true },
      { chave: "nota", rotulo: "Nota final", expr: "round(coalesce((r.calc->>'N')::numeric, r.nota_final), 2)::float", tipo: "numero", somar: true },
      { chave: "desempenho", rotulo: "Desempenho (Nine Box)", expr: "r.desempenho_nivel::text", tipo: "texto", rotulos: NIVEL_9, agrupar: true }, { chave: "potencial", rotulo: "Potencial (Nine Box)", expr: "r.potencial::text", tipo: "texto", rotulos: NIVEL_9, agrupar: true }],
    filtros: [{ chave: "ciclo", rotulo: "Ciclo", tipo: "multi", expr: "cy.id::text", opcoes: "ciclos" }, { chave: "status", rotulo: "Situação", tipo: "multi", expr: "r.status", opcoes: REVIEW }, fNome] },
];
export const FONTE: Record<string, Fonte> = Object.fromEntries(FONTES.map(f => [f.chave, f]));

export function pode(s: Session, r: Restricao | undefined) {
  if (!r) return true; if (r === "salario") return can.verSalario(s); if (r === "rh") return can.verSensivel(s);
  return ["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role);
}
export const fontesDe = (s: Session) => FONTES.filter(f => pode(s, f.restrito));
export const colunasDe = (s: Session, f: Fonte) => f.cols.filter(c => pode(s, c.restrito)).map(c => (f.chave === "ausencias" && c.chave === "tipo" && !can.verSensivel(s) ? { ...c, rotulos: { ...LEAVE_LABEL, AFASTAMENTO_SAUDE: "Afastamento" } } : c));
export const filtrosDe = (s: Session, f: Fonte) => f.filtros.filter(x => pode(s, x.restrito));

export type Definicao = { fonte: string; colunas: string[]; filtros: Record<string, string[]>; periodos: Record<string, { de: string | null; ate: string | null }>; textos: Record<string, string>; linhas: string | null; colunasPor: string | null; metrica: string; ordem: "valor" | "rotulo"; grafico: boolean; unidade: number | null };

/** Lê a definição da URL (o formulário é GET: dá para salvar, compartilhar e voltar com o mesmo endereço). */
export function lerDefinicao(s: Session, sp: URLSearchParams): Definicao | { erro: string } {
  const fs = fontesDe(s); const f = FONTE[sp.get("fonte") ?? ""] && fs.some(x => x.chave === sp.get("fonte")) ? FONTE[sp.get("fonte")!] : fs[0];
  if (!f) return { erro: "Nenhuma fonte disponível para o seu acesso." };
  const cols = colunasDe(s, f); const okCol = new Set(cols.map(c => c.chave)); const agr = new Set(cols.filter(c => c.agrupar).map(c => c.chave)); const som = new Set(cols.filter(c => c.somar).map(c => c.chave));
  const gerado = sp.get("gerar") === "1";
  const colunas = (gerado ? sp.getAll("c") : f.padrao).filter(c => okCol.has(c));
  const filtros: Record<string, string[]> = {}; const periodos: Definicao["periodos"] = {}; const textos: Record<string, string> = {};
  for (const x of filtrosDe(s, f)) {
    if (x.tipo === "multi") { const v = (gerado ? sp.getAll(`f_${x.chave}`) : x.padrao ?? []).filter(v => /^[A-Za-z0-9_]{1,40}$/.test(v)).slice(0, 60); if (v.length) filtros[x.chave] = v; }
    if (x.tipo === "periodo") { const de = sp.get(`f_${x.chave}_de`), ate = sp.get(`f_${x.chave}_ate`); const ok = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null); if (ok(de) || ok(ate)) periodos[x.chave] = { de: ok(de), ate: ok(ate) }; }
    if (x.tipo === "texto") { const t = (sp.get(`f_${x.chave}`) ?? "").trim().slice(0, 60); if (t) textos[x.chave] = t; }
  }
  const linhas = sp.get("g") && agr.has(sp.get("g")!) ? sp.get("g")! : null; const colunasPor = linhas && sp.get("g2") && agr.has(sp.get("g2")!) && sp.get("g2") !== linhas ? sp.get("g2")! : null;
  const m = sp.get("m") ?? "contar"; const metrica = m === "contar" || (/^(somar|media):/.test(m) && som.has(m.split(":")[1])) ? m : "contar";
  const escopo = scopeUnit(s); const u = Number(sp.get("u")) || null;
  return { fonte: f.chave, colunas: colunas.length ? colunas : f.padrao.filter(c => okCol.has(c)), filtros, periodos, textos, linhas, colunasPor, metrica, ordem: sp.get("o") === "rotulo" ? "rotulo" : "valor", grafico: gerado ? sp.get("graf") === "1" : true, unidade: escopo ?? u };
}

const lit = (expr: string) => sql.unsafe(expr);
function onde(s: Session, f: Fonte, d: Definicao) {
  const partes = [sql`TRUE`]; const fl = filtrosDe(s, f);
  if (d.unidade) partes.push(sql`${lit(f.unidade)} = ${d.unidade}`);
  for (const x of fl) {
    if (x.tipo === "multi" && d.filtros[x.chave]?.length) partes.push(sql`${lit(x.expr)} = ANY(${d.filtros[x.chave]})`);
    if (x.tipo === "periodo" && d.periodos[x.chave]) { const p = d.periodos[x.chave]; if (p.de) partes.push(sql`${lit(x.expr)} >= ${p.de}::date`); if (p.ate) partes.push(sql`${lit(x.expr)} <= ${p.ate}::date`); }
    if (x.tipo === "texto" && d.textos[x.chave]) partes.push(sql`${lit(x.expr)} ILIKE ${"%" + d.textos[x.chave].replace(/[%_\\]/g, m => "\\" + m) + "%"}`);
  }
  return partes.reduce((a, b) => sql`${a} AND ${b}`);
}
const fmt = (c: ColDef, v: unknown): string | number | null => {
  if (v === null || v === undefined) return null;
  if (c.tipo === "data") return fmtData(String(v).slice(0, 10)); if (c.tipo === "numero") return Number(v);
  if (c.tipo === "moeda") return Math.round(Number(v) * 100) / 100;
  const t = String(v); const r = c.rotulos?.[t]; return r ?? t.replace(/^\d · /, "");
};

export type Resultado = { fonte: Fonte; colunas: ColDef[]; tabela: { cabecalho: string[]; linhas: (string | number | null)[][] }; total: number; agrupado: boolean; serie: { rotulo: string; valor: number; partes?: { rotulo: string; valor: number }[] }[]; metricaRotulo: string; tipoMetrica: TipoCol; limitado: boolean; descricaoFiltros: string };

export async function executar(s: Session, d: Definicao, limite = 5000): Promise<Resultado> {
  const f = FONTE[d.fonte]; const cols = colunasDe(s, f); const porChave = new Map(cols.map(c => [c.chave, c])); const w = onde(s, f, d);
  const [mt, mc] = d.metrica.split(":"); const colM = mc ? porChave.get(mc)! : null;
  const metricaRotulo = mt === "contar" ? f.contar : `${mt === "somar" ? "Soma" : "Média"} de ${colM!.rotulo.toLowerCase()}`; const tipoMetrica: TipoCol = colM?.tipo === "moeda" ? "moeda" : "numero";
  const agg = mt === "contar" ? lit("count(*)::float") : mt === "somar" ? sql`sum(${lit(colM!.expr)})::float` : sql`avg(${lit(colM!.expr)})::float`;
  const precisaDyn = filtrosDe(s, f).some(x => typeof x.opcoes === "string" && d.filtros[x.chave]?.length);
  const descricaoFiltros = descreverFiltros(s, f, d, precisaDyn ? await opcoesDinamicas() : {});
  if (!d.linhas) {
    const sel = d.colunas.map(k => porChave.get(k)!).filter(Boolean);
    const q = await sql<Record<string, unknown>[]>`SELECT ${lit(sel.map((c, i) => `${c.expr} AS c${i}`).join(", "))} FROM ${lit(f.from)} WHERE ${w} ORDER BY 1 LIMIT ${limite + 1}`;
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ${lit(f.from)} WHERE ${w}`;
    const linhas = q.slice(0, limite).map(r => sel.map((c, i) => fmt(c, r[`c${i}`])));
    const totM = mt === "contar" ? n : (await sql<{ v: number | null }[]>`SELECT ${agg} AS v FROM ${lit(f.from)} WHERE ${w}`)[0]?.v ?? 0;
    return { fonte: f, colunas: sel, tabela: { cabecalho: sel.map(c => c.rotulo), linhas }, total: Number(totM), agrupado: false, serie: [], metricaRotulo, tipoMetrica, limitado: q.length > limite, descricaoFiltros };
  }
  const g1 = porChave.get(d.linhas)!; const g2 = d.colunasPor ? porChave.get(d.colunasPor)! : null;
  const rows = g2
    ? await sql<{ a: unknown; b: unknown; v: number | null }[]>`SELECT ${lit(g1.expr)} AS a, ${lit(g2.expr)} AS b, ${agg} AS v FROM ${lit(f.from)} WHERE ${w} GROUP BY 1, 2`
    : await sql<{ a: unknown; b: unknown; v: number | null }[]>`SELECT ${lit(g1.expr)} AS a, NULL AS b, ${agg} AS v FROM ${lit(f.from)} WHERE ${w} GROUP BY 1`;
  const [{ v: totalGeral }] = await sql<{ v: number | null }[]>`SELECT ${agg} AS v FROM ${lit(f.from)} WHERE ${w}`;
  const rot = (c: ColDef, v: unknown) => String(fmt(c, v) ?? "(vazio)");
  const ordemBruta = (v: unknown) => (v === null || v === undefined ? "~" : String(v));
  const as = [...new Map(rows.map(r => [ordemBruta(r.a), r.a])).values()]; const bs = g2 ? [...new Map(rows.map(r => [ordemBruta(r.b), r.b])).values()].sort((x, y) => ordemBruta(x).localeCompare(ordemBruta(y), "pt-BR", { numeric: true })) : [];
  const valorA = (a: unknown) => { const xs = rows.filter(r => ordemBruta(r.a) === ordemBruta(a)); return mt === "media" ? (xs.length === 1 ? Number(xs[0].v ?? 0) : null) : xs.reduce((n, r) => n + Number(r.v ?? 0), 0); };
  // média com quebra: a média da linha vem de uma consulta própria (não é a média das médias)
  const mediasLinha = mt === "media" && g2 ? new Map((await sql<{ a: unknown; v: number | null }[]>`SELECT ${lit(g1.expr)} AS a, ${agg} AS v FROM ${lit(f.from)} WHERE ${w} GROUP BY 1`).map(r => [ordemBruta(r.a), Number(r.v ?? 0)])) : null;
  const totA = (a: unknown) => mediasLinha?.get(ordemBruta(a)) ?? valorA(a) ?? 0;
  as.sort((x, y) => (d.ordem === "rotulo" ? ordemBruta(x).localeCompare(ordemBruta(y), "pt-BR", { numeric: true }) : totA(y) - totA(x)));
  const cel = (a: unknown, b: unknown) => { const r = rows.find(x => ordemBruta(x.a) === ordemBruta(a) && ordemBruta(x.b) === ordemBruta(b)); return r ? Number(r.v ?? 0) : null; };
  const arred = (v: number | null) => (v === null ? null : tipoMetrica === "moeda" || mt === "media" ? Math.round(v * 100) / 100 : Math.round(v * 100) / 100);
  const cabecalho = g2 ? [g1.rotulo, ...bs.map(b => rot(g2, b)), "Total"] : [g1.rotulo, metricaRotulo, ...(mt === "media" ? [] : ["% do total"])];
  const tot = Number(totalGeral ?? 0);
  const linhas = as.slice(0, 500).map(a => g2 ? [rot(g1, a), ...bs.map(b => arred(cel(a, b))), arred(totA(a))] : [rot(g1, a), arred(totA(a)), ...(mt === "media" ? [] : [tot ? `${((100 * totA(a)) / tot).toFixed(1).replace(".", ",")}%` : "—"])]);
  const serie = as.slice(0, 30).map(a => ({ rotulo: rot(g1, a), valor: totA(a), partes: g2 && mt !== "media" ? bs.map(b => ({ rotulo: rot(g2, b), valor: cel(a, b) ?? 0 })) : undefined }));
  return { fonte: f, colunas: [g1, ...(g2 ? [g2] : [])], tabela: { cabecalho, linhas }, total: tot, agrupado: true, serie, metricaRotulo, tipoMetrica, limitado: as.length > 500, descricaoFiltros };
}

export function descreverFiltros(s: Session, f: Fonte, d: Definicao, dyn: Partial<Record<"cargos" | "cursos" | "ciclos", Record<string, string>>> = {}) {
  const xs: string[] = [];
  for (const x of filtrosDe(s, f)) {
    if (x.tipo === "multi" && d.filtros[x.chave]?.length) xs.push(`${x.rotulo}: ${d.filtros[x.chave].map(v => (typeof x.opcoes === "object" ? x.opcoes[v] ?? v : typeof x.opcoes === "string" ? dyn[x.opcoes]?.[v] ?? `#${v}` : v)).join(", ")}`);
    if (x.tipo === "periodo" && d.periodos[x.chave]) { const p = d.periodos[x.chave]; xs.push(`${x.rotulo} ${p.de ? fmtData(p.de) : "…"} e ${p.ate ? fmtData(p.ate) : "…"}`); }
    if (x.tipo === "texto" && d.textos[x.chave]) xs.push(`${x.rotulo} “${d.textos[x.chave]}”`);
  }
  return xs.join(" · ") || "sem filtros";
}

/** Query string canônica da definição (para salvar, compartilhar e exportar). */
export function paraQuery(d: Definicao) {
  const p = new URLSearchParams(); p.set("fonte", d.fonte); p.set("gerar", "1"); d.colunas.forEach(c => p.append("c", c));
  for (const [k, vs] of Object.entries(d.filtros)) vs.forEach(v => p.append(`f_${k}`, v));
  for (const [k, v] of Object.entries(d.periodos)) { if (v.de) p.set(`f_${k}_de`, v.de); if (v.ate) p.set(`f_${k}_ate`, v.ate); }
  for (const [k, v] of Object.entries(d.textos)) p.set(`f_${k}`, v);
  if (d.linhas) p.set("g", d.linhas); if (d.colunasPor) p.set("g2", d.colunasPor); if (d.metrica !== "contar") p.set("m", d.metrica); if (d.ordem === "rotulo") p.set("o", "rotulo"); if (d.grafico) p.set("graf", "1"); if (d.unidade) p.set("u", String(d.unidade));
  return p.toString();
}

export async function opcoesDinamicas() {
  const [cargos, cursos, ciclos] = await Promise.all([
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM positions ORDER BY nome`, sql<{ id: number; nome: string }[]>`SELECT id, codigo || ' ' || titulo AS nome FROM courses ORDER BY codigo`, sql<{ id: number; nome: string }[]>`SELECT id, nome FROM perf_cycles ORDER BY inicio DESC`,
  ]);
  const m = (xs: { id: number; nome: string }[]) => Object.fromEntries(xs.map(x => [String(x.id), x.nome]));
  return { cargos: m(cargos), cursos: m(cursos), ciclos: m(ciclos) } as Record<"cargos" | "cursos" | "ciclos", Record<string, string>>;
}

export function csvResultado(r: Resultado, titulo: string, carimbo: string) {
  const esc = (v: unknown) => { const x = v === null || v === undefined ? "" : typeof v === "number" ? String(v).replace(".", ",") : String(v); return /[;"\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  return "﻿" + [[titulo, carimbo].map(esc).join(";"), [`Filtros: ${r.descricaoFiltros}`].map(esc).join(";"), r.tabela.cabecalho.map(esc).join(";"), ...r.tabela.linhas.map(l => l.map(esc).join(";")), "", [r.metricaRotulo, r.total].map(esc).join(";")].join("\r\n");
}
