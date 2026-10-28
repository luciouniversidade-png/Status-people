import Link from "@/components/Link";
import { requireSession, can } from "@/lib/auth";
import { Page, Card } from "@/components/ui";
import { rotuloTela, rotuloAtuacao } from "@/lib/acesso";

export const dynamic = "force-dynamic";

/** Tela fora do acesso do cargo (v29): explica e indica o caminho, sem mostrar nada da tela pedida. */
export default async function SemAcesso({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const s = await requireSession(); const { t } = await searchParams; const tela = t ? rotuloTela(t) : "esta tela";
  return (
    <Page title="Tela fora do seu acesso" sub={`${s.cargo ? `Cargo: ${s.cargo}` : "Conta sem ficha"} · atuação ${rotuloAtuacao(s.role)}`}>
      <Card>
        <p className="text-sm text-ink">A tela <b>{tela}</b> não faz parte do acesso {s.cargo ? <>do cargo <b>{s.cargo}</b></> : "desta conta"}. O acesso é definido pelo cargo, para todas as pessoas que têm o mesmo cargo.</p>
        <p className="mt-2 text-sm text-slate-600">Se você precisa dela no seu trabalho, fale com o RH ou com a Direção: eles ajustam o acesso do cargo (ou registram uma exceção, com motivo).</p>
        <div className="mt-4 flex flex-wrap gap-2 text-sm"><Link href="/" className="rounded-md bg-acao px-3 py-1.5 font-medium text-white hover:bg-navy-700">Ir para o Início</Link>{can.configurar(s) && <Link href={s.positionId ? `/configuracoes/acessos/cargo/${s.positionId}` : "/configuracoes/acessos"} className="rounded-md border border-line px-3 py-1.5 text-navy hover:bg-mist">Ver o acesso do cargo</Link>}</div>
      </Card>
    </Page>
  );
}
