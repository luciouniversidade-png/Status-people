import type { Session } from "./auth";
import * as F from "./fornecedores";

type Linha = (string | number | null)[];

/**
 * v33 · Exportação do cadastro de fornecedores (CSV): situação, criticidade, risco calculado e revisado, completude, documentos,
 * homologação e — só para quem vê o financeiro — despesa líquida e concentração. CPF de pessoa física sai mascarado e dados bancários
 * nunca saem (só “conta conferida em uso: sim/não”). null = tipo desconhecido aqui.
 */
export async function exportarV33(tipo: string, s: Session): Promise<Linha[] | null | "negado"> {
  if (tipo !== "fornecedores") return null;
  if (!F.veFornecedores(s)) return "negado";
  const cfg = await F.cfgForn(); const lista = await F.carregarLista(cfg); const fin = F.podeVerFinanceiro(s);
  const n1 = (v: number) => Math.round(v * 10) / 10;
  return [
    ["id", "nome", "razao_social", "documento", "tipo", "categoria", "criticidade", "situacao", "abrangencia", "unidades_autorizadas", "responsavel", "situacao_cadastral", "consultada_em",
      "risco_calculado", "pontos_risco", "fatores_risco", "risco_revisado", "completude_pct", "faltando", "documentos_exigiveis", "documentos_em_dia", "documentos_vencidos", "revalidar_ate", "restricoes",
      "ultima_nota", "ocorrencias_abertas", "contratos_vigentes", "conta_conferida_em_uso", "alteracao_bancaria_aberta", "homologacao_em_andamento", ...(fin ? ["despesa_liquida_12m", "concentracao_pct"] : []), "origem", "cadastrado_em"],
    ...lista.map(l => {
      const ex = l.checklist.filter(c => c.exigivel);
      return [l.id, l.nome, l.razao_social, l.documento && l.tipo_doc ? F.fmtDocumento(l.tipo_doc, l.documento) : null, F.TIPOS_FORN[l.tipo] ?? l.tipo, l.categoria, F.CRITICIDADE[l.criticidade] ?? l.criticidade,
        F.STATUS_FORN[l.status] ?? l.status, l.abrangencia === "REDE" ? "rede" : "unidades", l.unidades.length, l.responsavel, F.SITUACOES_CADASTRAIS[l.situacao] ?? l.situacao, l.situacao_em,
        F.RISCO_ROTULO[l.risco.nivel], l.risco.pontos, l.risco.fatores.map(x => `${x.texto} (+${x.pontos})`).join(" | "), l.risco_revisado ? F.RISCO_ROTULO[l.risco_revisado] : null, l.completude.pct, l.completude.faltando.join(" | "),
        ex.length, ex.filter(c => ["OK", "VENCENDO"].includes(c.situacao)).length, ex.filter(c => c.situacao === "VENCIDO").length, l.revalidar_em, l.restricoes,
        l.ultimaNota, l.ocorrenciasAbertas, l.contratosVigentes, l.contaEmUso ? "sim" : "não", l.bancoAberto ? "sim" : "não", l.homologacaoAberta ? "sim" : "não",
        ...(fin ? [Math.round(l.gasto12m * 100) / 100, n1(l.concentracaoPct)] : []), F.ORIGENS[l.origem] ?? l.origem, l.created_at?.slice(0, 10) ?? null];
    }),
  ];
}
