import { requireSession, ROLE_LABEL } from "@/lib/auth";
import { Page, Card, Flash, Field, Input, Btn } from "@/components/ui";
import { trocarMinhaSenha } from "../configuracoes/actions";
import { AtivarPush } from "@/components/AtivarPush";
import { vapid, PUSH_COOKIE } from "@/lib/push";
import { removerAparelho } from "./push-actions";
import { cookies } from "next/headers";
import { sql } from "@/db";
import { fmtDataHora } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Conta({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams;
  const [chave, aparelhos] = await Promise.all([vapid().then(v => v.publicKey).catch(() => ""), sql<{ id: number; endpoint: string; user_agent: string | null; created_at: string; ultimo_envio: string | null; tipos: string }[]>`SELECT id, endpoint, user_agent, created_at::text, ultimo_envio::text, tipos FROM push_subscriptions WHERE user_id=${s.id} ORDER BY created_at DESC`.catch(() => [])]);
  const desteAparelho = (await cookies()).get(PUSH_COOKIE)?.value;
  const aparelho = (ua: string | null) => { if (!ua) return "Aparelho"; const so = /iphone|ipad/i.test(ua) ? "iPhone/iPad" : /android/i.test(ua) ? "Android" : /windows/i.test(ua) ? "Windows" : /mac os/i.test(ua) ? "Mac" : /linux/i.test(ua) ? "Linux" : "Aparelho"; const nav = /edg\//i.test(ua) ? "Edge" : /firefox|fxios/i.test(ua) ? "Firefox" : /samsungbrowser/i.test(ua) ? "Samsung Internet" : /chrome|crios/i.test(ua) ? "Chrome" : /safari/i.test(ua) ? "Safari" : ""; return nav ? `${so} · ${nav}` : so; };
  return (
    <Page title="Minha conta" sub={`${s.nome} · ${s.email} · ${ROLE_LABEL[s.role]}`}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {sp.trocar && <Card className="mb-4 border-amber-200"><p className="text-sm">Você entrou com uma <b>senha temporária</b>. Crie a sua senha abaixo para continuar usando o sistema.</p></Card>}
      <Card title="Trocar senha">
        <form action={trocarMinhaSenha} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <input type="text" name="username" autoComplete="username" value={s.email} readOnly hidden />
          <Field label="Senha atual"><Input name="atual" type="password" required autoComplete="current-password" /></Field>
          <Field label="Nova senha"><Input name="nova" type="password" required minLength={8} autoComplete="new-password" /></Field>
          <div className="flex items-end"><Btn>Alterar</Btn></div>
        </form>
      </Card>
      <Card title="App no celular e notificações" className="mt-4">
        <p className="mb-2 text-sm text-slate-600">Instale o STATUS ONE como app: no Android (Chrome), menu ⋮ → <b>Instalar app</b>; no iPhone (Safari), <b>Compartilhar → Adicionar à Tela de Início</b>. Com as notificações ativas, convites para cobrir aula, aprovações, alertas da portaria e prazos chegam no celular.</p>
        {chave ? <AtivarPush publicKey={chave} /> : <p className="text-sm text-aviso">Notificações indisponíveis: o banco ainda não foi atualizado.</p>}
        {aparelhos.length > 0 && <div className="mt-3 border-t border-line pt-2">
          <div className="text-xs font-medium text-slate-500">Aparelhos que recebem os seus avisos</div>
          <ul className="mt-1 divide-y divide-line text-sm">{aparelhos.map(a => <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span className="min-w-0">{aparelho(a.user_agent)}{a.endpoint === desteAparelho && <b className="ml-1 text-xs text-ok">(este aparelho)</b>}<span className="block text-xs text-slate-500">desde {fmtDataHora(a.created_at).slice(0, 10)} · {a.tipos === "TODOS" ? "todos os avisos" : "só ação e alertas"}{a.ultimo_envio ? ` · último aviso ${fmtDataHora(a.ultimo_envio)}` : ""}</span></span>
            {a.endpoint !== desteAparelho && <form action={removerAparelho}><input type="hidden" name="id" value={a.id} /><button className="rounded border border-red-200 px-2 py-1 text-xs text-erro hover:bg-red-50">Remover</button></form>}
          </li>)}</ul>
          <p className="mt-1 text-xs text-slate-500">Ao clicar em <b>Sair</b>, o aparelho em uso deixa de receber os seus avisos. Trocou ou perdeu o celular? Remova-o aqui.</p>
        </div>}
      </Card>
      <Card title="Verificação em duas etapas" className="mt-4"><p className="text-sm">Proteja seu acesso com um código do celular além da senha. <a className="text-acao" href="/conta/2fa">Configurar</a></p></Card>
    </Page>
  );
}
