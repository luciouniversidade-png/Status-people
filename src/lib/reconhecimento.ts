import { sql } from "@/db";
import { scopeUnit, type Session } from "./auth";

/**
 * Mural de reconhecimento (v23): colegas reconhecem colegas por um valor da escola (Estratégia → Identidade).
 * Público para toda a equipe; a gestão (Direção e RH) pode ocultar um recado com motivo (fica registrado na auditoria).
 * Ninguém reconhece a si mesmo; Leitura só lê.
 */
export const podeReconhecer = (s: Session) => s.role !== "LEITURA";
export const podeModerar = (s: Session) => ["DIRECAO", "RH"].includes(s.role);
export const MURAL_MIN = 10, MURAL_MAX = 500;

/** Valores da identidade vigente (ou da mais recente), na ordem cadastrada. */
export async function valoresDaEscola(): Promise<string[]> {
  const [r] = await sql<{ valores: { nome: string }[] | null }[]>`SELECT valores FROM strategy_identity ORDER BY (status='VIGENTE') DESC, versao DESC LIMIT 1`;
  return (r?.valores ?? []).map(v => String(v.nome ?? "").trim()).filter(Boolean);
}

/** Quem a pessoa pode reconhecer: perfis de unidade e o autoatendimento, colegas da mesma unidade; perfis de rede, todos. */
export async function colegasReconheciveis(s: Session) {
  const u = scopeUnit(s) ?? (s.role === "COLABORADOR" ? s.unitId : null);
  return sql<{ id: number; nome: string; unidade: string; cargo: string | null }[]>`SELECT e.id, e.nome, un.nome AS unidade, p.nome AS cargo FROM employees e JOIN units un ON un.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id
    WHERE e.situacao IN ('ATIVO','FERIAS','AFASTADO') AND e.id IS DISTINCT FROM ${s.employeeId ?? null} ${u === null ? sql`` : sql`AND e.unit_id=${u}`} ORDER BY e.nome`;
}

export type Recado = { id: number; de_nome: string; de_user_id: number | null; para_id: number; para_nome: string; para_unidade: string; para_cargo: string | null; valor: string | null; mensagem: string; status: string; oculto_motivo: string | null; created_at: Date; palmas: number; minha: boolean };
export async function mural(s: Session, f: { unidade?: number | null; valor?: string | null; pessoa?: number | null; limite?: number }) {
  const mod = podeModerar(s);
  return sql<Recado[]>`SELECT r.id, r.de_nome, r.de_user_id, e.id AS para_id, e.nome AS para_nome, un.nome AS para_unidade, p.nome AS para_cargo, r.valor, r.mensagem, r.status, r.oculto_motivo, r.created_at,
      (SELECT count(*) FROM recognition_reactions x WHERE x.recognition_id=r.id)::int AS palmas, EXISTS (SELECT 1 FROM recognition_reactions x WHERE x.recognition_id=r.id AND x.user_id=${s.id}) AS minha
    FROM recognitions r JOIN employees e ON e.id=r.para_employee_id JOIN units un ON un.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id
    WHERE (r.status='PUBLICADO' OR ${mod}) ${f.unidade ? sql`AND e.unit_id=${f.unidade}` : sql``} ${f.valor ? sql`AND r.valor=${f.valor}` : sql``} ${f.pessoa ? sql`AND e.id=${f.pessoa}` : sql``}
    ORDER BY r.created_at DESC LIMIT ${f.limite ?? 60}`;
}

/** Números do mural no período: por valor, por unidade e por mês (só recados publicados). */
export async function estatisticasMural(desde: string) {
  const [porValor, porUnidade, porMes, [tot]] = await Promise.all([
    sql<{ valor: string; n: number }[]>`SELECT coalesce(valor, 'Sem valor') AS valor, count(*)::int AS n FROM recognitions WHERE status='PUBLICADO' AND created_at >= ${desde}::date GROUP BY 1 ORDER BY 2 DESC`,
    sql<{ unidade: string; n: number }[]>`SELECT un.nome AS unidade, count(*)::int AS n FROM recognitions r JOIN employees e ON e.id=r.para_employee_id JOIN units un ON un.id=e.unit_id WHERE r.status='PUBLICADO' AND r.created_at >= ${desde}::date GROUP BY 1 ORDER BY 1`,
    sql<{ mes: string; n: number }[]>`SELECT to_char(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Campo_Grande', 'YYYY-MM') AS mes, count(*)::int AS n FROM recognitions WHERE status='PUBLICADO' AND created_at >= ${desde}::date GROUP BY 1 ORDER BY 1`,
    sql<{ n: number; pessoas: number; autores: number }[]>`SELECT count(*)::int AS n, count(DISTINCT para_employee_id)::int AS pessoas, count(DISTINCT coalesce(de_user_id::text, de_nome))::int AS autores FROM recognitions WHERE status='PUBLICADO' AND created_at >= ${desde}::date`,
  ]);
  return { porValor, porUnidade, porMes, total: tot };
}
