import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { responderPesquisa } from "@/app/(app)/clima-academy/actions";
import type { Pergunta } from "@/lib/clima-academy";
import { textoErro } from "@/lib/aviso";

export const dynamic = "force-dynamic";

export default async function PesquisaPublica({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ erro?: string; as?: string; obrigado?: string }> }) {
  const { token } = await params; const sp = await searchParams;
  const [sv] = await db.select().from(schema.climateSurveys).where(eq(schema.climateSurveys.token, token));
  const units = await db.select().from(schema.units).orderBy(asc(schema.units.nome));
  const Shell = ({ children }: { children: React.ReactNode }) => <main className="min-h-screen bg-mist px-4 py-8"><div className="mx-auto max-w-2xl rounded-lg border border-line bg-white p-6 shadow-sm"><div className="mb-4 text-xs tracking-wide text-slate-500">COLÉGIO STATUS · PESQUISA INTERNA</div>{children}</div></main>;
  if (!sv || sv.status !== "ABERTA") return <Shell><h1 className="text-xl font-semibold text-navy">Pesquisa indisponível</h1><p className="mt-2 text-sm text-slate-600">Esta pesquisa não está aberta no momento.</p></Shell>;
  if (sp.obrigado) return <Shell><h1 className="text-xl font-semibold text-navy">Obrigado!</h1><p className="mt-2 text-sm text-slate-600">Sua resposta foi registrada de forma anônima. Ela vai ajudar a melhorar o nosso ambiente de trabalho.</p></Shell>;
  const perguntas = sv.perguntas as Pergunta[];
  // v30 · pesquisa de liderança: a pessoa escolhe o próprio gestor direto (a lista traz só quem tem equipe)
  const gestores = sv.tipo === "LIDERANCA" ? await sql<{ id: number; nome: string; cargo: string | null; unidade: string }[]>`SELECT e.id, e.nome, p.nome AS cargo, u.nome AS unidade FROM employees e JOIN units u ON u.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id WHERE e.situacao <> 'DESLIGADO' AND EXISTS (SELECT 1 FROM employees x WHERE x.gestor_id=e.id AND x.situacao <> 'DESLIGADO') ${sv.unitId ? sql`AND e.unit_id=${sv.unitId}` : sql``} ORDER BY e.nome` : [];
  return (
    <Shell>
      <h1 className="text-xl font-semibold text-navy">{sv.nome}</h1>
      <p className="mt-1 text-sm text-slate-600">Anônima: não registramos seu nome, e-mail ou login. Os resultados só aparecem em grupos com pelo menos {sv.minimoAnonimato} respostas.</p>
      {textoErro(sp) && <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-erro">{textoErro(sp)}</p>}
      <form action={responderPesquisa} className="mt-5 space-y-5"><input type="hidden" name="token" value={token} />
        {sv.tipo === "LIDERANCA" && <label className="block rounded-md border border-sky-200 bg-sky-50 p-3 text-sm"><span className="mb-1 block font-medium text-navy">Quem é o seu gestor direto?</span><select name="gestorId" required defaultValue="" className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm"><option value="">Escolha</option>{gestores.map(g => <option key={g.id} value={g.id}>{g.nome}{g.cargo ? ` · ${g.cargo}` : ""} · {g.unidade}</option>)}</select><span className="mt-1 block text-[11px] text-slate-500">As respostas sobre cada gestor só aparecem somadas, com pelo menos {sv.minimoAnonimato} respostas — e nunca com o seu nome.</span></label>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">Unidade em que você trabalha (opcional)</span><select name="unitId" className="w-full rounded-md border border-line px-3 py-2 text-sm"><option value="">Prefiro não informar</option>{units.filter(x => !sv.unitId || x.id === sv.unitId).map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></label>
          <label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">Você é (opcional)</span><select name="regime" className="w-full rounded-md border border-line px-3 py-2 text-sm"><option value="">Prefiro não informar</option><option value="DOCENTE">Docente</option><option value="ADMINISTRATIVO">Administrativo / apoio</option></select></label>
        </div>
        {perguntas.map((q, i) => <fieldset key={q.id} className="rounded-md border border-line p-3"><legend className="px-1 text-xs font-medium text-acao">{q.dimensao}</legend><p className="text-sm text-ink">{i + 1}. {q.texto}</p>
          {q.tipo === "ESCALA" && <div className="mt-2 flex flex-wrap gap-2">{[1, 2, 3, 4, 5].map(n => <label key={n} className="flex cursor-pointer items-center gap-1 rounded border border-line px-3 py-1.5 text-sm has-[:checked]:border-acao has-[:checked]:bg-sky-50"><input type="radio" name={q.id} value={n} className="accent-acao" />{n}</label>)}<span className="ml-2 self-center text-xs text-slate-500">1 = discordo totalmente · 5 = concordo totalmente</span></div>}
          {q.tipo === "ENPS" && <div className="mt-2 flex flex-wrap gap-1">{Array.from({ length: 11 }, (_, n) => <label key={n} className="flex h-9 w-9 cursor-pointer items-center justify-center rounded border border-line text-sm has-[:checked]:border-acao has-[:checked]:bg-sky-50"><input type="radio" name={q.id} value={n} className="sr-only" />{n}</label>)}</div>}
          {q.tipo === "TEXTO" && <textarea name={q.id} className="mt-2 w-full rounded-md border border-line px-3 py-2 text-sm" rows={3} />}
        </fieldset>)}
        <button className="rounded-md bg-acao px-4 py-2 text-sm font-medium text-white hover:bg-navy-700">Enviar resposta anônima</button>
      </form>
    </Shell>
  );
}
