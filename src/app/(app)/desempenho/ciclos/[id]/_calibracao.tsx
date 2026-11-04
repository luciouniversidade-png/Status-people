// v30 · calibração: distribuição real × REFERÊNCIA (para a conversa — nenhuma cota é aplicada), consistência entre avaliadores
// (quem avalia muito acima ou abaixo da média do ciclo) e a Nine Box com as pessoas em cada quadrante.
// v31 · Nine Box pré × pós-calibração (o retrato de antes fica na avaliação), filtros (unidade, família, avaliador), distribuição
// lado a lado e a lista de quem mudou de quadrante na calibração — no modelo antigo (desempenho × potencial) e no por critérios
// (atitudes × resultados).
import Link from "@/components/Link";
import { sql } from "@/db";
import { Card, Table, Td, Badge, Field, Select, Btn } from "@/components/ui";
import { getSettings } from "@/lib/utils";
import { faixaFinal, faixa as faixaMatriz, fmtNota, FAIXAS_PADRAO, FAMILIAS, type Faixas } from "@/lib/avaliacao";
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

type Linha = { id: number; nome: string; avaliador: string | null; n: number | null; nivel: number | null; potencial: number | null; estado: string | null; status: string; unidade: string | null; familia: string | null; a: number | null; r: number | null; pre: { nivel?: number | null; potencial?: number | null; nota?: number | null; N?: number | null; R?: number | null; A?: number | null; por?: string } | null; justificativa: string | null; calibrou: string | null };
const ROT_MATRIZ = ["", "1–1,9", "2–2,9", "3–3,9", "4–5"];

export async function CalibracaoV30({ cid, porCriterios, faixas, unitId, sp = {} }: { cid: number; porCriterios: boolean; faixas: Faixas | null; unitId: number | null; sp?: Record<string, string | undefined> }) {
  const cfg = await getSettings(); const d = cfg.desempenho; const ref = d.referencia as Record<string, number>;
  const rows = await sql<Linha[]>`
    SELECT r.id, e.nome, us.nome AS avaliador, coalesce((r.calc->>'N')::numeric, r.nota_final)::float AS n, r.desempenho_nivel AS nivel, r.potencial, r.estado, r.status,
      coalesce(r.snapshot->>'unidade', un.nome) AS unidade, p.familia, (r.calc->>'A')::float AS a, (r.calc->>'R')::float AS r, r.pre_calibracao AS pre, coalesce(r.calibracao_justificativa, r.calibracao_nota) AS justificativa, uc.nome AS calibrou
    FROM perf_reviews r JOIN employees e ON e.id=r.employee_id LEFT JOIN units un ON un.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id LEFT JOIN users us ON us.id=r.avaliador_user_id LEFT JOIN users uc ON uc.id=r.calibrado_por
    WHERE r.cycle_id=${cid} ${unitId === null ? sql`` : sql`AND e.unit_id=${unitId}`}`;
  const validos = rows.filter(r => porCriterios ? ["PUBLICADA", "CONTESTADA", "CALIBRADA", "ENVIADA", "EM_CALIBRACAO"].includes(r.estado ?? "") && r.n !== null : ["AVALIADA", "CALIBRADA", "CONCLUIDA"].includes(r.status) && (r.n !== null || r.nivel !== null));
  const fx = faixas ?? FAIXAS_PADRAO; const alto = Number(d.limiarAlto), medio = Number(d.limiarMedio);
  const comFaixa = validos.map(r => ({ ...r, faixa: faixaDe(r, porCriterios, fx, alto, medio) })).filter(r => r.faixa);
  const total = comFaixa.length; const real = (k: string) => (total ? (100 * comFaixa.filter(r => r.faixa === k).length) / total : 0);
  const cons = consistencia(validos.filter(r => r.avaliador && r.n !== null).map(r => ({ avaliador: r.avaliador!, n: r.n! })), Number(d.consistenciaMinAvaliados) || 5, Number(d.consistenciaDelta) || 0.5);
  const boxes = cfg.desempenho.boxes as Record<string, string>;
  // ---------- v31 · quadro pré × pós ----------
  const modo = ["pre", "dist", "mov"].includes(sp.nb ?? "") ? sp.nb! : "pos";
  const fUn = sp.nbUnidade ?? "", fFam = sp.nbFamilia ?? "", fAv = sp.nbAvaliador ?? "";
  const filtrado = rows.filter(r => (!fUn || r.unidade === fUn) && (!fFam || r.familia === fFam) && (!fAv || r.avaliador === fAv));
  // posição (pós = atual; pré = o retrato de antes da calibração, quando houve)
  type Pos = { x: number; y: number } | null;
  const posDe = (r: Linha, quando: "pre" | "pos"): Pos => {
    const p = quando === "pre" && r.pre ? r.pre : null;
    if (porCriterios) { const A = p ? (p.A ?? r.a) : r.a, R = p ? (p.R ?? r.r) : r.r; return A === null || A === undefined || R === null || R === undefined ? null : { x: faixaMatriz(Number(R), fx.matriz), y: faixaMatriz(Number(A), fx.matriz) }; }
    const nv = p ? (p.nivel ?? r.nivel) : r.nivel, pt = p ? (p.potencial ?? r.potencial) : r.potencial; return nv && pt ? { x: Number(nv), y: Number(pt) } : null;
  };
  const xs = porCriterios ? [1, 2, 3, 4] : [1, 2, 3]; const ys = [...xs].reverse();
  const rotulo = (x: number, y: number) => porCriterios ? `Resultados ${ROT_MATRIZ[x]} · Atitudes ${ROT_MATRIZ[y]}` : boxes[`${x}-${y}`] ?? `${x}-${y}`;
  const cor = (x: number, y: number) => { const top = xs.length; return x === top && y === top ? "bg-emerald-100" : x + y >= top + 2 ? "bg-emerald-50" : x + y >= top + 1 ? "bg-amber-50" : "bg-red-50"; };
  const noQuadro = filtrado.map(r => ({ r, pre: posDe(r, "pre"), pos: posDe(r, "pos") })).filter(x => x.pos);
  const mudou = noQuadro.filter(x => x.r.pre && x.pre && (x.pre.x !== x.pos!.x || x.pre.y !== x.pos!.y));
  const subiu = mudou.filter(x => x.pos!.x + x.pos!.y > x.pre!.x + x.pre!.y).length, desceu = mudou.filter(x => x.pos!.x + x.pos!.y < x.pre!.x + x.pre!.y).length;
  const calibradas = noQuadro.filter(x => x.r.pre).length;
  const cel = (x: number, y: number, quando: "pre" | "pos") => noQuadro.filter(q => { const p = quando === "pre" ? q.pre : q.pos; return p && p.x === x && p.y === y; });
  const unidades = [...new Set(rows.map(r => r.unidade).filter(Boolean) as string[])].sort(); const familias = [...new Set(rows.map(r => r.familia).filter(Boolean) as string[])].sort(); const avaliadores = [...new Set(rows.map(r => r.avaliador).filter(Boolean) as string[])].sort();
  const base = `/desempenho/ciclos/${cid}`; const q = (nb: string) => { const p = new URLSearchParams(Object.entries({ nb: nb === "pos" ? "" : nb, nbUnidade: fUn, nbFamilia: fFam, nbAvaliador: fAv }).filter(([, v]) => v)); const t = p.toString(); return `${base}${t ? `?${t}` : ""}#quadro`; };
  const descr = (p: Pos) => (p ? rotulo(p.x, p.y) : "—");
  const notaTxt = (r: Linha, quando: "pre" | "pos") => { const v = quando === "pre" && r.pre ? (r.pre.N ?? r.pre.nota ?? null) : r.n; return v === null || v === undefined ? "" : ` · nota ${fmtNota(Number(v))}`; };
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
    {rows.some(r => posDe(r, "pos")) && <Card className="mb-4" title={<span id="quadro">{porCriterios ? "Quadro de talentos — atitudes × resultados" : "Nine Box — desempenho × potencial"} · {modo === "pre" ? "pré-calibração" : modo === "dist" ? "distribuição" : modo === "mov" ? "movimentos" : "pós-calibração"}</span>}
      actions={<div className="flex flex-wrap gap-1 print:hidden">{([["pos", "Pós-calibração"], ["pre", "Pré-calibração"], ["dist", "Distribuição"], ["mov", `Movimentos (${mudou.length})`]] as const).map(([k, v]) => <Link key={k} href={q(k)} aria-current={modo === k ? "true" : undefined} className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${modo === k ? "border-navy bg-navy text-white" : "border-line bg-white text-navy hover:bg-mist"}`}>{v}</Link>)}</div>}>
      <form action={`${base}#quadro`} className="mb-3 grid grid-cols-1 gap-2 rounded-md bg-mist/50 p-2 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto] sm:items-end print:hidden">{modo !== "pos" && <input type="hidden" name="nb" value={modo} />}
        <Field label="Unidade"><Select name="nbUnidade" defaultValue={fUn}><option value="">Todas</option>{unidades.map(x => <option key={x}>{x}</option>)}</Select></Field>
        <Field label="Família do cargo"><Select name="nbFamilia" defaultValue={fFam}><option value="">Todas</option>{familias.map(x => <option key={x} value={x}>{FAMILIAS[x] ?? x}</option>)}</Select></Field>
        <Field label="Avaliador"><Select name="nbAvaliador" defaultValue={fAv}><option value="">Todos</option>{avaliadores.map(x => <option key={x}>{x}</option>)}</Select></Field>
        <Btn small kind="ghost">Filtrar</Btn></form>
      <p className="mb-2 text-xs text-slate-600">{noQuadro.length} pessoa(s) no quadro{fUn || fFam || fAv ? " (com filtro)" : ""} · {calibradas} calibrada(s) · <b>{mudou.length}</b> mudaram de quadrante na calibração ({subiu} subiram, {desceu} desceram).</p>
      {(modo === "pos" || modo === "pre") && <div className="overflow-x-auto"><div className={`grid min-w-[540px] gap-1 text-xs ${porCriterios ? "grid-cols-[2.2rem_repeat(4,minmax(0,1fr))]" : "grid-cols-[2.2rem_repeat(3,minmax(0,1fr))]"}`}>
        <div />{xs.map(x => <div key={x} className="text-center font-medium text-slate-600">{porCriterios ? `Resultados ${ROT_MATRIZ[x]}` : `Desempenho ${NIVEL_LABEL[x].toLowerCase()}`}</div>)}
        {ys.map(y => <div key={y} className="contents"><div className="flex items-center justify-center font-medium text-slate-600 [writing-mode:vertical-rl] rotate-180">{porCriterios ? `Atitudes ${ROT_MATRIZ[y]}` : `Potencial ${NIVEL_LABEL[y].toLowerCase()}`}</div>{xs.map(x => { const ps = cel(x, y, modo); const pc = noQuadro.length ? Math.round((100 * ps.length) / noQuadro.length) : 0; return <div key={x} className={`min-h-[6.5rem] rounded p-2 ${cor(x, y)} ${modo === "pre" ? "ring-1 ring-inset ring-slate-300" : ""}`}>
          <div className="flex items-baseline justify-between gap-1"><span className="font-semibold leading-tight text-navy">{porCriterios ? "" : boxes[`${x}-${y}`] ?? `${x}-${y}`}</span><span className="whitespace-nowrap tabular-nums text-slate-500">Geral {ps.length} ({pc}%)</span></div>
          <div className="mt-1 flex flex-wrap gap-1">{ps.slice(0, 18).map(({ r }) => <Link key={r.id} href={`/desempenho/avaliacoes/${r.id}`} title={`${r.nome}${notaTxt(r, modo)}`} className={`grid h-7 w-7 place-items-center rounded-full bg-white text-[10px] font-semibold text-navy shadow-[0_0_0_1px_#dbe3ee] hover:bg-sky-50 ${mudou.some(m => m.r.id === r.id) ? "ring-2 ring-acao" : ""}`}>{iniciais(r.nome)}</Link>)}{ps.length > 18 && <span className="self-center text-[10px] text-slate-500">+{ps.length - 18}</span>}</div>
        </div>; })}</div>)}
      </div></div>}
      {modo === "dist" && <Table denso head={["Quadrante", "Pré-calibração", "Pós-calibração", "Diferença"]} empty="Ninguém no quadro com esses filtros.">{ys.flatMap(y => xs.map(x => ({ x, y }))).filter(({ x, y }) => cel(x, y, "pre").length + cel(x, y, "pos").length > 0).map(({ x, y }) => { const a = cel(x, y, "pre").length, b = cel(x, y, "pos").length; const pa = noQuadro.length ? Math.round((100 * a) / noQuadro.length) : 0, pb = noQuadro.length ? Math.round((100 * b) / noQuadro.length) : 0; return <tr key={`${x}-${y}`}><Td className="text-sm">{rotulo(x, y)}</Td><Td className="tabular-nums">{a} <span className="text-xs text-slate-500">({pa}%)</span></Td><Td className="tabular-nums">{b} <span className="text-xs text-slate-500">({pb}%)</span></Td><Td className={`tabular-nums ${b - a > 0 ? "text-ok" : b - a < 0 ? "text-erro" : "text-slate-400"}`}>{b - a > 0 ? "+" : ""}{b - a}</Td></tr>; })}</Table>}
      {modo === "mov" && <Table denso head={["Pessoa", "Antes", "Depois", "", "Justificativa", "Quem calibrou"]} empty="Ninguém mudou de quadrante na calibração.">{mudou.map(({ r, pre, pos }) => { const up = pos!.x + pos!.y > pre!.x + pre!.y; const down = pos!.x + pos!.y < pre!.x + pre!.y; return <tr key={r.id}><Td><Link className="font-medium text-acao" href={`/desempenho/avaliacoes/${r.id}`}>{r.nome}</Link><div className="text-[11px] text-slate-500">{r.unidade ?? "—"}</div></Td><Td className="text-xs">{descr(pre)}{notaTxt(r, "pre")}</Td><Td className="text-xs">{descr(pos)}{notaTxt(r, "pos")}</Td><Td>{up ? <Badge v="APROVADA" label="↑ subiu" /> : down ? <Badge v="REJEITADA" label="↓ desceu" /> : <Badge v="PENDENTE" label="↔ mudou" />}</Td><Td className="text-xs">{r.justificativa ?? "—"}</Td><Td className="text-xs">{r.calibrou ?? r.pre?.por ?? "—"}</Td></tr>; })}</Table>}
      {modo === "dist" && <p className="mt-1 text-[11px] text-slate-500">Quadrantes vazios antes e depois ficam fora da tabela.</p>}<p className="mt-2 text-[11px] text-slate-500">Pré-calibração = como a avaliação chegou ao comitê (o retrato fica guardado na primeira calibração); pós = como ficou. Aro azul nas iniciais = mudou de quadrante. Toque nas iniciais para ver o nome; o clique abre a avaliação. {porCriterios ? "Faixas da matriz configuradas no ciclo." : "Rótulos dos quadrantes em Configurações → Desempenho."}</p>
    </Card>}
  </>;
}
