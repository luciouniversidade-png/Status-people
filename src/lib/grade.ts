import { sql } from "@/db";
import { hoje, addDays, getSettings, fmtData } from "./utils";
import { minutos, turnoDe, sobrepoe, DIAS_CURTO } from "./cobertura";

/**
 * T-053 · Grade docente com vigência (CRQ-TMP-V3-01): qual horário vale em qual período.
 * - Cada unidade tem uma linha do tempo de vigências ATIVAS que não se sobrepõem; rascunho é onde se monta a próxima.
 * - Nunca edição retroativa solta: mudar horário/dia/professor numa grade que já está em vigor cria um ajuste com vigência a partir de hoje
 *   (o passado fica como era); vigência com início no passado só com justificativa e com os meses do ponto abertos.
 * - A CH do professor (jornada) muda só quando o RH aplica a CH de uma vigência, a partir do início dela; meses fechados ficam intactos.
 * - Importação: de-para nome × colaborador SEMPRE confirmado por humano (lição 01/09).
 */
type Tx = typeof sql;
export const GRADE_ORIGEM: Record<string, string> = { MANUAL: "Montada na tela", COPIA: "Cópia de outra vigência", IMPORTACAO: "Importada (de-para confirmado)", AJUSTE: "Ajuste na grade em vigor", MIGRACAO: "Grade que já estava em uso", INICIAL: "Grade inicial" };
export type Versao = { id: number; unit_id: number; nome: string; vigencia_inicio: string; vigencia_fim: string | null; status: string; origem: string; copiada_de: number | null; obs: string | null; criada_em: string; ativada_em: string | null; ch_aplicada_em: string | null };
export type Situacao = "RASCUNHO" | "VIGENTE" | "FUTURA" | "ENCERRADA" | "DESCARTADA";
export const SITUACAO_ROTULO: Record<Situacao, [string, string]> = { RASCUNHO: ["PENDENTE", "rascunho"], VIGENTE: ["APROVADA", "vigente"], FUTURA: ["EM_ADMISSAO", "futura"], ENCERRADA: ["CANCELADA", "encerrada"], DESCARTADA: ["CANCELADA", "descartada"] };
export function situacao(v: Pick<Versao, "status" | "vigencia_inicio" | "vigencia_fim">, h = hoje()): Situacao {
  if (v.status === "RASCUNHO") return "RASCUNHO"; if (v.status === "DESCARTADA") return "DESCARTADA";
  if (v.vigencia_inicio > h) return "FUTURA"; if (v.vigencia_fim && v.vigencia_fim < h) return "ENCERRADA"; return "VIGENTE";
}
export const periodoTxt = (v: Pick<Versao, "vigencia_inicio" | "vigencia_fim">) => v.vigencia_fim ? `${fmtData(v.vigencia_inicio)} a ${fmtData(v.vigencia_fim)}` : `a partir de ${fmtData(v.vigencia_inicio)}`;

export async function versoesDaUnidade(unitId: number) {
  return sql<(Versao & { aulas: number; professores: number })[]>`SELECT g.id, g.unit_id, g.nome, g.vigencia_inicio::text, g.vigencia_fim::text, g.status, g.origem, g.copiada_de, g.obs, g.criada_em::text, g.ativada_em::text, g.ch_aplicada_em::text,
      (SELECT count(*) FROM teacher_slots t WHERE t.version_id=g.id AND t.ativo)::int AS aulas, (SELECT count(DISTINCT t.employee_id) FROM teacher_slots t WHERE t.version_id=g.id AND t.ativo)::int AS professores
    FROM grade_versions g WHERE g.unit_id=${unitId} AND g.status <> 'DESCARTADA' ORDER BY (g.status='RASCUNHO') DESC, g.vigencia_inicio DESC, g.id DESC`;
}
export async function versao(id: number, tx: Tx = sql) {
  const [v] = await tx<Versao[]>`SELECT id, unit_id, nome, vigencia_inicio::text, vigencia_fim::text, status, origem, copiada_de, obs, criada_em::text, ativada_em::text, ch_aplicada_em::text FROM grade_versions WHERE id=${id}`; return v ?? null;
}
/** Vigência ATIVA da unidade na data (no máximo uma por construção). */
export async function versaoVigente(unitId: number, data = hoje(), tx: Tx = sql) {
  const [v] = await tx<Versao[]>`SELECT id, unit_id, nome, vigencia_inicio::text, vigencia_fim::text, status, origem, copiada_de, obs, criada_em::text, ativada_em::text, ch_aplicada_em::text FROM grade_versions
    WHERE unit_id=${unitId} AND status='ATIVA' AND vigencia_inicio <= ${data} AND (vigencia_fim IS NULL OR vigencia_fim >= ${data}) ORDER BY vigencia_inicio DESC LIMIT 1`; return v ?? null;
}
/** Copia as aulas (ativas) de uma vigência para outra; devolve o mapa id antigo → id novo. */
export async function copiarAulas(tx: Tx, de: number, para: number) {
  const mapa = new Map<number, number>();
  const xs = await tx<{ id: number }[]>`SELECT id FROM teacher_slots WHERE version_id=${de} AND ativo ORDER BY id`;
  for (const x of xs) { const [n] = await tx<{ id: number }[]>`INSERT INTO teacher_slots (employee_id, unit_id, dia_semana, inicio, fim, turno, turma, disciplina, space_id, version_id) SELECT employee_id, unit_id, dia_semana, inicio, fim, turno, turma, disciplina, space_id, ${para} FROM teacher_slots WHERE id=${x.id} RETURNING id`; mapa.set(x.id, n.id); }
  return mapa;
}
/** Primeira grade da unidade: vale a partir de hoje (o passado não ganha aulas retroativas). */
export async function garantirVigente(tx: Tx, unitId: number, userId: number) {
  const v = await versaoVigente(unitId, hoje(), tx); if (v) return v;
  const [fut] = await tx<{ vigencia_inicio: string }[]>`SELECT vigencia_inicio::text FROM grade_versions WHERE unit_id=${unitId} AND status='ATIVA' AND vigencia_inicio > ${hoje()} ORDER BY vigencia_inicio LIMIT 1`;
  const [n] = await tx<{ id: number }[]>`INSERT INTO grade_versions (unit_id, nome, vigencia_inicio, vigencia_fim, status, origem, criada_por, ativada_por, ativada_em, obs) VALUES (${unitId}, 'Grade inicial', ${hoje()}, ${fut ? addDays(fut.vigencia_inicio, -1) : null}, 'ATIVA', 'INICIAL', ${userId}, ${userId}, now(), 'Criada com a primeira aula cadastrada') RETURNING id`;
  return (await versao(n.id, tx))!;
}

/**
 * Onde uma edição cai. Rascunho: edita direto. Vigência que começa hoje ou depois: edita direto (ainda não produziu história).
 * Vigência já em vigor: correção sem efeito na CH (turma, disciplina, sala) edita direto; mudança de professor, dia, horário,
 * inclusão ou retirada cria um AJUSTE com vigência a partir de hoje — nunca edição retroativa.
 */
export async function alvoEdicao(tx: Tx, unitId: number, userId: number, opts: { versaoId?: number | null; mudaCh: boolean }) {
  const h = hoje();
  let v = opts.versaoId ? await versao(opts.versaoId, tx) : null;
  if (opts.versaoId && (!v || v.unit_id !== unitId)) throw new Error("Vigência não encontrada nesta unidade.");
  if (v && v.status === "DESCARTADA") throw new Error("Esta vigência foi descartada.");
  if (v && v.status === "RASCUNHO") return { versao: v, mapa: null as Map<number, number> | null, ajuste: false };
  if (v && v.vigencia_fim && v.vigencia_fim < h) throw new Error("Vigência encerrada não se edita: o que passou fica como foi. Crie uma nova vigência.");
  if (!v) v = await garantirVigente(tx, unitId, userId);
  if (v.vigencia_inicio >= h || !opts.mudaCh) return { versao: v, mapa: null, ajuste: false };
  // ajuste com vigência a partir de hoje: a vigência anterior fecha ontem; o ajuste herda o fim (se havia)
  const [ja] = await tx<{ id: number }[]>`SELECT id FROM grade_versions WHERE unit_id=${unitId} AND status='ATIVA' AND vigencia_inicio=${h} AND origem='AJUSTE'`;
  if (ja) return { versao: (await versao(ja.id, tx))!, mapa: null, ajuste: true };
  const [n] = await tx<{ id: number }[]>`INSERT INTO grade_versions (unit_id, nome, vigencia_inicio, vigencia_fim, status, origem, copiada_de, criada_por, ativada_por, ativada_em, obs) VALUES (${unitId}, ${`Ajuste de ${fmtData(h)}`}, ${h}, ${v.vigencia_fim}, 'ATIVA', 'AJUSTE', ${v.id}, ${userId}, ${userId}, now(), ${`Mudança na grade em vigor (${v.nome}); a vigência anterior vale até ${fmtData(addDays(h, -1))}`}) RETURNING id`;
  await tx`UPDATE grade_versions SET vigencia_fim=${addDays(h, -1)} WHERE id=${v.id}`;
  const mapa = await copiarAulas(tx, v.id, n.id);
  return { versao: (await versao(n.id, tx))!, mapa, ajuste: true };
}

type SlotC = { id: number; employee_id: number; unit_id: number; dia_semana: number; inicio: string; fim: string; turma: string; disciplina: string | null; space_id: number | null; version_id: number | null };
/** Aulas que convivem com a vigência: as dela + as do mesmo professor nas grades de outras unidades em vigor na mesma data. */
async function aulasConcorrentes(tx: Tx, v: Versao, employeeIds?: number[]) {
  return tx<SlotC[]>`SELECT t.id, t.employee_id, t.unit_id, t.dia_semana, t.inicio, t.fim, t.turma, t.disciplina, t.space_id, t.version_id FROM teacher_slots t
    WHERE t.ativo AND (t.version_id=${v.id} OR (t.unit_id <> ${v.unit_id} AND slot_vigente(t.version_id, ${v.vigencia_inicio}::date))) ${employeeIds ? tx`AND t.employee_id = ANY(${employeeIds})` : tx``}`;
}
/** Choque de professor ao incluir/alterar uma aula na vigência. */
export async function choqueProfessor(tx: Tx, v: Versao, d: { employeeId: number; dia: number; inicio: string; fim: string }, ignorarId?: number | null) {
  const xs = (await aulasConcorrentes(tx, v, [d.employeeId])).filter(x => x.id !== ignorarId && x.dia_semana === d.dia && sobrepoe(x.inicio, x.fim, d.inicio, d.fim));
  return xs[0] ?? null;
}

export type Achado = { nivel: "BLOQUEIA" | "AVISO"; texto: string };
/** Validação da vigência antes de ativar: professor em dois lugares ao mesmo tempo bloqueia; o resto avisa. */
export async function validarVersao(id: number): Promise<Achado[]> {
  const v = await versao(id); if (!v) return [{ nivel: "BLOQUEIA", texto: "Vigência não encontrada." }];
  const cfg = await getSettings(); const dur = (cfg.grade?.duracoesAula ?? [45, 50, 60]) as number[]; const plantao = ((cfg.grade?.rotulosPlantao ?? ["PLANTAO"]) as string[]).map(x => x.toUpperCase());
  const todas = await aulasConcorrentes(sql, v); const minhas = todas.filter(x => x.version_id === v.id);
  const nomes = new Map((await sql<{ id: number; nome: string; situacao: string; regime: string }[]>`SELECT id, nome, situacao, regime FROM employees WHERE id = ANY(${[...new Set(minhas.map(m => m.employee_id))]})`).map(e => [e.id, e]));
  const out: Achado[] = []; const vistos = new Set<string>();
  for (const a of minhas) {
    const nome = nomes.get(a.employee_id)?.nome ?? `#${a.employee_id}`;
    for (const b of todas) {
      if (b.id === a.id || b.employee_id !== a.employee_id || b.dia_semana !== a.dia_semana || !sobrepoe(a.inicio, a.fim, b.inicio, b.fim)) continue;
      const k = [a.id, b.id].sort((x, y) => x - y).join("|"); if (vistos.has(k)) continue; vistos.add(k);
      out.push({ nivel: "BLOQUEIA", texto: `${nome}: ${DIAS_CURTO[a.dia_semana]} ${a.inicio}–${a.fim} (${a.turma}) choca com ${b.inicio}–${b.fim} (${b.turma}${b.unit_id !== a.unit_id ? ", outra unidade" : ""}).` });
    }
    const e = nomes.get(a.employee_id); if (e?.situacao === "DESLIGADO") out.push({ nivel: "BLOQUEIA", texto: `${nome} está desligado(a) e tem aula na grade (${DIAS_CURTO[a.dia_semana]} ${a.inicio}).` });
    const m = (minutos(a.fim) ?? 0) - (minutos(a.inicio) ?? 0); const ehPlantao = plantao.some(p => `${a.turma} ${a.disciplina ?? ""}`.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(p));
    if (!ehPlantao && !dur.includes(m) && !dur.some(d0 => m % d0 === 0)) out.push({ nivel: "AVISO", texto: `${nome}: aula de ${m} min em ${DIAS_CURTO[a.dia_semana]} ${a.inicio} (${a.turma}) — fora das durações ${dur.join("/")} min.` });
  }
  // turma com duas aulas ao mesmo tempo (pode ser divisão de turma: só avisa) e sala ocupada duas vezes
  for (const [i, a] of minhas.entries()) for (const b of minhas.slice(i + 1)) {
    if (a.dia_semana !== b.dia_semana || !sobrepoe(a.inicio, a.fim, b.inicio, b.fim)) continue;
    if (a.employee_id !== b.employee_id && a.turma.trim().toLowerCase() === b.turma.trim().toLowerCase()) out.push({ nivel: "AVISO", texto: `Turma ${a.turma}: duas aulas ao mesmo tempo em ${DIAS_CURTO[a.dia_semana]} ${a.inicio} (divisão de turma?).` });
    if (a.space_id && a.space_id === b.space_id && a.employee_id !== b.employee_id) out.push({ nivel: "BLOQUEIA", texto: `Sala ocupada duas vezes em ${DIAS_CURTO[a.dia_semana]} ${a.inicio} (${a.turma} e ${b.turma}).` });
  }
  const semDocente = [...new Set(minhas.map(m => m.employee_id))].filter(id => nomes.get(id) && nomes.get(id)!.regime !== "DOCENTE");
  if (semDocente.length) out.push({ nivel: "AVISO", texto: `${semDocente.length} pessoa(s) com aula sem regime docente no cadastro (${semDocente.map(id => nomes.get(id)!.nome).slice(0, 3).join(", ")}) — confira o vínculo.` });
  if (!minhas.length) out.push({ nivel: "BLOQUEIA", texto: "Vigência sem nenhuma aula." });
  return out;
}

const DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;
export type Ch = { seg: number; ter: number; qua: number; qui: number; sex: number; sab: number; dom: number; total: number; horarios: string };
/**
 * CH diária pela grade (regra da operação real): por turno, do início da primeira aula ao fim da última — janela conta,
 * almoço (entre turnos) não; plantão conta como aula. Considera as aulas do professor em todas as unidades na data.
 */
export function chDeAulas(aulas: { dia_semana: number; inicio: string; fim: string }[]): Ch {
  const ch: Ch = { seg: 0, ter: 0, qua: 0, qui: 0, sex: 0, sab: 0, dom: 0, total: 0, horarios: "" }; const partes: string[] = [];
  for (let d = 1; d <= 6; d++) {
    const doDia = aulas.filter(a => a.dia_semana === d); if (!doDia.length) continue;
    const porTurno = new Map<string, { ini: number; fim: number }>();
    for (const a of doDia) { const t = turnoDe(a.inicio); const i = minutos(a.inicio) ?? 0, f = minutos(a.fim) ?? 0; const x = porTurno.get(t); porTurno.set(t, x ? { ini: Math.min(x.ini, i), fim: Math.max(x.fim, f) } : { ini: i, fim: f }); }
    const blocos = [...porTurno.values()].sort((x, y) => x.ini - y.ini); const m = blocos.reduce((s, b) => s + (b.fim - b.ini), 0);
    ch[DOW[d]] = m; ch.total += m;
    const hh = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
    partes.push(`${DIAS_CURTO[d]} ${blocos.map(b => `${hh(b.ini)}–${hh(b.fim)}`).join(" e ")}`);
  }
  ch.horarios = partes.join(" · "); return ch;
}
/** CH proposta pela vigência para cada professor × jornada vigente na data de início (para o RH confirmar quem recebe a CH da grade). */
export async function propostaCh(id: number) {
  const v = await versao(id); if (!v) throw new Error("Vigência não encontrada.");
  const todas = await aulasConcorrentes(sql, v); const ids = [...new Set(todas.filter(x => x.version_id === v.id).map(x => x.employee_id))];
  const [emps, jornadas] = await Promise.all([
    sql<{ id: number; nome: string; regime: string; unit_id: number }[]>`SELECT id, nome, regime, unit_id FROM employees WHERE id = ANY(${ids}) ORDER BY nome`,
    sql<{ employee_id: number; id: number; vigencia_inicio: string; seg: number; ter: number; qua: number; qui: number; sex: number; sab: number; dom: number; obs: string | null }[]>`SELECT DISTINCT ON (employee_id) employee_id, id, vigencia_inicio::text, seg, ter, qua, qui, sex, sab, dom, obs FROM schedules
      WHERE employee_id = ANY(${ids}) AND vigencia_inicio <= ${v.vigencia_inicio} AND (vigencia_fim IS NULL OR vigencia_fim >= ${v.vigencia_inicio}) ORDER BY employee_id, vigencia_inicio DESC`,
  ]);
  return emps.map(e => { const ch = chDeAulas(todas.filter(x => x.employee_id === e.id)); const j = jornadas.find(x => x.employee_id === e.id) ?? null;
    const atual = j ? DOW.slice(1, 7).map(k => j[k]) : null; const nova = DOW.slice(1, 7).map(k => ch[k]);
    return { employeeId: e.id, nome: e.nome, regime: e.regime, ch, jornada: j, igual: !!atual && atual.every((m, i) => m === nova[i]), outrasUnidades: todas.some(x => x.employee_id === e.id && x.unit_id !== v.unit_id) }; });
}

/** Comparador entre vigências: aulas que entraram, saíram ou mudaram e a CH por dia antes × depois. */
export async function compararVersoes(aId: number, bId: number) {
  const [a, b] = await Promise.all([versao(aId), versao(bId)]); if (!a || !b) throw new Error("Vigência não encontrada.");
  const aulas = await sql<(SlotC & { professor: string })[]>`SELECT t.id, t.employee_id, t.unit_id, t.dia_semana, t.inicio, t.fim, t.turma, t.disciplina, t.space_id, t.version_id, e.nome AS professor FROM teacher_slots t JOIN employees e ON e.id=t.employee_id WHERE t.ativo AND t.version_id = ANY(${[aId, bId]})`;
  const chave = (x: SlotC) => `${x.employee_id}|${x.dia_semana}|${x.inicio}|${x.fim}`;
  const deA = aulas.filter(x => x.version_id === aId), deB = aulas.filter(x => x.version_id === bId);
  const profs = [...new Map(aulas.map(x => [x.employee_id, x.professor])).entries()].sort((x, y) => x[1].localeCompare(y[1]));
  const linhas = profs.map(([id, nome]) => {
    const pa = deA.filter(x => x.employee_id === id), pb = deB.filter(x => x.employee_id === id);
    const ka = new Map(pa.map(x => [chave(x), x])), kb = new Map(pb.map(x => [chave(x), x]));
    const entrou = pb.filter(x => !ka.has(chave(x))), saiu = pa.filter(x => !kb.has(chave(x)));
    const mudou = pb.filter(x => { const o = ka.get(chave(x)); return o && (o.turma !== x.turma || (o.disciplina ?? "") !== (x.disciplina ?? "") || (o.space_id ?? 0) !== (x.space_id ?? 0)); });
    const cha = chDeAulas(pa), chb = chDeAulas(pb);
    return { employeeId: id, nome, entrou, saiu, mudou, chAntes: cha, chDepois: chb, igual: !entrou.length && !saiu.length && !mudou.length };
  });
  return { a, b, linhas, mudaram: linhas.filter(l => !l.igual).length };
}
