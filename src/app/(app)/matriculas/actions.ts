"use server";
import { textoImportacao } from "@/lib/importacao";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireSession, can, assert, assertScope } from "@/lib/auth";
import { audit, str, strOrNull, int, erroMsg, getSettings, hoje, addDays, detectarSeparador, normalizarCabecalho } from "@/lib/utils";
import { reservarVaga, confirmarMatricula, cancelarMatricula, transferir, entrarNaFila } from "@/lib/matriculas";
import { comMensagem } from "@/lib/redirecionar";

const back = (fd: FormData, fb: string) => str(fd, "voltar") || fb;
const go = (b: string, k: "ok" | "erro", msg: string, hash = "") => comMensagem(b, k, msg, hash);

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
    const texto = await textoImportacao(fd); if (!texto) throw new Error("Cole o conteúdo do CSV.");
    const linhas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const sep = detectarSeparador(linhas[0]);
    const head = linhas[0].split(sep).map(normalizarCabecalho); const idx = (k: string) => head.indexOf(k);
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
    const cfg = await getSettings(); assert(can.aprovar(s, "matricula"), "Prorrogar reserva exige a aprovação de confirmar matrículas (marcada no cargo).");
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
    // mantém as chaves que este formulário não mostra (versões novas acrescentam parâmetros ao mesmo grupo)
    const fim = fd.has("fimCampanha") ? str(fd, "fimCampanha") : String(cfg.matriculas.fimCampanha ?? "");
    const meta = fd.has("metaRematriculaPct") ? int(fd, "metaRematriculaPct") : Number(cfg.matriculas.metaRematriculaPct ?? 85);
    const novo = { ...cfg.matriculas, anoLetivo: int(fd, "anoLetivo") ?? cfg.matriculas.anoLetivo, reservaDias: int(fd, "reservaDias") ?? cfg.matriculas.reservaDias, ofertaFilaDias: int(fd, "ofertaFilaDias") ?? cfg.matriculas.ofertaFilaDias, fimCampanha: fim, metaRematriculaPct: meta ?? 85 };
    if (novo.reservaDias < 1 || novo.ofertaFilaDias < 1) throw new Error("Prazos precisam ser de ao menos 1 dia.");
    if (fim && !/^\d{4}-\d{2}-\d{2}$/.test(fim)) throw new Error("Data do fim da campanha inválida.");
    if (novo.metaRematriculaPct < 1 || novo.metaRematriculaPct > 100) throw new Error("A meta de rematrícula vai de 1% a 100%.");
    await sql`INSERT INTO settings (key, value) VALUES ('matriculas', ${JSON.stringify(novo)}::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`;
    await audit(s, "editar", "settings", null, cfg.matriculas, novo);
  } catch (e) { redirect(go("/configuracoes", "erro", e instanceof Error ? e.message : "Erro", "#matriculas")); }
  redirect(go("/configuracoes", "ok", "Parâmetros de matrícula salvos.", "#matriculas"));
}

/**
 * v24.1 · carga inicial e virada de ano: importa a grade de turmas por planilha. Cabeçalho: unidade; serie; turno; nome; vagas
 * (opcionais: modalidade — Regular/Integral —, series_grupo para o Integral, ano, situacao). Turma igual (ano, unidade, nome) é atualizada:
 * vagas, turno e situação — nunca abaixo do que já está ocupado.
 */
export async function importarTurmas(fd: FormData) {
  const s = await requireSession(); let resumo = "";
  try {
    assert(can.gradeTurmas(s), "Só RH e Direção alteram a grade de turmas.");
    const cfg = await getSettings(); const texto = await textoImportacao(fd); if (!texto) throw new Error("Envie a planilha ou cole o conteúdo.");
    const linhas = texto.split(/\r?\n/).map(l => l.replace(/\s+$/, "")).filter(l => l.trim()); const sep = detectarSeparador(linhas[0]);
    const head = linhas[0].split(sep).map(normalizarCabecalho); const idx = (k: string) => head.indexOf(k);
    if (["unidade", "turno", "nome", "vagas"].some(k => idx(k) < 0)) throw new Error("Cabeçalho precisa ter: unidade; serie; turno; nome; vagas (opcionais: modalidade, series_grupo, ano, situacao).");
    const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const units = await db.select().from(schema.units); const grades = await db.select().from(schema.grades);
    const TURNOS_TURMA = ["Matutino", "Vespertino", "Integral"]; let novas = 0, atualizadas = 0; const erros: string[] = [];
    for (const [i, l] of linhas.slice(1).entries()) {
      const c = l.split(sep).map(x => x.trim().replace(/^"(.*)"$/, "$1").trim()); const g = (k: string) => (idx(k) >= 0 ? c[idx(k)] ?? "" : "");
      try {
        const u = units.find(x => norm(x.nome) === norm(g("unidade")) || norm(x.codigo) === norm(g("unidade"))); if (!u) throw new Error(`unidade "${g("unidade")}" não encontrada`);
        const integral = /^integral$/i.test(norm(g("modalidade")));
        const serie = g("serie") ? grades.find(x => norm(x.nome) === norm(g("serie"))) ?? grades.find(x => norm(x.nome).startsWith(norm(g("serie")))) : undefined;
        if (!integral && !serie) throw new Error(g("serie") ? `série "${g("serie")}" não encontrada` : "turma Regular precisa da série");
        const tt = norm(g("turno")); const turno = TURNOS_TURMA.find(t => norm(t) === tt) ?? ({ manha: "Matutino", tarde: "Vespertino", matutino: "Matutino", vespertino: "Vespertino", integral: "Integral" } as Record<string, string>)[tt]; if (!turno) throw new Error(`turno "${g("turno")}" inválido (Matutino, Vespertino ou Integral)`);
        const vagas = Number(g("vagas")); if (!Number.isInteger(vagas) || vagas < 0) throw new Error(`vagas "${g("vagas")}" inválido`);
        const nome = g("nome"); if (!nome) throw new Error("nome da turma vazio");
        const ano = g("ano") ? Number(g("ano")) : cfg.matriculas.anoLetivo; if (!Number.isInteger(ano) || ano < 2000) throw new Error(`ano "${g("ano")}" inválido`);
        const status = /^fech/i.test(g("situacao")) ? "FECHADA" : "ABERTA";
        const [ja] = await sql<{ id: number }[]>`SELECT id FROM classes WHERE ano=${ano} AND unit_id=${u.id} AND lower(nome)=lower(${nome})`;
        if (ja) {
          const [{ ocup }] = await sql<{ ocup: number }[]>`SELECT count(*)::int AS ocup FROM enrollments WHERE class_id=${ja.id} AND (status='CONFIRMADA' OR (status='RESERVADA' AND reserva_ate >= ${hoje()}))`;
          if (vagas < ocup) throw new Error(`"${nome}" já tem ${ocup} vaga(s) ocupada(s)/reservada(s); não reduzo para ${vagas}`);
          await sql`UPDATE classes SET vagas=${vagas}, turno=${turno}, status=${status} WHERE id=${ja.id}`; atualizadas++;
        } else {
          await db.insert(schema.classes).values({ ano, unitId: u.id, modalidade: integral ? "INTEGRAL" : "REGULAR", gradeId: integral ? null : serie!.id, seriesTexto: integral ? (g("series_grupo") || g("serie") || null) : null, turno, nome, vagas, status }); novas++;
        }
      } catch (e) { erros.push(`Linha ${i + 2}: ${e instanceof Error ? e.message : e}`); }
    }
    await audit(s, "importar turmas", "classes", null, null, { novas, atualizadas, erros: erros.length });
    resumo = `${novas} turma(s) criada(s), ${atualizadas} atualizada(s).` + (erros.length ? ` ${erros.length} linha(s) com erro: ${erros.slice(0, 5).join(" · ")}${erros.length > 5 ? " …" : ""}` : "");
  } catch (e) { redirect(go("/matriculas/turmas", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go("/matriculas/turmas", "ok", resumo));
}

/** v24.1 · virada de ano: cria as turmas do ano de destino copiando a grade do ano de origem (mesmos nomes, séries, turnos e vagas). Turma que já existe no destino fica como está. */
export async function copiarTurmas(fd: FormData) {
  const s = await requireSession(); const de = int(fd, "de"); const para = int(fd, "para"); let msg = "";
  try {
    assert(can.gradeTurmas(s), "Só RH e Direção alteram a grade de turmas.");
    if (!de || !para || de === para) throw new Error("Escolha o ano de origem e um ano de destino diferente.");
    const origem = await sql<{ unit_id: number; modalidade: string; grade_id: number | null; series_texto: string | null; turno: string; nome: string; vagas: number }[]>`SELECT unit_id, modalidade, grade_id, series_texto, turno, nome, vagas FROM classes WHERE ano=${de} AND status='ABERTA'`;
    if (!origem.length) throw new Error(`Não há turmas abertas em ${de}.`);
    let criadas = 0, existiam = 0;
    for (const t of origem) {
      const [ja] = await sql<{ id: number }[]>`SELECT id FROM classes WHERE ano=${para} AND unit_id=${t.unit_id} AND lower(nome)=lower(${t.nome})`;
      if (ja) { existiam++; continue; }
      await db.insert(schema.classes).values({ ano: para, unitId: t.unit_id, modalidade: t.modalidade, gradeId: t.grade_id, seriesTexto: t.series_texto, turno: t.turno, nome: t.nome, vagas: t.vagas, status: "ABERTA" }); criadas++;
    }
    await audit(s, "copiar turmas", "classes", null, null, { de, para, criadas, existiam });
    msg = `${criadas} turma(s) de ${para} criada(s) a partir de ${de}` + (existiam ? `; ${existiam} já existia(m) e ficaram como estavam.` : ".");
  } catch (e) { redirect(go("/matriculas/turmas", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(`/matriculas/turmas?ano=${para}`, "ok", msg));
}
