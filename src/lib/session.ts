// Sessão via cookie JWT (sem dependências Node) — usado também pelo middleware (Edge).
import { SignJWT, jwtVerify } from "jose";

export type Role = "DIRECAO" | "RH" | "DIRETOR_UNIDADE" | "GESTOR" | "LEITURA" | "COLABORADOR" | "COMERCIAL" | "FINANCEIRO" | "OPERACOES";
/**
 * Sessão. v29: `role` é a ATUAÇÃO que vem do cargo da ficha (ou da exceção / da conta sem ficha), recalculada do banco a cada requisição;
 * `telas` = telas que o cargo marcou (null = todas as da atuação); `aprova` = aprovações efetivas (alçadas por cargo).
 * O cookie só identifica a pessoa — mudar o cargo, a ficha ou o acesso vale na próxima tela, sem novo login.
 */
export type Session = {
  id: number; nome: string; email: string; role: Role; unitId: number | null; employeeId: number | null;
  telas?: string[] | null; aprova?: string[]; cargo?: string | null; positionId?: number | null; origem?: string;
  substituicao?: { cargo: string; ate: string; motivo: string } | null; descontoPct?: number;
};
export const COOKIE = "rh_session";
/** Falha segura: sem AUTH_SECRET (mínimo 32 caracteres) o sistema não assina nem aceita sessões. */
const secret = () => {
  const v = process.env.AUTH_SECRET;
  if (!v || v.length < 32) throw new Error("AUTH_SECRET ausente ou curto (mínimo 32 caracteres). Configure a variável no servidor.");
  return new TextEncoder().encode(v);
};

export async function signSession(s: Session) {
  // só a identificação vai no cookie; atuação, telas e aprovações são lidas do banco a cada requisição
  const { id, nome, email, role, unitId, employeeId } = s;
  return new SignJWT({ id, nome, email, role, unitId, employeeId } as unknown as Record<string, unknown>).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("12h").sign(secret());
}
export async function verifyToken(token: string): Promise<Session | null> {
  try { const { payload } = await jwtVerify(token, secret()); return payload as unknown as Session; } catch { return null; }
}
