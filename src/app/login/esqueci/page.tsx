import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSession } from "@/lib/auth";
import { pedirRedefinicao } from "@/lib/reset";
import { audit } from "@/lib/utils";
import { Btn, Field, Input } from "@/components/ui";

async function pedir(fd: FormData) {
  "use server";
  const email = String(fd.get("email") ?? "").trim().toLowerCase(); if (!email) redirect("/login/esqueci");
  const h = await headers(); const host = h.get("x-forwarded-host") ?? h.get("host") ?? ""; const proto = h.get("x-forwarded-proto") ?? "https"; const appUrl = process.env.APP_URL || `${proto}://${host}`;
  const r = await pedirRedefinicao(email, appUrl);
  if (r.existe) await audit(null, r.enviado ? "pedido de redefinição (e-mail enviado)" : "pedido de redefinição (aguarda RH)", "password_resets", null, null, { email });
  redirect(`/login/esqueci?ok=${r.enviado ? "email" : "rh"}`);
}

export default async function Esqueci({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  if (await getSession()) redirect("/"); const { ok } = await searchParams; const temEmail = !!process.env.RESEND_API_KEY && !!process.env.MAIL_FROM;
  return (
    <main className="flex min-h-screen items-center justify-center bg-navy px-4"><div className="w-full max-w-sm rounded-lg bg-white p-8 shadow-xl">
      <div className="mb-6"><div className="text-xs tracking-wide text-slate-500">Colégio Status · STATUS ONE</div><h1 className="text-2xl font-semibold text-navy">Esqueci minha senha</h1></div>
      {ok ? <div className="space-y-3 text-sm text-slate-700"><p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">{ok === "email" ? "Se este e-mail estiver cadastrado, enviamos um link para criar uma nova senha. Ele vale por 1 hora — confira também a caixa de spam." : "Pedido registrado. O RH verá a solicitação em Configurações → Usuários e vai lhe passar uma senha temporária pessoalmente ou pelo WhatsApp; no primeiro acesso você cria a sua."}</p><a className="text-acao" href="/login">Voltar ao login</a></div> :
        <form action={pedir} className="space-y-4"><p className="text-sm text-slate-600">{temEmail ? "Informe o e-mail de acesso. Você receberá um link para criar uma nova senha." : "Informe o e-mail de acesso. Como o envio de e-mail não está ativo, o pedido chega ao RH, que gera uma senha temporária para você."}</p><Field label="E-mail de acesso"><Input name="email" type="text" required autoFocus autoComplete="username" placeholder="nome@colegiostatus" /></Field><Btn>Pedir nova senha</Btn><p className="text-center text-xs"><a className="text-acao" href="/login">Voltar ao login</a></p></form>}
    </div></main>
  );
}
