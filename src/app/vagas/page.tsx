import type { Metadata } from "next";
import Link from "next/link";
import { sql } from "@/db";
import { getSettings } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Trabalhe conosco · Colégio Status" };

/** v30 · Página pública de vagas — só as vagas abertas que o RH marcou para publicar; desligada até o GO. */
export default async function Vagas() {
  const cfg = await getSettings(); const pag = cfg.recrutamento.paginaPublica as { ativa?: boolean; titulo?: string; texto?: string };
  const Shell = ({ children }: { children: React.ReactNode }) => <main className="min-h-screen bg-mist px-3 py-6 sm:px-4 sm:py-10"><div className="mx-auto max-w-3xl"><div className="mb-4 text-xs font-semibold uppercase tracking-wide text-navy">Colégio Status · Trabalhe conosco</div>{children}</div></main>;
  if (!pag?.ativa) return <Shell><div className="rounded-lg border border-line bg-white p-6"><h1 className="text-xl font-semibold text-navy">Página de vagas indisponível</h1><p className="mt-2 text-sm text-slate-600">Volte em breve.</p></div></Shell>;
  const vagas = await sql<{ titulo: string; slug: string; unidade: string; regime: string; jornada: string | null; descricao: string | null }[]>`SELECT r.titulo, r.slug, u.nome AS unidade, r.regime, r.jornada, r.descricao_publica AS descricao FROM requisitions r JOIN units u ON u.id=r.unit_id WHERE r.status='ABERTA' AND r.publicar AND r.slug IS NOT NULL ORDER BY r.aberta_em DESC NULLS LAST, r.id DESC`;
  return <Shell>
    <h1 className="text-2xl font-semibold text-navy">{pag.titulo ?? "Trabalhe conosco"}</h1>
    {pag.texto && <p className="mt-2 text-sm text-slate-700">{pag.texto}</p>}
    <ul className="mt-5 space-y-3">{vagas.map(v => <li key={v.slug} className="rounded-lg border border-line bg-white p-4"><Link href={`/vagas/${v.slug}`} className="text-lg font-semibold text-acao hover:underline">{v.titulo}</Link><div className="text-xs text-slate-500">{[v.titulo.includes(v.unidade) ? null : v.unidade, v.regime].filter(Boolean).join(" · ")}{v.jornada ? ` · ${v.jornada}` : ""}</div>{v.descricao && <p className="mt-2 line-clamp-3 text-sm text-slate-700">{v.descricao}</p>}<Link href={`/vagas/${v.slug}`} className="mt-2 inline-block text-sm font-medium text-acao">Ver a vaga e se candidatar →</Link></li>)}</ul>
    {vagas.length === 0 && <p className="mt-5 rounded-lg border border-line bg-white p-4 text-sm text-slate-600">Nenhuma vaga aberta no momento. Volte em breve!</p>}
    <p className="mt-6 text-[11px] text-slate-500">Seus dados são usados só no processo seletivo e guardados por até {cfg.recrutamento.portal?.retencaoMeses ?? 12} meses se você não for contratado(a). Você pode pedir a exclusão a qualquer momento pelo link que recebe ao se candidatar.</p>
  </Shell>;
}
