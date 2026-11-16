import { sql } from "@/db";
import type { Session } from "./auth";
import { scopeUnit } from "./auth";
import * as A from "./assinaturas";
import * as P from "./pesquisas";
import * as K from "./estoque";
import * as C from "./cadastro";
import { STATUS_AJUSTE, TIPO_AJUSTE, filtroAprovaAjuste, podeAtestados, STATUS_ATESTADO } from "./autoatendimento";
import { veHumor, serieHumor } from "./humor";
import { getSettings } from "./utils";
import { cpfMascarado } from "./rematricula";

type Linha = (string | number | null)[];

/**
 * v34 · Exportações (CSV): assinaturas por pessoa (com as evidências), pesquisa interna (identificada: por pessoa; anônima: só o
 * agregado, com o mínimo), estoque, alterações cadastrais (quais campos, nunca os valores), ajustes de ponto, atestados (sem CID)
 * e a série do termômetro (só semanas com o mínimo). CPF sai mascarado. null = tipo desconhecido aqui.
 */
export async function exportarV34(tipo: string, s: Session, url: URL): Promise<Linha[] | null | "negado"> {
  if (tipo === "assinaturas") {
    if (!A.veAssinaturas(s)) return "negado"; const u = scopeUnit(s); const doc = Number(url.searchParams.get("doc")) || null;
    const rs = await sql<{ doc: number; titulo: string; tipo: string; competencia: string | null; nome: string; cpf: string | null; unidade: string; status: string; assinado_em: string | null; recusado_em: string | null; metodo: string | null; ip: string | null; hash_ok: boolean | null; motivo: string | null }[]>`
      SELECT d.id AS doc, d.titulo, d.tipo, d.competencia, e.nome, e.cpf, un.nome AS unidade, r.status, r.assinado_em::text, r.recusado_em::text, r.metodo, r.ip, (r.hash_conferido = d.hash) AS hash_ok, r.motivo
      FROM sign_requests r JOIN sign_documents d ON d.id=r.document_id JOIN employees e ON e.id=r.employee_id JOIN units un ON un.id=e.unit_id WHERE true ${u === null ? sql`` : sql`AND d.unit_id=${u}`} ${doc ? sql`AND d.id=${doc}` : sql``} ORDER BY d.id DESC, e.nome LIMIT 20000`;
    return [["documento_id", "documento", "tipo", "competencia", "pessoa", "cpf", "unidade", "situacao", "assinado_em", "recusado_ou_contestado_em", "metodo", "ip", "hash_confere", "motivo"],
      ...rs.map(r => [r.doc, r.titulo, A.TIPO_ASSINATURA[r.tipo] ?? r.tipo, r.competencia, r.nome, cpfMascarado(r.cpf), r.unidade, A.STATUS_ASSINATURA[r.status] ?? r.status, r.assinado_em, r.recusado_em, r.metodo, r.ip, r.hash_ok === null ? null : r.hash_ok ? "sim" : "NÃO", r.motivo])];
  }
  if (tipo === "pesquisa-interna") {
    if (!P.podePesquisas(s)) return "negado"; const id = Number(url.searchParams.get("id")) || 0;
    const [sv] = await sql<{ titulo: string; identificada: boolean; minimo_anonimato: number; perguntas: P.Pergunta[] }[]>`SELECT titulo, identificada, minimo_anonimato, perguntas FROM custom_surveys WHERE id=${id}`; if (!sv) return null;
    const rs = await sql<{ nome: string | null; unidade: string | null; respondido_em: string | null; respostas: Record<string, unknown> }[]>`SELECT e.nome, u.nome AS unidade, r.respondido_em::text, r.respostas FROM custom_survey_responses r LEFT JOIN employees e ON e.id=r.employee_id LEFT JOIN units u ON u.id=r.unit_id WHERE r.survey_id=${id} ORDER BY e.nome NULLS LAST`;
    const val = (v: unknown) => v === undefined || v === null ? "" : Array.isArray(v) ? v.join(" | ") : String(v);
    if (sv.identificada) return [[`Pesquisa identificada: ${sv.titulo}`], ["pessoa", "unidade", "respondido_em", ...sv.perguntas.map(q => q.texto)], ...rs.map(r => [r.nome, r.unidade, r.respondido_em, ...sv.perguntas.map(q => val(r.respostas[q.id]))])];
    if (rs.length < sv.minimo_anonimato) return [[`Pesquisa anônima: ${sv.titulo}`], [`Resultado disponível com pelo menos ${sv.minimo_anonimato} respostas (hoje: ${rs.length}).`]];
    const ag = P.agregar(sv.perguntas, rs.map(r => r.respostas));
    return [[`Pesquisa anônima: ${sv.titulo} · ${rs.length} respostas · só o agregado`], ["pergunta", "tipo", "respostas", "media", "opcao_ou_nota", "quantidade"],
      ...ag.flatMap(a => a.pergunta.tipo === "ESCALA" ? [1, 2, 3, 4, 5].map(k => [a.pergunta.texto, P.TIPO_PERGUNTA[a.pergunta.tipo], a.n, a.media !== null && a.media !== undefined ? Number(a.media.toFixed(2)) : null, String(k), a.dist![k - 1]] as Linha)
        : a.contagem ? a.contagem.map(([o, n]) => [a.pergunta.texto, P.TIPO_PERGUNTA[a.pergunta.tipo], a.n, null, o, n] as Linha) : [[a.pergunta.texto, P.TIPO_PERGUNTA[a.pergunta.tipo], a.n, null, "(comentários: veja na tela)", a.n] as Linha])];
  }
  if (tipo === "estoque") {
    if (!K.veEstoque(s)) return "negado";
    const ls = await K.saldos(s);
    return [["unidade", "local", "item", "categoria", "unidade_medida", "saldo", "minimo", "abaixo_do_minimo", "proxima_validade", "custo_medio", "valor", "epi"],
      ...ls.map(l => [l.unidade, l.local, l.nome, l.categoria, l.unidade_medida, l.saldo, l.minimo, l.minimo > 0 && l.saldo < l.minimo ? "sim" : "não", l.vence, Number(l.custo_medio.toFixed(4)), Number((l.saldo * l.custo_medio).toFixed(2)), l.epi])];
  }
  if (tipo === "alteracoes-cadastrais") {
    if (!C.podeRevisarCadastro(s)) return "negado";
    const rs = await sql<{ protocolo: string; nome: string; tipo: string; origem: string; status: string; campos: C.MudancaCampo[]; dependentes: C.DependentePedido[]; created_at: string; decidido_nome: string | null; decidido_em: string | null }[]>`SELECT r.protocolo, e.nome, r.tipo, r.origem, r.status, r.campos, r.dependentes, r.created_at::text, r.decidido_nome, r.decidido_em::text FROM employee_change_requests r JOIN employees e ON e.id=r.employee_id ORDER BY r.created_at DESC LIMIT 5000`;
    return [["protocolo", "pessoa", "tipo", "origem", "situacao", "campos_pedidos", "campos_aplicados", "dependentes", "enviado_em", "decidido_por", "decidido_em"],
      ...rs.map(r => [r.protocolo, r.nome, C.TIPO_PEDIDO[r.tipo] ?? r.tipo, C.ORIGEM[r.origem] ?? r.origem, C.STATUS_PEDIDO[r.status] ?? r.status, r.campos.map(c => c.rotulo).join(" | "), r.campos.filter(c => c.decisao === "APROVADO").map(c => c.rotulo).join(" | "), r.dependentes.map(d => `${d.acao === "INCLUIR" ? "incluir" : "excluir"} ${d.parentesco.toLowerCase()}${d.decisao ? ` (${d.decisao === "APROVADO" ? "feito" : "recusado"})` : ""}`).join(" | "), r.created_at, r.decidido_nome, r.decidido_em])];
  }
  if (tipo === "ajustes-ponto") {
    if (!["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role)) return "negado";
    const rs = await sql<{ nome: string; unidade: string; data: string; tipo: string; marcacoes: string; status: string; aprovado_nome: string | null; ajustado_nome: string | null; created_at: string }[]>`SELECT e.nome, u.nome AS unidade, r.data::text, r.tipo, r.marcacoes, r.status, r.aprovado_nome, r.ajustado_nome, r.created_at::text FROM timesheet_adjust_requests r JOIN employees e ON e.id=r.employee_id JOIN units u ON u.id=e.unit_id WHERE ${filtroAprovaAjuste(s)} ORDER BY r.created_at DESC LIMIT 5000`;
    return [["pessoa", "unidade", "dia", "motivo", "marcacoes_pedidas", "situacao", "aprovado_por", "lancado_por", "pedido_em"], ...rs.map(r => [r.nome, r.unidade, r.data, TIPO_AJUSTE[r.tipo] ?? r.tipo, r.marcacoes, STATUS_AJUSTE[r.status] ?? r.status, r.aprovado_nome, r.ajustado_nome, r.created_at])];
  }
  if (tipo === "atestados") {
    if (!podeAtestados(s)) return "negado";
    const rs = await sql<{ nome: string; unidade: string; tipo: string; inicio: string; fim: string; dias: number | null; horas: string | null; status: string; decidido_nome: string | null; created_at: string }[]>`SELECT e.nome, u.nome AS unidade, m.tipo, m.inicio::text, m.fim::text, m.dias, m.horas, m.status, m.decidido_nome, m.created_at::text FROM medical_certificates m JOIN employees e ON e.id=m.employee_id JOIN units u ON u.id=e.unit_id ORDER BY m.created_at DESC LIMIT 5000`;
    return [["pessoa", "unidade", "tipo", "inicio", "fim", "dias", "horario", "situacao", "decidido_por", "enviado_em"], ...rs.map(r => [r.nome, r.unidade, r.tipo === "DIAS" ? "dias" : "comparecimento", r.inicio, r.fim, r.dias, r.horas, STATUS_ATESTADO[r.status] ?? r.status, r.decidido_nome, r.created_at])];
  }
  if (tipo === "humor") {
    if (!veHumor(s)) return "negado"; const cfg = await getSettings();
    const serie = await serieHumor(s, 52, Number(cfg.termometro.minimoGrupo));
    return [["semana", "respostas", "media_1_a_5 (só unidades com o mínimo)"], ...serie.map(x => [x.semana, x.n, x.media !== null ? Number(x.media.toFixed(2)) : null])];
  }
  return null;
}
