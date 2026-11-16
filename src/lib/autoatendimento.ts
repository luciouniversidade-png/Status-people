/**
 * v34 · Autoatendimento do colaborador (referência: Sankhya Pessoas+ e MarQ HR): pedir ajuste de ponto, enviar atestado pelo celular,
 * ver a própria evolução salarial e dar parabéns aos aniversariantes. Regras de quem aprova e de privacidade ficam aqui.
 */
import { sql } from "@/db";
import type { Session } from "./auth";
import { scopeUnit } from "./auth";

export const TIPO_AJUSTE: Record<string, string> = { ESQUECIMENTO: "Esqueci de marcar", ERRO: "Marcação errada", EXTERNO: "Serviço externo, curso ou evento", RELOGIO: "Relógio com defeito ou sem energia", OUTRO: "Outro motivo" };
export const STATUS_AJUSTE: Record<string, string> = { PENDENTE: "Aguardando aprovação", APROVADO: "Aprovado — aguardando o RH lançar", AJUSTADO: "Ajustado", RECUSADO: "Recusado", CANCELADO: "Cancelado" };
export const TOM_AJUSTE: Record<string, string> = { PENDENTE: "PENDENTE", APROVADO: "SOLICITADA", AJUSTADO: "APROVADA", RECUSADO: "REJEITADA", CANCELADO: "CANCELADA" };
export const STATUS_ATESTADO: Record<string, string> = { ENVIADO: "Enviado — com o RH", ACEITO: "Aceito", RECUSADO: "Recusado" };
export const TOM_ATESTADO: Record<string, string> = { ENVIADO: "PENDENTE", ACEITO: "APROVADA", RECUSADO: "REJEITADA" };

/** "07:30 11:30 13:00 17:18" → pares entrada/saída em minutos. Aceita separadores espaço, vírgula, ponto e vírgula ou hífen. */
export function lerMarcacoes(txt: string): { texto: string; minutos: number } {
  const hs = (txt.match(/\d{1,2}[:h]\d{2}/g) ?? []).map(x => x.replace("h", ":").padStart(5, "0"));
  if (hs.length < 2) throw new Error("Informe as marcações do dia (ex.: 07:30 11:30 13:00 17:18).");
  if (hs.length % 2) throw new Error("As marcações vêm em pares (entrada e saída): confira se falta alguma.");
  if (hs.length > 8) throw new Error("No máximo 4 pares de marcações por dia.");
  const mins = hs.map(h => { const [a, b] = h.split(":").map(Number); if (a > 23 || b > 59) throw new Error(`Horário inválido: ${h}.`); return a * 60 + b; });
  for (let i = 1; i < mins.length; i++) if (mins[i] <= mins[i - 1]) throw new Error("As marcações precisam estar em ordem crescente no mesmo dia.");
  let total = 0; for (let i = 0; i < mins.length; i += 2) total += mins[i + 1] - mins[i];
  return { texto: hs.join(" "), minutos: total };
}

/** Quem aprova o ajuste de ponto: RH e Direção; a direção da unidade; o(a) gestor(a) direto(a) da pessoa. */
export async function podeAprovarAjuste(s: Session, employeeId: number): Promise<boolean> {
  if (["RH", "DIRECAO"].includes(s.role)) return true;
  const [e] = await sql<{ unit_id: number; gestor_id: number | null }[]>`SELECT unit_id, gestor_id FROM employees WHERE id=${employeeId}`; if (!e) return false;
  if (s.employeeId && s.employeeId === employeeId) return false; // ninguém aprova o próprio ajuste
  if (s.role === "DIRETOR_UNIDADE" && scopeUnit(s) === e.unit_id) return true;
  return !!s.employeeId && e.gestor_id === s.employeeId;
}
/** Filtro SQL dos ajustes que a pessoa aprova (para a fila e as pendências). */
export function filtroAprovaAjuste(s: Session) {
  if (["RH", "DIRECAO"].includes(s.role)) return sql`true`;
  const u = scopeUnit(s);
  if (s.role === "DIRETOR_UNIDADE" && u !== null) return sql`(e.unit_id=${u} AND e.id <> ${s.employeeId ?? 0})`;
  return sql`(e.gestor_id=${s.employeeId ?? 0} AND e.id <> ${s.employeeId ?? 0})`;
}
/** Atestado: só RH e Direção veem e decidem (dado de saúde; o ONE não pede nem guarda o CID). */
export const podeAtestados = (s: Session) => ["RH", "DIRECAO"].includes(s.role);

/** Soma dos dias de atestado aceitos nos últimos 60 dias (alerta do 16º dia: daí em diante o afastamento é do INSS). */
export async function diasAtestado60(employeeId: number, ate: string): Promise<number> {
  const [r] = await sql<{ d: number }[]>`SELECT coalesce(sum(dias),0)::int AS d FROM medical_certificates WHERE employee_id=${employeeId} AND status='ACEITO' AND tipo='DIAS' AND fim >= (${ate}::date - 60)`;
  return r?.d ?? 0;
}

/** Evolução salarial da própria pessoa (histórico de salário e o atual). */
export async function evolucaoSalarial(employeeId: number) {
  const hist = await sql<{ data: string; salario_anterior: number | null; salario: number; motivo: string }[]>`SELECT data::text, salario_anterior::float, salario::float, motivo FROM salary_history WHERE employee_id=${employeeId} ORDER BY data, id`;
  const [e] = await sql<{ salario: number | null; admissao: string }[]>`SELECT salario::float, admissao::text FROM employees WHERE id=${employeeId}`;
  const pontos: { data: string; valor: number; motivo: string }[] = [];
  if (hist.length && hist[0].salario_anterior) pontos.push({ data: e?.admissao ?? hist[0].data, valor: hist[0].salario_anterior, motivo: "Admissão" });
  for (const h of hist) pontos.push({ data: h.data, valor: h.salario, motivo: h.motivo });
  if (!pontos.length && e?.salario) pontos.push({ data: e.admissao, valor: e.salario, motivo: "Admissão" });
  return pontos;
}
