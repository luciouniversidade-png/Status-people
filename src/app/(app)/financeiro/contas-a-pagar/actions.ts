"use server";
import { usuariosQueAprovam } from "@/lib/acesso";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit, type Session } from "@/lib/auth";
import { audit, str, int, hoje, caminhoSeguro, getSettings } from "@/lib/utils";
import { competenciaFechada, mensagemTrava } from "@/lib/conciliacao";
import { notificar } from "@/lib/comunicacao";
import { aprovaCP, operaCP, baixaManualCP, motivosAprovacao, aprovacoesExigidas, numeroCP, opcoesFeriado, MOTIVO_ROTULO, NATUREZAS, ehNatureza, type MotivoCP } from "@/lib/contas-pagar";
import { contaParaLancar, classificarPelaBaixa, garantirCentrosPadrao } from "@/lib/plano-contas";
import { gerarParcelas, lerValorBr, somaCentavos, fmtBr, fmtDataBr, proximoDiaUtil, INTERVALO_LABEL, type Intervalo } from "@/lib/parcelas";
import { lerBoleto, lerChaveNFe } from "@/lib/documentos-fiscais";
import { comMensagem } from "@/lib/redirecionar";

type Cfg = Awaited<ReturnType<typeof getSettings>>;
const go = (b: string, k: "ok" | "erro", msg: string) => comMensagem(b, k, msg);
const dataOk = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + "T00:00:00Z")) && d >= "2000-01-01" && d <= "2100-12-31" && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;
const mesOk = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const r2 = (v: number) => Math.round(v * 100) / 100;
const msgErro = (e: unknown) => e instanceof Error ? e.message : "Erro inesperado.";
const BASE = "/financeiro/contas-a-pagar";

type Aprovacao = { userId: number; nome: string; at: string };
type Titulo = { id: number; numero: number; unit_id: number | null; company_id: number | null; supplier_id: number | null; fornecedor_nome: string; contract_id: number | null; categoria: string; descricao: string; recorrente: boolean; natureza: string; conta_id: number | null; cost_center_id: number | null; valor_total: number; parcelas: number; intervalo: string; dias_intervalo: number | null; primeiro_vencimento: string | null; ajustar_dia_util: boolean; emissao: string; status: string; created_by: number | null; aprovacoes: Aprovacao[]; aprovacoes_necessarias: number };
type Parcela = { id: number; payable_id: number; parcela: number; emissao: string; vencimento: string; competencia: string | null; valor: number; status: string; pago_em: string | null; valor_pago: number | null; juros: number; desconto: number; bank_line_id: number | null; baixa_manual: boolean; retida: boolean; programado_para: string | null; codigo_barras: string | null };

async function titulo(id: number): Promise<Titulo> {
  const [p] = await sql<Titulo[]>`SELECT id, numero, unit_id, company_id, supplier_id, fornecedor_nome, contract_id, categoria, descricao, recorrente, natureza, conta_id, cost_center_id, valor_total::float, parcelas, intervalo, dias_intervalo, primeiro_vencimento::text, ajustar_dia_util, emissao::text, status, created_by, aprovacoes, aprovacoes_necessarias FROM payables WHERE id=${id}`;
  return p;
}
async function parcela(id: number): Promise<Parcela> {
  const [i] = await sql<Parcela[]>`SELECT id, payable_id, parcela, emissao::text, vencimento::text, competencia, valor::float, status, pago_em::text, valor_pago::float, juros::float, desconto::float, bank_line_id, baixa_manual, retida, programado_para::text, codigo_barras FROM payable_installments WHERE id=${id}`;
  return i;
}
function noEscopo(s: Session, unitId: number | null) { const e = scopeUnit(s); return e === null || unitId === e; }
async function negar(s: Session, acao: string, id: number | null) { await audit(s, `acesso negado: ${acao}`, "payables", id, null, { papel: s.role }); }
async function evento(payableId: number, s: Session, texto: string) { await sql`INSERT INTO payable_events (payable_id, user_nome, texto) VALUES (${payableId}, ${s.nome}, ${texto.slice(0, 1500)})`; }
/** ATIVO ↔ QUITADO conforme as parcelas; sem parcela paga nem a pagar o título vira CANCELADO. */
async function recalcularStatus(payableId: number) {
  await sql`UPDATE payables p SET status = CASE
      WHEN NOT EXISTS (SELECT 1 FROM payable_installments i WHERE i.payable_id=p.id AND i.status='A_PAGAR') AND EXISTS (SELECT 1 FROM payable_installments i WHERE i.payable_id=p.id AND i.status='PAGA') THEN 'QUITADO'
      WHEN NOT EXISTS (SELECT 1 FROM payable_installments i WHERE i.payable_id=p.id AND i.status IN ('A_PAGAR','PAGA')) THEN 'CANCELADO'
      WHEN p.status='QUITADO' THEN 'ATIVO' ELSE p.status END, updated_at=now()
    WHERE p.id=${payableId} AND p.status IN ('ATIVO','QUITADO')`;
}
async function aprovadores(_cfg: Cfg, excluir: number[]) {
  // v29: quem tem a aprovação de contas a pagar no cargo (ou no padrão da atuação)
  return (await usuariosQueAprovam("contasPagar")).filter(id => !excluir.includes(id));
}
const rotuloParcela = (p: { numero: number; parcelas: number }, i: { parcela: number }) => `${numeroCP(p.numero)} · parcela ${i.parcela}/${p.parcelas}`;
/** Segregação de funções: quem aprovou o título não registra o pagamento dele. */
function segregacao(cfg: Cfg, s: Session, p: Titulo) {
  if (cfg.contasPagar.segregarAprovarPagar && (p.aprovacoes ?? []).some(a => a.userId === s.id)) throw new Error("Segregação de funções: quem aprovou o título não registra o pagamento — outra pessoa do Financeiro faz a baixa.");
}
/** O boleto confere com a parcela? Valor igual (quando o boleto traz valor) e vencimento igual ou o próximo dia útil. */
function conferirBoleto(cfg: Cfg, b: { valor: number | null; vencimento: string | null }, parc: { valor: number; vencimento: string }) {
  if (b.valor !== null && Math.abs(b.valor - parc.valor) >= 0.005) throw new Error(`O boleto é de ${fmtBr(b.valor)} e a parcela de ${fmtBr(parc.valor)} — altere a parcela antes (renegociação) ou confira o boleto.`);
  const venc = b.vencimento; if (!venc) return null;
  return venc === parc.vencimento || proximoDiaUtil(venc, opcoesFeriado(cfg)) === parc.vencimento ? null : venc;
}

// ======================================================================= LANÇAR
/** Lança o título com as parcelas da tabela (editadas ou não). Sem tabela (navegador sem script), gera as parcelas no servidor. */
export async function criarContaPagar(fd: FormData) {
  const s = await requireSession(); const back = `${BASE}/nova`; let destino = BASE; let msg = "";
  try {
    if (!operaCP(s)) { await negar(s, "lançar conta a pagar", null); throw new Error("Contas a pagar são lançadas pelo Financeiro ou pela Direção."); }
    const cfg = await getSettings(); const c = cfg.contasPagar; const escopo = scopeUnit(s); const h = hoje();
    const unitId = int(fd, "unitId") || null;
    if (escopo !== null) assert(unitId === escopo, "Lance só para a sua unidade.");
    let companyId: number | null = null;
    if (unitId !== null) { const [u] = await sql<{ id: number; company_id: number | null }[]>`SELECT id, company_id FROM units WHERE id=${unitId}`; assert(!!u, "Unidade não encontrada."); companyId = u.company_id; }
    else { const ents = await sql<{ id: number }[]>`SELECT id FROM companies`; const pedida = int(fd, "companyId") || null;
      if (ents.length) { assert(!!pedida && ents.some(x => x.id === pedida), "Conta da rede: escolha a entidade (CNPJ) que paga — os registros fiscais não se misturam."); companyId = pedida; } }
    // v28 · conta do plano de contas (a categoria vem dela) e centro de custo (padrão: o da conta — corporativo ou o geral da unidade)
    const contaPedida = int(fd, "contaId") || null; let categoria = ""; let contaId: number | null = null; let centroPadraoConta: string | null = null; let economico: string | null = null;
    if (contaPedida) { const rc = await contaParaLancar(contaPedida, "SAIDA"); if ("erro" in rc) throw new Error(rc.erro); assert(rc.conta.tipo_economico !== "TRANSFERENCIA", "Transferência entre contas não é conta a pagar.");
      contaId = rc.conta.id; categoria = rc.conta.categoria!; centroPadraoConta = rc.conta.centro_padrao; economico = rc.conta.tipo_economico; }
    else { assert(cfg.planoContas?.exigirContaContasPagar === false, "Escolha a conta do plano de contas (a categoria vem dela)."); categoria = str(fd, "categoria"); assert((cfg.financeiro.categoriasSaida as string[]).includes(categoria), "Escolha a categoria da despesa."); }
    let centroId = int(fd, "centroId") || null;
    if (centroId) { const [cc] = await sql<{ ativo: boolean }[]>`SELECT ativo FROM cost_centers WHERE id=${centroId}`; assert(!!cc?.ativo, "Centro de custo inativo ou inexistente."); }
    else if (contaId) { await garantirCentrosPadrao(); const [cc] = centroPadraoConta === "CORPORATIVO" || unitId === null ? await sql<{ id: number }[]>`SELECT id FROM cost_centers WHERE tipo='CORPORATIVO' AND ativo ORDER BY id LIMIT 1` : await sql<{ id: number }[]>`SELECT id FROM cost_centers WHERE tipo='UNIDADE' AND unit_id=${unitId} AND ativo ORDER BY id LIMIT 1`; centroId = cc?.id ?? null; }
    if (cfg.planoContas?.exigirCentroCusto) assert(!!centroId, "Informe o centro de custo.");
    const tipoDocumento = str(fd, "tipoDocumento") || "Boleto"; assert((c.tiposDocumento as string[]).includes(tipoDocumento), "Tipo de documento inválido.");
    const numeroDocumento = str(fd, "numeroDocumento").slice(0, 60) || null;
    const emissao = str(fd, "emissao"); assert(dataOk(emissao), "Informe a data de emissão.");
    const descricao = str(fd, "descricao"); assert(descricao.length >= 2, "Descreva a conta (ex.: ALUGUEL)."); assert(descricao.length <= 300, "Descrição longa demais (até 300 caracteres).");
    const recorrente = str(fd, "recorrente") === "1";
    const naturezaPedida = str(fd, "natureza") || "OPERACAO"; if (!ehNatureza(naturezaPedida)) throw new Error("Escolha a natureza da despesa (operação, investimento ou extraordinária).");
    const natureza = economico === "CAPEX" ? "INVESTIMENTO" : naturezaPedida; // conta de investimento (CAPEX) é investimento
    const valor = lerValorBr(str(fd, "valor")); assert(Number.isFinite(valor) && valor > 0, recorrente ? "Informe o valor de cada parcela." : "Informe o valor total."); assert(valor <= 100_000_000, "Valor acima do limite.");
    const n = int(fd, "parcelas") ?? 1; assert(n >= 1 && n <= 240, "Quantidade de parcelas: de 1 a 240.");
    const intervalo = str(fd, "intervalo") as Intervalo; assert(intervalo in INTERVALO_LABEL, "Escolha o intervalo das parcelas.");
    const dias = intervalo === "DIAS" ? int(fd, "dias") ?? 0 : null; if (intervalo === "DIAS") assert(!!dias && dias >= 1 && dias <= 365, "Intervalo em dias: de 1 a 365.");
    const venc1 = str(fd, "primeiroVencimento"); assert(dataOk(venc1), "Informe o dia do primeiro vencimento."); assert(venc1 >= emissao, "O primeiro vencimento não pode ser antes da emissão.");
    const ajustar = str(fd, "ajustarDiaUtil") === "1"; const obs = str(fd, "obs").slice(0, 2000) || null;
    // responsável pela despesa (padrão: quem lança)
    const respPedido = int(fd, "responsavelId") || s.id; const [resp] = await sql<{ id: number }[]>`SELECT id FROM users WHERE id=${respPedido} AND ativo`; assert(!!resp, "Responsável não encontrado.");
    // fornecedor: do cadastro ou novo (cadastrado na hora, se marcado)
    const sup = str(fd, "supplierId"); let supplierId: number | null = null; let fornecedor = "";
    if (sup && sup !== "novo") { const [f] = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM suppliers WHERE id=${Number(sup) || 0}`; assert(!!f, "Fornecedor não encontrado."); supplierId = f.id; fornecedor = f.nome; }
    else { fornecedor = str(fd, "fornecedorNovo").replace(/\s+/g, " "); assert(fornecedor.length >= 2, "Informe o fornecedor."); assert(fornecedor.length <= 160, "Nome do fornecedor longo demais."); }
    const contractId = int(fd, "contractId") || null;
    if (contractId) { const [k] = await sql<{ supplier_id: number }[]>`SELECT supplier_id FROM contracts WHERE id=${contractId}`; assert(!!k, "Contrato não encontrado."); if (supplierId) assert(k.supplier_id === supplierId, "O contrato é de outro fornecedor."); else supplierId = k.supplier_id; }
    // documento fiscal: chave de acesso (DV conferido; a mesma nota não entra duas vezes)
    let chaveNfe: string | null = null; const chaveTxt = str(fd, "chaveNfe");
    if (chaveTxt) { const ch = lerChaveNFe(chaveTxt); if (!ch.ok) throw new Error(`Chave da NF-e: ${ch.erro}`); chaveNfe = ch.chave;
      const [d] = await sql<{ numero: number }[]>`SELECT numero FROM payables WHERE chave_nfe=${chaveNfe} AND status NOT IN ('REJEITADO','CANCELADO') LIMIT 1`; if (d) throw new Error(`Esta NF-e já está lançada em ${numeroCP(d.numero)} — pagamento em duplicidade bloqueado.`); }
    // parcelas: as da tabela (o que a pessoa conferiu) ou geradas aqui
    const bruto = str(fd, "parcelasJson"); let parcelas: { parcela: number; emissao: string; vencimento: string; valor: number; competencia: string }[];
    if (bruto) {
      let lido: unknown; try { lido = JSON.parse(bruto); } catch { throw new Error("Tabela de parcelas ilegível — gere de novo."); }
      assert(Array.isArray(lido) && lido.length === n, `A tabela tem ${Array.isArray(lido) ? lido.length : 0} parcela(s) e a quantidade informada é ${n} — gere de novo.`);
      parcelas = (lido as Record<string, unknown>[]).map((x, i) => {
        const venc = String(x.vencimento ?? ""); const em = String(x.emissao ?? emissao); const v = typeof x.valor === "number" ? r2(x.valor) : lerValorBr(String(x.valor ?? "")); const comp = String(x.competencia ?? "") || em.slice(0, 7);
        assert(dataOk(venc), `Parcela ${i + 1}: vencimento inválido.`); assert(dataOk(em), `Parcela ${i + 1}: emissão inválida.`); assert(Number.isFinite(v) && v > 0, `Parcela ${i + 1}: valor inválido.`); assert(mesOk(comp), `Parcela ${i + 1}: competência inválida (AAAA-MM).`);
        return { parcela: i + 1, emissao: em, vencimento: venc, valor: v, competencia: comp };
      });
    } else parcelas = gerarParcelas({ valor, parcelas: n, recorrente, primeiroVencimento: venc1, emissao, intervalo, dias: dias ?? undefined, ajustarDiaUtil: ajustar, feriados: opcoesFeriado(cfg) }).map(p => ({ parcela: p.parcela, emissao: p.emissao, vencimento: p.vencimento, valor: p.valor, competencia: p.emissao.slice(0, 7) }));
    const total = somaCentavos(parcelas.map(p => p.valor));
    if (!recorrente) assert(Math.abs(total - valor) < 0.005, `A soma das parcelas (${fmtBr(total)}) não bate com o valor total (${fmtBr(valor)}). Ajuste a tabela ou gere de novo.`);
    // boleto da 1ª parcela: linha digitável conferida, sem reuso, valor e vencimento batendo
    let boleto: string | null = null; const boletoTxt = str(fd, "boleto");
    if (boletoTxt) { const b = lerBoleto(boletoTxt, h); if (!b.ok) throw new Error(`Boleto: ${b.erro}`); boleto = b.codigoBarras;
      const dif = conferirBoleto(cfg, b, parcelas[0]); if (dif) throw new Error(`O boleto vence em ${fmtDataBr(dif)} e a 1ª parcela em ${fmtDataBr(parcelas[0].vencimento)} — ajuste o 1º vencimento.`);
      const [d] = await sql<{ numero: number; parcela: number }[]>`SELECT p.numero, i.parcela FROM payable_installments i JOIN payables p ON p.id=i.payable_id WHERE i.codigo_barras=${boleto} AND i.status <> 'CANCELADA' LIMIT 1`; if (d) throw new Error(`Este boleto já está em ${numeroCP(d.numero)} (parcela ${d.parcela}) — pagamento em duplicidade bloqueado.`); }
    // duplicidade: mesmo fornecedor e documento (ou mesmo fornecedor, valor e 1º vencimento) num título vivo
    if (str(fd, "duplicadoOk") !== "1") {
      const [d] = await sql<{ numero: number }[]>`SELECT numero FROM payables WHERE status NOT IN ('REJEITADO','CANCELADO') AND lower(fornecedor_nome)=lower(${fornecedor})
        AND ((${numeroDocumento}::text IS NOT NULL AND numero_documento=${numeroDocumento}) OR (valor_total=${valor} AND primeiro_vencimento=${venc1}::date)) LIMIT 1`;
      if (d) throw new Error(`Parece duplicado: ${numeroCP(d.numero)} já tem o mesmo fornecedor e ${numeroDocumento ? "número de documento" : "valor e 1º vencimento"}. Se não for, marque “não é duplicado” e salve de novo.`);
    }
    const motivos: MotivoCP[] = await motivosAprovacao(cfg, { unitId, categoria, parcelas, natureza });
    const necessarias = aprovacoesExigidas(cfg, motivos, total); const aprova = aprovaCP(cfg, s);
    const aprovacoes: Aprovacao[] = necessarias && aprova ? [{ userId: s.id, nome: s.nome, at: new Date().toISOString() }] : [];
    const status = aprovacoes.length >= necessarias ? "ATIVO" : "AGUARDANDO_APROVACAO";
    if (!supplierId && str(fd, "cadastrar") === "1") { const [f] = await sql<{ id: number }[]>`INSERT INTO suppliers (nome, servico, ativo) VALUES (${fornecedor}, ${categoria}, true) RETURNING id`; supplierId = f.id; await audit(s, "cadastrar fornecedor (contas a pagar)", "suppliers", f.id, null, { nome: fornecedor }); }
    const novo = await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(270001)`;
      const [{ prox }] = await tx<{ prox: number }[]>`SELECT coalesce(max(numero), 0)::int + 1 AS prox FROM payables`;
      const [p] = await tx<{ id: number }[]>`INSERT INTO payables (numero, unit_id, company_id, supplier_id, fornecedor_nome, contract_id, responsavel_user_id, categoria, conta_id, cost_center_id, tipo_documento, numero_documento, chave_nfe, emissao, descricao, recorrente, natureza, valor_total, parcelas, intervalo, dias_intervalo, primeiro_vencimento, ajustar_dia_util, status, motivos_aprovacao, aprovacoes, aprovacoes_necessarias, aprovado_por, aprovado_em, obs, created_by)
        VALUES (${prox}, ${unitId}, ${companyId}, ${supplierId}, ${fornecedor}, ${contractId}, ${resp.id}, ${categoria}, ${contaId}, ${centroId}, ${tipoDocumento}, ${numeroDocumento}, ${chaveNfe}, ${emissao}, ${descricao}, ${recorrente}, ${natureza}, ${valor}, ${n}, ${intervalo}, ${dias}, ${venc1}, ${ajustar}, ${status}, ${motivos.length ? JSON.stringify(motivos) : null}::jsonb, ${JSON.stringify(aprovacoes)}::jsonb, ${necessarias},
          ${status === "ATIVO" && aprovacoes.length ? s.id : null}, ${status === "ATIVO" && aprovacoes.length ? new Date().toISOString() : null}, ${obs}, ${s.id}) RETURNING id`;
      for (const x of parcelas) await tx`INSERT INTO payable_installments (payable_id, parcela, emissao, vencimento, valor, competencia, codigo_barras) VALUES (${p.id}, ${x.parcela}, ${x.emissao}, ${x.vencimento}, ${x.valor}, ${x.competencia}, ${x.parcela === 1 ? boleto : null})`;
      return { id: p.id, numero: prox };
    });
    await evento(novo.id, s, `Lançada: ${n} parcela(s) ${recorrente ? `recorrentes de ${fmtBr(valor)}` : `somando ${fmtBr(total)}`}${natureza !== "OPERACAO" ? ` · ${NATUREZAS[natureza].curto}` : ""} · ${INTERVALO_LABEL[intervalo].toLowerCase()} · 1º vencimento ${fmtDataBr(parcelas[0].vencimento)}${ajustar ? " (dia útil)" : ""}${chaveNfe ? " · NF-e conferida" : ""}${boleto ? " · boleto da 1ª parcela conferido" : ""}.`);
    if (motivos.length) await evento(novo.id, s, status === "ATIVO" ? `Aprovada no lançamento por quem tem a alçada: ${motivos.map(m => MOTIVO_ROTULO[m.codigo]).join(", ")}.` : `Aguardando ${necessarias === 2 ? (aprovacoes.length ? "a 2ª aprovação (dupla checagem; a 1ª é de quem lançou)" : "duas aprovações de pessoas diferentes (dupla checagem)") : "aprovação"}: ${motivos.map(m => m.texto).join(" ")}`);
    await audit(s, "lançar conta a pagar", "payables", novo.id, null, { numero: novo.numero, fornecedor, categoria, contaId, centroId, natureza, unitId, companyId, recorrente, valor, parcelas: n, compromisso: total, status, motivos: motivos.map(m => m.codigo), aprovacoesNecessarias: necessarias, nfe: !!chaveNfe, boleto: !!boleto });
    if (status === "AGUARDANDO_APROVACAO") await notificar(await aprovadores(cfg, [s.id]), "Conta a pagar aguardando aprovação", `${numeroCP(novo.numero)} · ${fmtBr(total)} · ${categoria}`, `${BASE}/${novo.id}`, "ACAO", `cpaprov:${novo.id}`);
    destino = `${BASE}/${novo.id}`; msg = status === "ATIVO" ? `${numeroCP(novo.numero)} lançada com ${n} parcela(s) — já entra no caixa projetado.` : `${numeroCP(novo.numero)} lançada e enviada para aprovação (${motivos.map(m => MOTIVO_ROTULO[m.codigo].toLowerCase()).join(", ")}${necessarias === 2 ? "; dupla checagem" : ""}).`;
  } catch (e) { redirect(go(back, "erro", msgErro(e))); }
  redirect(go(destino, "ok", msg));
}

// ======================================================================= APROVAR / REJEITAR (com dupla checagem)
export async function decidirContaPagar(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const b = `${BASE}/${id}`; const decisao = str(fd, "decisao"); let msg = "";
  try {
    const cfg = await getSettings(); if (!aprovaCP(cfg, s)) { await negar(s, "decidir conta a pagar", id); throw new Error("Só quem tem a alçada de contas a pagar decide (Configurações → Contas a pagar)."); }
    const p = await titulo(id); assert(!!p, "Título não encontrado."); assert(noEscopo(s, p.unit_id), "Título de outra unidade."); assert(p.status === "AGUARDANDO_APROVACAO", "Este título não está aguardando aprovação.");
    assert(p.created_by !== s.id, "Quem lançou não aprova o próprio título — outra pessoa com a alçada decide.");
    const ja = (p.aprovacoes ?? []); assert(!ja.some(a => a.userId === s.id), "Você já aprovou este título: a dupla checagem pede outra pessoa.");
    const motivo = str(fd, "motivo").slice(0, 1000);
    if (decisao === "APROVAR") {
      const novas = [...ja, { userId: s.id, nome: s.nome, at: new Date().toISOString() }]; const completa = novas.length >= Math.max(1, p.aprovacoes_necessarias);
      await sql`UPDATE payables SET aprovacoes=${JSON.stringify(novas)}::jsonb, status=${completa ? "ATIVO" : "AGUARDANDO_APROVACAO"}, aprovado_por=${completa ? s.id : null}, aprovado_em=${completa ? new Date().toISOString() : null}, updated_at=now() WHERE id=${id} AND status='AGUARDANDO_APROVACAO'`;
      await evento(id, s, completa ? `Aprovada${novas.length > 1 ? ` (${novas.length}ª aprovação — dupla checagem completa)` : ""}${motivo ? `: ${motivo}` : "."}` : `1ª aprovação de ${p.aprovacoes_necessarias} (dupla checagem)${motivo ? `: ${motivo}` : ""} — falta outra pessoa com a alçada.`);
      await audit(s, "aprovar conta a pagar", "payables", id, { status: p.status, aprovacoes: ja.length }, { status: completa ? "ATIVO" : "AGUARDANDO_APROVACAO", aprovacoes: novas.length, motivo: motivo || null });
      if (!completa) await notificar(await aprovadores(cfg, [...novas.map(a => a.userId), p.created_by ?? 0]), "Conta a pagar: falta a 2ª aprovação", `${numeroCP(p.numero)} · ${p.categoria} · dupla checagem`, b, "ACAO", `cpaprov2:${id}`);
      msg = completa ? "Aprovada — as parcelas entram no caixa projetado e podem ser programadas e baixadas." : "1ª aprovação registrada — a dupla checagem pede outra pessoa com a alçada.";
    } else if (decisao === "REJEITAR") {
      assert(motivo.length >= 5, "Explique o motivo da rejeição.");
      await sql.begin(async tx => { await tx`UPDATE payables SET status='REJEITADO', motivo_rejeicao=${motivo}, aprovado_por=${s.id}, aprovado_em=now(), updated_at=now() WHERE id=${id}`; await tx`UPDATE payable_installments SET status='CANCELADA', programado_para=NULL, conta_programada_id=NULL, updated_at=now() WHERE payable_id=${id} AND status='A_PAGAR'`; });
      await evento(id, s, `Rejeitada: ${motivo}`); await audit(s, "rejeitar conta a pagar", "payables", id, { status: p.status }, { status: "REJEITADO", motivo });
      msg = "Rejeitada — parcelas canceladas.";
    } else throw new Error("Decisão inválida.");
    if (p.created_by) await notificar([p.created_by], decisao === "APROVAR" ? "Conta a pagar aprovada" : "Conta a pagar rejeitada", `${numeroCP(p.numero)} · ${p.categoria}`, b, "INFO", `cpdec:${id}:${decisao}:${(p.aprovacoes ?? []).length}`);
  } catch (e) { redirect(go(b, "erro", msgErro(e))); }
  redirect(go(b, "ok", msg));
}

// ======================================================================= BAIXA COM O DÉBITO DO EXTRATO
/** Núcleo da baixa: valida parcela, título, débito (sem reuso, unidade, valor = parcela + juros − desconto), retenção, segregação e competência; concilia e reclassifica o caixa. */
async function baixarComDebito(s: Session, cfg: Cfg, instId: number, lineId: number, juros: number, desconto: number) {
  const i = await parcela(instId); assert(!!i, "Parcela não encontrada."); const p = await titulo(i.payable_id); assert(!!p, "Título não encontrado.");
  assert(noEscopo(s, p.unit_id), "Título de outra unidade.");
  assert(p.status === "ATIVO", p.status === "AGUARDANDO_APROVACAO" ? "Este título ainda aguarda aprovação — a baixa vem depois." : "Título fora de aberto (quitado, cancelado ou rejeitado)."); assert(i.status === "A_PAGAR", "Esta parcela não está a pagar.");
  assert(!i.retida, "Parcela retida (em contestação): libere antes de pagar."); segregacao(cfg, s, p);
  assert(Number.isFinite(juros) && juros >= 0 && Number.isFinite(desconto) && desconto >= 0, "Juros/multa e desconto: valores positivos (ou zero)."); assert(desconto < i.valor, "Desconto maior que a parcela.");
  const [l] = await sql<{ data: string; valor: number; request_id: number | null; payable_installment_id: number | null; apelido: string; unit_id: number | null; cash_entry_id: number | null }[]>`SELECT l.data::text, l.valor::float, l.request_id, l.payable_installment_id, a.apelido, a.unit_id, l.cash_entry_id FROM bank_lines l JOIN bank_accounts a ON a.id=l.bank_account_id WHERE l.id=${lineId}`;
  assert(!!l, "Lançamento do extrato não encontrado."); assert(l.valor < 0, "Escolha um débito (saída) do extrato.");
  assert(!l.request_id, "Este débito já pagou uma solicitação de despesa."); assert(!l.payable_installment_id, "Este débito já pagou outra parcela.");
  if (p.unit_id !== null && l.unit_id !== null) assert(l.unit_id === p.unit_id, `O débito é da conta ${l.apelido}, de outra unidade.`);
  const esperado = r2(i.valor + juros - desconto); const debito = r2(Math.abs(l.valor));
  if (Math.abs(debito - esperado) >= 0.005) { const dif = r2(debito - esperado); throw new Error(`O débito (${fmtBr(debito)}) não fecha com a parcela (${fmtBr(i.valor)}${juros ? ` + juros ${fmtBr(juros)}` : ""}${desconto ? ` − desconto ${fmtBr(desconto)}` : ""} = ${fmtBr(esperado)}): diferença de ${fmtBr(Math.abs(dif))} — informe ${dif > 0 ? "juros/multa" : "desconto"}.`); }
  const trava = await competenciaFechada(l.data, l.unit_id ?? p.unit_id); if (trava) throw new Error(mensagemTrava(trava));
  const desc = `${rotuloParcela(p, i)} · ${p.descricao}`.slice(0, 300);
  await sql.begin(async tx => {
    const ok = await tx`UPDATE bank_lines SET payable_installment_id=${instId}, status='CONCILIADO', classe='DESPESA', classificado_por=${s.id} WHERE id=${lineId} AND payable_installment_id IS NULL AND request_id IS NULL RETURNING id`;
    if (!ok.length) throw new Error("Este débito acabou de ser usado em outra baixa.");
    const up = await tx`UPDATE payable_installments SET status='PAGA', pago_em=${l.data}, valor_pago=${debito}, juros=${juros}, desconto=${desconto}, bank_line_id=${lineId}, baixa_manual=false, motivo_baixa=NULL, pago_por=${s.id}, updated_at=now() WHERE id=${instId} AND status='A_PAGAR' AND NOT retida RETURNING id`;
    if (!up.length) throw new Error("Esta parcela acabou de ser baixada.");
  });
  if (l.cash_entry_id) { const [ce] = await sql<{ categoria: string }[]>`SELECT categoria FROM cash_entries WHERE id=${l.cash_entry_id}`;
    if (ce && ce.categoria !== p.categoria) { await sql`UPDATE cash_entries SET categoria=${p.categoria}, descricao=${desc}, reclassificado_em=now() WHERE id=${l.cash_entry_id}`; await audit(s, "reclassificar lançamento de caixa", "cash_entries", l.cash_entry_id, { categoria: ce.categoria }, { categoria: p.categoria, motivo: `Baixa de ${rotuloParcela(p, i)}` }); }
    await classificarPelaBaixa(s, l.cash_entry_id, p.conta_id, p.cost_center_id); } // v28 · o caixa herda a conta e o centro do título
  await recalcularStatus(p.id);
  await evento(p.id, s, `Parcela ${i.parcela}/${p.parcelas} paga em ${fmtDataBr(l.data)} · ${fmtBr(debito)} · débito da conta ${l.apelido} (conciliado)${juros ? ` · juros/multa ${fmtBr(juros)}` : ""}${desconto ? ` · desconto ${fmtBr(desconto)}` : ""}${l.data > i.vencimento ? ` · ${Math.round((Date.parse(l.data) - Date.parse(i.vencimento)) / 86400000)} dia(s) depois do vencimento` : ""}.`);
  await audit(s, "baixar parcela de conta a pagar", "payable_installments", instId, { status: "A_PAGAR" }, { status: "PAGA", pagoEm: l.data, debito: lineId, valorPago: debito, juros, desconto });
  return p;
}
export async function registrarBaixaParcela(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const b = caminhoSeguro(str(fd, "voltar"), BASE);
  try {
    if (!operaCP(s)) { await negar(s, "baixar parcela de conta a pagar", id); throw new Error("A baixa é registrada pelo Financeiro ou pela Direção."); }
    const lineId = int(fd, "lineId") ?? 0; assert(lineId > 0, "Escolha o débito do extrato que pagou esta parcela.");
    const juros = str(fd, "juros") ? lerValorBr(str(fd, "juros")) : 0, desconto = str(fd, "desconto") ? lerValorBr(str(fd, "desconto")) : 0;
    await baixarComDebito(s, await getSettings(), id, lineId, juros, desconto);
  } catch (e) { redirect(go(b, "erro", msgErro(e))); }
  redirect(go(b, "ok", "Parcela paga com o débito conciliado."));
}
/** Confirma de uma vez os pares sugeridos (mesmo valor, data na janela): cada um passa pela mesma validação da baixa individual. */
export async function confirmarSugestoes(fd: FormData) {
  const s = await requireSession(); const b = caminhoSeguro(str(fd, "voltar"), BASE); let ok = 0; const falhas: string[] = [];
  try {
    if (!operaCP(s)) { await negar(s, "confirmar baixas sugeridas", null); throw new Error("A baixa é registrada pelo Financeiro ou pela Direção."); }
    const pares = fd.getAll("par").map(String).map(x => x.split(":").map(Number)).filter(x => x.length === 2 && x[0] > 0 && x[1] > 0);
    assert(pares.length > 0, "Marque ao menos um par para confirmar."); assert(pares.length <= 100, "Até 100 pares por vez."); const cfg = await getSettings();
    for (const [inst, line] of pares) { try { await baixarComDebito(s, cfg, inst, line, 0, 0); ok++; } catch (e) { falhas.push(msgErro(e)); } }
  } catch (e) { redirect(go(b, "erro", msgErro(e))); }
  redirect(falhas.length ? go(b, ok ? "ok" : "erro", `${ok} baixa(s) confirmada(s); ${falhas.length} não: ${falhas.slice(0, 3).join(" · ")}`) : go(b, "ok", `${ok} baixa(s) confirmada(s) com o débito do extrato.`));
}

// ======================================================================= BAIXA MANUAL (EXCEÇÃO)
export async function baixaManualParcela(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const b = caminhoSeguro(str(fd, "voltar"), BASE);
  try {
    const cfg = await getSettings(); if (!baixaManualCP(cfg, s)) { await negar(s, "baixa manual de conta a pagar", id); throw new Error("Baixa manual: perfil sem permissão (Configurações → Contas a pagar)."); }
    const i = await parcela(id); assert(!!i, "Parcela não encontrada."); const p = await titulo(i.payable_id); assert(!!p, "Título não encontrado."); assert(noEscopo(s, p.unit_id), "Título de outra unidade.");
    assert(p.status === "ATIVO", p.status === "AGUARDANDO_APROVACAO" ? "Este título ainda aguarda aprovação — a baixa vem depois." : "Título fora de aberto."); assert(i.status === "A_PAGAR", "Esta parcela não está a pagar.");
    assert(!i.retida, "Parcela retida (em contestação): libere antes de pagar."); segregacao(cfg, s, p);
    const data = str(fd, "data"); assert(dataOk(data), "Informe a data do pagamento."); assert(data <= hoje(), "A data do pagamento não pode estar no futuro.");
    const valorPago = lerValorBr(str(fd, "valorPago")); assert(Number.isFinite(valorPago) && valorPago > 0, "Informe o valor pago.");
    const forma = str(fd, "forma"); assert((cfg.contasPagar.tiposDocumento as string[]).includes(forma), "Escolha como foi pago.");
    const motivo = str(fd, "motivo"); assert(motivo.length >= 15, "Baixa manual é exceção: explique por que não há débito no extrato (mín. 15 caracteres).");
    const trava = await competenciaFechada(data, p.unit_id); if (trava) throw new Error(mensagemTrava(trava));
    const dif = r2(valorPago - i.valor);
    const up = await sql`UPDATE payable_installments SET status='PAGA', pago_em=${data}, valor_pago=${valorPago}, juros=${dif > 0 ? dif : 0}, desconto=${dif < 0 ? -dif : 0}, bank_line_id=NULL, baixa_manual=true, motivo_baixa=${`${forma}: ${motivo}`.slice(0, 1000)}, pago_por=${s.id}, updated_at=now() WHERE id=${id} AND status='A_PAGAR' AND NOT retida RETURNING id`;
    assert(up.length > 0, "Esta parcela acabou de ser baixada.");
    await recalcularStatus(p.id);
    await evento(p.id, s, `Parcela ${i.parcela}/${p.parcelas}: BAIXA MANUAL (sem débito do extrato) em ${fmtDataBr(data)} · ${fmtBr(valorPago)} · ${forma} — ${motivo}`);
    await audit(s, "baixa manual de conta a pagar", "payable_installments", id, { status: "A_PAGAR" }, { status: "PAGA", pagoEm: data, valorPago, forma, motivo, semDebito: true });
    if (s.role !== "DIRECAO") await notificar((await sql<{ id: number }[]>`SELECT id FROM users WHERE ativo AND role='DIRECAO'`).map(u => u.id), "Baixa manual em contas a pagar", `${rotuloParcela(p, i)} · ${fmtBr(valorPago)} — sem débito do extrato`, `${BASE}/${p.id}`, "ALERTA", `cpmanual:${id}`);
  } catch (e) { redirect(go(b, "erro", msgErro(e))); }
  redirect(go(b, "ok", "Baixa manual registrada (exceção auditada). Se foi em dinheiro, lance a saída no caixa."));
}

// ======================================================================= DESFAZER
export async function desfazerBaixaParcela(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const b = caminhoSeguro(str(fd, "voltar"), BASE);
  try {
    if (!operaCP(s)) { await negar(s, "desfazer baixa de conta a pagar", id); throw new Error("Só Financeiro e Direção desfazem a baixa."); }
    const motivo = str(fd, "motivo"); assert(motivo.length >= 5, "Explique o motivo.");
    const i = await parcela(id); assert(!!i && i.status === "PAGA", "Não há baixa registrada nesta parcela."); const p = await titulo(i.payable_id); assert(!!p && noEscopo(s, p.unit_id), "Título de outra unidade.");
    assert(["ATIVO", "QUITADO", "CANCELADO"].includes(p.status), "Título rejeitado não tem baixa a desfazer.");
    let dataTrava = i.pago_em!; let unitTrava = p.unit_id;
    if (i.bank_line_id) { const [l] = await sql<{ data: string; unit_id: number | null }[]>`SELECT l.data::text, a.unit_id FROM bank_lines l JOIN bank_accounts a ON a.id=l.bank_account_id WHERE l.id=${i.bank_line_id}`; if (l) { dataTrava = l.data; unitTrava = l.unit_id ?? p.unit_id; } }
    const t = await competenciaFechada(dataTrava, unitTrava); if (t) throw new Error(mensagemTrava(t));
    await sql.begin(async tx => {
      if (i.bank_line_id) await tx`UPDATE bank_lines SET payable_installment_id=NULL, status='IGNORADO', classe=NULL WHERE id=${i.bank_line_id} AND payable_installment_id=${id}`;
      await tx`UPDATE payable_installments SET status='A_PAGAR', pago_em=NULL, valor_pago=NULL, juros=0, desconto=0, bank_line_id=NULL, baixa_manual=false, motivo_baixa=NULL, pago_por=NULL, updated_at=now() WHERE id=${id}`;
      if (p.status === "QUITADO") await tx`UPDATE payables SET status='ATIVO', updated_at=now() WHERE id=${p.id}`;
    });
    await evento(p.id, s, `Parcela ${i.parcela}/${p.parcelas}: baixa desfeita — ${motivo}`);
    await audit(s, "desfazer baixa de conta a pagar", "payable_installments", id, { status: "PAGA", pagoEm: i.pago_em, debito: i.bank_line_id, manual: i.baixa_manual }, { status: "A_PAGAR", motivo });
  } catch (e) { redirect(go(b, "erro", msgErro(e))); }
  redirect(go(b, "ok", "Baixa desfeita — a parcela voltou a pagar e o débito ficou livre."));
}

// ======================================================================= PROGRAMAÇÃO FINANCEIRA
/** Programa parcelas aprovadas para uma data (e conta): entram no caixa projetado nessa data e no borderô do dia. Retidas ficam de fora. */
export async function programarParcelas(fd: FormData) {
  const s = await requireSession(); const b = caminhoSeguro(str(fd, "voltar"), BASE); let msg = "";
  try {
    if (!operaCP(s)) { await negar(s, "programar pagamentos", null); throw new Error("Pagamentos são programados pelo Financeiro ou pela Direção."); }
    const ids = [...new Set(fd.getAll("ids").map(x => Number(x)).filter(x => Number.isInteger(x) && x > 0))]; assert(ids.length > 0, "Marque ao menos uma parcela."); assert(ids.length <= 300, "Até 300 parcelas por vez.");
    const data = str(fd, "data"); assert(dataOk(data), "Informe a data do pagamento."); assert(data >= hoje(), "A programação não pode ser no passado.");
    const contaId = int(fd, "contaId") || null; let conta: { id: number; apelido: string; unit_id: number | null } | null = null;
    if (contaId) { const [c] = await sql<{ id: number; apelido: string; unit_id: number | null; ativo: boolean }[]>`SELECT id, apelido, unit_id, ativo FROM bank_accounts WHERE id=${contaId}`; assert(!!c && c.ativo, "Conta bancária não encontrada."); conta = c; }
    const rows = await sql<{ id: number; parcela: number; valor: number; status: string; retida: boolean; payable_id: number; numero: number; parcelas: number; unit_id: number | null; pstatus: string }[]>`SELECT i.id, i.parcela, i.valor::float, i.status, i.retida, p.id AS payable_id, p.numero, p.parcelas, p.unit_id, p.status AS pstatus FROM payable_installments i JOIN payables p ON p.id=i.payable_id WHERE i.id = ANY(${ids}::int[])`;
    const validas = rows.filter(r => r.status === "A_PAGAR" && r.pstatus === "ATIVO" && !r.retida && noEscopo(s, r.unit_id) && (!conta || conta.unit_id === null || r.unit_id === null || conta.unit_id === r.unit_id));
    assert(validas.length > 0, "Nenhuma das parcelas marcadas pode ser programada (só aprovadas, a pagar, não retidas e da mesma unidade da conta).");
    await sql`UPDATE payable_installments SET programado_para=${data}, conta_programada_id=${conta?.id ?? null}, programado_por=${s.id}, programado_em=now(), updated_at=now() WHERE id = ANY(${validas.map(v => v.id)}::int[])`;
    const porTitulo = new Map<number, typeof validas>(); for (const v of validas) { if (!porTitulo.has(v.payable_id)) porTitulo.set(v.payable_id, []); porTitulo.get(v.payable_id)!.push(v); }
    for (const [pid, vs] of porTitulo) await evento(pid, s, `Programada(s) para ${fmtDataBr(data)}${conta ? ` na conta ${conta.apelido}` : ""}: parcela(s) ${vs.map(v => `${v.parcela}/${v.parcelas}`).join(", ")}.`);
    const total = somaCentavos(validas.map(v => v.valor));
    await audit(s, "programar pagamentos de contas a pagar", "payable_installments", null, null, { data, conta: conta?.id ?? null, parcelas: validas.map(v => v.id), total });
    msg = `${validas.length} parcela(s) programada(s) para ${fmtDataBr(data)} · ${fmtBr(total)}${rows.length > validas.length ? ` (${rows.length - validas.length} ficaram de fora: retida, aguardando aprovação ou de outra unidade)` : ""}.`;
  } catch (e) { redirect(go(b, "erro", msgErro(e))); }
  redirect(go(b, "ok", msg));
}
export async function desprogramarParcela(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const b = caminhoSeguro(str(fd, "voltar"), BASE);
  try {
    if (!operaCP(s)) { await negar(s, "desprogramar pagamento", id); throw new Error("Só Financeiro e Direção mexem na programação."); }
    const i = await parcela(id); assert(!!i && i.status === "A_PAGAR" && !!i.programado_para, "Esta parcela não está programada."); const p = await titulo(i.payable_id); assert(!!p && noEscopo(s, p.unit_id), "Título de outra unidade.");
    await sql`UPDATE payable_installments SET programado_para=NULL, conta_programada_id=NULL, programado_por=NULL, programado_em=NULL, updated_at=now() WHERE id=${id}`;
    await evento(p.id, s, `Parcela ${i.parcela}/${p.parcelas}: retirada da programação de ${fmtDataBr(i.programado_para!)}.`);
    await audit(s, "desprogramar pagamento de conta a pagar", "payable_installments", id, { programadoPara: i.programado_para }, { programadoPara: null });
  } catch (e) { redirect(go(b, "erro", msgErro(e))); }
  redirect(go(b, "ok", "Parcela fora da programação — volta a entrar no caixa projetado pelo vencimento."));
}

// ======================================================================= RETENÇÃO (CONTESTAÇÃO)
export async function reterParcela(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const b = caminhoSeguro(str(fd, "voltar"), BASE); const reter = str(fd, "acao") !== "liberar";
  try {
    if (!operaCP(s)) { await negar(s, reter ? "reter parcela" : "liberar parcela", id); throw new Error("Só Financeiro e Direção retêm ou liberam parcelas."); }
    const motivo = str(fd, "motivo"); assert(motivo.length >= 5, reter ? "Explique a contestação (nota errada, serviço não prestado…)." : "Explique por que a parcela foi liberada.");
    const i = await parcela(id); assert(!!i && i.status === "A_PAGAR", "Só parcela a pagar é retida ou liberada."); const p = await titulo(i.payable_id); assert(!!p && noEscopo(s, p.unit_id), "Título de outra unidade."); assert(["ATIVO", "AGUARDANDO_APROVACAO"].includes(p.status), "Título fora de aberto.");
    assert(reter ? !i.retida : i.retida, reter ? "A parcela já está retida." : "A parcela não está retida.");
    if (reter) await sql`UPDATE payable_installments SET retida=true, motivo_retencao=${motivo.slice(0, 1000)}, retida_por=${s.id}, retida_em=now(), programado_para=NULL, conta_programada_id=NULL, updated_at=now() WHERE id=${id}`;
    else await sql`UPDATE payable_installments SET retida=false, updated_at=now() WHERE id=${id}`;
    await evento(p.id, s, `Parcela ${i.parcela}/${p.parcelas} ${reter ? `RETIDA (contestação)${i.programado_para ? " e retirada da programação" : ""}` : "liberada para pagamento"} — ${motivo}`);
    await audit(s, reter ? "reter parcela de conta a pagar" : "liberar parcela de conta a pagar", "payable_installments", id, { retida: i.retida }, { retida: reter, motivo });
  } catch (e) { redirect(go(b, "erro", msgErro(e))); }
  redirect(go(b, "ok", reter ? "Parcela retida: fica fora da programação e da baixa até ser liberada." : "Parcela liberada para programar e pagar."));
}

// ======================================================================= BOLETO DA PARCELA
export async function registrarBoletoParcela(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const b = caminhoSeguro(str(fd, "voltar"), BASE); let msg = "";
  try {
    if (!operaCP(s)) { await negar(s, "registrar boleto de parcela", id); throw new Error("Só Financeiro e Direção registram boletos."); }
    const cfg = await getSettings(); const i = await parcela(id); assert(!!i && i.status === "A_PAGAR", "Só parcela a pagar recebe boleto."); const p = await titulo(i.payable_id); assert(!!p && noEscopo(s, p.unit_id), "Título de outra unidade.");
    if (str(fd, "remover") === "1") { assert(!!i.codigo_barras, "A parcela não tem boleto."); await sql`UPDATE payable_installments SET codigo_barras=NULL, updated_at=now() WHERE id=${id}`; await evento(p.id, s, `Parcela ${i.parcela}/${p.parcelas}: boleto removido.`); await audit(s, "remover boleto de parcela", "payable_installments", id, { boleto: true }, { boleto: false }); msg = "Boleto removido."; }
    else {
      const bol = lerBoleto(str(fd, "boleto"), hoje()); if (!bol.ok) throw new Error(`Boleto: ${bol.erro}`);
      const [d] = await sql<{ numero: number; parcela: number }[]>`SELECT p.numero, i.parcela FROM payable_installments i JOIN payables p ON p.id=i.payable_id WHERE i.codigo_barras=${bol.codigoBarras} AND i.status <> 'CANCELADA' AND i.id <> ${id} LIMIT 1`;
      if (d) throw new Error(`Este boleto já está em ${numeroCP(d.numero)} (parcela ${d.parcela}) — pagamento em duplicidade bloqueado.`);
      const novoVenc = conferirBoleto(cfg, bol, i);
      await sql`UPDATE payable_installments SET codigo_barras=${bol.codigoBarras}, vencimento=${novoVenc ?? i.vencimento}, updated_at=now() WHERE id=${id}`;
      await evento(p.id, s, `Parcela ${i.parcela}/${p.parcelas}: boleto ${bol.bancoNome ?? bol.segmento ?? ""} conferido${bol.valor ? ` (${fmtBr(bol.valor)})` : ""}${novoVenc ? ` · vencimento ajustado ao boleto: ${fmtDataBr(i.vencimento)} → ${fmtDataBr(novoVenc)}` : ""}.`);
      await audit(s, "registrar boleto de parcela", "payable_installments", id, { vencimento: i.vencimento, boleto: !!i.codigo_barras }, { vencimento: novoVenc ?? i.vencimento, boleto: true });
      msg = novoVenc ? `Boleto conferido — vencimento ajustado para ${fmtDataBr(novoVenc)}.` : "Boleto conferido e vinculado à parcela.";
    }
  } catch (e) { redirect(go(b, "erro", msgErro(e))); }
  redirect(go(b, "ok", msg));
}

// ======================================================================= EDITAR / CANCELAR / ESTENDER
export async function editarParcela(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const b = caminhoSeguro(str(fd, "voltar"), BASE);
  try {
    if (!operaCP(s)) { await negar(s, "editar parcela de conta a pagar", id); throw new Error("Só Financeiro e Direção alteram parcelas."); }
    const cfg = await getSettings(); const i = await parcela(id); assert(!!i && i.status === "A_PAGAR", "Só parcela a pagar é alterada."); const p = await titulo(i.payable_id); assert(!!p && noEscopo(s, p.unit_id), "Título de outra unidade.");
    assert(["ATIVO", "AGUARDANDO_APROVACAO"].includes(p.status), "Título fora de aberto.");
    const venc = str(fd, "vencimento"); assert(dataOk(venc), "Vencimento inválido."); const valor = lerValorBr(str(fd, "valor")); assert(Number.isFinite(valor) && valor > 0, "Valor inválido.");
    const comp = str(fd, "competencia") || i.competencia || i.emissao.slice(0, 7); assert(mesOk(comp), "Competência inválida (AAAA-MM).");
    const motivo = str(fd, "motivo"); assert(motivo.length >= 5, "Explique o motivo da alteração (renegociação, novo boleto…).");
    assert(venc !== i.vencimento || Math.abs(valor - i.valor) >= 0.005 || comp !== i.competencia, "Nada mudou.");
    if (i.codigo_barras && Math.abs(valor - i.valor) >= 0.005) throw new Error("A parcela tem boleto: remova o boleto antigo e registre o novo (com o novo valor).");
    if (valor > i.valor + 0.005 && !aprovaCP(cfg, s)) {
      const [{ total }] = await sql<{ total: number }[]>`SELECT coalesce(sum(valor), 0)::float AS total FROM payable_installments WHERE payable_id=${p.id} AND status <> 'CANCELADA'`;
      const alcada = Number(cfg.contasPagar.alcadaValor ?? 0); if (alcada > 0 && total - i.valor + valor >= alcada - 0.005) throw new Error(`Aumentar parcela de título com compromisso a partir de ${fmtBr(alcada)} é com quem tem a alçada.`);
    }
    await sql`UPDATE payable_installments SET vencimento=${venc}, valor=${valor}, competencia=${comp}, updated_at=now() WHERE id=${id} AND status='A_PAGAR'`;
    const mud = [venc !== i.vencimento ? `vencimento ${fmtDataBr(i.vencimento)} → ${fmtDataBr(venc)}` : null, Math.abs(valor - i.valor) >= 0.005 ? `valor ${fmtBr(i.valor)} → ${fmtBr(valor)}` : null, comp !== i.competencia ? `competência ${i.competencia ?? "—"} → ${comp}` : null].filter(Boolean).join("; ");
    await evento(p.id, s, `Parcela ${i.parcela}/${p.parcelas}: ${mud} — ${motivo}`);
    await audit(s, "alterar parcela de conta a pagar", "payable_installments", id, { vencimento: i.vencimento, valor: i.valor, competencia: i.competencia }, { vencimento: venc, valor, competencia: comp, motivo });
  } catch (e) { redirect(go(b, "erro", msgErro(e))); }
  redirect(go(b, "ok", "Parcela alterada."));
}
export async function cancelarParcela(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const b = caminhoSeguro(str(fd, "voltar"), BASE);
  try {
    if (!operaCP(s)) { await negar(s, "cancelar parcela de conta a pagar", id); throw new Error("Só Financeiro e Direção cancelam parcelas."); }
    const motivo = str(fd, "motivo"); assert(motivo.length >= 5, "Explique o motivo do cancelamento.");
    const i = await parcela(id); assert(!!i && i.status === "A_PAGAR", "Só parcela a pagar é cancelada."); const p = await titulo(i.payable_id); assert(!!p && noEscopo(s, p.unit_id), "Título de outra unidade."); assert(["ATIVO", "AGUARDANDO_APROVACAO"].includes(p.status), "Título fora de aberto.");
    await sql`UPDATE payable_installments SET status='CANCELADA', programado_para=NULL, conta_programada_id=NULL, updated_at=now() WHERE id=${id} AND status='A_PAGAR'`; await recalcularStatus(p.id);
    await evento(p.id, s, `Parcela ${i.parcela}/${p.parcelas} (${fmtBr(i.valor)}, vencimento ${fmtDataBr(i.vencimento)}) cancelada — ${motivo}`);
    await audit(s, "cancelar parcela de conta a pagar", "payable_installments", id, { status: "A_PAGAR" }, { status: "CANCELADA", motivo });
  } catch (e) { redirect(go(b, "erro", msgErro(e))); }
  redirect(go(b, "ok", "Parcela cancelada."));
}
export async function cancelarContaPagar(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const b = `${BASE}/${id}`;
  try {
    if (!operaCP(s)) { await negar(s, "cancelar conta a pagar", id); throw new Error("Só Financeiro e Direção cancelam títulos."); }
    const motivo = str(fd, "motivo"); assert(motivo.length >= 5, "Explique o motivo do cancelamento.");
    const p = await titulo(id); assert(!!p && noEscopo(s, p.unit_id), "Título não encontrado."); assert(["ATIVO", "AGUARDANDO_APROVACAO"].includes(p.status), "Só título em aberto (ou aguardando aprovação) é cancelado.");
    const n = await sql.begin(async tx => { const r = await tx`UPDATE payable_installments SET status='CANCELADA', programado_para=NULL, conta_programada_id=NULL, updated_at=now() WHERE payable_id=${id} AND status='A_PAGAR' RETURNING id`; await tx`UPDATE payables SET status='CANCELADO', updated_at=now() WHERE id=${id}`; return r.length; });
    await evento(id, s, `Título cancelado (${n} parcela(s) em aberto canceladas; as pagas ficam no histórico) — ${motivo}`);
    await audit(s, "cancelar conta a pagar", "payables", id, { status: p.status }, { status: "CANCELADO", parcelasCanceladas: n, motivo });
  } catch (e) { redirect(go(b, "erro", msgErro(e))); }
  redirect(go(b, "ok", "Título cancelado."));
}
/** Recorrente (aluguel, contrato mensal): acrescenta N parcelas seguindo o dia-âncora do 1º vencimento e o mesmo intervalo. */
export async function estenderRecorrencia(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const b = `${BASE}/${id}`; let msg = "";
  try {
    if (!operaCP(s)) { await negar(s, "estender recorrência de conta a pagar", id); throw new Error("Só Financeiro e Direção estendem a recorrência."); }
    const cfg = await getSettings(); const p = await titulo(id); assert(!!p && noEscopo(s, p.unit_id), "Título não encontrado."); assert(p.recorrente, "Só título recorrente é estendido."); assert(["ATIVO", "QUITADO"].includes(p.status), "Só título aprovado (em aberto ou quitado) é estendido.");
    const n = int(fd, "n") ?? 0; assert(n >= 1 && n <= 120, "Acrescente de 1 a 120 parcelas."); assert(p.parcelas + n <= 600, "Limite de 600 parcelas por título.");
    const valor = str(fd, "valor") ? lerValorBr(str(fd, "valor")) : p.valor_total; assert(Number.isFinite(valor) && valor > 0, "Valor inválido.");
    const todas = gerarParcelas({ valor, parcelas: Math.min(240, p.parcelas + n), recorrente: true, primeiroVencimento: p.primeiro_vencimento ?? p.emissao, emissao: p.emissao, intervalo: p.intervalo as Intervalo, dias: p.dias_intervalo ?? undefined, ajustarDiaUtil: p.ajustar_dia_util, feriados: opcoesFeriado(cfg) });
    // acima de 240 o gerador corta: continua a partir da última parcela gerada
    let novas = todas.slice(p.parcelas);
    if (p.parcelas + n > 240) { const [u] = await sql<{ vencimento: string; emissao: string }[]>`SELECT vencimento::text, emissao::text FROM payable_installments WHERE payable_id=${id} ORDER BY parcela DESC LIMIT 1`; const passo = gerarParcelas({ valor, parcelas: n + 1, recorrente: true, primeiroVencimento: u.vencimento, emissao: u.emissao, intervalo: p.intervalo as Intervalo, dias: p.dias_intervalo ?? undefined, ajustarDiaUtil: p.ajustar_dia_util, feriados: opcoesFeriado(cfg) }); novas = passo.slice(1); }
    assert(novas.length === n, "Não foi possível gerar as novas parcelas.");
    const aprova = aprovaCP(cfg, s); const motivos = await motivosAprovacao(cfg, { unitId: p.unit_id, categoria: p.categoria, parcelas: novas, ignorarPayableId: id, natureza: p.natureza });
    if (motivos.length && !aprova) throw new Error(`Estender pede quem tem a alçada: ${motivos.map(m => m.texto).join(" ")}`);
    await sql.begin(async tx => {
      for (let k = 0; k < novas.length; k++) await tx`INSERT INTO payable_installments (payable_id, parcela, emissao, vencimento, valor, competencia) VALUES (${id}, ${p.parcelas + k + 1}, ${novas[k].emissao}, ${novas[k].vencimento}, ${novas[k].valor}, ${novas[k].emissao.slice(0, 7)})`;
      await tx`UPDATE payables SET parcelas=${p.parcelas + n}, status='ATIVO', updated_at=now() WHERE id=${id}`;
    });
    await evento(id, s, `Recorrência estendida: +${n} parcela(s) de ${fmtBr(valor)} (${fmtDataBr(novas[0].vencimento)} a ${fmtDataBr(novas[novas.length - 1].vencimento)})${motivos.length ? ` — aprovada por quem tem a alçada: ${motivos.map(m => MOTIVO_ROTULO[m.codigo]).join(", ")}` : ""}.`);
    await audit(s, "estender recorrência de conta a pagar", "payables", id, { parcelas: p.parcelas }, { parcelas: p.parcelas + n, valor, motivos: motivos.map(m => m.codigo) });
    msg = `+${n} parcela(s) até ${fmtDataBr(novas[novas.length - 1].vencimento)}.`;
  } catch (e) { redirect(go(b, "erro", msgErro(e))); }
  redirect(go(b, "ok", msg));
}
