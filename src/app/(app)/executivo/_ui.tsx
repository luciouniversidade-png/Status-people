import Link from "@/components/Link";
import type { ReactNode } from "react";
import { KpiCard, Linhas, Colunas, Rosca, Situacao, COR, COR_TOM, type DeltaCartao, type Tom } from "@/components/graficos";
import { fmtKpi, fmtEixo, variacao, rotuloMes, fmtPct } from "@/lib/formato";
import { TOM_FAROL, type VisaoKpi, type Frase } from "@/lib/kpi-catalogo";
import { FAROL_LABEL } from "@/lib/gestao-calc";

/** Componentes do Painel Executivo (v23) — servidor, sem JavaScript no navegador. */

export const fmtV = (v: VisaoKpi, x: number | null | undefined, compacto = true) => fmtKpi(x ?? null, v.def.unidade, compacto);
const bomDe = (v: VisaoKpi, delta: number) => v.def.sentido === "NEUTRO" ? null : v.def.sentido === "SUBIR" ? delta > 0 : delta < 0;

export function deltasDe(v: VisaoKpi): DeltaCartao[] {
  const out: DeltaCartao[] = []; const k = v.def;
  const dm = variacao(v.valor, v.anterior, k.unidade);
  if (dm) out.push({ texto: dm.texto, rotulo: k.historico === "EVENTO" ? "vs. medição anterior" : "vs. mês anterior", bom: dm.sentido === 0 ? null : bomDe(v, dm.abs) });
  if (k.agregacao === "SOMA") { const da = variacao(v.acumulado, v.acumuladoAnoAnterior, k.unidade); if (da) out.push({ texto: da.texto, rotulo: `no ano vs. ${Number(v.periodo.slice(0, 4)) - 1}`, bom: da.sentido === 0 ? null : bomDe(v, da.abs) }); }
  else if (k.historico !== "EVENTO") { const da = variacao(v.valor, v.anoAnterior, k.unidade); if (da) out.push({ texto: da.texto, rotulo: `vs. ${rotuloMes(`${Number(v.periodo.slice(0, 4)) - 1}-${v.periodo.slice(5)}`)}`, bom: da.sentido === 0 ? null : bomDe(v, da.abs) }); }
  return out;
}

export function metaTexto(v: VisaoKpi): { texto: string; tom: Tom } | null {
  if (v.meta === null) return null; const tom = TOM_FAROL[v.farol]; const k = v.def;
  if (v.periodicidade === "ANUAL") {
    const mes = Number(v.periodo.slice(5, 7)); const pct = v.acumulado !== null && v.meta ? Math.round(100 * v.acumulado / v.meta) : null;
    return { tom, texto: `Meta anual ${fmtV(v, v.meta)} · ${pct === null ? "sem acumulado" : `${pct}% feito`} (esperado ${Math.round(100 * mes / 12)}%)` };
  }
  if (v.metaFonte === "ORCAMENTO") { const pct = v.valor !== null && v.meta ? Math.round(100 * v.valor / v.meta) : null; return { tom, texto: `Orçado ${fmtV(v, v.meta)}${pct === null ? "" : ` · ${pct}% do orçado`}` }; }
  return { tom, texto: `Meta ${k.sentido === "DESCER" ? "≤" : k.sentido === "SUBIR" ? "≥" : ""} ${fmtV(v, v.meta)}${v.metaFonte === "PADRAO" ? " (padrão)" : ""} · ${FAROL_LABEL[v.farol]}` };
}

export function CartaoKpi({ v, href }: { v: VisaoKpi; href: string }) {
  const sub = v.medidoEm && v.medidoEm !== v.periodo ? `medido em ${rotuloMes(v.medidoEm)}` : v.def.agregacao === "SOMA" && v.acumulado !== null ? `no ano: ${fmtV(v, v.acumulado)}` : undefined;
  return <KpiCard titulo={v.nome} valor={fmtV(v, v.valor)} sub={sub} deltas={deltasDe(v)} meta={metaTexto(v)} serie={v.serie.slice(-12).map(p => p.valor)} tom={TOM_FAROL[v.farol]} href={href} ajuda={v.def.formula} />;
}

/** Gráfico padrão de um indicador: colunas para fluxos (12 meses + linha do ano anterior), linha para razões e retratos (24 meses + meta). */
export function GraficoKpi({ v, tamanho = "meio", altura }: { v: VisaoKpi; tamanho?: "meio" | "inteiro"; altura?: number }) {
  const k = v.def; const eixo = fmtEixo(k.unidade); const dica = (x: number) => fmtKpi(x, k.unidade);
  const metaFixa = v.meta !== null && v.periodicidade === "MENSAL" && v.metaFonte !== "ORCAMENTO" ? v.meta : null;
  if (k.agregacao === "SOMA") {
    const ult = v.serie.slice(-12); const ant = v.serie.slice(-24, -12);
    return <Colunas categorias={ult.map(p => rotuloMes(p.periodo))} series={[{ nome: v.nome, valores: ult.map(p => p.valor), cor: COR.acao }]} linhas={ant.length === 12 && ant.some(p => p.valor !== null) ? [{ nome: "Mesmo mês do ano anterior", valores: ant.map(p => p.valor), cor: COR.neutro, tracejada: true }] : []}
      marcadores={metaFixa !== null ? { nome: "Meta", valores: ult.map(() => metaFixa), cor: COR.meta } : null} formato={eixo} formatoDica={dica} tamanho={tamanho} altura={altura} rotulo={`${v.nome} nos últimos 12 meses`} />;
  }
  const notas: { indice: number; texto: string }[] = [];
  return <Linhas categorias={v.serie.map(p => rotuloMes(p.periodo))} series={[{ nome: v.nome, valores: v.serie.map(p => p.valor), cor: COR.acao, area: k.agregacao === "ESTOQUE" }]} meta={metaFixa !== null ? { valor: metaFixa, rotulo: "meta" } : null}
    notas={notas} formato={eixo} formatoDica={dica} tamanho={tamanho} altura={altura} zero={k.agregacao === "ESTOQUE" && k.unidade !== "R$"} rotulo={`${v.nome} — ${v.serie.length} meses`} />;
}

export function Leitura({ frases, vazio }: { frases: Frase[]; vazio?: string }) {
  if (!frases.length) return <p className="text-sm text-slate-500">{vazio ?? "Nenhum movimento relevante: os indicadores seguem dentro do normal."}</p>;
  return (
    <ul className="space-y-2">
      {frases.map((f, i) => <li key={i} className="flex gap-2 text-sm leading-snug"><span aria-hidden className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: COR_TOM[f.tom] }} /><span className="min-w-0">{f.texto}</span></li>)}
    </ul>
  );
}

export function ResumoSituacao({ visoes, href }: { visoes: VisaoKpi[]; href: (chave: string) => string }) {
  const n = (f: string) => visoes.filter(v => v.farol === f).length;
  const fora = visoes.filter(v => v.farol === "VERMELHO"); const atencao = visoes.filter(v => v.farol === "AMARELO");
  return (
    <div className="space-y-3">
      <Rosca rotulo="Situação dos indicadores com meta" fatias={[{ rotulo: "No alvo", valor: n("VERDE"), cor: COR.ok }, { rotulo: "Atenção", valor: n("AMARELO"), cor: COR.aviso }, { rotulo: "Fora do alvo", valor: n("VERMELHO"), cor: COR.erro }, { rotulo: "Sem meta", valor: n("SEM_META"), cor: "#cbd5e1" }, { rotulo: "Sem medição", valor: n("SEM_DADO"), cor: "#e2e8f0" }]} centro={{ valor: String(visoes.length), rotulo: "indicadores" }} tamanho={130} />
      {[...fora, ...atencao].length > 0 && <ul className="space-y-1 text-xs sm:text-sm">{[...fora, ...atencao].slice(0, 6).map(v => <li key={v.def.chave} className="flex items-center justify-between gap-2"><Link href={href(v.def.chave)} className="min-w-0 truncate text-acao hover:underline">{v.nome}</Link><Situacao tom={TOM_FAROL[v.farol]} texto={fmtV(v, v.valor)} /></li>)}</ul>}
    </div>
  );
}

export function Abas({ itens, atual }: { itens: { chave: string; rotulo: string; href: string }[]; atual: string }) {
  return (
    <nav aria-label="Áreas do painel" className="mb-4 flex gap-1 overflow-x-auto border-b border-line print:hidden [-webkit-overflow-scrolling:touch]">
      {itens.map(a => <Link key={a.chave} href={a.href} aria-current={a.chave === atual ? "page" : undefined} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${a.chave === atual ? "border-acao font-semibold text-navy" : "border-transparent text-slate-600 hover:text-navy"}`}>{a.rotulo}</Link>)}
    </nav>
  );
}

export function TabelaKpis({ visoes, href }: { visoes: VisaoKpi[]; href: (chave: string) => string }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-white [-webkit-overflow-scrolling:touch]">
      <table className="w-full text-left text-xs sm:text-sm">
        <thead className="bg-mist text-xs text-slate-600"><tr>{["Indicador", "Valor", "Mês anterior", "Ano anterior", "Acumulado no ano", "Meta", "Situação"].map((h, i) => <th key={h} className={`whitespace-nowrap px-2 py-2 font-medium sm:px-3 ${i === 0 ? "sticky left-0 z-[1] bg-mist" : ""}`}>{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">
          {visoes.map(v => { const dm = variacao(v.valor, v.anterior, v.def.unidade); const da = variacao(v.valor, v.anoAnterior, v.def.unidade); return (
            <tr key={v.def.chave}>
              <th scope="row" className="sticky left-0 z-[1] bg-white px-2 py-2 text-left font-medium sm:px-3"><Link className="text-acao hover:underline" href={href(v.def.chave)}>{v.nome}</Link></th>
              <td className="whitespace-nowrap px-2 py-2 tabular-nums sm:px-3">{fmtV(v, v.valor, false)}{v.medidoEm && v.medidoEm !== v.periodo ? <span className="text-[11px] text-slate-500"> ({rotuloMes(v.medidoEm)})</span> : null}</td>
              <td className="whitespace-nowrap px-2 py-2 tabular-nums sm:px-3">{fmtV(v, v.anterior)}{dm && <span className={`ml-1 text-[11px] ${dm.sentido === 0 || v.def.sentido === "NEUTRO" ? "text-slate-500" : bomDe(v, dm.abs) ? "text-ok" : "text-erro"}`}>{dm.texto}</span>}</td>
              <td className="whitespace-nowrap px-2 py-2 tabular-nums sm:px-3">{fmtV(v, v.anoAnterior)}{da && <span className={`ml-1 text-[11px] ${da.sentido === 0 || v.def.sentido === "NEUTRO" ? "text-slate-500" : bomDe(v, da.abs) ? "text-ok" : "text-erro"}`}>{da.texto}</span>}</td>
              <td className="whitespace-nowrap px-2 py-2 tabular-nums sm:px-3">{fmtV(v, v.acumulado)}</td>
              <td className="whitespace-nowrap px-2 py-2 tabular-nums sm:px-3">{v.meta === null ? "—" : `${v.periodicidade === "ANUAL" ? "ano: " : v.metaFonte === "ORCAMENTO" ? "orçado: " : ""}${fmtV(v, v.meta)}`}</td>
              <td className="whitespace-nowrap px-2 py-2 sm:px-3"><Situacao tom={TOM_FAROL[v.farol]} texto={FAROL_LABEL[v.farol]} /></td>
            </tr>); })}
        </tbody>
      </table>
    </div>
  );
}

export function GradeCartoes({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{children}</div>;
}

export const pctTexto = (v: number | null) => fmtPct(v, 0);
