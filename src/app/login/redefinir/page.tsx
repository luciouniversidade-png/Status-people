import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { redefinirPorToken } from "@/lib/reset";
import { audit } from "@/lib/utils";
import { Btn, Field, Input } from "@/components/ui";

async function redefinir(fd: FormData) {
  "use server";
  const token = String(fd.get("token") ?? ""); const nova = String(fd.get("nova") ?? ""); const conf = String(fd.get("confirma") ?? "");
  if (nova.length < 8) redirect(`/login/redefinir?token=${encodeURIComponent(token)}&erro=${encodeURIComponent("A senha precisa ter pelo menos 8 caracteres.")}`);
  if (nova !== conf) redirect(`/login/redefinir?token=${encodeURIComponent(token)}&erro=${encodeURIComponent("As senhas não conferem.")}`);
  const uid = await redefinirPorToken(token, nova); if (!uid) redirect(`/login/redefinir?erro=${encodeURIComponent("Link inválido ou expirado. Peça um novo em “Esqueci minha senha”.")}`);
  await audit(null, "senha redefinida por link", "users", uid, null, null);
  redirect(`/login?ok=${encodeURIComponent("Senha alterada. Entre com a nova senha.")}`);
}

export default async function Redefinir({ searchParams }: { searchParams: Promise<{ token?: string; erro?: string }> }) {
  if (await getSession()) redirect("/"); const { token, erro } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-navy px-4"><div className="w-full max-w-sm rounded-lg bg-white p-8 shadow-xl">
      <div className="mb-6"><div className="text-xs tracking-wide text-slate-500">Colégio Status · STATUS ONE</div><h1 className="text-2xl font-semibold text-navy">Criar nova senha</h1></div>
      {erro && <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-erro">{erro}</p>}
      {token ? <form action={redefinir} className="space-y-4"><input type="hidden" name="token" value={token} /><Field label="Nova senha (mínimo 8)"><Input name="nova" type="password" required minLength={8} autoComplete="new-password" autoFocus /></Field><Field label="Confirmar"><Input name="confirma" type="password" required minLength={8} autoComplete="new-password" /></Field><Btn>Salvar nova senha</Btn></form> : <p className="text-sm"><a className="text-acao" href="/login/esqueci">Pedir um novo link</a></p>}
    </div></main>
  );
}
