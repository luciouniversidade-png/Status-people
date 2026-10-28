"use server";
import { redirect } from "next/navigation";
import { createHash } from "crypto";
import { sql } from "@/db";
import { requireSession, assert, type Session } from "@/lib/auth";
import { audit, str, strOrNull, int, caminhoSeguro, hoje, detectarSeparador, normalizarCabecalho, getSettings } from "@/lib/utils";
import { textoImportacao } from "@/lib/importacao";
import { notificar, usuariosPorPerfil } from "@/lib/comunicacao";
import { lerOFX, lerExtratoCSV, lerCielo, classificarLinha, categoriaCaixa, processarConciliacao, mesesInteiros, competenciaFechada, mensagemTrava, gateFechamento, podeOperar, podeTriar, CLASSES_IGNORA, semAcento, type LinhaExtrato } from "@/lib/conciliacao";
import { comMensagem } from "@/lib/redirecionar";

const go = (b: string, k: "ok" | "erro", m: string) => comMensagem(b, k, m);
const msg = (e: unknown) => e instanceof Error ? e.message : "Erro inesperado.";
const BASE = "/financeiro/conciliacao";
async function operador() { const s = await requireSession(); if (!podeOperar(s)) { await audit(s, "acesso negado: conciliação (escrita)", "bank_lines", null, null, { papel: s.role }); throw new Error("Só Financeiro e Direção operam a conciliação."); } return s; }
async function triagem() { const s = await requireSession(); if (!podeTriar(s)) { await audit(s, "acesso negado: triagem de PIX", "bank_lines", null, null, { papel: s.role }); throw new Error("Seu acesso não faz a triagem de pagamentos."); } return s; }
const ultimoDia = (comp: string) => { const [a, m] = comp.split("-").map(Number); return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10); };

// ---------------------------------------------------------------- contas bancárias
export async function salvarConta(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), `${BASE}?aba=contas`); const id = int(fd, "id");
  try {
    const s = await operador(); const apelido = str(fd, "apelido"); assert(apelido.length >= 3, "Dê um apelido à conta (ex.: Itaú Carandá — movimento).");
    const unitId = int(fd, "unitId"); const companyId = int(fd, "companyId"); const tipo = ["CORRENTE", "PAGAMENTO", "INVESTIMENTO"].includes(str(fd, "tipo")) ? str(fd, "tipo") : "CORRENTE";
    if (unitId) { const [u] = await sql`SELECT 1 FROM units WHERE id=${unitId}`; assert(!!u, "Unidade inválida."); }
    if (companyId) { const [c] = await sql`SELECT 1 FROM companies WHERE id=${companyId}`; assert(!!c, "Entidade inválida."); }
    const conta = str(fd, "conta").replace(/\s/g, ""); const dados = { apelido, banco: strOrNull(fd, "banco"), agencia: strOrNull(fd, "agencia"), conta: conta || null, unitId, companyId, tipo, ativo: str(fd, "ativo") !== "0", obs: strOrNull(fd, "obs") };
    if (id) { await sql`UPDATE bank_accounts SET apelido=${dados.apelido}, banco=${dados.banco}, agencia=${dados.agencia}, conta=coalesce(${dados.conta}, conta), unit_id=${unitId}, company_id=${companyId}, tipo=${tipo}, ativo=${dados.ativo}, obs=${dados.obs} WHERE id=${id}`; await audit(s, "editar conta bancária", "bank_accounts", id, null, { ...dados, conta: dados.conta ? `…${dados.conta.slice(-4)}` : null }); }
    else { const [r] = await sql<{ id: number }[]>`INSERT INTO bank_accounts (apelido, banco, agencia, conta, unit_id, company_id, tipo, ativo, obs, created_by) VALUES (${dados.apelido}, ${dados.banco}, ${dados.agencia}, ${dados.conta}, ${unitId}, ${companyId}, ${tipo}, ${dados.ativo}, ${dados.obs}, ${s.id}) RETURNING id`; await audit(s, "cadastrar conta bancária", "bank_accounts", r.id, null, { apelido, unitId, companyId }); }
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(voltar, "ok", "Conta salva."));
}

// ---------------------------------------------------------------- importação do extrato (OFX ou CSV)
export async function importarExtrato(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), `${BASE}?aba=contas`); let resumo = "";
  try {
    const s = await operador(); const cfg = await getSettings(); const contaId = int(fd, "contaId"); assert(!!contaId, "Escolha a conta do extrato.");
    const [conta] = await sql<{ id: number; apelido: string; unit_id: number | null; ativo: boolean }[]>`SELECT id, apelido, unit_id, ativo FROM bank_accounts WHERE id=${contaId}`; assert(!!conta && conta.ativo, "Conta não encontrada ou inativa.");
    const texto = await textoImportacao(fd); assert(texto.length > 0, "Envie o arquivo do extrato (OFX ou CSV) ou cole o conteúdo.");
    const arq = fd.get("arquivo"); const nome = arq && typeof arq === "object" && "name" in arq ? String((arq as File).name) : "colado";
    const ofx = /<OFX|<STMTTRN/i.test(texto); const linhas: LinhaExtrato[] = ofx ? lerOFX(texto) : lerExtratoCSV(texto, detectarSeparador, normalizarCabecalho);
    assert(linhas.length > 0, "Nenhum lançamento reconhecido no arquivo.");
    const lancar = str(fd, "lancarCaixa") === "1"; const unidadeCaixa = conta.unit_id ?? int(fd, "unitCaixa");
    const datas = linhas.map(l => l.data).sort(); const [imp] = await sql<{ id: number }[]>`INSERT INTO recon_imports (tipo, bank_account_id, arquivo, linhas, periodo_ini, periodo_fim, user_id, user_nome) VALUES (${ofx ? "OFX" : "CSV"}, ${contaId}, ${nome.slice(0, 120)}, ${linhas.length}, ${datas[0]}, ${datas[datas.length - 1]}, ${s.id}, ${s.nome}) RETURNING id`;
    let novas = 0, repetidas = 0, travadas = 0, caixa = 0; const travas = new Map<string, boolean>();
    for (const l of linhas) {
      const comp = l.data.slice(0, 7); if (!travas.has(comp)) travas.set(comp, !!(await competenciaFechada(l.data, conta.unit_id)));
      if (travas.get(comp)) { travadas++; continue; }
      const forma = classificarLinha(`${l.descricao} ${l.pagador ?? ""}`, l.valor, cfg);
      const r = await sql<{ id: number }[]>`INSERT INTO bank_lines (bank_account_id, import_id, data, valor, forma, descricao, documento, pagador, pagador_doc, chave, status)
        VALUES (${contaId}, ${imp.id}, ${l.data}, ${l.valor}, ${forma}, ${l.descricao.slice(0, 300)}, ${l.documento}, ${l.pagador?.slice(0, 160) ?? null}, ${l.pagadorDoc ? `***${l.pagadorDoc.replace(/\D/g, "").slice(-4)}` : null}, ${l.chave.slice(0, 300)}, ${l.valor > 0 && ["PIX", "BOLETO", "TED", "DEPOSITO", "OUTRO", "CARTAO"].includes(forma) ? "PENDENTE" : "IGNORADO"})
        ON CONFLICT (bank_account_id, chave) DO NOTHING RETURNING id`;
      if (!r.length) { repetidas++; continue; } novas++;
      if (lancar && unidadeCaixa) {
        const cat = categoriaCaixa(forma, l.valor); const valor = Math.abs(l.valor); const contraparte = l.pagador ?? null;
        const hash = createHash("sha1").update([unidadeCaixa, l.data, cat.tipo, valor.toFixed(2), l.descricao, contraparte ?? ""].join("|")).digest("hex");
        const ce = await sql<{ id: number }[]>`INSERT INTO cash_entries (unit_id, data, tipo, categoria, forma, descricao, valor, contraparte, hash, bank_account_id, bank_line_id) VALUES (${unidadeCaixa}, ${l.data}, ${cat.tipo}, ${cat.categoria}, ${forma === "CARTAO" ? "CARTAO" : forma === "TARIFA" || forma === "TRANSFERENCIA" ? "TRANSFERENCIA" : forma}, ${l.descricao.slice(0, 300)}, ${valor}, ${contraparte}, ${hash}, ${contaId}, ${r[0].id}) ON CONFLICT (hash) WHERE hash IS NOT NULL DO NOTHING RETURNING id`;
        if (ce.length) { caixa++; await sql`UPDATE bank_lines SET cash_entry_id=${ce[0].id} WHERE id=${r[0].id}`; }
      }
    }
    await sql`UPDATE recon_imports SET novas=${novas}, repetidas=${repetidas}, travadas=${travadas} WHERE id=${imp.id}`;
    await audit(s, "importar extrato bancário", "recon_imports", imp.id, null, { conta: conta.apelido, formato: ofx ? "OFX" : "CSV", novas, repetidas, travadas, caixa });
    const p = novas ? await processarConciliacao(...mesesInteiros(datas), s) : null;
    resumo = `${novas} lançamento(s) novo(s), ${repetidas} repetido(s) ignorado(s)${travadas ? `, ${travadas} em competência fechada (não entraram)` : ""}${lancar ? `; ${caixa} lançado(s) no fluxo de caixa${!unidadeCaixa ? " — escolha a unidade do fluxo para contas sem unidade" : ""}` : ""}.`
      + (p ? ` Conciliação: ${p.conciliadosAuto} conciliado(s) automaticamente, ${p.sugeridos} para confirmar, ${p.semBaixa} sem baixa no ActiveSoft, ${p.naoIdentificados} não identificado(s).` : "");
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(`${BASE}?aba=pix`, "ok", resumo));
}

// ---------------------------------------------------------------- relatório da Cielo
export async function importarCielo(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), `${BASE}?aba=contas`); let resumo = "";
  try {
    const s = await operador(); const texto = await textoImportacao(fd); assert(texto.length > 0, "Envie o relatório de vendas da Cielo (CSV ou planilha).");
    const vendas = lerCielo(texto, detectarSeparador, normalizarCabecalho); assert(vendas.length > 0, "Nenhuma venda reconhecida no relatório.");
    const units = await sql<{ id: number; nome: string; codigo: string }[]>`SELECT id, nome, codigo FROM units`; const padrao = int(fd, "unitId");
    const norm = (v: string) => semAcento(v).toLowerCase().trim();
    const arq = fd.get("arquivo"); const nome = arq && typeof arq === "object" && "name" in arq ? String((arq as File).name) : "colado";
    const datas = vendas.map(v => v.dataVenda).sort(); const [imp] = await sql<{ id: number }[]>`INSERT INTO recon_imports (tipo, arquivo, linhas, periodo_ini, periodo_fim, user_id, user_nome) VALUES ('CIELO', ${nome.slice(0, 120)}, ${vendas.length}, ${datas[0]}, ${datas[datas.length - 1]}, ${s.id}, ${s.nome}) RETURNING id`;
    let novas = 0, repetidas = 0, travadas = 0; let maxPag = datas[datas.length - 1];
    for (const v of vendas) {
      const un = v.unidade ? units.find(u => norm(u.nome) === norm(v.unidade!) || norm(u.codigo) === norm(v.unidade!)) : undefined; const unitId = un?.id ?? padrao ?? null;
      if (await competenciaFechada(v.dataVenda, unitId)) { travadas++; continue; }
      const r = await sql<{ id: number }[]>`INSERT INTO card_sales (import_id, unit_id, data_venda, data_pagamento, bandeira, produto, parcelas, parcela, nsu, autorizacao, valor_bruto, valor_taxa, valor_liquido, antecipado, chave)
        VALUES (${imp.id}, ${unitId}, ${v.dataVenda}, ${v.dataPagamento}, ${v.bandeira}, ${v.produto}, ${v.parcelas}, ${v.parcela}, ${v.nsu}, ${v.autorizacao}, ${v.bruto}, ${v.taxa}, ${v.liquido}, ${v.antecipado}, ${v.chave}) ON CONFLICT (chave) DO NOTHING RETURNING id`;
      if (r.length) { novas++; if (v.dataPagamento && v.dataPagamento > maxPag) maxPag = v.dataPagamento; } else repetidas++;
    }
    await sql`UPDATE recon_imports SET novas=${novas}, repetidas=${repetidas}, travadas=${travadas} WHERE id=${imp.id}`;
    await audit(s, "importar relatório da Cielo", "recon_imports", imp.id, null, { novas, repetidas, travadas });
    const p = novas ? await processarConciliacao(...mesesInteiros([datas[0], maxPag > hoje() ? hoje() : maxPag]), s) : null;
    resumo = `${novas} venda(s) nova(s), ${repetidas} repetida(s) ignorada(s)${travadas ? `, ${travadas} em competência fechada` : ""}.` + (p ? ` ${p.vendasCasadas} venda(s) casada(s) com o título e ${p.repassesConciliados} repasse(s) conciliado(s) com o banco.` : "");
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(`${BASE}?aba=cartao`, "ok", resumo));
}

export async function reprocessar(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), BASE); let resumo = "";
  try {
    const s = await operador(); const comp = str(fd, "competencia"); assert(/^\d{4}-\d{2}$/.test(comp), "Competência inválida.");
    const fim = ultimoDia(comp) > hoje() ? hoje() : ultimoDia(comp); const p = await processarConciliacao(`${comp}-01`, fim, s);
    await audit(s, "reprocessar conciliação", "recon_matches", null, null, { competencia: comp, ...p });
    resumo = `Conciliação de ${comp.split("-").reverse().join("/")} refeita: ${p.conciliadosAuto} par(es) automático(s), ${p.sugeridos} sugestão(ões), ${p.vendasCasadas} venda(s) casada(s), ${p.repassesConciliados} repasse(s); ${p.resolvidasAuto} pendência(s) resolvida(s) sozinha(s).`;
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(voltar, "ok", resumo));
}

// ---------------------------------------------------------------- confirmar, vincular, desfazer, classificar
async function travaDaLinha(lineId: number) {
  const [l] = await sql<{ data: string; unit_id: number | null; valor: number; status: string; bank_account_id: number; student_id: number | null }[]>`SELECT l.data::text, a.unit_id, l.valor::float, l.status, l.bank_account_id, l.student_id FROM bank_lines l JOIN bank_accounts a ON a.id=l.bank_account_id WHERE l.id=${lineId}`;
  assert(!!l, "Lançamento não encontrado."); const f = await competenciaFechada(l.data, l.unit_id); assert(!f, f ? mensagemTrava(f) : ""); return l;
}
async function resolverDaLinha(s: Session, lineId: number, desfecho: string, obs: string) {
  const r = await sql<{ id: number }[]>`UPDATE recon_issues SET status='RESOLVIDA', desfecho=${desfecho}, desfecho_obs=${obs}, resolvido_em=now(), resolvido_por=${s.id}, updated_at=now() WHERE status='ABERTA' AND bank_line_id=${lineId} RETURNING id`;
  for (const x of r) await audit(s, "resolver pendência de conciliação", "recon_issues", x.id, { status: "ABERTA" }, { status: "RESOLVIDA", desfecho });
}

/** Confirma a sugestão (um grupo: crédito × título(s), ou venda × título). */
export async function confirmarPar(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), BASE);
  try {
    const s = await operador(); const grupo = str(fd, "grupo"); const ms = await sql<{ id: number; receivable_id: number | null; bank_line_id: number | null; card_sale_id: number | null }[]>`SELECT id, receivable_id, bank_line_id, card_sale_id FROM recon_matches WHERE grupo=${grupo} AND status='SUGERIDO'`;
    assert(ms.length > 0, "Sugestão não encontrada (talvez já confirmada ou refeita).");
    if (ms[0].bank_line_id) await travaDaLinha(ms[0].bank_line_id);
    await sql`UPDATE recon_matches SET status='CONFIRMADO', metodo='HUMANO', user_id=${s.id}, user_nome=${s.nome}, confirmado_em=now() WHERE grupo=${grupo} AND status='SUGERIDO'`;
    const recs = ms.map(m => m.receivable_id).filter((x): x is number => !!x); if (recs.length) await sql`UPDATE receivables SET conciliado_em=now() WHERE id = ANY(${recs})`;
    if (ms[0].bank_line_id) { await sql`UPDATE bank_lines SET status='CONCILIADO' WHERE id=${ms[0].bank_line_id}`; await resolverDaLinha(s, ms[0].bank_line_id, "IDENTIFICADO", "Par confirmado na conciliação."); }
    if (ms[0].card_sale_id) { const [v] = await sql<{ nsu: string | null; data_venda: string; chave: string }[]>`SELECT nsu, data_venda::text, chave FROM card_sales WHERE id=${ms[0].card_sale_id}`;
      await sql`UPDATE card_sales SET status='CASADA' WHERE ${v.nsu ? sql`nsu=${v.nsu} AND data_venda=${v.data_venda}` : sql`id=${ms[0].card_sale_id}`}`;
      await sql`UPDATE recon_issues SET status='RESOLVIDA', desfecho='IDENTIFICADO', desfecho_obs='Venda casada com o título.', resolvido_em=now(), resolvido_por=${s.id} WHERE status='ABERTA' AND card_sale_id=${ms[0].card_sale_id} AND tipo='VENDA_SEM_TITULO'`; }
    await audit(s, "confirmar par da conciliação", "recon_matches", ms[0].id, { status: "SUGERIDO" }, { status: "CONFIRMADO", grupo, titulos: recs });
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(voltar, "ok", "Par confirmado."));
}

/** Aprovação em lote (C10): confirma as sugestões do período com confiança mínima; as demais ficam à vista. */
export async function confirmarLote(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), BASE); let n = 0, fora = 0;
  try {
    const s = await operador(); const min = Math.max(50, Math.min(99, int(fd, "minimo") ?? 80)); const comp = str(fd, "competencia"); assert(/^\d{4}-\d{2}$/.test(comp), "Competência inválida.");
    const grupos = await sql<{ grupo: string; conf: number; line: number | null; data: string | null }[]>`SELECT m.grupo, min(m.confianca)::int AS conf, min(m.bank_line_id) AS line, min(l.data)::text AS data FROM recon_matches m LEFT JOIN bank_lines l ON l.id=m.bank_line_id
      WHERE m.status='SUGERIDO' AND m.bank_line_id IS NOT NULL AND to_char(l.data, 'YYYY-MM')=${comp} GROUP BY m.grupo`;
    for (const g of grupos) {
      if (g.conf < min) { fora++; continue; }
      if (g.line) { const l = await sql<{ unit_id: number | null }[]>`SELECT a.unit_id FROM bank_lines x JOIN bank_accounts a ON a.id=x.bank_account_id WHERE x.id=${g.line}`; if (await competenciaFechada(g.data!, l[0]?.unit_id ?? null)) { fora++; continue; } }
      const ms = await sql<{ receivable_id: number | null }[]>`UPDATE recon_matches SET status='CONFIRMADO', metodo='HUMANO', user_id=${s.id}, user_nome=${s.nome}, confirmado_em=now() WHERE grupo=${g.grupo} AND status='SUGERIDO' RETURNING receivable_id`;
      const recs = ms.map(m => m.receivable_id).filter((x): x is number => !!x); if (recs.length) await sql`UPDATE receivables SET conciliado_em=now() WHERE id = ANY(${recs})`;
      if (g.line) { await sql`UPDATE bank_lines SET status='CONCILIADO' WHERE id=${g.line}`; await resolverDaLinha(s, g.line, "IDENTIFICADO", "Par confirmado em lote."); }
      n++;
    }
    await audit(s, "confirmar pares em lote", "recon_matches", null, null, { competencia: comp, minimo: min, confirmados: n, foraDoLote: fora });
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(voltar, "ok", `${n} par(es) confirmado(s) em lote${fora ? `; ${fora} ficaram para análise item a item (confiança abaixo do mínimo ou competência fechada)` : ""}.`));
}

/** Vínculo manual: o crédito paga exatamente estes títulos (a soma tem de bater; diferença vira pendência pela conciliação). */
export async function vincular(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), BASE);
  try {
    const s = await operador(); const lineId = int(fd, "lineId") ?? 0; const l = await travaDaLinha(lineId);
    assert(["PENDENTE", "SUGERIDO", "SEM_PAR", "NAO_IDENTIFICADO", "DIVERGENTE", "SEM_BAIXA"].includes(l.status), "Este crédito já está conciliado ou classificado — desfaça antes.");
    const ids = [...new Set(fd.getAll("receivableId").map(Number).filter(n => Number.isInteger(n) && n > 0))]; assert(ids.length > 0, "Marque os títulos pagos por este crédito.");
    const recs = await sql<{ id: number; status: string; valor: number; conciliado_em: string | null; student_id: number | null }[]>`SELECT id, status, coalesce(valor_pago, valor)::float AS valor, conciliado_em::text, student_id FROM receivables WHERE id = ANY(${ids})`;
    assert(recs.length === ids.length, "Título não encontrado."); assert(recs.every(r => r.status === "PAGO"), "Só títulos já baixados no ActiveSoft entram no par (a quitação oficial é do ActiveSoft). Para crédito sem baixa, registre a baixa lá e reimporte os títulos.");
    assert(recs.every(r => !r.conciliado_em), "Algum título já está conciliado com outro crédito.");
    const soma = Math.round(recs.reduce((a, r) => a + r.valor, 0) * 100) / 100; assert(Math.abs(soma - l.valor) < 0.005, `A soma dos títulos (${soma.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}) não bate com o crédito (${l.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}).`);
    const motivo = strOrNull(fd, "motivo") ?? "Vínculo manual"; const grupo = `man-${Date.now().toString(36)}-${lineId}`;
    await sql`UPDATE recon_matches SET status='DESFEITO', desfeito_em=now(), motivo_desfazer='Substituído por vínculo manual' WHERE bank_line_id=${lineId} AND status='SUGERIDO'`;
    for (const r of recs) await sql`INSERT INTO recon_matches (tipo, grupo, receivable_id, bank_line_id, valor, confianca, metodo, status, motivo, user_id, user_nome, confirmado_em) VALUES ('MANUAL', ${grupo}, ${r.id}, ${lineId}, ${r.valor}, 100, 'HUMANO', 'CONFIRMADO', ${motivo}, ${s.id}, ${s.nome}, now())`;
    await sql`UPDATE receivables SET conciliado_em=now() WHERE id = ANY(${ids})`; await sql`UPDATE bank_lines SET status='CONCILIADO', student_id=coalesce(student_id, ${recs[0].student_id}) WHERE id=${lineId}`;
    await resolverDaLinha(s, lineId, "IDENTIFICADO", motivo); await audit(s, "vincular crédito a títulos", "bank_lines", lineId, { status: l.status }, { status: "CONCILIADO", titulos: ids, motivo });
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(voltar, "ok", "Crédito vinculado e conciliado."));
}

export async function desfazer(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), BASE);
  try {
    const s = await operador(); const grupo = str(fd, "grupo"); const motivo = str(fd, "motivo"); assert(motivo.length >= 5, "Explique por que o par está errado.");
    const ms = await sql<{ id: number; receivable_id: number | null; bank_line_id: number | null; card_sale_id: number | null; tipo: string }[]>`SELECT id, receivable_id, bank_line_id, card_sale_id, tipo FROM recon_matches WHERE grupo=${grupo} AND status='CONFIRMADO'`; assert(ms.length > 0, "Par não encontrado.");
    if (ms[0].bank_line_id) await travaDaLinha(ms[0].bank_line_id);
    await sql`UPDATE recon_matches SET status='DESFEITO', desfeito_em=now(), motivo_desfazer=${motivo} WHERE grupo=${grupo}`;
    const recs = ms.map(m => m.receivable_id).filter((x): x is number => !!x); if (recs.length) await sql`UPDATE receivables SET conciliado_em=NULL WHERE id = ANY(${recs})`;
    if (ms[0].bank_line_id) await sql`UPDATE bank_lines SET status='PENDENTE' WHERE id=${ms[0].bank_line_id}`;
    if (ms[0].card_sale_id) { if (ms[0].tipo === "REPASSE") await sql`UPDATE card_sales SET repasse='A_RECEBER' WHERE id=${ms[0].card_sale_id}`; else await sql`UPDATE card_sales SET status='PENDENTE' WHERE id=${ms[0].card_sale_id}`; }
    await audit(s, "desfazer par da conciliação", "recon_matches", ms[0].id, { status: "CONFIRMADO", titulos: recs }, { status: "DESFEITO", motivo });
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(voltar, "ok", "Par desfeito — o crédito voltou para a fila."));
}

/** Crédito que não é recebimento de família (transferência, rendimento, estorno…): sai da fila com a classe registrada. */
export async function classificar(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), BASE);
  try {
    const s = await operador(); const lineId = int(fd, "lineId") ?? 0; const l = await travaDaLinha(lineId); const classe = str(fd, "classe"); assert(!!CLASSES_IGNORA[classe], "Escolha a classe.");
    const obs = str(fd, "obs"); assert(classe !== "OUTRO" || obs.length >= 5, "Explique a classificação.");
    assert(l.status !== "CONCILIADO", "Crédito conciliado — desfaça o par antes de classificar.");
    await sql`UPDATE recon_matches SET status='DESFEITO', desfeito_em=now(), motivo_desfazer='Crédito classificado' WHERE bank_line_id=${lineId} AND status='SUGERIDO'`;
    await sql`UPDATE bank_lines SET status='IGNORADO', classe=${classe}, observacao=${obs || null}, classificado_por=${s.id} WHERE id=${lineId}`;
    await resolverDaLinha(s, lineId, "NAO_PROCEDE", `Classificado: ${CLASSES_IGNORA[classe]}${obs ? ` — ${obs}` : ""}`);
    await audit(s, "classificar lançamento do extrato", "bank_lines", lineId, { status: l.status }, { status: "IGNORADO", classe, obs });
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(voltar, "ok", "Lançamento classificado e retirado da fila."));
}

/** Triagem (secretaria): diz de qual família é o crédito; a conciliação refaz o casamento com os títulos dessa família. */
export async function identificar(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), `${BASE}?aba=triagem`); let res = "";
  try {
    const s = await triagem(); const lineId = int(fd, "lineId") ?? 0; const l = await travaDaLinha(lineId); assert(l.status !== "CONCILIADO" && l.status !== "IGNORADO", "Este crédito já foi tratado.");
    let sid = int(fd, "studentId"); const texto = str(fd, "aluno");
    if (!sid && texto) { const m = texto.match(/#(\d+)\)?\s*$/); if (m) sid = Number(m[1]); else { const xs = await sql<{ id: number }[]>`SELECT id FROM students WHERE lower(nome)=lower(${texto})`; assert(xs.length === 1, xs.length ? "Há mais de um aluno com esse nome: escolha na lista." : "Aluno não encontrado: escolha um nome da lista."); sid = xs[0].id; } }
    assert(!!sid, "Escolha o aluno (família) do pagamento."); const [st] = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM students WHERE id=${sid}`; assert(!!st, "Aluno não encontrado.");
    await sql`UPDATE bank_lines SET student_id=${sid}, status='PENDENTE' WHERE id=${lineId}`;
    await sql`UPDATE recon_issues SET status='RESOLVIDA', desfecho='IDENTIFICADO', desfecho_obs=${`Pagador identificado: família de ${st.nome}`}, resolvido_em=now(), resolvido_por=${s.id}, updated_at=now() WHERE status='ABERTA' AND bank_line_id=${lineId} AND tipo='NAO_IDENTIFICADO'`;
    await audit(s, "identificar pagador do crédito", "bank_lines", lineId, { status: l.status }, { studentId: sid });
    const p = await processarConciliacao(l.data, l.data, s); const [depois] = await sql<{ status: string }[]>`SELECT status FROM bank_lines WHERE id=${lineId}`;
    res = depois?.status === "CONCILIADO" ? "Pagador identificado e crédito conciliado com o título." : depois?.status === "SUGERIDO" ? "Pagador identificado: o par sugerido aguarda a confirmação do Financeiro." : depois?.status === "SEM_BAIXA" ? "Pagador identificado: o título dessa família está em aberto no ActiveSoft — registre a baixa lá." : "Pagador identificado; não há título com esse valor — ficou como pendência para o Financeiro.";
    void p;
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(voltar, "ok", res));
}

// ---------------------------------------------------------------- fechamento da competência (T-033 · KPI-09 · CRQ-FIN-V3-04)
export async function fecharCompetencia(fd: FormData) {
  const comp = str(fd, "competencia"); const companyId = int(fd, "companyId"); const voltar = caminhoSeguro(str(fd, "voltar"), "/financeiro/recebimentos");
  try {
    const s = await operador(); assert(/^\d{4}-\d{2}$/.test(comp), "Competência inválida."); assert(`${comp}-01` <= hoje(), "Competência futura não fecha.");
    const [ja] = await sql`SELECT 1 FROM recon_closings WHERE competencia=${comp} AND company_id IS NOT DISTINCT FROM ${companyId} AND status='FECHADA'`; assert(!ja, "Esta competência já está fechada.");
    const g = await gateFechamento(comp, companyId);
    if (!g.ok) { await audit(s, "fechamento de competência bloqueado", "recon_closings", null, null, { competencia: comp, companyId, pct: g.pctGate, meta: g.meta, pendencias: g.pendencias.length });
      throw new Error(`Fechamento bloqueado: conciliado ${g.pctGate === null ? "sem recebimentos" : `${g.pctGate.toFixed(1).replace(".", ",")}%`} abaixo da meta de ${g.meta}%. ${g.pendencias.length} pendência(s) com dono e prazo na lista abaixo.`); }
    const [f] = await sql<{ id: number }[]>`INSERT INTO recon_closings (competencia, company_id, recebido, conciliado, explicado, pct, status, obs, fechado_por) VALUES (${comp}, ${companyId}, ${g.recebido}, ${g.conciliado}, ${g.explicado}, ${g.pctGate}, 'FECHADA', ${strOrNull(fd, "obs")}, ${s.id}) RETURNING id`;
    await audit(s, "fechar competência do financeiro", "recon_closings", f.id, null, { competencia: comp, companyId, pct: g.pctGate });
    await notificar(await usuariosPorPerfil(["DIRECAO"]), `Competência ${comp.split("-").reverse().join("/")} fechada no Financeiro`, `Conciliado ${g.pctGate?.toFixed(1).replace(".", ",")}% do recebido. Lançamentos e importações dessa competência ficam travados.`, `/financeiro/recebimentos?ctx_p=${comp}`, "INFO", `fech:${comp}:${companyId ?? 0}`);
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(voltar, "ok", `Competência ${comp.split("-").reverse().join("/")} fechada.`));
}
export async function reabrirCompetencia(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), "/financeiro/recebimentos");
  try {
    const s = await requireSession(); if (s.role !== "DIRECAO") { await audit(s, "acesso negado: reabrir competência", "recon_closings", int(fd, "id"), null, { papel: s.role }); throw new Error("Só a Direção reabre uma competência fechada."); }
    const id = int(fd, "id") ?? 0; const motivo = str(fd, "motivo"); assert(motivo.length >= 10, "Explique o motivo da reabertura (fica na auditoria).");
    const [f] = await sql<{ competencia: string }[]>`UPDATE recon_closings SET status='REABERTA', reaberto_por=${s.id}, reaberto_em=now(), motivo_reabertura=${motivo} WHERE id=${id} AND status='FECHADA' RETURNING competencia`; assert(!!f, "Fechamento não encontrado.");
    await audit(s, "reabrir competência do financeiro", "recon_closings", id, { status: "FECHADA" }, { status: "REABERTA", motivo });
    await notificar(await usuariosPorPerfil(["FINANCEIRO"]), `Competência ${f.competencia.split("-").reverse().join("/")} reaberta pela Direção`, motivo.slice(0, 160), `/financeiro/recebimentos?ctx_p=${f.competencia}`, "ACAO", `reab:${id}`);
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(voltar, "ok", "Competência reaberta."));
}
