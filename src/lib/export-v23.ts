import { sql } from "@/db";
import type { Session } from "./auth";
import { garantirKpis, kpisVisiveis, visoes, vePainelExecutivo, periodoPadrao, periodoValido, KPI } from "./kpi";
import { AREAS, porUnidade } from "./kpi-catalogo";
import { FAROL_LABEL } from "./gestao-calc";
import { hoje } from "./utils";
import { fpa } from "./fpa";
import { FLUXOS, ORDEM_FLUXOS, SITUACAO_LABEL, fluxosVisiveis, veFluxos, instancias, resumir, contexto, type Fluxo } from "./fluxos";
import { addDays } from "./utils";

type Linha = (string | number | null)[];
const n = (v: number | null | undefined) => v === null || v === undefined ? null : Math.round(v * 100) / 100;

/** Exportações da v23 (null = tipo desconhecido aqui; "negado" = sem permissão). Só números agregados, no escopo do perfil. */
export async function exportarV23(tipo: string, s: Session, u: number | null, url: URL): Promise<Linha[] | null | "negado"> {
  // "painel": indicadores do Painel Executivo (o tipo "indicadores" é o cadastro da Gestão estratégica)
  if (tipo === "painel") {
    if (!vePainelExecutivo(s)) return "negado";
    await garantirKpis().catch(() => null);
    const h = hoje(); const p = url.searchParams.get("periodo"); const periodo = periodoValido(p, h) ? p! : periodoPadrao(h);
    const pedido = Number(url.searchParams.get("unidade") ?? 0) || 0; const [ok] = pedido ? await sql`SELECT 1 FROM units WHERE id=${pedido}` : [true];
    const unitId = u ?? (ok ? pedido : 0);
    const defs = await kpisVisiveis(s); const vs = await visoes(defs, periodo, unitId);
    const [un] = unitId ? await sql<{ nome: string }[]>`SELECT nome FROM units WHERE id=${unitId}` : [{ nome: "Rede" }];
    return [["area", "indicador", "chave", "unidade_de_medida", "escopo", "periodo", "valor", "medido_em", "mes_anterior", "mesmo_mes_ano_anterior", "acumulado_no_ano", "acumulado_ano_anterior", "meta", "meta_origem", "meta_periodicidade", "situacao", "formula", "fonte"],
      ...vs.map(v => [AREAS[v.def.area].nome, v.nome, v.def.chave, v.def.unidade, un?.nome ?? "", periodo, n(v.valor), v.medidoEm, n(v.anterior), n(v.anoAnterior), n(v.acumulado), n(v.acumuladoAnoAnterior), n(v.meta), v.metaFonte === "CADASTRADA" ? "definida pela gestão" : v.metaFonte === "ORCAMENTO" ? "orçamento" : v.metaFonte === "PADRAO" ? "padrão" : "", v.meta === null ? "" : v.periodicidade === "ANUAL" ? "anual" : "mensal", FAROL_LABEL[v.farol], v.def.formula, v.def.fonte])];
  }
  if (tipo === "indicador") {
    if (!vePainelExecutivo(s)) return "negado";
    const k = KPI[url.searchParams.get("chave") ?? ""]; if (!k) return null;
    const defs = await kpisVisiveis(s); if (!defs.some(d => d.chave === k.chave)) return "negado";
    await garantirKpis().catch(() => null);
    const pedido = Number(url.searchParams.get("unidade") ?? 0) || 0; const unitId = u ?? (porUnidade(k) ? pedido : 0);
    const rows = await sql<{ periodo: string; valor: number | null; num: number | null; den: number | null; origem: string }[]>`SELECT periodo, valor::float, num::float, den::float, origem FROM kpi_series WHERE chave=${k.chave} AND unit_id=${unitId} ORDER BY periodo`;
    const [un] = unitId ? await sql<{ nome: string }[]>`SELECT nome FROM units WHERE id=${unitId}` : [{ nome: "Rede" }];
    return [["indicador", "chave", "escopo", "periodo", "valor", "numerador", "denominador", "origem"], ...rows.map(r => [k.nome, k.chave, un?.nome ?? "", r.periodo, n(r.valor), n(r.num), n(r.den), r.origem === "RETRATO" ? "foto do mês" : "calculado dos registros"])];
  }
  if (tipo === "fpa") {
    if (!["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE", "RH"].includes(s.role)) return "negado";
    const h = hoje(); const ano = Number(url.searchParams.get("ano")) || Number(h.slice(0, 4)); const mes = Math.min(12, Math.max(1, Number(url.searchParams.get("mes")) || Number(h.slice(5, 7))));
    const pedido = Number(url.searchParams.get("unidade") ?? 0) || null; const unitId = u ?? pedido;
    const f = await fpa(ano, unitId, mes);
    return [["ano", "mes_referencia", "tipo", "categoria", "orcado_mes", "realizado_mes", "desvio_mes", "orcado_acumulado", "realizado_acumulado", "desvio_acumulado", "realizado_ano_anterior_acumulado", "previsao_fechamento", "orcado_no_ano", "explicacoes"],
      ...f.linhas.map(l => [ano, mes, l.tipo === "ENTRADA" ? "receita" : "despesa", l.categoria, n(l.orcMes), n(l.realMes), l.orcMes !== null && l.realMes !== null ? n(l.realMes - l.orcMes) : null, n(l.orcAcum), n(l.realAcum), l.orcAcum !== null && l.realAcum !== null ? n(l.realAcum - l.orcAcum) : null, n(l.antAcum), n(l.previsao), n(l.orcAno), l.comentarios]),
      [ano, mes, "resultado", "Resultado", n(f.resultado.orcMes), n(f.resultado.realMes), null, n(f.resultado.orcAcum), n(f.resultado.realAcum), null, n(f.resultado.antAcum), n(f.resultado.previsao), n(f.resultado.orcAno), null]];
  }
  if (tipo === "fluxos") {
    if (!veFluxos(s)) return "negado";
    const ctx = await contexto(s); const visiveis = await fluxosVisiveis(s); if (!visiveis.length) return "negado";
    const f = url.searchParams.get("fluxo"); const fluxo = f && visiveis.includes(f as Fluxo) ? [f as Fluxo] : visiveis;
    const d = [30, 90, 180, 365].includes(Number(url.searchParams.get("dias"))) ? Number(url.searchParams.get("dias")) : 90;
    const pedido = Number(url.searchParams.get("unidade") ?? 0) || null; const [ok] = pedido ? await sql`SELECT 1 FROM units WHERE id=${pedido}` : [null];
    const unitId = u ?? (ok ? pedido : null);
    const insts = await instancias(fluxo, unitId, addDays(ctx.hoje, -d)); const agora = Date.now(); const R = resumir(insts, agora, ctx.riscoPct);
    const dia = (ms: number | null) => ms === null ? null : new Date(ms - 4 * 3600000).toISOString().slice(0, 10);
    const ordem = [...insts].sort((a, b) => ORDEM_FLUXOS.indexOf(a.fluxo) - ORDEM_FLUXOS.indexOf(b.fluxo) || (a.prazo ?? Infinity) - (b.prazo ?? Infinity));
    return [["processo", "id", "item", "tipo_ou_grupo", "unidade", "etapa", "responsavel", "aberto_em", "prazo", "concluido_em", "situacao", "dias_de_atraso"],
      ...ordem.map(i => { const st = R.situacoes.get(i)!; const ref = i.concluido ?? agora; const atraso = i.prazo !== null && ref > i.prazo ? Math.ceil((ref - i.prazo) / 86400000) : null; return [FLUXOS[i.fluxo].nome, i.id, i.titulo, i.grupo ?? null, i.unidade ?? "Rede", i.etapa, i.responsavel, dia(i.aberto), dia(i.prazo), dia(i.concluido), SITUACAO_LABEL[st], atraso]; })];
  }
  return null;
}
