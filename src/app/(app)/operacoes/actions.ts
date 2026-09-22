"use server";
import { textoImportacao } from "@/lib/importacao";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireSession, can, assert, assertScope, scopeUnit } from "@/lib/auth";
import { audit, str, strOrNull, int, num, hoje, getSettings, detectarSeparador, normalizarCabecalho } from "@/lib/utils";
import { slaOs, OS_STATUS } from "@/lib/operacoes";

const go = (b: string, k: "ok" | "erro", msg: string, hash = "") => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}${hash}`;
async function evento(id: number, s: { nome: string }, tipo: string, texto: string | null) { await db.insert(schema.workOrderEvents).values({ workOrderId: id, userNome: s.nome, tipo, texto }); }

// ---------- Chamados / ordens de serviço ----------
export async function abrirChamado(fd: FormData) {
  const s = await requireSession(); const voltar = str(fd, "voltar") || "/operacoes/chamados"; let id = 0;
  try { const titulo = str(fd, "titulo"); const unitId = int(fd, "unitId") ?? scopeUnit(s) ?? s.unitId; if (!titulo || !unitId) throw new Error("Informe o título e a unidade."); if (s.unitId && s.unitId !== unitId && !can.editar(s) && s.role !== "OPERACOES") throw new Error("Você só abre chamados na sua unidade.");
    const prioridade = str(fd, "prioridade") || "NORMAL"; const tipo = str(fd, "tipo") || "CORRETIVA";
    const [r] = await db.insert(schema.workOrders).values({ tipo, titulo, descricao: strOrNull(fd, "descricao"), unitId, ambiente: strOrNull(fd, "ambiente"), assetId: int(fd, "assetId"), prioridade, solicitanteUserId: s.id, responsavelUserId: int(fd, "responsavelUserId"), slaAte: await slaOs(prioridade), custoPrevisto: num(fd, "custoPrevisto") === null ? null : String(num(fd, "custoPrevisto")), inspectionId: int(fd, "inspectionId") }).returning({ id: schema.workOrders.id });
    id = r.id; await evento(id, s, "STATUS", `Chamado aberto (${prioridade.toLowerCase()})`); await audit(s, "abrir chamado", "work_orders", id, null, { titulo, tipo, prioridade, unitId });
    if (int(fd, "assetId")) await db.update(schema.assets).set({ status: "MANUTENCAO" }).where(eq(schema.assets.id, int(fd, "assetId")!));
  } catch (e) { redirect(go(voltar, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`/operacoes/chamados/${id}`, "ok", "Chamado aberto."));
}
export async function atualizarChamado(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const b = `/operacoes/chamados/${id}`; let msg = "Chamado atualizado.";
  try { const [w] = await db.select().from(schema.workOrders).where(eq(schema.workOrders.id, id)); if (!w) throw new Error("Chamado não encontrado.");
    const gestor = can.operacoes(s); const dono = w.solicitanteUserId === s.id;
    const novo = strOrNull(fd, "status"); const upd: Partial<typeof schema.workOrders.$inferInsert> = { updatedAt: new Date() };
    if (novo && novo !== w.status) { if (!OS_STATUS[novo]) throw new Error("Situação inválida."); if (!gestor && !(dono && novo === "CANCELADO")) throw new Error("Seu perfil não muda a situação do chamado."); if (gestor) assertScope(s, w.unitId);
      upd.status = novo; if (novo === "EM_EXECUCAO" && !w.iniciadoEm) upd.iniciadoEm = new Date();
      if (novo === "CONCLUIDO") { upd.concluidoEm = new Date(); const cr = num(fd, "custoReal"); if (cr !== null) upd.custoReal = String(cr); upd.evidencia = strOrNull(fd, "evidencia") ?? w.evidencia; if (w.assetId) { await db.update(schema.assets).set({ status: "EM_USO", ...(w.tipo === "PREVENTIVA" ? { ultimaPreventiva: hoje() } : {}) }).where(eq(schema.assets.id, w.assetId)); } msg = "Chamado concluído."; }
      await evento(id, s, "STATUS", `${OS_STATUS[w.status]} → ${OS_STATUS[novo]}${strOrNull(fd, "nota") ? `: ${str(fd, "nota")}` : ""}`); }
    else if (strOrNull(fd, "nota")) await evento(id, s, "COMENTARIO", str(fd, "nota"));
    if (gestor) { const resp = int(fd, "responsavelUserId"); if (resp !== null && resp !== w.responsavelUserId) { upd.responsavelUserId = resp; const [u] = await db.select({ nome: schema.users.nome }).from(schema.users).where(eq(schema.users.id, resp)); await evento(id, s, "ATRIBUICAO", `Responsável: ${u?.nome ?? resp}`); }
      const sup = int(fd, "supplierId"); if (sup !== null) upd.supplierId = sup || null; const prio = strOrNull(fd, "prioridade"); if (prio && prio !== w.prioridade) { upd.prioridade = prio; upd.slaAte = await slaOs(prio, w.createdAt); await evento(id, s, "STATUS", `Prioridade: ${prio.toLowerCase()}`); }
      const cp = num(fd, "custoPrevisto"); if (cp !== null) upd.custoPrevisto = String(cp); const cr2 = num(fd, "custoReal"); if (cr2 !== null && !upd.custoReal) upd.custoReal = String(cr2); }
    const av = int(fd, "avaliacao"); if (av && av >= 1 && av <= 5 && (dono || gestor)) { upd.avaliacao = av; await evento(id, s, "AVALIACAO", `Avaliação do solicitante: ${av}/5`); }
    await db.update(schema.workOrders).set(upd).where(eq(schema.workOrders.id, id)); await audit(s, "atualizar chamado", "work_orders", id, { status: w.status }, { status: upd.status ?? w.status });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}

// ---------- Ativos ----------
export async function salvarAtivo(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id"); const b = "/operacoes/ativos";
  try { assert(can.operacoes(s), "Seu perfil não cadastra ativos."); const nome = str(fd, "nome"); const unitId = int(fd, "unitId"); if (!nome || !unitId) throw new Error("Informe nome e unidade."); assertScope(s, unitId);
    const d = { codigo: strOrNull(fd, "codigo"), nome, categoria: str(fd, "categoria") || "Outro", unitId, ambiente: strOrNull(fd, "ambiente"), aquisicao: strOrNull(fd, "aquisicao"), valor: num(fd, "valor") === null ? null : String(num(fd, "valor")), fornecedor: strOrNull(fd, "fornecedor"), garantiaAte: strOrNull(fd, "garantiaAte"), status: str(fd, "status") || "EM_USO", preventivaDias: int(fd, "preventivaDias"), ultimaPreventiva: strOrNull(fd, "ultimaPreventiva"), obs: strOrNull(fd, "obs") };
    if (id) await db.update(schema.assets).set(d).where(eq(schema.assets.id, id)); else await db.insert(schema.assets).values(d);
    await audit(s, id ? "editar ativo" : "criar ativo", "assets", id, null, { nome, unitId, categoria: d.categoria });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Ativo salvo."));
}
export async function importarAtivos(fd: FormData) {
  const s = await requireSession(); let resumo = "";
  try { assert(can.operacoes(s)); const texto = await textoImportacao(fd); if (!texto) throw new Error("Cole o CSV."); const linhas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean); const sep = detectarSeparador(linhas[0]); const head = linhas[0].split(sep).map(normalizarCabecalho); const idx = (k: string) => head.indexOf(k); if (idx("nome") < 0) throw new Error("Cabeçalho precisa ter nome.");
    const units = await db.select().from(schema.units); const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim(); const unidadePadrao = int(fd, "unitId"); let ok = 0; const erros: string[] = [];
    for (const [i, l] of linhas.slice(1).entries()) { const c = l.split(sep).map(x => x.trim()); const g = (k: string) => (idx(k) >= 0 ? c[idx(k)] ?? "" : ""); try { if (!g("nome")) throw new Error("nome vazio"); const un = g("unidade") ? units.find(u => norm(u.nome) === norm(g("unidade")) || norm(u.codigo) === norm(g("unidade"))) : undefined; const unitId = un?.id ?? unidadePadrao; if (!unitId) throw new Error("unidade não identificada");
      await db.insert(schema.assets).values({ codigo: g("patrimonio") || g("codigo") || null, nome: g("nome"), categoria: g("categoria") || "Outro", unitId, ambiente: g("ambiente") || null, aquisicao: g("aquisicao") ? (g("aquisicao").includes("/") ? g("aquisicao").split("/").reverse().join("-") : g("aquisicao")) : null, valor: g("valor") ? String(Number(g("valor").replace(/\./g, "").replace(",", "."))) : null, fornecedor: g("fornecedor") || null, preventivaDias: g("preventiva_dias") ? Number(g("preventiva_dias")) : null }); ok++; } catch (e) { erros.push(`Linha ${i + 2}: ${e instanceof Error ? e.message : e}`); } }
    await audit(s, "importar ativos", "assets", null, null, { ok, erros: erros.length }); resumo = `${ok} ativo(s) importado(s).` + (erros.length ? ` ${erros.length} com erro: ${erros.slice(0, 4).join(" · ")}` : "");
  } catch (e) { redirect(go("/operacoes/ativos", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go("/operacoes/ativos", "ok", resumo));
}

// ---------- Vistorias ----------
export async function registrarVistoria(fd: FormData) {
  const s = await requireSession(); let msg = ""; let abertos = 0;
  try { assert(can.operacoes(s), "Seu perfil não registra vistorias."); const cfg = await getSettings(); const unitId = int(fd, "unitId"); const tipo = str(fd, "tipo"); const ambiente = str(fd, "ambiente"); const data = str(fd, "data") || hoje(); if (!unitId || !tipo || !ambiente) throw new Error("Informe unidade, tipo de checklist e ambiente."); assertScope(s, unitId);
    const modelo = (cfg.operacoes.checklists as Record<string, string[]>)[tipo]; if (!modelo) throw new Error("Checklist não encontrado.");
    const itens = modelo.map((item, i) => ({ item, ok: str(fd, `ok_${i}`) === "1", obs: strOrNull(fd, `obs_${i}`) })); const conformes = itens.filter(x => x.ok).length;
    const [v] = await db.insert(schema.inspections).values({ unitId, ambiente, tipo, data, inspetorUserId: s.id, itens, conformes, total: itens.length, obs: strOrNull(fd, "obs") }).returning({ id: schema.inspections.id });
    if (str(fd, "abrirChamados") === "1") for (const it of itens.filter(x => !x.ok)) { const [w] = await db.insert(schema.workOrders).values({ tipo: "CORRETIVA", titulo: `${ambiente}: ${it.item}`, descricao: it.obs ?? `Não conforme na vistoria de ${data}`, unitId, ambiente, prioridade: /extintor|fuga|elétric|gás|queda|cadeado|portão/i.test(it.item) ? "ALTA" : "NORMAL", solicitanteUserId: s.id, slaAte: await slaOs(/extintor|fuga|elétric|gás|queda|cadeado|portão/i.test(it.item) ? "ALTA" : "NORMAL"), inspectionId: v.id }).returning({ id: schema.workOrders.id }); await evento(w.id, s, "STATUS", `Aberto pela vistoria #${v.id}`); abertos++; }
    await audit(s, "vistoria", "inspections", v.id, null, { unitId, tipo, ambiente, conformes, total: itens.length, chamados: abertos });
    msg = `Vistoria registrada: ${conformes}/${itens.length} conformes.` + (abertos ? ` ${abertos} chamado(s) aberto(s) para os itens não conformes.` : "");
  } catch (e) { redirect(go("/operacoes/vistorias", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go("/operacoes/vistorias", "ok", msg));
}

// ---------- Fornecedores ----------
export async function salvarFornecedor(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id"); const b = "/operacoes/fornecedores";
  try { assert(can.operacoes(s)); const nome = str(fd, "nome"); if (!nome) throw new Error("Informe o nome."); const d = { nome, servico: strOrNull(fd, "servico"), telefone: strOrNull(fd, "telefone"), email: strOrNull(fd, "email"), contrato: strOrNull(fd, "contrato"), ativo: str(fd, "ativo") !== "0", obs: strOrNull(fd, "obs") };
    if (id) await db.update(schema.suppliers).set(d).where(eq(schema.suppliers.id, id)); else await db.insert(schema.suppliers).values(d); await audit(s, id ? "editar fornecedor" : "criar fornecedor", "suppliers", id, null, { nome });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Fornecedor salvo."));
}
export async function abrirPreventiva(fd: FormData) {
  const s = await requireSession(); const assetId = Number(fd.get("assetId")); let id = 0;
  try { assert(can.operacoes(s)); const [a] = await db.select().from(schema.assets).where(eq(schema.assets.id, assetId)); if (!a) throw new Error("Ativo não encontrado."); assertScope(s, a.unitId);
    const [w] = await db.insert(schema.workOrders).values({ tipo: "PREVENTIVA", titulo: `Preventiva: ${a.nome}`, descricao: a.obs, unitId: a.unitId, ambiente: a.ambiente, assetId, prioridade: "NORMAL", solicitanteUserId: s.id, slaAte: await slaOs("NORMAL") }).returning({ id: schema.workOrders.id }); id = w.id; await evento(id, s, "STATUS", "Preventiva programada"); await audit(s, "abrir preventiva", "work_orders", id, null, { assetId });
  } catch (e) { redirect(go("/operacoes", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`/operacoes/chamados/${id}`, "ok", "Preventiva aberta."));
}
void sql;
