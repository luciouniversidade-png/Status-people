import { sql } from "@/db";
import { addDays } from "./utils";

/**
 * Quem está fora (v23): calendário da equipe no mês — férias, folgas, afastamentos e licenças (aprovados e pedidos),
 * ausências registradas para substituição e faltas do ponto — com a concentração por unidade e dia.
 * Tipos sensíveis (afastamento, licença, atestado) aparecem como "Ausência" para quem não trata dados de pessoas.
 */
export type TipoFora = "FERIAS" | "FOLGA" | "AFASTAMENTO" | "FALTA" | "ATESTADO" | "FORMACAO" | "OUTRO";
export const FORA_LABEL: Record<TipoFora, string> = { FERIAS: "Férias", FOLGA: "Folga (banco)", AFASTAMENTO: "Afastamento ou licença", FALTA: "Falta", ATESTADO: "Atestado", FORMACAO: "Formação ou curso", OUTRO: "Outra ausência" };
export const FORA_COR: Record<TipoFora, string> = { FERIAS: "#1f5fa0", FOLGA: "#2a9d8f", AFASTAMENTO: "#8e5bb5", FALTA: "#d1495b", ATESTADO: "#b07cc6", FORMACAO: "#e9a23b", OUTRO: "#7a8696" };
const SENSIVEIS: TipoFora[] = ["AFASTAMENTO", "ATESTADO", "OUTRO"];
/** Para quem não vê dados sensíveis, afastamento/licença/atestado viram uma "Ausência" genérica. */
export function rotuloVisivel(t: TipoFora, sensivel: boolean) { return !sensivel && SENSIVEIS.includes(t) ? "Ausência" : FORA_LABEL[t]; }
export function corVisivel(t: TipoFora, sensivel: boolean) { return !sensivel && SENSIVEIS.includes(t) ? "#7a8696" : FORA_COR[t]; }
const PRIORIDADE: Record<TipoFora, number> = { AFASTAMENTO: 7, FERIAS: 6, ATESTADO: 5, FOLGA: 4, FALTA: 3, FORMACAO: 2, OUTRO: 1 };

export type DiaFora = { tipo: TipoFora; pendente: boolean; origem: string };
export async function quemEstaFora(mes: string, unitId: number | null, todos = false) {
  const [ano, m] = mes.split("-").map(Number); const ini = `${mes}-01`; const fim = new Date(Date.UTC(ano, m, 0)).toISOString().slice(0, 10); // último dia do mês
  const nDias = Number(fim.slice(8, 10)); const dias = Array.from({ length: nDias }, (_, i) => addDays(ini, i));
  const uf = unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`;
  const [licencas, cobert, ponto, feriados, ativos] = await Promise.all([
    sql<{ employee_id: number; tipo: string; inicio: string; fim: string; status: string }[]>`SELECT l.employee_id, l.tipo, l.inicio::text, l.fim::text, l.status FROM leave_requests l JOIN employees e ON e.id=l.employee_id WHERE l.status IN ('APROVADA','SOLICITADA') AND l.inicio <= ${fim}::date AND l.fim >= ${ini}::date ${uf}`,
    sql<{ employee_id: number; data: string; motivo: string }[]>`SELECT a.employee_id, a.data::text, a.motivo FROM cover_absences a JOIN employees e ON e.id=a.employee_id WHERE a.status='ATIVA' AND a.data BETWEEN ${ini}::date AND ${fim}::date ${uf}`,
    sql<{ employee_id: number; data: string; status: string }[]>`SELECT t.employee_id, t.data::text, t.status FROM timesheet_days t JOIN employees e ON e.id=t.employee_id WHERE t.status IN ('FALTA','ATESTADO','AFASTADO','FERIAS','FOLGA_BANCO') AND t.data BETWEEN ${ini}::date AND ${fim}::date ${uf}`,
    sql<{ data: string; tipo: string; descricao: string | null }[]>`SELECT data::text, tipo, descricao FROM calendar_days WHERE data BETWEEN ${ini}::date AND ${fim}::date AND (unit_id IS NULL ${unitId === null ? sql`` : sql`OR unit_id=${unitId}`})`,
    sql<{ id: number; nome: string; unit_id: number; unidade: string; cargo: string | null; admissao: string; desligamento: string | null }[]>`SELECT e.id, e.nome, e.unit_id, u.nome AS unidade, p.nome AS cargo, e.admissao::text, e.desligamento::text FROM employees e JOIN units u ON u.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id WHERE e.situacao <> 'EM_ADMISSAO' AND e.admissao <= ${fim}::date AND (e.desligamento IS NULL OR e.desligamento >= ${ini}::date) ${uf} ORDER BY u.nome, e.nome`,
  ]);
  const mapa = new Map<number, Map<string, DiaFora>>();
  const marca = (emp: number, d: string, x: DiaFora) => { if (d < ini || d > fim) return; if (!mapa.has(emp)) mapa.set(emp, new Map()); const m = mapa.get(emp)!; const atual = m.get(d); if (!atual || (atual.pendente && !x.pendente) || (atual.pendente === x.pendente && PRIORIDADE[x.tipo] > PRIORIDADE[atual.tipo])) m.set(d, x); };
  const deLicenca = (t: string): TipoFora => t === "FERIAS" ? "FERIAS" : t === "FOLGA_BANCO" ? "FOLGA" : t === "AFASTAMENTO_SAUDE" || t === "LICENCA" ? "AFASTAMENTO" : "OUTRO";
  for (const l of licencas) for (let d = l.inicio < ini ? ini : l.inicio; d <= l.fim && d <= fim; d = addDays(d, 1)) marca(l.employee_id, d, { tipo: deLicenca(l.tipo), pendente: l.status === "SOLICITADA", origem: "Férias e afastamentos" });
  const deMotivo = (m: string): TipoFora => m === "FERIAS" ? "FERIAS" : m === "FALTA" ? "FALTA" : m === "ATESTADO" ? "ATESTADO" : m === "AFASTAMENTO" || m === "LICENCA" ? "AFASTAMENTO" : m === "FORMACAO" ? "FORMACAO" : "OUTRO";
  for (const c of cobert) marca(c.employee_id, c.data, { tipo: deMotivo(c.motivo), pendente: false, origem: "Substituição de professores" });
  const dePonto = (st: string): TipoFora => st === "FALTA" ? "FALTA" : st === "ATESTADO" ? "ATESTADO" : st === "FERIAS" ? "FERIAS" : st === "FOLGA_BANCO" ? "FOLGA" : "AFASTAMENTO";
  for (const p of ponto) marca(p.employee_id, p.data, { tipo: dePonto(p.status), pendente: false, origem: "Ponto" });
  const pessoas = ativos.filter(e => todos || mapa.has(e.id)).map(e => ({ ...e, dias: mapa.get(e.id) ?? new Map<string, DiaFora>() }));
  // concentração: pessoas fora (aprovadas ou registradas) ÷ quadro da unidade no dia, só dias úteis
  const quadro = new Map<number, number>(); for (const e of ativos) quadro.set(e.unit_id, (quadro.get(e.unit_id) ?? 0) + 1);
  const unidades = [...new Map(ativos.map(e => [e.unit_id, e.unidade])).entries()].map(([id, nome]) => ({ id, nome, quadro: quadro.get(id) ?? 0 }));
  const util = (d: string) => { const w = new Date(`${d}T12:00:00Z`).getUTCDay(); return w !== 0 && w !== 6; };
  const conc = unidades.map(u => ({ ...u, porDia: dias.map(d => { const n = ativos.filter(e => e.unit_id === u.id && mapa.get(e.id)?.get(d) && !mapa.get(e.id)!.get(d)!.pendente).length; return { data: d, n, pct: u.quadro ? (100 * n) / u.quadro : 0, util: util(d) }; }) }));
  const pico = conc.flatMap(u => u.porDia.filter(x => x.util).map(x => ({ unidade: u.nome, ...x }))).sort((a, b) => b.pct - a.pct)[0] ?? null;
  return { ini, fim, dias, pessoas, unidades: conc, feriados, pico, util };
}
