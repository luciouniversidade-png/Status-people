"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit, type Session } from "@/lib/auth";
import { audit, str, strOrNull, int, hoje, addDays, fmtData, caminhoSeguro } from "@/lib/utils";
import { notificar, usuariosPorPerfil } from "@/lib/comunicacao";
import { turnoDe, sobrepoe } from "@/lib/cobertura";
import { versao, versaoVigente, copiarAulas, alvoEdicao, choqueProfessor, validarVersao, propostaCh, periodoTxt } from "@/lib/grade";
import { salvarDias } from "@/lib/ponto";

const go = (b: string, k: "ok" | "erro", msg: string) => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}`;
const COORD = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"];
const CH_PERFIS = ["RH", "DIRECAO", "DIRETOR_UNIDADE"];
type T = typeof sql;
function noEscopo(s: Session, unitId: number) { const u = scopeUnit(s); if (u !== null && u !== unitId) throw new Error("Sem acesso a esta unidade."); }
/** Meses entre duas datas (inclusive), como primeiro dia de cada um. */
function mesesEntre(de: string, ate: string) { const out: string[] = []; for (let m = de.slice(0, 7); m <= ate.slice(0, 7);) { out.push(`${m}-01`); const [y, mm] = m.split("-").map(Number); m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`; } return out; }
async function mesFechadoNaUnidade(unitId: number, de: string, ate: string) {
  const ms = mesesEntre(de, ate).map(d => d.slice(0, 7));
  const [l] = await sql<{ mes: string }[]>`SELECT mes FROM timesheet_locks WHERE unit_id=${unitId} AND status='FECHADO' AND mes = ANY(${ms}) ORDER BY mes LIMIT 1`; return l?.mes ?? null;
}

/** Nova vigência (rascunho): copia a grade em vigor na data de início (ou começa vazia) para montar a próxima sem mexer na atual. */
export async function novaVigencia(fd: FormData) {
  const s = await requireSession(); const unitId = int(fd, "unitId") ?? 0; let b = caminhoSeguro(str(fd, "voltar"), `/cobertura/grade?unidade=${unitId}`);
  try {
    assert(COORD.includes(s.role), "Só a coordenação e a direção montam a grade."); noEscopo(s, unitId);
    const nome = str(fd, "nome") || "Nova grade"; const inicio = str(fd, "inicio"); assert(/^\d{4}-\d{2}-\d{2}$/.test(inicio), "Informe a data de início da vigência.");
    const [r] = await sql<{ id: number }[]>`SELECT id FROM grade_versions WHERE unit_id=${unitId} AND status='RASCUNHO'`; assert(!r, "Já existe um rascunho nesta unidade: continue nele ou descarte-o.");
    const base = str(fd, "base"); // VIGENTE | VAZIA
    const id = await sql.begin(async tx => {
      const [n] = await tx<{ id: number }[]>`INSERT INTO grade_versions (unit_id, nome, vigencia_inicio, status, origem, criada_por, obs) VALUES (${unitId}, ${nome.slice(0, 120)}, ${inicio}, 'RASCUNHO', ${base === "VAZIA" ? "MANUAL" : "COPIA"}, ${s.id}, ${strOrNull(fd, "obs")}) RETURNING id`;
      if (base !== "VAZIA") { const v = (await versaoVigente(unitId, inicio, tx as unknown as T)) ?? (await versaoVigente(unitId, hoje(), tx as unknown as T)); if (v) { await tx`UPDATE grade_versions SET copiada_de=${v.id} WHERE id=${n.id}`; await copiarAulas(tx as unknown as T, v.id, n.id); } }
      return n.id;
    });
    await audit(s, "criar vigência da grade (rascunho)", "grade_versions", id, null, { unitId, nome, inicio, base });
    b = `/cobertura/grade?unidade=${unitId}&versao=${id}`;
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Rascunho criado: ajuste as aulas, confira as validações e ative."));
}

/** Ativa o rascunho: a vigência anterior termina na véspera; início no passado só com justificativa e com os meses do ponto abertos. */
export async function ativarVigencia(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "versaoId") ?? 0; let b = caminhoSeguro(str(fd, "voltar"), `/cobertura/grade?versao=${id}`);
  try {
    assert(COORD.includes(s.role), "Só a coordenação e a direção ativam a grade."); const v = await versao(id); assert(!!v, "Vigência não encontrada."); noEscopo(s, v!.unit_id);
    assert(v!.status === "RASCUNHO", "Só um rascunho é ativado."); b = `/cobertura/grade?unidade=${v!.unit_id}&versao=${id}`;
    const bloqueios = (await validarVersao(id)).filter(a => a.nivel === "BLOQUEIA"); assert(!bloqueios.length, `Corrija antes de ativar: ${bloqueios.slice(0, 3).map(x => x.texto).join(" · ")}`);
    const h = hoje(); const just = strOrNull(fd, "justificativa");
    if (v!.vigencia_inicio < h) {
      assert(!!just && just.length >= 15, `A vigência começa no passado (${fmtData(v!.vigencia_inicio)}): justifique (mínimo 15 caracteres) — retroativo só com justificativa.`);
      const f = await mesFechadoNaUnidade(v!.unit_id, v!.vigencia_inicio, h); assert(!f, `O ponto de ${f?.split("-").reverse().join("/")} está fechado na unidade: meses fechados permanecem intactos. Comece a vigência depois do último mês fechado.`);
    }
    const [depois] = await sql<{ nome: string; vigencia_inicio: string }[]>`SELECT nome, vigencia_inicio::text FROM grade_versions WHERE unit_id=${v!.unit_id} AND status='ATIVA' AND vigencia_inicio >= ${v!.vigencia_inicio} ORDER BY vigencia_inicio LIMIT 1`;
    assert(!depois, `Já existe a vigência “${depois?.nome}” a partir de ${fmtData(depois?.vigencia_inicio ?? null)}: escolha uma data de início anterior a ela.`);
    const anteriores = await sql.begin(async tx => {
      const ant = await tx<{ id: number; nome: string; vigencia_fim: string | null }[]>`SELECT id, nome, vigencia_fim::text FROM grade_versions WHERE unit_id=${v!.unit_id} AND status='ATIVA' AND vigencia_inicio < ${v!.vigencia_inicio} AND (vigencia_fim IS NULL OR vigencia_fim >= ${v!.vigencia_inicio})`;
      await tx`UPDATE grade_versions SET vigencia_fim=${addDays(v!.vigencia_inicio, -1)} WHERE id = ANY(${ant.map(a => a.id)})`;
      await tx`UPDATE grade_versions SET status='ATIVA', ativada_por=${s.id}, ativada_em=now(), justificativa=${just} WHERE id=${id}`;
      return ant;
    });
    await audit(s, "ativar vigência da grade", "grade_versions", id, { anteriores: anteriores.map(a => ({ id: a.id, nome: a.nome, fimAntes: a.vigencia_fim })) }, { inicio: v!.vigencia_inicio, encerradasEm: addDays(v!.vigencia_inicio, -1), retroativa: v!.vigencia_inicio < h, justificativa: just });
    const [un] = await sql<{ nome: string }[]>`SELECT nome FROM units WHERE id=${v!.unit_id}`;
    const rh = await usuariosPorPerfil(["RH"], null); await notificar(rh, `Grade nova em ${un?.nome ?? "unidade"}`, `Vigência ${periodoTxt(v!)}: confira e aplique a CH dos professores.`, `/cobertura/grade/ch?versao=${id}`, "ACAO");
    b = `/cobertura/grade/ch?versao=${id}`;
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Vigência ativada: a anterior termina na véspera. Confira a CH proposta e aplique a quem for o caso."));
}

export async function descartarVigencia(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "versaoId") ?? 0; let b = "/cobertura/grade";
  try {
    assert(COORD.includes(s.role)); const v = await versao(id); assert(!!v && v.status === "RASCUNHO", "Só um rascunho é descartado."); noEscopo(s, v!.unit_id); b = `/cobertura/grade?unidade=${v!.unit_id}`;
    await sql.begin(async tx => { await tx`DELETE FROM teacher_slots WHERE version_id=${id}`; await tx`UPDATE grade_versions SET status='DESCARTADA', descartada_em=now() WHERE id=${id}`; });
    await audit(s, "descartar rascunho da grade", "grade_versions", id, { nome: v!.nome }, null);
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Rascunho descartado."));
}

type Lote = { destino: string; dataNova: string | null; rascunhoId: number | null; substituir: boolean; nomeNova: string | null; linhas: { nome: string; unitId: number; dia: number; inicio: string; fim: string; turma: string; disciplina: string | null; spaceId: number | null; linha: number }[]; nomes: { chave: string; nome: string; aulas: number; sugerido: number | null; candidatos: { id: number }[] }[] };
/** Etapa 2 da importação: de-para confirmado nome a nome (ou "ignorar"), validação de choques e gravação no destino. */
export async function confirmarImportacaoGrade(fd: FormData) {
  const s = await requireSession(); const bid = int(fd, "batchId") ?? 0; let b = `/cobertura/grade/importar/${bid}`; let msg = "";
  try {
    assert(COORD.includes(s.role), "Só a coordenação e a direção importam a grade.");
    const [bt] = await sql<{ id: number; payload: Lote; status: string; user_id: number }[]>`SELECT id, payload, status, user_id FROM import_batches WHERE id=${bid} AND tipo='GRADE'`; assert(!!bt, "Importação não encontrada."); assert(bt.status === "PREVIA", "Esta importação já foi aplicada ou descartada.");
    const p = bt.payload; const escopo = scopeUnit(s); assert(p.linhas.every(l => escopo === null || l.unitId === escopo), "Unidade fora do seu escopo.");
    const depara = new Map<string, number>(); const faltam: string[] = [];
    for (const [i, n] of p.nomes.entries()) { const e = int(fd, `dp_${i}`) ?? -1; if (e === 0) continue; if (e < 0 || str(fd, `ok_${i}`) !== "1") { faltam.push(n.nome); continue; } depara.set(n.chave, e); }
    assert(!faltam.length, `Confirme o de-para (ou marque “ignorar”) de: ${faltam.slice(0, 5).join(", ")}${faltam.length > 5 ? "…" : ""}.`);
    const norm = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    const emps = new Map((await sql<{ id: number; situacao: string }[]>`SELECT id, situacao FROM employees WHERE id = ANY(${[...depara.values()]})`).map(e => [e.id, e]));
    for (const id of depara.values()) assert(emps.has(id) && emps.get(id)!.situacao !== "DESLIGADO", "Colaborador do de-para não encontrado ou desligado.");
    const aulas = p.linhas.filter(l => depara.has(norm(l.nome))).map(l => ({ ...l, employeeId: depara.get(norm(l.nome))! }));
    assert(aulas.length > 0, "Nenhuma aula para importar (todos os nomes ignorados).");
    for (const [k, a] of aulas.entries()) { const c = aulas.slice(0, k).find(x => x.employeeId === a.employeeId && x.dia === a.dia && sobrepoe(x.inicio, x.fim, a.inicio, a.fim)); assert(!c, `Linha ${a.linha}: choque de horário com a linha ${c?.linha} (o mesmo professor no de-para).`); }
    const unidades = [...new Set(aulas.map(a => a.unitId))];
    const r = await sql.begin(async tx => {
      const TX = tx as unknown as T; let n = 0; let ajuste: string | null = null; const versoes: number[] = [];
      for (const u of unidades) {
        let vid: number;
        if (p.destino === "RASCUNHO") { const v = await versao(p.rascunhoId ?? 0, TX); if (!v || v.status !== "RASCUNHO" || v.unit_id !== u) throw new Error("O rascunho escolhido não é desta unidade (importe um arquivo de cada unidade)."); vid = v.id; }
        else if (p.destino === "NOVA") {
          const [ja] = await tx<{ id: number }[]>`SELECT id FROM grade_versions WHERE unit_id=${u} AND status='RASCUNHO'`; if (ja) throw new Error("Já existe um rascunho nesta unidade: importe nele (destino “rascunho”) ou descarte-o.");
          const [nv] = await tx<{ id: number }[]>`INSERT INTO grade_versions (unit_id, nome, vigencia_inicio, status, origem, criada_por, obs) VALUES (${u}, ${(p.nomeNova || `Grade importada em ${fmtData(hoje())}`).slice(0, 120)}, ${p.dataNova}, 'RASCUNHO', 'IMPORTACAO', ${s.id}, 'De-para confirmado na importação') RETURNING id`; vid = nv.id;
          if (!p.substituir) { const base = (await versaoVigente(u, p.dataNova ?? hoje(), TX)) ?? (await versaoVigente(u, hoje(), TX)); if (base) { await tx`UPDATE grade_versions SET copiada_de=${base.id} WHERE id=${vid}`; await copiarAulas(TX, base.id, vid); } }
        } else {
          const alvo = await alvoEdicao(TX, u, s.id, { versaoId: null, mudaCh: true }); vid = alvo.versao.id; if (alvo.ajuste) ajuste = alvo.versao.nome;
          if (p.substituir) { await tx`UPDATE teacher_slots SET ativo=false WHERE version_id=${vid} AND ativo AND EXISTS (SELECT 1 FROM cover_assignments ca WHERE ca.slot_id=teacher_slots.id)`; await tx`DELETE FROM teacher_slots WHERE version_id=${vid} AND NOT EXISTS (SELECT 1 FROM cover_assignments ca WHERE ca.slot_id=teacher_slots.id)`; }
        }
        const v = (await versao(vid, TX))!; versoes.push(vid);
        for (const a of aulas.filter(x => x.unitId === u)) {
          const c = await choqueProfessor(TX, v, { employeeId: a.employeeId, dia: a.dia, inicio: a.inicio, fim: a.fim });
          if (c) throw new Error(`Linha ${a.linha}: choque com a aula já cadastrada de ${c.turma} (${c.inicio}–${c.fim}). Use "substituir a grade" ou corrija.`);
          await tx`INSERT INTO teacher_slots (employee_id, unit_id, dia_semana, inicio, fim, turno, turma, disciplina, space_id, version_id) VALUES (${a.employeeId}, ${u}, ${a.dia}, ${a.inicio}, ${a.fim}, ${turnoDe(a.inicio)}, ${a.turma}, ${a.disciplina}, ${a.spaceId}, ${vid})`; n++;
        }
      }
      await tx`UPDATE import_batches SET status='APLICADA', payload = payload || ${JSON.stringify({ depara: Object.fromEntries(depara), confirmadoPor: s.id })}::jsonb WHERE id=${bid}`;
      return { n, ajuste, versoes };
    });
    await audit(s, "importar grade horária", "teacher_slots", null, null, { aulas: r.n, destino: p.destino, substituir: p.substituir, unidades, deparaConfirmado: depara.size, ignorados: p.nomes.length - depara.size });
    msg = `${r.n} aula(s) importada(s)${p.substituir ? " (grade anterior das unidades substituída)" : ""}${r.ajuste ? ` — valem a partir de hoje (vigência “${r.ajuste}”)` : ""}.`;
    b = p.destino === "VIGENTE" ? `/cobertura/grade${unidades.length === 1 ? `?unidade=${unidades[0]}` : ""}` : `/cobertura/grade?unidade=${unidades[0]}&versao=${r.versoes[0]}`;
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}
export async function descartarImportacaoGrade(fd: FormData) {
  const s = await requireSession(); const bid = int(fd, "batchId") ?? 0;
  try { assert(COORD.includes(s.role)); await sql`UPDATE import_batches SET status='DESCARTADA' WHERE id=${bid} AND tipo='GRADE' AND status='PREVIA'`; await audit(s, "descartar importação da grade", "import_batches", bid, null, null); }
  catch (e) { redirect(go("/cobertura/grade", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go("/cobertura/grade", "ok", "Importação descartada — nada foi gravado."));
}

/**
 * Aplica a CH da grade às jornadas, a partir do início da vigência (CRQ-TMP-V3-01): só para quem o RH marcar (grade informa carga de AULAS,
 * não de contrato), nunca em mês fechado. A jornada anterior termina na véspera; a nova leva os horários da grade.
 */
export async function aplicarChGrade(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "versaoId") ?? 0; const b = `/cobertura/grade/ch?versao=${id}`; let msg = "";
  try {
    assert(CH_PERFIS.includes(s.role), "A CH é aplicada pelo RH, pela Direção ou pelo diretor(a) da unidade.");
    const v = await versao(id); assert(!!v && v.status === "ATIVA", "Só vigência ativa tem CH aplicada."); noEscopo(s, v!.unit_id);
    const h = hoje(); assert(!v!.vigencia_fim || v!.vigencia_fim >= h, "Vigência encerrada: a CH do que passou não muda.");
    const marcados = new Set(fd.getAll("emp").map(Number).filter(n => n > 0)); assert(marcados.size > 0, "Marque quem recebe a CH da grade.");
    const prop = (await propostaCh(id)).filter(p => marcados.has(p.employeeId));
    const fechado = v!.vigencia_inicio < h ? await mesFechadoNaUnidade(v!.unit_id, v!.vigencia_inicio, h) : null;
    assert(!fechado, `O ponto de ${fechado?.split("-").reverse().join("/")} está fechado: a CH não muda em mês fechado. Reabra o mês com justificativa ou aplique numa vigência posterior.`);
    let n = 0;
    for (const p of prop) {
      const ini = v!.vigencia_inicio; const semanal = p.ch.total;
      await sql.begin(async tx => {
        const [mesmo] = await tx<{ id: number; seg: number; ter: number; qua: number; qui: number; sex: number; sab: number }[]>`SELECT id, seg, ter, qua, qui, sex, sab FROM schedules WHERE employee_id=${p.employeeId} AND vigencia_inicio=${ini}`;
        const [prox] = await tx<{ vigencia_inicio: string }[]>`SELECT vigencia_inicio::text FROM schedules WHERE employee_id=${p.employeeId} AND vigencia_inicio > ${ini} ORDER BY vigencia_inicio LIMIT 1`;
        const obs = `Grade: ${v!.nome} (${periodoTxt(v!)})`;
        if (mesmo) await tx`UPDATE schedules SET seg=${p.ch.seg}, ter=${p.ch.ter}, qua=${p.ch.qua}, qui=${p.ch.qui}, sex=${p.ch.sex}, sab=${p.ch.sab}, dom=0, horarios=${p.ch.horarios}, obs=${obs} WHERE id=${mesmo.id}`;
        else {
          await tx`UPDATE schedules SET vigencia_fim=${addDays(ini, -1)} WHERE employee_id=${p.employeeId} AND vigencia_inicio < ${ini} AND (vigencia_fim IS NULL OR vigencia_fim >= ${ini})`;
          await tx`INSERT INTO schedules (employee_id, vigencia_inicio, vigencia_fim, seg, ter, qua, qui, sex, sab, dom, horarios, obs) VALUES (${p.employeeId}, ${ini}, ${prox ? addDays(prox.vigencia_inicio, -1) : null}, ${p.ch.seg}, ${p.ch.ter}, ${p.ch.qua}, ${p.ch.qui}, ${p.ch.sex}, ${p.ch.sab}, 0, ${p.ch.horarios}, ${obs})`;
        }
        await tx`UPDATE employees SET jornada_min_dia=${Math.round(semanal / 5)} WHERE id=${p.employeeId}`;
      });
      await audit(s, "aplicar CH da grade", "schedules", p.employeeId, p.jornada ? { seg: p.jornada.seg, ter: p.jornada.ter, qua: p.jornada.qua, qui: p.jornada.qui, sex: p.jornada.sex, sab: p.jornada.sab, desde: p.jornada.vigencia_inicio } : null, { seg: p.ch.seg, ter: p.ch.ter, qua: p.ch.qua, qui: p.ch.qui, sex: p.ch.sex, sab: p.ch.sab, desde: ini, versao: id });
      n++;
    }
    await sql`UPDATE grade_versions SET ch_aplicada_em=now(), ch_aplicada_por=${s.id} WHERE id=${id}`;
    msg = `CH da grade aplicada a ${n} professor(es) a partir de ${fmtData(v!.vigencia_inicio)}. Meses anteriores ficam como estavam.`;
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}

/** Recalcula a CH dos dias JÁ lançados desde o início da vigência (só meses abertos), regenerando o banco de horas desses dias. */
export async function recalcularDiasGrade(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "versaoId") ?? 0; const b = `/cobertura/grade/ch?versao=${id}`; let msg = "";
  try {
    assert(CH_PERFIS.includes(s.role), "O recálculo é do RH, da Direção ou do diretor(a) da unidade.");
    const v = await versao(id); assert(!!v && v.status === "ATIVA", "Vigência não encontrada."); noEscopo(s, v!.unit_id);
    const prop = await propostaCh(id); const ate = v!.vigencia_fim && v!.vigencia_fim < hoje() ? v!.vigencia_fim : hoje();
    const DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const; let dias = 0, profs = 0, fechados = 0;
    for (const p of prop) {
      const derivada = p.jornada?.obs?.startsWith(`Grade: ${v!.nome}`) || (await sql`SELECT 1 FROM schedules WHERE employee_id=${p.employeeId} AND vigencia_inicio=${v!.vigencia_inicio} AND obs LIKE 'Grade:%'`).length > 0;
      if (!derivada) continue; // só quem recebeu a CH desta vigência
      const ds = await sql<{ data: string; esperado_min: number; trabalhado_min: number; status: string; obs: string | null; marcacoes: string | null; origem: string }[]>`SELECT data::text, esperado_min, trabalhado_min, status, obs, marcacoes, origem FROM timesheet_days WHERE employee_id=${p.employeeId} AND data BETWEEN ${v!.vigencia_inicio} AND ${ate} AND status IN ('NORMAL','FALTA','FOLGA_BANCO','RECESSO') ORDER BY data`;
      const mudar = ds.map(d => ({ ...d, novo: p.ch[DOW[new Date(d.data + "T12:00:00Z").getUTCDay()]] })).filter(d => d.novo !== d.esperado_min);
      const porMes = new Map<string, typeof mudar>(); for (const d of mudar) porMes.set(d.data.slice(0, 7), [...(porMes.get(d.data.slice(0, 7)) ?? []), d]);
      let mexeu = false;
      for (const [, lista] of porMes) {
        try { await salvarDias(s, p.employeeId, lista.map(d => ({ data: d.data, esperado: d.novo, trabalhado: d.trabalhado_min, status: d.status, obs: d.obs, marcacoes: d.marcacoes, origem: d.origem }))); dias += lista.length; mexeu = true; }
        catch { fechados += lista.length; }
      }
      if (mexeu) profs++;
    }
    await audit(s, "recalcular CH dos dias lançados pela grade", "grade_versions", id, null, { dias, professores: profs, emMesFechado: fechados });
    msg = `${dias} dia(s) recalculado(s) em ${profs} professor(es)${fechados ? `; ${fechados} dia(s) em mês fechado ficaram intactos` : ""}.`;
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}
