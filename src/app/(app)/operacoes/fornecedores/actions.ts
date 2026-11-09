"use server";
// v33 · Fornecedores (SO-ARCH-SUP-001): todas as ações conferem permissão, segregação de funções e transição válida no servidor;
// cada ação crítica vai para a trilha (entidade suppliers, com o id do fornecedor) sem dado bancário completo.
import { redirect } from "next/navigation";
import { createHash } from "crypto";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit, type Session } from "@/lib/auth";
import { audit, str, int, hoje, addDays, getSettings } from "@/lib/utils";
import { comMensagem } from "@/lib/redirecionar";
import { notificar, usuariosPorPerfil } from "@/lib/comunicacao";
import { hashToken, novoTokenPortal } from "@/lib/portal-candidato";
import * as F from "@/lib/fornecedores";

const FICHA = (id: number, aba = "resumo", extra = "") => `/operacoes/fornecedores/${id}?aba=${aba}${extra}`;
const LISTA = (aba = "painel") => `/operacoes/fornecedores?aba=${aba}`;
const erroMsg = (e: unknown) => {
  const m = e instanceof Error ? e.message : "Erro inesperado.";
  if (/duplicate key|unique/i.test(m)) return m.includes("supplier_estab_doc_uq") ? "Já existe fornecedor ativo com este documento (pode ter sido cadastrado agora há pouco): procure na lista." : m.includes("supplier_bank_change_aberta_uq") ? "Já há uma alteração bancária em andamento para este fornecedor: conclua ou cancele antes." : m.includes("supplier_homolog_aberta_uq") ? "Este fornecedor já tem uma homologação em andamento." : m.includes("supplier_invite_ativo_uq") ? "Já existe um convite ativo: cancele antes de gerar outro." : "Registro repetido: recarregue a página e confira.";
  return m;
};
/** Executa a ação e redireciona com a mensagem (o redirect fica fora do try, como o Next exige). */
async function rodar(volta: string, fn: () => Promise<string | [string, string]>): Promise<void> {
  let r: string | [string, string] = "";
  try { r = await fn(); } catch (e) { redirect(comMensagem(volta, "erro", erroMsg(e))); }
  const [dest, msg] = Array.isArray(r) ? r : [volta, r]; redirect(comMensagem(dest, "ok", msg));
}
const log = (s: Session, acao: string, id: number, antes: unknown, depois: unknown) => audit(s, acao, "suppliers", id, antes, depois);
type Forn = { id: number; nome: string; status: string; tipo: string; criticidade: string; categoria: string | null; criado_por: number | null; versao: number; abrangencia: string; contingencia: string | null; responsavel_user_id: number | null };
async function forn(id: number): Promise<Forn> { const [f] = await sql<Forn[]>`SELECT id, nome, status, tipo, criticidade, categoria, criado_por, versao, abrangencia, contingencia, responsavel_user_id FROM suppliers WHERE id=${id}`; if (!f) throw new Error("Fornecedor não encontrado."); return f; }
const editavel = (f: Forn) => { if (["INATIVO", "REJEITADO"].includes(f.status)) throw new Error("Cadastro inativo ou rejeitado: reabra o cadastro antes de alterar."); };
const tiposDoc: Record<string, string> = { PJ: "CNPJ", PF: "CPF", EXTERIOR: "EXTERIOR" };
const texto = (fd: FormData, k: string, max = 400) => str(fd, k).replace(/\s+/g, " ").slice(0, max);
const dataOuNull = (fd: FormData, k: string) => { const v = str(fd, k); if (!v) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error("Data inválida."); return v; };
async function avisar(roles: string[], titulo: string, link: string, chave: string, tipo: "INFO" | "ACAO" = "ACAO") { await notificar(await usuariosPorPerfil(roles), titulo, null, link, tipo, chave); }

// ======================= cadastro (etapa 1) e deduplicação =======================
/** Etapa 1 — identificação. Confere o documento (dígito verificador), a duplicidade exata (bloqueia), o mesmo CNPJ raiz e nomes parecidos (pede confirmação). */
export async function criarFornecedor(fd: FormData) {
  const s = await requireSession();
  await rodar("/operacoes/fornecedores/novo", async () => {
    assert(F.podeCadastrar(s), "Cadastram fornecedores: Direção, Financeiro, Operações e direção da unidade.");
    const tipo = str(fd, "tipo"); assert(tipo in F.TIPOS_FORN, "Escolha o tipo de fornecedor.");
    const [doc, err] = F.normalizarDocumento(tiposDoc[tipo], str(fd, "documento")); if (err) throw new Error(err);
    const razao = texto(fd, "razaoSocial", 160); assert(razao.length >= 3, "Informe a razão social (ou o nome completo, para pessoa física).");
    const fantasia = texto(fd, "nomeFantasia", 120); const cfg = await F.cfgForn(); const categoria = str(fd, "categoria"); assert(cfg.categorias.some(([c]) => c === categoria), "Escolha a categoria.");
    const [igual] = await sql<{ supplier_id: number; nome: string }[]>`SELECT e.supplier_id, s.nome FROM supplier_establishments e JOIN suppliers s ON s.id=e.supplier_id WHERE e.ativo AND e.tipo_doc=${tiposDoc[tipo]} AND e.documento=${doc}`;
    if (igual) throw new Error(`Este ${tiposDoc[tipo]} já está cadastrado em “${igual.nome}” (fornecedor nº ${igual.supplier_id}). Abra a ficha dele em vez de criar outro.`);
    if (tipo === "PJ" && str(fd, "outroFornecedor") !== "1") {
      const [raiz] = await sql<{ supplier_id: number; nome: string }[]>`SELECT e.supplier_id, s.nome FROM supplier_establishments e JOIN suppliers s ON s.id=e.supplier_id WHERE e.ativo AND e.tipo_doc='CNPJ' AND left(e.documento, 8)=${doc.slice(0, 8)} LIMIT 1`;
      if (raiz) throw new Error(`Mesmo CNPJ raiz de “${raiz.nome}” (nº ${raiz.supplier_id}): é matriz ou filial do mesmo grupo. Inclua como estabelecimento na ficha dele — ou marque “é outro fornecedor” e envie de novo.`);
    }
    if (str(fd, "naoDuplicado") !== "1") {
      const nomes = await sql<{ id: number; nome: string; razao: string | null }[]>`SELECT s.id, s.nome, (SELECT razao_social FROM supplier_establishments e WHERE e.supplier_id=s.id ORDER BY matriz DESC, id LIMIT 1) AS razao FROM suppliers s WHERE s.status<>'INATIVO'`;
      const parecido = nomes.find(n => Math.max(F.semelhanca(n.nome, fantasia || razao), F.semelhanca(n.razao ?? "", razao)) >= 0.82);
      if (parecido) throw new Error(`Nome muito parecido com “${parecido.nome}” (nº ${parecido.id}): pode ser o mesmo fornecedor. Confira; se não for, marque “não é duplicado” e envie de novo.`);
    }
    const criticidade = F.criticidadeDaCategoria(cfg, categoria);
    const id = await sql.begin(async tx => {
      const [n] = await tx<{ id: number }[]>`INSERT INTO suppliers (nome, servico, tipo, categoria, criticidade, status, origem, criado_por, responsavel_user_id, abrangencia, ativo) VALUES (${fantasia || razao}, ${categoria}, ${tipo}, ${categoria}, ${criticidade}, 'RASCUNHO', 'INTERNO', ${s.id}, ${s.id}, 'REDE', true) RETURNING id`;
      await tx`INSERT INTO supplier_establishments (supplier_id, tipo_doc, documento, razao_social, nome_fantasia, matriz, regime) VALUES (${n.id}, ${tiposDoc[tipo]}, ${doc}, ${razao}, ${fantasia || null}, true, ${tipo === "PF" ? "PF" : null})`;
      return n.id;
    });
    await log(s, "fornecedor criado (rascunho)", id, null, { tipo, documento: tipo === "PF" ? F.fmtCpfMascarado(doc) : F.fmtDocumento(tiposDoc[tipo], doc), razao, categoria, criticidade, origem: "INTERNO" });
    return [FICHA(id, "cadastro"), "Rascunho criado — ainda não autoriza compras. Complete as etapas e envie para homologação."];
  });
}

/** Etapa 1 (ficha) — nome, categoria, criticidade (com os fatores) e responsável interno. */
export async function salvarIdentificacao(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0;
  await rodar(FICHA(id, "cadastro"), async () => {
    assert(F.podeCadastrar(s), "Sem permissão para editar o cadastro."); const f = await forn(id); editavel(f); const cfg = await F.cfgForn();
    const nome = texto(fd, "nome", 120); assert(nome.length >= 2, "Informe o nome do fornecedor."); const categoria = str(fd, "categoria"); assert(cfg.categorias.some(([c]) => c === categoria), "Escolha a categoria.");
    const fatores = fd.getAll("fatores").map(String).filter(x => F.FATORES_CRITICIDADE.some(([k]) => k === x));
    const proposta = F.criticidadeProposta(cfg, categoria, fatores); const crit = str(fd, "criticidade") || proposta; assert(crit in F.CRITICIDADE, "Criticidade inválida.");
    const ordem = ["BAIXA", "MEDIA", "ALTA"]; const motivo = texto(fd, "criticidadeMotivo", 300);
    if (ordem.indexOf(crit) < ordem.indexOf(proposta) && motivo.length < 10) throw new Error(`A criticidade proposta pelos fatores é ${F.CRITICIDADE[proposta].toLowerCase()}: para usar ${F.CRITICIDADE[crit].toLowerCase()}, escreva o motivo (mínimo 10 caracteres).`);
    const resp = int(fd, "responsavelUserId"); if (resp) { const [u] = await sql`SELECT 1 FROM users WHERE id=${resp} AND ativo`; assert(!!u, "Responsável inválido."); }
    await sql`UPDATE suppliers SET nome=${nome}, categoria=${categoria}, servico=${categoria}, subcategoria=${texto(fd, "subcategoria", 120) || null}, criticidade=${crit}, criticidade_fatores=${JSON.stringify(fatores)}::jsonb, criticidade_motivo=${motivo || null}, responsavel_user_id=${resp ?? null}, updated_at=now() WHERE id=${id}`;
    await log(s, "identificação do fornecedor", id, { nome: f.nome, categoria: f.categoria, criticidade: f.criticidade }, { nome, categoria, criticidade: crit, proposta, fatores, motivo: motivo || null });
    return `Identificação salva. Criticidade ${F.CRITICIDADE[crit].toLowerCase()}${crit !== proposta ? ` (proposta: ${F.CRITICIDADE[proposta].toLowerCase()})` : ""}.`;
  });
}

// ======================= estabelecimentos (UX-SUP-05) =======================
export async function salvarEstabelecimento(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const eid = int(fd, "estabId");
  await rodar(FICHA(id, "cadastro", "#estabelecimentos"), async () => {
    assert(F.podeCadastrar(s), "Sem permissão para editar o cadastro."); const f = await forn(id); editavel(f);
    const uf = str(fd, "uf").toUpperCase(); assert(!uf || /^[A-Z]{2}$/.test(uf), "UF com 2 letras."); const cep = F.soDigitos(str(fd, "cep")); assert(!cep || cep.length === 8, "CEP com 8 dígitos.");
    const razao = texto(fd, "razaoSocial", 160); assert(razao.length >= 3, "Informe a razão social.");
    const regime = str(fd, "regime") || null; assert(!regime || regime in F.REGIMES, "Regime inválido.");
    const cnae = F.soDigitos(str(fd, "cnae")); assert(!cnae || cnae.length === 7, "CNAE com 7 dígitos.");
    const campos = { razao_social: razao, nome_fantasia: texto(fd, "nomeFantasia", 120) || null, ie: texto(fd, "ie", 30) || null, im: texto(fd, "im", 30) || null, regime, cnae: cnae || null, cep: cep || null, logradouro: texto(fd, "logradouro", 160) || null, numero: texto(fd, "numero", 20) || null, complemento: texto(fd, "complemento", 80) || null, bairro: texto(fd, "bairro", 80) || null, cidade: texto(fd, "cidade", 80) || null, uf: uf || null };
    if (eid) {
      const [e] = await sql<{ id: number; razao_social: string }[]>`SELECT id, razao_social FROM supplier_establishments WHERE id=${eid} AND supplier_id=${id}`; assert(!!e, "Estabelecimento não encontrado.");
      await sql`UPDATE supplier_establishments SET ${sql(campos)}, updated_at=now() WHERE id=${eid}`;
      await log(s, "estabelecimento do fornecedor atualizado", id, { razao: e.razao_social }, { estabelecimento: eid, ...campos });
      return "Estabelecimento salvo.";
    }
    const tipoDoc = str(fd, "tipoDoc") || "CNPJ"; assert(["CNPJ", "CPF", "EXTERIOR"].includes(tipoDoc), "Tipo de documento inválido.");
    const [doc, err] = F.normalizarDocumento(tipoDoc, str(fd, "documento")); if (err) throw new Error(err);
    const [igual] = await sql<{ supplier_id: number; nome: string }[]>`SELECT e.supplier_id, s.nome FROM supplier_establishments e JOIN suppliers s ON s.id=e.supplier_id WHERE e.ativo AND e.tipo_doc=${tipoDoc} AND e.documento=${doc}`;
    if (igual) throw new Error(`Este documento já está cadastrado em “${igual.nome}” (nº ${igual.supplier_id}).`);
    // o primeiro documento de um cadastro anterior (ou criado no lançamento de uma conta) vira o estabelecimento principal
    const principal = !(await sql`SELECT 1 FROM supplier_establishments WHERE supplier_id=${id} AND ativo`).length;
    await sql.begin(async tx => {
      await tx`INSERT INTO supplier_establishments ${tx({ supplier_id: id, tipo_doc: tipoDoc, documento: doc, matriz: principal, ...campos })}`;
      if (principal) await tx`UPDATE suppliers SET tipo=${tipoDoc === "CPF" ? "PF" : tipoDoc === "EXTERIOR" ? "EXTERIOR" : "PJ"}, updated_at=now() WHERE id=${id}`;
    });
    await log(s, principal ? "documento principal do fornecedor incluído" : "estabelecimento incluído (filial)", id, null, { tipoDoc, documento: tipoDoc === "CPF" ? F.fmtCpfMascarado(doc) : F.fmtDocumento(tipoDoc, doc), razao });
    return principal ? "Documento principal incluído: o cadastro já pode seguir as etapas e ir para homologação." : "Estabelecimento incluído. Documentos e conta podem ser próprios dele.";
  });
}
/** Consulta cadastral (SUP-RN-003): registra fonte, data e quem consultou — o sistema não inventa situação nem consulta sozinho. */
export async function registrarConsulta(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const eid = int(fd, "estabId") ?? 0;
  await rodar(FICHA(id, "cadastro", "#estabelecimentos"), async () => {
    assert(F.podeCadastrar(s) || F.podeConferirBanco(s), "Sem permissão."); await forn(id);
    const sit = str(fd, "situacao"); assert(sit in F.SITUACOES_CADASTRAIS && sit !== "NAO_CONSULTADA", "Escolha a situação encontrada.");
    const fonte = texto(fd, "fonte", 200); assert(fonte.length >= 5, "Informe a fonte da consulta (ex.: gov.br — comprovante de inscrição e situação cadastral).");
    const data = dataOuNull(fd, "data") ?? hoje(); assert(data <= hoje() && data >= addDays(hoje(), -365), "Data da consulta entre o último ano e hoje.");
    const r = await sql`UPDATE supplier_establishments SET situacao_cadastral=${sit}, situacao_fonte=${fonte}, situacao_em=${data}, situacao_por=${s.nome}, updated_at=now() WHERE id=${eid} AND supplier_id=${id}`; assert(r.count > 0, "Estabelecimento não encontrado.");
    await log(s, "consulta cadastral registrada", id, null, { estabelecimento: eid, situacao: sit, fonte, data });
    return sit === "ATIVA" ? "Consulta registrada: situação ativa." : `Consulta registrada: situação ${F.SITUACOES_CADASTRAIS[sit].toLowerCase()} — isso pesa no risco e deve ir para a análise.`;
  });
}

// ======================= contatos (UX-SUP-06) =======================
export async function salvarContato(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const cid = int(fd, "contatoId");
  await rodar(FICHA(id, "cadastro", "#contatos"), async () => {
    assert(F.podeCadastrar(s), "Sem permissão."); const f = await forn(id); editavel(f);
    const nome = texto(fd, "nome", 120); assert(nome.length >= 2, "Informe o nome do contato."); const fin = str(fd, "finalidade"); assert(fin in F.FINALIDADES_CONTATO, "Escolha a finalidade.");
    const email = str(fd, "email").toLowerCase(); assert(!email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), "E-mail inválido."); const tel = texto(fd, "telefone", 30); assert(!!(email || tel), "Informe e-mail ou telefone.");
    const principal = str(fd, "principal") === "1" || fin === "PRINCIPAL"; const d = { nome, finalidade: fin, cargo: texto(fd, "cargo", 80) || null, telefone: tel || null, email: email || null, principal, autoriza_comunicacao: str(fd, "autoriza") !== "0" };
    await sql.begin(async tx => {
      if (principal) await tx`UPDATE supplier_contacts SET principal=false WHERE supplier_id=${id}`;
      if (cid) { const r = await tx`UPDATE supplier_contacts SET ${tx(d)} WHERE id=${cid} AND supplier_id=${id}`; assert(r.count > 0, "Contato não encontrado."); }
      else await tx`INSERT INTO supplier_contacts ${tx({ supplier_id: id, ...d })}`;
    });
    if (principal) await sql`UPDATE suppliers SET telefone=${tel || null}, email=${email || null} WHERE id=${id}`;
    await log(s, cid ? "contato do fornecedor atualizado" : "contato do fornecedor incluído", id, null, { nome, finalidade: fin, principal });
    return "Contato salvo.";
  });
}
export async function removerContato(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const cid = int(fd, "contatoId") ?? 0;
  await rodar(FICHA(id, "cadastro", "#contatos"), async () => {
    assert(F.podeCadastrar(s), "Sem permissão."); await sql`UPDATE supplier_contacts SET ativo=false, principal=false WHERE id=${cid} AND supplier_id=${id}`;
    await log(s, "contato do fornecedor removido", id, null, { contato: cid }); return "Contato removido.";
  });
}

// ======================= capacidade, cobertura e unidades (UX-SUP-10) =======================
export async function salvarCobertura(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0;
  await rodar(FICHA(id, "cadastro", "#cobertura"), async () => {
    assert(F.podeCadastrar(s), "Sem permissão."); const f = await forn(id); editavel(f);
    const abr = str(fd, "abrangencia") === "UNIDADES" ? "UNIDADES" : "REDE"; const units = [...new Set(fd.getAll("units").map(Number).filter(Boolean))];
    if (abr === "UNIDADES") assert(units.length > 0, "Marque ao menos uma unidade (ou escolha a rede toda).");
    const validas = (await sql<{ id: number }[]>`SELECT id FROM units`).map(u => u.id); assert(units.every(u => validas.includes(u)), "Unidade inválida.");
    const u = scopeUnit(s); if (u !== null && abr === "UNIDADES") assert(units.every(x => x === u), "A direção da unidade autoriza só a própria unidade.");
    await sql.begin(async tx => {
      await tx`UPDATE suppliers SET abrangencia=${abr}, capacidade=${texto(fd, "capacidade", 600) || null}, contingencia=${texto(fd, "contingencia", 600) || null}, updated_at=now() WHERE id=${id}`;
      await tx`DELETE FROM supplier_units WHERE supplier_id=${id} ${abr === "UNIDADES" ? tx`AND NOT (unit_id = ANY(${units}))` : tx``}`;
      if (abr === "UNIDADES") for (const x of units) await tx`INSERT INTO supplier_units (supplier_id, unit_id) VALUES (${id}, ${x}) ON CONFLICT (supplier_id, unit_id) DO UPDATE SET status='AUTORIZADA'`;
    });
    await log(s, "cobertura e unidades do fornecedor", id, { abrangencia: f.abrangencia }, { abrangencia: abr, unidades: units });
    return abr === "REDE" ? "Cobertura salva: rede toda." : `Cobertura salva: ${units.length} unidade(s).`;
  });
}

// ======================= financeiro e tributos (UX-SUP-07) =======================
export async function salvarPagamento(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0;
  await rodar(FICHA(id, "financeiro"), async () => {
    assert(F.podeCadastrar(s), "Sem permissão."); const f = await forn(id); editavel(f);
    const forma = str(fd, "formaPagamento"); assert(forma in F.FORMAS_PAGAMENTO, "Escolha a forma de pagamento.");
    const prazo = int(fd, "prazoDias"); assert(prazo !== null && prazo >= 0 && prazo <= 180, "Prazo de pagamento entre 0 e 180 dias.");
    const desc = str(fd, "descontoPct") ? Number(str(fd, "descontoPct").replace(",", ".")) : null; assert(desc === null || (desc >= 0 && desc <= 30), "Desconto por antecipação entre 0 e 30%.");
    const descDias = int(fd, "descontoDias"); if (desc) assert(descDias !== null && descDias >= 0 && descDias < prazo!, "Informe em quantos dias vale o desconto (antes do prazo).");
    const conta = int(fd, "contaId"); if (conta) { const [c] = await sql`SELECT 1 FROM chart_accounts WHERE id=${conta}`; assert(!!c, "Conta do plano inválida."); }
    const centro = int(fd, "costCenterId"); if (centro) { const [c] = await sql`SELECT 1 FROM cost_centers WHERE id=${centro}`; assert(!!c, "Centro de custo inválido."); }
    await sql`UPDATE suppliers SET forma_pagamento=${forma}, prazo_dias=${prazo}, desconto_pct=${desc}, desconto_dias=${desc ? descDias : null}, conta_id=${conta ?? null}, cost_center_id=${centro ?? null}, condicao_obs=${texto(fd, "condicaoObs", 300) || null}, updated_at=now() WHERE id=${id}`;
    await log(s, "condições de pagamento do fornecedor", id, null, { forma, prazo, desconto: desc, descontoDias: desc ? descDias : null, conta, centro });
    return `Condições salvas: ${F.FORMAS_PAGAMENTO[forma]}, ${prazo} dia(s)${desc ? `, ${String(desc).replace(".", ",")}% em ${descDias} dia(s)` : ""}. Contas a pagar já sugere a conta e o centro de custo.`;
  });
}

// ======================= dados bancários em quarentena (9.3 · SUP-RN-008) =======================
export async function proporConta(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0;
  await rodar(FICHA(id, "financeiro"), async () => {
    assert(F.podeCadastrar(s) || F.podeConferirBanco(s), "Sem permissão para propor dados bancários."); const f = await forn(id); editavel(f);
    const c = await F.validarConta(fd, id); const { evid, ...conta } = c;
    const [emUso] = await sql`SELECT 1 FROM supplier_bank_accounts WHERE supplier_id=${id} AND status='EM_USO'`;
    await sql.begin(async tx => {
      const [a] = await tx<{ id: number }[]>`INSERT INTO supplier_bank_accounts ${tx({ supplier_id: id, ...conta, status: "PROPOSTA", criado_por_nome: s.nome })} RETURNING id`;
      await tx`INSERT INTO supplier_bank_changes ${tx({ supplier_id: id, account_id: a.id, origem: emUso ? "INTERNO" : "CADASTRO_INICIAL", solicitante_user_id: s.id, solicitante_nome: s.nome, evidencia: evid, status: "AGUARDANDO_CONFERENCIA" })}`;
    });
    await log(s, "alteração bancária solicitada", id, null, { banco: conta.banco_nome, agencia: conta.agencia, conta: F.mascararConta(conta.conta), pix: F.mascararPix(conta.pix_tipo, conta.pix_chave), terceiro: conta.terceiro, evidencia: evid });
    await avisar(["FINANCEIRO", "DIRECAO"], "Alteração bancária de fornecedor aguardando conferência", LISTA("bancos"), `forn-banco:${id}:${hoje()}`);
    return "Dados bancários em quarentena: só entram em uso depois da conferência por canal conhecido e da aprovação de outra pessoa. A conta anterior continua valendo.";
  });
}
type Mudanca = { id: number; account_id: number; status: string; solicitante_user_id: number | null; conferencia_user_id: number | null; solicitante_nome: string };
async function mudanca(id: number, cid: number) { const [m] = await sql<Mudanca[]>`SELECT id, account_id, status, solicitante_user_id, conferencia_user_id, solicitante_nome FROM supplier_bank_changes WHERE id=${cid} AND supplier_id=${id}`; if (!m) throw new Error("Alteração bancária não encontrada."); return m; }
export async function conferirConta(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const cid = int(fd, "mudancaId") ?? 0; const volta = str(fd, "voltar") === "lista" ? LISTA("bancos") : FICHA(id, "financeiro");
  await rodar(volta, async () => {
    assert(F.podeConferirBanco(s), "A conferência da conta é do Financeiro ou da Direção."); const m = await mudanca(id, cid); assert(m.status === "AGUARDANDO_CONFERENCIA", "Esta alteração não está aguardando conferência.");
    if (m.solicitante_user_id === s.id) { await log(s, "tentativa bloqueada: conferir a própria alteração bancária", id, null, { mudanca: cid }); throw new Error("Segregação de funções: quem pediu a alteração não confere. Outra pessoa do Financeiro ou da Direção confere."); }
    const res = str(fd, "resultado"); const canal = texto(fd, "canal", 400); assert(canal.length >= 10, "Descreva o canal da confirmação (ex.: ligação para o telefone do cadastro anterior, com quem falou) — mínimo 10 caracteres.");
    if (res === "NAO_CONFIRMADA") {
      await sql.begin(async tx => { await tx`UPDATE supplier_bank_changes SET status='RECUSADA', conferencia_user_id=${s.id}, conferencia_nome=${s.nome}, conferencia_canal=${canal}, conferencia_em=now(), motivo=${"Não confirmada no canal conhecido: " + canal} WHERE id=${cid}`; await tx`UPDATE supplier_bank_accounts SET status='RECUSADA' WHERE id=${m.account_id}`; });
      await log(s, "alteração bancária recusada na conferência", id, null, { mudanca: cid, canal }); await avisar(["DIRECAO"], "Alteração bancária de fornecedor não confirmada na conferência", FICHA(id, "financeiro"), `forn-banco-recusa:${cid}`, "INFO");
      return "Alteração recusada: os dados não foram confirmados no canal conhecido. A Direção foi avisada.";
    }
    assert(res === "CONFIRMADA", "Escolha o resultado da conferência.");
    await sql`UPDATE supplier_bank_changes SET status='AGUARDANDO_APROVACAO', conferencia_user_id=${s.id}, conferencia_nome=${s.nome}, conferencia_canal=${canal}, conferencia_em=now() WHERE id=${cid} AND status='AGUARDANDO_CONFERENCIA'`;
    await log(s, "alteração bancária conferida", id, null, { mudanca: cid, canal });
    await avisar(["DIRECAO", "FINANCEIRO"], "Alteração bancária de fornecedor aguardando aprovação", LISTA("bancos"), `forn-banco-aprov:${cid}`);
    return "Conferida. Falta a aprovação de uma terceira pessoa (nem quem pediu, nem quem conferiu).";
  });
}
export async function aprovarConta(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const cid = int(fd, "mudancaId") ?? 0; const volta = str(fd, "voltar") === "lista" ? LISTA("bancos") : FICHA(id, "financeiro");
  await rodar(volta, async () => {
    assert(F.podeAprovarBanco(s), "Aprovam a troca de conta: Direção ou quem tem a aprovação de contas a pagar."); const m = await mudanca(id, cid); assert(m.status === "AGUARDANDO_APROVACAO", "Esta alteração não está aguardando aprovação.");
    if (m.solicitante_user_id === s.id || m.conferencia_user_id === s.id) { await log(s, "tentativa bloqueada: aprovar alteração bancária que pediu ou conferiu", id, null, { mudanca: cid }); throw new Error("Segregação de funções: quem pediu ou conferiu a alteração não aprova."); }
    await sql.begin(async tx => {
      const [ant] = await tx<{ versao: number }[]>`SELECT coalesce(max(versao), 0)::int AS versao FROM supplier_bank_accounts WHERE supplier_id=${id} AND status IN ('EM_USO','SUBSTITUIDA')`;
      await tx`UPDATE supplier_bank_accounts SET status='SUBSTITUIDA' WHERE supplier_id=${id} AND status='EM_USO'`;
      await tx`UPDATE supplier_bank_accounts SET status='EM_USO', ativada_em=now(), versao=${ant.versao + 1} WHERE id=${m.account_id}`;
      const r = await tx`UPDATE supplier_bank_changes SET status='APROVADA', aprovacao_user_id=${s.id}, aprovacao_nome=${s.nome}, aprovacao_em=now() WHERE id=${cid} AND status='AGUARDANDO_APROVACAO'`; assert(r.count > 0, "Outra pessoa decidiu agora há pouco: recarregue.");
    });
    await log(s, "alteração bancária aprovada (conta em uso)", id, null, { mudanca: cid, solicitante: m.solicitante_nome });
    await avisar(["FINANCEIRO"], "Conta bancária de fornecedor atualizada", FICHA(id, "financeiro"), `forn-banco-ok:${cid}`, "INFO");
    return "Aprovada: a nova conta está em uso a partir de agora. Pagamentos já programados não mudam sozinhos — confira os que estão em aberto.";
  });
}
export async function recusarOuCancelarConta(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const cid = int(fd, "mudancaId") ?? 0; const cancelar = str(fd, "modo") === "cancelar";
  await rodar(FICHA(id, "financeiro"), async () => {
    const m = await mudanca(id, cid); assert(["AGUARDANDO_CONFERENCIA", "AGUARDANDO_APROVACAO"].includes(m.status), "Esta alteração já foi concluída.");
    if (cancelar) assert(m.solicitante_user_id === s.id || F.podeConferirBanco(s), "Cancela quem pediu, o Financeiro ou a Direção.");
    else assert(m.status === "AGUARDANDO_CONFERENCIA" ? F.podeConferirBanco(s) : F.podeAprovarBanco(s), "Sem permissão para recusar nesta etapa.");
    const motivo = texto(fd, "motivo", 300); assert(motivo.length >= 5, "Escreva o motivo.");
    await sql.begin(async tx => { await tx`UPDATE supplier_bank_changes SET status=${cancelar ? "CANCELADA" : "RECUSADA"}, motivo=${motivo} WHERE id=${cid}`; await tx`UPDATE supplier_bank_accounts SET status=${cancelar ? "CANCELADA" : "RECUSADA"} WHERE id=${m.account_id}`; });
    await log(s, cancelar ? "alteração bancária cancelada" : "alteração bancária recusada", id, null, { mudanca: cid, motivo });
    return cancelar ? "Alteração cancelada." : "Alteração recusada. A conta anterior continua valendo.";
  });
}
/** Mostra a conta completa por 5 minutos para quem pode (Financeiro e Direção) — e registra quem viu. */
export async function revelarConta(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0;
  await rodar(FICHA(id, "financeiro"), async () => {
    assert(F.podeVerBancoCompleto(s), "Dados bancários completos: só Financeiro e Direção."); await forn(id);
    await log(s, "ver dados bancários completos", id, null, { motivo: texto(fd, "motivo", 200) || null });
    return [FICHA(id, "financeiro", `&rev=${F.assinarRevelar(s.id, id)}`), "Dados completos visíveis por 5 minutos (registrado na trilha)."];
  });
}

// ======================= documentos (UX-SUP-08) =======================
export async function enviarDocumento(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0;
  await rodar(FICHA(id, "documentos"), async () => {
    assert(F.podeCadastrar(s), "Sem permissão para anexar documentos."); const f = await forn(id); editavel(f);
    const tipo = (str(fd, "tipo") === "__outro" ? texto(fd, "tipoOutro", 120) : texto(fd, "tipo", 160)); assert(tipo.length >= 3, "Escolha o tipo do documento.");
    const emissao = dataOuNull(fd, "emissao"); const validade = dataOuNull(fd, "validade"); assert(!emissao || emissao <= hoje(), "Emissão no futuro.");
    if (validade) assert(validade >= hoje(), "Documento já vencido: peça um atualizado ao fornecedor.");
    const cfg = await getSettings(); const arq = fd.get("arquivo"); assert(!!arq && typeof arq === "object" && "arrayBuffer" in arq && (arq as File).size > 0, "Escolha o arquivo (PDF, JPG ou PNG).");
    const a = arq as File; assert(a.size <= cfg.plataforma.anexoMaxMb * 1048576, `Arquivo acima de ${cfg.plataforma.anexoMaxMb} MB.`); const mime = a.type || "application/octet-stream"; assert(["application/pdf", "image/jpeg", "image/png"].includes(mime), "Envie PDF, JPG ou PNG.");
    const buf = Buffer.from(await a.arrayBuffer()); const hash = createHash("sha256").update(buf).digest("hex"); const nome = a.name.replace(/[^\w.\-() áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ]/g, "_").slice(0, 120);
    const [rep] = await sql`SELECT 1 FROM supplier_documents WHERE supplier_id=${id} AND hash=${hash} AND status<>'RECUSADO'`; assert(!rep, "Este mesmo arquivo já foi enviado para este fornecedor.");
    const docId = await sql.begin(async tx => {
      const [d] = await tx<{ id: number }[]>`INSERT INTO supplier_documents (supplier_id, tipo, numero, emissao, validade, status, origem, hash, enviado_por_user_id, enviado_por_nome, obs) VALUES (${id}, ${tipo}, ${texto(fd, "numero", 60) || null}, ${emissao}, ${validade}, 'ENVIADO', 'INTERNO', ${hash}, ${s.id}, ${s.nome}, ${texto(fd, "obs", 300) || null}) RETURNING id`;
      await tx`INSERT INTO attachments (entidade, entidade_id, nome, mime, tamanho, dados, descricao, unit_id, user_id, user_nome) VALUES ('supplier_document', ${d.id}, ${nome}, ${mime}, ${a.size}, ${buf}, ${tipo}, NULL, ${s.id}, ${s.nome})`;
      return d.id;
    });
    await log(s, "documento do fornecedor enviado", id, null, { documento: docId, tipo, validade, hash: hash.slice(0, 12) });
    return "Documento anexado: aguarda conferência.";
  });
}
export async function conferirDocumento(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const did = int(fd, "docId") ?? 0; const volta = str(fd, "voltar") === "lista" ? LISTA("documentos") : FICHA(id, "documentos");
  await rodar(volta, async () => {
    assert(F.podeParecer(s, "DOCUMENTAL"), "A conferência documental é do Financeiro, de Operações ou da Direção.");
    const [d] = await sql<{ id: number; tipo: string; status: string; validade: string | null }[]>`SELECT id, tipo, status, validade::text FROM supplier_documents WHERE id=${did} AND supplier_id=${id}`; assert(!!d, "Documento não encontrado."); assert(d.status === "ENVIADO", "Este documento não está aguardando conferência.");
    if (str(fd, "resultado") === "RECUSAR") {
      const motivo = texto(fd, "motivo", 300); assert(motivo.length >= 5, "Escreva o motivo da recusa.");
      await sql`UPDATE supplier_documents SET status='RECUSADO', motivo_recusa=${motivo}, conferido_por_nome=${s.nome}, conferido_em=now() WHERE id=${did}`;
      await log(s, "documento do fornecedor recusado", id, null, { documento: did, tipo: d.tipo, motivo }); return "Documento recusado.";
    }
    assert(!d.validade || d.validade >= hoje(), "Documento vencido: recuse e peça outro.");
    await sql.begin(async tx => { await tx`UPDATE supplier_documents SET status='SUBSTITUIDO' WHERE supplier_id=${id} AND tipo=${d.tipo} AND id<>${did} AND status IN ('CONFERIDO','VENCIDO','ENVIADO','RECUSADO')`; await tx`UPDATE supplier_documents SET status='CONFERIDO', conferido_por_nome=${s.nome}, conferido_em=now() WHERE id=${did}`; });
    await log(s, "documento do fornecedor conferido", id, null, { documento: did, tipo: d.tipo, validade: d.validade }); return "Documento conferido.";
  });
}

// ======================= homologação (UX-SUP-09 · 7.1) =======================
export async function enviarHomologacao(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0;
  await rodar(FICHA(id, "homologacao"), async () => {
    assert(F.podeCadastrar(s), "Sem permissão para enviar à homologação."); const f = await forn(id); assert(!["INATIVO", "REJEITADO"].includes(f.status), "Cadastro inativo ou rejeitado: reabra o cadastro antes de enviar.");
    const cfg = await F.cfgForn(); const [l] = await F.carregarLista(cfg, [id]); assert(!!l, "Fornecedor não encontrado.");
    const falta: string[] = []; if (!l.documento) falta.push("documento do estabelecimento"); if (!l.razao_social) falta.push("razão social"); if (!l.categoria) falta.push("categoria");
    if (!l.contato) falta.push("contato com e-mail ou telefone"); if (l.abrangencia === "UNIDADES" && !l.unidades.length) falta.push("unidades atendidas"); if (!l.responsavel_user_id) falta.push("responsável interno");
    if (l.criticidade === "ALTA" && !(l.contingencia ?? "").trim()) falta.push("plano de contingência (criticidade alta)");
    if (falta.length) throw new Error(`Para enviar, complete: ${falta.join(", ")}.`);
    const tipo = ["VENCIDO", "HOMOLOGADO", "CONDICIONAL"].includes(f.status) ? "REVALIDACAO" : f.status === "SUSPENSO" ? "REATIVACAO" : "INICIAL";
    await sql.begin(async tx => {
      await tx`INSERT INTO supplier_homologations (supplier_id, tipo, fase, criticidade, risco, submetido_por, submetido_nome, responsavel_user_id) VALUES (${id}, ${tipo}, 'ANALISE', ${l.criticidade}, ${JSON.stringify({ nivel: l.risco.nivel, pontos: l.risco.pontos, fatores: l.risco.fatores, completude: l.completude.pct })}::jsonb, ${s.id}, ${s.nome}, ${int(fd, "analistaUserId") ?? null})`;
      if (["RASCUNHO", "LEGADO"].includes(f.status)) await F.mudarStatus(tx as unknown as typeof sql, id, "EM_ANALISE", s.nome, null, f.versao);
    });
    await log(s, "enviado para homologação", id, { status: f.status }, { tipo, criticidade: l.criticidade, risco: l.risco.nivel, completude: l.completude.pct, pareceres: F.pareceresExigidos(l.criticidade) });
    await avisar(["FINANCEIRO", "DIRECAO", "OPERACOES"], "Fornecedor aguardando análise para homologação", LISTA("homologacao"), `forn-hom:${id}:${hoje()}`);
    return `Enviado (${tipo === "INICIAL" ? "homologação inicial" : tipo === "REVALIDACAO" ? "revalidação" : "reativação"}). Pareceres exigidos pela criticidade ${F.CRITICIDADE[l.criticidade].toLowerCase()}: ${F.pareceresExigidos(l.criticidade).map(e => F.ETAPAS_PARECER[e].toLowerCase()).join(", ")}.`;
  });
}
type Caso = { id: number; tipo: string; fase: string; criticidade: string; submetido_por: number | null };
async function casoAberto(id: number) { const [c] = await sql<Caso[]>`SELECT id, tipo, fase, criticidade, submetido_por FROM supplier_homologations WHERE supplier_id=${id} AND fase IN ('ANALISE','APROVACAO')`; if (!c) throw new Error("Não há homologação em andamento para este fornecedor."); return c; }
export async function devolverHomologacao(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0;
  await rodar(FICHA(id, "homologacao"), async () => {
    assert(F.podeCadastrar(s) || F.podeHomologar(s), "Sem permissão."); const f = await forn(id); const c = await casoAberto(id);
    const motivo = texto(fd, "motivo", 600); assert(motivo.length >= 10, "Liste as pendências objetivas (mínimo 10 caracteres).");
    await sql.begin(async tx => {
      await tx`UPDATE supplier_homologations SET fase='DEVOLVIDO', motivo_devolucao=${motivo} WHERE id=${c.id}`;
      if (c.tipo === "INICIAL" && f.status === "EM_ANALISE") await F.mudarStatus(tx as unknown as typeof sql, id, "RASCUNHO", s.nome, `Devolvido com pendências: ${motivo}`, f.versao);
    });
    await log(s, c.submetido_por === s.id ? "homologação retirada para correção" : "homologação devolvida com pendências", id, null, { caso: c.id, motivo });
    if (c.submetido_por && c.submetido_por !== s.id) await notificar([c.submetido_por], "Cadastro de fornecedor devolvido com pendências", null, FICHA(id, "homologacao"), "ACAO", `forn-dev:${c.id}`);
    return "Devolvido com as pendências. Corrija e envie de novo.";
  });
}
export async function registrarParecer(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0;
  await rodar(FICHA(id, "homologacao"), async () => {
    const etapa = str(fd, "etapa"); assert(etapa in F.ETAPAS_PARECER, "Escolha a etapa do parecer."); assert(F.podeParecer(s, etapa), `O ${F.ETAPAS_PARECER[etapa].toLowerCase()} não é da sua atuação.`);
    const c = await casoAberto(id);
    if (c.submetido_por === s.id) { await log(s, "tentativa bloqueada: parecer no próprio envio", id, null, { caso: c.id, etapa }); throw new Error("Segregação de funções: quem enviou o cadastro não dá parecer nele."); }
    const res = str(fd, "resultado"); assert(res in F.RESULTADOS_PARECER, "Escolha o resultado."); const parecer = texto(fd, "parecer", 1200); assert(parecer.length >= 10, "Escreva o parecer (mínimo 10 caracteres).");
    await sql`INSERT INTO supplier_reviews (homologation_id, etapa, resultado, parecer, autor_user_id, autor_nome) VALUES (${c.id}, ${etapa}, ${res}, ${parecer}, ${s.id}, ${s.nome})`;
    const ult = await sql<{ etapa: string; resultado: string }[]>`SELECT DISTINCT ON (etapa) etapa, resultado FROM supplier_reviews WHERE homologation_id=${c.id} ORDER BY etapa, created_at DESC, id DESC`;
    const exig = F.pareceresExigidos(c.criticidade); const completo = exig.every(e => ult.some(u => u.etapa === e && u.resultado !== "PENDENCIA"));
    if (completo && c.fase === "ANALISE") { await sql`UPDATE supplier_homologations SET fase='APROVACAO' WHERE id=${c.id}`; await avisar(["DIRECAO", "FINANCEIRO"], "Fornecedor pronto para a decisão de homologação", LISTA("homologacao"), `forn-dec:${c.id}`); }
    if (!completo && c.fase === "APROVACAO") await sql`UPDATE supplier_homologations SET fase='ANALISE' WHERE id=${c.id}`;
    await log(s, "parecer de homologação", id, null, { caso: c.id, etapa, resultado: res });
    return completo ? "Parecer registrado. Todos os pareceres exigidos chegaram: a homologação está pronta para a decisão." : `Parecer registrado. Faltam: ${exig.filter(e => !ult.some(u => u.etapa === e && u.resultado !== "PENDENCIA")).map(e => F.ETAPAS_PARECER[e].toLowerCase()).join(", ")}.`;
  });
}
export async function decidirHomologacao(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0;
  await rodar(FICHA(id, "homologacao"), async () => {
    assert(F.podeHomologar(s), "Homologam: Direção, ou o financeiro com a aprovação de contas a pagar no cargo."); const f = await forn(id); const c = await casoAberto(id);
    assert(c.fase === "APROVACAO", "Ainda faltam pareceres exigidos (ou há pendência a resolver) antes da decisão.");
    if (c.submetido_por === s.id || f.criado_por === s.id) { await log(s, "tentativa bloqueada: decidir a homologação do próprio cadastro", id, null, { caso: c.id }); throw new Error("Segregação de funções: quem cadastrou ou enviou não homologa o próprio fornecedor."); }
    const dec = str(fd, "decisao"); assert(["HOMOLOGADO", "CONDICIONAL", "REJEITADO"].includes(dec), "Escolha a decisão.");
    const just = texto(fd, "justificativa", 1200); assert(just.length >= 10, "Escreva a justificativa da decisão (mínimo 10 caracteres).");
    const restr = texto(fd, "restricoes", 600); const restrAte = dataOuNull(fd, "restricaoAte");
    if (dec === "CONDICIONAL") { assert(restr.length >= 10, "Homologação com restrição: diga o que está autorizado e o que fica vedado (mínimo 10 caracteres)."); assert(!restrAte || (restrAte > hoje() && restrAte <= addDays(hoje(), 366)), "Prazo da restrição em até um ano."); }
    const cfg = await F.cfgForn(); const [l] = await F.carregarLista(cfg, [id]); const risco = str(fd, "risco"); const riscoMotivo = texto(fd, "riscoMotivo", 300);
    if (risco && risco !== l.risco.nivel) { assert(risco in F.RISCO_ROTULO, "Risco inválido."); assert(riscoMotivo.length >= 10, "Para revisar o risco calculado, escreva o motivo (mínimo 10 caracteres)."); }
    const vig = dec === "REJEITADO" ? null : F.revalidacaoAte(cfg, c.criticidade); const versao = int(fd, "versao");
    await sql.begin(async tx => {
      await F.mudarStatus(tx as unknown as typeof sql, id, dec, s.nome, dec === "REJEITADO" ? just : null, versao ?? f.versao);
      await tx`UPDATE supplier_homologations SET fase='DECIDIDO', decisao=${dec}, decidido_por=${s.id}, decidido_nome=${s.nome}, decidido_em=now(), justificativa=${just}, restricoes=${dec === "CONDICIONAL" ? restr : null}, restricao_ate=${dec === "CONDICIONAL" ? restrAte : null}, vigencia_ate=${vig} WHERE id=${c.id}`;
      await tx`UPDATE suppliers SET homologado_em=CASE WHEN ${dec}::text = 'REJEITADO' THEN NULL ELSE now() END, homologado_por=${dec === "REJEITADO" ? null : s.nome}, revalidar_em=${vig}, restricoes=${dec === "CONDICIONAL" ? restr : null}, restricao_ate=${dec === "CONDICIONAL" ? restrAte : null}, risco_revisado=${risco && risco !== l.risco.nivel ? risco : null}, risco_revisado_motivo=${risco && risco !== l.risco.nivel ? riscoMotivo : null} WHERE id=${id}`;
    });
    await log(s, "homologação decidida", id, { status: f.status }, { caso: c.id, tipo: c.tipo, decisao: dec, motivo: just, restricoes: dec === "CONDICIONAL" ? restr : null, restricaoAte: restrAte, risco: { calculado: l.risco.nivel, pontos: l.risco.pontos, revisado: risco && risco !== l.risco.nivel ? risco : null }, escopo: l.abrangencia === "REDE" ? "rede" : l.unidades, revalidarEm: vig, regra: "SUP-POL-2026.11" });
    if (c.submetido_por) await notificar([c.submetido_por], dec === "REJEITADO" ? "Fornecedor não homologado" : "Fornecedor homologado", null, FICHA(id, "homologacao"), "INFO", `forn-decidido:${c.id}`);
    return dec === "REJEITADO" ? "Decisão registrada: rejeitado. Novas contratações ficam bloqueadas." : `Decisão registrada: ${F.STATUS_FORN[dec].toLowerCase()} até ${F.dataBR(vig)} (revalidação pela criticidade ${F.CRITICIDADE[c.criticidade].toLowerCase()}).`;
  });
}
export async function suspenderFornecedor(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0;
  await rodar(FICHA(id), async () => {
    assert(F.podeHomologar(s), "Suspendem: Direção, ou o financeiro com a aprovação de contas a pagar."); const f = await forn(id); assert(!["SUSPENSO", "INATIVO", "REJEITADO"].includes(f.status), "O fornecedor já não aceita novas contratações.");
    const motivo = texto(fd, "motivo", 600); assert(motivo.length >= 10, "Escreva o motivo da suspensão (mínimo 10 caracteres).");
    await sql.begin(async tx => { await F.mudarStatus(tx as unknown as typeof sql, id, "SUSPENSO", s.nome, motivo, f.versao); await tx`UPDATE supplier_homologations SET fase='CANCELADO', motivo_devolucao=${"Cancelada pela suspensão: " + motivo} WHERE supplier_id=${id} AND fase IN ('ANALISE','APROVACAO')`; });
    await log(s, "fornecedor suspenso", id, { status: f.status }, { motivo });
    await avisar(["FINANCEIRO", "OPERACOES", "DIRECAO"], "Fornecedor suspenso para novas contratações", FICHA(id), `forn-susp:${id}:${hoje()}`, "INFO");
    return "Suspenso: novas contas, contratos e chamados bloqueados. O que já foi lançado continua — trate as obrigações em curso.";
  });
}
export async function inativarFornecedor(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0;
  await rodar(FICHA(id), async () => {
    assert(F.podeCadastrar(s), "Sem permissão."); const f = await forn(id); assert(f.status !== "INATIVO", "Já está inativo."); const motivo = texto(fd, "motivo", 400); assert(motivo.length >= 5, "Escreva o motivo.");
    await sql.begin(async tx => { await F.mudarStatus(tx as unknown as typeof sql, id, "INATIVO", s.nome, motivo, f.versao); await tx`UPDATE supplier_homologations SET fase='CANCELADO' WHERE supplier_id=${id} AND fase IN ('ANALISE','APROVACAO')`; await tx`UPDATE supplier_invitations SET estado='CANCELADO' WHERE supplier_id=${id} AND estado='ATIVO'`; });
    await log(s, "fornecedor inativado", id, { status: f.status }, { motivo }); return "Inativado. O histórico fica preservado.";
  });
}
export async function reabrirCadastro(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0;
  await rodar(FICHA(id, "cadastro"), async () => {
    assert(F.podeCadastrar(s), "Sem permissão."); const f = await forn(id); assert(["INATIVO", "REJEITADO"].includes(f.status), "Só cadastros inativos ou rejeitados são reabertos.");
    await sql.begin(async tx => { await F.mudarStatus(tx as unknown as typeof sql, id, "RASCUNHO", s.nome, "Cadastro reaberto para revisão", f.versao); });
    await log(s, "cadastro do fornecedor reaberto", id, { status: f.status }, { status: "RASCUNHO" }); return "Cadastro reaberto em rascunho: revise e envie para nova homologação.";
  });
}

// ======================= desempenho: avaliação e ocorrências (UX-SUP-11) =======================
export async function registrarAvaliacao(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0;
  await rodar(FICHA(id, "desempenho"), async () => {
    assert(F.podeAvaliar(s), "Sem permissão para avaliar fornecedores."); const f = await forn(id); assert(!["RASCUNHO"].includes(f.status), "Avalia-se quem já prestou serviço (cadastro ainda em rascunho).");
    const periodo = texto(fd, "periodo", 40); assert(periodo.length >= 4, "Informe o período avaliado (ex.: 2026 · 2º semestre).");
    const notas: Record<string, number> = {}; for (const [k, r] of F.DIMENSOES) { const n = int(fd, k); assert(n !== null && n >= 1 && n <= 5, `Nota de ${r} de 1 a 5.`); notas[k] = n!; }
    const cfg = await F.cfgForn(); const nota = F.notaAvaliacao(notas, cfg.pesos); const coment = texto(fd, "comentario", 1200);
    if (Object.values(notas).some(n => n <= 2) || nota < 6) assert(coment.length >= 10, "Nota baixa pede comentário com o que aconteceu (mínimo 10 caracteres).");
    const u = scopeUnit(s); const unit = u ?? int(fd, "unitId") ?? null; const desde = addDays(hoje(), -183);
    const [ind] = await sql<{ chamados: number; concluidos: number; no_prazo: number; media: number | null; ocorrencias: number }[]>`SELECT
      (SELECT count(*)::int FROM work_orders w WHERE w.supplier_id=${id} AND w.created_at >= ${desde} ${unit ? sql`AND w.unit_id=${unit}` : sql``}) AS chamados,
      (SELECT count(*)::int FROM work_orders w WHERE w.supplier_id=${id} AND w.status='CONCLUIDO' AND w.concluido_em >= ${desde} ${unit ? sql`AND w.unit_id=${unit}` : sql``}) AS concluidos,
      (SELECT count(*)::int FROM work_orders w WHERE w.supplier_id=${id} AND w.status='CONCLUIDO' AND w.concluido_em >= ${desde} AND (w.sla_ate IS NULL OR w.concluido_em <= w.sla_ate) ${unit ? sql`AND w.unit_id=${unit}` : sql``}) AS no_prazo,
      (SELECT round(avg(w.avaliacao)::numeric, 1)::float FROM work_orders w WHERE w.supplier_id=${id} AND w.avaliacao IS NOT NULL AND w.concluido_em >= ${desde} ${unit ? sql`AND w.unit_id=${unit}` : sql``}) AS media,
      (SELECT count(*)::int FROM supplier_occurrences o WHERE o.supplier_id=${id} AND o.data >= ${desde} ${unit ? sql`AND o.unit_id=${unit}` : sql``}) AS ocorrencias`;
    const amostra = ind.concluidos + ind.ocorrencias;
    await sql`INSERT INTO supplier_evaluations (supplier_id, periodo, unit_id, notas, pesos, nota, amostra, indicadores, comentario, avaliador_user_id, avaliador_nome) VALUES (${id}, ${periodo}, ${unit}, ${JSON.stringify(notas)}::jsonb, ${JSON.stringify(cfg.pesos)}::jsonb, ${nota}, ${amostra}, ${JSON.stringify({ ...ind, desde })}::jsonb, ${coment || null}, ${s.id}, ${s.nome})`;
    await log(s, "avaliação de fornecedor", id, null, { periodo, nota, notas, amostra });
    return `Avaliação registrada: nota ${String(nota).replace(".", ",")} de 10${amostra < 3 ? " — amostra pequena (menos de 3 eventos): leia como indicativa" : ""}.`;
  });
}
export async function registrarOcorrencia(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0;
  await rodar(FICHA(id, "desempenho"), async () => {
    assert(F.podeAvaliar(s), "Sem permissão."); await forn(id);
    const nat = str(fd, "natureza"); assert(nat in F.NATUREZAS_OCORRENCIA, "Escolha a natureza."); const sev = str(fd, "severidade"); assert(sev in F.SEVERIDADES, "Escolha a severidade.");
    const desc = texto(fd, "descricao", 1200); assert(desc.length >= 10, "Descreva a ocorrência (mínimo 10 caracteres)."); const data = dataOuNull(fd, "data") ?? hoje(); assert(data <= hoje(), "Data no futuro.");
    const u = scopeUnit(s); const unit = u ?? int(fd, "unitId") ?? null; const prazo = dataOuNull(fd, "prazo"); const os = int(fd, "workOrderId");
    if (os) { const [w] = await sql`SELECT 1 FROM work_orders WHERE id=${os} AND supplier_id=${id}`; assert(!!w, "Chamado não é deste fornecedor."); }
    await sql`INSERT INTO supplier_occurrences (supplier_id, unit_id, data, natureza, severidade, descricao, causa, plano, prazo, work_order_id, registrado_por_nome) VALUES (${id}, ${unit}, ${data}, ${nat}, ${sev}, ${desc}, ${texto(fd, "causa", 600) || null}, ${texto(fd, "plano", 600) || null}, ${prazo}, ${os ?? null}, ${s.nome})`;
    await log(s, "ocorrência de fornecedor", id, null, { natureza: nat, severidade: sev, data });
    if (sev === "ALTA") await avisar(["DIRECAO", "OPERACOES", "FINANCEIRO"], "Ocorrência grave registrada com fornecedor", FICHA(id, "desempenho"), `forn-oc:${id}:${hoje()}`, "INFO");
    return "Ocorrência registrada — entra no risco e na próxima avaliação.";
  });
}
export async function fecharOcorrencia(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const oid = int(fd, "ocorrenciaId") ?? 0;
  await rodar(FICHA(id, "desempenho"), async () => {
    assert(F.podeAvaliar(s), "Sem permissão."); const obs = texto(fd, "fechamento", 600); assert(obs.length >= 10, "Diga como foi resolvida (mínimo 10 caracteres).");
    const r = await sql`UPDATE supplier_occurrences SET status='FECHADA', fechamento_em=now(), fechamento_obs=${obs} WHERE id=${oid} AND supplier_id=${id} AND status<>'FECHADA'`; assert(r.count > 0, "Ocorrência não encontrada ou já fechada.");
    await log(s, "ocorrência de fornecedor fechada", id, null, { ocorrencia: oid }); return "Ocorrência fechada.";
  });
}

// ======================= portal do fornecedor (UX-SUP-12 · SUP-RN-014) =======================
export async function gerarConvite(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0;
  await rodar(FICHA(id, "portal"), async () => {
    assert(F.podeCadastrar(s), "Sem permissão."); const f = await forn(id); assert(!["INATIVO", "REJEITADO"].includes(f.status), "Cadastro inativo ou rejeitado não recebe convite.");
    const cfg = await F.cfgForn(); const dias = Math.max(1, Math.min(30, int(fd, "dias") ?? cfg.conviteDias)); const email = str(fd, "email").toLowerCase(); assert(!email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), "E-mail inválido.");
    const escopo = fd.getAll("escopo").map(String).filter(x => ["contatos", "banco", "documentos"].includes(x)); assert(escopo.length > 0, "Marque o que o fornecedor pode atualizar.");
    const token = novoTokenPortal(); const ate = addDays(hoje(), dias);
    await sql.begin(async tx => { await tx`UPDATE supplier_invitations SET estado='CANCELADO' WHERE supplier_id=${id} AND estado='ATIVO'`; await tx`INSERT INTO supplier_invitations (supplier_id, email, token_hash, expira_em, escopo, criado_por_nome) VALUES (${id}, ${email || null}, ${hashToken(token)}, ${ate}, ${JSON.stringify(escopo)}::jsonb, ${s.nome})`; });
    await log(s, "convite do portal do fornecedor", id, null, { email: email || null, ate, escopo });
    return [FICHA(id, "portal", `&convite=${encodeURIComponent(token)}`), `Convite gerado, válido até ${F.dataBR(ate)}. Copie o link agora (ele não aparece de novo) e envie ao contato do fornecedor.`];
  });
}
export async function cancelarConvite(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0;
  await rodar(FICHA(id, "portal"), async () => { assert(F.podeCadastrar(s), "Sem permissão."); await sql`UPDATE supplier_invitations SET estado='CANCELADO' WHERE supplier_id=${id} AND estado='ATIVO'`; await log(s, "convite do portal cancelado", id, null, null); return "Convite cancelado: o link deixou de funcionar."; });
}
type Campo = { campo: string; rotulo: string; antes: string | null; depois: string | null; alvo: string };
export async function decidirAlteracao(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const rid = int(fd, "alteracaoId") ?? 0; const volta = str(fd, "voltar") === "lista" ? LISTA("portal") : FICHA(id, "portal");
  await rodar(volta, async () => {
    assert(F.podeCadastrar(s), "Sem permissão."); const [r] = await sql<{ id: number; campos: Campo[]; status: string; protocolo: string }[]>`SELECT id, campos, status, protocolo FROM supplier_change_requests WHERE id=${rid} AND supplier_id=${id}`;
    assert(!!r, "Alteração não encontrada."); assert(r.status === "PENDENTE", "Esta alteração já foi decidida.");
    if (str(fd, "decisao") === "RECUSAR") { const motivo = texto(fd, "motivo", 300); assert(motivo.length >= 5, "Escreva o motivo."); await sql`UPDATE supplier_change_requests SET status='RECUSADA', decidido_nome=${s.nome}, decidido_em=now(), motivo=${motivo} WHERE id=${rid}`; await log(s, "alteração do portal recusada", id, null, { protocolo: r.protocolo, motivo }); return `Alteração ${r.protocolo} recusada.`; }
    const marcados = new Set(fd.getAll("aplicar").map(Number)); assert(marcados.size > 0, "Marque o que vai aplicar (ou recuse).");
    const [mat] = await sql<{ id: number }[]>`SELECT id FROM supplier_establishments WHERE supplier_id=${id} AND ativo ORDER BY matriz DESC, id LIMIT 1`;
    await sql.begin(async tx => {
      for (const [i, c] of r.campos.entries()) { if (!marcados.has(i)) continue;
        if (c.alvo === "estab" && mat && ["cep", "logradouro", "numero", "complemento", "bairro", "cidade", "uf"].includes(c.campo)) await tx`UPDATE supplier_establishments SET ${tx({ [c.campo]: c.depois })}, updated_at=now() WHERE id=${mat.id}`;
        if (c.alvo.startsWith("contato:") && ["nome", "telefone", "email", "cargo"].includes(c.campo) && Object.keys(F.FINALIDADES_CONTATO).includes(c.alvo.slice(8))) {
          const fin = c.alvo.slice(8); let [ct] = await tx<{ id: number }[]>`SELECT id FROM supplier_contacts WHERE supplier_id=${id} AND finalidade=${fin} AND ativo ORDER BY principal DESC, id LIMIT 1`;
          // contato novo pelo portal: cria com o nome enviado (ou um rótulo neutro, se só vieram e-mail/telefone)
          if (!ct) { const nomeNovo = r.campos.find(x => x.alvo === c.alvo && x.campo === "nome")?.depois || "Contato do fornecedor"; [ct] = await tx<{ id: number }[]>`INSERT INTO supplier_contacts (supplier_id, nome, finalidade, principal) VALUES (${id}, ${nomeNovo}, ${fin}, ${fin === "PRINCIPAL" && !(await tx`SELECT 1 FROM supplier_contacts WHERE supplier_id=${id} AND principal AND ativo`).length}) RETURNING id`; }
          await tx`UPDATE supplier_contacts SET ${tx({ [c.campo]: c.depois })} WHERE id=${ct.id}`; }
      }
      await tx`UPDATE supplier_change_requests SET status=${marcados.size === r.campos.length ? "APLICADA" : "PARCIAL"}, decidido_nome=${s.nome}, decidido_em=now() WHERE id=${rid}`;
    });
    await log(s, "alteração do portal aplicada", id, null, { protocolo: r.protocolo, campos: r.campos.filter((_, i) => marcados.has(i)).map(c => ({ campo: c.rotulo, antes: c.antes, depois: c.depois })) });
    return `Alteração ${r.protocolo} aplicada (${marcados.size} campo(s)).`;
  });
}

// ======================= importação controlada (18.1) =======================
type LinhaImp = { n: number; tipoDoc: string; documento: string; razao: string; fantasia: string; categoria: string; email: string; telefone: string; cidade: string; uf: string; situacao: "OK" | "ERRO" | "DUPLICADO"; erro: string };
export async function previaImportacao(fd: FormData) {
  const s = await requireSession();
  await rodar(LISTA("importar"), async () => {
    assert(F.podeCadastrar(s), "Sem permissão para importar."); const txt = str(fd, "texto"); assert(txt.length > 10, "Cole as linhas da planilha (com o cabeçalho)."); assert(txt.length <= 400_000, "Planilha grande demais: divida em partes.");
    const linhas = txt.split(/\r?\n/).filter(l => l.trim()); const sep = linhas[0].includes("\t") ? "\t" : linhas[0].includes(";") ? ";" : ",";
    const cab = linhas[0].split(sep).map(c => c.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "_"));
    const col = (...ns: string[]) => cab.findIndex(c => ns.includes(c)); const iDoc = col("cnpj", "cpf", "documento", "cnpj_cpf"); const iRaz = col("razao_social", "razao", "nome"); assert(iDoc >= 0 && iRaz >= 0, "O cabeçalho precisa de “documento” (ou cnpj/cpf) e “razao_social”.");
    const iFan = col("nome_fantasia", "fantasia"), iCat = col("categoria"), iEm = col("email", "e-mail"), iTel = col("telefone", "fone"), iCid = col("cidade", "municipio"), iUf = col("uf", "estado");
    const cfg = await F.cfgForn(); const existentes = new Set((await sql<{ k: string }[]>`SELECT tipo_doc || ':' || documento AS k FROM supplier_establishments WHERE ativo`).map(x => x.k)); const vistos = new Set<string>(); const out: LinhaImp[] = [];
    for (const [i, l] of linhas.slice(1, 1001).entries()) {
      const c = l.split(sep).map(x => x.trim().replace(/^"|"$/g, "")); const bruto = c[iDoc] ?? ""; const tipoDoc = F.soDigitos(bruto).length === 11 ? "CPF" : "CNPJ"; const [doc, err] = F.normalizarDocumento(tipoDoc, bruto);
      const cat = cfg.categorias.find(([n]) => n.toLowerCase() === (c[iCat] ?? "").toLowerCase())?.[0] ?? "Outros"; const k = `${tipoDoc}:${doc}`;
      const linha: LinhaImp = { n: i + 2, tipoDoc, documento: doc, razao: (c[iRaz] ?? "").slice(0, 160), fantasia: iFan >= 0 ? (c[iFan] ?? "").slice(0, 120) : "", categoria: cat, email: iEm >= 0 ? (c[iEm] ?? "").toLowerCase() : "", telefone: iTel >= 0 ? c[iTel] ?? "" : "", cidade: iCid >= 0 ? c[iCid] ?? "" : "", uf: iUf >= 0 ? (c[iUf] ?? "").toUpperCase().slice(0, 2) : "", situacao: "OK", erro: "" };
      if (err) { linha.situacao = "ERRO"; linha.erro = err; } else if (linha.razao.length < 3) { linha.situacao = "ERRO"; linha.erro = "Sem razão social."; } else if (existentes.has(k)) { linha.situacao = "DUPLICADO"; linha.erro = "Já cadastrado."; } else if (vistos.has(k)) { linha.situacao = "DUPLICADO"; linha.erro = "Repetido na planilha."; }
      vistos.add(k); out.push(linha);
    }
    await sql`INSERT INTO settings (key, value) VALUES (${`forn_import_${s.id}`}, ${JSON.stringify({ em: new Date().toISOString(), linhas: out })}::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`;
    const ok = out.filter(x => x.situacao === "OK").length; return `Prévia pronta: ${ok} linha(s) entram como rascunho, ${out.length - ok} ficam de fora (veja o motivo). Nada foi gravado ainda.`;
  });
}
export async function confirmarImportacao(fd: FormData) {
  const s = await requireSession(); void fd;
  await rodar(LISTA("importar"), async () => {
    assert(F.podeCadastrar(s), "Sem permissão para importar."); const [p] = await sql<{ value: { linhas: LinhaImp[] } }[]>`SELECT value FROM settings WHERE key=${`forn_import_${s.id}`}`; assert(!!p, "Faça a prévia antes de confirmar.");
    const cfg = await F.cfgForn(); let n = 0, rep = 0;
    for (const l of p.value.linhas.filter(x => x.situacao === "OK")) {
      try {
        await sql.begin(async tx => {
          const [f] = await tx<{ id: number }[]>`INSERT INTO suppliers (nome, servico, tipo, categoria, criticidade, status, origem, criado_por, abrangencia, ativo, email, telefone) VALUES (${l.fantasia || l.razao}, ${l.categoria}, ${l.tipoDoc === "CPF" ? "PF" : "PJ"}, ${l.categoria}, ${F.criticidadeDaCategoria(cfg, l.categoria)}, 'RASCUNHO', 'IMPORTACAO', ${s.id}, 'REDE', true, ${l.email || null}, ${l.telefone || null}) RETURNING id`;
          await tx`INSERT INTO supplier_establishments (supplier_id, tipo_doc, documento, razao_social, nome_fantasia, matriz, cidade, uf, regime) VALUES (${f.id}, ${l.tipoDoc}, ${l.documento}, ${l.razao}, ${l.fantasia || null}, true, ${l.cidade || null}, ${/^[A-Z]{2}$/.test(l.uf) ? l.uf : null}, ${l.tipoDoc === "CPF" ? "PF" : null})`;
          if (l.email || l.telefone) await tx`INSERT INTO supplier_contacts (supplier_id, nome, finalidade, telefone, email, principal) VALUES (${f.id}, ${"Contato principal"}, 'PRINCIPAL', ${l.telefone || null}, ${l.email || null}, true)`;
        }); n++;
      } catch { rep++; }
    }
    await sql`DELETE FROM settings WHERE key=${`forn_import_${s.id}`}`;
    await audit(s, "importação de fornecedores", "suppliers", null, null, { importados: n, repetidos: rep, origem: "IMPORTACAO" });
    return `${n} fornecedor(es) importado(s) como rascunho (não autorizam compras até a homologação)${rep ? `; ${rep} já existiam e ficaram de fora` : ""}.`;
  });
}
