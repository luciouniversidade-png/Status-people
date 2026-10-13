import { sql } from "@/db";
import type { Session } from "./auth";
import { can } from "./auth";
import { fmtData, fmtDataHora, getSettings } from "./utils";
import { painelRematricula, SITUACAO_REM } from "./rematricula";
import { appUrl } from "./url";
import { aulas, MOTIVO_AUS, COB_STATUS, SOLUCOES } from "./cobertura";
import { situacaoContrato, RENOVACAO, CONTRATO_STATUS, painelLicencas, TIPO_LICENCA, LIC_SIT, podeContratos, podeLicencas } from "./contratos";
import { SOL_STATUS, vePainel, type EtapaSnap } from "./solicitacoes";
import { consentimentosAtuais, finalidades, podePrivacidade, CONSENT_STATUS } from "./privacidade";

type Linha = (string | number | null)[];
/** Exportações dos módulos da v22 (null = tipo desconhecido aqui; "negado" = sem permissão). */
export async function exportarV22(tipo: string, s: Session, u: number | null, url: URL): Promise<Linha[] | null | "negado"> {
  if (tipo === "rematricula") {
    const cfg = await getSettings(); const ano = cfg.matriculas.anoLetivo as number; const unidade = u ?? (url.searchParams.get("unidade") ? Number(url.searchParams.get("unidade")) : null); const base = await appUrl();
    const rows = await painelRematricula(ano, unidade); const comLink = can.reservar(s);
    return [["aluno", "unidade", "serie_atual", "serie_prevista", "responsavel", "telefone", "carteira", "situacao", "turma", "reserva_ate", "contrato_aceito", "financeiro_ok", "link_enviado_em", "link_aberto_em", "respondido_em", "link_valido_ate", "motivo_recusa", ...(comLink ? ["link"] : [])],
      ...rows.map(r => [r.nome, r.unidade, r.serie_atual, r.serie_prevista, r.responsavel, r.telefone, r.carteira, SITUACAO_REM[r.situacao], r.mat_turma, fmtData(r.reserva_ate), r.contrato ? "sim" : r.mat_status ? "não" : "", r.financeiro ? "sim" : r.mat_status ? "não" : "", fmtDataHora(r.enviado_em), fmtDataHora(r.aberto_em), fmtDataHora(r.concluido_em), r.link_status === "PENDENTE" ? fmtData(r.expira_em) : "", r.recusa_motivo, ...(comLink ? [r.link_status === "PENDENTE" && r.token ? `${base}/rematricula/${r.token}` : ""] : [])])];
  }
  if (tipo === "coberturas") {
    if (!["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "LEITURA"].includes(s.role)) return "negado";
    const iso = (k: string, fb: string) => { const v = url.searchParams.get(k) ?? ""; return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fb; };
    const hojeIso = new Date().toLocaleDateString("en-CA", { timeZone: "America/Campo_Grande" });
    const unidade = u ?? (url.searchParams.get("unidade") ? Number(url.searchParams.get("unidade")) : null);
    const xs = await aulas(iso("ini", hojeIso.slice(0, 8) + "01"), iso("fim", hojeIso), unidade);
    return [["data", "unidade", "inicio", "fim", "turma", "disciplina", "professor_ausente", "motivo", "situacao", "cobertura", "minutos", "solucao_sem_professor", "recusas"],
      ...xs.map(a => [fmtData(a.data), a.unidade, a.inicio, a.fim, a.turma, a.disciplina, a.ausente, MOTIVO_AUS[a.motivo] ?? a.motivo, COB_STATUS[a.status], a.cobertura, a.minutos, a.solucao ? SOLUCOES[a.solucao] ?? a.solucao : "", (a.recusas ?? []).map(r => r.nome).join(", ")])];
  }
  if (tipo === "contratos") {
    if (!podeContratos(s) && s.role !== "LEITURA") return "negado";
    const cfg = await getSettings(); const h = new Date().toLocaleDateString("en-CA", { timeZone: "America/Campo_Grande" });
    const rs = await sql<{ objeto: string; fornecedor: string; unidade: string | null; numero: string | null; inicio: string; fim: string | null; renovacao: string; aviso_previo_dias: number; reajuste_indice: string | null; proximo_reajuste: string | null; valor_mensal: string | null; valor_total: string | null; status: string; responsavel: string | null }[]>`SELECT c.objeto, s.nome AS fornecedor, u.nome AS unidade, c.numero, c.inicio::text, c.fim::text, c.renovacao, c.aviso_previo_dias, c.reajuste_indice, c.proximo_reajuste::text, c.valor_mensal::text, c.valor_total::text, c.status, us.nome AS responsavel FROM contracts c JOIN suppliers s ON s.id=c.supplier_id LEFT JOIN units u ON u.id=c.unit_id LEFT JOIN users us ON us.id=c.responsavel_user_id WHERE 1=1 ${u === null ? sql`` : sql`AND (c.unit_id IS NULL OR c.unit_id=${u})`} ORDER BY c.status, c.fim NULLS LAST`;
    const n = (v: string | null) => v === null ? "" : v.replace(".", ",");
    return [["objeto", "fornecedor", "abrangencia", "numero", "inicio", "fim", "renovacao", "aviso_previo_dias", "indice", "proximo_reajuste", "valor_mensal", "valor_total", "situacao", "alertas", "responsavel"], ...rs.map(c => [c.objeto, c.fornecedor, c.unidade ?? "rede", c.numero, fmtData(c.inicio), fmtData(c.fim), RENOVACAO[c.renovacao], c.aviso_previo_dias, c.reajuste_indice, fmtData(c.proximo_reajuste), n(c.valor_mensal), n(c.valor_total), CONTRATO_STATUS[c.status], situacaoContrato(c, cfg.contratos.avisos as number[], h).alertas.map(a => a.texto).join(" | "), c.responsavel])];
  }
  if (tipo === "licencas") {
    if (!podeLicencas(s) && s.role !== "LEITURA") return "negado";
    const p = await painelLicencas(u);
    return [["unidade", "tipo", "nome", "orgao", "numero", "emissao", "validade", "situacao", "responsavel", "anexos"], ...p.lista.map(l => [l.unidade, TIPO_LICENCA[l.tipo], l.nome, l.orgao, l.numero, fmtData(l.emissao), fmtData(l.validade), LIC_SIT[l.situacao][1], l.responsavel, l.anexos]),
      ...p.matriz.flatMap(m => Object.entries(m.tipos).filter(([, t]) => t.situacao === "NAO_CADASTRADA").map(([t]) => [m.nome, TIPO_LICENCA[t], "", "", "", "", "", "Não cadastrada", "", 0]))];
  }
  if (tipo === "solicitacoes") {
    if (!vePainel(s)) return "negado";
    const rs = await sql<{ numero: string; titulo: string; tipo: string; solicitante_nome: string | null; unidade: string | null; valor: string | null; status: string; etapa_atual: number; etapas: EtapaSnap[]; created_at: string; concluida_em: string | null }[]>`SELECT r.numero, r.titulo, t.nome AS tipo, r.solicitante_nome, un.nome AS unidade, r.valor::text, r.status, r.etapa_atual, r.etapas, r.created_at::text, r.concluida_em::text FROM requests r JOIN request_types t ON t.id=r.type_id LEFT JOIN units un ON un.id=r.unit_id WHERE 1=1 ${s.role === "DIRETOR_UNIDADE" ? sql`AND r.unit_id=${u}` : sql``} ORDER BY r.created_at DESC`;
    return [["numero", "titulo", "tipo", "solicitante", "unidade", "valor", "situacao", "etapa_atual", "decisoes", "aberta_em", "concluida_em"], ...rs.map(r => [r.numero, r.titulo, r.tipo, r.solicitante_nome, r.unidade, r.valor === null ? "" : r.valor.replace(".", ","), SOL_STATUS[r.status], r.status === "EM_APROVACAO" ? r.etapas[r.etapa_atual]?.nome ?? "" : "", r.etapas.filter(e => e.decisao).map(e => `${e.nome}: ${e.decisao} (${e.porNome})`).join(" | "), fmtDataHora(r.created_at), fmtDataHora(r.concluida_em)])];
  }
  if (tipo === "consentimentos") {
    if (!(can.reservar(s) || await podePrivacidade(s) || s.role === "LEITURA")) return "negado";
    const fins = await finalidades(); const al = await sql<{ id: number; nome: string; serie: string | null; unidade: string | null }[]>`SELECT st.id, st.nome, g.nome AS serie, un.nome AS unidade FROM students st LEFT JOIN grades g ON g.id=st.serie_atual_id LEFT JOIN units un ON un.id=st.unit_atual_id WHERE st.aluno_atual ${u === null ? sql`` : sql`AND st.unit_atual_id=${u}`} ORDER BY un.nome, g.ordem NULLS LAST, st.nome`;
    const at = await consentimentosAtuais(al.map(a => a.id));
    return [["aluno", "unidade", "serie", ...fins.map(f => f.titulo)], ...al.map(a => [a.nome, a.unidade, a.serie, ...fins.map(f => CONSENT_STATUS[at.get(`${a.id}:${f.id}`)?.status ?? "SEM_REGISTRO"])])];
  }
  return null;
}
