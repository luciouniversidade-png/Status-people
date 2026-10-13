import { randomBytes } from "crypto";
import { sql } from "@/db";
import type { Session } from "./auth";
import { getSettings, hoje } from "./utils";
import { hashCodigo } from "./privacidade";

export const CATEGORIA_ETICA: Record<string, string> = { ASSEDIO_SEXUAL: "Assédio sexual", ASSEDIO_MORAL: "Assédio moral", DISCRIMINACAO: "Discriminação", VIOLENCIA: "Violência ou ameaça", PROTECAO_ALUNO: "Proteção de crianças e adolescentes", FRAUDE: "Fraude, desvio ou corrupção", CONFLITO_INTERESSE: "Conflito de interesses", SEGURANCA: "Segurança e saúde no trabalho", OUTRO: "Outra conduta" };
export const RELACAO_ETICA: Record<string, string> = { COLABORADOR: "Colaborador(a)", FAMILIA: "Família", ALUNO: "Aluno(a)", FORNECEDOR: "Fornecedor ou prestador", OUTRO: "Outro", NAO_INFORMADO: "Prefiro não dizer" };
export const ETICA_STATUS: Record<string, string> = { RECEBIDA: "Recebido", EM_APURACAO: "Em apuração", CONCLUIDA: "Concluído", ARQUIVADA: "Arquivado" };
export const RESULTADO_ETICA: Record<string, string> = { PROCEDENTE: "Procedente", PARCIAL: "Parcialmente procedente", IMPROCEDENTE: "Improcedente", INCONCLUSIVO: "Inconclusivo (sem elementos suficientes)" };
export const ETICA_ABERTO = ["RECEBIDA", "EM_APURACAO"];

/** Protocolo curto e não sequencial (não revela volume) + código secreto (só o hash é guardado). */
export function novoProtocoloEtica() { const a = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; const b = randomBytes(8); return "ET-" + Array.from(b, x => a[x % a.length]).join("").replace(/(.{4})(?=.)/, "$1-"); }
export { hashCodigo };
const norm = (v: string | null | undefined) => (v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

/** Comitê de triagem configurado (ativos); vazio = Direção. */
export async function comite() {
  const cfg = await getSettings(); const ids = (cfg.etica.comite as number[]) ?? [];
  // só usuários ativos de gestão: quem muda para Leitura/Colaborador sai do comitê na hora
  const rows = ids.length ? await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM users WHERE ativo AND role NOT IN ('LEITURA','COLABORADOR') AND id = ANY(${ids}) ORDER BY nome` : [];
  return rows.length ? { membros: rows, padrao: false } : { membros: await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM users WHERE ativo AND role='DIRECAO' ORDER BY nome`, padrao: true };
}
/** Membros citados no relato ficam impedidos: nome completo no texto, ou nome e sobrenome em "envolvidos". */
export function impedidosAutomaticos(membros: { id: number; nome: string }[], envolvidos: string | null, relato: string) {
  const env = ` ${norm(envolvidos)} `; const rel = ` ${norm(relato)} `;
  return membros.filter(m => { const p = norm(m.nome).split(" ").filter(x => x.length > 1); if (p.length < 2) return false; const completo = ` ${p.join(" ")} `; const curto = ` ${p[0]} ${p[p.length - 1]} `; return env.includes(completo) || env.includes(curto) || rel.includes(completo); }).map(m => m.id);
}
/** Quem trata o relato: comitê menos impedidos; se todos estiverem impedidos, a Direção não impedida; por fim, o RH. */
export async function responsaveisRelato(impedidos: number[]) {
  const c = await comite(); let lista = c.membros.filter(m => !impedidos.includes(m.id));
  if (!lista.length) lista = (await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM users WHERE ativo AND role='DIRECAO' ORDER BY nome`).filter(m => !impedidos.includes(m.id));
  if (!lista.length) lista = (await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM users WHERE ativo AND role='RH' ORDER BY nome`).filter(m => !impedidos.includes(m.id));
  return lista;
}
/** Todos que poderiam vir a tratar um relato hoje: comitê atual, Direção e RH (ativos). */
export async function candidatosEtica() {
  const c = await comite(); const outros = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM users WHERE ativo AND role IN ('DIRECAO','RH')`;
  return [...new Map([...c.membros, ...outros].map(m => [m.id, m])).values()];
}
export type RelatoImp = { impedidos: number[] | null; liberados?: number[] | null; envolvidos: string | null; relato: string };
/**
 * Impedidos efetivos, calculados a cada acesso: os registrados + quem é citado no relato entre todos os que poderiam tratá-lo hoje
 * (quem entra no comitê depois, ou a Direção/RH chamados por falta de comitê, também ficam de fora), menos quem a Direção liberou
 * expressamente (homônimo). A liberação vale só para a detecção automática: o que está registrado em `impedidos` sempre conta.
 */
export function impedidosEfetivos(r: RelatoImp, candidatos: { id: number; nome: string }[]) {
  const lib = new Set(r.liberados ?? []);
  return [...new Set([...(r.impedidos ?? []), ...impedidosAutomaticos(candidatos, r.envolvidos, r.relato).filter(i => !lib.has(i))])];
}
export async function impedidosDoRelato(r: RelatoImp) { return impedidosEfetivos(r, await candidatosEtica()); }
export async function podeTratarRelato(s: Session, r: RelatoImp) {
  const imp = await impedidosDoRelato(r); if (imp.includes(s.id)) return false;
  return (await responsaveisRelato(imp)).some(m => m.id === s.id);
}
/** Membro do comitê (ou quem responde por ele) — vê a lista, sem os relatos em que está impedido. */
export async function ehComite(s: Session) { const c = await comite(); return c.membros.some(m => m.id === s.id); }

/** Relatório agregado (sem conteúdo): para a Direção e a CIPA acompanharem o canal. */
export async function relatorioEtica(desde: string) {
  const [porCat, porStatus, [tempo], [venc]] = await Promise.all([
    sql<{ categoria: string; n: number }[]>`SELECT categoria, count(*)::int AS n FROM ethics_reports WHERE created_at >= ${desde} GROUP BY categoria ORDER BY n DESC`,
    sql<{ status: string; resultado: string | null; n: number }[]>`SELECT status, resultado, count(*)::int AS n FROM ethics_reports WHERE created_at >= ${desde} GROUP BY status, resultado`,
    sql<{ dias: number | null }[]>`SELECT round(avg(extract(epoch FROM concluida_em - created_at) / 86400))::int AS dias FROM ethics_reports WHERE concluida_em IS NOT NULL AND created_at >= ${desde}`,
    sql<{ triagem: number; conclusao: number }[]>`SELECT count(*) FILTER (WHERE status='RECEBIDA' AND prazo_triagem < ${hoje()})::int AS triagem, count(*) FILTER (WHERE status IN ('RECEBIDA','EM_APURACAO') AND prazo_conclusao < ${hoje()})::int AS conclusao FROM ethics_reports`]);
  return { porCat, porStatus, tempoMedioDias: tempo?.dias ?? null, vencidos: venc };
}
