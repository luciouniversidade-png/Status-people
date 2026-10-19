import { sql } from "@/db";
import { addDays, getSettings } from "./utils";

export const MOTIVO_AUS: Record<string, string> = { FALTA: "Falta", ATESTADO: "Atestado médico", AFASTAMENTO: "Afastamento", FERIAS: "Férias", LICENCA: "Licença", FORMACAO: "Formação ou curso", OUTRO: "Outro" };
export const COB_STATUS: Record<string, string> = { ABERTA: "Sem cobertura", CONVIDADO: "Convite enviado", CONFIRMADA: "Coberta", REALIZADA: "Realizada", SEM_PROFESSOR: "Sem professor", CANCELADA: "Cancelada" };
export const COB_TOM: Record<string, string> = { ABERTA: "REJEITADA", CONVIDADO: "PENDENTE", CONFIRMADA: "EM_ADMISSAO", REALIZADA: "APROVADA", SEM_PROFESSOR: "SOLICITADA", CANCELADA: "CANCELADA" };
export const SOLUCOES: Record<string, string> = { ATIVIDADE_ORIENTADA: "Atividade orientada (coordenação ou inspetor)", JUNCAO: "Junção de turmas", DISPENSA: "Turma dispensada (famílias avisadas)", OUTRA: "Outra solução" };
export const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
export const DIAS_CURTO = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
/** Afastamentos aprovados que viram ausência automática (folga do banco também tira o professor da sala). */
const LEAVE_MOTIVO: Record<string, string> = { FERIAS: "FERIAS", AFASTAMENTO_SAUDE: "AFASTAMENTO", LICENCA: "LICENCA", FOLGA_BANCO: "OUTRO", OUTRO: "OUTRO" };

/** "07:30" → 450; inválido → null. */
export function minutos(t: string | null | undefined) { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec((t ?? "").trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
export const turnoDe = (inicio: string) => { const m = minutos(inicio) ?? 0; return m < 12 * 60 ? "Matutino" : m < 18 * 60 ? "Vespertino" : "Noturno"; };
export const diaSemana = (iso: string) => new Date(iso + "T12:00:00Z").getUTCDay();
export const sobrepoe = (a1: string, a2: string, b1: string, b2: string) => (minutos(a1) ?? 0) < (minutos(b2) ?? 0) && (minutos(b1) ?? 0) < (minutos(a2) ?? 0);
/** Lê o dia da semana em vários formatos: 1–6, "seg", "Segunda-feira", "terça"… */
export function lerDia(v: string) {
  const t = v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  if (/^[1-6]$/.test(t)) return Number(t);
  const i = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"].findIndex(p => t.startsWith(p)); return i >= 1 ? i : null;
}

/** Dia sem aula para docentes (feriado, não letivo, recesso, férias coletivas) na unidade: devolve a descrição. */
export async function diaNaoLetivo(data: string, unitId: number | null) {
  const [c] = await sql<{ descricao: string | null; tipo: string }[]>`SELECT descricao, tipo FROM calendar_days WHERE data=${data} AND publico IN ('TODOS','DOCENTE') AND tipo IN ('FERIADO','NAO_LETIVO','RECESSO','FERIAS_COLETIVAS') AND (unit_id IS NULL ${unitId === null ? sql`` : sql`OR unit_id=${unitId}`}) LIMIT 1`;
  return c ? (c.descricao ?? c.tipo) : null;
}

type Tx = typeof sql;
/** Cria (sem duplicar) as aulas a cobrir de uma ausência: aulas ativas do professor naquele dia da semana, dentro do período quando a ausência é parcial. */
export async function gerarAulasDaAusencia(absenceId: number, tx: Tx = sql) {
  const [a] = await tx<{ id: number; employee_id: number; data: string; inicio: string | null; fim: string | null; status: string }[]>`SELECT id, employee_id, data::text, inicio, fim, status FROM cover_absences WHERE id=${absenceId}`;
  if (!a || a.status !== "ATIVA") return 0;
  const slots = await tx<{ id: number; unit_id: number; inicio: string; fim: string; turno: string; turma: string; disciplina: string | null }[]>`SELECT id, unit_id, inicio, fim, turno, turma, disciplina FROM teacher_slots WHERE employee_id=${a.employee_id} AND ativo AND slot_vigente(version_id, ${a.data}::date) AND dia_semana=${diaSemana(a.data)} ORDER BY inicio`;
  let n = 0;
  for (const sl of slots) {
    if (a.inicio && a.fim && !sobrepoe(sl.inicio, sl.fim, a.inicio, a.fim)) continue;
    if (await diaNaoLetivo(a.data, sl.unit_id)) continue;
    const r = await tx`INSERT INTO cover_assignments (absence_id, slot_id, data, unit_id, turma, disciplina, inicio, fim, turno, ausente_employee_id, minutos) VALUES (${a.id}, ${sl.id}, ${a.data}, ${sl.unit_id}, ${sl.turma}, ${sl.disciplina}, ${sl.inicio}, ${sl.fim}, ${sl.turno}, ${a.employee_id}, ${(minutos(sl.fim) ?? 0) - (minutos(sl.inicio) ?? 0)}) ON CONFLICT (slot_id, data) WHERE status <> 'CANCELADA' DO NOTHING RETURNING id`;
    n += r.length;
  }
  return n;
}

/** Afastamentos aprovados (férias, licença, saúde, folga) viram ausência nos dias com aula; afastamento cancelado desfaz o que não foi realizado. */
export async function sincronizarAfastamentos(ini: string, fim: string) {
  let criadas = 0, canceladas = 0;
  const leaves = await sql<{ id: number; employee_id: number; tipo: string; inicio: string; fim: string; unit_id: number }[]>`SELECT l.id, l.employee_id, l.tipo, l.inicio::text, l.fim::text, e.unit_id FROM leave_requests l JOIN employees e ON e.id=l.employee_id
    WHERE l.status='APROVADA' AND l.inicio <= ${fim} AND l.fim >= ${ini} AND EXISTS (SELECT 1 FROM teacher_slots t WHERE t.employee_id=l.employee_id AND t.ativo AND (t.version_id IS NULL OR EXISTS (SELECT 1 FROM grade_versions g WHERE g.id=t.version_id AND g.status='ATIVA' AND g.vigencia_inicio <= l.fim AND (g.vigencia_fim IS NULL OR g.vigencia_fim >= l.inicio))))`;
  for (const l of leaves) {
    for (let d = l.inicio > ini ? l.inicio : ini; d <= (l.fim < fim ? l.fim : fim); d = addDays(d, 1)) {
      if (diaSemana(d) === 0) continue;
      const [x] = await sql<{ id: number }[]>`INSERT INTO cover_absences (employee_id, unit_id, data, motivo, origem, leave_request_id, obs) VALUES (${l.employee_id}, ${l.unit_id}, ${d}, ${LEAVE_MOTIVO[l.tipo] ?? "AFASTAMENTO"}, 'AFASTAMENTO', ${l.id}, 'Gerada do afastamento aprovado') ON CONFLICT (employee_id, data) WHERE status='ATIVA' DO NOTHING RETURNING id`;
      if (x) { criadas++; await gerarAulasDaAusencia(x.id); }
    }
  }
  const orf = await sql<{ id: number }[]>`UPDATE cover_absences a SET status='CANCELADA' WHERE a.status='ATIVA' AND a.origem='AFASTAMENTO' AND a.data BETWEEN ${ini} AND ${fim} AND NOT EXISTS (SELECT 1 FROM leave_requests l WHERE l.id=a.leave_request_id AND l.status='APROVADA' AND a.data BETWEEN l.inicio AND l.fim) RETURNING a.id`;
  if (orf.length) { await sql`UPDATE cover_assignments SET status='CANCELADA', updated_at=now() WHERE absence_id = ANY(${orf.map(o => o.id)}) AND status NOT IN ('REALIZADA','CANCELADA')`; canceladas = orf.length; }
  return { criadas, canceladas };
}

export type Aula = { id: number; absence_id: number; data: string; unit_id: number; unidade: string; turma: string; disciplina: string | null; inicio: string; fim: string; turno: string | null; status: string; solucao: string | null; minutos: number; obs: string | null; sala: string | null;
  ausente_id: number; ausente: string; motivo: string; cobertura_id: number | null; cobertura: string | null; cobertura_tel: string | null; cobertura_user: number | null; convidado_em: string | null; recusas: { employeeId: number; nome: string; em: string; motivo: string | null }[] | null; hour_entry_id: number | null };

/** Aulas a cobrir num dia (ou período), com quem falta e quem cobre. */
export async function aulas(ini: string, fim: string, unitId: number | null, extra?: { coberturaDe?: number; status?: string[] }) {
  return sql<Aula[]>`SELECT ca.id, ca.absence_id, ca.data::text, ca.unit_id, u.nome AS unidade, ca.turma, ca.disciplina, ca.inicio, ca.fim, ca.turno, ca.status, ca.solucao, ca.minutos, ca.obs, sp.nome AS sala,
      ca.ausente_employee_id AS ausente_id, ea.nome AS ausente, ab.motivo, ca.cobertura_employee_id AS cobertura_id, ec.nome AS cobertura, ec.telefone AS cobertura_tel, uc.id AS cobertura_user, ca.convidado_em::text, ca.recusas, ca.hour_entry_id
    FROM cover_assignments ca JOIN units u ON u.id=ca.unit_id JOIN employees ea ON ea.id=ca.ausente_employee_id JOIN cover_absences ab ON ab.id=ca.absence_id
      LEFT JOIN employees ec ON ec.id=ca.cobertura_employee_id LEFT JOIN LATERAL (SELECT id FROM users WHERE employee_id=ca.cobertura_employee_id AND ativo ORDER BY id LIMIT 1) uc ON true
      LEFT JOIN teacher_slots ts ON ts.id=ca.slot_id LEFT JOIN spaces sp ON sp.id=ts.space_id
    WHERE ca.data BETWEEN ${ini} AND ${fim} AND ca.status <> 'CANCELADA' ${unitId === null ? sql`` : sql`AND ca.unit_id=${unitId}`}
      ${extra?.coberturaDe ? sql`AND ca.cobertura_employee_id=${extra.coberturaDe}` : sql``} ${extra?.status ? sql`AND ca.status = ANY(${extra.status})` : sql``}
    ORDER BY ca.data, ca.inicio, u.nome, ca.turma`;
}

/** Motivo pelo qual cada pessoa NÃO pode cobrir a aula (null = pode). Consultas em lote: poucas idas ao banco mesmo com muitos professores. */
export async function impedimentos(ids: number[], a: { id?: number; data: string; inicio: string; fim: string; ausente_id: number }) {
  const out = new Map<number, string | null>(); if (!ids.length) return out;
  const [emps, aus, lvs, prop, outras] = await Promise.all([
    sql<{ id: number; situacao: string }[]>`SELECT id, situacao FROM employees WHERE id = ANY(${ids})`,
    sql<{ employee_id: number; inicio: string | null; fim: string | null }[]>`SELECT employee_id, inicio, fim FROM cover_absences WHERE employee_id = ANY(${ids}) AND data=${a.data} AND status='ATIVA'`,
    sql<{ employee_id: number }[]>`SELECT DISTINCT employee_id FROM leave_requests WHERE employee_id = ANY(${ids}) AND status='APROVADA' AND ${a.data} BETWEEN inicio AND fim`,
    sql<{ employee_id: number; inicio: string; fim: string }[]>`SELECT employee_id, inicio, fim FROM teacher_slots WHERE employee_id = ANY(${ids}) AND ativo AND slot_vigente(version_id, ${a.data}::date) AND dia_semana=${diaSemana(a.data)}`,
    sql<{ employee_id: number; inicio: string; fim: string }[]>`SELECT cobertura_employee_id AS employee_id, inicio, fim FROM cover_assignments WHERE cobertura_employee_id = ANY(${ids}) AND data=${a.data} AND status IN ('CONVIDADO','CONFIRMADA','REALIZADA') ${a.id ? sql`AND id <> ${a.id}` : sql``}`]);
  for (const id of ids) {
    const e = emps.find(x => x.id === id);
    out.set(id, id === a.ausente_id ? "é quem vai faltar" : !e || e.situacao !== "ATIVO" ? "não está ativo"
      : aus.some(x => x.employee_id === id && (!x.inicio || !x.fim || sobrepoe(x.inicio, x.fim, a.inicio, a.fim))) ? "também está ausente"
      : lvs.some(x => x.employee_id === id) ? "está afastado(a) nesta data"
      : prop.some(x => x.employee_id === id && sobrepoe(x.inicio, x.fim, a.inicio, a.fim)) ? "tem aula própria neste horário"
      : outras.some(x => x.employee_id === id && sobrepoe(x.inicio, x.fim, a.inicio, a.fim)) ? "já cobre outra aula neste horário" : null);
  }
  return out;
}
export const impedimento = async (employeeId: number, a: { id?: number; data: string; inicio: string; fim: string; ausente_id: number }) => (await impedimentos([employeeId], a)).get(employeeId) ?? null;

export type Sugestao = { employeeId: number; nome: string; telefone: string | null; userId: number | null; motivos: string[]; pontos: number; coberturas: number };
/** Quem pode cobrir: livre no horário, sem ausência; antes quem é da mesma disciplina, já está na escola no turno e cobriu menos na janela. */
export async function sugestoes(a: Aula): Promise<Sugestao[]> {
  const cfg = await getSettings(); const janela = cfg.substituicao.janelaHistoricoDias as number; const dia = diaSemana(a.data);
  const pool = await sql<{ id: number; nome: string; telefone: string | null; unit_id: number; user_id: number | null; disciplinas: string[] | null; turno_hoje: boolean; coberturas: number }[]>`
    SELECT e.id, e.nome, e.telefone, e.unit_id, (SELECT id FROM users WHERE employee_id=e.id AND ativo ORDER BY id LIMIT 1) AS user_id,
      (SELECT array_agg(DISTINCT lower(t.disciplina)) FROM teacher_slots t WHERE t.employee_id=e.id AND t.ativo AND slot_vigente(t.version_id, ${a.data}::date) AND t.disciplina IS NOT NULL) AS disciplinas,
      EXISTS (SELECT 1 FROM teacher_slots t WHERE t.employee_id=e.id AND t.ativo AND slot_vigente(t.version_id, ${a.data}::date) AND t.unit_id=${a.unit_id} AND t.dia_semana=${dia} AND t.turno=${a.turno ?? ""}) AS turno_hoje,
      (SELECT count(*) FROM cover_assignments c WHERE c.cobertura_employee_id=e.id AND c.status IN ('CONFIRMADA','REALIZADA') AND c.data BETWEEN ${addDays(a.data, -janela)} AND ${a.data})::int AS coberturas
    FROM employees e WHERE e.situacao='ATIVO' AND e.id <> ${a.ausente_id} AND ((e.regime='DOCENTE' AND e.unit_id=${a.unit_id}) OR EXISTS (SELECT 1 FROM teacher_slots t WHERE t.employee_id=e.id AND t.ativo AND slot_vigente(t.version_id, ${a.data}::date) AND t.unit_id=${a.unit_id}))`;
  const out: Sugestao[] = []; const imp = await impedimentos(pool.map(p => p.id), a);
  for (const p of pool) {
    if (imp.get(p.id)) continue;
    const motivos = ["livre neste horário"]; let pontos = 0;
    if (a.disciplina && (p.disciplinas ?? []).includes(a.disciplina.toLowerCase())) { pontos += 3; motivos.push(`mesma disciplina (${a.disciplina})`); }
    if (p.turno_hoje) { pontos += 2; motivos.push("já está na escola neste turno"); }
    if (p.unit_id === a.unit_id) pontos += 1;
    motivos.push(p.coberturas ? `${p.coberturas} cobertura(s) em ${janela} dias` : `nenhuma cobertura em ${janela} dias`);
    if (!p.user_id) motivos.push("sem acesso ao sistema: designe e avise por WhatsApp");
    out.push({ employeeId: p.id, nome: p.nome, telefone: p.telefone, userId: p.user_id, motivos, pontos, coberturas: p.coberturas });
  }
  return out.sort((x, y) => y.pontos - x.pontos || x.coberturas - y.coberturas || x.nome.localeCompare(y.nome)).slice(0, cfg.substituicao.maxSugestoes as number);
}

/** Histórico do período: quem mais cobriu, quem mais faltou, taxa de cobertura por unidade. */
export async function historico(ini: string, fim: string, unitId: number | null) {
  const uf = unitId === null ? sql`` : sql`AND ca.unit_id=${unitId}`;
  const [cobriram, faltaram, porUnidade] = await Promise.all([
    sql<{ id: number; nome: string; aulas: number; minutos: number; realizadas: number }[]>`SELECT e.id, e.nome, count(*)::int AS aulas, sum(ca.minutos)::int AS minutos, count(*) FILTER (WHERE ca.status='REALIZADA')::int AS realizadas FROM cover_assignments ca JOIN employees e ON e.id=ca.cobertura_employee_id WHERE ca.status IN ('CONFIRMADA','REALIZADA') AND ca.data BETWEEN ${ini} AND ${fim} ${uf} GROUP BY e.id, e.nome ORDER BY aulas DESC, minutos DESC, e.nome`,
    sql<{ id: number; nome: string; dias: number; aulas: number; descobertas: number }[]>`SELECT e.id, e.nome, count(DISTINCT ca.data)::int AS dias, count(*)::int AS aulas, count(*) FILTER (WHERE ca.status IN ('ABERTA','CONVIDADO','SEM_PROFESSOR'))::int AS descobertas FROM cover_assignments ca JOIN employees e ON e.id=ca.ausente_employee_id WHERE ca.status <> 'CANCELADA' AND ca.data BETWEEN ${ini} AND ${fim} ${uf} GROUP BY e.id, e.nome ORDER BY aulas DESC, e.nome`,
    sql<{ unidade: string; total: number; cobertas: number; sem_professor: number; abertas: number }[]>`SELECT u.nome AS unidade, count(*)::int AS total, count(*) FILTER (WHERE ca.status IN ('CONFIRMADA','REALIZADA'))::int AS cobertas, count(*) FILTER (WHERE ca.status='SEM_PROFESSOR')::int AS sem_professor, count(*) FILTER (WHERE ca.status IN ('ABERTA','CONVIDADO'))::int AS abertas FROM cover_assignments ca JOIN units u ON u.id=ca.unit_id WHERE ca.status <> 'CANCELADA' AND ca.data BETWEEN ${ini} AND ${fim} ${uf} GROUP BY u.nome ORDER BY u.nome`]);
  return { cobriram, faltaram, porUnidade };
}

/** Aulas ainda sem solução num dia (rotina e Command Center). */
export async function semCobertura(data: string, unitId: number | null) {
  const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM cover_assignments WHERE data=${data} AND status IN ('ABERTA','CONVIDADO') ${unitId === null ? sql`` : sql`AND unit_id=${unitId}`}`;
  return r.n;
}
