import Link from "next/link";
import { redirect } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireStaff, scopeUnit } from "@/lib/auth";
import { asc } from "drizzle-orm";
import { Page, Card, Flash, Field, Select, Textarea, Btn } from "@/components/ui";
import { fmtDataHora } from "@/lib/utils";
import { contextoIA } from "@/lib/talentos-analytics";
import { perguntar } from "../../sucessao-analytics/actions";

export const dynamic = "force-dynamic";

export default async function Assistente({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); if (!["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role)) redirect("/"); const sp = await searchParams; const scope = scopeUnit(s);
  const [resp, historico, units, ctx] = await Promise.all([sp.resposta ? db.select().from(schema.aiLog).where(eq(schema.aiLog.id, Number(sp.resposta))) : Promise.resolve([]), db.select().from(schema.aiLog).orderBy(desc(schema.aiLog.at)).limit(8), scope ? Promise.resolve([]) : db.select().from(schema.units).orderBy(asc(schema.units.nome)), contextoIA(scope)]);
  const r = resp[0]; const configurado = !!process.env.AI_API_KEY;
  return (
    <Page title="People AI" sub="Perguntas sobre os dados de pessoas, respondidas no formato do STATUS ONE: fato · associação · hipótese · confiança · próximos passos. O assistente lê apenas dados agregados e anonimizados." actions={<Btn kind="ghost" href="/analytics">Painel</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {!configurado && <Card className="mb-4 border-amber-200"><p className="text-sm">O assistente ainda não está ligado: cadastre a variável <code className="rounded bg-mist px-1">AI_API_KEY</code> (chave da Anthropic) no servidor — e, se quiser, <code className="rounded bg-mist px-1">AI_MODEL</code>. Sem ela, as perguntas ficam registradas com erro e nada é enviado para fora.</p></Card>}
      <div className="grid gap-4 lg:grid-cols-[1fr_380px] lg:items-start">
        <div className="space-y-4">
          <Card title="Pergunta"><form action={perguntar} className="space-y-2">{!scope && <Field label="Recorte"><Select name="unitId" defaultValue=""><option value="">Rede inteira</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}<Field label="O que você quer saber?"><Textarea name="pergunta" className="min-h-[80px]" required placeholder="Ex.: Onde está o maior risco de perda de pessoas nos próximos 6 meses e o que eu deveria fazer primeiro?" /></Field><Btn>Perguntar</Btn></form></Card>
          {r && <Card title={`Resposta · ${fmtDataHora(r.at)}${r.modelo ? ` · ${r.modelo}` : ""}`}><p className="mb-2 text-xs text-slate-500">Pergunta: {r.pergunta}</p>{r.erro ? <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-erro">{r.erro}</p> : <div className="whitespace-pre-wrap text-sm">{r.resposta}</div>}{r.tokensEntrada ? <p className="mt-2 text-xs text-slate-400">{r.tokensEntrada} tokens de entrada · {r.tokensSaida} de saída</p> : null}</Card>}
          <Card title="Histórico"><ul className="space-y-1 text-sm">{historico.length === 0 && <li className="text-slate-500">Nenhuma pergunta ainda.</li>}{historico.map(h => <li key={h.id}><Link className="text-acao" href={`/analytics/assistente?resposta=${h.id}`}>{h.pergunta.slice(0, 90)}</Link> <span className="text-xs text-slate-500">· {h.userNome} · {fmtDataHora(h.at)}{h.erro ? " · erro" : ""}</span></li>)}</ul></Card>
        </div>
        <Card title="O que o assistente enxerga"><p className="mb-2 text-xs text-slate-500">Só isto vai para o provedor: números agregados, sem nomes nem salários individuais.</p><pre className="max-h-[520px] overflow-auto rounded bg-mist p-2 text-[11px] leading-snug">{JSON.stringify(ctx, null, 1)}</pre></Card>
      </div>
    </Page>
  );
}
