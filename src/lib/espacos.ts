import { sql } from "@/db";
import { hoje, getSettings } from "./utils";
import { minutos, diaSemana, sobrepoe } from "./cobertura";

export const TIPO_ESPACO: Record<string, string> = { SALA: "Sala de aula", LABORATORIO: "Laboratório", QUADRA: "Quadra", AUDITORIO: "Auditório", BIBLIOTECA: "Biblioteca", BRINQUEDOTECA: "Brinquedoteca", REFEITORIO: "Refeitório", EQUIPAMENTO: "Equipamento", OUTRO: "Outro" };
export const TURNOS_MAPA = ["Matutino", "Vespertino"];

/** Capacidade física: a informada; sem ela, a área ÷ m² por aluno (parâmetro configurável). */
export function capacidadeFisica(sp: { capacidade: number | null; area_m2: string | number | null }, m2PorAluno: number) {
  if (sp.capacidade) return { valor: sp.capacidade, origem: "informada" as const };
  if (sp.area_m2 && Number(sp.area_m2) > 0 && m2PorAluno > 0) return { valor: Math.floor(Number(sp.area_m2) / m2PorAluno), origem: "pela área" as const };
  return { valor: null, origem: null };
}

export type CelulaMapa = { class_id: number; nome: string; modalidade: string; vagas: number; ocupadas: number };
export type LinhaMapa = { id: number; nome: string; tipo: string; capacidade: number | null; capOrigem: string | null; area_m2: string | null; ativo: boolean; porTurno: Record<string, CelulaMapa[]>; alertas: string[] };

/** Mapa de salas × turno do ano letivo: que turma ocupa cada sala, ocupação × vagas × capacidade física, choques e turmas sem sala. */
export async function mapaSalas(ano: number, unitId: number) {
  const cfg = await getSettings(); const h = hoje(); const m2 = Number(cfg.espacos.m2PorAluno) || 0;
  const [salas, turmas] = await Promise.all([
    sql<{ id: number; nome: string; tipo: string; capacidade: number | null; area_m2: string | null; ativo: boolean }[]>`SELECT id, nome, tipo, capacidade, area_m2::text, ativo FROM spaces WHERE unit_id=${unitId} AND tipo <> 'EQUIPAMENTO' AND (ativo OR EXISTS (SELECT 1 FROM classes c WHERE c.space_id=spaces.id AND c.ano=${ano})) ORDER BY (tipo='SALA') DESC, nome`,
    sql<{ id: number; nome: string; turno: string; modalidade: string; vagas: number; space_id: number | null; status: string; ocupadas: number; serie: string | null }[]>`SELECT c.id, c.nome, c.turno, c.modalidade, c.vagas, c.space_id, c.status, g.nome AS serie, (SELECT count(*) FROM enrollments e WHERE e.class_id=c.id AND (e.status='CONFIRMADA' OR (e.status='RESERVADA' AND e.reserva_ate >= ${h})))::int AS ocupadas FROM classes c LEFT JOIN grades g ON g.id=c.grade_id WHERE c.ano=${ano} AND c.unit_id=${unitId} ORDER BY coalesce(g.ordem, 900), c.turno, c.nome`]);
  const turnos = [...new Set([...TURNOS_MAPA, ...turmas.map(t => t.turno)])];
  const linhas: LinhaMapa[] = salas.map(sp => {
    const cap = capacidadeFisica(sp, m2); const porTurno: Record<string, CelulaMapa[]> = {}; const alertas: string[] = [];
    for (const t of turnos) {
      const cel = turmas.filter(c => c.space_id === sp.id && c.turno === t).map(c => ({ class_id: c.id, nome: c.nome, modalidade: c.modalidade, vagas: c.vagas, ocupadas: c.ocupadas }));
      porTurno[t] = cel;
      if (cel.length > 1) alertas.push(`${t}: ${cel.length} turmas na mesma sala (${cel.map(c => c.nome).join(", ")})`);
      if (cap.valor !== null) for (const c of cel) {
        if (c.ocupadas > cap.valor) alertas.push(`${c.nome}: ${c.ocupadas} alunos para ${cap.valor} lugares`);
        else if (c.vagas > cap.valor) alertas.push(`${c.nome}: ${c.vagas} vagas ofertadas para ${cap.valor} lugares`);
      }
    }
    if (!sp.ativo) alertas.push("sala inativa com turma vinculada");
    return { id: sp.id, nome: sp.nome, tipo: sp.tipo, capacidade: cap.valor, capOrigem: cap.origem, area_m2: sp.area_m2, ativo: sp.ativo, porTurno, alertas };
  });
  const semSala = turmas.filter(c => !c.space_id);
  const livres = Object.fromEntries(turnos.map(t => [t, linhas.filter(l => l.tipo === "SALA" && l.ativo && !l.porTurno[t].length).length]));
  return { turnos, linhas, semSala, livres, turmas };
}

export type Ocupacao = { origem: "RESERVA" | "AULA"; id: number; inicio: string; fim: string; titulo: string; quem: string | null; grupo: string | null };
/** O que ocupa um espaço numa data: reservas confirmadas e aulas fixas da grade horária (ex.: Educação Física na quadra). */
export async function ocupacaoEspaco(spaceId: number, data: string, db: typeof sql = sql): Promise<Ocupacao[]> {
  const [res, aulas] = await Promise.all([
    db<{ id: number; inicio: string; fim: string; titulo: string; turma: string | null; quem: string | null; grupo: string | null }[]>`SELECT id, inicio, fim, titulo, turma, solicitante_nome AS quem, grupo FROM space_bookings WHERE space_id=${spaceId} AND data=${data} AND status='CONFIRMADA' ORDER BY inicio`,
    db<{ id: number; inicio: string; fim: string; turma: string; disciplina: string | null; professor: string }[]>`SELECT t.id, t.inicio, t.fim, t.turma, t.disciplina, e.nome AS professor FROM teacher_slots t JOIN employees e ON e.id=t.employee_id WHERE t.space_id=${spaceId} AND t.ativo AND slot_vigente(t.version_id, ${data}::date) AND t.dia_semana=${diaSemana(data)} ORDER BY t.inicio`]);
  return [...res.map(r => ({ origem: "RESERVA" as const, id: r.id, inicio: r.inicio, fim: r.fim, titulo: r.turma ? `${r.titulo} · ${r.turma}` : r.titulo, quem: r.quem, grupo: r.grupo })), ...aulas.map(a => ({ origem: "AULA" as const, id: a.id, inicio: a.inicio, fim: a.fim, titulo: `${a.turma}${a.disciplina ? ` · ${a.disciplina}` : ""}`, quem: a.professor, grupo: null }))].sort((a, b) => (minutos(a.inicio) ?? 0) - (minutos(b.inicio) ?? 0));
}
/** Choque de uma reserva pretendida com o que já ocupa o espaço (null = livre). */
export async function choqueEspaco(spaceId: number, data: string, inicio: string, fim: string, ignorarId?: number, db: typeof sql = sql) {
  const x = (await ocupacaoEspaco(spaceId, data, db)).find(o => !(o.origem === "RESERVA" && o.id === ignorarId) && sobrepoe(o.inicio, o.fim, inicio, fim));
  return x ? `${x.origem === "AULA" ? "aula da grade" : "reserva"} ${x.titulo} (${x.inicio}–${x.fim}${x.quem ? `, ${x.quem}` : ""})` : null;
}
