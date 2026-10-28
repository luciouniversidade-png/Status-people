/**
 * v30 · Ficha completa e estrutura: histórico funcional (movimentações), formação e qualificações, itens sob responsabilidade
 * e o organograma de pessoas (quem responde a quem). Funções puras primeiro (testáveis), depois as que leem o banco.
 */
import { sql } from "@/db";
import type { Session } from "./session";

// ------------------------------------------------------------------ histórico funcional
export const MOV_TIPO: Record<string, string> = {
  ADMISSAO: "Admissão", PROMOCAO: "Promoção", MUDANCA_CARGO: "Mudança de cargo", MUDANCA_NIVEL: "Mudança de nível", TRANSFERENCIA: "Transferência",
  EFETIVACAO: "Efetivação", MUDANCA_VINCULO: "Mudança de vínculo", MUDANCA_GESTOR: "Mudança de gestor", MUDANCA_JORNADA: "Mudança de jornada ou turno",
  READMISSAO: "Readmissão", DESLIGAMENTO: "Desligamento",
};
/** Tipos que a pessoa pode lançar à mão (fatos passados, antes do sistema). */
export const MOV_MANUAIS = ["PROMOCAO", "MUDANCA_CARGO", "MUDANCA_NIVEL", "TRANSFERENCIA", "EFETIVACAO", "MUDANCA_VINCULO", "MUDANCA_GESTOR", "MUDANCA_JORNADA", "READMISSAO"];
export const MOV_TOM: Record<string, string> = { ADMISSAO: "ATIVO", READMISSAO: "ATIVO", PROMOCAO: "APROVADA", EFETIVACAO: "APROVADA", TRANSFERENCIA: "EM_ADMISSAO", DESLIGAMENTO: "DESLIGADO" };
export const MOTIVOS_MOV = ["Promoção por mérito", "Abertura de vaga interna", "Reestruturação", "Necessidade da escola", "A pedido do colaborador", "Fim do período de experiência", "Término do estágio", "Ajuste de jornada (grade de aulas)", "Correção de cadastro", "Outro"];

/** Campos da ficha que formam o histórico funcional (com o nome legível ao lado do id). */
export type EstadoFicha = { unitId: number | null; unidade?: string | null; positionId: number | null; cargo?: string | null; nivel: string | null; gestorId: number | null; gestor?: string | null; vinculo: string | null; jornadaMinDia: number | null; turno: string | null; regime: string | null; companyId: number | null; empresa?: string | null };
const CAMPOS: (keyof EstadoFicha)[] = ["unitId", "positionId", "nivel", "gestorId", "vinculo", "jornadaMinDia", "turno", "regime", "companyId"];
const NOMES: Partial<Record<keyof EstadoFicha, keyof EstadoFicha>> = { unitId: "unidade", positionId: "cargo", gestorId: "gestor", companyId: "empresa" };
const PRAZO_DETERMINADO = new Set(["ESTAGIARIO", "TEMPORARIO"]);
const igual = (a: unknown, b: unknown) => (a ?? null) === (b ?? null) || String(a ?? "") === String(b ?? "");

/**
 * O que mudou entre dois estados da ficha e como chamar a mudança. Um evento só (a edição inteira), classificado pela
 * mudança mais importante: promoção (quando marcada) › transferência › cargo › nível › efetivação/vínculo › gestor › jornada.
 */
export function classificarMovimentacao(de: EstadoFicha, para: EstadoFicha, promocao = false): { tipo: string; campos: (keyof EstadoFicha)[]; de: Partial<EstadoFicha>; para: Partial<EstadoFicha> } | null {
  const campos = CAMPOS.filter(c => !igual(de[c], para[c])); if (!campos.length) return null;
  const tem = (c: keyof EstadoFicha) => campos.includes(c);
  const tipo = promocao && (tem("positionId") || tem("nivel")) ? "PROMOCAO"
    : tem("unitId") || tem("companyId") ? "TRANSFERENCIA"
    : tem("positionId") ? "MUDANCA_CARGO"
    : tem("nivel") ? "MUDANCA_NIVEL"
    : tem("vinculo") ? (PRAZO_DETERMINADO.has(String(de.vinculo)) && para.vinculo === "CLT" ? "EFETIVACAO" : "MUDANCA_VINCULO")
    : tem("gestorId") ? "MUDANCA_GESTOR" : "MUDANCA_JORNADA";
  const recorte = (e: EstadoFicha) => { const o: Partial<EstadoFicha> = {}; for (const c of campos) { (o as Record<string, unknown>)[c] = e[c] ?? null; const n = NOMES[c]; if (n) (o as Record<string, unknown>)[n] = e[n] ?? null; } return o; };
  return { tipo, campos, de: recorte(de), para: recorte(para) };
}

/** “Cargo: Auxiliar → Analista · Unidade: Carandá → Cultura” (só o que mudou, com os nomes). */
export function descreverMudanca(de: Record<string, unknown> | null, para: Record<string, unknown> | null): string {
  if (!para) return "";
  const rot: [string, string, string | null][] = [["positionId", "Cargo", "cargo"], ["nivel", "Nível", null], ["unitId", "Unidade", "unidade"], ["companyId", "Empresa", "empresa"], ["gestorId", "Gestor", "gestor"], ["vinculo", "Vínculo", null], ["jornadaMinDia", "Jornada", null], ["turno", "Turno", null], ["regime", "Regime", null]];
  const fmt = (o: Record<string, unknown> | null, k: string, n: string | null) => { if (!o || !(k in o)) return null; const v = n ? o[n] ?? o[k] : o[k]; if (v === null || v === undefined || v === "") return "—"; if (k === "jornadaMinDia") { const m = Number(v); return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`; } return String(v); };
  return rot.filter(([k]) => k in para).map(([k, r, n]) => `${r}: ${fmt(de, k, n) ?? "—"} → ${fmt(para, k, n) ?? "—"}`).join(" · ");
}

/**
 * Estado da ficha numa data passada: parte do estado atual e desfaz, da mais nova para a mais antiga, as movimentações
 * posteriores à data (cada uma guarda o “de” do que mudou). Base do “quadro numa data”.
 */
export function estadoNaData<T extends Partial<EstadoFicha>>(atual: T, moves: { data: string; id?: number; de: Record<string, unknown> | null }[], data: string): T {
  const e: Record<string, unknown> = { ...atual };
  const posteriores = moves.filter(m => m.data > data && m.de).sort((a, b) => (a.data === b.data ? (b.id ?? 0) - (a.id ?? 0) : a.data < b.data ? 1 : -1));
  for (const m of posteriores) for (const [k, v] of Object.entries(m.de!)) e[k] = v;
  return e as T;
}

/** Grava a movimentação de uma edição da ficha (nada muda = nada grava). Os nomes saem do banco para o histórico ficar legível mesmo se o cargo mudar de nome. */
export async function registrarMovimentacao(s: Session | null, employeeId: number, de: EstadoFicha, para: EstadoFicha, opt: { data: string; promocao?: boolean; motivo?: string | null; obs?: string | null; origem?: string }): Promise<string | null> {
  const nomes = async (e: EstadoFicha): Promise<EstadoFicha> => {
    const [r] = await sql<{ unidade: string | null; cargo: string | null; gestor: string | null; empresa: string | null }[]>`SELECT (SELECT nome FROM units WHERE id=${e.unitId}) AS unidade, (SELECT nome FROM positions WHERE id=${e.positionId}) AS cargo, (SELECT nome FROM employees WHERE id=${e.gestorId}) AS gestor, (SELECT nome FROM companies WHERE id=${e.companyId}) AS empresa`;
    return { ...e, ...r };
  };
  const c = classificarMovimentacao(de, para, !!opt.promocao); if (!c) return null;
  const [a, b] = await Promise.all([nomes(de), nomes(para)]); const cc = classificarMovimentacao(a, b, !!opt.promocao)!;
  await sql`INSERT INTO employee_moves (employee_id, data, tipo, motivo, de, para, obs, origem, user_id, user_nome) VALUES (${employeeId}, ${opt.data}, ${cc.tipo}, ${opt.motivo ?? null}, ${JSON.stringify(cc.de)}::jsonb, ${JSON.stringify(cc.para)}::jsonb, ${opt.obs ?? null}, ${opt.origem ?? "FICHA"}, ${s?.id ?? null}, ${s?.nome ?? "sistema"})`;
  return cc.tipo;
}
export const estadoDe = (e: { unitId: number; positionId: number | null; nivel: string | null; gestorId: number | null; vinculo: string; jornadaMinDia: number | null; turno: string | null; regime: string; companyId: number | null }): EstadoFicha =>
  ({ unitId: e.unitId, positionId: e.positionId ?? null, nivel: e.nivel ?? null, gestorId: e.gestorId ?? null, vinculo: e.vinculo, jornadaMinDia: e.jornadaMinDia ?? null, turno: e.turno ?? null, regime: e.regime, companyId: e.companyId ?? null });

/** Movimentações da rede num período (para a composição e a ponte do quadro). */
export async function movimentacoesPeriodo(unitId: number | null, de: string, ate: string) {
  return sql<{ id: number; employee_id: number; data: string; tipo: string; de: Record<string, unknown> | null; para: Record<string, unknown> | null; unit_id: number }[]>`
    SELECT m.id, m.employee_id, m.data::text, m.tipo, m.de, m.para, e.unit_id FROM employee_moves m JOIN employees e ON e.id=m.employee_id
    WHERE m.data > ${de}::date AND m.data <= ${ate}::date ${unitId === null ? sql`` : sql`AND (e.unit_id=${unitId} OR (m.de->>'unitId')::int=${unitId} OR (m.para->>'unitId')::int=${unitId})`} ORDER BY m.data, m.id`;
}

// ------------------------------------------------------------------ formação e qualificações
export const QUALIF_TIPO: Record<string, string> = {
  ENSINO_MEDIO: "Ensino médio", MAGISTERIO: "Magistério (nível médio)", TECNICO: "Curso técnico", TECNOLOGO: "Graduação tecnológica", BACHARELADO: "Bacharelado", LICENCIATURA: "Licenciatura",
  ESPECIALIZACAO: "Especialização (pós lato sensu)", MBA: "MBA", MESTRADO: "Mestrado", DOUTORADO: "Doutorado",
  CURSO_LIVRE: "Curso livre / extensão", IDIOMA: "Idioma", CERTIFICACAO: "Certificação", REGISTRO: "Registro profissional",
};
/** Ordem da titulação (curso livre, idioma, certificação e registro não são titulação). */
export const QUALIF_NIVEL: Record<string, number> = { ENSINO_MEDIO: 1, MAGISTERIO: 2, TECNICO: 2, TECNOLOGO: 3, BACHARELADO: 3, LICENCIATURA: 3, ESPECIALIZACAO: 4, MBA: 4, MESTRADO: 5, DOUTORADO: 6 };
export const TITULACAO_FAIXAS = ["Doutorado", "Mestrado", "Especialização", "Licenciatura", "Bacharelado ou tecnólogo", "Nível médio ou técnico", "Sem formação registrada"];
/** Maior titulação concluída e validada (em andamento não conta). Licenciatura ganha do bacharelado no mesmo nível (formação docente). */
export function maiorTitulacao(qs: { tipo: string; status: string; emAndamento?: boolean | null; em_andamento?: boolean | null }[]): string {
  const ok = qs.filter(q => q.status === "VALIDADA" && !(q.emAndamento ?? q.em_andamento) && QUALIF_NIVEL[q.tipo]);
  if (!ok.length) return "Sem formação registrada";
  const n = Math.max(...ok.map(q => QUALIF_NIVEL[q.tipo]));
  if (n >= 6) return "Doutorado"; if (n === 5) return "Mestrado"; if (n === 4) return "Especialização";
  if (n === 3) return ok.some(q => q.tipo === "LICENCIATURA") ? "Licenciatura" : "Bacharelado ou tecnólogo";
  return "Nível médio ou técnico";
}
/** Tem licenciatura concluída (com ou sem pós)? — formação docente exigida pela LDB (art. 62) para a educação básica. */
export const temLicenciatura = (qs: { tipo: string; status: string; em_andamento?: boolean | null; emAndamento?: boolean | null }[]) => qs.some(q => q.tipo === "LICENCIATURA" && q.status === "VALIDADA" && !(q.emAndamento ?? q.em_andamento));

// ------------------------------------------------------------------ itens sob responsabilidade
export const ITEM_TIPO: Record<string, string> = { NOTEBOOK: "Notebook", TABLET: "Tablet", CELULAR: "Celular", CHAVE: "Chave", CRACHA: "Crachá", CARTAO: "Cartão de acesso", UNIFORME: "Uniforme", FERRAMENTA: "Ferramenta", EQUIPAMENTO: "Equipamento", MATERIAL: "Material didático", OUTRO: "Outro" };
export const ITEM_STATUS: Record<string, string> = { COM_COLABORADOR: "Com o colaborador", DEVOLVIDO: "Devolvido", EXTRAVIADO: "Extraviado / não devolvido", BAIXADO: "Baixado (consumo ou descarte)" };
export const ITEM_TOM: Record<string, string> = { COM_COLABORADOR: "EM_ADMISSAO", DEVOLVIDO: "APROVADA", EXTRAVIADO: "REJEITADA", BAIXADO: "CANCELADA" };
/** Quem entrega e recebe itens: RH e Direção (rede), Direção da unidade e Coordenação (unidade) e Operações (patrimônio). */
export const podeItens = (s: Session) => ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR", "OPERACOES"].includes(s.role);

// ------------------------------------------------------------------ organograma de pessoas
export type NoPessoa = { id: number; nome: string; cargo: string | null; unidade: string; unitId: number; gestorId: number | null; familia: string | null; admissao: string; ramal: string | null; emailInst: string | null; noDiretorio: boolean };
/** Raízes (sem gestor ativo na lista), filhos por gestor e contagens: equipe direta e total abaixo (sem ciclos, mesmo com dado ruim). */
export function arvorePessoas(ps: NoPessoa[]) {
  const ids = new Set(ps.map(p => p.id)); const filhos = new Map<number, NoPessoa[]>();
  for (const p of ps) if (p.gestorId && ids.has(p.gestorId) && p.gestorId !== p.id) filhos.set(p.gestorId, [...(filhos.get(p.gestorId) ?? []), p]);
  for (const v of filhos.values()) v.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const total = new Map<number, number>();
  const contar = (id: number, visto: Set<number>): number => { if (total.has(id)) return total.get(id)!; if (visto.has(id)) return 0; visto.add(id); const n = (filhos.get(id) ?? []).reduce((s, f) => s + 1 + contar(f.id, visto), 0); total.set(id, n); return n; };
  for (const p of ps) contar(p.id, new Set());
  // raiz = sem gestor na lista; quem está num ciclo (A gestor de B, B de A) também vira raiz para não sumir
  const alcancados = new Set<number>(); const marcar = (id: number) => { if (alcancados.has(id)) return; alcancados.add(id); for (const f of filhos.get(id) ?? []) marcar(f.id); };
  const raizes = ps.filter(p => !p.gestorId || !ids.has(p.gestorId) || p.gestorId === p.id); raizes.forEach(r => marcar(r.id));
  for (const p of ps) if (!alcancados.has(p.id)) { raizes.push(p); marcar(p.id); }
  raizes.sort((a, b) => (total.get(b.id) ?? 0) - (total.get(a.id) ?? 0) || a.nome.localeCompare(b.nome, "pt-BR"));
  return { raizes, filhos: (id: number) => filhos.get(id) ?? [], diretos: (id: number) => (filhos.get(id) ?? []).length, abaixo: (id: number) => total.get(id) ?? 0 };
}
export const iniciais = (nome: string) => { const p = nome.replace(/\([^)]*\)/g, " ").trim().split(/\s+/).filter(x => /^\p{L}/u.test(x) && !/^(d[aeo]s?|e)$/i.test(x)); return ((p[0]?.[0] ?? "?") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase(); };
/** Liderança: família de gestão/coordenação ou quem tem equipe direta. */
export const ehLideranca = (familia: string | null | undefined, diretos: number, familias: string[]) => diretos > 0 || (!!familia && familias.includes(familia));

/** Completa os nomes (unidade, cargo, gestor, empresa) que faltam no “de/para” — registros antigos, importados ou lançados só com o código. */
export async function enriquecerMoves<T extends { de: Record<string, unknown> | null; para: Record<string, unknown> | null }>(moves: T[]): Promise<T[]> {
  const ids = (k: string) => [...new Set(moves.flatMap(m => [m.de?.[k], m.para?.[k]]).filter(v => v !== null && v !== undefined && v !== "").map(Number).filter(Number.isFinite))];
  const [u, p, g, c] = [ids("unitId"), ids("positionId"), ids("gestorId"), ids("companyId")];
  if (!u.length && !p.length && !g.length && !c.length) return moves;
  const mapa = async (t: "units" | "positions" | "employees" | "companies", xs: number[]) => xs.length ? new Map((await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM ${sql(t)} WHERE id IN ${sql(xs)}`).map(r => [r.id, r.nome])) : new Map<number, string>();
  const [mu, mp, mg, mc] = await Promise.all([mapa("units", u), mapa("positions", p), mapa("employees", g), mapa("companies", c)]);
  const pares: [string, string, Map<number, string>][] = [["unitId", "unidade", mu], ["positionId", "cargo", mp], ["gestorId", "gestor", mg], ["companyId", "empresa", mc]];
  const completa = (o: Record<string, unknown> | null) => { if (!o) return o; const r = { ...o }; for (const [k, n, m] of pares) if (k in r && (r[n] === undefined || r[n] === null || r[n] === "") && r[k] !== null && r[k] !== undefined) r[n] = m.get(Number(r[k])) ?? r[n]; return r; };
  return moves.map(m => ({ ...m, de: completa(m.de), para: completa(m.para) }));
}

/**
 * A admissão gravada pelo sistema é um retrato da ficha no dia em que o histórico começou (instalação ou atualização v30).
 * Se depois dela há movimentações com o “de” registrado (promoção, transferência, troca de cargo…), o estado na admissão é o
 * “de” mais antigo de cada campo — é o que a tela mostra, para a admissão não contradizer a promoção que veio depois.
 */
export function estadoNaAdmissao<T extends { tipo: string; data: string; origem: string; de: Record<string, unknown> | null; para: Record<string, unknown> | null }>(moves: T[]): T[] {
  const adm = moves.find(m => m.tipo === "ADMISSAO" && m.origem === "SISTEMA"); if (!adm || !adm.para) return moves;
  const depois = moves.filter(m => m !== adm && m.de && !["ADMISSAO", "READMISSAO", "DESLIGAMENTO"].includes(m.tipo) && m.data >= adm.data).sort((x, y) => x.data.localeCompare(y.data));
  const para = { ...adm.para };
  for (const [k, n] of [["positionId", "cargo"], ["unitId", "unidade"], ["nivel", ""], ["vinculo", ""]] as const) {
    const m = depois.find(x => x.de && k in x.de); if (!m || !m.de) continue;
    para[k] = m.de[k]; if (n) para[n] = m.de[n] ?? para[n];
  }
  return moves.map(m => (m === adm ? { ...m, para } : m));
}

/** Admissões e desligamentos no histórico funcional de quem ainda não tem (instalação, importação de planilha, contratado pelo recrutamento). Idempotente. */
export async function garantirHistoricoBase(ids?: number[]) {
  const filtro = ids?.length ? sql`AND e.id IN ${sql(ids)}` : sql``;
  await sql`INSERT INTO employee_moves (employee_id, data, tipo, para, origem, user_nome)
    SELECT e.id, e.admissao, 'ADMISSAO', jsonb_build_object('unitId', e.unit_id, 'unidade', u.nome, 'positionId', e.position_id, 'cargo', p.nome, 'nivel', e.nivel, 'vinculo', e.vinculo), 'SISTEMA', 'sistema'
    FROM employees e JOIN units u ON u.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id
    WHERE NOT EXISTS (SELECT 1 FROM employee_moves m WHERE m.employee_id=e.id AND m.tipo='ADMISSAO') ${filtro}`;
  await sql`INSERT INTO employee_moves (employee_id, data, tipo, motivo, de, origem, user_nome)
    SELECT e.id, e.desligamento, 'DESLIGAMENTO', e.motivo_desligamento, jsonb_build_object('unitId', e.unit_id, 'unidade', u.nome, 'positionId', e.position_id, 'cargo', p.nome), 'SISTEMA', 'sistema'
    FROM employees e JOIN units u ON u.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id
    WHERE e.situacao='DESLIGADO' AND e.desligamento IS NOT NULL AND NOT EXISTS (SELECT 1 FROM employee_moves m WHERE m.employee_id=e.id AND m.tipo='DESLIGAMENTO' AND m.data=e.desligamento) ${filtro}`;
}
