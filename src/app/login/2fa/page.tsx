import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createSession, getSession } from "@/lib/auth";
import { audit } from "@/lib/utils";
import { verificarCodigo, usarBackupCode } from "@/lib/twofa";
import { Btn, Field, Input } from "@/components/ui";
import type { Role } from "@/lib/session";

async function lerPre() {
  const tok = (await cookies()).get("rh_pre2fa")?.value; if (!tok) return null;
  try { const { payload } = await jwtVerify(tok, new TextEncoder().encode(process.env.AUTH_SECRET!)); return payload.pre2fa ? Number(payload.uid) : null; } catch { return null; }
}

async function confirmar(fd: FormData) {
  "use server";
  const uid = await lerPre(); if (!uid) redirect("/login?erro=2fa_expirou");
  const codigo = String(fd.get("codigo") ?? "").trim();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, uid)); if (!u || !u.ativo || !u.totpSecret) redirect("/login?erro=1");
  let ok = verificarCodigo(u.totpSecret, codigo); let restantes: string[] | null = null;
  if (!ok && /^\d{5}-\d{5}$/.test(codigo)) { restantes = await usarBackupCode((u.backupCodes as string[] | null) ?? [], codigo); ok = restantes !== null; }
  if (!ok) redirect("/login/2fa?erro=1");
  if (restantes) await db.update(schema.users).set({ backupCodes: restantes }).where(eq(schema.users.id, uid));
  const s = { id: u.id, nome: u.nome, email: u.email, role: u.role as Role, unitId: u.unitId, employeeId: u.employeeId };
  (await cookies()).delete("rh_pre2fa"); await createSession(s); await audit(s, restantes ? "login (código de recuperação)" : "login (2FA)", "users", s.id);
  redirect("/");
}

export default async function Dois({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  if (await getSession()) redirect("/"); if (!(await lerPre())) redirect("/login?erro=2fa_expirou"); const { erro } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-navy px-4"><div className="w-full max-w-sm rounded-lg bg-white p-8 shadow-xl">
      <div className="mb-6"><div className="text-xs tracking-wide text-slate-500">Colégio Status · STATUS ONE</div><h1 className="text-2xl font-semibold text-navy">Verificação em duas etapas</h1><p className="mt-1 text-sm text-slate-600">Abra o aplicativo autenticador no celular e digite o código de 6 dígitos. Sem o celular, use um código de recuperação.</p></div>
      {erro && <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-erro">Código inválido ou expirado.</p>}
      <form action={confirmar} className="space-y-4"><Field label="Código"><Input name="codigo" inputMode="numeric" autoComplete="one-time-code" required autoFocus placeholder="123456" /></Field><Btn>Confirmar</Btn></form>
    </div></main>
  );
}
