import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { requireSession, scopeUnit, type Session } from "@/lib/auth";
import { sql } from "@/db";

export const COORDENA = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"];
/** Telas da coordenação: autoatendimento vai para "Minhas substituições"; perfis de outras áreas, para a própria página se forem professores. */
export async function requireCobertura(): Promise<Session> {
  const s = await requireSession();
  if (s.role === "COLABORADOR") redirect("/cobertura/minha");
  if (["COMERCIAL", "FINANCEIRO", "OPERACOES"].includes(s.role)) redirect(s.employeeId ? "/cobertura/minha" : "/");
  return s;
}
export function SubNavCobertura({ ativo, s }: { ativo: string; s: Session }) {
  // quem não coordena (professor, comercial, financeiro, operações, leitura sem acesso às telas da coordenação) vê só a própria página
  const coordena = [...COORDENA, "LEITURA"].includes(s.role);
  const itens: [string, string][] = [...(coordena ? [["/cobertura", "Quadro do dia"], ["/cobertura/grade", "Grade horária"], ["/cobertura/historico", "Histórico"]] as [string, string][] : []), ...(s.employeeId ? [["/cobertura/minha", "Minhas substituições"] as [string, string]] : [])];
  if (itens.length < 2) return null;
  return <nav className="mb-4 flex flex-wrap gap-1 print:hidden">{itens.map(([h, l]) => <Link key={h} href={h} className={`rounded-md px-3 py-1.5 text-sm ${ativo === h ? "bg-navy text-white" : "border border-line bg-white text-navy hover:bg-mist"}`}>{l}</Link>)}</nav>;
}
/** Professores visíveis para quem coordena: lotados na unidade (docentes) ou com aulas nela. */
export async function professoresDoEscopo(s: Session) {
  const u = scopeUnit(s);
  return sql<{ id: number; nome: string; unidade: string }[]>`SELECT e.id, e.nome, un.nome AS unidade FROM employees e JOIN units un ON un.id=e.unit_id WHERE e.situacao='ATIVO' AND (e.regime='DOCENTE' OR EXISTS (SELECT 1 FROM teacher_slots t WHERE t.employee_id=e.id AND t.ativo))
    ${u === null ? sql`` : sql`AND (e.unit_id=${u} OR EXISTS (SELECT 1 FROM teacher_slots t WHERE t.employee_id=e.id AND t.ativo AND t.unit_id=${u}))`} ORDER BY e.nome`;
}
