import { sql } from "@/db";
import type { Session } from "./auth";
import { hoje, addDays, addMonths, getSettings } from "./utils";

export const VISITA_TIPO: Record<string, string> = { VISITANTE: "Visitante", PRESTADOR: "Prestador de serviço", ENTREGA: "Entrega", FAMILIA: "Familiar (reunião ou atendimento)", OUTRO: "Outro" };
export const FUNCAO_BRIGADA: Record<string, string> = { BRIGADISTA: "Brigadista", LIDER: "Líder de brigada", SOCORRISTA: "Socorrista (primeiros socorros)" };
export const CHECK_STATUS: Record<string, string> = { PENDENTE: "Aguardando", SEGURO: "Todos seguros", OCORRENCIA: "Com ocorrência" };
export const GRAVIDADE: Record<string, string> = { BAIXA: "Baixa", MEDIA: "Média", ALTA: "Alta" };
/** Gestão da unidade: libera exceções na portaria e vê o detalhe das restrições. */
export const GESTAO_SEG = ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR"];
export async function podePortaria(s: Session) { const cfg = await getSettings(); return (cfg.portaria.perfis as string[]).includes(s.role); }
export const normNome = (v: string | null | undefined) => (v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
export const docDigitos = (v: string | null | undefined) => (v ?? "").replace(/[^0-9a-zA-Z]/g, "").toUpperCase();
export const docMascarado = (v: string | null | undefined) => { const d = docDigitos(v); return d ? `•••${d.slice(-3)}` : "—"; };

export type Autorizacao = { id: number; nome: string; parentesco: string | null; documento: string | null; telefone: string | null; tipo: string; validade: string | null; restricao_obs: string | null; ativo: boolean };
export async function autorizacoes(studentId: number) {
  return sql<Autorizacao[]>`SELECT id, nome, parentesco, documento, telefone, tipo, validade::text, restricao_obs, ativo FROM pickup_authorizations WHERE student_id=${studentId} ORDER BY ativo DESC, (tipo='PROIBIDO') DESC, nome`;
}
/** Confere quem retira: restrição (PROIBIDO) sempre prevalece; depois autorizado vigente; senão, não cadastrado. Compara nome normalizado ou os dígitos do documento. */
export async function conferirRetirada(studentId: number, nome: string, documento: string | null) {
  const h = hoje(); const n = normNome(nome); const soDig = (v: string | null | undefined) => (v ?? "").replace(/\D/g, ""); const d = soDig(documento);
  const lista = (await autorizacoes(studentId)).filter(a => a.ativo && (!a.validade || a.validade >= h));
  const bate = (a: Autorizacao) => (n && normNome(a.nome) === n) || (d.length >= 5 && soDig(a.documento) === d);
  const proibido = lista.find(a => a.tipo === "PROIBIDO" && bate(a)); if (proibido) return { status: "PROIBIDO" as const, autorizacao: proibido };
  const aut = lista.find(a => a.tipo === "AUTORIZADO" && bate(a)); if (aut) return { status: "AUTORIZADO" as const, autorizacao: aut };
  return { status: "NAO_CADASTRADO" as const, autorizacao: null };
}

/** Grupos da chamada de emergência: séries atuais da unidade (alunos que não saíram mais cedo hoje), equipe e visitantes presentes. */
export async function gruposChamada(unitId: number) {
  const [series, equipe, visitas] = await Promise.all([
    sql<{ serie: string; n: number; ordem: number }[]>`SELECT coalesce(g.nome, 'Alunos sem série informada') AS serie, count(*)::int AS n, coalesce(min(g.ordem), 999) AS ordem FROM students st LEFT JOIN grades g ON g.id=st.serie_atual_id WHERE st.aluno_atual AND st.unit_atual_id=${unitId} AND NOT EXISTS (SELECT 1 FROM early_departures d WHERE d.student_id=st.id AND d.data=${hoje()} AND d.status='LIBERADA') GROUP BY g.nome ORDER BY ordem`,
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM employees WHERE unit_id=${unitId} AND situacao='ATIVO'`,
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM visits WHERE unit_id=${unitId} AND saida IS NULL AND entrada > now() - interval '18 hours'`]);
  return [...series.map(s => ({ grupo: s.serie, esperado: s.n })), { grupo: "Equipe da unidade", esperado: equipe[0].n }, ...(visitas[0].n ? [{ grupo: "Visitantes e prestadores presentes", esperado: visitas[0].n }] : [])];
}

/** Situação da brigada por unidade: ativos com treinamento válido × mínimo configurado; vencidos e a vencer em 30 dias. */
export async function situacaoBrigada(unitId: number | null) {
  const cfg = await getSettings(); const h = hoje(); const min = cfg.portaria.brigadaMinimaPorUnidade as number;
  const membros = await sql<{ id: number; employee_id: number; nome: string; unit_id: number; unidade: string; funcao: string; turno: string | null; treinamento_em: string | null; validade: string | null; ativo: boolean; obs: string | null }[]>`SELECT b.id, b.employee_id, e.nome, b.unit_id, u.nome AS unidade, b.funcao, b.turno, b.treinamento_em::text, b.validade::text, b.ativo, b.obs FROM brigade_members b JOIN employees e ON e.id=b.employee_id JOIN units u ON u.id=b.unit_id WHERE e.situacao <> 'DESLIGADO' ${unitId === null ? sql`` : sql`AND b.unit_id=${unitId}`} ORDER BY u.nome, b.ativo DESC, e.nome`;
  const units = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ${unitId === null ? sql`` : sql`WHERE id=${unitId}`} ORDER BY nome`;
  const valido = (m: { ativo: boolean; validade: string | null }) => m.ativo && (!m.validade || m.validade >= h);
  return { min, membros: membros.map(m => ({ ...m, situacao: !m.ativo ? "INATIVO" : m.validade && m.validade < h ? "VENCIDO" : m.validade && m.validade <= addDays(h, 30) ? "VENCE" : "OK" })),
    porUnidade: units.map(u => ({ ...u, validos: membros.filter(m => m.unit_id === u.id && valido(m)).length, abaixo: membros.filter(m => m.unit_id === u.id && valido(m)).length < min })) };
}

/** Unidades sem simulado de abandono encerrado nos últimos N meses (configurável). */
export async function semSimulado(unitId: number | null) {
  const cfg = await getSettings(); const desde = addMonths(hoje(), -(cfg.portaria.simuladoMeses as number));
  return sql<{ id: number; nome: string; ultimo: string | null }[]>`SELECT u.id, u.nome, (SELECT max(inicio)::date::text FROM emergency_events e WHERE e.unit_id=u.id AND e.tipo='SIMULADO' AND e.status='ENCERRADO') AS ultimo FROM units u WHERE NOT EXISTS (SELECT 1 FROM emergency_events e WHERE e.unit_id=u.id AND e.tipo='SIMULADO' AND e.status='ENCERRADO' AND e.inicio >= ${desde}) ${unitId === null ? sql`` : sql`AND u.id=${unitId}`} ORDER BY u.nome`;
}
export const fmtDuracao = (seg: number | null | undefined) => seg === null || seg === undefined ? "—" : `${Math.floor(seg / 60)} min ${String(seg % 60).padStart(2, "0")} s`;
