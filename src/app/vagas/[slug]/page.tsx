import type { Metadata } from "next";
import Link from "next/link";
import { sql } from "@/db";
import { getSettings } from "@/lib/utils";
import { textoErro } from "@/lib/aviso";
import { candidatarPublico } from "../actions";
import { Btn } from "@/components/Btn";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Vaga · Colégio Status" };
const inp = "w-full rounded-md border border-line bg-white px-3 py-2.5 text-base text-ink focus:border-acao focus:outline-none focus:ring-1 focus:ring-acao sm:text-sm";

/** v30 · Uma vaga da página pública e o formulário de candidatura (sem login, com consentimento e proteção contra robôs). */
export default async function VagaPublica({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params; const sp = await searchParams; const cfg = await getSettings(); const pag = cfg.recrutamento.paginaPublica as { ativa?: boolean };
  const Shell = ({ children }: { children: React.ReactNode }) => <main className="min-h-screen bg-mist px-3 py-6 sm:px-4 sm:py-10"><div className="mx-auto max-w-2xl"><div className="mb-4 text-xs font-semibold uppercase tracking-wide text-navy"><Link href="/vagas">Colégio Status · Trabalhe conosco</Link></div><div className="rounded-lg border border-line bg-white p-4 shadow-sm sm:p-6">{children}</div></div></main>;
  if (!pag?.ativa) return <Shell><h1 className="text-xl font-semibold text-navy">Página de vagas indisponível</h1></Shell>;
  const [v] = await sql<{ id: number; titulo: string; unidade: string; regime: string; jornada: string | null; descricao: string | null }[]>`SELECT r.id, r.titulo, u.nome AS unidade, r.regime, r.jornada, r.descricao_publica AS descricao FROM requisitions r JOIN units u ON u.id=r.unit_id WHERE r.slug=${slug} AND r.publicar AND r.status='ABERTA'`;
  if (!v) return <Shell><h1 className="text-xl font-semibold text-navy">Vaga encerrada</h1><p className="mt-2 text-sm text-slate-600">Esta vaga não está mais aberta. <Link className="text-acao underline" href="/vagas">Ver as vagas abertas</Link></p></Shell>;
  if (!sp.enviado && !sp.erro) await sql`UPDATE requisitions SET visualizacoes=visualizacoes+1 WHERE id=${v.id}`;
  const erro = textoErro(sp);
  return <Shell>
    <h1 className="text-xl font-semibold text-navy">{v.titulo}</h1>
    <div className="text-xs text-slate-500">{[v.titulo.includes(v.unidade) ? null : v.unidade, v.regime, v.jornada].filter(Boolean).join(" · ")}</div>
    {v.descricao && <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{v.descricao}</p>}
    {sp.enviado ? <p role="status" className="mt-4 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-ok">Candidatura recebida. Obrigado!</p> : <>
      <h2 className="mt-6 text-sm font-semibold text-navy">Candidatar-se</h2>
      {erro && <p role="alert" className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-erro">{erro}</p>}
      <form action={candidatarPublico} className="mt-2 space-y-3"><input type="hidden" name="slug" value={slug} />
        <div className="hidden" aria-hidden><label>Site<input name="site" tabIndex={-1} autoComplete="off" /></label></div>
        <label className="block text-sm">Nome completo<input name="nome" required minLength={5} className={inp} autoComplete="name" /></label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="block text-sm">E-mail<input name="email" type="email" required className={inp} autoComplete="email" /></label><label className="block text-sm">Telefone (com DDD)<input name="telefone" inputMode="tel" className={inp} autoComplete="tel" /></label></div>
        <label className="block text-sm">Cidade<input name="cidade" className={inp} defaultValue="Campo Grande" /></label>
        <label className="block text-sm">Sua trajetória<textarea name="curriculo" required minLength={80} maxLength={20000} className={`${inp} min-h-[160px]`} placeholder="Formação, experiências, cursos e o que você faz bem. Pode colar o seu currículo." /><span className="text-[11px] text-slate-500">Não informe idade, estado civil, religião, saúde ou documentos — não usamos isso na seleção.</span></label>
        <label className="block text-sm">Link do currículo ou portfólio (opcional)<input name="link" className={inp} placeholder="https://" /></label>
        <label className="flex items-start gap-2 text-xs text-slate-700"><input type="checkbox" name="consentimento" value="1" required className="mt-0.5" /> Autorizo o Colégio Status a usar meus dados neste processo seletivo e a guardá-los por até {cfg.recrutamento.portal?.retencaoMeses ?? 12} meses para próximas vagas. Posso pedir a exclusão a qualquer momento.</label>
        <Btn>Enviar candidatura</Btn>
        <p className="text-[11px] text-slate-500">Ao enviar, você recebe um link pessoal para acompanhar a candidatura, enviar documentos e conversar com o RH.</p>
      </form></>}
  </Shell>;
}
