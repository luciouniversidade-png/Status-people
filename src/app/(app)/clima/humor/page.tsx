import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { Page, Card, Flash, Stat } from "@/components/ui";
import { getSettings, hoje, addDays } from "@/lib/utils";
import { veHumor, semanaDe, semanaTxt, resultadoSemana, serieHumor, NOTAS } from "@/lib/humor";

export const dynamic = "force-dynamic";
const cor = (m: number | null, alerta: number) => m === null ? "text-slate-400" : m < alerta ? "text-erro" : m < 3.5 ? "text-aviso" : "text-ok";

/** v34 · Termômetro de humor: o pulso semanal anônimo, sempre por grupo e com o mínimo de respostas. */
export default async function Humor({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!veHumor(s)) redirect("/sem-acesso?t=%2Fclima%2Fhumor"); const sp = await searchParams;
  const cfg = await getSettings(); const min = Number(cfg.termometro.minimoGrupo); const alerta = Number(cfg.termometro.alertaMedia);
  const atual = semanaDe(hoje()); const semana = sp.semana && /^\d{4}-\d{2}-\d{2}$/.test(sp.semana) ? semanaDe(sp.semana) : semanaDe(addDays(hoje(), -7));
  const por = s.role === "GESTOR" ? "unidade" : sp.por === "lideranca" ? "lideranca" : "unidade";
  const [r, serie] = await Promise.all([resultadoSemana(s, semana, por, min), serieHumor(s, 12, min)]);
  const semanas = Array.from({ length: 8 }, (_, i) => addDays(atual, -7 * i));
  const maxN = Math.max(1, ...serie.map(x => x.n));
  return (
    <Page title="Termômetro de humor" sub={`“Como foi a sua semana?” de 1 a 5, no Meu espaço. Anônimo: o banco guarda só a contagem do grupo, e um grupo só aparece com pelo menos ${min} respostas na semana.${s.role === "GESTOR" ? " Você vê só a sua equipe." : ""}`}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
        {semanas.map(w => <Link key={w} href={`/clima/humor?semana=${w}${por === "lideranca" ? "&por=lideranca" : ""}`} className={`rounded-full border px-2.5 py-1 ${w === semana ? "border-acao bg-sky-50 text-acao" : "border-line text-slate-600"}`}>{w === atual ? "esta semana" : `sem. ${semanaTxt(w)}`}</Link>)}
        {s.role !== "GESTOR" ? <span className="ml-2 flex gap-1.5">{[["unidade", "por unidade"], ["lideranca", "por liderança"]].map(([k, rr]) => <Link key={k} href={`/clima/humor?semana=${semana}${k === "lideranca" ? "&por=lideranca" : ""}`} className={`rounded-full border px-2.5 py-1 ${por === k ? "border-acao bg-sky-50 text-acao" : "border-line text-slate-600"}`}>{rr}</Link>)}</span> : null}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Respostas na semana de ${semanaTxt(semana)}`} value={r.total} />
        <Stat label="Média (grupos exibidos)" value={<span className={cor(r.mediaGeral, alerta)}>{r.mediaGeral !== null ? r.mediaGeral.toFixed(1).replace(".", ",") : "—"}</span>} hint="de 1 a 5" />
        <Stat label="Grupos em alerta" value={<span className={r.grupos.some(g => g.media !== null && g.media < alerta) ? "text-erro" : ""}>{r.grupos.filter(g => g.media !== null && g.media < alerta).length}</span>} hint={`média abaixo de ${String(alerta).replace(".", ",")}`} />
        <Stat label="Grupos ocultos" value={r.grupos.filter(g => !g.visivel).length} hint="poucas respostas" />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] xl:items-start">
        <Card title={`Semana de ${semanaTxt(semana)} — ${por === "lideranca" ? "por liderança" : "por unidade"}`}>
          {r.grupos.length === 0 ? <p className="text-sm text-slate-500">Nenhuma resposta nesta semana.</p> :
            <ul className="space-y-2">{r.grupos.map(g => <li key={g.chave} className="rounded-md border border-line p-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="font-medium">{g.nome}</span>{g.visivel ? <span className={`font-semibold tabular-nums ${cor(g.media, alerta)}`}>{g.media!.toFixed(1).replace(".", ",")} <span className="text-xs font-normal text-slate-500">· {g.n} resp.</span></span> : <span className="text-xs text-slate-500">{g.motivo === "poucas respostas" ? `menos de ${min} respostas` : g.motivo}</span>}</div>
              {g.visivel ? <><div className="mt-1.5 flex h-2 overflow-hidden rounded">{g.dist.map((n, i) => n ? <div key={i} style={{ width: `${100 * n / g.n}%` }} className={["bg-red-500", "bg-orange-400", "bg-slate-300", "bg-emerald-400", "bg-emerald-600"][i]} title={`${NOTAS[i][2]}: ${n}`} /> : null)}</div>
                {g.fatoresBaixos.length ? <p className="mt-1 text-[11px] text-slate-600">Mais citados por quem teve semana difícil: {g.fatoresBaixos.map(([f, n]) => `${f} (${n})`).join(" · ")}</p> : null}</> : null}
            </li>)}</ul>}
          <p className="mt-3 text-[11px] text-slate-500">Cores: <span className="text-red-600">muito difícil</span> · <span className="text-orange-500">difícil</span> · normal · <span className="text-emerald-600">boa · ótima</span>. Na visão por liderança, uma equipe também fica oculta quando o restante da unidade fica abaixo do mínimo — para ninguém deduzir respostas por diferença.</p>
        </Card>
        <Card title="Últimas 12 semanas">
          {serie.length === 0 ? <p className="text-sm text-slate-500">Sem respostas ainda.</p> :
            <div className="space-y-1">{serie.map(x => <div key={x.semana} className="grid grid-cols-[3.5rem_minmax(0,1fr)_3rem] items-center gap-2 text-xs"><span className="tabular-nums text-slate-500">{semanaTxt(x.semana)}</span><div className="h-2 rounded bg-slate-100"><div className="h-2 rounded bg-acao/40" style={{ width: `${100 * x.n / maxN}%` }} /></div><span className={`text-right font-medium tabular-nums ${cor(x.media, alerta)}`}>{x.media !== null ? x.media.toFixed(1).replace(".", ",") : "—"}</span></div>)}</div>}
          <p className="mt-2 text-[11px] text-slate-500">Barra = participação; número = média da semana (só unidades com o mínimo).</p>
        </Card>
      </div>
    </Page>
  );
}
