"use server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, schema, sql } from "@/db";
import { requireSession, can, assert } from "@/lib/auth";
import { audit, str, strOrNull, int, erroMsg, getSettings } from "@/lib/utils";

const ok = (msg: string, tab = "") => `/configuracoes?ok=${encodeURIComponent(msg)}${tab ? `#${tab}` : ""}`;
const erro = (e: unknown, tab = "") => `/configuracoes?erro=${erroMsg(e)}${tab ? `#${tab}` : ""}`;

export async function salvarUnidade(fd: FormData) {
  const s = await requireSession();
  try { assert(can.configurar(s)); const id = int(fd, "id"); const nome = str(fd, "nome"); const codigo = str(fd, "codigo").toUpperCase(); if (!nome || !codigo) throw new Error("Informe nome e código.");
    const companyId = int(fd, "companyId"); // v24: entidade (CNPJ) da unidade — base do Consolidado e das visões por entidade
    if (id) { const [antes] = await db.select().from(schema.units).where(eq(schema.units.id, id)); await db.update(schema.units).set({ nome, codigo, companyId }).where(eq(schema.units.id, id)); await audit(s, "editar", "units", id, antes ?? null, { nome, codigo, companyId }); }
    else { const [r] = await db.insert(schema.units).values({ nome, codigo, companyId }).returning({ id: schema.units.id }); await audit(s, "criar", "units", r.id, null, { nome, codigo, companyId }); }
  } catch (e) { redirect(erro(e, "unidades")); }
  redirect(ok("Unidade salva.", "unidades"));
}

export async function salvarEmpresa(fd: FormData) {
  const s = await requireSession();
  try { assert(can.configurar(s)); const id = int(fd, "id"); const nome = str(fd, "nome"); if (!nome) throw new Error("Informe o nome."); const cnpj = strOrNull(fd, "cnpj");
    if (id) { await db.update(schema.companies).set({ nome, cnpj }).where(eq(schema.companies.id, id)); await audit(s, "editar", "companies", id, null, { nome, cnpj }); }
    else { const [r] = await db.insert(schema.companies).values({ nome, cnpj }).returning({ id: schema.companies.id }); await audit(s, "criar", "companies", r.id, null, { nome, cnpj }); }
  } catch (e) { redirect(erro(e, "empresas")); }
  redirect(ok("Empresa salva.", "empresas"));
}

export async function salvarCargo(fd: FormData) {
  const s = await requireSession();
  try { assert(can.configurar(s)); const id = int(fd, "id"); const nome = str(fd, "nome"); const area = str(fd, "area"); if (!nome || !area) throw new Error("Informe nome e área.");
    const d = { nome, area, parentId: int(fd, "parentId"), regulamentado: str(fd, "regulamentado") === "1", ordem: int(fd, "ordem") ?? 100, formacaoExigida: strOrNull(fd, "formacaoExigida"), documentoFormacao: strOrNull(fd, "documentoFormacao") };
    if (d.formacaoExigida && !d.documentoFormacao) throw new Error("Informe o documento que comprova a formação exigida (ex.: Diploma, Certificado do curso).");
    if (id && d.parentId === id) throw new Error("Um cargo não pode reportar a si mesmo.");
    if (id) { await db.update(schema.positions).set(d).where(eq(schema.positions.id, id)); await audit(s, "editar", "positions", id, null, d); }
    else { const [r] = await db.insert(schema.positions).values(d).returning({ id: schema.positions.id }); await audit(s, "criar", "positions", r.id, null, d); }
  } catch (e) { redirect(erro(e, "cargos")); }
  redirect(ok("Cargo salvo.", "cargos"));
}

export async function excluirCargo(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id"));
  try { assert(can.configurar(s));
    const [{ n }] = await sql<{ n: number }[]>`SELECT (SELECT count(*) FROM employees WHERE position_id=${id}) + (SELECT count(*) FROM positions WHERE parent_id=${id}) AS n`;
    if (Number(n) > 0) throw new Error("Cargo em uso (há pessoas ou cargos subordinados). Reatribua antes de excluir.");
    await db.delete(schema.positions).where(eq(schema.positions.id, id)); await audit(s, "excluir", "positions", id, null, null);
  } catch (e) { redirect(erro(e, "cargos")); }
  redirect(ok("Cargo excluído.", "cargos"));
}

export async function salvarUsuario(fd: FormData) {
  const s = await requireSession();
  try { assert(can.configurar(s)); const id = int(fd, "id"); const email = str(fd, "email").toLowerCase(); const nome = str(fd, "nome"); const role = str(fd, "role"); const senha = str(fd, "senha");
    if (!email || !nome || !role) throw new Error("Informe e-mail, nome e perfil.");
    if (/[\s:]/.test(email) || email.length > 200) throw new Error("Login inválido: use um e-mail (sem espaços nem “:”).");
    let unitId = int(fd, "unitId"); const employeeId = int(fd, "employeeId"); const ativo = str(fd, "ativo") !== "0";
    if ((role === "DIRETOR_UNIDADE" || role === "GESTOR") && !unitId) throw new Error("Diretor de unidade e Gestor precisam de uma unidade.");
    if (role === "COLABORADOR") {
      if (!employeeId) throw new Error("Perfil Colaborador precisa estar vinculado a um colaborador.");
      const [e] = await db.select({ unitId: schema.employees.unitId }).from(schema.employees).where(eq(schema.employees.id, employeeId));
      if (!e) throw new Error("Colaborador vinculado não encontrado.");
      unitId = e.unitId;
    }
    if (id) {
      const d: Partial<typeof schema.users.$inferInsert> = { email, nome, role, unitId, employeeId, ativo }; if (senha) { if (senha.length < 8) throw new Error("Senha com no mínimo 8 caracteres."); d.senhaHash = await bcrypt.hash(senha, 10); }
      await db.update(schema.users).set(d).where(eq(schema.users.id, id)); await audit(s, "editar", "users", id, null, { email, nome, role, unitId, ativo, senha: senha ? "alterada" : "mantida" });
    } else {
      if (senha.length < 8) throw new Error("Senha com no mínimo 8 caracteres.");
      const [r] = await db.insert(schema.users).values({ email, nome, role, unitId, employeeId, ativo, senhaHash: await bcrypt.hash(senha, 10) }).returning({ id: schema.users.id }); await audit(s, "criar", "users", r.id, null, { email, nome, role, unitId });
    }
  } catch (e) { redirect(erro(e instanceof Error && /unique|duplicate/i.test(e.message) ? new Error("Já existe usuário com este e-mail.") : e, "usuarios")); }
  redirect(ok("Usuário salvo.", "usuarios"));
}

export async function trocarMinhaSenha(fd: FormData) {
  const s = await requireSession();
  try { const atual = str(fd, "atual"); const nova = str(fd, "nova");
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, s.id));
    if (!u || !(await bcrypt.compare(atual, u.senhaHash))) throw new Error("Senha atual não confere.");
    if (nova.length < 8) throw new Error("Nova senha com no mínimo 8 caracteres.");
    if (nova === atual) throw new Error("A nova senha precisa ser diferente da atual.");
    await db.update(schema.users).set({ senhaHash: await bcrypt.hash(nova, 10), trocarSenha: false }).where(eq(schema.users.id, s.id)); await audit(s, "trocar senha", "users", s.id);
  } catch (e) { redirect(`/conta?erro=${erroMsg(e)}`); }
  redirect(`/conta?ok=${encodeURIComponent("Senha alterada.")}`);
}

/** RH atende um pedido "esqueci minha senha": gera senha temporária, mostrada uma vez; o usuário troca no primeiro acesso. */
export async function gerarSenhaTemp(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); let temp = "";
  try { assert(can.configurar(s)); const [u] = await db.select().from(schema.users).where(eq(schema.users.id, id)); if (!u) throw new Error("Usuário não encontrado.");
    temp = await (await import("@/lib/reset")).gerarSenhaTemporaria(id, s.id); await audit(s, "senha temporária gerada", "users", id, null, null);
  } catch (e) { redirect(`/configuracoes?erro=${erroMsg(e)}#usuarios`); }
  redirect(`/configuracoes?ok=${encodeURIComponent(`Senha temporária: ${temp} — passe ao usuário pessoalmente; ele será obrigado a trocar no primeiro acesso.`)}#usuarios`);
}

export async function salvarAlcadas(fd: FormData) {
  const s = await requireSession();
  try { assert(can.configurar(s)); const cfg = await getSettings();
    const pick = (k: string) => fd.getAll(k).map(String);
    const alcadas = { ferias: pick("ferias"), banco: pick("banco"), processos: pick("processos"), matricula: pick("matricula"), excecaoCapacidade: pick("excecaoCapacidade"), excecao: pick("excecao"), pops: pick("pops"), vagas: pick("vagas"), remuneracao: pick("remuneracao"), calibracao: pick("calibracao"), financeiro: pick("financeiro") };
    if (Object.values(alcadas).some(a => a.length === 0)) throw new Error("Cada alçada precisa de ao menos um perfil.");
    await sql`INSERT INTO settings (key, value) VALUES ('alcadas', ${JSON.stringify(alcadas)}::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`;
    await audit(s, "editar", "settings", null, cfg.alcadas, alcadas);
  } catch (e) { redirect(erro(e, "alcadas")); }
  redirect(ok("Alçadas salvas.", "alcadas"));
}

export async function salvarChecklist(fd: FormData) {
  const s = await requireSession(); const key = str(fd, "key");
  try { assert(can.configurar(s)); if (!["admissao", "desligamento"].includes(key)) throw new Error("Lista inválida.");
    const itens = str(fd, "itens").split("\n").map(x => x.trim()).filter(Boolean); if (!itens.length) throw new Error("A lista não pode ficar vazia.");
    const cfg = await getSettings();
    await sql`INSERT INTO settings (key, value) VALUES (${key}, ${JSON.stringify(itens)}::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`;
    await audit(s, "editar", "settings", null, (cfg as Record<string, unknown>)[key], itens);
  } catch (e) { redirect(erro(e, "checklists")); }
  redirect(ok("Checklist salvo. Vale para os próximos processos abertos.", "checklists"));
}

export async function salvarDocsPadrao(fd: FormData) {
  const s = await requireSession();
  try { assert(can.configurar(s));
    const itens = str(fd, "itens").split("\n").map(x => x.trim()).filter(Boolean).map(l => { const opc = /\(opcional\)\s*$/i.test(l); return [l.replace(/\s*\(opcional\)\s*$/i, ""), !opc]; });
    if (!itens.length) throw new Error("A lista não pode ficar vazia.");
    await sql`INSERT INTO settings (key, value) VALUES ('documentos', ${JSON.stringify(itens)}::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`;
    await audit(s, "editar", "settings", null, null, itens);
  } catch (e) { redirect(erro(e, "checklists")); }
  redirect(ok("Documentos padrão salvos. Valem para os próximos cadastros.", "checklists"));
}

export async function redefinir2FA(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id"));
  try { assert(can.configurar(s)); await db.update(schema.users).set({ totpSecret: null, totpAtivo: false, backupCodes: null }).where(eq(schema.users.id, id)); await audit(s, "redefinir 2FA", "users", id, null, null); }
  catch (e) { redirect(`/configuracoes?erro=${encodeURIComponent(e instanceof Error ? e.message : "Erro")}#usuarios`); }
  redirect(`/configuracoes?ok=${encodeURIComponent("Verificação em duas etapas redefinida; o usuário configura de novo no próximo acesso.")}#usuarios`);
}

/** Parâmetros do ONE Insights (v23): farol dos indicadores, resumo semanal, lembrete de pendências, prazos da central de fluxos e cenários do caixa. */
export async function salvarParamInsights(fd: FormData) {
  const s = await requireSession();
  try {
    assert(can.configurar(s), "Só Direção e RH configuram."); const cfg = await getSettings();
    const num = (k: string, min: number, max: number, rotulo: string) => { const v = Number(str(fd, k).replace(",", ".")); if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${rotulo}: use um número entre ${min} e ${max}.`); return v; };
    const insights = { ...cfg.insights, toleranciaPct: num("toleranciaPct", 1, 50, "Tolerância do farol"), resumoSemanal: str(fd, "resumoSemanal") === "1", lembretePendencias: str(fd, "lembretePendencias") === "1" };
    const fluxos = { ...cfg.fluxos, riscoPct: Math.round(num("riscoPct", 5, 90, "Em risco")), prazoDecisaoDias: Math.round(num("prazoDecisaoDias", 1, 30, "Prazo para decidir")), prazoFeriasDias: Math.round(num("prazoFeriasDias", 1, 30, "Prazo para aprovar férias")) };
    const pess = num("cenarioPessimistaPct", 0, 100, "Cenário pessimista"), otim = num("cenarioOtimistaPct", 0, 100, "Cenário otimista");
    if (pess > otim) throw new Error("O cenário pessimista não pode passar do otimista.");
    const fpa = { ...cfg.fpa, cenarioPessimistaPct: pess, cenarioOtimistaPct: otim };
    await sql.begin(async tx => {
      for (const [key, value] of [["insights", insights], ["fluxos", fluxos], ["fpa", fpa]] as const) await tx`INSERT INTO settings (key, value) VALUES (${key}, ${JSON.stringify(value)}::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`;
    });
    await audit(s, "editar", "settings", null, { insights: cfg.insights, fluxos: cfg.fluxos, fpa: cfg.fpa }, { insights, fluxos, fpa });
  } catch (e) { redirect(erro(e, "insights")); }
  redirect(ok("Parâmetros do Insights salvos.", "insights"));
}

/**
 * v24.1 · carga inicial: cria de uma vez o acesso de autoatendimento (perfil Colaborador) de quem tem e-mail válido na ficha
 * e ainda não tem usuário. A senha é aleatória e ninguém a conhece: a pessoa entra por “Esqueci minha senha” (com o envio de
 * e-mail configurado) ou recebe do RH uma senha temporária — nos dois casos troca no primeiro acesso.
 */
export async function criarAcessosAutoatendimento(fd: FormData) {
  const s = await requireSession(); let msg = "";
  try {
    assert(can.configurar(s)); const unitId = int(fd, "unitId");
    const emps = await sql<{ id: number; nome: string; email: string | null; unit_id: number }[]>`SELECT e.id, e.nome, lower(trim(e.email)) AS email, e.unit_id FROM employees e WHERE e.situacao IN ('ATIVO','EM_ADMISSAO') AND (${unitId ?? null}::int IS NULL OR e.unit_id=${unitId ?? null}::int) AND NOT EXISTS (SELECT 1 FROM users u WHERE u.employee_id=e.id) ORDER BY e.nome`;
    const { randomBytes } = await import("crypto");
    let criados = 0; const semEmail: string[] = []; const emUso: string[] = [];
    for (const e of emps) {
      if (!e.email || !/^[^@\s:]+@[^@\s:]+\.[^@\s:]+$/.test(e.email)) { semEmail.push(e.nome); continue; }
      const [ja] = await sql<{ id: number }[]>`SELECT id FROM users WHERE email=${e.email}`; if (ja) { emUso.push(e.nome); continue; }
      await db.insert(schema.users).values({ email: e.email, nome: e.nome, role: "COLABORADOR", unitId: e.unit_id, employeeId: e.id, ativo: true, senhaHash: await bcrypt.hash(randomBytes(24).toString("hex"), 10), trocarSenha: true });
      criados++;
    }
    await audit(s, "criar acessos de autoatendimento em lote", "users", null, null, { criados, semEmail: semEmail.length, emailEmUso: emUso.length, unitId });
    const lista = (xs: string[]) => `${xs.slice(0, 8).join(", ")}${xs.length > 8 ? "…" : ""}`;
    msg = `${criados} acesso(s) de autoatendimento criado(s).` + (semEmail.length ? ` Sem e-mail válido na ficha (${semEmail.length}): ${lista(semEmail)}.` : "") + (emUso.length ? ` E-mail já usado por outro acesso (${emUso.length}): ${lista(emUso)}.` : "") + (criados ? " Para entrar, cada pessoa usa “Esqueci minha senha” ou recebe do RH uma senha temporária." : "");
  } catch (e) { redirect(erro(e, "usuarios")); }
  redirect(ok(msg, "usuarios"));
}

