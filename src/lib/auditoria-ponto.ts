import { sql } from "@/db";
import { getSettings, hoje } from "./utils";
import { mesLimites, montarMes } from "./ponto";

/**
 * T-050 · Auditoria do ponto: o espelho do relógio (Secullum) confrontado dia a dia com a CH esperada pela jornada/grade vigente
 * (CRQ-TMP-V3-01). Divergências tipificadas, com decisão humana: aceitar (vira lançamento para aprovação), devolver ao relógio
 * (erro de marcação: corrigir no Secullum e reimportar), anexar atestado ou corrigir a CH. Nunca dado clínico (só o documento).
 */
export const DIV_TIPO: Record<string, { rotulo: string; ajuda: string }> = {
  ATRASO: { rotulo: "Atraso", ajuda: "Primeira marcação depois do início da jornada." },
  SAIDA_ANTECIPADA: { rotulo: "Saída antecipada", ajuda: "Última marcação antes do fim da jornada." },
  DEFICIT: { rotulo: "Atraso ou saída antecipada", ajuda: "Trabalhado abaixo da CH (sem marcações para tipificar)." },
  HORA_EXTRA: { rotulo: "Hora extra", ajuda: "Trabalhado acima da CH." },
  MARCACAO_IMPAR: { rotulo: "Erro de marcação", ajuda: "Número ímpar de marcações no dia." },
  SEM_MARCACAO: { rotulo: "Dia sem marcação", ajuda: "Dia com CH e nenhuma marcação nem justificativa." },
  TRABALHO_SEM_ESCALA: { rotulo: "Trabalho em dia sem jornada", ajuda: "Marcações em feriado, folga ou dia sem CH." },
  CH_DIVERGENTE: { rotulo: "CH do relógio ≠ jornada/grade", ajuda: "A CH que veio do relógio difere da jornada vigente." },
  ATESTADO_SEM_DOC: { rotulo: "Atestado sem documento", ajuda: "Dia abonado por atestado sem o documento anexado." },
};
export const DIV_STATUS: Record<string, [string, string]> = { ABERTA: ["PENDENTE", "aberta"], ACEITA: ["APROVADA", "aceita"], DEVOLVIDA: ["SOLICITADA", "devolvida ao relógio"], CORRIGIDA: ["APROVADA", "CH corrigida"], ABONADA: ["APROVADA", "documento anexado"], RESOLVIDA: ["CANCELADA", "resolvida na reimportação"] };
/** O que cada tipo permite decidir. */
export const ACOES: Record<string, ("ACEITAR" | "DEVOLVER" | "CORRIGIR_CH" | "ANEXAR")[]> = {
  ATRASO: ["ACEITAR", "DEVOLVER"], SAIDA_ANTECIPADA: ["ACEITAR", "DEVOLVER"], DEFICIT: ["ACEITAR", "DEVOLVER"], HORA_EXTRA: ["ACEITAR", "DEVOLVER"], TRABALHO_SEM_ESCALA: ["ACEITAR", "DEVOLVER"],
  MARCACAO_IMPAR: ["DEVOLVER", "ACEITAR"], SEM_MARCACAO: ["DEVOLVER", "ACEITAR"], CH_DIVERGENTE: ["CORRIGIR_CH", "ACEITAR"], ATESTADO_SEM_DOC: ["ANEXAR", "DEVOLVER"],
};

const hhmm = (t: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const fmt = (m: number) => `${Math.floor(Math.abs(m) / 60)}h${String(Math.abs(m) % 60).padStart(2, "0")}`;
const relogio = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const SIGLAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
/** Início e fim esperados no dia a partir do texto de horários da jornada ("07:00–11:30 e 13:00–17:00" ou "Seg 07:00–11:30 · Ter …"). */
export function janelaEsperada(horarios: string | null | undefined, dow: number): { ini: number; fim: number } | null {
  if (!horarios) return null;
  const sem = horarios.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  let trecho = sem;
  if (/\b(seg|ter|qua|qui|sex|sab)\b/.test(sem)) { const partes = sem.split(/·|\||;/).map(x => x.trim()); trecho = partes.find(p => p.startsWith(SIGLAS[dow])) ?? ""; }
  const hs = [...trecho.matchAll(/(\d{1,2}):(\d{2})/g)].map(m => Number(m[1]) * 60 + Number(m[2])); if (hs.length < 2) return null;
  return { ini: Math.min(...hs), fim: Math.max(...hs) };
}
export const marcacoesDe = (t: string | null | undefined) => [...(t ?? "").matchAll(/\b(\d{1,2}):(\d{2})\b/g)].map(m => `${m[1].padStart(2, "0")}:${m[2]}`);

type Achado = { employeeId: number; unitId: number; data: string; tipo: string; minutos: number; detalhe: string };
/** Achados do mês para um colaborador (dias lançados × regra). */
async function achadosDoColaborador(employeeId: number, mes: string, cfg: Awaited<ReturnType<typeof getSettings>>): Promise<Achado[]> {
  const a = cfg.auditoriaPonto; const tol = Number(a.toleranciaDiaMin), he = Number(a.heMinimaMin);
  const { dias, emp } = await montarMes(employeeId, mes);
  const { ini, fim } = mesLimites(mes);
  const [regra, horarios, anexos] = await Promise.all([
    regraDoMes(employeeId, mes),
    sql<{ vigencia_inicio: string; vigencia_fim: string | null; horarios: string | null }[]>`SELECT vigencia_inicio::text, vigencia_fim::text, horarios FROM schedules WHERE employee_id=${employeeId} AND vigencia_inicio <= ${fim} AND (vigencia_fim IS NULL OR vigencia_fim >= ${ini})`,
    sql<{ entidade_id: number }[]>`SELECT entidade_id FROM attachments WHERE entidade='timesheet_day' AND entidade_id IN (SELECT id FROM timesheet_days WHERE employee_id=${employeeId} AND data BETWEEN ${ini} AND ${fim})`,
  ]);
  const comDoc = new Set(anexos.map(x => x.entidade_id)); const out: Achado[] = []; const h = hoje();
  for (const d of dias) {
    if (!d.salvo || d.data > h) continue;
    const add = (tipo: string, minutos: number, detalhe: string) => out.push({ employeeId, unitId: emp.unit_id, data: d.data, tipo, minutos, detalhe });
    const esperadoRegra = regra.get(d.data); const marc = marcacoesDe(d.marcacoes);
    const jan = janelaEsperada(horarios.find(x => x.vigencia_inicio <= d.data && (!x.vigencia_fim || x.vigencia_fim >= d.data))?.horarios, d.dow);
    if (["NORMAL", "FALTA"].includes(d.status) && esperadoRegra !== undefined && esperadoRegra !== d.esperado && Math.abs(esperadoRegra - d.esperado) > 0)
      add("CH_DIVERGENTE", d.esperado - esperadoRegra, `Relógio: ${fmt(d.esperado)} · jornada/grade: ${fmt(esperadoRegra)}`);
    if (d.status === "ATESTADO" && a.exigirAnexoAtestado && d.id && !comDoc.has(d.id)) add("ATESTADO_SEM_DOC", 0, "Dia abonado sem o atestado anexado");
    if (d.status !== "NORMAL") continue;
    if (d.esperado === 0 && d.trabalhado > 0) { add("TRABALHO_SEM_ESCALA", d.trabalhado, `${fmt(d.trabalhado)} trabalhadas em dia sem CH${d.calendario ? ` (${d.calendario})` : ""}`); continue; }
    if (marc.length % 2 === 1) add("MARCACAO_IMPAR", 0, `${marc.length} marcação(ões): ${marc.join(" ")}`);
    if (d.esperado > 0 && d.trabalhado === 0 && !marc.length) { add("SEM_MARCACAO", d.esperado, `CH de ${fmt(d.esperado)} sem nenhuma marcação`); continue; }
    const diff = d.trabalhado - d.esperado;
    if (diff < -tol) {
      const primeira = marc.length ? hhmm(marc[0]) : null, ultima = marc.length ? hhmm(marc[marc.length - 1]) : null;
      const atraso = jan && primeira !== null ? primeira - jan.ini : null, saida = jan && ultima !== null ? jan.fim - ultima : null;
      if (atraso !== null && atraso > 5 && (saida === null || saida <= 5)) add("ATRASO", -diff, `Entrada ${marc[0]} (jornada ${relogio(jan!.ini)}) · faltaram ${fmt(-diff)}`);
      else if (saida !== null && saida > 5 && (atraso === null || atraso <= 5)) add("SAIDA_ANTECIPADA", -diff, `Saída ${marc[marc.length - 1]} (jornada até ${relogio(jan!.fim)}) · faltaram ${fmt(-diff)}`);
      else add("DEFICIT", -diff, `Trabalhou ${fmt(d.trabalhado)} de ${fmt(d.esperado)}${marc.length ? ` (${marc.join(" ")})` : ""}`);
    } else if (diff >= he) add("HORA_EXTRA", diff, `Trabalhou ${fmt(d.trabalhado)} de ${fmt(d.esperado)} (+${fmt(diff)})`);
  }
  return out;
}
/** CH pela regra (jornada vigente/grade, calendário, férias e afastamentos), dia a dia — o que o ONE calcularia sem o relógio. */
async function regraDoMes(employeeId: number, mes: string) {
  // montarMes devolve os dias salvos com o valor salvo; para a regra, recalculamos ignorando o que foi salvo
  const { ini, fim, dias: nd } = mesLimites(mes);
  const [emp] = await sql<{ unit_id: number; regime: string; jornada_min_dia: number | null; admissao: string; desligamento: string | null }[]>`SELECT unit_id, regime, jornada_min_dia, admissao::text, desligamento::text FROM employees WHERE id=${employeeId}`;
  const [cal, leaves, jornadas] = await Promise.all([
    sql<{ data: string; tipo: string }[]>`SELECT data::text, tipo FROM calendar_days WHERE data BETWEEN ${ini} AND ${fim} AND (publico='TODOS' OR publico=${emp.regime}) AND (unit_id IS NULL OR unit_id=${emp.unit_id})`,
    sql<{ inicio: string; fim: string; tipo: string }[]>`SELECT inicio::text, fim::text, tipo FROM leave_requests WHERE employee_id=${employeeId} AND status='APROVADA' AND inicio <= ${fim} AND fim >= ${ini}`,
    sql<{ vigencia_inicio: string; vigencia_fim: string | null; seg: number; ter: number; qua: number; qui: number; sex: number; sab: number; dom: number }[]>`SELECT vigencia_inicio::text, vigencia_fim::text, seg, ter, qua, qui, sex, sab, dom FROM schedules WHERE employee_id=${employeeId} ORDER BY vigencia_inicio DESC`,
  ]);
  const DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const; const ZERA = new Set(["FERIADO", "NAO_LETIVO", "FERIAS_COLETIVAS", "DISPENSA", "PONTO_FACULTATIVO"]);
  const out = new Map<string, number>();
  for (let d = 1; d <= nd; d++) {
    const data = `${mes}-${String(d).padStart(2, "0")}`; const dow = new Date(data + "T00:00:00Z").getUTCDay();
    const j = jornadas.find(x => x.vigencia_inicio <= data && (!x.vigencia_fim || x.vigencia_fim >= data));
    let e = j ? j[DOW[dow]] : (dow === 0 || dow === 6 ? 0 : emp.jornada_min_dia ?? 0);
    if (data < emp.admissao || (emp.desligamento && data > emp.desligamento)) e = 0;
    const l = leaves.find(x => x.inicio <= data && x.fim >= data); if (l && l.tipo !== "FOLGA_BANCO") e = 0;
    const c = cal.find(x => x.data === data); if (c && ZERA.has(c.tipo)) e = 0;
    out.set(data, e);
  }
  return out;
}

/** Processa a auditoria do mês (unidade ou rede): grava achados novos como ABERTA, atualiza os abertos e resolve os que sumiram (reimportação corrigida). */
export async function processarAuditoria(unitId: number | null, mes: string) {
  const cfg = await getSettings(); const { ini, fim } = mesLimites(mes);
  const emps = await sql<{ id: number }[]>`SELECT DISTINCT t.employee_id AS id FROM timesheet_days t JOIN employees e ON e.id=t.employee_id WHERE t.data BETWEEN ${ini} AND ${fim} ${unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`}`;
  let novos = 0, atualizados = 0, resolvidos = 0; const vistos = new Set<string>();
  for (const e of emps) {
    const achados = await achadosDoColaborador(e.id, mes, cfg);
    for (const a of achados) {
      vistos.add(`${a.employeeId}|${a.data}|${a.tipo}`);
      const r = await sql<{ novo: boolean }[]>`INSERT INTO timesheet_audit (employee_id, unit_id, data, tipo, minutos, detalhe) VALUES (${a.employeeId}, ${a.unitId}, ${a.data}, ${a.tipo}, ${a.minutos}, ${a.detalhe})
        ON CONFLICT (employee_id, data, tipo) DO UPDATE SET minutos=EXCLUDED.minutos, detalhe=EXCLUDED.detalhe, unit_id=EXCLUDED.unit_id, updated_at=now(), status=CASE WHEN timesheet_audit.status='RESOLVIDA' THEN 'ABERTA' ELSE timesheet_audit.status END
        RETURNING (xmax = 0) AS novo`;
      if (r[0]?.novo) novos++; else atualizados++;
    }
  }
  const abertos = await sql<{ id: number; employee_id: number; data: string; tipo: string }[]>`SELECT id, employee_id, data::text, tipo FROM timesheet_audit WHERE data BETWEEN ${ini} AND ${fim} AND status IN ('ABERTA','DEVOLVIDA') ${unitId === null ? sql`` : sql`AND unit_id=${unitId}`}`;
  const sumiram = abertos.filter(x => !vistos.has(`${x.employee_id}|${x.data}|${x.tipo}`)).map(x => x.id);
  if (sumiram.length) { await sql`UPDATE timesheet_audit SET status='RESOLVIDA', decisao_obs=coalesce(decisao_obs, 'Não aparece mais no espelho (reimportação corrigida)'), updated_at=now() WHERE id = ANY(${sumiram})`; resolvidos = sumiram.length; }
  return { colaboradores: emps.length, novos, atualizados, resolvidos };
}

export type LinhaDiv = { id: number; employee_id: number; nome: string; unidade: string; data: string; tipo: string; minutos: number; detalhe: string | null; status: string; decisao_obs: string | null; decidido_por: string | null; decidido_em: string | null; hour_entry_id: number | null; day_id: number | null };
export async function divergencias(unitId: number | null, mes: string, filtro: { status?: string | null; tipo?: string | null; employeeId?: number | null } = {}) {
  const { ini, fim } = mesLimites(mes);
  return sql<LinhaDiv[]>`SELECT a.id, a.employee_id, e.nome, u.nome AS unidade, a.data::text, a.tipo, a.minutos, a.detalhe, a.status, a.decisao_obs, us.nome AS decidido_por, a.decidido_em::text, a.hour_entry_id,
      (SELECT t.id FROM timesheet_days t WHERE t.employee_id=a.employee_id AND t.data=a.data) AS day_id
    FROM timesheet_audit a JOIN employees e ON e.id=a.employee_id JOIN units u ON u.id=e.unit_id LEFT JOIN users us ON us.id=a.decidido_por
    WHERE a.data BETWEEN ${ini} AND ${fim} ${unitId === null ? sql`` : sql`AND a.unit_id=${unitId}`} ${filtro.status ? sql`AND a.status=${filtro.status}` : sql``} ${filtro.tipo ? sql`AND a.tipo=${filtro.tipo}` : sql``} ${filtro.employeeId ? sql`AND a.employee_id=${filtro.employeeId}` : sql``}
    ORDER BY e.nome, a.data, a.tipo`;
}
/** Resumo por colaborador: quantos achados por tipo, minutos de déficit e de extra, abertos. */
export async function resumoAuditoria(unitId: number | null, mes: string) {
  const { ini, fim } = mesLimites(mes);
  return sql<{ employee_id: number; nome: string; unidade: string; total: number; abertas: number; deficit: number; extra: number; marcacao: number; ch: number; atestado: number }[]>`SELECT a.employee_id, e.nome, u.nome AS unidade, count(*)::int AS total, count(*) FILTER (WHERE a.status='ABERTA')::int AS abertas,
      coalesce(sum(a.minutos) FILTER (WHERE a.tipo IN ('ATRASO','SAIDA_ANTECIPADA','DEFICIT','SEM_MARCACAO')), 0)::int AS deficit, coalesce(sum(a.minutos) FILTER (WHERE a.tipo IN ('HORA_EXTRA','TRABALHO_SEM_ESCALA')), 0)::int AS extra,
      count(*) FILTER (WHERE a.tipo IN ('MARCACAO_IMPAR','SEM_MARCACAO'))::int AS marcacao, count(*) FILTER (WHERE a.tipo='CH_DIVERGENTE')::int AS ch, count(*) FILTER (WHERE a.tipo='ATESTADO_SEM_DOC')::int AS atestado
    FROM timesheet_audit a JOIN employees e ON e.id=a.employee_id JOIN units u ON u.id=e.unit_id WHERE a.data BETWEEN ${ini} AND ${fim} AND a.status <> 'RESOLVIDA' ${unitId === null ? sql`` : sql`AND a.unit_id=${unitId}`}
    GROUP BY a.employee_id, e.nome, u.nome ORDER BY abertas DESC, e.nome`;
}
/** Abertas no mês da unidade: entram nas pendências do fechamento do ponto. */
export async function abertasNoMes(unitId: number, mes: string) {
  const { ini, fim } = mesLimites(mes);
  const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM timesheet_audit WHERE unit_id=${unitId} AND data BETWEEN ${ini} AND ${fim} AND status='ABERTA'`; return r?.n ?? 0;
}
