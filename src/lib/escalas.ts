/**
 * v34 · Escalas de trabalho das equipes de apoio (portaria, limpeza, cozinha, manutenção): turnos, equipes por unidade, a escala
 * dia a dia, padrões (12x36, 5x2, 6x1), cópia da semana, publicação (a equipe vê no Meu espaço) e os alertas que evitam problema
 * trabalhista: descanso entre jornadas (11 h), turno longo, 7 dias sem folga, pessoa de férias escalada e cobertura mínima.
 * A escala publicada vira a jornada esperada do dia no espelho do ponto.
 */
import { sql } from "@/db";
import type { Session } from "./auth";
import { scopeUnit } from "./auth";
import { addDays } from "./utils";

export type Turno = { id: number; nome: string; sigla: string | null; inicio: string; fim: string; intervalo_min: number; cor: string; ativo: boolean };
export type Celula = { employeeId: number; data: string; turnoId: number | null; folga: boolean };
export const CORES: Record<string, string> = { sky: "bg-sky-100 text-sky-900 border-sky-200", amber: "bg-amber-100 text-amber-900 border-amber-200", emerald: "bg-emerald-100 text-emerald-900 border-emerald-200", violet: "bg-violet-100 text-violet-900 border-violet-200", rose: "bg-rose-100 text-rose-900 border-rose-200", slate: "bg-slate-200 text-slate-800 border-slate-300" };
export const DIAS_SEM = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
/** Dias em que a cobertura mínima da equipe vale (limpeza e cozinha costumam ser de segunda a sexta; portaria, todos os dias). */
export const DIAS_COBERTURA: Record<string, string> = { TODOS: "todos os dias", SEG_SAB: "segunda a sábado", SEG_SEX: "segunda a sexta" };

export const minutosDe = (h: string) => { const [a, b] = h.split(":").map(Number); return a * 60 + b; };
/** Duração do turno em minutos (sem o intervalo). Turno que vira a noite (fim antes do início) atravessa a meia-noite. */
export function duracao(t: Pick<Turno, "inicio" | "fim" | "intervalo_min">) { let d = minutosDe(t.fim) - minutosDe(t.inicio); if (d <= 0) d += 1440; return Math.max(0, d - (t.intervalo_min ?? 0)); }
/** Início e fim absolutos (minutos desde a meia-noite do dia do turno). */
const janela = (t: Pick<Turno, "inicio" | "fim">) => { const i = minutosDe(t.inicio); let f = minutosDe(t.fim); if (f <= i) f += 1440; return { i, f }; };
export const segunda = (data: string) => { const d = new Date(`${data}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
export const diasDaSemana = (seg: string) => Array.from({ length: 7 }, (_, i) => addDays(seg, i));
export const fmtTurno = (t: Pick<Turno, "inicio" | "fim">) => `${t.inicio}–${t.fim}`;

/** Quem monta a escala da equipe: RH e Direção; direção da unidade (a própria); Operações; o(a) responsável pela equipe. */
export function podeEditarEquipe(s: Session, team: { unit_id: number; responsavel_user_id: number | null }) {
  if (["RH", "DIRECAO", "OPERACOES"].includes(s.role)) return true;
  if (s.role === "DIRETOR_UNIDADE" && scopeUnit(s) === team.unit_id) return true;
  return team.responsavel_user_id === s.id;
}
export const veEscalas = (s: Session) => ["RH", "DIRECAO", "DIRETOR_UNIDADE", "OPERACOES", "GESTOR"].includes(s.role);
export const podeTurnos = (s: Session) => ["RH", "DIRECAO", "OPERACOES"].includes(s.role);

export type Alerta = { tipo: "INTERJORNADA" | "TURNO_LONGO" | "SEM_FOLGA" | "AFASTADO" | "COBERTURA" | "DUAS_EQUIPES"; employeeId: number | null; data: string; datas?: string[]; texto: string };

/** Nome curto para os alertas: primeiro e último nome (sem o que vem entre parênteses); se repetir na equipe, o nome completo. */
export function nomesCurtos(xs: { employee_id: number; nome: string }[]): Map<number, string> {
  const curto = (n: string) => { const p = n.replace(/\s*\([^)]*\)/g, " ").trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1]}` : p[0] ?? n; };
  const conta = new Map<string, number>(); for (const x of xs) conta.set(curto(x.nome), (conta.get(curto(x.nome)) ?? 0) + 1);
  return new Map(xs.map(x => [x.employee_id, (conta.get(curto(x.nome)) ?? 0) > 1 ? x.nome : curto(x.nome)]));
}
/**
 * Alertas da semana: olha também os 6 dias antes (sequência sem folga) e o dia anterior (descanso entre jornadas).
 * `cobertura`: [{ turnoId, minimo }] — por dia, quantas pessoas no turno.
 */
export async function alertasSemana(teamId: number, seg: string, cfg: { interjornadaHoras: number; jornadaMaxHoras: number; exigirFolgaSemanal: boolean }): Promise<Alerta[]> {
  const ini = addDays(seg, -6); const fim = addDays(seg, 6);
  const [turnos, cel, membros, [team], afast, outras] = await Promise.all([
    sql<Turno[]>`SELECT id, nome, sigla, inicio, fim, intervalo_min, cor, ativo FROM shift_types`,
    sql<{ employee_id: number; data: string; shift_type_id: number | null; folga: boolean }[]>`SELECT employee_id, data::text, shift_type_id, folga FROM shift_assignments WHERE team_id=${teamId} AND data BETWEEN ${ini} AND ${fim}`,
    sql<{ employee_id: number; nome: string }[]>`SELECT m.employee_id, e.nome FROM shift_team_members m JOIN employees e ON e.id=m.employee_id WHERE m.team_id=${teamId}`,
    sql<{ cobertura: { turnoId: number; minimo: number }[]; cobertura_dias: string }[]>`SELECT cobertura, cobertura_dias FROM shift_teams WHERE id=${teamId}`,
    sql<{ employee_id: number; inicio: string; fim: string; tipo: string }[]>`SELECT employee_id, inicio::text, fim::text, tipo FROM leave_requests WHERE status='APROVADA' AND inicio <= ${fim} AND fim >= ${seg} AND employee_id IN (SELECT employee_id FROM shift_team_members WHERE team_id=${teamId})`,
    sql<{ employee_id: number; data: string; equipe: string }[]>`SELECT a.employee_id, a.data::text, t.nome AS equipe FROM shift_assignments a JOIN shift_teams t ON t.id=a.team_id WHERE a.team_id <> ${teamId} AND a.data BETWEEN ${seg} AND ${fim} AND a.shift_type_id IS NOT NULL AND a.employee_id IN (SELECT employee_id FROM shift_team_members WHERE team_id=${teamId})`,
  ]);
  const T = new Map(turnos.map(t => [t.id, t])); const nome = nomesCurtos(membros);
  const dias = diasDaSemana(seg); const out: Alerta[] = [];
  const de = (e: number, d: string) => cel.find(c => c.employee_id === e && c.data === d);
  const dm = (d: string) => `${DIAS_SEM[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${d.slice(8)}`;
  for (const m of membros) {
    const longos = new Map<number, string[]>(); // turno longo: uma linha por pessoa e turno, com os dias
    for (const d of dias) {
      const c = de(m.employee_id, d); const t = c?.shift_type_id ? T.get(c.shift_type_id) : undefined; if (!t) continue;
      if (duracao(t) > cfg.jornadaMaxHoras * 60) longos.set(t.id, [...(longos.get(t.id) ?? []), d]);
      const ant = de(m.employee_id, addDays(d, -1)); const ta = ant?.shift_type_id ? T.get(ant.shift_type_id) : undefined;
      if (ta) { const fimAnt = janela(ta).f - 1440; const descanso = janela(t).i - fimAnt; if (descanso < cfg.interjornadaHoras * 60) out.push({ tipo: "INTERJORNADA", employeeId: m.employee_id, data: d, texto: `${nome.get(m.employee_id)}: só ${Math.max(0, Math.floor(descanso / 60))} h de descanso entre ${ta.sigla ?? ta.nome} e ${t.sigla ?? t.nome} (mínimo ${cfg.interjornadaHoras} h).` }); }
      const l = afast.find(a => a.employee_id === m.employee_id && a.inicio <= d && a.fim >= d); if (l) out.push({ tipo: "AFASTADO", employeeId: m.employee_id, data: d, texto: `${nome.get(m.employee_id)} está de ${l.tipo === "FERIAS" ? "férias" : "afastamento/folga aprovada"} em ${d.slice(8)}/${d.slice(5, 7)} e foi escalado(a).` });
      const o = outras.find(x => x.employee_id === m.employee_id && x.data === d); if (o) out.push({ tipo: "DUAS_EQUIPES", employeeId: m.employee_id, data: d, texto: `${nome.get(m.employee_id)} também está escalado(a) na equipe ${o.equipe} em ${d.slice(8)}/${d.slice(5, 7)}.` });
    }
    for (const [tid, ds] of longos) { const t = T.get(tid)!; out.push({ tipo: "TURNO_LONGO", employeeId: m.employee_id, data: ds[0], datas: ds, texto: `${nome.get(m.employee_id)}: ${ds.length === 1 ? "turno" : `${ds.length} turnos`} ${t.sigla ?? t.nome} de ${(duracao(t) / 60).toFixed(1).replace(".", ",")} h (acima de ${cfg.jornadaMaxHoras} h) — ${ds.map(dm).join(", ")}. Confira se há acordo ou convenção (12x36).` }); }
    if (cfg.exigirFolgaSemanal) {
      // 7 dias seguidos trabalhando (sem folga) terminando dentro da semana
      for (const d of dias) { let seguidos = 0; for (let k = 0; k < 7; k++) { const c = de(m.employee_id, addDays(d, -k)); if (c?.shift_type_id) seguidos++; else break; } if (seguidos === 7) { out.push({ tipo: "SEM_FOLGA", employeeId: m.employee_id, data: d, texto: `${nome.get(m.employee_id)}: 7 dias seguidos sem folga até ${d.slice(8)}/${d.slice(5, 7)} (descanso semanal remunerado).` }); break; } }
    }
  }
  for (const regra of team?.cobertura ?? []) {
    const t = T.get(regra.turnoId); if (!t || !regra.minimo) continue;
    for (const d of dias) { const dow = new Date(`${d}T12:00:00Z`).getUTCDay(); if ((team?.cobertura_dias === "SEG_SEX" && (dow === 0 || dow === 6)) || (team?.cobertura_dias === "SEG_SAB" && dow === 0)) continue;
      const n = cel.filter(c => c.data === d && c.shift_type_id === regra.turnoId).length; if (n < regra.minimo) out.push({ tipo: "COBERTURA", employeeId: null, data: d, texto: `${DIAS_SEM[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${d.slice(8)}/${d.slice(5, 7)}: ${n} de ${regra.minimo} pessoa(s) no turno ${t.sigla ?? t.nome}.` }); }
  }
  return out;
}

/** Minutos esperados por dia a partir da escala PUBLICADA (para o espelho do ponto). Folga = 0. */
export async function esperadoPelaEscala(employeeId: number, ini: string, fim: string): Promise<Map<string, number>> {
  const rows = await sql<{ data: string; folga: boolean; inicio: string | null; fim: string | null; intervalo_min: number | null }[]>`
    SELECT a.data::text, a.folga, t.inicio, t.fim, t.intervalo_min FROM shift_assignments a LEFT JOIN shift_types t ON t.id=a.shift_type_id
    WHERE a.employee_id=${employeeId} AND a.data BETWEEN ${ini} AND ${fim} AND (a.shift_type_id IS NOT NULL OR a.folga)
      AND EXISTS (SELECT 1 FROM shift_publications p WHERE p.team_id=a.team_id AND p.semana = (a.data - ((extract(isodow from a.data)::int + 6) % 7))::date)`;
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.data, r.folga || !r.inicio || !r.fim ? 0 : duracao({ inicio: r.inicio, fim: r.fim, intervalo_min: r.intervalo_min ?? 0 }));
  return m;
}
