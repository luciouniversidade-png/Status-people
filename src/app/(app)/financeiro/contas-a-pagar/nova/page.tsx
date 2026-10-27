import { redirect } from "next/navigation";
import { requireSession, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Flash, Btn } from "@/components/ui";
import { audit, getSettings, hoje } from "@/lib/utils";
import { operaCP, aprovaCP, opcoesFeriado, numeroCP, NATUREZAS } from "@/lib/contas-pagar";
import { listarContas, listarCentros, opcoesConta } from "@/lib/plano-contas";
import { INTERVALO_LABEL, type Intervalo } from "@/lib/parcelas";
import { FormContaPagar, type OpcoesCP, type InicialCP } from "../_form";
import { criarContaPagar } from "../actions";

export const dynamic = "force-dynamic";
const fmtNum = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** v27 · Lançar conta a pagar: documento + parcelas (parcelado ou recorrente) com a tabela gerada na hora e editável. ?contrato= pré-preenche; ?de= copia um título. */
export default async function NovaContaPagar({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams;
  if (!operaCP(s)) { await audit(s, "acesso negado: lançar conta a pagar", "payables", null, null, { papel: s.role }); redirect("/financeiro/contas-a-pagar"); }
  const cfg = await getSettings(); const escopo = scopeUnit(s); const h = hoje();
  const [units, fornecedores, contratos, entidades, responsaveis, contas, centros] = await Promise.all([
    sql<{ id: number; nome: string; company_id: number | null }[]>`SELECT id, nome, company_id FROM units ${escopo === null ? sql`` : sql`WHERE id=${escopo}`} ORDER BY nome`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM suppliers WHERE ativo ORDER BY nome`,
    sql<OpcoesCP["contratos"]>`SELECT c.id, c.supplier_id, sp.nome AS fornecedor, c.objeto, c.valor_mensal::float, c.unit_id FROM contracts c JOIN suppliers sp ON sp.id=c.supplier_id WHERE c.status='VIGENTE' ${escopo === null ? sql`` : sql`AND (c.unit_id IS NULL OR c.unit_id=${escopo})`} ORDER BY sp.nome, c.objeto`,
    sql<OpcoesCP["entidades"]>`SELECT id, nome, cnpj FROM companies ORDER BY nome`,
    sql<OpcoesCP["responsaveis"]>`SELECT id, nome FROM users WHERE ativo AND role NOT IN ('COLABORADOR','LEITURA') ORDER BY nome`,
    listarContas(), listarCentros(),
  ]);
  const ini: InicialCP = { unitId: escopo !== null ? String(escopo) : "", supplierId: "", fornecedorNovo: "", contractId: "", categoria: "", tipoDocumento: (cfg.contasPagar.tiposDocumento as string[])[0] ?? "Boleto", numeroDocumento: "", emissao: h, descricao: "",
    recorrente: false, valor: "", parcelas: "1", intervalo: "MENSAL", dias: "30", primeiroVencimento: "", ajustarDiaUtil: !!cfg.contasPagar.ajustarDiaUtil, obs: "", companyId: "", responsavelId: String(s.id), boleto: "", chaveNfe: "", natureza: "OPERACAO", contaId: "", centroId: "" };
  let origem: string | null = null;
  const contrato = Number(sp.contrato) || 0; const de = Number(sp.de) || 0;
  if (contrato) { const c = contratos.find(x => x.id === contrato); if (c) { Object.assign(ini, { supplierId: String(c.supplier_id), contractId: String(c.id), descricao: c.objeto.slice(0, 300), valor: c.valor_mensal ? fmtNum(c.valor_mensal) : "", recorrente: !!c.valor_mensal, parcelas: c.valor_mensal ? "12" : "1", unitId: c.unit_id ? String(c.unit_id) : ini.unitId }); origem = `Pré-preenchido do contrato “${c.objeto}” (${c.fornecedor}).`; } }
  if (de) {
    const [p] = await sql<{ numero: number; unit_id: number | null; company_id: number | null; responsavel_user_id: number | null; supplier_id: number | null; fornecedor_nome: string; contract_id: number | null; categoria: string; tipo_documento: string; descricao: string; recorrente: boolean; natureza: string; conta_id: number | null; cost_center_id: number | null; valor_total: number; parcelas: number; intervalo: string; dias_intervalo: number | null; ajustar_dia_util: boolean }[]>`SELECT numero, unit_id, company_id, responsavel_user_id, supplier_id, fornecedor_nome, contract_id, categoria, tipo_documento, descricao, recorrente, natureza, conta_id, cost_center_id, valor_total::float, parcelas, intervalo, dias_intervalo, ajustar_dia_util FROM payables WHERE id=${de} ${escopo === null ? sql`` : sql`AND unit_id=${escopo}`}`;
    if (p) { const temFornecedor = p.supplier_id && fornecedores.some(f => f.id === p.supplier_id);
      Object.assign(ini, { unitId: p.unit_id ? String(p.unit_id) : "", supplierId: temFornecedor ? String(p.supplier_id) : "novo", fornecedorNovo: temFornecedor ? "" : p.fornecedor_nome, contractId: p.contract_id && contratos.some(c => c.id === p.contract_id) ? String(p.contract_id) : "", categoria: p.categoria, tipoDocumento: p.tipo_documento, descricao: p.descricao, natureza: p.natureza, contaId: p.conta_id ? String(p.conta_id) : "", centroId: p.cost_center_id ? String(p.cost_center_id) : "",
        recorrente: p.recorrente, valor: fmtNum(p.valor_total), parcelas: String(p.parcelas), intervalo: (p.intervalo in INTERVALO_LABEL ? p.intervalo : "MENSAL") as Intervalo, dias: String(p.dias_intervalo ?? 30), ajustarDiaUtil: p.ajustar_dia_util,
        companyId: p.company_id && !p.unit_id ? String(p.company_id) : "", responsavelId: p.responsavel_user_id && responsaveis.some(r => r.id === p.responsavel_user_id) ? String(p.responsavel_user_id) : String(s.id) });
      origem = `Copiado de ${numeroCP(p.numero)} — confira o 1º vencimento e o documento.`; }
  }
  const o: OpcoesCP = { units, podeRede: escopo === null, entidades, responsaveis, fornecedores, contratos, categorias: cfg.financeiro.categoriasSaida as string[], tipos: cfg.contasPagar.tiposDocumento as string[], alcada: Number(cfg.contasPagar.alcadaValor ?? 0), aprova: aprovaCP(cfg, s), feriados: opcoesFeriado(cfg), hoje: h,
    naturezas: Object.entries(NATUREZAS).map(([codigo, x]) => ({ codigo, rotulo: x.rotulo, dica: x.dica })), naturezasAprovam: (cfg.contasPagar.naturezaSempreAprova ?? []) as string[],
    contas: opcoesConta(contas, "SAIDA"), centros: centros.filter(c => c.ativo && (escopo === null || c.unit_id === null || c.unit_id === escopo)).map(c => ({ id: c.id, codigo: c.codigo, nome: c.nome, tipo: c.tipo, unit_id: c.unit_id })), exigirConta: cfg.planoContas?.exigirContaContasPagar !== false };
  return (
    <Page title="Nova conta a pagar" sub="Dados do documento, regra das parcelas e a tabela gerada na hora: confira, ajuste o que precisar e salve." actions={<Btn kind="ghost" href="/financeiro/contas-a-pagar">Contas a pagar</Btn>}>
      <Flash erro={sp.erro} />
      {origem && <p className="mb-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-acao">{origem}</p>}
      <FormContaPagar o={o} ini={ini} action={criarContaPagar} erro={!!sp.erro} />
    </Page>
  );
}
