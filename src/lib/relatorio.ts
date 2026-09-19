import { sql } from "@/db";

export type Mes = { ini: string; fim: string; rotulo: string };
export function mesRef(m?: string): Mes {
  const ok = m && /^\d{4}-\d{2}$/.test(m) ? m : new Date().toLocaleDateString("en-CA", { timeZone: "America/Campo_Grande" }).slice(0, 7);
  const [y, mm] = ok.split("-").map(Number);
  const ini = `${ok}-01`; const fim = new Date(Date.UTC(y, mm, 0)).toISOString().slice(0, 10);
  const rotulo = new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  return { ini, fim, rotulo: rotulo.charAt(0).toUpperCase() + rotulo.slice(1) };
}

export async function relatorioMensal(unitId: number | null, m: Mes) {
  const uf = unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`;
  const [admissoes, desligamentos, afastamentos, banco, pendentes] = await Promise.all([
    sql<{ id: number; nome: string; unidade: string; cargo: string | null; empresa: string | null; vinculo: string; admissao: string; situacao: string }[]>`SELECT e.id, e.nome, u.nome AS unidade, p.nome AS cargo, c.nome AS empresa, e.vinculo, e.admissao::text, e.situacao FROM employees e JOIN units u ON u.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id LEFT JOIN companies c ON c.id=e.company_id WHERE e.admissao BETWEEN ${m.ini} AND ${m.fim} ${uf} ORDER BY e.admissao, e.nome`,
    sql<{ id: number; nome: string; unidade: string; cargo: string | null; empresa: string | null; desligamento: string; motivo: string | null; situacao: string }[]>`SELECT e.id, e.nome, u.nome AS unidade, p.nome AS cargo, c.nome AS empresa, e.desligamento::text, e.motivo_desligamento AS motivo, e.situacao FROM employees e JOIN units u ON u.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id LEFT JOIN companies c ON c.id=e.company_id WHERE e.desligamento BETWEEN ${m.ini} AND ${m.fim} ${uf} ORDER BY e.desligamento, e.nome`,
    sql<{ id: number; nome: string; unidade: string; tipo: string; inicio: string; fim: string; dias_no_mes: number; dias: number }[]>`SELECT e.id, e.nome, u.nome AS unidade, l.tipo, l.inicio::text, l.fim::text, (LEAST(l.fim, ${m.fim}::date) - GREATEST(l.inicio, ${m.ini}::date) + 1)::int AS dias_no_mes, l.dias FROM leave_requests l JOIN employees e ON e.id=l.employee_id JOIN units u ON u.id=e.unit_id WHERE l.status='APROVADA' AND l.inicio <= ${m.fim} AND l.fim >= ${m.ini} ${uf} ORDER BY l.inicio, e.nome`,
    sql<{ id: number; nome: string; unidade: string; saldo_inicial: number; creditos: number; debitos: number; saldo_final: number }[]>`SELECT e.id, e.nome, u.nome AS unidade,
        coalesce((SELECT sum(minutos) FROM hour_entries h WHERE h.employee_id=e.id AND h.status='APROVADO' AND h.data < ${m.ini}),0)::int AS saldo_inicial,
        coalesce((SELECT sum(minutos) FROM hour_entries h WHERE h.employee_id=e.id AND h.status='APROVADO' AND h.data BETWEEN ${m.ini} AND ${m.fim} AND h.minutos > 0),0)::int AS creditos,
        coalesce((SELECT sum(minutos) FROM hour_entries h WHERE h.employee_id=e.id AND h.status='APROVADO' AND h.data BETWEEN ${m.ini} AND ${m.fim} AND h.minutos < 0),0)::int AS debitos,
        coalesce((SELECT sum(minutos) FROM hour_entries h WHERE h.employee_id=e.id AND h.status='APROVADO' AND h.data <= ${m.fim}),0)::int AS saldo_final
      FROM employees e JOIN units u ON u.id=e.unit_id WHERE (e.situacao <> 'DESLIGADO' OR e.desligamento >= ${m.ini}) ${uf} ORDER BY u.nome, e.nome`,
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM hour_entries h JOIN employees e ON e.id=h.employee_id WHERE h.status='PENDENTE' AND h.data <= ${m.fim} ${uf}`,
  ]);
  return { admissoes, desligamentos, afastamentos, banco, pendentes: pendentes[0].n };
}
