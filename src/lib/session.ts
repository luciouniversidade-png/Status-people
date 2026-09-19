// Sessão via cookie JWT (sem dependências Node) — usado também pelo middleware (Edge).
import { SignJWT, jwtVerify } from "jose";

export type Role = "DIRECAO" | "RH" | "DIRETOR_UNIDADE" | "GESTOR" | "LEITURA" | "COLABORADOR" | "COMERCIAL" | "FINANCEIRO" | "OPERACOES";
export type Session = { id: number; nome: string; email: string; role: Role; unitId: number | null; employeeId: number | null };
export const COOKIE = "rh_session";
/** Falha segura: sem AUTH_SECRET (mínimo 32 caracteres) o sistema não assina nem aceita sessões. */
const secret = () => {
  const v = process.env.AUTH_SECRET;
  if (!v || v.length < 32) throw new Error("AUTH_SECRET ausente ou curto (mínimo 32 caracteres). Configure a variável no servidor.");
  return new TextEncoder().encode(v);
};

export async function signSession(s: Session) {
  return new SignJWT(s as unknown as Record<string, unknown>).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("12h").sign(secret());
}
export async function verifyToken(token: string): Promise<Session | null> {
  try { const { payload } = await jwtVerify(token, secret()); return payload as unknown as Session; } catch { return null; }
}
