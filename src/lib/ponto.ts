import { sql } from "@/db";
import { hoje, getSettings } from "./utils";
import type { Session } from "./auth";
import { can } from "./auth";

export const PONTO_STATUS = ["NORMAL", "FALTA", "ATESTADO", "FOLGA_BANCO", "DISPENSA", "FERIAS", "AFASTADO", "RECESSO", "FERIADO", "NAO_LETIVO", "DSR"] as const;
export const PONTO_LABEL: Record<string, string> = { NORMAL: "Normal", FALTA: "Falta", ATESTADO: "Atestado (abonado)", FOLGA_BANCO: "Folga do banco", DISPENSA: "Dispensa", FERIAS: "Férias", AFASTADO: "Afastamento", RECESSO: "Recesso", FERIADO: "Feriado", NAO_LETIVO: "Não letivo", DSR: "Descanso semanal" };
export const CAL_TIPOS: Record<string, string> = { FERIADO: "Feriado", NAO_LETIVO: "Dia não letivo", RECESSO: "Recesso (desconta do banco)", FERIAS_COLETIVAS: "Férias coletivas", DISPENSA: "Dispensa", PONTO_FACULTATIVO: "Ponto facultativo" };
const ZERA: Record<string, boolean> = { FERIADO: true, NAO_LETIVO: true, FERIAS_COLETIVAS: true, DISPENSA: true, PONTO_FACULTATIVO: true, RECESSO: false };

export type Dia = { data: string; dow: number; esperado: number; trabalhado: number; status: string; obs: string | null; marcacoes: string | null; origem: string; salvo: boolean; calendario: string | null; id: number | null };

export function mesLimites(mes: string) {
  const [y, m] = mes.split("-").map(Number); const fim = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { ini: `${mes}-01`, fim, dias: Number(fim.slice(8, 10)) };
}
const DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;

/** Carga esperada por dia da semana: jornada vigente ou, na falta dela, a carga diária fixa (seg–sex). */
export async function jornadaVigente(employeeId: number, data: string) {
  const [j] = await sql<{ seg: number; ter: number; qua: number; qui: number; sex: number; sab: number; dom: number }[]>`SELECT seg, ter, qua, qui, sex, sab, dom FROM schedules WHERE employee_id=${employeeId} AND vigencia_inicio <= ${data} AND (vigencia_fim IS NULL OR vigencia_fim >= ${data}) ORDER BY vigencia_inicio DESC LIMIT 1`;
  return j ?? null;
}

/** Monta o mês do colaborador: dias salvos + dias calculados (calendário, jornada, férias/afastamentos aprovados). */
export async function montarMes(employeeId: number, mes: string): Promise<{ dias: Dia[]; emp: { id: number; nome: string; unit_id: number; regime: string; jornada_min_dia: number | null; admissao: string; desligamento: string | null } }> {
  const { ini, fim, dias: nd } = mesLimites(mes);
  const [emp] = await sql<{ id: number; nome: string; unit_id: number; regime: string; jornada_min_dia: number | null; admissao: string; desligamento: string | null }[]>`SELECT id, nome, unit_id, regime, jornada_min_dia, admissao::text, desligamento::text FROM employees WHERE id=${employeeId}`;
  if (!emp) throw new Error("Colaborador não encontrado.");
  const [salvos, cal, leaves, jornadas] = await Promise.all([
    sql<{ id: number; data: string; esperado_min: number; trabalhado_min: number; status: string; obs: string | null; marcacoes: string | null; origem: string }[]>`SELECT id, data::text, esperado_min, trabalhado_min, status, obs, marcacoes, origem FROM timesheet_days WHERE employee_id=${employeeId} AND data BETWEEN ${ini} AND ${fim}`,
    sql<{ data: string; tipo: string; descricao: string | null }[]>`SELECT data::text, tipo, descricao FROM calendar_days WHERE data BETWEEN ${ini} AND ${fim} AND (publico='TODOS' OR publico=${emp.regime}) AND (unit_id IS NULL OR unit_id=${emp.unit_id}) ORDER BY data`,
    sql<{ inicio: string; fim: string; tipo: string }[]>`SELECT inicio::text, fim::text, tipo FROM leave_requests WHERE employee_id=${employeeId} AND status='APROVADA' AND inicio <= ${fim} AND fim >= ${ini}`,
    sql<{ vigencia_inicio: string; vigencia_fim: string | null; seg: number; ter: number; qua: number; qui: number; sex: number; sab: number; dom: number }[]>`SELECT vigencia_inicio::text, vigencia_fim::text, seg, ter, qua, qui, sex, sab, dom FROM schedules WHERE employee_id=${employeeId} ORDER BY vigencia_inicio DESC`,
  ]);
  const out: Dia[] = [];
  for (let d = 1; d <= nd; d++) {
    const data = `${mes}-${String(d).padStart(2, "0")}`; const dow = new Date(data + "T00:00:00Z").getUTCDay();
    const salvo = salvos.find(x => x.data === data);
    const jornada = jornadas.find(j => j.vigencia_inicio <= data && (!j.vigencia_fim || j.vigencia_fim >= data));
    let esperado = jornada ? jornada[DOW[dow]] : (dow === 0 || dow === 6 ? 0 : emp.jornada_min_dia ?? 0);
    const c = cal.find(x => x.data === data); const l = leaves.find(x => x.inicio <= data && x.fim >= data);
    let status = "NORMAL"; let trabalhado = esperado;
    if (data < emp.admissao || (emp.desligamento && data > emp.desligamento)) { esperado = 0; trabalhado = 0; status = "DSR"; }
    else if (l) { status = l.tipo === "FERIAS" ? "FERIAS" : l.tipo === "FOLGA_BANCO" ? "FOLGA_BANCO" : "AFASTADO"; trabalhado = 0; if (status !== "FOLGA_BANCO") esperado = 0; }
    else if (c) { if (ZERA[c.tipo]) { esperado = 0; trabalhado = 0; status = c.tipo === "FERIAS_COLETIVAS" ? "FERIAS" : c.tipo === "NAO_LETIVO" ? "NAO_LETIVO" : c.tipo === "DISPENSA" || c.tipo === "PONTO_FACULTATIVO" ? "DISPENSA" : "FERIADO"; } else { status = "RECESSO"; trabalhado = 0; } }
    else if (esperado === 0) { status = "DSR"; trabalhado = 0; }
    if (salvo) out.push({ data, dow, esperado: salvo.esperado_min, trabalhado: salvo.trabalhado_min, status: salvo.status, obs: salvo.obs, marcacoes: salvo.marcacoes, origem: salvo.origem, salvo: true, calendario: c?.descricao ?? null, id: salvo.id });
    else out.push({ data, dow, esperado, trabalhado, status, obs: null, marcacoes: null, origem: "AUTO", salvo: false, calendario: c?.descricao ?? null, id: null });
  }
  return { dias: out, emp };
}

/** Diferença do dia para o banco de horas (minutos): positivo = crédito, negativo = débito. */
export function diffDia(d: { esperado: number; trabalhado: number; status: string }) {
  switch (d.status) {
    case "NORMAL": case "RECESSO": return d.trabalhado - d.esperado;
    case "FALTA": case "FOLGA_BANCO": return -d.esperado;
    default: return 0; // abonados / sem expectativa
  }
}
export function tipoLancamento(d: { status: string }, diff: number) {
  if (diff > 0) return "EXTRA";
  if (d.status === "FALTA" || d.status === "RECESSO") return "FALTA";
  if (d.status === "FOLGA_BANCO") return "COMPENSACAO";
  return "ATRASO";
}

/** Salva os dias (upsert) e regenera os lançamentos do banco de horas ligados a cada dia. */
export async function salvarDias(s: Session, employeeId: number, dias: { data: string; esperado: number; trabalhado: number; status: string; obs?: string | null; marcacoes?: string | null; origem?: string }[]) {
  const cfg = await getSettings(); const aprova = can.aprovar(s, cfg.alcadas.banco);
  let gerados = 0, saldo = 0;
  await sql.begin(async tx => {
    for (const d of dias) {
      if (!PONTO_STATUS.includes(d.status as typeof PONTO_STATUS[number])) throw new Error(`Situação inválida em ${d.data}.`);
      const [row] = await tx<{ id: number }[]>`INSERT INTO timesheet_days (employee_id, data, esperado_min, trabalhado_min, status, obs, marcacoes, origem, updated_by, updated_at)
        VALUES (${employeeId}, ${d.data}, ${d.esperado}, ${d.trabalhado}, ${d.status}, ${d.obs ?? null}, ${d.marcacoes ?? null}, ${d.origem ?? "MANUAL"}, ${s.id}, now())
        ON CONFLICT (employee_id, data) DO UPDATE SET esperado_min=EXCLUDED.esperado_min, trabalhado_min=EXCLUDED.trabalhado_min, status=EXCLUDED.status, obs=EXCLUDED.obs, marcacoes=EXCLUDED.marcacoes, origem=EXCLUDED.origem, updated_by=EXCLUDED.updated_by, updated_at=now() RETURNING id`;
      await tx`DELETE FROM hour_entries WHERE timesheet_day_id=${row.id}`;
      const diff = diffDia(d);
      if (diff !== 0) {
        const tipo = tipoLancamento(d, diff);
        const desc = `Ponto ${d.data.split("-").reverse().join("/")}: ${PONTO_LABEL[d.status]}${d.status === "NORMAL" ? ` (${d.trabalhado}/${d.esperado} min)` : ""}`;
        await tx`INSERT INTO hour_entries (employee_id, data, minutos, tipo, descricao, status, lancado_por, aprovado_por, timesheet_day_id) VALUES (${employeeId}, ${d.data}, ${diff}, ${tipo}, ${desc}, ${aprova ? "APROVADO" : "PENDENTE"}, ${s.id}, ${aprova ? s.id : null}, ${row.id})`;
        gerados++; saldo += diff;
      }
    }
  });
  return { gerados, saldo, aprovados: aprova };
}

export async function resumoMes(unitId: number | null, mes: string) {
  const { ini, fim } = mesLimites(mes);
  return sql<{ id: number; nome: string; unidade: string; regime: string; jornada_min_dia: number | null; dias_salvos: number; esperado: number; trabalhado: number; faltas: number; atestados: number; saldo_mes: number; tem_jornada: boolean }[]>`
    SELECT e.id, e.nome, u.nome AS unidade, e.regime, e.jornada_min_dia,
      (SELECT count(*) FROM timesheet_days t WHERE t.employee_id=e.id AND t.data BETWEEN ${ini} AND ${fim})::int AS dias_salvos,
      coalesce((SELECT sum(esperado_min) FROM timesheet_days t WHERE t.employee_id=e.id AND t.data BETWEEN ${ini} AND ${fim}),0)::int AS esperado,
      coalesce((SELECT sum(trabalhado_min) FROM timesheet_days t WHERE t.employee_id=e.id AND t.data BETWEEN ${ini} AND ${fim}),0)::int AS trabalhado,
      (SELECT count(*) FROM timesheet_days t WHERE t.employee_id=e.id AND t.data BETWEEN ${ini} AND ${fim} AND t.status='FALTA')::int AS faltas,
      (SELECT count(*) FROM timesheet_days t WHERE t.employee_id=e.id AND t.data BETWEEN ${ini} AND ${fim} AND t.status='ATESTADO')::int AS atestados,
      coalesce((SELECT sum(h.minutos) FROM hour_entries h WHERE h.employee_id=e.id AND h.timesheet_day_id IS NOT NULL AND h.data BETWEEN ${ini} AND ${fim}),0)::int AS saldo_mes,
      EXISTS (SELECT 1 FROM schedules sc WHERE sc.employee_id=e.id AND sc.vigencia_inicio <= ${fim} AND (sc.vigencia_fim IS NULL OR sc.vigencia_fim >= ${ini})) AS tem_jornada
    FROM employees e JOIN units u ON u.id=e.unit_id WHERE e.situacao <> 'DESLIGADO' ${unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`} ORDER BY u.nome, e.nome`;
}

export const mesAtual = () => hoje().slice(0, 7);
