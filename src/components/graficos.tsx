import Link from "@/components/Link";
import type { ReactNode } from "react";
import { fmtCompacto } from "@/lib/formato";

/**
 * Kit de gráficos do ONE (v23) — SVG e HTML puros, renderizados no servidor: nada de biblioteca externa, nada de JavaScript no navegador.
 * Acessível (role="img" + rótulo, tabela de dados para leitor de tela, dica com o valor ao passar o mouse), imprime bem
 * e se ajusta ao celular: os textos dos eixos crescem em telas pequenas para continuar legíveis quando o desenho encolhe.
 * Lacunas (mês sem dado) ficam em branco — nunca viram zero.
 */

export const COR = { navy: "#0b2545", acao: "#1f5fa0", ok: "#1f7a4d", aviso: "#a35f00", erro: "#a12b2b", linha: "#dbe3ee", grade: "#e8edf4", texto: "#64748b", tinta: "#1c2430", neutro: "#94a3b8", meta: "#1f7a4d", orcado: "#0b2545", faixa: "#1f5fa0" };
export const PALETA = ["#1f5fa0", "#2a9d8f", "#e9a23b", "#8e5bb5", "#d1495b", "#5c8a3a", "#4a90c2", "#7a8696"];
export const corSerie = (i: number) => PALETA[((i % PALETA.length) + PALETA.length) % PALETA.length];
export type Tom = "bom" | "atencao" | "ruim" | "neutro";
export const COR_TOM: Record<Tom, string> = { bom: COR.ok, atencao: COR.aviso, ruim: COR.erro, neutro: COR.neutro };
const BORDA_TOM: Record<Tom, string> = { bom: "border-l-ok", atencao: "border-l-aviso", ruim: "border-l-erro", neutro: "border-l-slate-300" };
export const TEXTO_TOM: Record<Tom, string> = { bom: "text-ok", atencao: "text-aviso", ruim: "text-erro", neutro: "text-slate-500" };
const FUNDO_TOM: Record<Tom | "vazio", string> = { bom: "bg-emerald-50 text-ok", atencao: "bg-amber-50 text-aviso", ruim: "bg-red-50 text-erro", neutro: "bg-white text-ink", vazio: "bg-mist text-slate-400" };

type Tamanho = "terco" | "meio" | "inteiro";
/** terco: cartão de um terço da largura; meio: cartão de meia largura; inteiro: largura total (no celular, rola de lado dentro do próprio quadro). */
const DIM: Record<Tamanho, { W: number; H: number; L: number; R: number; T: number; B: number; maxRot: number; txt: string; caixa: string; svg: string }> = {
  terco: { W: 380, H: 230, L: 54, R: 14, T: 20, B: 42, maxRot: 6, txt: "text-[15px] sm:text-[12px] lg:text-[13px]", caixa: "", svg: "h-auto w-full" },
  meio: { W: 520, H: 240, L: 66, R: 18, T: 22, B: 44, maxRot: 6, txt: "text-[18px] sm:text-[11px] lg:text-[12px]", caixa: "", svg: "h-auto w-full" },
  inteiro: { W: 1040, H: 300, L: 84, R: 26, T: 24, B: 48, maxRot: 12, txt: "text-[20px] md:text-[17px] lg:text-[12px]", caixa: "overflow-x-auto [-webkit-overflow-scrolling:touch]", svg: "h-auto w-full min-w-[640px]" },
};

const ok = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);

function passoBom(faixa: number, n: number) {
  const bruto = faixa / Math.max(1, n); const mag = 10 ** Math.floor(Math.log10(bruto || 1)); const norm = bruto / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
}
/** Escala "redonda" do eixo Y (ticks em 1, 2, 2,5 ou 5 × 10ⁿ). */
export function escala(valores: number[], zero: boolean, n = 4) {
  let min = Math.min(...valores), max = Math.max(...valores);
  if (zero) { min = Math.min(0, min); max = Math.max(0, max); }
  if (min === max) { const d = Math.abs(min) || 1; min -= d * 0.5; max += d * 0.5; if (zero && valores.every(v => v >= 0)) min = Math.max(0, min); }
  // contagens (só inteiros) nunca ganham marcas fracionadas no eixo: 0,5 → 1 e 2,5 → 3
  let passo = passoBom(max - min, n); if (!Number.isInteger(passo) && valores.every(v => Number.isInteger(v))) passo = Math.ceil(passo);
  const lo = Math.floor(min / passo + 1e-9) * passo; const hi = Math.ceil(max / passo - 1e-9) * passo;
  const ticks: number[] = []; for (let t = lo; t <= hi + passo / 2; t += passo) ticks.push(Math.abs(t) < passo / 1e6 ? 0 : t);
  return { lo, hi: hi === lo ? lo + passo : hi, ticks };
}

function segmentos(vals: (number | null | undefined)[], x: (i: number) => number, y: (v: number) => number) {
  const segs: [number, number][][] = []; let cur: [number, number][] = [];
  vals.forEach((v, i) => { if (!ok(v)) { if (cur.length) segs.push(cur); cur = []; } else cur.push([x(i), y(v)]); });
  if (cur.length) segs.push(cur);
  return segs;
}
const caminho = (pts: [number, number][]) => pts.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)} ${b.toFixed(1)}`).join(" ");

export function Vazio({ texto }: { texto?: string }) {
  return <p className="py-6 text-center text-sm text-slate-500">{texto ?? "Sem dados no período."}</p>;
}

export function Legenda({ itens }: { itens: { rotulo: string; cor: string; tipo?: "linha" | "tracejada" | "barra" | "faixa" | "marcador" | "ponto" }[] }) {
  if (!itens.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {itens.map(i => <li key={i.rotulo} className="flex items-center gap-1.5">
        {i.tipo === "linha" || i.tipo === "tracejada" ? <svg width="18" height="8" aria-hidden><line x1="1" x2="17" y1="4" y2="4" stroke={i.cor} strokeWidth="2.5" strokeDasharray={i.tipo === "tracejada" ? "4 3" : undefined} /></svg>
          : i.tipo === "faixa" ? <span aria-hidden className="inline-block h-2.5 w-4 rounded-sm opacity-30" style={{ background: i.cor }} />
            : i.tipo === "marcador" ? <span aria-hidden className="inline-block h-[3px] w-4" style={{ background: i.cor }} />
              : i.tipo === "ponto" ? <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: i.cor }} />
                : <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.cor }} />}
        {i.rotulo}
      </li>)}
    </ul>
  );
}

/**
 * "Ver dados" (Cap. 15 · acessibilidade): a tabela alternativa de todo gráfico, visível sob demanda e lida por leitores de tela.
 * Fica numa caixa com rolagem própria (nunca empurra a página para o lado no celular) e some na impressão.
 */
function TabelaLeitor({ titulo, colunas, linhas }: { titulo: string; colunas: string[]; linhas: (string | number)[][] }) {
  return (
    <details className="mt-1 max-w-full text-[11px] print:hidden">
      <summary className="inline-block cursor-pointer select-none text-slate-500 hover:text-acao">ver dados</summary>
      <div className="mt-1 max-h-64 max-w-full overflow-auto rounded border border-line bg-white">
        <table className="w-full tabular-nums"><caption className="sr-only">{titulo}</caption>
          <thead className="sticky top-0 bg-mist text-slate-600"><tr>{colunas.map((c, i) => <th key={`${c}${i}`} scope="col" className={`whitespace-nowrap px-2 py-1 font-medium ${i ? "text-right" : "text-left"}`}>{c}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">{linhas.map((l, i) => <tr key={i}>{l.map((c, j) => j === 0 ? <th key={j} scope="row" className="whitespace-nowrap px-2 py-0.5 text-left font-normal">{c}</th> : <td key={j} className="whitespace-nowrap px-2 py-0.5 text-right">{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

/** Quais rótulos do eixo X aparecem: um a cada k (cabem no máximo `max`), sempre o último, e nunca dois colados no fim. */
function rotulosX(n: number, max: number) { const k = Math.max(1, Math.ceil(n / max)); return (i: number) => i === n - 1 || (i % k === 0 && (k === 1 || n - 1 - i >= k)); }

// ------------------------------------------------------------------ Linhas
export type SerieLinha = { nome: string; valores: (number | null | undefined)[]; cor?: string; tracejada?: boolean; area?: boolean };
export function Linhas({ categorias, series, meta, faixa, notas, formato = fmtCompacto, tamanho = "meio", altura, zero = false, rotulo, legenda = true, rotuloUltimo = true, formatoDica }: {
  categorias: string[]; series: SerieLinha[]; meta?: { valor: number; rotulo?: string; cor?: string } | null;
  faixa?: { min: (number | null | undefined)[]; max: (number | null | undefined)[]; rotulo?: string; cor?: string } | null;
  notas?: { indice: number; texto: string }[]; formato?: (v: number) => string; formatoDica?: (v: number) => string; tamanho?: Tamanho; altura?: number; zero?: boolean;
  rotulo: string; legenda?: boolean; rotuloUltimo?: boolean;
}) {
  const d = DIM[tamanho]; const H = altura ?? d.H; const n = categorias.length; const dica = formatoDica ?? formato;
  const todos = [...series.flatMap(s => s.valores), ...(faixa ? [...faixa.min, ...faixa.max] : []), ...(meta ? [meta.valor] : [])].filter(ok);
  if (!n || !todos.length) return <Vazio />;
  const e = escala(todos, zero || todos.every(v => v >= 0) && Math.min(...todos) <= 0.15 * Math.max(...todos));
  const x = (i: number) => d.L + (n > 1 ? (i * (d.W - d.L - d.R)) / (n - 1) : (d.W - d.L - d.R) / 2);
  const y = (v: number) => d.T + (1 - (v - e.lo) / (e.hi - e.lo)) * (H - d.T - d.B);
  const base = y(Math.max(e.lo, Math.min(0, e.hi))); const mostraX = rotulosX(n, d.maxRot);
  const bandas: [number, number][][] = [];
  if (faixa) { let cur: [number, number][] = []; for (let i = 0; i < n; i++) { const a = faixa.min[i], b = faixa.max[i]; if (ok(a) && ok(b)) cur.push([i, 0]); else { if (cur.length) bandas.push(cur); cur = []; } } if (cur.length) bandas.push(cur); }
  const ultimo = series.map(s => { for (let i = s.valores.length - 1; i >= 0; i--) if (ok(s.valores[i])) return i; return -1; });
  const leg = [...series.map((s, i) => ({ rotulo: s.nome, cor: s.cor ?? corSerie(i), tipo: (s.tracejada ? "tracejada" : "linha") as "linha" | "tracejada" })), ...(meta ? [{ rotulo: meta.rotulo ?? "Meta", cor: meta.cor ?? COR.meta, tipo: "tracejada" as const }] : []), ...(faixa ? [{ rotulo: faixa.rotulo ?? "Faixa provável", cor: faixa.cor ?? COR.faixa, tipo: "faixa" as const }] : [])];
  return (
    <figure className="min-w-0">
      <div className={d.caixa}>
        <svg viewBox={`0 0 ${d.W} ${H}`} className={d.svg} role="img" aria-label={rotulo}>
          {e.ticks.map(t => <g key={t}><line x1={d.L} x2={d.W - d.R} y1={y(t)} y2={y(t)} stroke={t === 0 ? COR.linha : COR.grade} /><text x={d.L - 8} y={y(t) + 4} textAnchor="end" className={`${d.txt} fill-slate-500`}>{formato(t)}</text></g>)}
          {faixa && bandas.map((b, k) => { const idx = b.map(([i]) => i); const topo = idx.map(i => `${x(i).toFixed(1)},${y(faixa.max[i] as number).toFixed(1)}`); const fundo = [...idx].reverse().map(i => `${x(i).toFixed(1)},${y(faixa.min[i] as number).toFixed(1)}`); return <polygon key={k} points={[...topo, ...fundo].join(" ")} fill={faixa.cor ?? COR.faixa} opacity="0.14" />; })}
          {meta && <g><line x1={d.L} x2={d.W - d.R} y1={y(meta.valor)} y2={y(meta.valor)} stroke={meta.cor ?? COR.meta} strokeDasharray="6 5" strokeWidth="1.6" /><text x={d.W - d.R} y={y(meta.valor) - 6} textAnchor="end" className={`${d.txt}`} fill={meta.cor ?? COR.meta}>{meta.rotulo ?? "meta"} {formato(meta.valor)}</text></g>}
          {notas?.filter(nt => nt.indice >= 0 && nt.indice < n).map((nt, k) => <g key={k}><line x1={x(nt.indice)} x2={x(nt.indice)} y1={d.T} y2={H - d.B} stroke={COR.aviso} strokeDasharray="2 4" /><circle cx={x(nt.indice)} cy={d.T - 8} r="7" fill={COR.aviso}><title>{`${categorias[nt.indice]}: ${nt.texto}`}</title></circle><text x={x(nt.indice)} y={d.T - 4} textAnchor="middle" fontSize="11" fill="#fff" aria-hidden>i</text></g>)}
          {series.map((s, si) => { const cor = s.cor ?? corSerie(si); const segs = segmentos(s.valores, x, y); return <g key={s.nome}>
            {s.area && segs.map((p, k) => <path key={`a${k}`} d={`${caminho(p)} L${p[p.length - 1][0].toFixed(1)} ${base.toFixed(1)} L${p[0][0].toFixed(1)} ${base.toFixed(1)} Z`} fill={cor} opacity="0.12" />)}
            {segs.map((p, k) => p.length > 1 ? <path key={k} d={caminho(p)} fill="none" stroke={cor} strokeWidth={tamanho === "inteiro" ? 2.6 : 2.4} strokeDasharray={s.tracejada ? "7 5" : undefined} strokeLinejoin="round" strokeLinecap="round" /> : null)}
            {s.valores.map((v, i) => ok(v) ? <circle key={i} cx={x(i)} cy={y(v)} r={i === ultimo[si] ? 4.5 : n > 18 ? 2 : 3} fill={i === ultimo[si] ? cor : "#fff"} stroke={cor} strokeWidth="1.8"><title>{`${s.nome} · ${categorias[i]}: ${dica(v)}`}</title></circle> : null)}
            {rotuloUltimo && series.length <= 2 && ultimo[si] >= 0 && <text x={Math.min(x(ultimo[si]), d.W - d.R - 4)} y={y(s.valores[ultimo[si]] as number) - 11} textAnchor={x(ultimo[si]) > d.W - d.R - 40 ? "end" : "middle"} className={`${d.txt} font-semibold`} fill={cor}>{formato(s.valores[ultimo[si]] as number)}</text>}
          </g>; })}
          {categorias.map((c, i) => mostraX(i) ? <text key={i} x={x(i)} y={H - d.B + 26} textAnchor={i === 0 && n > 1 ? "start" : i === n - 1 && n > 1 ? "end" : "middle"} className={`${d.txt} fill-slate-500`}>{c}</text> : null)}
        </svg>
      </div>
      {legenda && (leg.length > 1) && <Legenda itens={leg} />}
      <TabelaLeitor titulo={rotulo} colunas={["Período", ...series.map(s => s.nome), ...(meta ? [meta.rotulo ?? "Meta"] : [])]} linhas={categorias.map((c, i) => [c, ...series.map(s => ok(s.valores[i]) ? dica(s.valores[i] as number) : "—"), ...(meta ? [dica(meta.valor)] : [])])} />
    </figure>
  );
}

// ------------------------------------------------------------------ Colunas
export type SerieColuna = { nome: string; valores: (number | null | undefined)[]; cor?: string };
export function Colunas({ categorias, series, empilhado = false, marcadores, linhas, corValor, formato = fmtCompacto, formatoDica, tamanho = "meio", altura, rotulos = false, rotulo, legenda = true }: {
  categorias: string[]; series: SerieColuna[]; empilhado?: boolean; marcadores?: { nome: string; valores: (number | null | undefined)[]; cor?: string } | null;
  linhas?: SerieLinha[]; corValor?: (v: number, i: number, s: number) => string | undefined; formato?: (v: number) => string; formatoDica?: (v: number) => string;
  tamanho?: Tamanho; altura?: number; rotulos?: boolean; rotulo: string; legenda?: boolean;
}) {
  const d = DIM[tamanho]; const H = altura ?? d.H; const n = categorias.length; const ns = series.length; const dica = formatoDica ?? formato;
  const somas = empilhado ? categorias.flatMap((_, i) => { const vs = series.map(s => s.valores[i]).filter(ok); return [vs.filter(v => v > 0).reduce((a, v) => a + v, 0), vs.filter(v => v < 0).reduce((a, v) => a + v, 0)]; }) : series.flatMap(s => s.valores).filter(ok);
  const todos = [...somas, ...(marcadores ? marcadores.valores.filter(ok) : []), ...(linhas ?? []).flatMap(l => l.valores).filter(ok)];
  if (!n || !todos.some(v => v !== 0) && !series.some(s => s.valores.some(ok))) return <Vazio />;
  const e = escala(todos.length ? todos : [0], true);
  const y = (v: number) => d.T + (1 - (v - e.lo) / (e.hi - e.lo)) * (H - d.T - d.B); const zeroY = y(0);
  const banda = (d.W - d.L - d.R) / n; const interno = banda * (empilhado || ns === 1 ? 0.62 : 0.78); const bw = empilhado ? interno : interno / Math.max(1, ns);
  const x0 = (i: number) => d.L + i * banda + (banda - interno) / 2; const cx = (i: number) => d.L + i * banda + banda / 2;
  const mostraX = rotulosX(n, d.maxRot); const mostraValor = rotulos && n * (empilhado ? 1 : ns) <= 16;
  const barras: ReactNode[] = [];
  categorias.forEach((c, i) => {
    let pos = 0, neg = 0;
    series.forEach((s, si) => {
      const v = s.valores[i]; if (!ok(v)) return; const cor = corValor?.(v, i, si) ?? s.cor ?? corSerie(si);
      let topo: number, alt: number, bx: number;
      if (empilhado) { bx = x0(i); if (v >= 0) { topo = y(pos + v); alt = y(pos) - topo; pos += v; } else { topo = y(neg); alt = y(neg + v) - topo; neg += v; } }
      else { bx = x0(i) + si * bw; topo = v >= 0 ? y(v) : zeroY; alt = Math.abs(y(v) - zeroY); }
      barras.push(<rect key={`${i}-${si}`} x={bx + (empilhado ? 0 : 1)} y={topo} width={Math.max(1, bw - (empilhado ? 0 : 2))} height={Math.max(v === 0 ? 0 : 1, alt)} rx="2" fill={cor}><title>{`${s.nome} · ${c}: ${dica(v)}`}</title></rect>);
      if (mostraValor && !empilhado) barras.push(<text key={`t${i}-${si}`} x={bx + bw / 2} y={v >= 0 ? topo - 6 : topo + alt + 18} textAnchor="middle" className={`${d.txt} fill-slate-600`}>{formato(v)}</text>);
    });
    if (mostraValor && empilhado && pos) barras.push(<text key={`ts${i}`} x={cx(i)} y={y(pos) - 6} textAnchor="middle" className={`${d.txt} fill-slate-600`}>{formato(pos + neg)}</text>);
    const m = marcadores?.valores[i]; if (marcadores && ok(m)) barras.push(<line key={`m${i}`} x1={x0(i) - 3} x2={x0(i) + interno + 3} y1={y(m)} y2={y(m)} stroke={marcadores.cor ?? COR.orcado} strokeWidth="3.2" strokeLinecap="round"><title>{`${marcadores.nome} · ${c}: ${dica(m)}`}</title></line>);
  });
  const leg = [...(ns > 1 || marcadores ? series.map((s, i) => ({ rotulo: s.nome, cor: s.cor ?? corSerie(i), tipo: "barra" as const })) : []), ...(marcadores ? [{ rotulo: marcadores.nome, cor: marcadores.cor ?? COR.orcado, tipo: "marcador" as const }] : []), ...(linhas ?? []).map((l, i) => ({ rotulo: l.nome, cor: l.cor ?? corSerie(ns + i), tipo: (l.tracejada ? "tracejada" : "linha") as "linha" | "tracejada" }))];
  return (
    <figure className="min-w-0">
      <div className={d.caixa}>
        <svg viewBox={`0 0 ${d.W} ${H}`} className={d.svg} role="img" aria-label={rotulo}>
          {e.ticks.map(t => <g key={t}><line x1={d.L} x2={d.W - d.R} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#b8c4d4" : COR.grade} /><text x={d.L - 8} y={y(t) + 4} textAnchor="end" className={`${d.txt} fill-slate-500`}>{formato(t)}</text></g>)}
          {barras}
          {(linhas ?? []).map((l, li) => { const cor = l.cor ?? corSerie(ns + li); return <g key={l.nome}>{segmentos(l.valores, cx, y).map((p, k) => p.length > 1 ? <path key={k} d={caminho(p)} fill="none" stroke={cor} strokeWidth="2.4" strokeDasharray={l.tracejada ? "7 5" : undefined} /> : null)}{l.valores.map((v, i) => ok(v) ? <circle key={i} cx={cx(i)} cy={y(v)} r="3" fill="#fff" stroke={cor} strokeWidth="1.8"><title>{`${l.nome} · ${categorias[i]}: ${dica(v)}`}</title></circle> : null)}</g>; })}
          {categorias.map((c, i) => mostraX(i) ? <text key={i} x={cx(i)} y={H - d.B + 26} textAnchor="middle" className={`${d.txt} fill-slate-500`}>{c}</text> : null)}
        </svg>
      </div>
      {legenda && leg.length > 0 && <Legenda itens={leg} />}
      <TabelaLeitor titulo={rotulo} colunas={["Categoria", ...series.map(s => s.nome), ...(marcadores ? [marcadores.nome] : []), ...(linhas ?? []).map(l => l.nome)]} linhas={categorias.map((c, i) => [c, ...series.map(s => ok(s.valores[i]) ? dica(s.valores[i] as number) : "—"), ...(marcadores ? [ok(marcadores.valores[i]) ? dica(marcadores.valores[i] as number) : "—"] : []), ...(linhas ?? []).map(l => ok(l.valores[i]) ? dica(l.valores[i] as number) : "—")])} />
    </figure>
  );
}

// ------------------------------------------------------------------ Barras horizontais (ranking, divergente, empilhada)
export type ItemBarra = { rotulo: ReactNode; chave?: string; valor: number | null; cor?: string; href?: string; sub?: ReactNode; texto?: string; segmentos?: { valor: number; cor: string; rotulo: string }[] };
export function BarrasH({ itens, formato = fmtCompacto, max, divergente = false, rotulo, largRotulo = "9.5rem" }: { itens: ItemBarra[]; formato?: (v: number) => string; max?: number; divergente?: boolean; rotulo: string; largRotulo?: string }) {
  const valores = itens.map(i => i.segmentos ? i.segmentos.reduce((a, s) => a + Math.max(0, s.valor), 0) : i.valor).filter(ok);
  if (!itens.length || !valores.length) return <Vazio />;
  const m = max ?? (divergente ? Math.max(...valores.map(Math.abs)) : Math.max(...valores)) ?? 1; const mx = m > 0 ? m : 1;
  return (
    <div role="list" aria-label={rotulo} className="space-y-1.5">
      {itens.map((it, k) => {
        const v = it.valor; const nome = it.href ? <Link href={it.href} className="text-acao hover:underline">{it.rotulo}</Link> : it.rotulo;
        const total = it.segmentos ? it.segmentos.reduce((a, s) => a + Math.max(0, s.valor), 0) : null;
        return (
          <div role="listitem" key={it.chave ?? k} className="grid items-center gap-2 text-xs sm:text-sm" style={{ gridTemplateColumns: `minmax(0,${largRotulo}) minmax(0,1fr) auto` }}>
            <div className="min-w-0 truncate" title={typeof it.rotulo === "string" ? it.rotulo : undefined}>{nome}{it.sub && <div className="truncate text-[11px] text-slate-500">{it.sub}</div>}</div>
            <div className="relative h-3.5 rounded bg-mist">
              {it.segmentos ? <div className="absolute inset-y-0 left-0 flex overflow-hidden rounded" style={{ width: `${Math.min(100, (100 * (total ?? 0)) / mx)}%` }}>{it.segmentos.filter(s => s.valor > 0).map(s => <div key={s.rotulo} style={{ width: `${(100 * s.valor) / (total || 1)}%`, background: s.cor }} title={`${s.rotulo}: ${formato(s.valor)}`} />)}</div>
                : ok(v) ? divergente
                  ? <><div className="absolute inset-y-[-3px] left-1/2 w-px bg-slate-400" /><div className="absolute inset-y-0 rounded" title={formato(v)} style={{ background: it.cor ?? (v >= 0 ? COR.ok : COR.erro), width: `${Math.min(50, (50 * Math.abs(v)) / mx)}%`, left: v >= 0 ? "50%" : `${50 - Math.min(50, (50 * Math.abs(v)) / mx)}%` }} /></>
                  : <div className="absolute inset-y-0 left-0 rounded" title={formato(v)} style={{ background: it.cor ?? COR.acao, width: `${Math.max(v > 0 ? 1.5 : 0, Math.min(100, (100 * v) / mx))}%` }} /> : null}
            </div>
            <div className="whitespace-nowrap text-right tabular-nums text-ink">{it.texto ?? (it.segmentos ? formato(total ?? 0) : ok(v) ? formato(v) : "—")}</div>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ Composição (antes "Rosca")
/**
 * Composição de um todo (Cap. 13 da Nova Arquitetura: pizza/rosca só no C7 de orçado × realizado; composições viram barra).
 * Barra 100% empilhada com destaque opcional, legenda com valor e % e a tabela "ver dados". Mantém a assinatura antiga (fatias/centro).
 */
export function Rosca({ fatias, centro, formato = fmtCompacto, rotulo }: { fatias: { rotulo: string; valor: number; cor?: string; href?: string }[]; centro?: { valor: string; rotulo?: string }; formato?: (v: number) => string; rotulo: string; tamanho?: number }) {
  const vs = fatias.filter(f => f.valor > 0); const total = vs.reduce((a, f) => a + f.valor, 0);
  if (!total) return <Vazio />;
  const pct = (v: number) => total ? (100 * v) / total : 0; const fmtP = (p: number) => `${p.toLocaleString("pt-BR", { maximumFractionDigits: p < 10 ? 1 : 0 })}%`;
  return (
    <figure className="min-w-0">
      {centro && <div className="mb-2 flex flex-wrap items-baseline gap-x-1.5"><span className="text-2xl font-semibold leading-none tabular-nums text-navy">{centro.valor}</span>{centro.rotulo && <span className="text-xs text-slate-500">{centro.rotulo}</span>}</div>}
      <div role="img" aria-label={`${rotulo}: ${vs.map(f => `${f.rotulo} ${fmtP(pct(f.valor))}`).join(", ")}`} className="flex h-4 w-full overflow-hidden rounded" style={{ background: COR.grade }}>
        {vs.map((f, i) => <span key={f.rotulo} title={`${f.rotulo}: ${formato(f.valor)} (${fmtP(pct(f.valor))})`} className="h-full border-r-2 border-white last:border-r-0" style={{ width: `${pct(f.valor)}%`, background: f.cor ?? corSerie(i) }} />)}
      </div>
      <ul className="mt-3 space-y-1 text-xs sm:text-sm">
        {fatias.map((f, i) => { const idx = vs.indexOf(f); const cor = f.cor ?? corSerie(idx >= 0 ? idx : i); return (
          <li key={f.rotulo} className="flex items-start justify-between gap-2">
            <span className="flex min-w-0 items-start gap-1.5"><span aria-hidden className="mt-[0.3em] inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: cor }} />{f.href ? <Link href={f.href} className="leading-snug text-acao [overflow-wrap:anywhere] hover:underline">{f.rotulo}</Link> : <span className="leading-snug [overflow-wrap:anywhere]">{f.rotulo}</span>}</span>
            <span className="whitespace-nowrap tabular-nums text-slate-700">{formato(f.valor)} <span className="text-slate-400">· {fmtP(pct(f.valor))}</span></span>
          </li>); })}
      </ul>
      <TabelaLeitor titulo={rotulo} colunas={["Item", "Valor", "% do total"]} linhas={fatias.map(f => [f.rotulo, formato(f.valor), fmtP(pct(f.valor))])} />
    </figure>
  );
}

// ------------------------------------------------------------------ Medidor (velocímetro)
export function Medidor({ valor, min = 0, max = 100, faixas, menorMelhor = false, rotulo, formato = (v: number) => fmtCompacto(v), sub }: { valor: number | null; min?: number; max?: number; faixas?: [number, number]; menorMelhor?: boolean; rotulo: string; formato?: (v: number) => string; sub?: string }) {
  const cx = 60, cy = 58, r = 46; const ang = (v: number) => Math.PI * (1 - (Math.max(min, Math.min(max, v)) - min) / ((max - min) || 1));
  const pt = (v: number, rr = r) => [cx + rr * Math.cos(ang(v)), cy - rr * Math.sin(ang(v))] as const;
  const arco = (a: number, b: number) => { const [x1, y1] = pt(a), [x2, y2] = pt(b); return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`; };
  const cores = menorMelhor ? [COR.ok, COR.aviso, COR.erro] : [COR.erro, COR.aviso, COR.ok];
  const trechos: [number, number, string][] = faixas ? [[min, faixas[0], cores[0]], [faixas[0], faixas[1], cores[1]], [faixas[1], max, cores[2]]] : [[min, max, COR.grade]];
  const tom = valor === null ? COR.neutro : faixas ? trechos.find(([a, b]) => valor >= a && valor <= b)?.[2] ?? COR.navy : COR.acao;
  const [px, py] = valor === null ? [cx, cy] : pt(valor, r - 12);
  return (
    <figure className="flex flex-col items-center">
      <svg viewBox="0 0 120 72" className="h-auto w-full max-w-[220px]" role="img" aria-label={`${rotulo}: ${valor === null ? "sem dado" : formato(valor)}`}>
        {trechos.map(([a, b, c], i) => <path key={i} d={arco(a, b)} fill="none" stroke={c} strokeWidth="9" opacity={faixas ? 0.85 : 1} />)}
        {!faixas && valor !== null && <path d={arco(min, valor)} fill="none" stroke={COR.acao} strokeWidth="9" />}
        {valor !== null && <><line x1={cx} y1={cy} x2={px} y2={py} stroke={COR.navy} strokeWidth="2.2" strokeLinecap="round" /><circle cx={cx} cy={cy} r="3.5" fill={COR.navy} /></>}
        <text x="6" y="70" fontSize="6.5" fill={COR.texto}>{formato(min)}</text><text x="114" y="70" fontSize="6.5" textAnchor="end" fill={COR.texto}>{formato(max)}</text>
      </svg>
      <figcaption className="-mt-1 text-center"><div className="text-xl font-semibold tabular-nums" style={{ color: tom }}>{valor === null ? "—" : formato(valor)}</div><div className="text-xs text-slate-600">{rotulo}</div>{sub && <div className="text-[11px] text-slate-500">{sub}</div>}</figcaption>
    </figure>
  );
}

// ------------------------------------------------------------------ Bala (atual × meta)
export function Bala({ itens, rotulo }: { itens: { rotulo: ReactNode; atual: number | null; meta: number | null; maximo?: number | null; formato?: (v: number) => string; menorMelhor?: boolean; href?: string; sub?: ReactNode }[]; rotulo: string }) {
  if (!itens.length) return <Vazio />;
  return (
    <div role="list" aria-label={rotulo} className="space-y-2.5">
      {itens.map((it, k) => {
        const f = it.formato ?? fmtCompacto; const topo = Math.max(it.maximo ?? 0, (it.meta ?? 0) * 1.15, it.atual ?? 0, 1);
        // percentual mostrado = quanto do alvo foi usado/atingido (gasto de 42 sobre 87 = 48%); a cor diz se está bem
        const pct = it.atual !== null && it.meta ? it.atual / it.meta : null;
        const cor = pct === null ? COR.acao : it.menorMelhor ? (pct > 1 ? COR.erro : pct >= 0.9 ? COR.aviso : COR.ok) : pct >= 1 ? COR.ok : pct >= 0.9 ? COR.aviso : COR.erro;
        const nome = it.href ? <Link className="text-acao hover:underline" href={it.href}>{it.rotulo}</Link> : it.rotulo;
        return (
          <div role="listitem" key={k} className="text-xs sm:text-sm">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2"><span className="min-w-[9rem] flex-1 font-medium leading-snug text-ink [overflow-wrap:break-word]">{nome}{it.sub && <span className="ml-1 text-[11px] font-normal text-slate-500">{it.sub}</span>}</span><span className="ml-auto whitespace-nowrap tabular-nums text-slate-700"><b className="text-ink">{it.atual === null ? "—" : f(it.atual)}</b>{it.meta !== null && <> de {f(it.meta)} · <b style={{ color: cor }}>{pct === null ? "—" : `${Math.round(pct * 100)}%`}</b></>}</span></div>
            <div className="relative h-3 rounded bg-mist">
              {it.maximo ? <div className="absolute inset-y-0 left-0 rounded bg-slate-200" style={{ width: `${Math.min(100, (100 * it.maximo) / topo)}%` }} title={`Capacidade: ${f(it.maximo)}`} /> : null}
              {it.atual !== null && <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${Math.min(100, (100 * it.atual) / topo)}%`, background: cor }} />}
              {it.meta !== null && <div className="absolute -inset-y-1 w-0.5 bg-navy" style={{ left: `${Math.min(100, (100 * it.meta) / topo)}%` }} title={`Meta: ${f(it.meta)}`} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ Mapa de calor (tabela)
export type CelulaCalor = { texto: string; tom: Tom | "vazio"; titulo?: string; href?: string };
export function MapaCalor({ colunas, linhas, celula, rotulo, cabecalho = "" }: { colunas: { chave: string; rotulo: string; sub?: string }[]; linhas: { chave: string; rotulo: ReactNode; href?: string; destaque?: boolean }[]; celula: (linha: string, coluna: string) => CelulaCalor; rotulo: string; cabecalho?: string }) {
  if (!linhas.length || !colunas.length) return <Vazio />;
  return (
    <div className="overflow-x-auto rounded-md border border-line [-webkit-overflow-scrolling:touch]">
      <table className="w-full text-left text-xs sm:text-sm" aria-label={rotulo}>
        <thead className="bg-mist text-[11px] text-slate-600"><tr><th className="sticky left-0 z-[1] bg-mist px-2 py-2 font-medium sm:px-3">{cabecalho}</th>{colunas.map(c => <th key={c.chave} className="px-2 py-2 text-center font-medium sm:px-3"><div className="whitespace-nowrap">{c.rotulo}</div>{c.sub && <div className="font-normal text-slate-500">{c.sub}</div>}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">
          {linhas.map(l => <tr key={l.chave} className={l.destaque ? "font-semibold" : ""}>
            <th scope="row" className={`sticky left-0 z-[1] whitespace-nowrap px-2 py-1.5 font-medium sm:px-3 ${l.destaque ? "bg-mist" : "bg-white"}`}>{l.href ? <Link href={l.href} className="text-acao hover:underline">{l.rotulo}</Link> : l.rotulo}</th>
            {colunas.map(c => { const v = celula(l.chave, c.chave); const inner = <span className="block whitespace-nowrap tabular-nums">{v.texto}</span>; return <td key={c.chave} title={v.titulo} className={`px-2 py-1.5 text-center sm:px-3 ${FUNDO_TOM[v.tom]}`}>{v.href ? <Link href={v.href} className="hover:underline">{inner}</Link> : inner}</td>; })}
          </tr>)}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ Cascata (ponte de valores)
export function Cascata({ passos, formato = fmtCompacto, formatoDica, tamanho = "meio", altura, rotulo }: { passos: { rotulo: string; valor: number; tipo: "total" | "delta" }[]; formato?: (v: number) => string; formatoDica?: (v: number) => string; tamanho?: Tamanho; altura?: number; rotulo: string }) {
  const d0 = DIM[tamanho]; const d = { ...d0, B: d0.B + 16 }; const H = altura ?? d.H + 36; const n = passos.length; const dica = formatoDica ?? formato;
  if (!n) return <Vazio />;
  let run = 0; const geo = passos.map(p => { if (p.tipo === "total") { run = p.valor; return { de: 0, ate: p.valor, ...p }; } const de = run; run += p.valor; return { de, ate: run, ...p }; });
  const e = escala(geo.flatMap(g => [g.de, g.ate]), true);
  const y = (v: number) => d.T + (1 - (v - e.lo) / (e.hi - e.lo)) * (H - d.T - d.B - 14);
  const banda = (d.W - d.L - d.R) / n; const bw = banda * 0.62; const bx = (i: number) => d.L + i * banda + (banda - bw) / 2;
  // rótulo em duas linhas ("Receita:" / "Mensalidades"); cada linha encurtada para caber na largura da barra
  const cabe = Math.max(6, Math.floor(banda / (tamanho === "inteiro" ? 8.5 : 7.5)));
  const curto = (t: string) => t.length > cabe ? `${t.slice(0, cabe - 1)}…` : t;
  const linhasRotulo = (t: string) => { const i = t.indexOf(": "); return i > 0 ? [t.slice(0, i + 1), t.slice(i + 2)] : t.length > cabe && t.includes(" ") ? [t.slice(0, t.lastIndexOf(" ", cabe) > 0 ? t.lastIndexOf(" ", cabe) : cabe), t.slice((t.lastIndexOf(" ", cabe) > 0 ? t.lastIndexOf(" ", cabe) : cabe) + 1)] : [t]; };
  return (
    <figure className="min-w-0">
      <div className={d.caixa}>
        <svg viewBox={`0 0 ${d.W} ${H}`} className={d.svg} role="img" aria-label={rotulo}>
          {e.ticks.map(t => <g key={t}><line x1={d.L} x2={d.W - d.R} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#b8c4d4" : COR.grade} /><text x={d.L - 8} y={y(t) + 4} textAnchor="end" className={`${d.txt} fill-slate-500`}>{formato(t)}</text></g>)}
          {geo.map((g, i) => { const cor = g.tipo === "total" ? (g.ate >= 0 ? COR.navy : COR.erro) : g.valor >= 0 ? COR.ok : COR.erro; const topo = y(Math.max(g.de, g.ate)); const alt = Math.max(1, Math.abs(y(g.de) - y(g.ate)));
            return <g key={i}>
              <rect x={bx(i)} y={topo} width={bw} height={alt} rx="2" fill={cor}><title>{`${g.rotulo}: ${dica(g.valor)}`}</title></rect>
              {i < n - 1 && <line x1={bx(i) + bw} x2={bx(i + 1)} y1={y(g.ate)} y2={y(g.ate)} stroke={COR.neutro} strokeDasharray="3 3" />}
              <text x={bx(i) + bw / 2} y={topo - 6} textAnchor="middle" className={`${d.txt} fill-slate-700`}>{g.tipo === "delta" && g.valor > 0 ? "+" : ""}{formato(g.valor)}</text>
              <text x={bx(i) + bw / 2} y={H - d.B + 18} textAnchor="middle" className={`${d.txt} fill-slate-500`}><title>{g.rotulo}</title>{linhasRotulo(g.rotulo).map((l, j) => <tspan key={j} x={bx(i) + bw / 2} dy={j ? "1.15em" : 0}>{curto(l)}</tspan>)}</text>
            </g>; })}
        </svg>
      </div>
      <TabelaLeitor titulo={rotulo} colunas={["Etapa", "Valor"]} linhas={passos.map(p => [p.rotulo, dica(p.valor)])} />
    </figure>
  );
}

// ------------------------------------------------------------------ Funil
export function Funil({ etapas, formato = (v: number) => v.toLocaleString("pt-BR"), rotulo }: { etapas: { rotulo: string; valor: number; sub?: string; href?: string }[]; formato?: (v: number) => string; rotulo: string }) {
  // v24.1: a escala é o MAIOR valor (não a primeira etapa) — em fluxos que não são funil estrito (ex.: etapas do ciclo de desempenho,
  // em que uma etapa posterior pode ter mais itens concluídos que a primeira) a barra nunca passa de 100% nem sai do cartão.
  const topo = Math.max(0, ...etapas.map(e => e.valor));
  if (!etapas.length || !topo) return <Vazio texto="Sem entradas no funil neste período." />;
  const funilEstrito = etapas.every((e, i) => i === 0 || e.valor <= etapas[i - 1].valor);
  // rótulo à esquerda (quebra linha, nunca corta), barra proporcional ao maior valor e o número à direita
  return (
    <ol aria-label={rotulo} className="space-y-1">
      {etapas.map((e, i) => { const w = Math.min(100, Math.max(2, (100 * e.valor) / topo)); const conv = funilEstrito && i > 0 && etapas[i - 1].valor ? Math.round((100 * e.valor) / etapas[i - 1].valor) : null; return (
        <li key={e.rotulo} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-x-3">
          {conv !== null && <div className="col-start-2 text-[11px] text-slate-500">↓ {conv}% avançam</div>}
          <div className="text-right text-xs leading-snug text-slate-700 [overflow-wrap:anywhere] sm:text-sm">{e.href ? <Link href={e.href} className="text-acao underline-offset-2 hover:underline">{e.rotulo}</Link> : e.rotulo}{e.sub && <div className="text-[11px] text-slate-500">{e.sub}</div>}</div>
          <div className="flex min-w-0 items-center gap-2">
            <div className="h-6 min-w-0 flex-1"><div className="h-full rounded" style={{ width: `${w}%`, background: corSerie(i) }} /></div>
            <b className="min-w-[3.5rem] whitespace-nowrap text-xs tabular-nums text-ink sm:text-sm">{formato(e.valor)}</b>
          </div>
        </li>); })}
      {etapas.length > 1 && funilEstrito && etapas[0].valor > 0 && <li className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 pt-1 text-xs text-slate-600"><span /><span>Conversão total: <b>{Math.round((100 * etapas[etapas.length - 1].valor) / etapas[0].valor)}%</b></span></li>}
    </ol>
  );
}

// ------------------------------------------------------------------ Gantt (cronograma)
export type LinhaGantt = { chave: string; rotulo: ReactNode; sub?: ReactNode; href?: string; inicio: string | null; fim: string | null; cor: string; progresso?: number | null; marcos?: { data: string; rotulo: string; estado: "FEITO" | "ATRASADO" | "PENDENTE"; baseline?: string | null }[]; baseline?: { inicio: string | null; fim: string | null } | null };
/** Gantt (T-077): barra atual, baseline em cinza por baixo (barra e losango vazado ligado ao atual), marcos, linha de hoje; escala mensal ou semanal. */
export function Gantt({ de, ate, hoje, linhas, rotulo, escala = "mes" }: { de: string; ate: string; hoje: string; linhas: LinhaGantt[]; rotulo: string; escala?: "mes" | "semana" }) {
  if (!linhas.length) return <Vazio texto="Nenhum item com datas no período." />;
  const t = (iso: string) => Date.parse(`${iso}T00:00:00Z`); const T0 = t(de), T1 = t(ate); const span = Math.max(1, T1 - T0);
  const pos = (iso: string) => Math.max(0, Math.min(100, (100 * (t(iso) - T0)) / span));
  const meses: string[] = []; { const [y0, m0] = de.split("-").map(Number); let y = y0, m = m0; while (`${y}-${String(m).padStart(2, "0")}-01` <= ate) { meses.push(`${y}-${String(m).padStart(2, "0")}-01`); m++; if (m > 12) { m = 1; y++; } } }
  const nomeMes = (iso: string) => ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(iso.slice(5, 7)) - 1] + (iso.slice(5, 7) === "01" || iso === meses[0] ? `/${iso.slice(2, 4)}` : "");
  const hj = hoje >= de && hoje <= ate ? pos(hoje) : null; const passo = Math.max(1, Math.ceil(meses.length / 12));
  // escala semanal: marcas às segundas-feiras
  const semanas: string[] = []; if (escala === "semana") { const d0 = new Date(`${de}T00:00:00Z`); d0.setUTCDate(d0.getUTCDate() + ((8 - d0.getUTCDay()) % 7)); for (let d = d0; d.toISOString().slice(0, 10) <= ate; d.setUTCDate(d.getUTCDate() + 7)) semanas.push(d.toISOString().slice(0, 10)); }
  const passoSem = Math.max(1, Math.ceil(semanas.length / 14));
  const temBaseline = linhas.some(l => l.baseline || (l.marcos ?? []).some(m => m.baseline));
  return (
    <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]" role="region" aria-label={rotulo}>
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)] gap-x-3">
          <div />
          <div className="relative h-5 border-b border-line text-[11px] text-slate-500">{escala === "semana" ? semanas.map((w, i) => i % passoSem === 0 && <span key={w} className="absolute" style={{ left: `${pos(w)}%` }}>{w.slice(8, 10)}/{w.slice(5, 7)}</span>) : meses.map((m, i) => i % passo === 0 && <span key={m} className="absolute -translate-x-0" style={{ left: `${pos(m < de ? de : m)}%` }}>{nomeMes(m)}</span>)}</div>
          {linhas.map(l => (
            <div key={l.chave} className="contents">
              <div className="min-w-0 border-b border-line py-1.5 text-xs sm:text-sm"><div className="truncate font-medium">{l.href ? <Link className="text-acao hover:underline" href={l.href}>{l.rotulo}</Link> : l.rotulo}</div>{l.sub && <div className="truncate text-[11px] text-slate-500">{l.sub}</div>}</div>
              <div className="relative border-b border-line">
                {(escala === "semana" ? semanas : meses.slice(1)).map(m => <div key={m} className="absolute inset-y-0 w-px bg-slate-100" style={{ left: `${pos(m)}%` }} />)}
                {l.baseline?.inicio && l.baseline.fim && l.baseline.fim >= de && l.baseline.inicio <= ate && (() => { const a = pos(l.baseline.inicio < de ? de : l.baseline.inicio), b = pos(l.baseline.fim > ate ? ate : l.baseline.fim); return <div className="absolute bottom-0.5 h-1 rounded-sm bg-slate-400/70" style={{ left: `${a}%`, width: `${Math.max(0.6, b - a)}%` }} title={`Baseline: ${l.baseline.inicio} → ${l.baseline.fim}`} />; })()}
                {(l.marcos ?? []).filter(m => m.baseline && m.baseline !== m.data && ((m.baseline >= de && m.baseline <= ate) || (m.data >= de && m.data <= ate))).map((m, i) => { const a = pos(m.baseline! < m.data ? m.baseline! : m.data), b = pos(m.baseline! < m.data ? m.data : m.baseline!); return <div key={`c${i}`} className="absolute top-1/2 h-px -translate-y-1/2 bg-slate-400" style={{ left: `${a}%`, width: `${Math.max(0, b - a)}%` }} />; })}
                {(l.marcos ?? []).filter(m => m.baseline && m.baseline >= de && m.baseline <= ate && m.baseline !== m.data).map((m, i) => <div key={`b${i}`} title={`${m.rotulo} · baseline ${m.baseline}`} className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-slate-400 bg-white" style={{ left: `${pos(m.baseline!)}%` }} />)}
                {l.inicio && l.fim && l.fim >= de && l.inicio <= ate && (() => { const a = pos(l.inicio < de ? de : l.inicio), b = pos(l.fim > ate ? ate : l.fim); return (
                  <div className="absolute top-1/2 h-3.5 -translate-y-1/2 overflow-hidden rounded" style={{ left: `${a}%`, width: `${Math.max(0.8, b - a)}%`, background: `${l.cor}33`, border: `1px solid ${l.cor}` }} title={`${l.inicio} → ${l.fim}${l.progresso !== null && l.progresso !== undefined ? ` · ${l.progresso}% concluído` : ""}`}>
                    {l.progresso !== null && l.progresso !== undefined && <div className="h-full" style={{ width: `${Math.max(0, Math.min(100, l.progresso))}%`, background: l.cor }} />}
                  </div>); })()}
                {(l.marcos ?? []).filter(m => m.data >= de && m.data <= ate).map((m, i) => <div key={i} title={`${m.rotulo} · ${m.data}${m.estado === "FEITO" ? " · concluído" : m.estado === "ATRASADO" ? " · atrasado" : ""}`} className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-white" style={{ left: `${pos(m.data)}%`, background: m.estado === "FEITO" ? COR.ok : m.estado === "ATRASADO" ? COR.erro : COR.navy }} />)}
                {hj !== null && <div className="absolute inset-y-0 w-0.5 bg-erro/70" style={{ left: `${hj}%` }} />}
              </div>
            </div>
          ))}
        </div>
        <Legenda itens={[{ rotulo: "Marco concluído", cor: COR.ok, tipo: "ponto" }, { rotulo: "Marco atrasado", cor: COR.erro, tipo: "ponto" }, { rotulo: "Marco previsto", cor: COR.navy, tipo: "ponto" }, ...(temBaseline ? [{ rotulo: "Baseline (planejado)", cor: COR.neutro, tipo: "linha" as const }] : []), ...(hj !== null ? [{ rotulo: "Hoje", cor: COR.erro, tipo: "linha" as const }] : [])]} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Minigráfico (sparkline)
export function Minigrafico({ valores, cor = COR.acao, area = true, largura = 96, altura = 28, rotulo }: { valores: (number | null | undefined)[]; cor?: string; area?: boolean; largura?: number; altura?: number; rotulo?: string }) {
  const nums = valores.filter(ok); if (nums.length < 2) return <span className="inline-block text-[11px] text-slate-400" style={{ width: largura }}>{nums.length ? "" : "sem série"}</span>;
  const min = Math.min(...nums), max = Math.max(...nums); const amp = max - min || 1; const n = valores.length;
  const x = (i: number) => 2 + (i * (largura - 4)) / Math.max(1, n - 1); const y = (v: number) => altura - 3 - ((v - min) / amp) * (altura - 6);
  const segs = segmentos(valores, x, y); let ult = -1; for (let i = n - 1; i >= 0; i--) if (ok(valores[i])) { ult = i; break; }
  return (
    <svg width={largura} height={altura} viewBox={`0 0 ${largura} ${altura}`} className="inline-block shrink-0 align-middle" role={rotulo ? "img" : undefined} aria-label={rotulo} aria-hidden={rotulo ? undefined : true}>
      {area && segs.map((p, k) => p.length > 1 ? <path key={`a${k}`} d={`${caminho(p)} L${p[p.length - 1][0].toFixed(1)} ${altura} L${p[0][0].toFixed(1)} ${altura} Z`} fill={cor} opacity="0.12" /> : null)}
      {segs.map((p, k) => p.length > 1 ? <path key={k} d={caminho(p)} fill="none" stroke={cor} strokeWidth="1.6" strokeLinejoin="round" /> : <circle key={k} cx={p[0][0]} cy={p[0][1]} r="1.5" fill={cor} />)}
      {ult >= 0 && <circle cx={x(ult)} cy={y(valores[ult] as number)} r="2.6" fill={cor} />}
    </svg>
  );
}

// ------------------------------------------------------------------ Cartão de indicador
export type DeltaCartao = { texto: string; rotulo: string; bom: boolean | null };
export function KpiCard({ titulo, valor, sub, deltas = [], meta, serie, tom = "neutro", href, nota, corSerie: cs, ajuda }: {
  titulo: string; valor: string; sub?: ReactNode; deltas?: (DeltaCartao | null)[]; meta?: { texto: string; tom: Tom } | null; serie?: (number | null | undefined)[];
  tom?: Tom; href?: string; nota?: string | null; corSerie?: string; ajuda?: string;
}) {
  const ds = deltas.filter((d): d is DeltaCartao => !!d);
  const inner = (
    <div className={`flex h-full min-w-0 flex-col justify-between gap-1 rounded-md border border-line border-l-4 bg-white px-3 py-2.5 ${BORDA_TOM[tom]} ${href ? "transition hover:shadow-sm" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-[11px] font-medium leading-tight text-slate-600 sm:text-xs" title={ajuda}>{titulo}{nota && <span className="ml-1 inline-block rounded-full bg-amber-100 px-1 text-[10px] text-aviso" title={nota}>nota</span>}</div>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-x-2 gap-y-1">
        <div className="min-w-0 max-w-full text-xl font-semibold leading-tight tabular-nums text-navy [overflow-wrap:break-word] xl:text-2xl">{valor}</div>
        {serie && <Minigrafico valores={serie} cor={cs ?? (tom === "ruim" ? COR.erro : tom === "atencao" ? COR.aviso : COR.acao)} largura={84} altura={26} />}
      </div>
      {ds.length > 0 && <div className="space-y-0.5">{ds.map((d, i) => <div key={i} className="flex flex-wrap items-baseline gap-x-1 text-[11px] leading-tight sm:text-xs"><span className={`font-semibold tabular-nums ${d.bom === null ? "text-slate-600" : d.bom ? "text-ok" : "text-erro"}`}>{d.texto === "estável" ? "■ " : d.texto.startsWith("−") ? "▼ " : d.texto.startsWith("+") ? "▲ " : ""}{d.texto}</span><span className="text-slate-500">{d.rotulo}</span></div>)}</div>}
      {meta && <div className={`text-[11px] leading-tight sm:text-xs ${TEXTO_TOM[meta.tom]}`}>{meta.texto}</div>}
      {sub && <div className="text-[11px] leading-tight text-slate-500 sm:text-xs">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{inner}</Link> : inner;
}

/** Selo de situação (bolinha colorida + texto). */
export function Situacao({ tom, texto }: { tom: Tom; texto: string }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap text-xs ${TEXTO_TOM[tom]}`}><span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: COR_TOM[tom] }} />{texto}</span>;
}

// ------------------------------------------------------------------ C7 · execução do orçamento (o único "donut" do kit: orçado × realizado)
/** Donut de execução (C7): % realizado do orçado no centro; verde dentro da banda saudável, âmbar abaixo dela, vermelho acima do teto. */
export function Execucao({ rotulo, real, orcado, faixa = [90, 105], formato = fmtCompacto, href, tamanho = 112 }: { rotulo: string; real: number | null; orcado: number | null; faixa?: [number, number]; formato?: (v: number) => string; href?: string; tamanho?: number }) {
  const pct = real !== null && orcado ? (100 * real) / orcado : null;
  const cor = pct === null ? COR.neutro : pct > faixa[1] ? COR.erro : pct >= faixa[0] ? COR.ok : COR.aviso;
  const dentro = pct === null ? 0 : Math.min(100, pct); const excesso = pct !== null && pct > 100 ? Math.min(100, pct - 100) : 0;
  const nome = href ? <Link href={href} className="text-acao hover:underline">{rotulo}</Link> : rotulo;
  return (
    <figure className="flex min-w-0 flex-col items-center text-center">
      <svg viewBox="0 0 100 100" width={tamanho} height={tamanho} role="img" aria-label={`${rotulo}: ${pct === null ? "sem orçamento" : `${Math.round(pct)}% do orçado`}`}>
        <circle cx="50" cy="50" r="38" fill="none" stroke={COR.grade} strokeWidth="13" />
        {/* banda saudável marcada no aro (de faixa[0] a 100%) */}
        <circle cx="50" cy="50" r="46" fill="none" stroke={COR.ok} strokeOpacity="0.25" strokeWidth="3" pathLength={100} strokeDasharray={`${Math.max(0, Math.min(100, faixa[1]) - faixa[0])} ${100 - Math.max(0, Math.min(100, faixa[1]) - faixa[0])}`} strokeDashoffset={-faixa[0]} transform="rotate(-90 50 50)" />
        {pct !== null && <circle cx="50" cy="50" r="38" fill="none" stroke={cor} strokeWidth="13" pathLength={100} strokeDasharray={`${Math.max(0.01, dentro)} ${100 - Math.max(0.01, dentro)}`} transform="rotate(-90 50 50)"><title>{`Realizado ${formato(real ?? 0)} de ${formato(orcado ?? 0)}`}</title></circle>}
        {excesso > 0 && <circle cx="50" cy="50" r="27" fill="none" stroke={COR.erro} strokeWidth="5" pathLength={100} strokeDasharray={`${excesso} ${100 - excesso}`} transform="rotate(-90 50 50)" />}
        <text x="50" y="49" textAnchor="middle" fontSize="15" fontWeight="600" fill={pct === null ? COR.texto : cor}>{pct === null ? "—" : `${Math.round(pct)}%`}</text>
        <text x="50" y="62" textAnchor="middle" fontSize="7.5" fill={COR.texto}>do orçado</text>
      </svg>
      <figcaption className="mt-1 text-xs leading-snug"><div className="font-medium text-ink [overflow-wrap:anywhere]">{nome}</div><div className="tabular-nums text-slate-500">{real === null ? "—" : formato(real)} de {orcado === null ? "—" : formato(orcado)}</div></figcaption>
    </figure>
  );
}

// ------------------------------------------------------------------ Treemap (C15)
type Ret = { x: number; y: number; w: number; h: number };
/** Squarified treemap (Bruls et al.): áreas proporcionais ao valor, retângulos o mais próximos possível de quadrados. */
function squarify(valores: number[], r: Ret): Ret[] {
  const total = valores.reduce((a, b) => a + b, 0); const areas = valores.map(v => (v * r.w * r.h) / total); const out: Ret[] = new Array(valores.length);
  let i = 0; let rect = { ...r };
  while (i < areas.length) {
    const lado = Math.min(rect.w, rect.h); const pior = (l: number[]) => { const s = l.reduce((a, b) => a + b, 0); return Math.max((lado * lado * Math.max(...l)) / (s * s), (s * s) / (lado * lado * Math.min(...l))); };
    const linha = [areas[i]]; let j = i + 1;
    while (j < areas.length && pior([...linha, areas[j]]) <= pior(linha)) { linha.push(areas[j]); j++; }
    const s = linha.reduce((a, b) => a + b, 0);
    if (rect.w >= rect.h) { const w = s / rect.h; let y = rect.y; linha.forEach((ar, k) => { const h = ar / w; out[i + k] = { x: rect.x, y, w, h }; y += h; }); rect = { x: rect.x + w, y: rect.y, w: rect.w - w, h: rect.h }; }
    else { const h = s / rect.w; let x = rect.x; linha.forEach((ar, k) => { const w = ar / h; out[i + k] = { x, y: rect.y, w, h }; x += w; }); rect = { x: rect.x, y: rect.y + h, w: rect.w, h: rect.h - h }; }
    i = j;
  }
  return out;
}
const COR_TREEMAP: Record<Tom, string> = { bom: "#1f7a4d", atencao: "#a35f00", ruim: "#a12b2b", neutro: "#4a6585" };
/** Treemap de composição (ex.: OPEX por categoria): área = valor; cor = tom (ex.: execução do orçamento). Blocos pequenos mostram o texto ao passar o mouse e na lista abaixo. */
export function Treemap({ itens, formato = fmtCompacto, rotulo, legendaTom }: { itens: { rotulo: string; valor: number; sub?: string; tom?: Tom; href?: string }[]; formato?: (v: number) => string; rotulo: string; legendaTom?: { tom: Tom; rotulo: string }[] }) {
  const vs = itens.filter(i => i.valor > 0).sort((a, b) => b.valor - a.valor); const total = vs.reduce((a, i) => a + i.valor, 0);
  if (!total) return <Vazio />;
  const W = 200, H = 100; const rs = squarify(vs.map(v => v.valor), { x: 0, y: 0, w: W, h: H });
  const fmtP = (v: number) => `${((100 * v) / total).toLocaleString("pt-BR", { maximumFractionDigits: (100 * v) / total < 10 ? 1 : 0 })}%`;
  return (
    <figure className="min-w-0">
      <div role="img" aria-label={`${rotulo}: ${vs.map(v => `${v.rotulo} ${formato(v.valor)}`).join(", ")}`} className="relative aspect-[2/1] min-h-[200px] w-full overflow-hidden rounded">
        {vs.map((v, i) => { const r = rs[i]; // o rótulo só aparece se a palavra mais longa cabe no bloco (estimado para um gráfico de ~500 px); senão fica na dica e na lista abaixo
          const palavraMax = Math.max(...v.rotulo.split(/\s+/).map(w => w.length)); const cabe = (r.w / W) * 500 - 12 >= palavraMax * 6.6;
          const grande = r.w > 26 && r.h > 20 && cabe; const medio = r.w > 16 && r.h > 12 && cabe;
          const estilo = { left: `${(100 * r.x) / W}%`, top: `${(100 * r.y) / H}%`, width: `${(100 * r.w) / W}%`, height: `${(100 * r.h) / H}%`, background: COR_TREEMAP[v.tom ?? "neutro"] };
          const corpo = <span className="flex h-full w-full flex-col justify-start overflow-hidden p-1.5 text-white">{medio && <span className="text-[11px] font-semibold leading-tight [overflow-wrap:break-word] sm:text-xs">{v.rotulo}</span>}{medio && <span className="text-[11px] tabular-nums leading-tight opacity-90">{formato(v.valor)}</span>}{grande && v.sub && <span className="mt-0.5 text-[10px] leading-tight opacity-80">{v.sub}</span>}</span>;
          const dica = `${v.rotulo}: ${formato(v.valor)} (${fmtP(v.valor)})${v.sub ? ` · ${v.sub}` : ""}`;
          return v.href ? <Link key={v.rotulo} href={v.href} title={dica} className="absolute border-2 border-white hover:opacity-90" style={estilo}>{corpo}</Link> : <span key={v.rotulo} title={dica} className="absolute border-2 border-white" style={estilo}>{corpo}</span>; })}
      </div>
      {legendaTom && <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-600">{legendaTom.map(l => <span key={l.tom} className="flex items-center gap-1"><span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COR_TREEMAP[l.tom] }} />{l.rotulo}</span>)}</div>}
      <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
        {vs.map(v => <li key={v.rotulo} className="flex items-start justify-between gap-2"><span className="flex min-w-0 items-start gap-1.5"><span aria-hidden className="mt-[0.3em] inline-block h-2 w-2 shrink-0 rounded-sm" style={{ background: COR_TREEMAP[v.tom ?? "neutro"] }} />{v.href ? <Link href={v.href} className="text-acao [overflow-wrap:anywhere] hover:underline">{v.rotulo}</Link> : <span className="[overflow-wrap:anywhere]">{v.rotulo}</span>}</span><span className="whitespace-nowrap tabular-nums text-slate-700">{formato(v.valor)} <span className="text-slate-400">· {fmtP(v.valor)}</span></span></li>)}
      </ul>
      <TabelaLeitor titulo={rotulo} colunas={["Item", "Valor", "% do total", "Observação"]} linhas={vs.map(v => [v.rotulo, formato(v.valor), fmtP(v.valor), v.sub ?? ""])} />
    </figure>
  );
}
