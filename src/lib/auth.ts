import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { signSession, verifyToken, COOKIE, type Role, type Session } from "./session";
export { verifyToken, type Role, type Session };
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";


export const ROLE_LABEL: Record<Role, string> = {
  DIRECAO: "Direção", RH: "RH", DIRETOR_UNIDADE: "Diretor de unidade", GESTOR: "Gestor", LEITURA: "Somente leitura", COLABORADOR: "Colaborador (autoatendimento)", COMERCIAL: "Comercial / Atendimento", FINANCEIRO: "Financeiro", OPERACOES: "Operações e manutenção",
};

export async function createSession(s: Session) {
  const token = await signSession(s);
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 12 * 3600 });
}

export async function destroySession() { (await cookies()).delete(COOKIE); }

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  return token ? verifyToken(token) : null;
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/** Páginas de equipe (módulo Pessoas): colaborador em autoatendimento vai para a própria ficha; comercial vai para Matrículas. */
export async function requireStaff(): Promise<Session> {
  const s = await requireSession();
  if (s.role === "COLABORADOR") redirect(s.employeeId ? `/colaboradores/${s.employeeId}` : "/conta");
  if (s.role === "COMERCIAL") redirect("/matriculas");
  if (s.role === "FINANCEIRO") redirect("/financeiro");
  if (s.role === "OPERACOES") redirect("/operacoes");
  return s;
}

/** Páginas do módulo Financeiro. */
export async function requireFinanceiro(permitirComercial = false): Promise<Session> {
  const s = await requireSession();
  const ok = ["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE", "RH"].includes(s.role) || (permitirComercial && s.role === "COMERCIAL");
  if (!ok) redirect(s.role === "COMERCIAL" ? "/financeiro/descontos" : s.role === "COLABORADOR" && s.employeeId ? `/colaboradores/${s.employeeId}` : "/");
  return s;
}

/** Páginas do módulo Matrículas: todos os perfis de equipe, exceto autoatendimento. */
export async function requireMatriculas(): Promise<Session> {
  const s = await requireSession();
  if (s.role === "COLABORADOR") redirect(s.employeeId ? `/colaboradores/${s.employeeId}` : "/conta");
  return s;
}

export const MAX_TENTATIVAS = 5;        // tentativas erradas por e-mail...
export const JANELA_MIN = 15;           // ...em 15 minutos bloqueiam novas tentativas

/** Retorna a sessão, ou "bloqueado" quando há tentativas demais, ou null quando credenciais não conferem. */
export async function login(email: string, senha: string, ip?: string | null): Promise<Session | "bloqueado" | null> {
  const e = email.trim().toLowerCase();
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM login_attempts WHERE email=${e} AND ok=false AND at > now() - interval '15 minutes'`;
  if (n >= MAX_TENTATIVAS) return "bloqueado";
  // seleção explícita de colunas: o login continua funcionando mesmo antes de uma atualização de esquema ser aplicada
  const [u] = await sql<{ id: number; nome: string; email: string; role: string; unit_id: number | null; employee_id: number | null; ativo: boolean; senha_hash: string }[]>`SELECT id, nome, email, role, unit_id, employee_id, ativo, senha_hash FROM users WHERE email=${e}`;
  const ok = !!u && u.ativo && (await bcrypt.compare(senha, u.senha_hash));
  await db.insert(schema.loginAttempts).values({ email: e, ip: ip ?? null, ok });
  if (!ok) return null;
  await sql`DELETE FROM login_attempts WHERE email=${e} AND at < now() - interval '1 day'`;
  return { id: u!.id, nome: u!.nome, email: u!.email, role: u!.role as Role, unitId: u!.unit_id, employeeId: u!.employee_id };
}

/** Diz se o usuário tem a verificação em duas etapas ativa (tolerante a esquema antigo). */
export async function totpAtivoDe(userId: number): Promise<boolean> {
  try { const [r] = await sql<{ totp_ativo: boolean }[]>`SELECT totp_ativo FROM users WHERE id=${userId}`; return !!r?.totp_ativo; } catch { return false; }
}

/** Usuário desativado perde o acesso na próxima requisição, mesmo com sessão válida. */
export async function requireActiveUser(s: Session) {
  const [u] = await sql<{ ativo: boolean }[]>`SELECT ativo FROM users WHERE id=${s.id}`;
  if (!u || !u.ativo) redirect("/api/sair?motivo=inativo");
  let trocarSenha = false; try { const [t] = await sql<{ trocar_senha: boolean }[]>`SELECT trocar_senha FROM users WHERE id=${s.id}`; trocarSenha = !!t?.trocar_senha; } catch { trocarSenha = false; }
  return { ativo: u.ativo, totpAtivo: await totpAtivoDe(s.id), trocarSenha };
}

// ---- Permissões (RBAC + escopo por unidade) ----
export const can = {
  editar: (s: Session) => s.role === "RH" || s.role === "DIRECAO",
  // Matrículas: cadastrar alunos, reservar vagas e operar a fila
  reservar: (s: Session) => ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR", "COMERCIAL"].includes(s.role),
  // Matrículas: editar a grade de turmas (vagas, turnos) — estrutura da oferta
  gradeTurmas: (s: Session) => ["RH", "DIRECAO"].includes(s.role),
  financeiro: (s: Session) => ["DIRECAO", "FINANCEIRO"].includes(s.role),
  operacoes: (s: Session) => ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "OPERACOES"].includes(s.role),
  verSalario: (s: Session) => s.role === "RH" || s.role === "DIRECAO",
  verSensivel: (s: Session) => s.role === "RH" || s.role === "DIRECAO",
  configurar: (s: Session) => s.role === "RH" || s.role === "DIRECAO",
  solicitar: (s: Session) => s.role !== "LEITURA",
  aprovar: (s: Session, alcada: string[]) => alcada.includes(s.role),
  auditoria: (s: Session) => s.role === "RH" || s.role === "DIRECAO",
};

/** Unidade à qual o usuário está restrito (null = rede inteira). */
export function scopeUnit(s: Session): number | null {
  return s.role === "DIRETOR_UNIDADE" || s.role === "GESTOR" || s.role === "COLABORADOR" ? s.unitId : null;
}

export function assertScope(s: Session, unitId: number) {
  const u = scopeUnit(s);
  if (u !== null && u !== unitId) throw new Error("Sem acesso a esta unidade.");
}

/** Acesso a um colaborador específico: autoatendimento só enxerga a si mesmo. */
export function assertEmployeeAccess(s: Session, e: { id: number; unitId: number }) {
  if (s.role === "COLABORADOR") { if (s.employeeId !== e.id) throw new Error("Sem acesso a este colaborador."); return; }
  assertScope(s, e.unitId);
}
export function canSeeEmployee(s: Session, e: { id: number; unitId: number }) { try { assertEmployeeAccess(s, e); return true; } catch { return false; } }

export function assert(cond: boolean, msg = "Sem permissão para esta ação.") { if (!cond) throw new Error(msg); }
