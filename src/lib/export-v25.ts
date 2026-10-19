import { sql } from "@/db";
import type { Session } from "./auth";
import { podeOperar, podeVer, ISSUE_TIPO, DESFECHOS, LINHA_STATUS, FORMA_LINHA, painelRecebimentos } from "./conciliacao";
import { hoje, fmtData } from "./utils";
import { divergencias, DIV_TIPO, DIV_STATUS } from "./auditoria-ponto";

type Linha = (string | number | null)[];
const n2 = (v: number | null | undefined) => v === null || v === undefined ? null : Math.round(v * 100) / 100;
const periodoOk = (p: string | null) => !!p && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);

/** Exportações da v25 (conciliação): null = tipo desconhecido aqui; "negado" = sem permissão. */
export async function exportarV25(tipo: string, s: Session, u: number | null, url: URL): Promise<Linha[] | null | "negado"> {
  if (tipo === "divergencias") {
    if (!podeVer(s)) return "negado";
    const sit = url.searchParams.get("situacao"); const filtro = sit === "resolvidas" ? sql`AND i.status='RESOLVIDA'` : sit === "todas" ? sql`` : sql`AND i.status='ABERTA'`;
    const r = await sql<{ id: number; tipo: string; origem: string; unidade: string | null; valor: number | null; descricao: string; referencia: string; dono: string | null; prazo: string | null; idade: number; escalonamento: number; status: string; desfecho: string | null; desfecho_obs: string | null; resolvido_em: string | null }[]>`
      SELECT i.id, i.tipo, i.origem, un.nome AS unidade, i.valor::float, i.descricao, i.referencia::text, us.nome AS dono, i.prazo::text, (current_date - i.created_at::date)::int AS idade, i.escalonamento, i.status, i.desfecho, i.desfecho_obs, i.resolvido_em::text
      FROM recon_issues i LEFT JOIN units un ON un.id=i.unit_id LEFT JOIN users us ON us.id=i.dono_user_id WHERE 1=1 ${filtro} ${u !== null ? sql`AND i.unit_id=${u}` : sql``} ${s.role === "COMERCIAL" ? sql`AND i.tipo IN ('NAO_IDENTIFICADO','SEM_BAIXA','VENDA_SEM_TITULO')` : sql``} ORDER BY i.created_at`;
    return [["id", "tipo", "origem", "unidade", "valor", "descricao", "referencia", "dono", "prazo", "idade_dias", "escalonamento", "situacao", "desfecho", "desfecho_obs", "resolvido_em"],
      ...r.map(x => [x.id, ISSUE_TIPO[x.tipo] ?? x.tipo, x.origem, x.unidade, n2(x.valor), x.descricao, x.referencia, x.dono, x.prazo, x.idade, x.escalonamento === 2 ? "Direção" : x.escalonamento === 1 ? "gestor financeiro" : "", x.status, x.desfecho ? DESFECHOS[x.desfecho]?.rotulo ?? x.desfecho : null, x.desfecho_obs, x.resolvido_em?.slice(0, 16) ?? null])];
  }
  if (tipo === "recebimentos") {
    if (!podeVer(s) || s.role === "COMERCIAL") return "negado";
    const p = url.searchParams.get("periodo"); const periodo = periodoOk(p) ? p! : hoje().slice(0, 7); const pedido = Number(url.searchParams.get("unidade")) || null; const unitId = u ?? pedido;
    const r = await painelRecebimentos(periodo, unitId ? [unitId] : null);
    return [["competencia", "unidade", "forma", "recebido", "conciliado", "pct_conciliado", "baixas", "baixas_conciliadas"],
      ...r.porUnidade.map(x => [periodo, x.unidade, x.forma === "SEM" ? "sem forma" : x.forma, n2(x.recebido), n2(x.conciliado), x.recebido ? n2((100 * x.conciliado) / x.recebido) : null, x.n, x.nConciliados]),
      [periodo, "TOTAL", "", n2(r.recebido), n2(r.conciliado), r.pct === null ? null : n2(r.pct), r.nRecebidos, null]];
  }
  if (tipo === "extrato") {
    if (!podeOperar(s) && !["RH", "LEITURA"].includes(s.role)) return "negado";
    const p = url.searchParams.get("periodo"); const periodo = periodoOk(p) ? p! : hoje().slice(0, 7);
    const r = await sql<{ data: string; conta: string; forma: string; valor: number; descricao: string | null; pagador: string | null; status: string; familia: string | null }[]>`SELECT l.data::text, a.apelido AS conta, l.forma, l.valor::float, l.descricao, l.pagador, l.status, st.nome AS familia
      FROM bank_lines l JOIN bank_accounts a ON a.id=l.bank_account_id LEFT JOIN students st ON st.id=l.student_id WHERE to_char(l.data, 'YYYY-MM')=${periodo} ${u !== null ? sql`AND a.unit_id=${u}` : sql``} ORDER BY l.data, l.id`;
    return [["data", "conta", "forma", "valor", "historico", "pagador", "situacao", "familia"], ...r.map(x => [x.data, x.conta, FORMA_LINHA[x.forma] ?? x.forma, n2(x.valor), x.descricao, x.pagador, LINHA_STATUS[x.status]?.rotulo ?? x.status, x.familia])];
  }
  if (tipo === "meu-espelho") {
    if (!s.employeeId) return "negado";
    const p = url.searchParams.get("mes"); const mes = periodoOk(p) ? p! : hoje().slice(0, 7);
    const { montarMes, PONTO_LABEL, diffDia } = await import("./ponto");
    const { dias, emp } = await montarMes(s.employeeId, mes);
    return [["colaborador", "data", "situacao", "marcacoes", "esperado_min", "trabalhado_min", "saldo_min", "lancado"], ...dias.map(d => [emp.nome, fmtData(d.data), PONTO_LABEL[d.status] ?? d.status, d.marcacoes, d.esperado, d.trabalhado, d.salvo ? diffDia(d) : null, d.salvo ? "sim" : "não (calculado)"])];
  }
  if (tipo === "auditoria-ponto") {
    if (!["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role)) return "negado";
    const p = url.searchParams.get("mes"); const mes = periodoOk(p) ? p! : hoje().slice(0, 7); const pedido = Number(url.searchParams.get("unidade")) || null; const emp = Number(url.searchParams.get("colaborador")) || null;
    const r = await divergencias(u ?? pedido, mes, { employeeId: emp });
    return [["colaborador", "unidade", "data", "tipo", "minutos", "detalhe", "situacao", "decidido_por", "decidido_em", "observacao"],
      ...r.map(x => [x.nome, x.unidade, fmtData(x.data), DIV_TIPO[x.tipo]?.rotulo ?? x.tipo, x.minutos, x.detalhe, DIV_STATUS[x.status]?.[1] ?? x.status, x.decidido_por, x.decidido_em?.slice(0, 16) ?? null, x.decisao_obs])];
  }
  return null;
}
