"use server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireSession, can, assert, assertScope, scopeUnit } from "@/lib/auth";
import { audit, str, strOrNull, int, hoje, getSettings } from "@/lib/utils";
import { slaAte, CASE_TIPOS, CASE_STATUS } from "@/lib/atendimento";

const go = (b: string, k: "ok" | "erro", msg: string) => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}`;
const podeAtender = (r: string) => ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR", "COMERCIAL"].includes(r);
type Item = { titulo: string; feito: boolean };

async function carregar(id: number) { const [c] = await db.select().from(schema.cases).where(eq(schema.cases.id, id)); if (!c) throw new Error("Caso não encontrado."); return c; }
async function evento(caseId: number, s: { id: number; nome: string }, tipo: string, texto: string | null) { await db.insert(schema.caseEvents).values({ caseId, userId: s.id, userNome: s.nome, tipo, texto }); }

export async function abrirCaso(fd: FormData) {
  const s = await requireSession(); const voltar = str(fd, "voltar"); let id = 0;
  try {
    assert(podeAtender(s.role), "Seu perfil não registra atendimentos.");
    const cfg = await getSettings();
    const tipo = str(fd, "tipo"); const assunto = str(fd, "assunto"); if (!CASE_TIPOS.includes(tipo as typeof CASE_TIPOS[number]) || !assunto) throw new Error("Informe o tipo e o assunto.");
    const studentId = int(fd, "studentId"); let unitId = int(fd, "unitId");
    if (studentId) { const [st] = await sql<{ unit_atual_id: number | null }[]>`SELECT unit_atual_id FROM students WHERE id=${studentId}`; if (!st) throw new Error("Aluno não encontrado."); unitId = unitId ?? st.unit_atual_id ?? scopeUnit(s) ?? null; }
    if (!unitId) throw new Error("Informe a unidade.");
    assertScope(s, unitId);
    const prioridade = str(fd, "prioridade") || (tipo === "SAIDA" ? "ALTA" : tipo === "RECLAMACAO" && int(fd, "gravidade") === 3 ? "URGENTE" : "NORMAL");
    const checklist: Item[] | null = tipo === "RECLAMACAO" ? cfg.atendimento.recovery.map(t => ({ titulo: t, feito: false })) : tipo === "SAIDA" ? cfg.atendimento.retencao.map(t => ({ titulo: t, feito: false })) : null;
    const [r] = await db.insert(schema.cases).values({ studentId, unitId, contatoNome: strOrNull(fd, "contatoNome"), contatoTelefone: strOrNull(fd, "contatoTelefone"), tipo, categoria: strOrNull(fd, "categoria"), gravidade: int(fd, "gravidade"), canal: str(fd, "canal") || "WHATSAPP", assunto, descricao: strOrNull(fd, "descricao"), prioridade, responsavelUserId: int(fd, "responsavelUserId") ?? s.id, abertoPor: s.id, slaAte: await slaAte(prioridade), checklist, resultado: tipo === "SAIDA" ? "EM_ANDAMENTO" : null }).returning({ id: schema.cases.id });
    id = r.id; await evento(id, s, "STATUS", `Caso aberto (${prioridade.toLowerCase()})`);
    await audit(s, "abrir caso", "cases", id, null, { tipo, assunto, studentId, unitId, prioridade });
  } catch (e) { redirect(go(voltar || "/atendimento/casos", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`/atendimento/casos/${id}`, "ok", "Caso registrado."));
}

export async function comentar(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const b = `/atendimento/casos/${id}`;
  try { assert(podeAtender(s.role)); const c = await carregar(id); assertScope(s, c.unitId); const texto = str(fd, "texto"); if (!texto) throw new Error("Escreva o registro.");
    await evento(id, s, str(fd, "tipoEvento") === "CONTATO" ? "CONTATO" : "COMENTARIO", texto); await db.update(schema.cases).set({ updatedAt: new Date() }).where(eq(schema.cases.id, id));
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(b);
}

export async function mudarStatus(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const novo = str(fd, "status"); const b = `/atendimento/casos/${id}`; let msg = "";
  try {
    assert(podeAtender(s.role)); const c = await carregar(id); assertScope(s, c.unitId);
    if (!CASE_STATUS[novo]) throw new Error("Situação inválida.");
    const upd: Partial<typeof schema.cases.$inferInsert> = { status: novo, updatedAt: new Date() };
    if (novo === "RESOLVIDO" || novo === "FECHADO") {
      if (c.tipo === "RECLAMACAO" && !(strOrNull(fd, "causaRaiz") ?? c.causaRaiz)) throw new Error("Reclamação só fecha com causa raiz e ação corretiva registradas.");
      if (c.tipo === "SAIDA") { const res = str(fd, "resultado") || c.resultado; if (res !== "RETIDO" && res !== "PERDIDO") throw new Error("Pedido de saída só fecha com o desfecho: retido ou perdido."); upd.resultado = res; if (res === "PERDIDO") { const m = strOrNull(fd, "motivoSaida") ?? c.motivoSaida; if (!m) throw new Error("Informe o motivo da saída."); upd.motivoSaida = m; } }
      if (!c.resolvidoEm) upd.resolvidoEm = new Date();
      if (novo === "FECHADO") upd.fechadoEm = new Date();
    }
    if (novo === "REABERTO") { upd.resolvidoEm = null; upd.fechadoEm = null; upd.slaAte = await slaAte(c.prioridade); upd.escaladoEm = null; }
    if (strOrNull(fd, "causaRaiz")) upd.causaRaiz = strOrNull(fd, "causaRaiz"); if (strOrNull(fd, "acaoCorretiva")) upd.acaoCorretiva = strOrNull(fd, "acaoCorretiva");
    const sat = int(fd, "satisfacao"); if (sat && sat >= 1 && sat <= 5) { upd.satisfacao = sat; await db.insert(schema.surveys).values({ tipo: "CSAT", nota: sat, studentId: c.studentId, unitId: c.unitId, caseId: id, canal: c.canal, data: hoje(), createdBy: s.id }); }
    await db.update(schema.cases).set(upd).where(eq(schema.cases.id, id));
    await evento(id, s, "STATUS", `${CASE_STATUS[c.status]} → ${CASE_STATUS[novo]}${upd.resultado ? ` · ${upd.resultado === "RETIDO" ? "família retida" : "família perdida"}` : ""}${strOrNull(fd, "nota") ? `: ${str(fd, "nota")}` : ""}`);
    await audit(s, "mudar status", "cases", id, { status: c.status }, { status: novo, resultado: upd.resultado ?? null, satisfacao: sat ?? null });
    msg = novo === "FECHADO" ? "Caso fechado." : novo === "RESOLVIDO" ? "Caso resolvido — aguarde o retorno da família para fechar." : "Situação atualizada.";
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}

export async function atribuir(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const b = `/atendimento/casos/${id}`;
  try { assert(podeAtender(s.role)); const c = await carregar(id); assertScope(s, c.unitId);
    const upd: Partial<typeof schema.cases.$inferInsert> = { updatedAt: new Date() };
    const resp = int(fd, "responsavelUserId"); if (resp !== null) { upd.responsavelUserId = resp; const [u] = await db.select({ nome: schema.users.nome }).from(schema.users).where(eq(schema.users.id, resp)); await evento(id, s, "ATRIBUICAO", `Responsável: ${u?.nome ?? resp}`); }
    const prio = str(fd, "prioridade"); if (prio && prio !== c.prioridade) { upd.prioridade = prio; upd.slaAte = await slaAte(prio, c.createdAt); upd.escaladoEm = null; await evento(id, s, "STATUS", `Prioridade: ${prio.toLowerCase()}`); }
    const cat = strOrNull(fd, "categoria"); if (cat) upd.categoria = cat; const g = int(fd, "gravidade"); if (g) upd.gravidade = g;
    await db.update(schema.cases).set(upd).where(eq(schema.cases.id, id)); await audit(s, "atribuir", "cases", id, null, upd);
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Caso atualizado."));
}

export async function marcarItem(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const idx = Number(fd.get("idx")); const b = `/atendimento/casos/${id}`;
  try { assert(podeAtender(s.role)); const c = await carregar(id); assertScope(s, c.unitId);
    const lista = (c.checklist as Item[] | null) ?? []; if (!lista[idx]) throw new Error("Item não encontrado.");
    lista[idx].feito = !lista[idx].feito; await db.update(schema.cases).set({ checklist: lista, updatedAt: new Date() }).where(eq(schema.cases.id, id));
    await evento(id, s, "CHECKLIST", `${lista[idx].feito ? "✓" : "↺"} ${lista[idx].titulo}`);
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(b);
}

// ---------- Pesquisas ----------
export async function registrarPesquisa(fd: FormData) {
  const s = await requireSession(); const b = str(fd, "voltar") || "/atendimento/pesquisas";
  try { assert(podeAtender(s.role)); const tipo = str(fd, "tipo"); const nota = int(fd, "nota"); const studentId = int(fd, "studentId"); let unitId = int(fd, "unitId");
    if (tipo !== "NPS" && tipo !== "CSAT") throw new Error("Tipo inválido."); if (nota === null || nota < 0 || nota > (tipo === "NPS" ? 10 : 5)) throw new Error(tipo === "NPS" ? "Nota de 0 a 10." : "Nota de 1 a 5.");
    if (studentId) { const [st] = await sql<{ unit_atual_id: number | null }[]>`SELECT unit_atual_id FROM students WHERE id=${studentId}`; unitId = unitId ?? st?.unit_atual_id ?? null; }
    if (!unitId) throw new Error("Informe a unidade."); assertScope(s, unitId);
    const [r] = await db.insert(schema.surveys).values({ tipo, nota, comentario: strOrNull(fd, "comentario"), studentId, unitId, canal: strOrNull(fd, "canal"), data: str(fd, "data") || hoje(), anonimo: str(fd, "anonimo") === "1", createdBy: s.id }).returning({ id: schema.surveys.id });
    await audit(s, "registrar pesquisa", "surveys", r.id, null, { tipo, nota, studentId, unitId });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Resposta registrada."));
}

export async function importarPesquisas(fd: FormData) {
  const s = await requireSession(); let resumo = "";
  try { assert(can.editar(s) || s.role === "COMERCIAL"); const texto = str(fd, "csv"); if (!texto) throw new Error("Cole o CSV.");
    const linhas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean); const sep = linhas[0].includes(";") ? ";" : ","; const head = linhas[0].split(sep).map(h => h.trim().toLowerCase()); const idx = (k: string) => head.indexOf(k);
    if (idx("tipo") < 0 || idx("nota") < 0) throw new Error("Cabeçalho precisa ter tipo e nota (opcionais: data, aluno, unidade, comentario, canal).");
    const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const units = await db.select().from(schema.units); const alunos = await sql<{ id: number; nome: string; unit_atual_id: number | null }[]>`SELECT id, nome, unit_atual_id FROM students`;
    let ok = 0; const erros: string[] = [];
    for (const [i, l] of linhas.slice(1).entries()) { const c = l.split(sep).map(x => x.trim()); const g = (k: string) => (idx(k) >= 0 ? c[idx(k)] ?? "" : "");
      try { const tipo = g("tipo").toUpperCase(); const nota = Number(g("nota")); if (!["NPS", "CSAT"].includes(tipo) || !Number.isFinite(nota)) throw new Error("tipo/nota inválidos");
        const al = g("aluno") ? alunos.find(a => norm(a.nome) === norm(g("aluno"))) : undefined; const un = g("unidade") ? units.find(u => norm(u.nome) === norm(g("unidade")) || norm(u.codigo) === norm(g("unidade"))) : undefined;
        const unitId = un?.id ?? al?.unit_atual_id; if (!unitId) throw new Error("unidade não identificada");
        const data = g("data") ? (g("data").includes("/") ? g("data").split("/").reverse().join("-") : g("data")) : hoje();
        await db.insert(schema.surveys).values({ tipo, nota, comentario: g("comentario") || null, studentId: al?.id ?? null, unitId, canal: g("canal") || "IMPORT", data, anonimo: !al, createdBy: s.id }); ok++;
      } catch (e) { erros.push(`Linha ${i + 2}: ${e instanceof Error ? e.message : e}`); } }
    await audit(s, "importar pesquisas", "surveys", null, null, { importadas: ok, erros: erros.length });
    resumo = `${ok} resposta(s) importada(s).` + (erros.length ? ` ${erros.length} com erro: ${erros.slice(0, 5).join(" · ")}` : "");
  } catch (e) { redirect(go("/atendimento/pesquisas", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go("/atendimento/pesquisas", "ok", resumo));
}

// ---------- Sinais de risco manuais / financeiros ----------
export async function atualizarSinais(fd: FormData) {
  const s = await requireSession(); const studentId = Number(fd.get("studentId")); const b = str(fd, "voltar") || `/matriculas/alunos/${studentId}`;
  try { assert(podeAtender(s.role)); await db.update(schema.students).set({ inadimplente: str(fd, "inadimplente") === "1", riscoObs: strOrNull(fd, "riscoObs") }).where(eq(schema.students.id, studentId)); await audit(s, "sinais de risco", "students", studentId, null, { inadimplente: str(fd, "inadimplente") === "1", riscoObs: strOrNull(fd, "riscoObs") }); }
  catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Sinais atualizados."));
}

export async function importarInadimplencia(fd: FormData) {
  const s = await requireSession(); let resumo = "";
  try { assert(can.editar(s)); const texto = str(fd, "csv"); if (!texto) throw new Error("Cole a lista de nomes (um por linha) exportada do ActiveSoft.");
    const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const nomes = texto.split(/\r?\n/).map(l => l.split(/[;,\t]/)[0].trim()).filter(Boolean); const alunos = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM students WHERE aluno_atual`;
    if (str(fd, "zerar") === "1") await sql`UPDATE students SET inadimplente=false`;
    let ok = 0; const nao: string[] = [];
    for (const n of nomes) { const a = alunos.find(x => norm(x.nome) === norm(n)) ?? alunos.filter(x => norm(x.nome).startsWith(norm(n)))[0]; if (a) { await sql`UPDATE students SET inadimplente=true WHERE id=${a.id}`; ok++; } else nao.push(n); }
    await audit(s, "importar inadimplência", "students", null, null, { marcados: ok, naoEncontrados: nao.length });
    resumo = `${ok} aluno(s) marcado(s) como inadimplente(s).` + (nao.length ? ` Não encontrados: ${nao.slice(0, 6).join(", ")}${nao.length > 6 ? " …" : ""}` : "");
  } catch (e) { redirect(go("/atendimento/risco", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go("/atendimento/risco", "ok", resumo));
}

export async function salvarParamAtendimento(fd: FormData) {
  const s = await requireSession();
  try { assert(can.configurar(s)); const cfg = await getSettings();
    const slaHoras = { URGENTE: int(fd, "sla_URGENTE") ?? 4, ALTA: int(fd, "sla_ALTA") ?? 24, NORMAL: int(fd, "sla_NORMAL") ?? 48, BAIXA: int(fd, "sla_BAIXA") ?? 120 };
    const lista = (k: string, fb: string[]) => { const v = str(fd, k); return v ? v.split("\n").map(x => x.trim()).filter(Boolean) : fb; };
    const novo = { ...cfg.atendimento, slaHoras, categorias: lista("categorias", cfg.atendimento.categorias), recovery: lista("recovery", cfg.atendimento.recovery), retencao: lista("retencao", cfg.atendimento.retencao), riscoRematriculaApos: str(fd, "riscoRematriculaApos") || cfg.atendimento.riscoRematriculaApos };
    await sql`INSERT INTO settings (key, value) VALUES ('atendimento', ${JSON.stringify(novo)}::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`;
    await audit(s, "editar", "settings", null, cfg.atendimento, novo);
  } catch (e) { redirect(go("/configuracoes", "erro", e instanceof Error ? e.message : "Erro") + "#atendimento"); }
  redirect(go("/configuracoes", "ok", "Parâmetros de atendimento salvos.") + "#atendimento");
}

