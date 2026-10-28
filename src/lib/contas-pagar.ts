import { sql } from "@/db";
import { can, type Session } from "./auth";
import { getSettings, hoje, addDays } from "./utils";
import { orcamentoMes, categoriaDoTipo } from "./despesas";
import { somaCentavos, fmtBr, type OpcoesFeriado } from "./parcelas";

/**
 * v27 · Contas a pagar (estilo XFIN, com a governança do ONE e as boas práticas do catálogo de controladoria):
 * - título com fornecedor, entidade (CNPJ), unidade, responsável, plano/categoria, documento (tipo, número, chave da NF-e), emissão,
 *   descrição, recorrente ou parcelado; parcelas no dia-âncora (dia útil bancário opcional), com competência e boleto por parcela;
 * - aprovação por alçada, orçamento e dupla checagem (duas pessoas acima do valor configurado); quem lança não aprova;
 * - programação financeira (data e conta) antes do pagamento, borderô do dia, parcela retida/contestada fora da programação;
 * - baixa só com o débito do extrato (parcela + juros − desconto = débito), sem reuso de débito, competência fechada trava,
 *   caixa reclassificado; baixa manual é exceção justificada; quem aprovou não registra o pagamento (segregação de funções);
 * - parcelas aprovadas entram no caixa projetado (na data programada, senão no vencimento) e comprometem o orçado do mês.
 */
type Cfg = Awaited<ReturnType<typeof getSettings>>;

export const CP_STATUS: Record<string, { rotulo: string; tom: string }> = {
  AGUARDANDO_APROVACAO: { rotulo: "Aguardando aprovação", tom: "PENDENTE" },
  ATIVO: { rotulo: "Em aberto", tom: "ABERTO" },
  QUITADO: { rotulo: "Quitado", tom: "QUITADO" },
  REJEITADO: { rotulo: "Rejeitado", tom: "REJEITADO" },
  CANCELADO: { rotulo: "Cancelado", tom: "CANCELADO" },
};
export const VER_CP = ["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE"];
export const veCP = (s: Session) => VER_CP.includes(s.role);
export const operaCP = (s: Session) => ["DIRECAO", "FINANCEIRO"].includes(s.role);
/** v29: aprovação de contas a pagar e baixa manual são marcadas no cargo (Configurações → Acesso por cargo). */
export const aprovaCP = (_cfg: Cfg, s: Session) => can.aprovar(s, "contasPagar");
export const baixaManualCP = (_cfg: Cfg, s: Session) => operaCP(s) && can.aprovar(s, "baixaManual");
export const numeroCP = (n: number) => `CP-${String(n).padStart(4, "0")}`;
export function opcoesFeriado(cfg: Cfg): OpcoesFeriado {
  const c = cfg.contasPagar; return { locais: (c.feriadosLocais ?? []) as string[], carnaval: c.carnavalSemBanco !== false, corpusChristi: c.corpusChristiSemBanco !== false };
}
/** Quantas aprovações o título pede: nenhuma (dentro da alçada e do orçamento), uma, ou duas pessoas diferentes (dupla checagem). */
export function aprovacoesExigidas(cfg: Cfg, motivos: { codigo: string }[], compromisso: number) {
  if (!motivos.length) return 0; const dupla = Number(cfg.contasPagar.alcadaDuplaValor ?? 0); return dupla > 0 && compromisso >= dupla - 0.005 ? 2 : 1;
}
const dbr = (d: string) => d.slice(0, 10).split("-").reverse().join("/");
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const rotuloMesCurto = (m: string) => `${MES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const somaMeses = (m: string, n: number) => { const t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };

/** Recorte da tela: unidade travada/escolhida, entidade (inclui títulos da rede daquela entidade) ou rede inteira. */
export type EscopoCP = { unitIds: number[] | null; entidadeId: number | null; unitId: number | null };
export function filtroEscopo(e: EscopoCP) {
  if (e.unitId !== null) return sql`AND p.unit_id = ${e.unitId}`;
  if (e.entidadeId !== null) return sql`AND (p.company_id = ${e.entidadeId} OR p.unit_id = ANY(${e.unitIds ?? []}::int[]))`;
  return sql``;
}

export type SitParcela = { codigo: "PAGA" | "CANCELADA" | "VENCIDA" | "HOJE" | "LOGO" | "A_VENCER" | "AGUARDANDO" | "RETIDA"; rotulo: string; tom: string };
/** Situação de uma parcela na tela: paga, cancelada, retida, aguardando aprovação, vencida (há N dias), vence hoje, vence logo ou a vencer. */
export function situacaoParcela(p: { status: string; vencimento: string; payable_status?: string; retida?: boolean }, h: string, alertaDias: number): SitParcela {
  if (p.status === "PAGA") return { codigo: "PAGA", rotulo: "Paga", tom: "APROVADA" };
  if (p.status === "CANCELADA") return { codigo: "CANCELADA", rotulo: "Cancelada", tom: "CANCELADA" };
  if (p.retida) return { codigo: "RETIDA", rotulo: "Retida (contestação)", tom: "REJEITADA" };
  if (p.payable_status === "AGUARDANDO_APROVACAO") return { codigo: "AGUARDANDO", rotulo: "Aguardando aprovação", tom: "PENDENTE" };
  const dias = Math.round((Date.parse(p.vencimento + "T00:00:00Z") - Date.parse(h + "T00:00:00Z")) / 86400000);
  if (dias < 0) return { codigo: "VENCIDA", rotulo: `Vencida há ${-dias} dia(s)`, tom: "VENCIDO" };
  if (dias === 0) return { codigo: "HOJE", rotulo: "Vence hoje", tom: "VENCE_EM_BREVE" };
  if (dias <= alertaDias) return { codigo: "LOGO", rotulo: `Vence em ${dias} dia(s)`, tom: "VENCE_EM_BREVE" };
  return { codigo: "A_VENCER", rotulo: "A vencer", tom: "ABERTO" };
}

export type MotivoCP = { codigo: "ALCADA" | "ORCAMENTO" | "SEM_ORCAMENTO" | "NATUREZA"; texto: string };
export const MOTIVO_ROTULO: Record<MotivoCP["codigo"], string> = { ALCADA: "Acima da alçada", ORCAMENTO: "Estoura o orçado", SEM_ORCAMENTO: "Sem orçamento", NATUREZA: "Natureza da despesa" };

/** v27 · natureza da despesa (controladoria): separa o dia a dia recorrente dos investimentos e dos gastos extraordinários. */
export const NATUREZAS = {
  OPERACAO: { rotulo: "Operação do dia a dia", curto: "operação", dica: "o que se repete: aluguel, contas de consumo, serviços, materiais" },
  INVESTIMENTO: { rotulo: "Investimento", curto: "investimento", dica: "o que fica para a escola: obra, reforma, equipamento, mobiliário" },
  EXTRAORDINARIA: { rotulo: "Extraordinária", curto: "extraordinária", dica: "fora do previsto e não se repete: conserto emergencial, multa, evento único" },
} as const;
export type Natureza = keyof typeof NATUREZAS;
export const ehNatureza = (x: string): x is Natureza => Object.prototype.hasOwnProperty.call(NATUREZAS, x);

/**
 * Por que este título precisa da aprovação de quem tem a alçada:
 * - compromisso total (soma das parcelas) a partir da alçada configurada;
 * - parcela que, somada ao realizado do caixa e ao já comprometido (outras parcelas e despesas aprovadas), passa do orçado da categoria no mês;
 * - categoria sem orçamento no mês numa unidade que orça o ano.
 */
export async function motivosAprovacao(cfg: Cfg, o: { unitId: number | null; categoria: string; parcelas: { vencimento: string; valor: number }[]; ignorarPayableId?: number | null; natureza?: string | null }): Promise<MotivoCP[]> {
  const out: MotivoCP[] = []; const c = cfg.contasPagar; const alcada = Number(c.alcadaValor ?? 0);
  const total = somaCentavos(o.parcelas.map(p => p.valor));
  if (alcada > 0 && total >= alcada - 0.005) out.push({ codigo: "ALCADA", texto: `Compromisso de ${fmtBr(total)} — a partir de ${fmtBr(alcada)} quem tem a alçada aprova.` });
  if (o.natureza && ehNatureza(o.natureza) && ((c.naturezaSempreAprova ?? []) as string[]).includes(o.natureza)) out.push({ codigo: "NATUREZA", texto: `${NATUREZAS[o.natureza].rotulo}: sempre passa pela aprovação de quem tem a alçada, de qualquer valor (Configurações → Contas a pagar).` });
  if (c.exigirOrcamento && o.unitId !== null) {
    const unit = o.unitId; const porMes = new Map<string, number>();
    for (const p of o.parcelas) { const m = p.vencimento.slice(0, 7); porMes.set(m, (porMes.get(m) ?? 0) + p.valor); }
    const meses = [...porMes.keys()].sort().slice(0, 24); const mesAtual = hoje().slice(0, 7);
    const outros = await sql<{ mes: string; valor: number }[]>`SELECT to_char(i.vencimento, 'YYYY-MM') AS mes, sum(i.valor)::float AS valor FROM payable_installments i JOIN payables p ON p.id=i.payable_id
      WHERE i.status='A_PAGAR' AND p.status IN ('ATIVO','AGUARDANDO_APROVACAO') AND p.unit_id=${unit} AND p.categoria=${o.categoria} AND to_char(i.vencimento, 'YYYY-MM') = ANY(${meses}::text[]) ${o.ignorarPayableId ? sql`AND p.id <> ${o.ignorarPayableId}` : sql``} GROUP BY 1`;
    const outrosMes = new Map(outros.map(x => [x.mes, x.valor]));
    const reqs = await sql<{ codigo: string; valor: number }[]>`SELECT t.codigo, sum(r.valor)::float AS valor FROM requests r JOIN request_types t ON t.id=r.type_id WHERE r.status='APROVADA' AND r.valor > 0 AND r.pago_em IS NULL AND r.unit_id=${unit} GROUP BY 1`;
    const reqCat = reqs.filter(r => categoriaDoTipo(cfg, r.codigo) === o.categoria).reduce((a, r) => a + r.valor, 0);
    const estouros: string[] = []; const semOrc: string[] = [];
    for (const m of meses) {
      const orc = await orcamentoMes(m, [unit]); if (!orc.orcam.has(unit)) continue; // a unidade não orça esse ano
      const k = orc.chave(unit, o.categoria); const orcado = orc.orc.get(k); const v = porMes.get(m) ?? 0;
      if (orcado === undefined || orcado <= 0) { semOrc.push(rotuloMesCurto(m)); continue; }
      const usado = (orc.real.get(k) ?? 0) + (outrosMes.get(m) ?? 0) + (m === mesAtual ? reqCat : 0);
      if (usado + v > orcado + 0.005) estouros.push(`${rotuloMesCurto(m)} (${Math.round((100 * (usado + v)) / orcado)}% do orçado de ${fmtBr(orcado)})`);
    }
    if (semOrc.length) out.push({ codigo: "SEM_ORCAMENTO", texto: `“${o.categoria}” não tem orçamento na unidade em ${semOrc.slice(0, 6).join(", ")}${semOrc.length > 6 ? ` e mais ${semOrc.length - 6} mês(es)` : ""}.` });
    if (estouros.length) out.push({ codigo: "ORCAMENTO", texto: `“${o.categoria}” passa do orçado em ${estouros.slice(0, 4).join(", ")}${estouros.length > 4 ? ` e mais ${estouros.length - 4} mês(es)` : ""} (realizado + comprometido + este título).` });
  }
  return out;
}

export type LinhaParcela = {
  id: number; payable_id: number; numero: number; parcela: number; parcelas: number; fornecedor: string; descricao: string; categoria: string; unidade: string | null; unit_id: number | null; entidade: string | null;
  tipo_documento: string; numero_documento: string | null; emissao: string; vencimento: string; competencia: string | null; valor: number; status: string; pago_em: string | null; valor_pago: number | null; baixa_manual: boolean;
  payable_status: string; recorrente: boolean; retida: boolean; programado_para: string | null; conta_programada: string | null; tem_boleto: boolean;
  conta_codigo?: string | null; // v28 · conta do plano
};
export const FILTROS_SIT: Record<string, string> = {
  abertas: "Em aberto", vencidas: "Vencidas", hoje: "Vencem hoje", "7d": "Próximos 7 dias", "30d": "Próximos 30 dias", aprogramar: "A programar (até 7 dias)", programadas: "Programadas",
  retidas: "Retidas (contestação)", aprovacao: "Aguardando aprovação", pagas: "Pagas no mês", manuais: "Baixas manuais", semdoc: "Títulos sem documento", todas: "Todas",
};
const SEM_DOC = sql`NOT EXISTS (SELECT 1 FROM attachments ax WHERE ax.entidade='payable' AND ax.entidade_id=p.id)`;

/** Painel de contas a pagar: indicadores, agenda, aging, orçado × pago × comprometido, competência, listas (parcelas, títulos, programação, fornecedores). */
export const POR_PAGINA = 100;
export async function painelContasPagar(e: EscopoCP, periodo: string, f: { sit: string; cat: string | null; q: string | null; de: string | null; ate: string | null; pag?: number; nat?: string | null }) {
  const cfg = await getSettings(); const h = hoje(); const alerta = Number(cfg.contasPagar.alertaDias ?? 3);
  const ini = `${periodo}-01`; const [a, m] = periodo.split("-").map(Number); const fim = new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 10);
  const fe = filtroEscopo(e); const ABERTA = sql`i.status='A_PAGAR' AND p.status='ATIVO'`;
  const [k] = await sql<{ venc_n: number; venc_v: number; hoje_n: number; hoje_v: number; d7_n: number; d7_v: number; d30_n: number; d30_v: number; pag_n: number; pag_v: number; jur_v: number; man_n: number; apr_n: number; apr_v: number; aberto_v: number; aberto_n: number; ret_n: number; ret_v: number; prog_hoje_n: number; prog_hoje_v: number; aprog_n: number; aprog_v: number }[]>`SELECT
      count(*) FILTER (WHERE ${ABERTA} AND i.vencimento < ${h}::date)::int AS venc_n, coalesce(sum(i.valor) FILTER (WHERE ${ABERTA} AND i.vencimento < ${h}::date), 0)::float AS venc_v,
      count(*) FILTER (WHERE ${ABERTA} AND i.vencimento = ${h}::date)::int AS hoje_n, coalesce(sum(i.valor) FILTER (WHERE ${ABERTA} AND i.vencimento = ${h}::date), 0)::float AS hoje_v,
      count(*) FILTER (WHERE ${ABERTA} AND i.vencimento > ${h}::date AND i.vencimento <= ${addDays(h, 7)}::date)::int AS d7_n, coalesce(sum(i.valor) FILTER (WHERE ${ABERTA} AND i.vencimento > ${h}::date AND i.vencimento <= ${addDays(h, 7)}::date), 0)::float AS d7_v,
      count(*) FILTER (WHERE ${ABERTA} AND i.vencimento > ${h}::date AND i.vencimento <= ${addDays(h, 30)}::date)::int AS d30_n, coalesce(sum(i.valor) FILTER (WHERE ${ABERTA} AND i.vencimento > ${h}::date AND i.vencimento <= ${addDays(h, 30)}::date), 0)::float AS d30_v,
      count(*) FILTER (WHERE i.status='PAGA' AND i.pago_em >= ${ini}::date AND i.pago_em < ${fim}::date)::int AS pag_n, coalesce(sum(i.valor_pago) FILTER (WHERE i.status='PAGA' AND i.pago_em >= ${ini}::date AND i.pago_em < ${fim}::date), 0)::float AS pag_v,
      coalesce(sum(i.juros) FILTER (WHERE i.status='PAGA' AND i.pago_em >= ${ini}::date AND i.pago_em < ${fim}::date), 0)::float AS jur_v,
      count(*) FILTER (WHERE i.status='PAGA' AND i.baixa_manual AND i.pago_em >= ${ini}::date AND i.pago_em < ${fim}::date)::int AS man_n,
      count(DISTINCT p.id) FILTER (WHERE p.status='AGUARDANDO_APROVACAO')::int AS apr_n, coalesce(sum(i.valor) FILTER (WHERE p.status='AGUARDANDO_APROVACAO' AND i.status='A_PAGAR'), 0)::float AS apr_v,
      coalesce(sum(i.valor) FILTER (WHERE ${ABERTA}), 0)::float AS aberto_v, count(*) FILTER (WHERE ${ABERTA})::int AS aberto_n,
      count(*) FILTER (WHERE ${ABERTA} AND i.retida)::int AS ret_n, coalesce(sum(i.valor) FILTER (WHERE ${ABERTA} AND i.retida), 0)::float AS ret_v,
      count(*) FILTER (WHERE ${ABERTA} AND i.programado_para = ${h}::date)::int AS prog_hoje_n, coalesce(sum(i.valor) FILTER (WHERE ${ABERTA} AND i.programado_para = ${h}::date), 0)::float AS prog_hoje_v,
      count(*) FILTER (WHERE ${ABERTA} AND NOT i.retida AND i.programado_para IS NULL AND i.vencimento <= ${addDays(h, 7)}::date)::int AS aprog_n, coalesce(sum(i.valor) FILTER (WHERE ${ABERTA} AND NOT i.retida AND i.programado_para IS NULL AND i.vencimento <= ${addDays(h, 7)}::date), 0)::float AS aprog_v
    FROM payable_installments i JOIN payables p ON p.id=i.payable_id WHERE true ${fe}`;
  const fs = f.sit === "vencidas" ? sql`AND ${ABERTA} AND i.vencimento < ${h}::date`
    : f.sit === "hoje" ? sql`AND ${ABERTA} AND i.vencimento = ${h}::date`
    : f.sit === "7d" ? sql`AND ${ABERTA} AND i.vencimento >= ${h}::date AND i.vencimento <= ${addDays(h, 7)}::date`
    : f.sit === "30d" ? sql`AND ${ABERTA} AND i.vencimento >= ${h}::date AND i.vencimento <= ${addDays(h, 30)}::date`
    : f.sit === "aprogramar" ? sql`AND ${ABERTA} AND NOT i.retida AND i.programado_para IS NULL AND i.vencimento <= ${addDays(h, 7)}::date`
    : f.sit === "programadas" ? sql`AND ${ABERTA} AND i.programado_para IS NOT NULL`
    : f.sit === "retidas" ? sql`AND ${ABERTA} AND i.retida`
    : f.sit === "aprovacao" ? sql`AND i.status='A_PAGAR' AND p.status='AGUARDANDO_APROVACAO'`
    : f.sit === "pagas" ? sql`AND i.status='PAGA' AND i.pago_em >= ${ini}::date AND i.pago_em < ${fim}::date`
    : f.sit === "manuais" ? sql`AND i.status='PAGA' AND i.baixa_manual`
    : f.sit === "semdoc" ? sql`AND i.status <> 'CANCELADA' AND p.status IN ('ATIVO','QUITADO','AGUARDANDO_APROVACAO') AND ${SEM_DOC}`
    : f.sit === "todas" ? sql``
    : sql`AND ${ABERTA}`;
  const termo = f.q ? `%${f.q.replace(/[%_]/g, "")}%` : null;
  const fq = termo ? sql`AND (p.fornecedor_nome ILIKE ${termo} OR p.descricao ILIKE ${termo} OR coalesce(p.numero_documento,'') ILIKE ${termo} OR ('CP-' || lpad(p.numero::text, 4, '0')) ILIKE ${termo})` : sql``;
  const fn = f.nat && ehNatureza(f.nat) ? sql`AND p.natureza=${f.nat}` : sql``;
  const filtroLista = sql`${fe} ${fs} ${fn} ${f.cat ? sql`AND p.categoria=${f.cat}` : sql``} ${fq} ${f.de ? sql`AND i.vencimento >= ${f.de}::date` : sql``} ${f.ate ? sql`AND i.vencimento <= ${f.ate}::date` : sql``}`;
  const [tot] = await sql<{ n: number; v: number }[]>`SELECT count(*)::int AS n, coalesce(sum(CASE WHEN i.status='PAGA' THEN coalesce(i.valor_pago, i.valor) ELSE i.valor END), 0)::float AS v FROM payable_installments i JOIN payables p ON p.id=i.payable_id WHERE true ${filtroLista}`;
  const paginas = Math.max(1, Math.ceil(tot.n / POR_PAGINA)); const pagina = Math.min(Math.max(1, Math.floor(f.pag ?? 1)), paginas);
  const lista = await sql<LinhaParcela[]>`SELECT i.id, i.payable_id, p.numero, i.parcela, p.parcelas, p.fornecedor_nome AS fornecedor, p.descricao, p.categoria, u.nome AS unidade, p.unit_id, co.nome AS entidade, p.tipo_documento, p.numero_documento,
      i.emissao::text, i.vencimento::text, i.competencia, i.valor::float, i.status, i.pago_em::text, i.valor_pago::float, i.baixa_manual, p.status AS payable_status, p.recorrente, i.retida, i.programado_para::text, ba.apelido AS conta_programada, (i.codigo_barras IS NOT NULL) AS tem_boleto, ca.codigo AS conta_codigo
    FROM payable_installments i JOIN payables p ON p.id=i.payable_id LEFT JOIN units u ON u.id=p.unit_id LEFT JOIN companies co ON co.id=p.company_id LEFT JOIN bank_accounts ba ON ba.id=i.conta_programada_id LEFT JOIN chart_accounts ca ON ca.id=p.conta_id
    WHERE true ${filtroLista}
    ORDER BY ${f.sit === "pagas" || f.sit === "manuais" ? sql`i.pago_em DESC, i.id DESC` : sql`i.vencimento, p.numero, i.parcela`} LIMIT ${POR_PAGINA} OFFSET ${(pagina - 1) * POR_PAGINA}`;
  const mesesComp = Array.from({ length: 12 }, (_, i) => somaMeses(h.slice(0, 7), i - 5));
  const units = e.unitId !== null ? [e.unitId] : e.unitIds ?? (await sql<{ id: number }[]>`SELECT id FROM units`).map(u => u.id);
  const [porCategoria, porFornecedor, semanas, titulos, aging, programacao, fornecedores, competencia, ind, aprov, semDoc, orc, compMes, natRows] = await Promise.all([
    sql<{ categoria: string; valor: number; n: number; vencido: number }[]>`SELECT p.categoria, sum(i.valor)::float AS valor, count(*)::int AS n, coalesce(sum(i.valor) FILTER (WHERE i.vencimento < ${h}::date), 0)::float AS vencido FROM payable_installments i JOIN payables p ON p.id=i.payable_id WHERE ${ABERTA} ${fe} GROUP BY 1 ORDER BY 2 DESC`,
    sql<{ fornecedor: string; valor: number; n: number; proximo: string }[]>`SELECT p.fornecedor_nome AS fornecedor, sum(i.valor)::float AS valor, count(*)::int AS n, min(i.vencimento)::text AS proximo FROM payable_installments i JOIN payables p ON p.id=i.payable_id WHERE ${ABERTA} ${fe} GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
    sql<{ semana: number; valor: number; n: number }[]>`SELECT CASE WHEN i.vencimento < ${h}::date THEN -1 ELSE ((i.vencimento - ${h}::date) / 7)::int END AS semana, sum(i.valor)::float AS valor, count(*)::int AS n FROM payable_installments i JOIN payables p ON p.id=i.payable_id WHERE ${ABERTA} AND i.vencimento < ${addDays(h, 56)}::date ${fe} GROUP BY 1`,
    sql<{ id: number; numero: number; fornecedor: string; descricao: string; categoria: string; unidade: string | null; entidade: string | null; recorrente: boolean; natureza: string; parcelas: number; status: string; total: number; pago: number; aberto: number; pagas: number; abertas: number; proximo: string | null; sem_doc: boolean; aguardando_dias: number | null }[]>`SELECT p.id, p.numero, p.fornecedor_nome AS fornecedor, p.descricao, p.categoria, u.nome AS unidade, co.nome AS entidade, p.recorrente, p.natureza, p.parcelas, p.status,
        coalesce(sum(i.valor) FILTER (WHERE i.status <> 'CANCELADA'), 0)::float AS total, coalesce(sum(i.valor_pago) FILTER (WHERE i.status='PAGA'), 0)::float AS pago, coalesce(sum(i.valor) FILTER (WHERE i.status='A_PAGAR'), 0)::float AS aberto,
        count(i.id) FILTER (WHERE i.status='PAGA')::int AS pagas, count(i.id) FILTER (WHERE i.status='A_PAGAR')::int AS abertas, min(i.vencimento) FILTER (WHERE i.status='A_PAGAR')::text AS proximo, ${SEM_DOC} AS sem_doc,
        CASE WHEN p.status='AGUARDANDO_APROVACAO' THEN (current_date - p.created_at::date)::int END AS aguardando_dias
      FROM payables p LEFT JOIN payable_installments i ON i.payable_id=p.id LEFT JOIN units u ON u.id=p.unit_id LEFT JOIN companies co ON co.id=p.company_id WHERE true ${fe} ${fn} ${f.cat ? sql`AND p.categoria=${f.cat}` : sql``} ${fq}
      GROUP BY p.id, u.nome, co.nome ORDER BY (p.status='AGUARDANDO_APROVACAO') DESC, (p.status='ATIVO') DESC, p.numero DESC LIMIT 300`,
    sql<{ faixa: string; valor: number; n: number }[]>`SELECT CASE WHEN ${h}::date - i.vencimento > 90 THEN 'v91' WHEN ${h}::date - i.vencimento > 60 THEN 'v61' WHEN ${h}::date - i.vencimento > 30 THEN 'v31' WHEN ${h}::date - i.vencimento > 0 THEN 'v1'
        WHEN i.vencimento - ${h}::date <= 30 THEN 'a0' WHEN i.vencimento - ${h}::date <= 60 THEN 'a31' WHEN i.vencimento - ${h}::date <= 90 THEN 'a61' ELSE 'a91' END AS faixa, sum(i.valor)::float AS valor, count(*)::int AS n
      FROM payable_installments i JOIN payables p ON p.id=i.payable_id WHERE ${ABERTA} ${fe} GROUP BY 1`,
    sql<(LinhaParcela & { conta_programada_id: number | null })[]>`SELECT i.id, i.payable_id, p.numero, i.parcela, p.parcelas, p.fornecedor_nome AS fornecedor, p.descricao, p.categoria, u.nome AS unidade, p.unit_id, co.nome AS entidade, p.tipo_documento, p.numero_documento,
        i.emissao::text, i.vencimento::text, i.competencia, i.valor::float, i.status, i.pago_em::text, i.valor_pago::float, i.baixa_manual, p.status AS payable_status, p.recorrente, i.retida, i.programado_para::text, ba.apelido AS conta_programada, i.conta_programada_id, (i.codigo_barras IS NOT NULL) AS tem_boleto
      FROM payable_installments i JOIN payables p ON p.id=i.payable_id LEFT JOIN units u ON u.id=p.unit_id LEFT JOIN companies co ON co.id=p.company_id LEFT JOIN bank_accounts ba ON ba.id=i.conta_programada_id
      WHERE ${ABERTA} AND i.programado_para IS NOT NULL ${fe} ORDER BY i.programado_para, ba.apelido NULLS LAST, p.numero, i.parcela LIMIT 500`,
    sql<{ fornecedor: string; supplier_id: number | null; pago12: number; pago30: number; pago30ant: number; aberto: number; proximo: string | null; titulos: number; recorrente: boolean; categorias: string }[]>`SELECT p.fornecedor_nome AS fornecedor, max(p.supplier_id) AS supplier_id,
        coalesce(sum(i.valor_pago) FILTER (WHERE i.status='PAGA' AND i.pago_em > ${h}::date - 365), 0)::float AS pago12, coalesce(sum(i.valor_pago) FILTER (WHERE i.status='PAGA' AND i.pago_em > ${h}::date - 30), 0)::float AS pago30,
        coalesce(sum(i.valor_pago) FILTER (WHERE i.status='PAGA' AND i.pago_em > ${h}::date - 60 AND i.pago_em <= ${h}::date - 30), 0)::float AS pago30ant,
        coalesce(sum(i.valor) FILTER (WHERE ${ABERTA}), 0)::float AS aberto, min(i.vencimento) FILTER (WHERE ${ABERTA})::text AS proximo, count(DISTINCT p.id)::int AS titulos,
        coalesce(bool_or(p.recorrente AND p.status='ATIVO'), false) AS recorrente, string_agg(DISTINCT p.categoria, ', ') AS categorias
      FROM payables p JOIN payable_installments i ON i.payable_id=p.id WHERE p.status <> 'REJEITADO' ${fe} ${fq} GROUP BY p.fornecedor_nome ORDER BY 3 DESC, 6 DESC LIMIT 200`,
    sql<{ mes: string; pago: number; aberto: number }[]>`SELECT i.competencia AS mes, coalesce(sum(i.valor_pago) FILTER (WHERE i.status='PAGA'), 0)::float AS pago, coalesce(sum(i.valor) FILTER (WHERE ${ABERTA}), 0)::float AS aberto
      FROM payable_installments i JOIN payables p ON p.id=i.payable_id WHERE i.competencia = ANY(${mesesComp}::text[]) ${fe} GROUP BY 1`,
    sql<{ pagas12: number; emdia12: number; juros12: number; manuais12: number; valor12: number }[]>`SELECT count(*) FILTER (WHERE i.status='PAGA' AND i.pago_em > ${h}::date - 365)::int AS pagas12, count(*) FILTER (WHERE i.status='PAGA' AND i.pago_em > ${h}::date - 365 AND i.pago_em <= i.vencimento)::int AS emdia12,
        coalesce(sum(i.juros) FILTER (WHERE i.status='PAGA' AND i.pago_em > ${h}::date - 365), 0)::float AS juros12, count(*) FILTER (WHERE i.status='PAGA' AND i.baixa_manual AND i.pago_em > ${h}::date - 365)::int AS manuais12,
        coalesce(sum(i.valor_pago) FILTER (WHERE i.status='PAGA' AND i.pago_em > ${h}::date - 365), 0)::float AS valor12
      FROM payable_installments i JOIN payables p ON p.id=i.payable_id WHERE true ${fe}`,
    sql<{ dias: number | null; n: number }[]>`SELECT avg(extract(epoch FROM (p.aprovado_em - p.created_at)) / 86400)::float AS dias, count(*)::int AS n FROM payables p
      WHERE p.aprovado_em IS NOT NULL AND p.aprovado_por IS DISTINCT FROM p.created_by AND p.status <> 'REJEITADO' AND p.created_at > now() - interval '365 days' ${fe}`,
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM payables p WHERE p.status IN ('ATIVO','QUITADO','AGUARDANDO_APROVACAO') AND ${SEM_DOC} ${fe}`,
    units.length ? orcamentoMes(periodo, units) : Promise.resolve(null),
    sql<{ categoria: string; valor: number }[]>`SELECT p.categoria, sum(i.valor)::float AS valor FROM payable_installments i JOIN payables p ON p.id=i.payable_id WHERE ${ABERTA} AND i.vencimento >= ${ini}::date AND i.vencimento < ${fim}::date ${fe} GROUP BY 1`,
    sql<{ natureza: string; aberto: number; pago12: number; titulos: number; aguardando: number }[]>`SELECT p.natureza, coalesce(sum(i.valor) FILTER (WHERE ${ABERTA}), 0)::float AS aberto,
        coalesce(sum(i.valor_pago) FILTER (WHERE i.status='PAGA' AND i.pago_em > ${h}::date - 365), 0)::float AS pago12,
        count(DISTINCT p.id) FILTER (WHERE p.status IN ('ATIVO','AGUARDANDO_APROVACAO'))::int AS titulos, coalesce(sum(i.valor) FILTER (WHERE p.status='AGUARDANDO_APROVACAO' AND i.status='A_PAGAR'), 0)::float AS aguardando
      FROM payables p JOIN payable_installments i ON i.payable_id=p.id WHERE p.status NOT IN ('REJEITADO','CANCELADO') ${fe} GROUP BY 1`,
  ]);
  const agenda = [-1, 0, 1, 2, 3, 4, 5, 6, 7].map(w => { const x = semanas.find(s => s.semana === w); return { rotulo: w === -1 ? "Vencidas" : w === 0 ? "Esta semana" : `até ${dbr(addDays(h, w * 7 + 6)).slice(0, 5)}`, valor: x?.valor ?? 0, n: x?.n ?? 0 }; });
  const FAIXAS: { chave: string; rotulo: string; vencida: boolean }[] = [{ chave: "v91", rotulo: "mais de 90 dias", vencida: true }, { chave: "v61", rotulo: "61 a 90 dias", vencida: true }, { chave: "v31", rotulo: "31 a 60 dias", vencida: true }, { chave: "v1", rotulo: "1 a 30 dias", vencida: true }, { chave: "a0", rotulo: "até 30 dias", vencida: false }, { chave: "a31", rotulo: "31 a 60 dias", vencida: false }, { chave: "a61", rotulo: "61 a 90 dias", vencida: false }, { chave: "a91", rotulo: "mais de 90 dias", vencida: false }];
  const agingLinhas = FAIXAS.map(x => { const r = aging.find(a => a.faixa === x.chave); return { ...x, valor: r?.valor ?? 0, n: r?.n ?? 0 }; });
  // orçado × pago (caixa) × a pagar no mês, por plano — nas unidades do recorte que orçam o ano
  const internas = (cfg.dre?.internas ?? []) as string[]; const orcPlano = new Map<string, { orcado: number; pago: number; apagar: number }>();
  const pega = (c: string) => { if (!orcPlano.has(c)) orcPlano.set(c, { orcado: 0, pago: 0, apagar: 0 }); return orcPlano.get(c)!; };
  if (orc) { for (const [kk, v] of orc.orc) { const [u, c] = kk.split("|"); if (orc.orcam.has(Number(u))) pega(c).orcado += v; } for (const [kk, v] of orc.real) { const c = kk.slice(kk.indexOf("|") + 1); if (!internas.includes(c)) pega(c).pago += v; } }
  for (const c of compMes) pega(c.categoria).apagar += c.valor;
  const orcamento = [...orcPlano.entries()].map(([categoria, v]) => ({ categoria, ...v, livre: v.orcado - v.pago - v.apagar })).filter(x => x.orcado || x.apagar || x.pago).sort((x, y) => (y.orcado + y.apagar) - (x.orcado + x.apagar));
  const comp = mesesComp.map(mm => { const r = competencia.find(c => c.mes === mm); return { mes: mm, rotulo: rotuloMesCurto(mm), pago: r?.pago ?? 0, aberto: r?.aberto ?? 0 }; });
  const i12 = ind[0]; const indicadores = { pontualidade: i12.pagas12 ? (100 * i12.emdia12) / i12.pagas12 : null, pagas12: i12.pagas12, juros12: i12.juros12, manuais12: i12.manuais12, pctManuais: i12.pagas12 ? (100 * i12.manuais12) / i12.pagas12 : null, valor12: i12.valor12, prazoAprovacao: aprov[0]?.n ? aprov[0].dias : null, aprovadas: aprov[0]?.n ?? 0, semDoc: semDoc[0]?.n ?? 0 };
  const porNatureza = (Object.keys(NATUREZAS) as Natureza[]).map(n => { const r = natRows.find(x => x.natureza === n); return { natureza: n, ...NATUREZAS[n], aberto: r?.aberto ?? 0, pago12: r?.pago12 ?? 0, titulos: r?.titulos ?? 0, aguardando: r?.aguardando ?? 0 }; });
  return { k, lista, listaTotal: tot, pagina, paginas, porCategoria, porFornecedor, agenda, aging: agingLinhas, titulos, programacao, fornecedores, orcamento, competencia: comp, indicadores, alerta, h, porNatureza };
}

export type Sugestao = { inst: number; payable: number; numero: number; parcela: number; parcelas: number; fornecedor: string; descricao: string; vencimento: string; valor: number; line: number; data: string; conta: string; historico: string | null; unico: boolean; alternativas: number };
/**
 * Débitos do extrato que parecem parcelas: mesmo valor (ao centavo), data até N dias do vencimento (ou da data programada), conta da mesma
 * unidade (ou rede), débito ainda sem vínculo, parcela não retida. “Par único” = a parcela só tem esse débito e o débito só serve a ela.
 */
export async function sugestoesBaixa(e: EscopoCP): Promise<Sugestao[]> {
  const cfg = await getSettings(); const h = hoje(); const j = Math.max(0, Math.round(Number(cfg.contasPagar.janelaExtratoDias ?? 10)));
  const r = await sql<Omit<Sugestao, "unico" | "alternativas">[]>`SELECT i.id AS inst, p.id AS payable, p.numero, i.parcela, p.parcelas, p.fornecedor_nome AS fornecedor, p.descricao, i.vencimento::text, i.valor::float, l.id AS line, l.data::text, a.apelido AS conta, l.descricao AS historico
    FROM payable_installments i JOIN payables p ON p.id=i.payable_id
    JOIN bank_lines l ON l.valor < 0 AND -l.valor = i.valor AND l.request_id IS NULL AND l.payable_installment_id IS NULL AND l.forma <> 'TRANSFERENCIA'
      AND (l.data BETWEEN i.vencimento - ${j}::int AND i.vencimento + ${j}::int OR (i.programado_para IS NOT NULL AND l.data BETWEEN i.programado_para - 2 AND i.programado_para + ${j}::int))
    JOIN bank_accounts a ON a.id=l.bank_account_id AND (p.unit_id IS NULL OR a.unit_id IS NULL OR a.unit_id=p.unit_id) AND (i.conta_programada_id IS NULL OR a.id=i.conta_programada_id)
    WHERE i.status='A_PAGAR' AND p.status='ATIVO' AND NOT i.retida AND least(i.vencimento, coalesce(i.programado_para, i.vencimento)) <= ${addDays(h, j)}::date ${filtroEscopo(e)}
    ORDER BY i.vencimento, p.numero, i.parcela, abs(l.data - i.vencimento) LIMIT 300`;
  const porInst = new Map<number, number>(), porLinha = new Map<number, number>();
  for (const x of r) { porInst.set(x.inst, (porInst.get(x.inst) ?? 0) + 1); porLinha.set(x.line, (porLinha.get(x.line) ?? 0) + 1); }
  const vistos = new Set<number>(); const out: Sugestao[] = [];
  for (const x of r) { if (vistos.has(x.inst)) continue; vistos.add(x.inst); out.push({ ...x, unico: porInst.get(x.inst) === 1 && porLinha.get(x.line) === 1, alternativas: (porInst.get(x.inst) ?? 1) - 1 }); }
  return out;
}

export type Candidato = { inst: number; id: number; data: string; valor: number; descricao: string | null; forma: string; conta: string; exato: boolean };
/** Débitos que podem ter pago cada parcela em aberto do título: valor entre 80% e 125% da parcela, de N dias antes do vencimento até hoje (ou N dias depois). */
export async function candidatosBaixa(payableId: number, unitId: number | null): Promise<Map<number, Candidato[]>> {
  const cfg = await getSettings(); const j = Math.max(0, Math.round(Number(cfg.contasPagar.janelaExtratoDias ?? 10))); const h = hoje();
  const r = await sql<Candidato[]>`SELECT i.id AS inst, c.* FROM payable_installments i CROSS JOIN LATERAL (
      SELECT l.id, l.data::text, l.valor::float, l.descricao, l.forma, a.apelido AS conta, (-l.valor = i.valor) AS exato FROM bank_lines l JOIN bank_accounts a ON a.id=l.bank_account_id
      WHERE l.valor < 0 AND l.request_id IS NULL AND l.payable_installment_id IS NULL AND -l.valor BETWEEN i.valor * 0.8 AND i.valor * 1.25
        AND l.data >= least(i.vencimento, coalesce(i.programado_para, i.vencimento)) - ${j}::int AND l.data <= greatest(i.vencimento + ${j}::int, ${h}::date) ${unitId === null ? sql`` : sql`AND (a.unit_id IS NULL OR a.unit_id=${unitId})`}
      ORDER BY (-l.valor = i.valor) DESC, abs(l.data - i.vencimento), l.id LIMIT 12) c
    WHERE i.payable_id=${payableId} AND i.status='A_PAGAR' AND NOT i.retida`;
  const m = new Map<number, Candidato[]>(); for (const x of r) { if (!m.has(x.inst)) m.set(x.inst, []); m.get(x.inst)!.push(x); }
  return m;
}
