import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createSession, login, getSession, totpAtivoDe } from "@/lib/auth";
import { audit } from "@/lib/utils";
import { cookies } from "next/headers";
import { SignJWT } from "jose";
import { Btn, Field, Input } from "@/components/ui";

async function entrar(fd: FormData) {
  "use server";
  const email = String(fd.get("email") ?? ""); const senha = String(fd.get("senha") ?? "");
  const h = await headers();
  const s = await login(email, senha, h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null);
  if (s === "bloqueado") redirect("/login?erro=bloqueado");
  if (!s) redirect("/login?erro=1");
  if (await totpAtivoDe(s.id)) {
    // senha conferida; falta a segunda etapa — cookie de 5 minutos que só serve para a tela do código
    const pre = await new SignJWT({ uid: s.id, pre2fa: true }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
    (await cookies()).set("rh_pre2fa", pre, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 300 });
    redirect("/login/2fa");
  }
  await createSession(s);
  await audit(s, "login", "users", s.id);
  redirect("/");
}

export default async function Login({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  if (await getSession()) redirect("/");
  const { erro, ok } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-navy px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow-xl">
        <div className="mb-6">
          <div className="text-xs tracking-wide text-slate-500">Colégio Status</div>
          <h1 className="text-2xl font-semibold text-navy">STATUS ONE</h1>
          <p className="mt-1 text-sm text-slate-600">Pessoas, matrículas, atendimento, financeiro, operações e governança das quatro unidades.</p>
        </div>
        {ok && <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-ok">{ok}</p>}
        {erro && <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-erro">{erro === "bloqueado" ? "Muitas tentativas seguidas. Aguarde 15 minutos e tente de novo." : erro === "inativo" ? "Este acesso foi desativado. Fale com o RH." : erro === "2fa_expirou" ? "A verificação expirou. Entre de novo." : "E-mail ou senha não conferem."}</p>}
        <form action={entrar} className="space-y-4">
          <Field label="E-mail"><Input name="email" type="text" autoComplete="username" required autoFocus /></Field>
          <Field label="Senha"><Input name="senha" type="password" autoComplete="current-password" required /></Field>
          <Btn>Entrar</Btn>
          <p className="text-center text-xs"><a className="text-acao" href="/login/esqueci">Esqueci minha senha</a></p>
        </form>
      </div>
    </main>
  );
}
