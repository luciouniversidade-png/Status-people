import { sql } from "@/db";
import type { Session } from "./auth";
import { hoje, addDays } from "./utils";
import { listarContas, vePlano, usoDasContas } from "./plano-contas";
import { ehAnalitica, macrogrupo, ROTULO_ECONOMICO, ROTULO_COMPORTAMENTO, ROTULO_RECORRENCIA, ROTULO_INDICE, ROTULO_DRIVER } from "./plano-contas-calc";
import { resultadoComRateio } from "./rateio";
import { ROTULO_BASE } from "./rateio-calc";
import { orcamentoPeloHistorico, anoPadrao } from "./orcamento-historico";
import { VERSOES, ROTULO_VERSAO, addMes, type Versao } from "./orcamento-historico-calc";

type Linha = (string | number | null)[];
const n2 = (v: number | null | undefined) => v === null || v === undefined ? null : Math.round(v * 100) / 100;
const dataOk = (d: string | null) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);

/** Exportações da v28 (plano de contas, lançamentos classificados, resultado com rateio, orçamento pelo histórico). null = tipo desconhecido aqui. */
export async function exportarV28(tipo: string, s: Session, u: number | null, url: URL): Promise<Linha[] | null | "negado"> {
  if (!["plano-de-contas", "lancamentos-classificados", "resultado-rateio", "orcamento-historico"].includes(tipo)) return null;
  if (!vePlano(s)) return "negado";
  const pedida = Number(url.searchParams.get("unidade")) || null; const unitId = u ?? pedida; const unitIds = unitId ? [unitId] : null;
  if (tipo === "plano-de-contas") {
    const [contas, uso] = await Promise.all([listarContas(), usoDasContas(unitIds)]); const porId = new Map(contas.map(c => [c.id, c]));
    return [["codigo", "conta", "nivel", "analitica", "tipo", "macrogrupo", "categoria_ponte", "tipo_economico", "comportamento", "recorrencia", "controlavel", "custo", "indice_reajuste", "varia_com", "centro_padrao", "generica", "ativa", "palavras_chave", "lancamentos_12m", "valor_12m", "titulos_contas_a_pagar"],
      ...contas.map(c => { const an = ehAnalitica(c, contas); const x = uso.caixa.get(c.id);
        return [c.codigo, c.nome, c.nivel, an ? "sim" : "não", c.tipo === "ENTRADA" ? "receita" : "despesa", macrogrupo(c, porId).nome, an ? c.categoria : null, an ? ROTULO_ECONOMICO[c.tipo_economico] ?? c.tipo_economico : null, an ? ROTULO_COMPORTAMENTO[c.comportamento] : null,
          an ? ROTULO_RECORRENCIA[c.recorrencia] : null, an ? (c.controlavel ? "sim" : "não") : null, an ? (c.custo === "DIRETO" ? "direto" : "indireto") : null, an ? ROTULO_INDICE[c.indice] : null, an ? ROTULO_DRIVER[c.driver] : null, an ? (c.centro_padrao === "CORPORATIVO" ? "corporativo" : "unidade") : null,
          c.generica ? "sim" : "não", c.ativo ? "sim" : "não", c.palavras, x?.n ?? 0, n2(x?.v ?? 0), uso.cp.get(c.id) ?? 0]; })];
  }
  if (tipo === "lancamentos-classificados") {
    const de = dataOk(url.searchParams.get("de")) ? url.searchParams.get("de")! : addDays(hoje(), -365); const ate = dataOk(url.searchParams.get("ate")) ? url.searchParams.get("ate")! : hoje();
    const contas = await listarContas(); const porId = new Map(contas.map(c => [c.id, c]));
    const r = await sql<{ id: number; data: string; unidade: string; tipo: string; categoria: string; descricao: string | null; contraparte: string | null; valor: number; conta_id: number | null; centro: string | null; centro_unidade: string | null; origem: string | null; classificado_em: string | null }[]>`
      SELECT c.id, c.data::text, u.nome AS unidade, c.tipo, c.categoria, c.descricao, c.contraparte, c.valor::float, c.conta_id, cc.codigo || ' · ' || cc.nome AS centro, cu.nome AS centro_unidade, c.classificacao_origem AS origem, c.classificado_em::text
      FROM cash_entries c JOIN units u ON u.id=c.unit_id LEFT JOIN cost_centers cc ON cc.id=c.cost_center_id LEFT JOIN units cu ON cu.id=cc.unit_id
      WHERE c.data >= ${de}::date AND c.data <= ${ate}::date ${unitIds ? sql`AND c.unit_id = ANY(${unitIds}::int[])` : sql``} ORDER BY c.data, c.id LIMIT 50000`;
    return [[`Lançamentos de caixa de ${de.split("-").reverse().join("/")} a ${ate.split("-").reverse().join("/")} com a classificação gerencial (conta, macrogrupo, centro de custo e unidade beneficiária)`],
      ["lancamento", "data", "unidade_pagadora", "tipo", "categoria", "conta", "macrogrupo", "tipo_economico", "custo", "centro_custo", "unidade_beneficiaria", "contraparte", "descricao", "valor", "classificacao", "classificado_em"],
      ...r.map(x => { const c = x.conta_id ? porId.get(x.conta_id) : undefined;
        return [x.id, x.data, x.unidade, x.tipo === "ENTRADA" ? "entrada" : x.tipo === "SAIDA" ? "saída" : "transferência", x.categoria, c ? `${c.codigo} ${c.nome}` : null, c ? macrogrupo(c, porId).nome : null, c ? ROTULO_ECONOMICO[c.tipo_economico] ?? c.tipo_economico : null, c ? (c.custo === "DIRETO" ? "direto" : "indireto") : null,
          x.centro, x.centro_unidade ?? (x.centro ? "rede (corporativo)" : x.unidade), x.contraparte, x.descricao, n2(x.valor), x.origem ? x.origem.toLowerCase() : "sem conta", x.classificado_em]; })];
  }
  if (tipo === "resultado-rateio") {
    const per = url.searchParams.get("periodo"); const periodo = per && /^\d{4}-\d{2}$/.test(per) ? per : addMes(hoje().slice(0, 7), -1); const visao = url.searchParams.get("visao") === "mes" ? "mes" : "acumulado";
    const r = await resultadoComRateio(periodo, visao); const linhas = r.linhas.filter(l => unitId === null || l.unitId === unitId);
    const recorte = visao === "mes" ? periodo.split("-").reverse().join("/") : `jan a ${periodo.split("-").reverse().join("/")}`;
    return [[`Resultado por unidade com rateio do corporativo — ${recorte} — regime de caixa; regra: ${r.regra ? `${r.regra.nome} (${ROTULO_BASE[r.base]}, desde ${r.regra.desde.split("-").reverse().join("/")})` : `provisória por ${ROTULO_BASE[r.base].toLowerCase()} (sem regra aprovada)`}`],
      ["unidade", "alunos_atuais", "receita", "custos_diretos", "custos_indiretos", "nao_classificados", "resultado_antes_rateio", `base_${r.base.toLowerCase()}`, "participacao_pct", "rateio_corporativo", "resultado_depois_rateio", "margem_pct", "custo_aluno_mes_total", "custo_aluno_mes_direto", "custo_aluno_mes_indireto", "custo_aluno_mes_rateio"],
      ...linhas.map(l => [l.nome, l.alunos, n2(l.receita), n2(l.diretos), n2(l.indiretos), n2(l.naoClassificados), n2(l.antes), n2(r.valores.get(l.unitId) ?? 0), n2(100 * l.pctRateio), n2(l.rateio), n2(l.depois), n2(l.margem), n2(l.custoAluno.total), n2(l.custoAluno.direto), n2(l.custoAluno.indireto), n2(l.custoAluno.rateio)]),
      ...(unitId === null ? [["Rede", r.rede.alunos, n2(r.rede.receita), n2(r.rede.diretos), n2(r.rede.indiretos), n2(r.rede.naoClassificados), n2(r.rede.antes), null, 100, n2(r.rede.rateio), n2(r.rede.depois), n2(r.rede.margem), n2(r.rede.custoAlunoMes), null, null, null] as Linha] : [])];
  }
  // orcamento-historico: a memória do cálculo por unidade × conta (base, higienização, preços, volume, piso e os 12 meses)
  const a = Number(url.searchParams.get("ano")); const ano = a >= 2020 && a <= 2100 ? a : anoPadrao(); const v = (VERSOES as string[]).includes(url.searchParams.get("versao") ?? "") ? url.searchParams.get("versao") as Versao : "BASE";
  const r = await orcamentoPeloHistorico(ano, unitIds); const porId = new Map(r.contasAll.map(c => [c.id, c])); const nome = new Map(r.unidades.map(x => [x.id, x.nome]));
  const ls = [...r.versoes[v].linhas].sort((x, y) => (nome.get(x.unit_id) ?? "").localeCompare(nome.get(y.unit_id) ?? "") || x.tipo.localeCompare(y.tipo) || (porId.get(x.conta_id ?? 0)?.codigo ?? `~${x.categoria}`).localeCompare(porId.get(y.conta_id ?? 0)?.codigo ?? `~${y.categoria}`, "pt-BR", { numeric: true }));
  const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return [[`Orçamento ${ano} pelo histórico — versão ${ROTULO_VERSAO[v].toLowerCase()} — base ${r.meses[0].split("-").reverse().join("/")} a ${r.meses[11].split("-").reverse().join("/")} — regime de caixa, por unidade pagadora`],
    ["unidade", "tipo", "macrogrupo", "conta", "categoria", "indice_reajuste", "varia_com", "base_bruta", "higienizado", "normalizado", "base_limpa", "a_precos_de_hoje", "reajuste_medio_pct", "volume_fator", "piso_contratos", ...MES.map(m => `${m}_${ano}`), `total_${ano}`, "var_vs_base_pct", "avisos", "origem_do_piso"],
    ...ls.map(l => { const c = l.conta_id ? porId.get(l.conta_id) : undefined; const comPreco = l.nivelado * l.fatorPreco;
      return [nome.get(l.unit_id) ?? l.unit_id, l.tipo === "ENTRADA" ? "receita" : "despesa", c ? macrogrupo(c, porId).nome : "sem conta", c ? `${c.codigo} ${c.nome}` : null, l.categoria, ROTULO_INDICE[l.attr.indice] ?? l.attr.indice, ROTULO_DRIVER[l.attr.driver] ?? l.attr.driver,
        n2(l.bruto), n2(l.removido), n2(l.normalizado), n2(l.limpo), n2(l.nivelado), l.nivelado > 0 ? n2(100 * (l.fatorPreco - 1)) : null, comPreco > 0 ? Math.round(((l.total - l.acrescimoPiso) / comPreco) * 1000) / 1000 : null, n2(l.acrescimoPiso),
        ...l.meses.map(n2), n2(l.total), l.limpo > 0 ? n2((100 * (l.total - l.limpo)) / l.limpo) : null, l.avisos.join(" | ") || null, l.piso?.origem.join(" | ") || null] as Linha; })];
}
