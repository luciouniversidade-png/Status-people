import { requireSession, ROLE_LABEL } from "@/lib/auth";
import { Page, Card, Flash, Field, Input, Btn } from "@/components/ui";
import { trocarMinhaSenha } from "../configuracoes/actions";

export const dynamic = "force-dynamic";

export default async function Conta({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams;
  return (
    <Page title="Minha conta" sub={`${s.nome} · ${s.email} · ${ROLE_LABEL[s.role]}`}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {sp.trocar && <Card className="mb-4 border-amber-200"><p className="text-sm">Você entrou com uma <b>senha temporária</b>. Crie a sua senha abaixo para continuar usando o sistema.</p></Card>}
      <Card title="Trocar senha">
        <form action={trocarMinhaSenha} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Field label="Senha atual"><Input name="atual" type="password" required autoComplete="current-password" /></Field>
          <Field label="Nova senha"><Input name="nova" type="password" required minLength={8} autoComplete="new-password" /></Field>
          <div className="flex items-end"><Btn>Alterar</Btn></div>
        </form>
      </Card>
      <Card title="Verificação em duas etapas" className="mt-4"><p className="text-sm">Proteja seu acesso com um código do celular além da senha. <a className="text-acao" href="/conta/2fa">Configurar</a></p></Card>
    </Page>
  );
}
