import { NextResponse } from "next/server";
import { getSession, scopeUnit, can } from "@/lib/auth";
import { sql } from "@/db";
import { fmtData, fmtMin, VINCULO_LABEL, SITUACAO_LABEL, LEAVE_LABEL, LEAVE_STATUS } from "@/lib/utils";
import { mesRef, relatorioMensal } from "@/lib/relatorio";
import { ocupacao } from "@/lib/matriculas";
import { riscoFamilias, CASE_TIPO_LABEL, CASE_STATUS } from "@/lib/atendimento";
import { POP_STATUS, EXC_STATUS, NC_STATUS, NC_ORIGEM, DEC_STATUS } from "@/lib/governanca";
import { tabelaCargos, REV_STATUS, REQ_STATUS, ETAPA_LABEL, NIVEL_LABEL } from "@/lib/talento";
import { matrizTreinamento } from "@/lib/clima-academy";
import { sinaisPessoas } from "@/lib/talentos-analytics";
import { inadimplencia, ETAPA_COB, DESC_STATUS, caixaMes } from "@/lib/financeiro";
import { OS_TIPO, OS_STATUS, OS_PRIO, ATIVO_STATUS } from "@/lib/operacoes";
import { portfolio, PROJ_STATUS, SAUDE } from "@/lib/estrategia";
import { getSettings, ENR_STATUS } from "@/lib/utils";

export const dynamic = "force-dynamic";

function csv(rows: (string | number | null | undefined)[][]) {
  const esc = (v: unknown) => { const t = v === null || v === undefined ? "" : String(v); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  return "\uFEFF" + rows.map(r => r.map(esc).join(";")).join("\r\n");
}

export async function GET(req: Request, ctx: { params: Promise<{ tipo: string }> }) {
  const s = await getSession();
  if (!s || s.role === "COLABORADOR") return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  const { tipo } = await ctx.params; const u = scopeUnit(s); const uf = u === null ? sql`` : sql`AND e.unit_id=${u}`;
  let rows: (string | number | null)[][] = [];
  if (tipo === "colaboradores") {
    const sens = can.verSensivel(s);
    const r = await sql<Record<string, string | number | null>[]>`SELECT e.nome, un.nome AS unidade, p.nome AS cargo, e.nivel, c.nome AS empresa, e.vinculo, e.admissao::text, e.desligamento::text, e.situacao, e.jornada_min_dia, e.turno, e.email, e.telefone, e.data_nascimento::text, g.nome AS gestor, e.cpf, e.salario::text
      FROM employees e JOIN units un ON un.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id LEFT JOIN companies c ON c.id=e.company_id LEFT JOIN employees g ON g.id=e.gestor_id WHERE 1=1 ${uf} ORDER BY e.nome`;
    rows = [["nome", "unidade", "cargo", "nivel", "empresa", "vinculo", "admissao", "desligamento", "situacao", "jornada_min_dia", "turno", "email", "telefone", "nascimento", "gestor", ...(sens ? ["cpf", "salario"] : [])],
      ...r.map(x => [x.nome, x.unidade, x.cargo, x.nivel, x.empresa, VINCULO_LABEL[String(x.vinculo)] ?? x.vinculo, fmtData(x.admissao as string), fmtData(x.desligamento as string), SITUACAO_LABEL[String(x.situacao)] ?? x.situacao, x.jornada_min_dia, x.turno, x.email, x.telefone, fmtData(x.data_nascimento as string), x.gestor, ...(sens ? [x.cpf, x.salario] : [])])];
  } else if (tipo === "banco") {
    const r = await sql<{ nome: string; unidade: string; saldo: number; pendentes: number }[]>`SELECT e.nome, un.nome AS unidade, coalesce((SELECT sum(minutos) FROM hour_entries h WHERE h.employee_id=e.id AND h.status='APROVADO'),0)::int AS saldo, (SELECT count(*) FROM hour_entries h WHERE h.employee_id=e.id AND h.status='PENDENTE')::int AS pendentes FROM employees e JOIN units un ON un.id=e.unit_id WHERE e.situacao <> 'DESLIGADO' ${uf} ORDER BY e.nome`;
    rows = [["nome", "unidade", "saldo_min", "saldo_hhmm", "lancamentos_pendentes"], ...r.map(x => [x.nome, x.unidade, x.saldo, fmtMin(x.saldo), x.pendentes])];
  } else if (tipo === "ferias") {
    const r = await sql<Record<string, string | number | null>[]>`SELECT e.nome, un.nome AS unidade, l.tipo, l.inicio::text, l.fim::text, l.dias, l.status, l.periodo_ref::text FROM leave_requests l JOIN employees e ON e.id=l.employee_id JOIN units un ON un.id=e.unit_id WHERE 1=1 ${uf} ORDER BY l.inicio DESC`;
    rows = [["nome", "unidade", "tipo", "inicio", "fim", "dias", "situacao", "periodo_aquisitivo"], ...r.map(x => [x.nome, x.unidade, LEAVE_LABEL[String(x.tipo)] ?? x.tipo, fmtData(x.inicio as string), fmtData(x.fim as string), x.dias, LEAVE_STATUS[String(x.status)] ?? x.status, fmtData(x.periodo_ref as string)])];
  } else if (tipo === "banco-mensal") {
    const m = mesRef(new URL(req.url).searchParams.get("mes") ?? undefined); const r = await relatorioMensal(u, m);
    rows = [["mes", "nome", "unidade", "saldo_inicial_min", "creditos_min", "debitos_min", "saldo_final_min", "saldo_final_hhmm"], ...r.banco.map(x => [m.ini.slice(0, 7), x.nome, x.unidade, x.saldo_inicial, x.creditos, x.debitos, x.saldo_final, fmtMin(x.saldo_final)])];
  } else if (tipo === "ocupacao") {
    const cfg = await getSettings(); const ano = Number(new URL(req.url).searchParams.get("ano") ?? cfg.matriculas.anoLetivo);
    const r = await ocupacao(ano, u);
    rows = [["ano", "unidade", "modalidade", "serie", "turma", "turno", "vagas", "matriculados", "reservas_ativas", "livres", "fila", "situacao"], ...r.map(x => [ano, x.unidade, x.modalidade, x.serie ?? x.series_texto, x.nome, x.turno, x.vagas, x.confirmadas, x.reservadas, x.livres, x.fila, x.status])];
  } else if (tipo === "matriculas") {
    const cfg = await getSettings(); const ano = Number(new URL(req.url).searchParams.get("ano") ?? cfg.matriculas.anoLetivo);
    const r = await sql<Record<string, string | number | boolean | null>[]>`SELECT st.nome AS aluno, st.data_nascimento::text AS nascimento, st.responsavel, st.telefone, st.email, un.nome AS unidade, c.nome AS turma, g.nome AS serie, c.turno, e.modalidade, e.status, e.reserva_ate::text, e.contrato_assinado, e.financeiro_ok, e.confirmada_em::text, e.motivo_cancelamento, e.excecao
      FROM enrollments e JOIN students st ON st.id=e.student_id JOIN classes c ON c.id=e.class_id JOIN units un ON un.id=c.unit_id LEFT JOIN grades g ON g.id=c.grade_id WHERE e.ano=${ano} ${u === null ? sql`` : sql`AND c.unit_id=${u}`} ORDER BY un.nome, c.nome, st.nome`;
    rows = [["aluno", "nascimento", "responsavel", "telefone", "email", "unidade", "turma", "serie", "turno", "modalidade", "situacao", "reserva_ate", "contrato_assinado", "financeiro_ok", "confirmada_em", "motivo_cancelamento", "excecao"],
      ...r.map(x => [x.aluno as string, fmtData(x.nascimento as string), x.responsavel as string | null, x.telefone as string | null, x.email as string | null, x.unidade as string, x.turma as string, x.serie as string | null, x.turno as string, x.modalidade as string, ENR_STATUS[String(x.status)] ?? String(x.status), fmtData(x.reserva_ate as string), x.contrato_assinado ? "sim" : "não", x.financeiro_ok ? "sim" : "não", x.confirmada_em ? String(x.confirmada_em).slice(0, 10).split("-").reverse().join("/") : "", x.motivo_cancelamento as string | null, x.excecao as string | null])];
  } else if (tipo === "casos") {
    const r = await sql<Record<string, string | number | null>[]>`SELECT c.id, c.assunto, c.tipo, c.categoria, c.gravidade, c.status, c.prioridade, un.nome AS unidade, st.nome AS aluno, c.contato_nome, c.canal, us.nome AS responsavel, c.created_at::text, c.sla_ate::text, c.resolvido_em::text, c.resultado, c.motivo_saida, c.causa_raiz, c.acao_corretiva, c.satisfacao FROM cases c JOIN units un ON un.id=c.unit_id LEFT JOIN students st ON st.id=c.student_id LEFT JOIN users us ON us.id=c.responsavel_user_id WHERE 1=1 ${u === null ? sql`` : sql`AND c.unit_id=${u}`} ORDER BY c.created_at DESC`;
    rows = [["id", "assunto", "tipo", "categoria", "gravidade", "situacao", "prioridade", "unidade", "aluno", "contato", "canal", "responsavel", "aberto_em", "sla_ate", "resolvido_em", "desfecho", "motivo_saida", "causa_raiz", "acao_corretiva", "satisfacao"],
      ...r.map(x => [x.id, x.assunto, CASE_TIPO_LABEL[String(x.tipo)] ?? x.tipo, x.categoria, x.gravidade, CASE_STATUS[String(x.status)] ?? x.status, x.prioridade, x.unidade, x.aluno, x.contato_nome, x.canal, x.responsavel, String(x.created_at ?? "").slice(0, 16), String(x.sla_ate ?? "").slice(0, 16), String(x.resolvido_em ?? "").slice(0, 16), x.resultado, x.motivo_saida, x.causa_raiz, x.acao_corretiva, x.satisfacao])];
  } else if (tipo === "pesquisas") {
    const r = await sql<Record<string, string | number | null>[]>`SELECT s.data::text, s.tipo, s.nota, st.nome AS aluno, un.nome AS unidade, s.comentario, s.canal, s.case_id FROM surveys s JOIN units un ON un.id=s.unit_id LEFT JOIN students st ON st.id=s.student_id WHERE 1=1 ${u === null ? sql`` : sql`AND s.unit_id=${u}`} ORDER BY s.data DESC`;
    rows = [["data", "tipo", "nota", "aluno", "unidade", "comentario", "canal", "caso"], ...r.map(x => [fmtData(x.data as string), x.tipo, x.nota, x.aluno, x.unidade, x.comentario, x.canal, x.case_id])];
  } else if (tipo === "risco") {
    const r = await riscoFamilias(u);
    rows = [["aluno", "unidade", "serie", "responsavel", "telefone", "pontos", "nivel", "sinais"], ...r.map(x => [x.nome, x.unidade, x.serie, x.responsavel, x.telefone, x.pontos, x.nivel, x.fatores.map(f => f.texto).join(" | ")])];
  } else if (tipo === "pops") {
    const r = await sql<Record<string, string | number | null>[]>`SELECT p.codigo, p.titulo, p.area, p.status, p.versao, us.nome AS dono, un.nome AS unidade, p.revisar_em::text, p.publicado_em::text, (SELECT count(*) FROM procedure_acks a WHERE a.procedure_id=p.id AND a.versao=p.versao)::int AS ciencias FROM procedures p LEFT JOIN users us ON us.id=p.owner_user_id LEFT JOIN units un ON un.id=p.unit_id ORDER BY p.codigo`;
    rows = [["codigo", "titulo", "area", "situacao", "versao", "dono", "unidade", "revisar_em", "publicado_em", "ciencias"], ...r.map(x => [x.codigo, x.titulo, x.area, POP_STATUS[String(x.status)] ?? x.status, x.versao, x.dono, x.unidade, fmtData(x.revisar_em as string), String(x.publicado_em ?? "").slice(0, 10), x.ciencias])];
  } else if (tipo === "excecoes") {
    const r = await sql<Record<string, string | number | null>[]>`SELECT e.id, e.regra, e.motivo, e.referencia, e.descricao, e.impacto, un.nome AS unidade, us.nome AS solicitante, ua.nome AS aprovador, e.status, e.validade_ate::text, e.created_at::text, e.motivo_decisao, e.revisao_nota FROM exceptions e LEFT JOIN units un ON un.id=e.unit_id LEFT JOIN users us ON us.id=e.solicitante_user_id LEFT JOIN users ua ON ua.id=e.aprovador_user_id WHERE 1=1 ${u === null ? sql`` : sql`AND (e.unit_id IS NULL OR e.unit_id=${u})`} ORDER BY e.created_at DESC`;
    rows = [["id", "regra", "motivo", "referencia", "descricao", "impacto", "unidade", "solicitante", "aprovador", "situacao", "validade", "solicitada_em", "decisao", "revisao"], ...r.map(x => [x.id, x.regra, x.motivo, x.referencia, x.descricao, x.impacto, x.unidade, x.solicitante, x.aprovador, EXC_STATUS[String(x.status)] ?? x.status, fmtData(x.validade_ate as string), String(x.created_at ?? "").slice(0, 10), x.motivo_decisao, x.revisao_nota])];
  } else if (tipo === "ncs") {
    const r = await sql<Record<string, string | number | boolean | null>[]>`SELECT n.id, n.titulo, n.origem, n.gravidade, n.status, n.prazo::text, un.nome AS unidade, us.nome AS responsavel, p.codigo AS pop, n.causa_raiz, n.acao_corretiva, n.acao_preventiva, n.eficacia_verificada, n.created_at::text, n.encerrada_em::text FROM nonconformities n LEFT JOIN units un ON un.id=n.unit_id LEFT JOIN users us ON us.id=n.responsavel_user_id LEFT JOIN procedures p ON p.id=n.procedure_id WHERE 1=1 ${u === null ? sql`` : sql`AND (n.unit_id IS NULL OR n.unit_id=${u})`} ORDER BY n.created_at DESC`;
    rows = [["id", "titulo", "origem", "gravidade", "situacao", "prazo", "unidade", "responsavel", "pop", "causa_raiz", "acao_corretiva", "acao_preventiva", "eficacia_verificada", "aberta_em", "encerrada_em"], ...r.map(x => [x.id as number, x.titulo as string, NC_ORIGEM[String(x.origem)] ?? String(x.origem), x.gravidade as number, NC_STATUS[String(x.status)] ?? String(x.status), fmtData(x.prazo as string), x.unidade as string | null, x.responsavel as string | null, x.pop as string | null, x.causa_raiz as string | null, x.acao_corretiva as string | null, x.acao_preventiva as string | null, x.eficacia_verificada ? "sim" : "não", String(x.created_at ?? "").slice(0, 10), String(x.encerrada_em ?? "").slice(0, 10)])];
  } else if (tipo === "decisoes") {
    const r = await sql<Record<string, string | number | null>[]>`SELECT d.id, d.data::text, d.titulo, d.area, un.nome AS unidade, d.contexto, d.decisao, d.alternativas, d.consequencias, us.nome AS responsavel, d.status, d.revisar_em::text, d.link FROM decisions d LEFT JOIN units un ON un.id=d.unit_id LEFT JOIN users us ON us.id=d.responsavel_user_id WHERE 1=1 ${u === null ? sql`` : sql`AND (d.unit_id IS NULL OR d.unit_id=${u})`} ORDER BY d.data DESC`;
    rows = [["id", "data", "titulo", "area", "unidade", "contexto", "decisao", "alternativas", "consequencias", "responsavel", "situacao", "revisar_em", "link"], ...r.map(x => [x.id, fmtData(x.data as string), x.titulo, x.area, x.unidade, x.contexto, x.decisao, x.alternativas, x.consequencias, x.responsavel, DEC_STATUS[String(x.status)] ?? x.status, fmtData(x.revisar_em as string), x.link])];
  } else if (tipo === "tabela-salarial") {
    if (!can.verSalario(s)) return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
    const { rows: r } = await tabelaCargos(u);
    rows = [["cargo", "area", "pontos", "faixa", "minimo", "medio", "maximo", "ocupantes", "salario_medio", "compa_ratio", "abaixo_min", "acima_max"], ...r.map(x => [x.nome, x.area, x.pontos, x.grade, x.minimo, x.medio, x.maximo, x.ocupantes, x.sal_medio === null ? null : Math.round(x.sal_medio * 100) / 100, x.compa, x.abaixo, x.acima])];
  } else if (tipo === "desempenho") {
    const ciclo = Number(new URL(req.url).searchParams.get("ciclo") ?? 0);
    const r = await sql<Record<string, string | number | null>[]>`SELECT c.nome AS ciclo, e.nome, un.nome AS unidade, p.nome AS cargo, us.nome AS avaliador, r.status, r.nota_final::float, r.desempenho_nivel, r.potencial, r.calibracao_nota, coalesce(jsonb_array_length(r.pdi),0)::int AS pdi FROM perf_reviews r JOIN perf_cycles c ON c.id=r.cycle_id JOIN employees e ON e.id=r.employee_id JOIN units un ON un.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id LEFT JOIN users us ON us.id=r.avaliador_user_id WHERE r.cycle_id=${ciclo} ${u === null ? sql`` : sql`AND e.unit_id=${u}`} ORDER BY un.nome, e.nome`;
    rows = [["ciclo", "colaborador", "unidade", "cargo", "avaliador", "situacao", "nota_final", "desempenho", "potencial", "calibracao", "acoes_pdi"], ...r.map(x => [x.ciclo, x.nome, x.unidade, x.cargo, x.avaliador, REV_STATUS[String(x.status)] ?? x.status, x.nota_final, x.desempenho_nivel ? NIVEL_LABEL[Number(x.desempenho_nivel)] : null, x.potencial ? NIVEL_LABEL[Number(x.potencial)] : null, x.calibracao_nota, x.pdi])];
  } else if (tipo === "vagas") {
    const r = await sql<Record<string, string | number | null>[]>`SELECT r.id, r.titulo, p.nome AS cargo, un.nome AS unidade, r.quantidade, r.tipo, r.regime, r.status, us.nome AS solicitante, r.created_at::text, r.aberta_em::text, r.fechada_em::text, (SELECT count(*) FROM applications a WHERE a.requisition_id=r.id)::int AS candidaturas, (SELECT count(*) FROM applications a WHERE a.requisition_id=r.id AND a.etapa='CONTRATADO')::int AS contratados FROM requisitions r JOIN units un ON un.id=r.unit_id LEFT JOIN positions p ON p.id=r.position_id LEFT JOIN users us ON us.id=r.solicitante_user_id WHERE 1=1 ${u === null ? sql`` : sql`AND r.unit_id=${u}`} ORDER BY r.created_at DESC`;
    rows = [["id", "vaga", "cargo", "unidade", "quantidade", "tipo", "regime", "situacao", "solicitante", "solicitada_em", "aberta_em", "fechada_em", "candidaturas", "contratados"], ...r.map(x => [x.id, x.titulo, x.cargo, x.unidade, x.quantidade, x.tipo, x.regime, REQ_STATUS[String(x.status)] ?? x.status, x.solicitante, String(x.created_at ?? "").slice(0, 10), fmtData(x.aberta_em as string), fmtData(x.fechada_em as string), x.candidaturas, x.contratados])];
    void ETAPA_LABEL;
  } else if (tipo === "treinamentos") {
    const m = await matrizTreinamento(u);
    rows = [["colaborador", "unidade", "cargo", "treinamento", "tipo", "situacao", "concluido_em", "valido_ate"], ...m.linhas.flatMap(l => l.itens.map(i => [l.emp.nome, l.emp.unidade, l.emp.cargo, `${i.curso.codigo} ${i.curso.titulo}`, i.curso.tipo, i.status, fmtData(i.concluidoEm), fmtData(i.validoAte)]))];
  } else if (tipo === "risco-pessoas") {
    if (!["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role)) return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
    const r = (await sinaisPessoas(u)).filter(x => x.nivel !== "BAIXO");
    rows = [["colaborador", "unidade", "cargo", "pontos", "nivel", "sinais"], ...r.map(x => [x.nome, x.unidade, x.cargo, x.pontos, x.nivel, x.fatores.map(f => f.texto).join(" | ")])];
  } else if (tipo === "inadimplencia") {
    if (!["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE", "RH"].includes(s.role)) return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
    const r = await inadimplencia(u);
    rows = [["aluno", "responsavel", "telefone", "unidade", "tipo", "competencia", "vencimento", "dias_atraso", "valor", "etapa_regua", "ultima_acao"], ...r.itens.map(x => [x.aluno_nome, x.responsavel, x.telefone, x.unidade, x.tipo, x.competencia, fmtData(x.vencimento), x.dias, x.valor, x.etapa ? ETAPA_COB[x.etapa] : null, x.ultima_etapa ? `${ETAPA_COB[x.ultima_etapa]} ${String(x.ultima_acao ?? "").slice(0, 10)}` : null])];
  } else if (tipo === "descontos") {
    const r = await sql<Record<string, string | number | null>[]>`SELECT d.aluno_nome, un.nome AS unidade, d.ano, d.tipo, d.percentual::float, d.motivo, d.validade_ate::text, d.status, us.nome AS solicitante, ua.nome AS aprovador, d.created_at::text FROM discounts d JOIN units un ON un.id=d.unit_id LEFT JOIN users us ON us.id=d.solicitante_user_id LEFT JOIN users ua ON ua.id=d.aprovador_user_id WHERE 1=1 ${u === null ? sql`` : sql`AND d.unit_id=${u}`} ORDER BY d.created_at DESC`;
    rows = [["aluno", "unidade", "ano", "tipo", "percentual", "motivo", "validade", "situacao", "solicitante", "aprovador", "data"], ...r.map(x => [x.aluno_nome, x.unidade, x.ano, x.tipo, x.percentual, x.motivo, fmtData(x.validade_ate as string), DESC_STATUS[String(x.status)] ?? x.status, x.solicitante, x.aprovador, String(x.created_at ?? "").slice(0, 10)])];
  } else if (tipo === "caixa") {
    if (!["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE"].includes(s.role)) return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
    const mes = new URL(req.url).searchParams.get("mes") ?? new Date().toISOString().slice(0, 7); const ini = `${mes}-01`;
    const r = await sql<Record<string, string | number | null>[]>`SELECT c.data::text, un.nome AS unidade, c.tipo, c.categoria, c.forma, c.descricao, c.valor::float, c.contraparte FROM cash_entries c JOIN units un ON un.id=c.unit_id WHERE c.data >= ${ini} AND c.data < (${ini}::date + interval '1 month') ${u === null ? sql`` : sql`AND c.unit_id=${u}`} ORDER BY c.data, c.id`;
    rows = [["data", "unidade", "tipo", "categoria", "forma", "descricao", "valor", "contraparte"], ...r.map(x => [fmtData(x.data as string), x.unidade, x.tipo, x.categoria, x.forma, x.descricao, x.valor, x.contraparte])];
    void caixaMes;
  } else if (tipo === "chamados") {
    const r = await sql<Record<string, string | number | null>[]>`SELECT w.id, w.titulo, w.tipo, w.prioridade, w.status, un.nome AS unidade, w.ambiente, a.nome AS ativo, us.nome AS solicitante, ur.nome AS responsavel, f.nome AS fornecedor, w.created_at::text, w.sla_ate::text, w.concluido_em::text, w.custo_previsto::float, w.custo_real::float, w.avaliacao FROM work_orders w JOIN units un ON un.id=w.unit_id LEFT JOIN assets a ON a.id=w.asset_id LEFT JOIN users us ON us.id=w.solicitante_user_id LEFT JOIN users ur ON ur.id=w.responsavel_user_id LEFT JOIN suppliers f ON f.id=w.supplier_id WHERE 1=1 ${u === null ? sql`` : sql`AND w.unit_id=${u}`} ORDER BY w.created_at DESC`;
    rows = [["id", "chamado", "tipo", "prioridade", "situacao", "unidade", "ambiente", "ativo", "solicitante", "responsavel", "fornecedor", "aberto_em", "sla_ate", "concluido_em", "custo_previsto", "custo_real", "avaliacao"], ...r.map(x => [x.id, x.titulo, OS_TIPO[String(x.tipo)] ?? x.tipo, OS_PRIO[String(x.prioridade)] ?? x.prioridade, OS_STATUS[String(x.status)] ?? x.status, x.unidade, x.ambiente, x.ativo, x.solicitante, x.responsavel, x.fornecedor, String(x.created_at ?? "").slice(0, 16), String(x.sla_ate ?? "").slice(0, 16), String(x.concluido_em ?? "").slice(0, 16), x.custo_previsto, x.custo_real, x.avaliacao])];
  } else if (tipo === "ativos") {
    const r = await sql<Record<string, string | number | null>[]>`SELECT a.codigo, a.nome, a.categoria, un.nome AS unidade, a.ambiente, a.aquisicao::text, a.valor::float, a.fornecedor, a.garantia_ate::text, a.status, a.preventiva_dias, a.ultima_preventiva::text FROM assets a JOIN units un ON un.id=a.unit_id WHERE 1=1 ${u === null ? sql`` : sql`AND a.unit_id=${u}`} ORDER BY un.nome, a.ambiente, a.nome`;
    rows = [["patrimonio", "ativo", "categoria", "unidade", "ambiente", "aquisicao", "valor", "fornecedor", "garantia_ate", "situacao", "preventiva_dias", "ultima_preventiva"], ...r.map(x => [x.codigo, x.nome, x.categoria, x.unidade, x.ambiente, fmtData(x.aquisicao as string), x.valor, x.fornecedor, fmtData(x.garantia_ate as string), ATIVO_STATUS[String(x.status)] ?? x.status, x.preventiva_dias, fmtData(x.ultima_preventiva as string)])];
  } else if (tipo === "vistorias") {
    const r = await sql<{ data: string; unidade: string; ambiente: string; tipo: string; conformes: number; total: number; inspetor: string | null; itens: { item: string; ok: boolean; obs: string | null }[] }[]>`SELECT i.data::text, un.nome AS unidade, i.ambiente, i.tipo, i.conformes, i.total, us.nome AS inspetor, i.itens FROM inspections i JOIN units un ON un.id=i.unit_id LEFT JOIN users us ON us.id=i.inspetor_user_id WHERE 1=1 ${u === null ? sql`` : sql`AND i.unit_id=${u}`} ORDER BY i.data DESC`;
    rows = [["data", "unidade", "ambiente", "checklist", "conformes", "total", "inspetor", "nao_conformes"], ...r.map(x => [fmtData(x.data), x.unidade, x.ambiente, x.tipo, x.conformes, x.total, x.inspetor, x.itens.filter(i => !i.ok).map(i => i.item + (i.obs ? ` (${i.obs})` : "")).join(" | ")])];
  } else if (tipo === "projetos") {
    const pf = await portfolio(u);
    rows = [["projeto", "objetivo", "dono", "unidade", "situacao", "saude", "prioridade", "inicio", "fim", "marcos_concluidos", "marcos", "marcos_atrasados", "orcamento", "gasto", "ultima_atualizacao"], ...pf.rows.map(r => [r.nome, r.objetivo, r.owner, r.unidade ?? "rede", PROJ_STATUS[r.status], SAUDE[r.saude], r.prioridade, fmtData(r.inicio), fmtData(r.fim), r.marcos_ok, r.marcos, r.marcos_atrasados, r.orcamento, r.gasto, fmtData(r.ultima_atualizacao)])];
  } else return NextResponse.json({ erro: "Tipo inválido." }, { status: 404 });
  return new NextResponse(csv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${tipo}-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
