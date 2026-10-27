import { sql } from "@/db";
import type { Session } from "./auth";
import { hoje } from "./utils";
import { veCP, numeroCP, situacaoParcela, CP_STATUS, NATUREZAS, type Natureza } from "./contas-pagar";
import { lerBoleto } from "./documentos-fiscais";

type Linha = (string | number | null)[];
const n2 = (v: number | null | undefined) => v === null || v === undefined ? null : Math.round(v * 100) / 100;
const dataOk = (d: string | null) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);

/** Exportações da v27 (contas a pagar): null = tipo desconhecido aqui; "negado" = sem permissão. Escopo da unidade respeitado. */
export async function exportarV27(tipo: string, s: Session, u: number | null, url: URL): Promise<Linha[] | null | "negado"> {
  if (tipo !== "contas-a-pagar" && tipo !== "contas-a-pagar-bordero") return null;
  if (!veCP(s)) return "negado";
  const pedida = Number(url.searchParams.get("unidade")) || null; const unitId = u ?? pedida; const h = hoje();
  const fu = unitId === null ? sql`` : sql`AND p.unit_id=${unitId}`;
  if (tipo === "contas-a-pagar-bordero") {
    const d = url.searchParams.get("data"); const data = dataOk(d) ? d! : h;
    const r = await sql<{ numero: number; parcela: number; parcelas: number; fornecedor: string; descricao: string; categoria: string; unidade: string | null; entidade: string | null; cnpj: string | null; tipo_documento: string; numero_documento: string | null; vencimento: string; valor: number; codigo_barras: string | null; conta: string | null; competencia: string | null }[]>`
      SELECT p.numero, i.parcela, p.parcelas, p.fornecedor_nome AS fornecedor, p.descricao, p.categoria, un.nome AS unidade, co.nome AS entidade, co.cnpj, p.tipo_documento, p.numero_documento, i.vencimento::text, i.valor::float, i.codigo_barras, ba.apelido AS conta, i.competencia
      FROM payable_installments i JOIN payables p ON p.id=i.payable_id LEFT JOIN units un ON un.id=p.unit_id LEFT JOIN companies co ON co.id=coalesce(p.company_id, un.company_id) LEFT JOIN bank_accounts ba ON ba.id=i.conta_programada_id
      WHERE i.status='A_PAGAR' AND p.status='ATIVO' AND NOT i.retida AND i.programado_para=${data}::date ${fu} ORDER BY ba.apelido NULLS LAST, p.fornecedor_nome, p.numero, i.parcela`;
    const total = r.reduce((a, x) => a + x.valor, 0);
    return [[`Borderô de pagamentos de ${data.split("-").reverse().join("/")} · ${r.length} parcela(s) · total ${n2(total)} · a baixa é feita com o débito do extrato`],
      ["conta", "titulo", "parcela", "fornecedor", "descricao", "plano", "unidade", "entidade", "cnpj_entidade", "documento", "numero_documento", "linha_digitavel", "vencimento", "competencia", "valor"],
      ...r.map(x => { const b = x.codigo_barras ? lerBoleto(x.codigo_barras, h) : null; return [x.conta ?? "a definir", numeroCP(x.numero), `${x.parcela}/${x.parcelas}`, x.fornecedor, x.descricao, x.categoria, x.unidade ?? "Rede", x.entidade, x.cnpj, x.tipo_documento, x.numero_documento, b?.ok ? b.linhaFormatada : null, x.vencimento, x.competencia, n2(x.valor)]; }),
      ["", "", "", "", "", "", "", "", "", "", "", "", "", "TOTAL", n2(total)]];
  }
  const sit = url.searchParams.get("sit"); const cat = url.searchParams.get("cat"); const nat = url.searchParams.get("nat");
  const filtro = sit === "todas" ? sql`` : sit === "pagas" ? sql`AND i.status='PAGA'` : sit === "vencidas" ? sql`AND i.status='A_PAGAR' AND p.status='ATIVO' AND i.vencimento < ${h}::date` : sit === "aprovacao" ? sql`AND i.status='A_PAGAR' AND p.status='AGUARDANDO_APROVACAO'` : sit === "retidas" ? sql`AND i.status='A_PAGAR' AND i.retida` : sql`AND i.status='A_PAGAR' AND p.status IN ('ATIVO','AGUARDANDO_APROVACAO')`;
  const r = await sql<{ numero: number; parcela: number; parcelas: number; fornecedor: string; descricao: string; categoria: string; unidade: string | null; entidade: string | null; cnpj: string | null; tipo_documento: string; numero_documento: string | null; chave_nfe: string | null; emissao: string; vencimento: string; competencia: string | null; valor: number; status: string; payable_status: string; retida: boolean; programado_para: string | null; pago_em: string | null; valor_pago: number | null; juros: number; desconto: number; baixa_manual: boolean; conta_debito: string | null; responsavel: string | null; boleto: boolean; recorrente: boolean; natureza: string; conta: string | null; centro: string | null }[]>`
    SELECT p.numero, i.parcela, p.parcelas, p.fornecedor_nome AS fornecedor, p.descricao, p.categoria, un.nome AS unidade, co.nome AS entidade, co.cnpj, p.tipo_documento, p.numero_documento, p.chave_nfe, i.emissao::text, i.vencimento::text, i.competencia, i.valor::float, i.status, p.status AS payable_status, i.retida, i.programado_para::text, i.pago_em::text, i.valor_pago::float, i.juros::float, i.desconto::float, i.baixa_manual,
      ba.apelido AS conta_debito, ur.nome AS responsavel, (i.codigo_barras IS NOT NULL) AS boleto, p.recorrente, p.natureza, ca.codigo || ' ' || ca.nome AS conta, cc.codigo || ' · ' || cc.nome AS centro
    FROM payable_installments i JOIN payables p ON p.id=i.payable_id LEFT JOIN units un ON un.id=p.unit_id LEFT JOIN companies co ON co.id=coalesce(p.company_id, un.company_id) LEFT JOIN bank_lines l ON l.id=i.bank_line_id LEFT JOIN bank_accounts ba ON ba.id=l.bank_account_id LEFT JOIN users ur ON ur.id=p.responsavel_user_id LEFT JOIN chart_accounts ca ON ca.id=p.conta_id LEFT JOIN cost_centers cc ON cc.id=p.cost_center_id
    WHERE true ${filtro} ${fu} ${cat ? sql`AND p.categoria=${cat}` : sql``} ${nat && nat in NATUREZAS ? sql`AND p.natureza=${nat}` : sql``} ORDER BY i.vencimento, p.numero, i.parcela LIMIT 20000`;
  return [["titulo", "parcela", "fornecedor", "descricao", "plano", "unidade", "entidade", "cnpj_entidade", "responsavel", "documento", "numero_documento", "chave_nfe", "boleto_vinculado", "recorrente", "natureza", "conta_plano", "centro_custo", "emissao", "vencimento", "competencia", "valor", "situacao_parcela", "situacao_titulo", "programado_para", "pago_em", "valor_pago", "juros_multa", "desconto", "forma_baixa", "conta_debito"],
    ...r.map(x => [numeroCP(x.numero), `${x.parcela}/${x.parcelas}`, x.fornecedor, x.descricao, x.categoria, x.unidade ?? "Rede", x.entidade, x.cnpj, x.responsavel, x.tipo_documento, x.numero_documento, x.chave_nfe, x.boleto ? "sim" : "não", x.recorrente ? "sim" : "não", NATUREZAS[x.natureza as Natureza]?.curto ?? x.natureza, x.conta, x.centro, x.emissao, x.vencimento, x.competencia,
      n2(x.valor), situacaoParcela({ status: x.status, vencimento: x.vencimento, payable_status: x.payable_status, retida: x.retida }, h, 0).rotulo, CP_STATUS[x.payable_status]?.rotulo ?? x.payable_status, x.programado_para, x.pago_em, n2(x.valor_pago), n2(x.juros), n2(x.desconto), x.status === "PAGA" ? (x.baixa_manual ? "manual (exceção)" : "débito do extrato") : null, x.conta_debito])];
}
