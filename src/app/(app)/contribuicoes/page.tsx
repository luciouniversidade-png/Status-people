import { requireSession } from "@/lib/auth";
import { Page, Flash } from "@/components/ui";
import { ConvitesFontes } from "@/components/VisaoDesempenho";

export const dynamic = "force-dynamic";

/** Contribuições de avaliação solicitadas ao usuário (múltiplas fontes). Aberta a qualquer perfil convidado. */
export default async function Contribuicoes({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams;
  return <Page title="Contribuições solicitadas a você" sub="Você foi convidado a contribuir com a avaliação de um colega porque teve oportunidade de observar o trabalho dele. Responda só o que observou."><Flash ok={sp.ok} erro={sp.erro} /><ConvitesFontes s={s} vazio /></Page>;
}
