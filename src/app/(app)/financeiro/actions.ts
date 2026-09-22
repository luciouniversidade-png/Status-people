"use server";
import { textoImportacao } from "@/lib/importacao";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { createHash } from "crypto";
import { db, schema, sql } from "@/db";
import { requireSession, can, assert, assertScope } from "@/lib/auth";
import { audit, str, strOrNull, int, num, hoje, addMonths, getSettings, detectarSeparador, normalizarCabecalho } from "@/lib/utils";
import { normNome, parseValor, parseData } from "@/lib/financeiro";

const go = (b: string, k: "ok" | "erro", msg: string, hash = "") => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}${hash}`;
const COBRA = ["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE", "RH"];
function csv(texto: string) { const linhas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean); if (linhas.length < 2) throw new Error("Cole o CSV com cabeçalho e ao menos uma linha."); const sep = detectarSeparador(linhas[0]); const head = linhas[0].split(sep).map(normalizarCabecalho); return { linhas: linhas.slice(1), get: (l: string) => { const c = l.split(sep).map(x => x.trim()); return (k: string) => { const i = head.indexOf(k); return i >= 0 ? c[i] ?? "" : ""; }; }, head }; }
async function unidadePor(nome: string, units: { id: number; nome: string; codigo: string }[]) { return units.find(u => normNome(u.nome) === normNome(nome) || normNome(u.codigo) === normNome(nome)); }

// ---------- Importação de títulos (em aberto e recebidos) ----------
export async function importarTitulos(fd: FormData) {
  const s = await requireSession(); let resumo = "";
  try { const cfg = await getSettings(); assert(can.aprovar(s, cfg.alcadas.financeiro), "Importar títulos exige: " + cfg.alcadas.financeiro.join(", "));
    const { linhas, get, head } = csv(await textoImportacao(fd)); if (!head.includes("aluno") || !head.includes("vencimento") || !head.includes("valor")) throw new Error("Cabeçalho precisa ter aluno, vencimento e valor (opcionais: titulo, unidade, tipo, competencia, responsavel, telefone, pago_em, valor_pago, status).");
    const units = await db.select().from(schema.units); const alunos = await sql<{ id: number; nome: string; unit_atual_id: number | null }[]>`SELECT id, nome, unit_atual_id FROM students`; const unidadePadrao = int(fd, "unitId");
    let novos = 0, atualizados = 0; const erros: string[] = [];
    for (const [i, l] of linhas.entries()) { const g = get(l); try {
      const aluno = g("aluno"); const venc = parseData(g("vencimento")); const valor = parseValor(g("valor")); if (!aluno || !venc || !Number.isFinite(valor)) throw new Error("aluno, vencimento ou valor inválido");
      const st = alunos.find(a => normNome(a.nome) === normNome(aluno)); const un = g("unidade") ? await unidadePor(g("unidade"), units) : undefined; const unitId = un?.id ?? st?.unit_atual_id ?? unidadePadrao; if (!unitId) throw new Error("unidade não identificada");
      const pagoEm = g("pago_em") ? parseData(g("pago_em")) : null; const valorPago = g("valor_pago") ? parseValor(g("valor_pago")) : (pagoEm ? valor : null);
      const status = /^(pago|liquidado|baixado)$/i.test(g("status")) || pagoEm ? "PAGO" : /^cancel/i.test(g("status")) ? "CANCELADO" : "ABERTO";
      const tipo = /integral/i.test(g("tipo")) ? "INTEGRAL" : /material/i.test(g("tipo")) ? "MATERIAL" : /taxa/i.test(g("tipo")) ? "TAXA" : g("tipo") && !/mensal/i.test(g("tipo")) ? "OUTRO" : "MENSALIDADE";
      const comp = g("competencia") ? (g("competencia").match(/^(\d{2})\/(\d{4})$/) ? `${g("competencia").slice(3)}-${g("competencia").slice(0, 2)}` : g("competencia").slice(0, 7)) : venc.slice(0, 7);
      const ext = g("titulo") || null;
      if (ext) { const r = await sql`INSERT INTO receivables (external_id, student_id, aluno_nome, responsavel, telefone, unit_id, tipo, competencia, vencimento, valor, valor_pago, pago_em, status) VALUES (${ext}, ${st?.id ?? null}, ${aluno}, ${g("responsavel") || null}, ${g("telefone") || null}, ${unitId}, ${tipo}, ${comp}, ${venc}, ${valor}, ${valorPago}, ${pagoEm}, ${status}) ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE SET valor_pago=EXCLUDED.valor_pago, pago_em=EXCLUDED.pago_em, status=CASE WHEN receivables.status='NEGOCIADO' AND EXCLUDED.status='ABERTO' THEN 'NEGOCIADO' ELSE EXCLUDED.status END, updated_at=now() RETURNING (xmax = 0) AS inserted`; if ((r[0] as { inserted: boolean }).inserted) novos++; else atualizados++; }
      else { const [dup] = await sql<{ id: number }[]>`SELECT id FROM receivables WHERE external_id IS NULL AND lower(aluno_nome)=lower(${aluno}) AND vencimento=${venc} AND valor=${valor} AND tipo=${tipo}`; if (dup) { await sql`UPDATE receivables SET valor_pago=${valorPago}, pago_em=${pagoEm}, status=CASE WHEN status='NEGOCIADO' AND ${status}='ABERTO' THEN 'NEGOCIADO' ELSE ${status} END, updated_at=now() WHERE id=${dup.id}`; atualizados++; } else { await sql`INSERT INTO receivables (student_id, aluno_nome, responsavel, telefone, unit_id, tipo, competencia, vencimento, valor, valor_pago, pago_em, status) VALUES (${st?.id ?? null}, ${aluno}, ${g("responsavel") || null}, ${g("telefone") || null}, ${unitId}, ${tipo}, ${comp}, ${venc}, ${valor}, ${valorPago}, ${pagoEm}, ${status})`; novos++; } }
    } catch (e) { erros.push(`Linha ${i + 2}: ${e instanceof Error ? e.message : e}`); } }
    await audit(s, "importar títulos", "receivables", null, null, { novos, atualizados, erros: erros.length });
    resumo = `${novos} título(s) novo(s), ${atualizados} atualizado(s).` + (erros.length ? ` ${erros.length} com erro: ${erros.slice(0, 4).join(" · ")}` : "");
  } catch (e) { redirect(go("/financeiro/importar", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go("/financeiro/inadimplencia", "ok", resumo));
}

// ---------- Cobrança ----------
export async function registrarCobranca(fd: FormData) {
  const s = await requireSession(); const b = str(fd, "voltar") || "/financeiro/inadimplencia";
  try { assert(COBRA.includes(s.role), "Seu perfil não registra cobrança."); const receivableId = int(fd, "receivableId"); const etapa = str(fd, "etapa"); if (!etapa) throw new Error("Informe a etapa.");
    let alunoNome = str(fd, "alunoNome"); let unitId = int(fd, "unitId");
    if (receivableId) { const [r] = await db.select().from(schema.receivables).where(eq(schema.receivables.id, receivableId)); if (!r) throw new Error("Título não encontrado."); alunoNome = r.alunoNome; unitId = r.unitId; }
    if (!unitId || !alunoNome) throw new Error("Aluno e unidade obrigatórios."); assertScope(s, unitId);
    await db.insert(schema.collectionActions).values({ receivableId, alunoNome, unitId, etapa, canal: strOrNull(fd, "canal"), texto: strOrNull(fd, "texto"), resultado: strOrNull(fd, "resultado"), userId: s.id, userNome: s.nome });
    if (str(fd, "resultado") === "PAGO" && receivableId) await db.update(schema.receivables).set({ status: "PAGO", pagoEm: hoje(), updatedAt: new Date() }).where(eq(schema.receivables.id, receivableId));
    await audit(s, "cobrança", "collection_actions", receivableId, null, { etapa, resultado: strOrNull(fd, "resultado") });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Contato de cobrança registrado."));
}
export async function criarAcordo(fd: FormData) {
  const s = await requireSession(); const b = "/financeiro/inadimplencia"; let id = 0;
  try { assert(COBRA.includes(s.role)); const ids = fd.getAll("receivableId").map(Number).filter(Boolean); if (!ids.length) throw new Error("Selecione os títulos do acordo.");
    const titulos = await sql<{ id: number; aluno_nome: string; student_id: number | null; unit_id: number; valor: number; status: string }[]>`SELECT id, aluno_nome, student_id, unit_id, valor::float, status FROM receivables WHERE id = ANY(${ids})`;
    if (titulos.some(t => t.status !== "ABERTO")) throw new Error("Só títulos em aberto entram no acordo."); const un = new Set(titulos.map(t => t.unit_id)); if (un.size !== 1) throw new Error("Títulos de uma única unidade por acordo."); assertScope(s, titulos[0].unit_id);
    const valorOriginal = titulos.reduce((a, t) => a + t.valor, 0); const valorAcordado = num(fd, "valorAcordado") ?? valorOriginal; const parcelas = int(fd, "parcelas") ?? 1; const primeira = str(fd, "primeiraParcela") || hoje();
    if (valorAcordado < 0 || parcelas < 1) throw new Error("Valores inválidos."); const cfg = await getSettings(); const descontoPct = valorOriginal ? Math.round(100 * (1 - valorAcordado / valorOriginal)) : 0;
    const limite = (cfg.financeiro.alcadaDescontoPct as Record<string, number>)[s.role] ?? 0; if (descontoPct > limite) throw new Error(`Desconto de ${descontoPct}% no acordo excede sua alçada (${limite}%).`);
    const [a] = await db.insert(schema.agreements).values({ alunoNome: titulos[0].aluno_nome, studentId: titulos[0].student_id, unitId: titulos[0].unit_id, valorOriginal: String(valorOriginal), valorAcordado: String(valorAcordado), parcelas, primeiraParcela: primeira, obs: strOrNull(fd, "obs"), createdBy: s.id }).returning({ id: schema.agreements.id }); id = a.id;
    const vp = Math.floor(valorAcordado / parcelas * 100) / 100; for (let n = 1; n <= parcelas; n++) await db.insert(schema.agreementInstallments).values({ agreementId: id, numero: n, vencimento: addMonths(primeira, n - 1), valor: String(n === parcelas ? Math.round((valorAcordado - vp * (parcelas - 1)) * 100) / 100 : vp) });
    await sql`UPDATE receivables SET status='NEGOCIADO', agreement_id=${id}, updated_at=now() WHERE id = ANY(${ids})`;
    await db.insert(schema.collectionActions).values({ receivableId: ids[0], alunoNome: titulos[0].aluno_nome, unitId: titulos[0].unit_id, etapa: "NEGOCIACAO", resultado: "ACORDO", texto: `Acordo #${id}: ${parcelas}x`, userId: s.id, userNome: s.nome });
    await audit(s, "acordo", "agreements", id, null, { titulos: ids, valorOriginal, valorAcordado, parcelas, descontoPct });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", `Acordo #${id} criado; títulos marcados como negociados.`, "#acordos"));
}
export async function baixarParcela(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const b = "/financeiro/inadimplencia#acordos";
  try { assert(COBRA.includes(s.role)); const [p] = await db.select().from(schema.agreementInstallments).where(eq(schema.agreementInstallments.id, id)); if (!p) throw new Error("Parcela não encontrada.");
    await db.update(schema.agreementInstallments).set({ pagoEm: str(fd, "pagoEm") || hoje() }).where(eq(schema.agreementInstallments.id, id));
    const [{ pend }] = await sql<{ pend: number }[]>`SELECT count(*)::int AS pend FROM agreement_installments WHERE agreement_id=${p.agreementId} AND pago_em IS NULL`;
    if (pend === 0) { await db.update(schema.agreements).set({ status: "CUMPRIDO" }).where(eq(schema.agreements.id, p.agreementId)); await sql`UPDATE receivables SET status='PAGO', pago_em=${hoje()}, updated_at=now() WHERE agreement_id=${p.agreementId}`; }
    await audit(s, "baixar parcela", "agreement_installments", id, null, { agreementId: p.agreementId, cumprido: pend === 0 });
  } catch (e) { redirect(go("/financeiro/inadimplencia", "erro", e instanceof Error ? e.message : "Erro", "#acordos")); }
  redirect(go("/financeiro/inadimplencia", "ok", "Parcela baixada.", "#acordos"));
}
export async function quebrarAcordo(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id"));
  try { assert(COBRA.includes(s.role)); await db.update(schema.agreements).set({ status: "QUEBRADO" }).where(eq(schema.agreements.id, id)); await sql`UPDATE receivables SET status='ABERTO', updated_at=now() WHERE agreement_id=${id} AND status='NEGOCIADO'`; await audit(s, "quebrar acordo", "agreements", id, null, null); }
  catch (e) { redirect(go("/financeiro/inadimplencia", "erro", e instanceof Error ? e.message : "Erro", "#acordos")); }
  redirect(go("/financeiro/inadimplencia", "ok", "Acordo marcado como quebrado; títulos voltaram a aberto.", "#acordos"));
}

// ---------- Descontos ----------
export async function solicitarDesconto(fd: FormData) {
  const s = await requireSession(); const b = "/financeiro/descontos"; let msg = "";
  try { assert(["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE", "COMERCIAL", "RH"].includes(s.role)); const cfg = await getSettings();
    const pct = num(fd, "percentual"); const tipo = str(fd, "tipo"); if (pct === null || pct <= 0 || pct > 100 || !tipo) throw new Error("Informe tipo e percentual (0–100).");
    const studentId = int(fd, "studentId"); let alunoNome = str(fd, "alunoNome"); let unitId = int(fd, "unitId");
    if (studentId) { const [st] = await sql<{ nome: string; unit_atual_id: number | null }[]>`SELECT nome, unit_atual_id FROM students WHERE id=${studentId}`; if (!st) throw new Error("Aluno não encontrado."); alunoNome = st.nome; unitId = unitId ?? st.unit_atual_id; }
    if (!alunoNome || !unitId) throw new Error("Aluno e unidade obrigatórios."); assertScope(s, unitId);
    const limite = (cfg.financeiro.alcadaDescontoPct as Record<string, number>)[s.role] ?? 0; const auto = pct <= limite;
    const [d] = await db.insert(schema.discounts).values({ studentId, alunoNome, unitId, ano: int(fd, "ano") ?? cfg.matriculas.anoLetivo, tipo, percentual: String(pct), motivo: strOrNull(fd, "motivo"), validadeAte: strOrNull(fd, "validadeAte"), status: auto ? "APROVADO" : "SOLICITADO", solicitanteUserId: s.id, aprovadorUserId: auto ? s.id : null, decididoEm: auto ? new Date() : null }).returning({ id: schema.discounts.id });
    await audit(s, auto ? "conceder desconto" : "solicitar desconto", "discounts", d.id, null, { alunoNome, tipo, pct, auto });
    msg = auto ? `Desconto de ${pct}% concedido (dentro da sua alçada de ${limite}%).` : `Desconto de ${pct}% enviado para aprovação (sua alçada: ${limite}%).`;
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}
export async function decidirDesconto(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const decisao = str(fd, "decisao"); const b = "/financeiro/descontos";
  try { const cfg = await getSettings(); const [d] = await db.select().from(schema.discounts).where(eq(schema.discounts.id, id)); if (!d || d.status !== "SOLICITADO") throw new Error("Desconto não está aguardando decisão.");
    const limite = (cfg.financeiro.alcadaDescontoPct as Record<string, number>)[s.role] ?? 0; if (Number(d.percentual) > limite) throw new Error(`Este desconto (${d.percentual}%) excede sua alçada (${limite}%).`); if (d.solicitanteUserId === s.id) throw new Error("Quem solicita não aprova o próprio desconto."); assertScope(s, d.unitId);
    if (decisao !== "APROVADO" && decisao !== "REJEITADO") throw new Error("Decisão inválida.");
    await db.update(schema.discounts).set({ status: decisao, aprovadorUserId: s.id, decididoEm: new Date(), motivoDecisao: strOrNull(fd, "nota") }).where(eq(schema.discounts.id, id)); await audit(s, decisao === "APROVADO" ? "aprovar desconto" : "rejeitar desconto", "discounts", id, { status: "SOLICITADO" }, { status: decisao });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", decisao === "APROVADO" ? "Desconto aprovado." : "Desconto rejeitado."));
}

// ---------- Preços, caixa, orçamento ----------
export async function salvarPreco(fd: FormData) {
  const s = await requireSession(); const b = "/financeiro/receita";
  try { const cfg = await getSettings(); assert(can.aprovar(s, cfg.alcadas.financeiro)); const ano = int(fd, "ano") ?? cfg.matriculas.anoLetivo; const unitId = int(fd, "unitId"); const valor = num(fd, "valorMensal"); if (!unitId || valor === null) throw new Error("Informe unidade e valor.");
    const gradeId = int(fd, "gradeId"); const modalidade = str(fd, "modalidade") || "REGULAR"; const parcelas = int(fd, "parcelas") ?? 12;
    if (str(fd, "todasSeries") === "1" && modalidade === "REGULAR") { const grades = await db.select().from(schema.grades); for (const g of grades) await sql`INSERT INTO tuition_prices (ano, unit_id, grade_id, modalidade, valor_mensal, parcelas) VALUES (${ano}, ${unitId}, ${g.id}, ${modalidade}, ${valor}, ${parcelas}) ON CONFLICT (ano, unit_id, grade_id, modalidade) DO UPDATE SET valor_mensal=EXCLUDED.valor_mensal, parcelas=EXCLUDED.parcelas`; }
    else await sql`INSERT INTO tuition_prices (ano, unit_id, grade_id, modalidade, valor_mensal, parcelas) VALUES (${ano}, ${unitId}, ${gradeId}, ${modalidade}, ${valor}, ${parcelas}) ON CONFLICT (ano, unit_id, grade_id, modalidade) DO UPDATE SET valor_mensal=EXCLUDED.valor_mensal, parcelas=EXCLUDED.parcelas`;
    await audit(s, "preço de mensalidade", "tuition_prices", null, null, { ano, unitId, gradeId, modalidade, valor });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Valor salvo."));
}
export async function importarCaixa(fd: FormData) {
  const s = await requireSession(); let resumo = "";
  try { const cfg = await getSettings(); assert(can.aprovar(s, cfg.alcadas.financeiro)); const { linhas, get, head } = csv(await textoImportacao(fd)); if (!head.includes("data") || !head.includes("valor")) throw new Error("Cabeçalho precisa ter data e valor (opcionais: tipo, categoria, forma, descricao, unidade, contraparte).");
    const units = await db.select().from(schema.units); const unidadePadrao = int(fd, "unitId"); let ok = 0, dup = 0; const erros: string[] = [];
    for (const [i, l] of linhas.entries()) { const g = get(l); try {
      const data = parseData(g("data")); let valor = parseValor(g("valor")); if (!data || !Number.isFinite(valor)) throw new Error("data ou valor inválido");
      const tipoTxt = g("tipo").toUpperCase(); const tipo = /TRANSF/.test(tipoTxt) ? "TRANSFERENCIA" : /SA[IÍ]D|D[EÉ]B|PAGAMENTO/.test(tipoTxt) || (!tipoTxt && valor < 0) ? "SAIDA" : "ENTRADA"; valor = Math.abs(valor);
      const un = g("unidade") ? await unidadePor(g("unidade"), units) : undefined; const unitId = un?.id ?? unidadePadrao; if (!unitId) throw new Error("unidade não identificada");
      const categoria = g("categoria") || (tipo === "ENTRADA" ? "Mensalidades" : tipo === "SAIDA" ? "Outras despesas" : "Transferência interna");
      const hash = createHash("sha1").update([unitId, data, tipo, valor.toFixed(2), g("descricao"), g("contraparte")].join("|")).digest("hex");
      const r = await sql`INSERT INTO cash_entries (unit_id, data, tipo, categoria, forma, descricao, valor, contraparte, hash) VALUES (${unitId}, ${data}, ${tipo}, ${categoria}, ${(g("forma") || "OUTRO").toUpperCase()}, ${g("descricao") || null}, ${valor}, ${g("contraparte") || null}, ${hash}) ON CONFLICT (hash) WHERE hash IS NOT NULL DO NOTHING RETURNING id`; if (r.length) ok++; else dup++;
    } catch (e) { erros.push(`Linha ${i + 2}: ${e instanceof Error ? e.message : e}`); } }
    await audit(s, "importar caixa", "cash_entries", null, null, { ok, dup, erros: erros.length }); resumo = `${ok} lançamento(s) importado(s), ${dup} repetido(s) ignorado(s).` + (erros.length ? ` ${erros.length} com erro: ${erros.slice(0, 4).join(" · ")}` : "");
  } catch (e) { redirect(go("/financeiro/caixa", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go("/financeiro/caixa", "ok", resumo));
}
export async function salvarSaldoInicial(fd: FormData) {
  const s = await requireSession(); const b = `/financeiro/caixa?mes=${str(fd, "mes")}`;
  try { const cfg = await getSettings(); assert(can.aprovar(s, cfg.alcadas.financeiro)); const unitId = int(fd, "unitId"); const mes = str(fd, "mes"); const v = num(fd, "saldoInicial"); if (!unitId || !mes || v === null) throw new Error("Informe unidade, mês e saldo.");
    await sql`INSERT INTO cash_balances (unit_id, mes, saldo_inicial) VALUES (${unitId}, ${mes}, ${v}) ON CONFLICT (unit_id, mes) DO UPDATE SET saldo_inicial=EXCLUDED.saldo_inicial`; await audit(s, "saldo inicial", "cash_balances", null, null, { unitId, mes, v });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Saldo inicial salvo."));
}
export async function lancarCaixa(fd: FormData) {
  const s = await requireSession(); const b = `/financeiro/caixa?mes=${str(fd, "data").slice(0, 7)}`;
  try { const cfg = await getSettings(); assert(can.aprovar(s, cfg.alcadas.financeiro)); const unitId = int(fd, "unitId"); const data = str(fd, "data"); const valor = num(fd, "valor"); const tipo = str(fd, "tipo"); const categoria = str(fd, "categoria"); if (!unitId || !data || valor === null || !tipo || !categoria) throw new Error("Preencha unidade, data, tipo, categoria e valor.");
    await db.insert(schema.cashEntries).values({ unitId, data, tipo, categoria, forma: strOrNull(fd, "forma"), descricao: strOrNull(fd, "descricao"), valor: String(Math.abs(valor)), contraparte: strOrNull(fd, "contraparte") }); await audit(s, "lançar caixa", "cash_entries", null, null, { unitId, data, tipo, categoria, valor });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Lançamento registrado."));
}
export async function salvarOrcamento(fd: FormData) {
  const s = await requireSession(); const ano = int(fd, "ano") ?? Number(hoje().slice(0, 4)); const b = `/financeiro/orcamento?ano=${ano}`;
  try { const cfg = await getSettings(); assert(can.aprovar(s, cfg.alcadas.financeiro)); const unitId = int(fd, "unitId"); if (!unitId) throw new Error("Escolha a unidade."); let n = 0;
    for (const [k, v] of fd.entries()) { const m = String(k).match(/^b_(ENTRADA|SAIDA)_(\d+)$/); if (!m) continue; const cat = String(fd.get(`c_${m[1]}_${m[2]}`) ?? ""); const val = num(fd, String(k)); if (!cat || val === null) continue; await sql`INSERT INTO budgets (ano, unit_id, tipo, categoria, valor_mensal) VALUES (${ano}, ${unitId}, ${m[1]}, ${cat}, ${val}) ON CONFLICT (ano, unit_id, tipo, categoria) DO UPDATE SET valor_mensal=EXCLUDED.valor_mensal`; n++; void v; }
    await audit(s, "orçamento", "budgets", null, null, { ano, unitId, linhas: n });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Orçamento salvo."));
}
