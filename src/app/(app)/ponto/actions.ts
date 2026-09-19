"use server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireSession, can, assert, assertEmployeeAccess } from "@/lib/auth";
import { audit, str, strOrNull, int, hoje } from "@/lib/utils";
import { salvarDias, montarMes, mesLimites } from "@/lib/ponto";
import { lerPlanilhaPonto, type ArquivoLido } from "@/lib/ponto-import";

const go = (b: string, k: "ok" | "erro", msg: string) => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}`;
const podeLancar = (r: string) => ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"].includes(r);

async function emp(id: number) { const [e] = await db.select().from(schema.employees).where(eq(schema.employees.id, id)); if (!e) throw new Error("Colaborador não encontrado."); return e; }

// ---------- Folha mensal ----------
export async function salvarMes(fd: FormData) {
  const s = await requireSession(); const employeeId = Number(fd.get("employeeId")); const mes = str(fd, "mes"); const b = `/ponto/${employeeId}?mes=${mes}`; let msg = "";
  try {
    assert(podeLancar(s.role), "Seu perfil não lança ponto.");
    const e = await emp(employeeId); assertEmployeeAccess(s, e);
    const { dias: nd } = mesLimites(mes); const dias = [];
    for (let d = 1; d <= nd; d++) {
      const data = `${mes}-${String(d).padStart(2, "0")}`; const k = data.replace(/-/g, "");
      const status = str(fd, `s_${k}`); if (!status) continue;
      const trab = str(fd, `t_${k}`); const hm = trab.match(/^(\d+):(\d{1,2})$/);
      dias.push({ data, esperado: int(fd, `e_${k}`) ?? 0, trabalhado: hm ? Number(hm[1]) * 60 + Number(hm[2]) : Number(trab.replace(",", ".")) || 0, status, obs: strOrNull(fd, `o_${k}`), marcacoes: strOrNull(fd, `m_${k}`) });
    }
    const r = await salvarDias(s, employeeId, dias);
    await audit(s, "salvar folha de ponto", "timesheet_days", employeeId, null, { mes, dias: dias.length, lancamentos: r.gerados, saldoMes: r.saldo });
    msg = `Folha de ${mes.split("-").reverse().join("/")} salva: ${dias.length} dia(s), ${r.gerados} lançamento(s) no banco (${r.saldo >= 0 ? "+" : "−"}${Math.abs(r.saldo)} min)${r.aprovados ? "" : " aguardando aprovação"}.`;
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}

export async function gerarMesPadrao(fd: FormData) {
  // grava o mês inteiro com os valores calculados (jornada + calendário), sem editar dia a dia
  const s = await requireSession(); const employeeId = Number(fd.get("employeeId")); const mes = str(fd, "mes"); const b = `/ponto/${employeeId}?mes=${mes}`; let msg = "";
  try {
    assert(podeLancar(s.role), "Seu perfil não lança ponto.");
    const e = await emp(employeeId); assertEmployeeAccess(s, e);
    const { dias } = await montarMes(employeeId, mes);
    const r = await salvarDias(s, employeeId, dias.filter(d => !d.salvo).map(d => ({ data: d.data, esperado: d.esperado, trabalhado: d.trabalhado, status: d.status, origem: "AUTO" })));
    await audit(s, "gerar mês padrão", "timesheet_days", employeeId, null, { mes, gerados: r.gerados });
    msg = `Mês preenchido com a jornada e o calendário (${r.gerados} lançamento(s) gerado(s)). Ajuste só as exceções.`;
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}

// ---------- Jornadas ----------
export async function salvarJornada(fd: FormData) {
  const s = await requireSession(); const employeeId = Number(fd.get("employeeId")); const id = int(fd, "id"); const b = str(fd, "voltar") || `/ponto/jornadas?q=`;
  try {
    assert(can.editar(s) || s.role === "DIRETOR_UNIDADE", "Só RH, Direção e Diretor de unidade definem jornadas.");
    const e = await emp(employeeId); assertEmployeeAccess(s, e);
    const min = (k: string) => { const v = str(fd, k); const hm = v.match(/^(\d+):(\d{1,2})$/); return hm ? Number(hm[1]) * 60 + Number(hm[2]) : Math.round(Number(v.replace(",", ".")) || 0); };
    const d = { employeeId, vigenciaInicio: str(fd, "vigenciaInicio") || hoje(), vigenciaFim: strOrNull(fd, "vigenciaFim"), seg: min("seg"), ter: min("ter"), qua: min("qua"), qui: min("qui"), sex: min("sex"), sab: min("sab"), dom: min("dom"), horarios: strOrNull(fd, "horarios"), obs: strOrNull(fd, "obs") };
    if (d.vigenciaFim && d.vigenciaFim < d.vigenciaInicio) throw new Error("Vigência final anterior à inicial.");
    if (id) { const [antes] = await db.select().from(schema.schedules).where(eq(schema.schedules.id, id)); await db.update(schema.schedules).set(d).where(eq(schema.schedules.id, id)); await audit(s, "editar", "schedules", id, antes, d); }
    else {
      // encerra a jornada anterior aberta no dia anterior ao início da nova
      await sql`UPDATE schedules SET vigencia_fim = (${d.vigenciaInicio}::date - 1) WHERE employee_id=${employeeId} AND vigencia_fim IS NULL AND vigencia_inicio < ${d.vigenciaInicio}`;
      const [r] = await db.insert(schema.schedules).values(d).returning({ id: schema.schedules.id }); await audit(s, "criar", "schedules", r.id, null, d);
    }
    const semanal = d.seg + d.ter + d.qua + d.qui + d.sex + d.sab + d.dom;
    await db.update(schema.employees).set({ jornadaMinDia: Math.round(semanal / 5) }).where(eq(schema.employees.id, employeeId));
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Jornada salva."));
}

export async function excluirJornada(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const b = str(fd, "voltar") || "/ponto/jornadas";
  try { assert(can.editar(s)); const [antes] = await db.select().from(schema.schedules).where(eq(schema.schedules.id, id)); await db.delete(schema.schedules).where(eq(schema.schedules.id, id)); await audit(s, "excluir", "schedules", id, antes, null); }
  catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Jornada excluída."));
}

// ---------- Calendário ----------
export async function salvarDiaCalendario(fd: FormData) {
  const s = await requireSession();
  try {
    assert(can.configurar(s)); const ini = str(fd, "data"); const fim = str(fd, "dataFim") || ini; const tipo = str(fd, "tipo"); if (!ini || !tipo) throw new Error("Informe data e tipo.");
    const d = { descricao: strOrNull(fd, "descricao"), publico: str(fd, "publico") || "TODOS", unitId: int(fd, "unitId") };
    let n = 0; for (let cur = new Date(ini + "T00:00:00Z"); cur.toISOString().slice(0, 10) <= fim && n < 400; cur.setUTCDate(cur.getUTCDate() + 1)) {
      const data = cur.toISOString().slice(0, 10);
      await sql`DELETE FROM calendar_days WHERE data=${data} AND publico=${d.publico} AND coalesce(unit_id,0)=coalesce(${d.unitId}::int,0)`;
      await db.insert(schema.calendarDays).values({ data, tipo, ...d }); n++;
    }
    await audit(s, "criar", "calendar_days", null, null, { ini, fim, tipo, ...d, dias: n });
  } catch (e) { redirect(go("/ponto/calendario", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go("/ponto/calendario", "ok", "Calendário atualizado."));
}
export async function excluirDiaCalendario(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id"));
  try { assert(can.configurar(s)); const [antes] = await db.select().from(schema.calendarDays).where(eq(schema.calendarDays.id, id)); await db.delete(schema.calendarDays).where(eq(schema.calendarDays.id, id)); await audit(s, "excluir", "calendar_days", id, antes, null); }
  catch (e) { redirect(go("/ponto/calendario", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go("/ponto/calendario", "ok", "Dia removido."));
}

// ---------- Importação das planilhas (prévia → confirmação) ----------
export async function importarPlanilhas(fd: FormData) {
  const s = await requireSession(); let loteId = 0;
  try {
    assert(can.editar(s), "Só RH e Direção importam planilhas de ponto.");
    const ano = int(fd, "ano") ?? Number(hoje().slice(0, 4));
    const files = fd.getAll("arquivos").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) throw new Error("Selecione ao menos uma planilha .xlsx.");
    if (files.length > 40) throw new Error("Envie até 40 planilhas por vez.");
    const lidos: ArquivoLido[] = [];
    for (const f of files) {
      try { lidos.push(lerPlanilhaPonto(Buffer.from(await f.arrayBuffer()), f.name, ano)); }
      catch (e) { lidos.push({ arquivo: f.name, nomePlanilha: f.name, abas: [], dias: [], saldoCalculado: 0, saldoPlanilha: null, avisos: [`Não foi possível ler: ${e instanceof Error ? e.message : e}`], colunas: {} }); }
    }
    const [r] = await db.insert(schema.importBatches).values({ tipo: "PONTO_XLSX", userId: s.id, payload: { ano, arquivos: lidos } }).returning({ id: schema.importBatches.id });
    loteId = r.id;
  } catch (e) { redirect(go("/ponto/importar", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(`/ponto/importar?lote=${loteId}`);
}

export async function aplicarImportacao(fd: FormData) {
  const s = await requireSession(); const loteId = Number(fd.get("lote")); let msg = "";
  try {
    assert(can.editar(s));
    const [lote] = await db.select().from(schema.importBatches).where(eq(schema.importBatches.id, loteId));
    if (!lote || lote.status !== "PREVIA") throw new Error("Lote não encontrado ou já aplicado.");
    const payload = lote.payload as { ano: number; arquivos: ArquivoLido[] };
    let aplicados = 0, pulados = 0, diasTotal = 0;
    for (const [i, a] of payload.arquivos.entries()) {
      const employeeId = int(fd, `emp_${i}`); if (!employeeId || a.dias.length === 0) { pulados++; continue; }
      const dias = a.dias.map(d => ({ data: d.data, esperado: d.esperado, trabalhado: d.status === "NORMAL" || d.status === "RECESSO" ? d.esperado + d.diff : d.trabalhado, status: d.status, obs: d.obs, origem: "IMPORT" }));
      await salvarDias(s, employeeId, dias); aplicados++; diasTotal += dias.length;
    }
    await db.update(schema.importBatches).set({ status: "APLICADO" }).where(eq(schema.importBatches.id, loteId));
    await audit(s, "aplicar importação de ponto", "import_batches", loteId, null, { aplicados, pulados, dias: diasTotal });
    msg = `${aplicados} planilha(s) aplicada(s) (${diasTotal} dias), ${pulados} pulada(s).`;
  } catch (e) { redirect(go(`/ponto/importar?lote=${loteId}`, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go("/ponto", "ok", msg));
}

export async function descartarImportacao(fd: FormData) {
  const s = await requireSession(); const loteId = Number(fd.get("lote"));
  try { assert(can.editar(s)); await db.update(schema.importBatches).set({ status: "DESCARTADO" }).where(eq(schema.importBatches.id, loteId)); }
  catch (e) { redirect(go("/ponto/importar", "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go("/ponto/importar", "ok", "Lote descartado. Nada foi gravado."));
}

