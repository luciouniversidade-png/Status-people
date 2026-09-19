"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireSession, can, assert, assertScope } from "@/lib/auth";
import { audit, str, strOrNull, num, int, erroMsg, getSettings, hoje } from "@/lib/utils";
import { abrirProcesso } from "@/lib/processos";

function lerColaborador(fd: FormData) {
  const nome = str(fd, "nome"); const admissao = str(fd, "admissao"); const unitId = int(fd, "unitId");
  if (!nome) throw new Error("Informe o nome.");
  if (!admissao) throw new Error("Informe a data de admissão.");
  if (!unitId) throw new Error("Escolha a unidade.");
  return {
    nome, admissao, unitId,
    cpf: strOrNull(fd, "cpf"), email: strOrNull(fd, "email"), telefone: strOrNull(fd, "telefone"),
    dataNascimento: strOrNull(fd, "dataNascimento"), endereco: strOrNull(fd, "endereco"),
    companyId: int(fd, "companyId"), positionId: int(fd, "positionId"), nivel: strOrNull(fd, "nivel"), gestorId: int(fd, "gestorId"),
    vinculo: str(fd, "vinculo") || "CLT", jornadaMinDia: int(fd, "jornadaMinDia"), turno: strOrNull(fd, "turno"), obs: strOrNull(fd, "obs"),
    regime: str(fd, "regime") === "DOCENTE" ? "DOCENTE" : "ADMINISTRATIVO",
  };
}

export async function criarColaborador(fd: FormData) {
  const s = await requireSession(); let id = 0;
  try {
    assert(can.editar(s));
    const d = lerColaborador(fd);
    const salario = can.verSalario(s) ? num(fd, "salario") : null;
    const comAdmissao = str(fd, "abrirAdmissao") === "1";
    const [row] = await db.insert(schema.employees).values({ ...d, salario: salario === null ? null : String(salario), situacao: comAdmissao ? "EM_ADMISSAO" : "ATIVO" }).returning({ id: schema.employees.id });
    id = row.id;
    await audit(s, "criar", "employees", id, null, { ...d, salario: salario === null ? null : "***" });
    const cfg = await getSettings();
    // Checklist de documentos padrão
    await db.insert(schema.documents).values(cfg.documentos.map(([tipo, obrigatorio]) => ({ employeeId: id, tipo: String(tipo), obrigatorio: Boolean(obrigatorio) })));
    if (comAdmissao) await abrirProcesso(s.id, id, "ADMISSAO", d.admissao, cfg.admissao);
  } catch (e) { redirect(`/colaboradores/novo?erro=${erroMsg(e)}`); }
  redirect(`/colaboradores/${id}?ok=${encodeURIComponent("Colaborador cadastrado.")}`);
}

export async function atualizarColaborador(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id"));
  try {
    assert(can.editar(s));
    const [antes] = await db.select().from(schema.employees).where(eq(schema.employees.id, id));
    if (!antes) throw new Error("Colaborador não encontrado.");
    assertScope(s, antes.unitId);
    const d = lerColaborador(fd);
    const salario = can.verSalario(s) ? num(fd, "salario") : undefined;
    await db.update(schema.employees).set({ ...d, ...(salario === undefined ? {} : { salario: salario === null ? null : String(salario) }), updatedAt: new Date() }).where(eq(schema.employees.id, id));
    if (salario !== undefined && salario !== null && Number(antes.salario ?? 0) !== salario) await sql`INSERT INTO salary_history (employee_id, data, salario_anterior, salario, motivo, obs, user_id) VALUES (${id}, ${hoje()}, ${antes.salario}, ${salario}, ${antes.salario ? "AJUSTE" : "ADMISSAO"}, 'Alterado na ficha', ${s.id})`;
    const { salario: _a, ...antesSemSalario } = antes; void _a;
    await audit(s, "editar", "employees", id, antesSemSalario, { ...d, salario: salario === undefined ? "(inalterado)" : salario === null ? null : "***" });
  } catch (e) { redirect(`/colaboradores/${id}/editar?erro=${erroMsg(e)}`); }
  redirect(`/colaboradores/${id}?ok=${encodeURIComponent("Dados atualizados.")}`);
}

export async function iniciarDesligamento(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); let pid = 0;
  try {
    assert(can.editar(s));
    const [e] = await db.select().from(schema.employees).where(eq(schema.employees.id, id));
    if (!e) throw new Error("Colaborador não encontrado.");
    if (e.situacao === "DESLIGADO") throw new Error("Colaborador já desligado.");
    const [aberto] = await sql<{ id: number }[]>`SELECT id FROM processes WHERE employee_id=${id} AND tipo='DESLIGAMENTO' AND status='ABERTO'`;
    if (aberto) throw new Error("Já existe um desligamento em andamento para este colaborador.");
    const data = str(fd, "desligamento") || hoje(); const motivo = strOrNull(fd, "motivo");
    const cfg = await getSettings();
    pid = await abrirProcesso(s.id, id, "DESLIGAMENTO", data, cfg.desligamento);
    await db.update(schema.employees).set({ desligamento: data, motivoDesligamento: motivo, updatedAt: new Date() }).where(eq(schema.employees.id, id));
    await audit(s, "iniciar desligamento", "employees", id, { situacao: e.situacao }, { desligamento: data, motivo, processo: pid });
  } catch (e) { redirect(`/colaboradores/${id}?erro=${erroMsg(e)}`); }
  redirect(`/processos/${pid}?ok=${encodeURIComponent("Desligamento iniciado. Conclua o checklist para encerrar o vínculo.")}`);
}

// ---- Documentos ----
export async function salvarDocumento(fd: FormData) {
  const s = await requireSession(); const employeeId = Number(fd.get("employeeId")); const docId = int(fd, "docId");
  try {
    assert(can.editar(s));
    const dados = { tipo: str(fd, "tipo"), nome: strOrNull(fd, "nome"), link: strOrNull(fd, "link"), validade: strOrNull(fd, "validade"), recebidoEm: strOrNull(fd, "recebidoEm"), obrigatorio: str(fd, "obrigatorio") === "1", obs: strOrNull(fd, "obs") };
    if (!dados.tipo) throw new Error("Informe o tipo do documento.");
    if (docId) {
      const [antes] = await db.select().from(schema.documents).where(eq(schema.documents.id, docId));
      await db.update(schema.documents).set(dados).where(eq(schema.documents.id, docId));
      await audit(s, "editar", "documents", docId, antes, dados);
    } else {
      const [d] = await db.insert(schema.documents).values({ employeeId, ...dados }).returning({ id: schema.documents.id });
      await audit(s, "criar", "documents", d.id, null, dados);
    }
  } catch (e) { redirect(`/colaboradores/${employeeId}?erro=${erroMsg(e)}#documentos`); }
  revalidatePath(`/colaboradores/${employeeId}`);
  redirect(`/colaboradores/${employeeId}?ok=${encodeURIComponent("Documento salvo.")}#documentos`);
}

export async function marcarRecebido(fd: FormData) {
  const s = await requireSession(); const docId = Number(fd.get("docId")); const employeeId = Number(fd.get("employeeId"));
  try {
    assert(can.editar(s));
    await db.update(schema.documents).set({ recebidoEm: hoje() }).where(eq(schema.documents.id, docId));
    await audit(s, "marcar recebido", "documents", docId, null, { recebidoEm: hoje() });
  } catch (e) { redirect(`/colaboradores/${employeeId}?erro=${erroMsg(e)}#documentos`); }
  redirect(`/colaboradores/${employeeId}#documentos`);
}

export async function excluirDocumento(fd: FormData) {
  const s = await requireSession(); const docId = Number(fd.get("docId")); const employeeId = Number(fd.get("employeeId"));
  try {
    assert(can.editar(s));
    const [antes] = await db.select().from(schema.documents).where(eq(schema.documents.id, docId));
    await db.delete(schema.documents).where(eq(schema.documents.id, docId));
    await audit(s, "excluir", "documents", docId, antes, null);
  } catch (e) { redirect(`/colaboradores/${employeeId}?erro=${erroMsg(e)}#documentos`); }
  redirect(`/colaboradores/${employeeId}#documentos`);
}

// ---- Importação em lote (CSV colado) ----
// Colunas (cabeçalho obrigatório, separador ; ou ,): nome;unidade;cargo;empresa;vinculo;admissao;email;telefone;jornada_min_dia;turno
export async function importarCSV(fd: FormData) {
  const s = await requireSession(); let resumo = "";
  try {
    assert(can.editar(s));
    const texto = str(fd, "csv"); if (!texto) throw new Error("Cole o conteúdo do CSV.");
    const linhas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const sep = linhas[0].includes(";") ? ";" : ",";
    const head = linhas[0].split(sep).map(h => h.trim().toLowerCase());
    const idx = (k: string) => head.indexOf(k);
    if (idx("nome") < 0 || idx("unidade") < 0 || idx("admissao") < 0) throw new Error("Cabeçalho precisa ter ao menos: nome; unidade; admissao.");
    const units = await db.select().from(schema.units); const positions = await db.select().from(schema.positions); const companies = await db.select().from(schema.companies);
    const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const findBy = <T extends { nome: string }>(arr: T[], v: string) => arr.find(a => norm(a.nome) === norm(v)) ?? arr.find(a => norm(a.nome).startsWith(norm(v)));
    const cfg = await getSettings();
    let ok = 0; const erros: string[] = [];
    for (const [i, l] of linhas.slice(1).entries()) {
      const c = l.split(sep).map(x => x.trim());
      const g = (k: string) => (idx(k) >= 0 ? c[idx(k)] ?? "" : "");
      try {
        const unit = findBy(units, g("unidade")) ?? units.find(u => norm(u.codigo) === norm(g("unidade")));
        if (!unit) throw new Error(`unidade "${g("unidade")}" não encontrada`);
        const adm = g("admissao").includes("/") ? g("admissao").split("/").reverse().join("-") : g("admissao");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(adm)) throw new Error(`admissão "${g("admissao")}" inválida (use AAAA-MM-DD ou DD/MM/AAAA)`);
        const pos = g("cargo") ? findBy(positions, g("cargo")) : undefined;
        const comp = g("empresa") ? findBy(companies, g("empresa")) : undefined;
        const vinc = (g("vinculo") || "CLT").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (!g("nome")) throw new Error("nome vazio");
        const [dup] = await sql<{ id: number }[]>`SELECT id FROM employees WHERE lower(nome)=lower(${g("nome")}) AND unit_id=${unit.id} AND situacao <> 'DESLIGADO'`;
        if (dup) throw new Error(`"${g("nome")}" já existe nesta unidade (pulado)`);
        const regime = /professor|pedagog|docente/i.test(pos?.nome ?? g("cargo")) || /^(docente|sim|s|1)$/i.test(g("regime")) ? "DOCENTE" : "ADMINISTRATIVO";
        const [novo] = await db.insert(schema.employees).values({ nome: g("nome"), unitId: unit.id, positionId: pos?.id ?? null, companyId: comp?.id ?? null, vinculo: vinc, admissao: adm, email: g("email") || null, telefone: g("telefone") || null, jornadaMinDia: g("jornada_min_dia") ? Number(g("jornada_min_dia")) : null, turno: g("turno") || null, regime }).returning({ id: schema.employees.id });
        await db.insert(schema.documents).values(cfg.documentos.map(([tipo, obrigatorio]) => ({ employeeId: novo.id, tipo: String(tipo), obrigatorio: Boolean(obrigatorio) })));
        ok++;
      } catch (e) { erros.push(`Linha ${i + 2}: ${e instanceof Error ? e.message : e}`); }
    }
    await audit(s, "importar CSV", "employees", null, null, { importados: ok, erros: erros.length });
    resumo = `${ok} colaborador(es) importado(s).` + (erros.length ? ` ${erros.length} linha(s) com erro: ${erros.slice(0, 5).join(" · ")}${erros.length > 5 ? " …" : ""}` : "");
  } catch (e) { redirect(`/colaboradores/importar?erro=${erroMsg(e)}`); }
  redirect(`/colaboradores?ok=${encodeURIComponent(resumo)}`);
}

export async function excluirColaborador(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id"));
  try {
    assert(can.editar(s));
    const [{ n }] = await sql<{ n: number }[]>`SELECT (SELECT count(*) FROM leave_requests WHERE employee_id=${id}) + (SELECT count(*) FROM hour_entries WHERE employee_id=${id}) + (SELECT count(*) FROM processes WHERE employee_id=${id}) AS n`;
    if (Number(n) > 0) throw new Error("Este colaborador já tem histórico (férias, banco de horas ou processos). Use o desligamento em vez de excluir.");
    const [antes] = await db.select().from(schema.employees).where(eq(schema.employees.id, id));
    await db.delete(schema.documents).where(eq(schema.documents.employeeId, id));
    await db.delete(schema.employees).where(eq(schema.employees.id, id));
    await audit(s, "excluir", "employees", id, { ...antes, salario: "***" }, null);
  } catch (e) { redirect(`/colaboradores/${id}?erro=${erroMsg(e)}`); }
  redirect(`/colaboradores?ok=${encodeURIComponent("Cadastro excluído.")}`);
}
