"use server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireSession, can, assert, assertScope } from "@/lib/auth";
import { audit, str, strOrNull, int, erroMsg, getSettings, hoje, addDays } from "@/lib/utils";
import { reservarVaga, confirmarMatricula, cancelarMatricula, transferir, entrarNaFila } from "@/lib/matriculas";

const back = (fd: FormData, fb: string) => str(fd, "voltar") || fb;
const go = (b: string, k: "ok" | "erro", msg: string, hash = "") => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}${hash}`;

// ---------- Alunos ----------
function lerAluno(fd: FormData) {
  const nome = str(fd, "nome"); if (!nome) throw new Error("Informe o nome do aluno.");
  return { nome, dataNascimento: strOrNull(fd, "dataNascimento"), responsavel: strOrNull(fd, "responsavel"), telefone: strOrNull(fd, "telefone"), email: strOrNull(fd, "email"), cpfResponsavel: strOrNull(fd, "cpfResponsavel"), alunoAtual: str(fd, "alunoAtual") === "1", unitAtualId: int(fd, "unitAtualId"), serieAtualId: int(fd, "serieAtualId"), origem: strOrNull(fd, "origem"), obs: strOrNull(fd, "obs") };
}
export async function salvarAluno(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id"); let novoId = id ?? 0;
  try {
    assert(can.reservar(s));
    const d = lerAluno(fd);
    if (id) { const [antes] = await db.select().from(schema.students).where(eq(schema.students.id, id)); await db.update(schema.students).set(d).where(eq(schema.students.id, id)); await audit(s, "editar", "students", id, antes, d); }
    else { const [r] = await db.insert(schema.students).values(d).returning({ id: schema.students.id }); novoId = r.id; await audit(s, "criar", "students", r.id, null, d); }
  } catch (e) { redirect(go(id ? `/matriculas/alunos/${id}` : "/matriculas/alunos/novo", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`/matriculas/alunos/${novoId}`, "ok", id ? "Dados atualizados." : "Aluno cadastrado."));
}

export async function importarAlunos(fd: FormData) {
  const s = await requireSession(); let resumo = "";
  try {
    assert(can.reservar(s));
    const texto = str(fd, "csv"); if (!texto) throw new Error("Cole o conteúdo do CSV.");
    const linhas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const sep = linhas[0].includes(";") ? ";" : linhas[0].includes("\t") ? "\t" : ",";
    const head = linhas[0].split(sep).map(h => h.trim().toLowerCase()); const idx = (k: string) => head.indexOf(k);
    if (idx("nome") < 0) throw new Error("Cabeçalho precisa ter ao menos a coluna nome.");
    const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const units = await db.select().from(schema.units); const grades = await db.select().from(schema.grades);
    let ok = 0; const erros: string[] = [];
    for (const [i, l] of linhas.slice(1).entries()) {
      const c = l.split(sep).map(x => x.trim()); const g = (k: string) => (idx(k) >= 0 ? c[idx(k)] ?? "" : "");
      try {
        if (!g("nome")) throw new Error("nome vazio");
        const unit = g("unidade") ? units.find(u => norm(u.nome) === norm(g("unidade")) || norm(u.codigo) === norm(g("unidade"))) : undefined;
        if (g("unidade") && !unit) throw new Error(`unidade "${g("unidade")}" não encontrada`);
        const grade = g("serie") ? grades.find(x => norm(x.nome) === norm(g("serie")) || norm(x.nome).startsWith(norm(g("serie")))) : undefined;
        if (g("serie") && !grade) throw new Error(`série "${g("serie")}" não encontrada`);
        const nasc = g("nascimento") ? (g("nascimento").includes("/") ? g("nascimento").split("/").reverse().join("-") : g("nascimento")) : null;
        const [dup] = await sql<{ id: number }[]>`SELECT id FROM students WHERE lower(nome)=lower(${g("nome")}) AND (${nasc}::date IS NULL OR data_nascimento IS NULL OR data_nascimento=${nasc}::date)`;
        if (dup) throw new Error(`"${g("nome")}" já cadastrado (pulado)`);
        await db.insert(schema.students).values({ nome: g("nome"), dataNascimento: nasc, responsavel: g("responsavel") || null, telefone: g("telefone") || null, email: g("email") || null, alunoAtual: /^(1|sim|s|x|true)$/i.test(g("aluno_atual")) || !!grade, unitAtualId: unit?.id ?? null, serieAtualId: grade?.id ?? null, origem: unit ? "REMATRICULA" : (g("origem") || null) });
        ok++;
      } catch (e) { erros.push(`Linha ${i + 2}: ${e instanceof Error ? e.message : e}`); }
    }
    await audit(s, "importar alunos", "students", null, null, { importados: ok, erros: erros.length });
    resumo = `${ok} aluno(s) importado(s).` + (erros.length ? ` ${erros.length} linha(s) com erro: ${erros.slice(0, 5).join(" · ")}${erros.length > 5 ? " …" : ""}` : "");
  } catch (e) { redirect(go("/matriculas/importar", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go("/matriculas/alunos", "ok", resumo));
}

// ---------- Reservas e matrículas ----------
export async function reservar(fd: FormData) {
  const s = await requireSession(); const b = back(fd, "/matriculas"); let msg = "";
  try {
    assert(can.reservar(s));
    const studentId = int(fd, "studentId"); const classId = int(fd, "classId");
    if (!studentId || !classId) throw new Error("Escolha o aluno e a turma.");
    const r = await reservarVaga(s, { studentId, classId, prazoDias: int(fd, "prazoDias") ?? undefined, excecao: strOrNull(fd, "excecao"), confirmarDireto: str(fd, "confirmarDireto") === "1", contrato: str(fd, "contrato") === "1", financeiro: str(fd, "financeiro") === "1", obs: strOrNull(fd, "obs") });
    await audit(s, r.confirmada ? "matricular" : "reservar", "enrollments", r.id, null, { studentId, classId, excecao: r.excecao, reservaAte: r.reservaAte });
    msg = r.confirmada ? `Matrícula confirmada na turma ${r.turma}.` : `Vaga reservada na turma ${r.turma} até ${r.reservaAte!.split("-").reverse().join("/")}.` + (r.excecao ? " (exceção registrada)" : "");
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}

export async function confirmar(fd: FormData) {
  const s = await requireSession(); const b = back(fd, "/matriculas/reservas"); const id = Number(fd.get("id")); let t = "";
  try {
    const r = await confirmarMatricula(s, id, str(fd, "contrato") === "1", str(fd, "financeiro") === "1"); t = r.turma;
    await audit(s, "matricular", "enrollments", id, { status: "RESERVADA" }, { status: "CONFIRMADA" });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", `Matrícula confirmada na turma ${t}.`));
}

export async function cancelar(fd: FormData) {
  const s = await requireSession(); const b = back(fd, "/matriculas/reservas"); const id = Number(fd.get("id")); let msg = "";
  try {
    const r = await cancelarMatricula(s, id, str(fd, "motivo"));
    await audit(s, "cancelar", "enrollments", id, { status: r.statusAnterior }, { status: "CANCELADA", motivo: str(fd, "motivo"), ofertadoAoProximo: r.ofertado });
    msg = `${r.statusAnterior === "CONFIRMADA" ? "Matrícula" : "Reserva"} cancelada na turma ${r.turma}.` + (r.ofertado ? ` Vaga ofertada a ${r.ofertado} (próximo da fila).` : "");
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}

export async function transferirAcao(fd: FormData) {
  const s = await requireSession(); const b = back(fd, "/matriculas/reservas"); const id = Number(fd.get("id")); let t = "";
  try {
    assert(can.reservar(s));
    const novaClassId = int(fd, "novaClassId"); if (!novaClassId) throw new Error("Escolha a turma de destino.");
    const r = await transferir(s, id, novaClassId, strOrNull(fd, "excecao")); t = r.turma;
    await audit(s, "transferir", "enrollments", id, null, { novoRegistro: r.novoId, novaClassId });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", `Transferido para a turma ${t}.`));
}

export async function prorrogar(fd: FormData) {
  const s = await requireSession(); const b = back(fd, "/matriculas/reservas"); const id = Number(fd.get("id"));
  try {
    const cfg = await getSettings(); assert(can.aprovar(s, cfg.alcadas.matricula), "Prorrogar reserva exige o perfil que confirma matrículas.");
    const dias = int(fd, "dias") ?? cfg.matriculas.reservaDias;
    const [e] = await sql<{ id: number; status: string; reserva_ate: string; unit_id: number }[]>`SELECT e.id, e.status, e.reserva_ate::text, c.unit_id FROM enrollments e JOIN classes c ON c.id=e.class_id WHERE e.id=${id}`;
    if (!e || e.status !== "RESERVADA") throw new Error("Só reservas ativas podem ser prorrogadas.");
    assertScope(s, e.unit_id);
    const nova = addDays(e.reserva_ate < hoje() ? hoje() : e.reserva_ate, dias);
    await sql`UPDATE enrollments SET reserva_ate=${nova}, updated_at=now() WHERE id=${id}`;
    await audit(s, "prorrogar reserva", "enrollments", id, { reservaAte: e.reserva_ate }, { reservaAte: nova, dias });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Reserva prorrogada."));
}

// ---------- Lista de espera ----------
export async function entrarFila(fd: FormData) {
  const s = await requireSession(); const b = back(fd, "/matriculas/fila");
  try {
    assert(can.reservar(s));
    const cfg = await getSettings();
    const studentId = int(fd, "studentId"); const unitId = int(fd, "unitId"); const gradeId = int(fd, "gradeId");
    if (!studentId || !unitId || !gradeId) throw new Error("Escolha aluno, unidade e série.");
    const id = await entrarNaFila(s, studentId, unitId, gradeId, strOrNull(fd, "turno"), str(fd, "modalidade") || "REGULAR", int(fd, "ano") ?? cfg.matriculas.anoLetivo);
    await audit(s, "entrar na fila", "waitlist", id, null, { studentId, unitId, gradeId });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Aluno incluído na lista de espera."));
}

export async function ofertarFila(fd: FormData) {
  const s = await requireSession(); const b = back(fd, "/matriculas/fila"); const id = Number(fd.get("id"));
  try {
    assert(can.reservar(s)); const cfg = await getSettings();
    const classId = int(fd, "classId"); if (!classId) throw new Error("Escolha a turma com vaga.");
    const [w] = await sql<{ id: number; status: string; unit_id: number }[]>`SELECT id, status, unit_id FROM waitlist WHERE id=${id}`;
    if (!w || w.status !== "AGUARDANDO") throw new Error("Este aluno não está aguardando na fila.");
    assertScope(s, w.unit_id);
    await sql`UPDATE waitlist SET status='OFERTADA', oferta_ate=${addDays(hoje(), cfg.matriculas.ofertaFilaDias)}, oferta_class_id=${classId} WHERE id=${id}`;
    await audit(s, "ofertar vaga", "waitlist", id, null, { classId });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Vaga ofertada. Converta em reserva quando a família aceitar."));
}

export async function converterFila(fd: FormData) {
  const s = await requireSession(); const b = back(fd, "/matriculas/fila"); const id = Number(fd.get("id")); let msg = "";
  try {
    assert(can.reservar(s));
    const [w] = await sql<{ id: number; status: string; student_id: number; oferta_class_id: number | null }[]>`SELECT id, status, student_id, oferta_class_id FROM waitlist WHERE id=${id}`;
    if (!w || !["AGUARDANDO", "OFERTADA"].includes(w.status)) throw new Error("Registro da fila não está ativo.");
    const classId = int(fd, "classId") ?? w.oferta_class_id; if (!classId) throw new Error("Escolha a turma.");
    const r = await reservarVaga(s, { studentId: w.student_id, classId, excecao: strOrNull(fd, "excecao") });
    await audit(s, "converter fila em reserva", "waitlist", id, { status: w.status }, { enrollment: r.id, classId });
    msg = `Reserva criada na turma ${r.turma} até ${r.reservaAte!.split("-").reverse().join("/")}.`;
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}

export async function sairFila(fd: FormData) {
  const s = await requireSession(); const b = back(fd, "/matriculas/fila"); const id = Number(fd.get("id"));
  try {
    assert(can.reservar(s));
    const [w] = await sql<{ id: number; status: string; unit_id: number }[]>`SELECT id, status, unit_id FROM waitlist WHERE id=${id}`;
    if (!w || !["AGUARDANDO", "OFERTADA"].includes(w.status)) throw new Error("Registro da fila não está ativo.");
    assertScope(s, w.unit_id);
    await sql`UPDATE waitlist SET status='DESISTIU', obs=${strOrNull(fd, "motivo")} WHERE id=${id}`;
    await audit(s, "sair da fila", "waitlist", id, { status: w.status }, { status: "DESISTIU", motivo: strOrNull(fd, "motivo") });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Aluno retirado da fila."));
}

// ---------- Turmas ----------
export async function salvarTurma(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id");
  try {
    assert(can.gradeTurmas(s), "Só RH e Direção alteram a grade de turmas.");
    const cfg = await getSettings();
    const d = { ano: int(fd, "ano") ?? cfg.matriculas.anoLetivo, unitId: int(fd, "unitId"), modalidade: str(fd, "modalidade") || "REGULAR", gradeId: int(fd, "gradeId"), seriesTexto: strOrNull(fd, "seriesTexto"), turno: str(fd, "turno"), nome: str(fd, "nome"), vagas: int(fd, "vagas"), status: str(fd, "status") || "ABERTA", obs: strOrNull(fd, "obs") };
    if (!d.unitId || !d.turno || !d.nome || d.vagas === null || d.vagas < 0) throw new Error("Informe unidade, turno, nome e vagas.");
    if (d.modalidade === "REGULAR" && !d.gradeId) throw new Error("Turma Regular precisa de série.");
    if (id) {
      const [antes] = await db.select().from(schema.classes).where(eq(schema.classes.id, id));
      const [{ ocup }] = await sql<{ ocup: number }[]>`SELECT count(*)::int AS ocup FROM enrollments WHERE class_id=${id} AND (status='CONFIRMADA' OR (status='RESERVADA' AND reserva_ate >= ${hoje()}))`;
      if (d.vagas! < ocup) throw new Error(`A turma já tem ${ocup} vaga(s) ocupada(s)/reservada(s); não é possível reduzir para ${d.vagas}.`);
      await db.update(schema.classes).set({ ...d, unitId: d.unitId!, vagas: d.vagas! }).where(eq(schema.classes.id, id)); await audit(s, "editar", "classes", id, antes, d);
    } else { const [r] = await db.insert(schema.classes).values({ ...d, unitId: d.unitId!, vagas: d.vagas! }).returning({ id: schema.classes.id }); await audit(s, "criar", "classes", r.id, null, d); }
  } catch (e) { redirect(go("/matriculas/turmas", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go("/matriculas/turmas", "ok", "Turma salva."));
}

export async function excluirTurma(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id"));
  try {
    assert(can.gradeTurmas(s));
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM enrollments WHERE class_id=${id}`;
    if (n > 0) throw new Error("Turma com reservas/matrículas não pode ser excluída — feche-a (status Fechada).");
    const [antes] = await db.select().from(schema.classes).where(eq(schema.classes.id, id));
    await db.delete(schema.classes).where(eq(schema.classes.id, id)); await audit(s, "excluir", "classes", id, antes, null);
  } catch (e) { redirect(go("/matriculas/turmas", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go("/matriculas/turmas", "ok", "Turma excluída."));
}

export async function salvarSerie(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id");
  try {
    assert(can.configurar(s)); const nome = str(fd, "nome"); const segmento = str(fd, "segmento"); const ordem = int(fd, "ordem") ?? 100;
    if (!nome || !segmento) throw new Error("Informe nome e segmento.");
    if (id) { await db.update(schema.grades).set({ nome, segmento, ordem }).where(eq(schema.grades.id, id)); await audit(s, "editar", "grades", id, null, { nome, segmento, ordem }); }
    else { const [r] = await db.insert(schema.grades).values({ nome, segmento, ordem }).returning({ id: schema.grades.id }); await audit(s, "criar", "grades", r.id, null, { nome, segmento, ordem }); }
  } catch (e) { redirect(go("/configuracoes", "erro", e instanceof Error ? e.message : "Erro", "#matriculas")); }
  redirect(go("/configuracoes", "ok", "Série salva.", "#matriculas"));
}

export async function salvarParamMatriculas(fd: FormData) {
  const s = await requireSession();
  try {
    assert(can.configurar(s)); const cfg = await getSettings();
    const novo = { anoLetivo: int(fd, "anoLetivo") ?? cfg.matriculas.anoLetivo, reservaDias: int(fd, "reservaDias") ?? cfg.matriculas.reservaDias, ofertaFilaDias: int(fd, "ofertaFilaDias") ?? cfg.matriculas.ofertaFilaDias };
    if (novo.reservaDias < 1 || novo.ofertaFilaDias < 1) throw new Error("Prazos precisam ser de ao menos 1 dia.");
    await sql`INSERT INTO settings (key, value) VALUES ('matriculas', ${JSON.stringify(novo)}::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`;
    await audit(s, "editar", "settings", null, cfg.matriculas, novo);
  } catch (e) { redirect(go("/configuracoes", "erro", e instanceof Error ? e.message : "Erro", "#matriculas")); }
  redirect(go("/configuracoes", "ok", "Parâmetros de matrícula salvos.", "#matriculas"));
}
