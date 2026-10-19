import Link from "@/components/Link";
import { Badge } from "@/components/ui";
import { FAROL_LABEL, FAIXA_SAUDE, nomePeriodo, farol as farolDe, type Farol, type ConfigIndicador, type Saude, type Componente } from "@/lib/gestao-calc";
import { fmtNum, fmtValor } from "@/lib/gestao-estrategica";

/** Navegação interna da Estratégia (rolagem horizontal no celular). */
const SECOES: [string, string, string][] = [
  ["painel", "/estrategia", "Painel"], ["identidade", "/estrategia/identidade", "Identidade"], ["mapa", "/estrategia/mapa", "Mapa estratégico"], ["indicadores", "/estrategia/indicadores", "Indicadores"],
  ["okrs", "/estrategia/okrs", "OKRs"], ["projetos", "/estrategia/projetos", "Projetos"], ["cronograma", "/estrategia/cronograma", "Cronograma"], ["acoes", "/estrategia/acoes", "Plano de ação"], ["quadro", "/estrategia/acoes/quadro", "Quadro de ações"], ["alinhamento", "/estrategia/alinhamento", "Alinhamento"], ["rituais", "/estrategia/rituais", "Rituais"],
  ["marketing", "/estrategia/marketing", "Marketing"], ["relatorio", "/estrategia/relatorio", "Relatório executivo"], ["assistente", "/estrategia/assistente", "Assistente IA"],
];
export function SubNav({ atual }: { atual: string }) {
  return (
    <nav aria-label="Seções da estratégia" className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1 print:hidden [-webkit-overflow-scrolling:touch] lg:flex-wrap lg:overflow-visible">
      {SECOES.map(([k, href, nome]) => <Link key={k} href={href} className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium ${k === atual ? "border-acao bg-acao text-white" : "border-line bg-white text-navy hover:bg-mist"}`}>{nome}</Link>)}
    </nav>
  );
}

export const FAROL_TOM: Record<Farol, string> = { VERDE: "APROVADA", AMARELO: "PENDENTE", VERMELHO: "REJEITADA", SEM_META: "NEUTRO", SEM_DADO: "NEUTRO" };
export const FarolBadge = ({ f, label }: { f: Farol; label?: string }) => <Badge v={FAROL_TOM[f]} label={label ?? FAROL_LABEL[f]} />;
const COR_FAROL: Record<Farol, string> = { VERDE: "#15803d", AMARELO: "#b45309", VERMELHO: "#b91c1c", SEM_META: "#64748b", SEM_DADO: "#94a3b8" };

/** Cor de um percentual pelas faixas configuradas [crítica < a ≤ atenção < b ≤ boa]. */
export const corFaixa = (p: number | null, faixas: [number, number] = [50, 75]) => p === null ? "text-slate-400" : p >= faixas[1] ? "text-ok" : p >= faixas[0] ? "text-aviso" : "text-erro";
export const Barra = ({ p, faixas = [50, 75] }: { p: number | null; faixas?: [number, number] }) => (
  <div className="h-2 w-full overflow-hidden rounded bg-mist" role="img" aria-label={p === null ? "sem medição" : `${Math.round(p)}%`}>
    <div className={`h-2 ${p === null ? "" : p >= faixas[1] ? "bg-ok" : p >= faixas[0] ? "bg-aviso" : "bg-erro"}`} style={{ width: `${Math.max(0, Math.min(100, p ?? 0))}%` }} />
  </div>
);

/** Regra do farol escrita por extenso (o que a tela mostra é exatamente o que o cálculo faz). */
export function regraFarol(c: ConfigIndicador, unidade: string | null): string {
  const v = (x: number | null) => fmtValor(x, unidade);
  if (c.direcao === "FAIXA") {
    if (c.faixaMin === null || c.faixaMax === null) return "Sem faixa definida: o indicador não é classificado.";
    return `No alvo entre ${v(c.faixaMin)} e ${v(c.faixaMax)}${c.alerta !== null ? ` · atenção até ${fmtNum(c.alerta, 2)} fora da faixa · fora do alvo além disso` : " · fora do alvo fora da faixa"}.`;
  }
  if (c.meta === null) return "Sem meta definida: o indicador é acompanhado, mas não é classificado.";
  if (c.direcao === "MAIOR_MELHOR") return `Quanto maior, melhor. No alvo: ≥ ${v(c.meta)}${c.alerta !== null ? ` · atenção: ≥ ${v(c.alerta)} · fora do alvo: < ${v(c.alerta)}` : ` · fora do alvo: < ${v(c.meta)}`}.`;
  return `Quanto menor, melhor. No alvo: ≤ ${v(c.meta)}${c.alerta !== null ? ` · atenção: ≤ ${v(c.alerta)} · fora do alvo: > ${v(c.alerta)}` : ` · fora do alvo: > ${v(c.meta)}`}.`;
}
export function metaCurta(c: ConfigIndicador, unidade: string | null): string {
  if (c.direcao === "FAIXA") return c.faixaMin === null || c.faixaMax === null ? "—" : `${fmtValor(c.faixaMin, unidade)} a ${fmtValor(c.faixaMax, unidade)}`;
  if (c.meta === null) return "—";
  return `${c.direcao === "MAIOR_MELHOR" ? "≥" : "≤"} ${fmtValor(c.meta, unidade)}`;
}

/** Minigráfico da série (lacunas sem medição ficam em branco — nunca viram zero). */
export function Sparkline({ valores, w = 96, h = 26 }: { valores: (number | null | undefined)[]; w?: number; h?: number }) {
  const xs = valores.map(v => (v === null || v === undefined || Number.isNaN(v) ? null : v)); const nums = xs.filter((v): v is number => v !== null);
  if (!nums.length) return <span className="text-xs text-slate-400">sem série</span>;
  const min = Math.min(...nums), max = Math.max(...nums); const amp = max - min || 1; const passo = xs.length > 1 ? (w - 6) / (xs.length - 1) : 0;
  const pt = (v: number, i: number) => [3 + i * passo, h - 3 - ((v - min) / amp) * (h - 6)] as const;
  const segs: string[] = []; let cur: string[] = [];
  xs.forEach((v, i) => { if (v === null) { if (cur.length) segs.push(cur.join(" ")); cur = []; } else { const [x, y] = pt(v, i); cur.push(`${x.toFixed(1)},${y.toFixed(1)}`); } }); if (cur.length) segs.push(cur.join(" "));
  const ult = xs.map((v, i) => [v, i] as const).filter(([v]) => v !== null).pop()!; const [lx, ly] = pt(ult[0] as number, ult[1]);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="inline-block align-middle">
      {segs.map((p, i) => p.includes(" ") ? <polyline key={i} points={p} fill="none" stroke="#1e3a5f" strokeWidth="1.5" /> : <circle key={i} cx={p.split(",")[0]} cy={p.split(",")[1]} r="1.5" fill="#1e3a5f" />)}
      <circle cx={lx} cy={ly} r="2.5" fill="#0369a1" />
    </svg>
  );
}

/** Gráfico da série com a meta, o limite de atenção (ou a faixa) e o farol de cada ponto. */
export function GraficoSerie({ periodos, serie, config, unidade }: { periodos: string[]; serie: Record<string, number | null>; config: ConfigIndicador; unidade: string | null }) {
  const W = 640, H = 230, L = 52, R = 30, T = 16, B = 34;
  const vals = periodos.map(p => serie[p] ?? null); const nums = vals.filter((v): v is number => v !== null);
  const refs = [config.meta, config.alerta, config.faixaMin, config.faixaMax].filter((v): v is number => v !== null && !(config.direcao === "FAIXA" && v === config.alerta));
  if (!nums.length) return <p className="py-8 text-center text-sm text-slate-500">Sem medições no período.</p>;
  let min = Math.min(...nums, ...refs), max = Math.max(...nums, ...refs); if (min === max) { min -= 1; max += 1; } const pad = (max - min) * 0.1; min -= pad; max += pad; if (min < 0 && Math.min(...nums, ...refs) >= 0) min = 0;
  const x = (i: number) => L + (periodos.length > 1 ? (i * (W - L - R)) / (periodos.length - 1) : (W - L - R) / 2);
  const y = (v: number) => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => min + t * (max - min));
  const segs: string[] = []; let cur: string[] = [];
  vals.forEach((v, i) => { if (v === null) { if (cur.length) segs.push(cur.join(" ")); cur = []; } else cur.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`); }); if (cur.length) segs.push(cur.join(" "));
  const linha = (v: number | null, cor: string, rotulo: string) => v === null ? null : <g><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={cor} strokeDasharray="5 4" strokeWidth="1.2" /><text x={W - R} y={y(v) - 3} textAnchor="end" fontSize="10" fill={cor}>{rotulo} {fmtNum(v, 2)}</text></g>;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Série do indicador">
      {ticks.map((t, i) => <g key={i}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#e2e8f0" /><text x={L - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#64748b">{fmtNum(t, Math.abs(max - min) < 10 ? 1 : 0)}</text></g>)}
      {config.direcao === "FAIXA" && config.faixaMin !== null && config.faixaMax !== null && <rect x={L} width={W - L - R} y={y(config.faixaMax)} height={Math.max(1, y(config.faixaMin) - y(config.faixaMax))} fill="#16a34a" opacity="0.08" />}
      {config.direcao === "FAIXA" ? <>{linha(config.faixaMin, "#15803d", "mín")}{linha(config.faixaMax, "#15803d", "máx")}</> : <>{linha(config.meta, "#15803d", "meta")}{linha(config.alerta, "#b45309", "atenção")}</>}
      {segs.map((p, i) => p.includes(" ") ? <polyline key={i} points={p} fill="none" stroke="#1e3a5f" strokeWidth="2" /> : null)}
      {vals.map((v, i) => v === null ? null : <g key={i}><circle cx={x(i)} cy={y(v)} r="4" fill={COR_FAROL[farolDe(v, config)]} stroke="#fff" strokeWidth="1.5" /><text x={x(i)} y={y(v) - 8} textAnchor="middle" fontSize="9.5" fill="#334155">{fmtNum(v, 1)}</text></g>)}
      {periodos.map((p, i) => (periodos.length <= 13 || i % 2 === 0) && <text key={p} x={x(i)} y={H - 12} textAnchor="middle" fontSize="10" fill="#64748b">{nomePeriodo(p)}</text>)}
      {unidade && <text x={4} y={T} fontSize="10" fill="#64748b">{unidade}</text>}
    </svg>
  );
}

/** Saúde estratégica explicada: score, faixa e cada componente com o peso efetivo usado. */
export function SaudeDetalhe({ saude, comps, faixas }: { saude: Saude; comps: Componente[]; faixas: [number, number] }) {
  const ef = (c: Componente) => saude.pesoUsado > 0 && c.valor !== null && c.peso > 0 ? (100 * c.peso) / saude.pesoUsado : null;
  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <div className={`text-4xl font-semibold tabular-nums ${corFaixa(saude.score, faixas)}`}>{saude.score === null ? "—" : Math.round(saude.score)}</div>
        <div className="pb-1 text-sm text-slate-600">{saude.faixa ? <>de 100 · <b className={corFaixa(saude.score, faixas)}>{FAIXA_SAUDE[saude.faixa]}</b></> : "sem dados para calcular"}</div>
      </div>
      <div className="mt-2"><Barra p={saude.score} faixas={faixas} /></div>
      <ul className="mt-3 divide-y divide-line text-sm">
        {comps.map(c => <li key={c.chave} className="flex items-start justify-between gap-3 py-1.5">
          <div className="min-w-0"><div className="font-medium text-ink">{c.nome}</div><div className="text-xs text-slate-500">{c.detalhe}</div></div>
          <div className="shrink-0 text-right"><div className={`font-semibold tabular-nums ${corFaixa(c.valor, faixas)}`}>{c.valor === null ? "sem base" : `${Math.round(c.valor)}%`}</div><div className="text-[11px] text-slate-500">peso {c.peso}{ef(c) !== null ? ` → ${fmtNum(ef(c), 0)}% do score` : " · fora do cálculo"}</div></div>
        </li>)}
      </ul>
      <p className="mt-2 text-xs text-slate-500">Média ponderada dos componentes que têm base de cálculo; quem não tem base sai e o peso é redistribuído. Faixas: ≥ {faixas[1]} boa · ≥ {faixas[0]} atenção · abaixo crítica.</p>
    </div>
  );
}
