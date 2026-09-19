import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { audit, getSettings } from "@/lib/utils";
import { novoSegredo, qrSvg, verificarCodigo, gerarBackupCodes } from "@/lib/twofa";
import { Page, Card, Flash, Field, Input, Btn } from "@/components/ui";

export const dynamic = "force-dynamic";

async function ativar(fd: FormData) {
  "use server";
  const s = await requireSession(); const codigo = String(fd.get("codigo") ?? "");
  const [u] = await db.select({ totpSecret: schema.users.totpSecret, totpAtivo: schema.users.totpAtivo }).from(schema.users).where(eq(schema.users.id, s.id));
  if (!u?.totpSecret || u.totpAtivo) redirect(`/conta/2fa?erro=${encodeURIComponent("Comece de novo: recarregue a página para gerar um novo QR code.")}`);
  if (!verificarCodigo(u.totpSecret, codigo)) redirect(`/conta/2fa?erro=${encodeURIComponent("Código inválido. Confira o relógio do celular e tente de novo.")}`);
  const { codes, hashes } = await gerarBackupCodes();
  await db.update(schema.users).set({ totpAtivo: true, backupCodes: hashes }).where(eq(schema.users.id, s.id));
  await audit(s, "ativar 2FA", "users", s.id);
  redirect(`/conta/2fa?codigos=${encodeURIComponent(codes.join(" "))}`);
}
async function desativar(fd: FormData) {
  "use server";
  const s = await requireSession(); const cfg = await getSettings(); if (cfg.seguranca.exigir2FA.includes(s.role)) redirect(`/conta/2fa?erro=${encodeURIComponent("Seu perfil exige a verificação em duas etapas.")}`);
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, s.id)); if (!u?.totpSecret || !verificarCodigo(u.totpSecret, String(fd.get("codigo") ?? ""))) redirect(`/conta/2fa?erro=${encodeURIComponent("Código inválido.")}`);
  await db.update(schema.users).set({ totpSecret: null, totpAtivo: false, backupCodes: null }).where(eq(schema.users.id, s.id)); await audit(s, "desativar 2FA", "users", s.id);
  redirect(`/conta/2fa?ok=${encodeURIComponent("Verificação em duas etapas desativada.")}`);
}

export default async function DoisFatores({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string; codigos?: string }> }) {
  const s = await requireSession(); const sp = await searchParams; const cfg = await getSettings(); const [u] = await db.select().from(schema.users).where(eq(schema.users.id, s.id));
  const obrigatorio = cfg.seguranca.exigir2FA.includes(s.role);
  let svg = ""; let secret = "";
  if (!u.totpAtivo) { secret = u.totpSecret ?? ""; if (!secret) { secret = novoSegredo(); await db.update(schema.users).set({ totpSecret: secret }).where(eq(schema.users.id, s.id)); } svg = await qrSvg(secret, s.email); }
  return (
    <Page title="Verificação em duas etapas" sub={obrigatorio ? "Obrigatória para o seu perfil: além da senha, um código do aplicativo autenticador a cada login." : "Opcional para o seu perfil, recomendada."}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {sp.codigos && <Card className="mb-4 border-emerald-200" title="Códigos de recuperação — guarde agora, não aparecem de novo"><div className="grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-4">{sp.codigos.split(" ").map(c => <span key={c} className="rounded bg-mist px-2 py-1">{c}</span>)}</div><p className="mt-2 text-xs text-slate-600">Cada código funciona uma vez. Use se perder o celular. Guarde fora do computador (impresso ou no gerenciador de senhas).</p></Card>}
      {u.totpAtivo ? <Card title="Ativa"><p className="text-sm">A verificação em duas etapas está ativa para <b>{s.email}</b>. Códigos de recuperação restantes: {((u.backupCodes as string[] | null) ?? []).length}.</p>{!obrigatorio && <form action={desativar} className="mt-3 flex items-end gap-2"><Field label="Código atual para desativar"><Input name="codigo" inputMode="numeric" required /></Field><Btn kind="ghost" danger>Desativar</Btn></form>}{obrigatorio && <p className="mt-2 text-xs text-slate-500">Perdeu o celular e os códigos? Peça ao RH para redefinir em Configurações → Usuários.</p>}</Card> :
        <div className="grid gap-4 lg:grid-cols-[220px_1fr]"><Card title="1. Leia o QR code"><div dangerouslySetInnerHTML={{ __html: svg }} /><p className="mt-2 text-xs text-slate-600">No Google Authenticator, Microsoft Authenticator ou Authy: adicionar conta → ler QR code. Sem câmera, digite a chave: <code className="break-all text-[11px]">{secret}</code></p></Card>
          <Card title="2. Digite o código do aplicativo"><form action={ativar} className="flex items-end gap-2"><Field label="Código de 6 dígitos"><Input name="codigo" inputMode="numeric" autoComplete="one-time-code" required autoFocus /></Field><Btn>Ativar</Btn></form><p className="mt-3 text-xs text-slate-600">Ao ativar, você recebe 8 códigos de recuperação. {obrigatorio && "Enquanto não ativar, o sistema volta para esta tela."}</p></Card></div>}
    </Page>
  );
}
