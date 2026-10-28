// v30 · calibração: distribuição real × REFERÊNCIA (para a conversa — nenhuma cota é aplicada), consistência entre avaliadores
// (quem avalia muito acima ou abaixo da média do ciclo) e a Nine Box com as pessoas em cada quadrante.
import Link from "@/components/Link";
import { sql } from "@/db";
import { Card, Table, Td, Badge } from "@/components/ui";
import { getSettings } from "@/lib/utils";
import { faixaFinal, FAIXAS_PADRAO, type Faixas } from "@/lib/avaliacao";
import { NIVEL_LABEL } from "@/lib/talento";
import { iniciais } from "@/lib/pessoas-v30";

const FAIXA_ROT: Record<string, string> = { DESTAQUE: "Destaque", CONSISTENTE: "Consistente", PRIORITARIO: "Prioritário" };
const COR_F: Record<string, string> = { DESTAQUE: "#1f7a4d", CONSISTENTE: "#1f5fa0", PRIORITARIO: "#a35f00" };

/** Faixa de uma avaliação: pela nota composta (ciclo por critérios) ou pelo nível de desempenho / nota (ciclo antigo). */
export function faixaDe(r: { n: number | null; nivel: number | null }, porCriterios: boolean, faixas: Faixas, alto: number, medio: number) {
  if (porCriterios) return r.n === null ? null : faixaFinal(r.n, faixas.final);
  if (r.nivel) return r.nivel === 3 ? "DESTAQUE" : r.nivel === 2 ? "CONSISTENTE" : "PRIORITARIO";
  return r.n === null ? null : r.n >= alto ? "DESTAQUE" : r.n >= medio ? "CONSISTENTE" : "PRIORITARIO";
}
/** Consistência dos avaliadores: média de cada um × média do ciclo (só com o mínimo de avaliados). */
export function consistencia(xs: { avaliador: string; n: number }[], minimo: number, delta: number) {
  const geral = xs.length ? xs.reduce((a, x) => a + x.n, 0) / xs.length : null;
  const por = [...new Set(xs.map(x => x.avaliador))].map(a => { const v = xs.filter(x => x.avaliador === a).map(x => x.n); const m = v.reduce((s, n) => s + n, 0) / v.length; const d = geral === null ? 0 : m - geral; return { avaliador: a, avaliados: v.length, media: m, delta: d, comparavel: v.length >= minimo, sinal: v.length >= minimo && Math.abs(d) >= delta ? (d > 0 ? "acima" : "abaixo") : null }; }).sort((a, b) => b.delta - a.delta);
  return { geral, por };
}

export async function CalibracaoV30({ cid, porCriterios, faixas, unitId }: { cid: number; porCriterios: boolean; faixas: Faixas | null; unitId: number | null }) {
  const cfg = await getSettings(); const d = cfg.desempenho; const ref = d.referencia as Record<string, number>;
  const rows = await sql<{ id: number; nome: string; avaliador: string | null; n: number | null; nivel: number | null; potencial: number | null; estado: string | null; status: string }[]>`
    SELECT r.id, e.nome, us.nome AS avaliador, coalesce((r.calc->>'N')::numeric, r.nota_final)::float AS n, r.desempenho_nivel AS nivel, r.potencial, r.estado, r.status
    FROM perf_reviews r JOIN employees e ON e.id=r.employee_id LEFT JOIN users us ON us.id=r.avaliador_user_id WHERE r.cycle_id=${cid} ${unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`}`;
  const validos = rows.filter(r => porCriterios ? ["PUBLICADA", "CONTESTADA", "CALIBRADA", "ENVIADA", "EM_CALIBRACAO"].includes(r.estado ?? "") && r.n !== null : ["AVALIADA", "CALIBRADA", "CONCLUIDA"].includes(r.status) && (r.n !== null || r.nivel !== null));
  const fx = faixas ?? FAIXAS_PADRAO; const alto = Number(d.limiarAlto), medio = Number(d.limiarMedio);
  const comFaixa = validos.map(r => ({ ...r, faixa: faixaDe(r, porCriterios, fx, alto, medio) })).filter(r => r.faixa);
  const total = comFaixa.length; const real = (k: string) => (total ? (100 * comFaixa.filter(r => r.faixa === k).length) / total : 0);
  const cons = consistencia(validos.filter(r => r.avaliador && r.n !== null).map(r => ({ avaliador: r.avaliador!, n: r.n! })), Number(d.consistenciaMinAvaliados) || 5, Number(d.consistenciaDelta) || 0.5);
  const boxes = cfg.desempenho.boxes as Record<string, string>; const nine = rows.filter(r => r.nivel && r.potencial);
  return <>
    <Card className="mb-4" title={`Calibração — distribuição real × referência (${total} avaliação(ões) com resultado)`}>
      {total === 0 ? <p className="text-sm text-slate-500">Ainda sem resultados para comparar.</p> : <div className="space-y-2">{["DESTAQUE", "CONSISTENTE", "PRIORITARIO"].map(k => <div key={k} className="grid grid-cols-[6.5rem_1fr_7.5rem] items-center gap-2 text-sm">
        <span className="font-medium text-navy">{FAIXA_ROT[k]}</span>
        <div className="relative h-5 rounded bg-slate-100"><div className="h-5 rounded" style={{ width: `${real(k)}%`, background: COR_F[k] }} /><div className="absolute top-[-3px] h-[26px] w-0.5 bg-navy" style={{ left: `${Math.min(100, ref[k] ?? 0)}%` }} title={`referência ${ref[k]}%`} /></div>
        <span className="text-xs tabular-nums text-slate-600">{Math.round(real(k))}% <span className="text-slate-400">· ref. {ref[k]}%</span></span></div>)}</div>}
      <p className="mt-2 text-[11px] text-slate-500">A barra é a distribuição real; o traço é a referência configurada (Configurações → Pessoas v30). Serve para a conversa da calibração — <b>nenhuma cota é aplicada</b> e ninguém muda de faixa por causa da referência; toda mudança exige justificativa e evidência.</p>
    </Card>
    <Card className="mb-4" title="Consistência entre avaliadores">
      <Table denso head={["Avaliador", "Avaliados", "Média que deu", "Diferença da média do ciclo", ""]} empty={validos.some(r => r.n !== null) ? "As avaliações deste ciclo não têm o avaliador registrado — a comparação começa nos ciclos em que cada avaliação tem o seu avaliador." : "Sem notas para comparar."}>{cons.por.map(a => <tr key={a.avaliador}><Td>{a.avaliador}</Td><Td className="tabular-nums">{a.avaliados}</Td><Td className="tabular-nums">{a.media.toFixed(2).replace(".", ",")}</Td><Td className={`tabular-nums ${a.sinal ? "font-semibold text-aviso" : ""}`}>{a.delta > 0 ? "+" : ""}{a.delta.toFixed(2).replace(".", ",")}</Td><Td>{!a.comparavel ? <span className="text-[11px] text-slate-400">poucos avaliados</span> : a.sinal ? <Badge v="PENDENTE" label={a.sinal === "acima" ? "avalia acima da média — conversar" : "avalia abaixo da média — conversar"} /> : <span className="text-[11px] text-ok">dentro do esperado</span>}</Td></tr>)}</Table>
      <p className="mt-2 text-[11px] text-slate-500">Média do ciclo: {cons.geral === null ? "—" : cons.geral.toFixed(2).replace(".", ",")}. Avaliador com {d.consistenciaMinAvaliados}+ avaliados e diferença de {String(d.consistenciaDelta).replace(".", ",")} ponto(s) ou mais é sinal para a conversa de calibração (pode ser uma equipe de fato diferente) — não muda nota sozinho.</p>
    </Card>
    {nine.length > 0 && <Card className="mb-4" title={`Nine Box com as pessoas — ${nine.length} avaliação(ões)`}>
      <div className="grid grid-cols-[2.2rem_repeat(3,minmax(0,1fr))] gap-1 text-xs">
        <div />{[1, 2, 3].map(dd => <div key={dd} className="text-center font-medium text-slate-600">Desempenho {NIVEL_LABEL[dd].toLowerCase()}</div>)}
        {[3, 2, 1].map(p => <div key={p} className="contents"><div className="flex items-center justify-center font-medium text-slate-600 [writing-mode:vertical-rl] rotate-180">Potencial {NIVEL_LABEL[p].toLowerCase()}</div>{[1, 2, 3].map(dd => { const xs = nine.filter(r => r.nivel === dd && r.potencial === p); const pc = Math.round((100 * xs.length) / nine.length); return <div key={dd} className={`min-h-[6.5rem] rounded p-2 ${dd === 3 && p === 3 ? "bg-emerald-100" : dd + p >= 5 ? "bg-emerald-50" : dd + p === 4 ? "bg-amber-50" : "bg-red-50"}`}>
          <div className="flex items-baseline justify-between gap-1"><span className="font-semibold text-navy">{boxes[`${dd}-${p}`] ?? `${dd}-${p}`}</span><span className="tabular-nums text-slate-500">{xs.length} · {pc}%</span></div>
          <div className="mt-1 flex flex-wrap gap-1">{xs.slice(0, 18).map(r => <Link key={r.id} href={`/desempenho/avaliacoes/${r.id}`} title={r.nome} className="grid h-7 w-7 place-items-center rounded-full bg-white text-[10px] font-semibold text-navy shadow-[0_0_0_1px_#dbe3ee] hover:bg-sky-50">{iniciais(r.nome)}</Link>)}{xs.length > 18 && <span className="self-center text-[10px] text-slate-500">+{xs.length - 18}</span>}</div>
        </div>; })}</div>)}
      </div>
      <p className="mt-2 text-[11px] text-slate-500">Passe o mouse (ou toque) nas iniciais para ver o nome; o clique abre a avaliação. Rótulos dos quadrantes em Configurações → Desempenho.</p>
    </Card>}
  </>;
}
