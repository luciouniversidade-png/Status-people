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
    if (id) { await db.update(schema.units).set({ nome, codigo }).where(eq(schema.units.id, id)); await audit(s, "editar", "units", id, null, { nome, codigo }); }
    else { const [r] = await db.insert(schema.units).values({ nome, codigo }).returning({ id: schema.units.id }); await audit(s, "criar", "units", r.id, null, { nome, codigo }); }
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
    const d = { nome, area, parentId: int(fd, "parentId"), regulamentado: str(fd, "regulamentado") === "1", ordem: int(fd, "ordem") ?? 100 };
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
