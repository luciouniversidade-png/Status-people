import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { signSession, verifyToken, COOKIE, type Role, type Session } from "./session";
export { verifyToken, type Role, type Session };
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { carregarSessao, sessaoDoUsuario, telaBloqueada, aprovacoesDa, type CargaSessao, type Alcada } from "./acesso";


/** Nome da atuação (v29: antes “perfil”). A atuação vem do cargo da ficha; aqui só o rótulo curto para listas e etiquetas. */
export const ROLE_LABEL: Record<Role, string> = {
  DIRECAO: "Direção", RH: "RH", DIRETOR_UNIDADE: "Direção da unidade", GESTOR: "Coordenação", LEITURA: "Consulta", COLABORADOR: "Autoatendimento", COMERCIAL: "Comercial e atendimento", FINANCEIRO: "Financeiro", OPERACOES: "Operações e manutenção",
};

export async function createSession(s: Session) {
  const token = await signSession(s);
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 12 * 3600 });
}

export async function destroySession() { (await cookies()).delete(COOKIE); }

/** Pessoa identificada pelo cookie + acesso efetivo lido do banco (cargo, exceção ou conta sem ficha). Conta inativa ou ficha desligada: null. */
async function sessaoDaRequisicao(): Promise<CargaSessao> {
  const token = (await cookies()).get(COOKIE)?.value; if (!token) return { s: null, motivo: null };
  const t = await verifyToken(token); if (!t?.id) return { s: null, motivo: null };
  return carregarSessao(Number(t.id));
}
export async function getSession(): Promise<Session | null> { return (await sessaoDaRequisicao()).s; }

/** Sessão obrigatória. v29: também confere se a tela aberta (ou a ação enviada dela) faz parte do acesso do cargo. */
export async function requireSession(): Promise<Session> {
  const r = await sessaoDaRequisicao();
  if (!r.s) redirect(r.motivo ? `/api/sair?motivo=${r.motivo}` : "/login");
  let path = ""; try { path = (await headers()).get("x-pathname") ?? ""; } catch { path = ""; }
  const bloq = telaBloqueada(r.s, path); if (bloq) redirect(`/sem-acesso?t=${encodeURIComponent(bloq)}`);
  return r.s;
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

/** Páginas da Estratégia (gestão): todos os perfis de equipe, exceto autoatendimento. Cada ação confere a própria permissão e o escopo. */
export async function requireGestao(): Promise<Session> {
  const s = await requireSession();
  if (s.role === "COLABORADOR") redirect(s.employeeId ? `/colaboradores/${s.employeeId}` : "/conta");
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

/** Retorna a sessão, ou "bloqueado" quando há tentativas demais, "desligado" quando a ficha vinculada foi desligada, ou null quando credenciais não conferem. */
export async function login(email: string, senha: string, ip?: string | null): Promise<Session | "bloqueado" | "desligado" | null> {
  const e = email.trim().toLowerCase();
  // chaves internas de limite de tentativas ("REMATRICULA:12", "etica:ET-…") nunca são alcançáveis pelo formulário de login:
  // a entrada é minúscula e logins não têm ":" (ex.: rh@colegiostatus, direcao.teste)
  if (!e || e.includes(":") || /\s/.test(e) || e.length > 200) return null;
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM login_attempts WHERE email=${e} AND ok=false AND at > now() - interval '15 minutes'`;
  if (n >= MAX_TENTATIVAS) return "bloqueado";
  // seleção explícita de colunas: o login continua funcionando mesmo antes de uma atualização de esquema ser aplicada
  const [u] = await sql<{ id: number; nome: string; email: string; role: string; unit_id: number | null; employee_id: number | null; ativo: boolean; senha_hash: string }[]>`SELECT id, nome, email, role, unit_id, employee_id, ativo, senha_hash FROM users WHERE email=${e}`;
  const ok = !!u && u.ativo && (await bcrypt.compare(senha, u.senha_hash));
  await db.insert(schema.loginAttempts).values({ email: e, ip: ip ?? null, ok });
  if (!ok) return null;
  await sql`DELETE FROM login_attempts WHERE email=${e} AND at < now() - interval '1 day'`;
  // v29: o acesso vem do cargo da ficha (ou da conta sem ficha); ficha desligada não entra mais
  const ef = await sessaoDoUsuario(u!.id);
  if (!ef) { const [d] = await sql<{ ativo: boolean }[]>`SELECT ativo FROM users WHERE id=${u!.id}`; return d && !d.ativo ? "desligado" : null; }
  return ef;
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
  /** v29: importar títulos e caixa, cadastrar preços e editar o orçamento — atuação do financeiro E a aprovação “financeiro” marcada no cargo (o auxiliar opera, não importa nem orça). */
  gerirFinanceiro: (s: Session) => ["DIRECAO", "FINANCEIRO"].includes(s.role) && aprovacoesDa(s).includes("financeiro"),
  operacoes: (s: Session) => ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "OPERACOES"].includes(s.role),
  verSalario: (s: Session) => s.role === "RH" || s.role === "DIRECAO",
  verSensivel: (s: Session) => s.role === "RH" || s.role === "DIRECAO",
  configurar: (s: Session) => s.role === "RH" || s.role === "DIRECAO",
  solicitar: (s: Session) => s.role !== "LEITURA",
  /** v29: aprovação marcada no cargo (ou padrão da atuação, quando o cargo não personalizou). Chaves em lib/acesso → ALCADAS. */
  aprovar: (s: Session, chave: Alcada) => aprovacoesDa(s).includes(chave),
  auditoria: (s: Session) => s.role === "RH" || s.role === "DIRECAO",
};

/**
 * v29 · liderança fora da área de pessoas: cargo de outra área (Financeiro, Comercial, Operações) que tem a aprovação de férias
 * ou de banco de horas marcada aprova só a PRÓPRIA EQUIPE — as pessoas que têm a ficha dele como gestor direto.
 * RH e Direção aprovam a rede; Direção da unidade e Coordenação, a unidade (como sempre).
 */
export const ATUACOES_PESSOAS: Role[] = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"];
export const aprovaSoEquipe = (s: Session) => !ATUACOES_PESSOAS.includes(s.role);
/** Esta pessoa (ficha) está na equipe de quem aprova? Para quem aprova só a equipe: gestor direto = a ficha de quem aprova. */
export const naEquipe = (s: Session, e: { gestorId?: number | null; gestor_id?: number | null } | null | undefined) => !aprovaSoEquipe(s) || (!!s.employeeId && !!e && (e.gestorId ?? e.gestor_id ?? null) === s.employeeId);

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
/** v30 · Quem abre a FICHA de outra pessoa: as atuações de gestão de pessoas (no próprio alcance). Comercial, Financeiro e Operações
 *  abrem só a própria ficha e a de quem responde diretamente a elas (itens com colaboradores ficam em Operações → Itens com colaboradores). */
export const EQUIPE_FICHAS = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR", "LEITURA"];
export function podeAbrirFicha(s: Session, e: { id: number; unitId: number; gestorId?: number | null }) {
  if (!canSeeEmployee(s, e)) return false; if (EQUIPE_FICHAS.includes(s.role)) return true;
  return s.employeeId === e.id || (!!s.employeeId && e.gestorId === s.employeeId);
}

export function assert(cond: boolean, msg = "Sem permissão para esta ação.") { if (!cond) throw new Error(msg); }
