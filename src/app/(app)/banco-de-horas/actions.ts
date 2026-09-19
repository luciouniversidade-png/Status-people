"use server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireSession, can, assert, assertScope, assertEmployeeAccess } from "@/lib/auth";
import { audit, str, strOrNull, int, getSettings, hoje } from "@/lib/utils";

const voltar = (fd: FormData, fallback: string) => str(fd, "voltar") || fallback;
const go = (back: string, k: "ok" | "erro", msg: string) => `${back}${back.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}#banco`;

export async function lancarHoras(fd: FormData) {
  const s = await requireSession(); const back = voltar(fd, "/banco-de-horas");
  try {
    assert(can.solicitar(s));
    const employeeId = int(fd, "employeeId"); const data = str(fd, "data"); const tipo = str(fd, "tipo");
    const horas = int(fd, "horas") ?? 0; const min = int(fd, "minutos") ?? 0;
    if (!employeeId || !data || !tipo) throw new Error("Preencha colaborador, data e tipo.");
    let minutos = horas * 60 + min;
    if (minutos <= 0) throw new Error("Informe a quantidade de horas/minutos.");
    if (tipo === "ATRASO" || tipo === "FALTA" || tipo === "COMPENSACAO") minutos = -minutos;
    if (tipo === "AJUSTE" && str(fd, "sinal") === "-") minutos = -minutos;
    const [e] = await db.select().from(schema.employees).where(eq(schema.employees.id, employeeId));
    if (!e) throw new Error("Colaborador não encontrado.");
    assertEmployeeAccess(s, e);
    const cfg = await getSettings();
    const autoAprova = can.aprovar(s, cfg.alcadas.banco);
    const [r] = await db.insert(schema.hourEntries).values({ employeeId, data, tipo, minutos, descricao: strOrNull(fd, "descricao"), lancadoPor: s.id, status: autoAprova ? "APROVADO" : "PENDENTE", aprovadoPor: autoAprova ? s.id : null }).returning({ id: schema.hourEntries.id });
    await audit(s, autoAprova ? "lançar (aprovado)" : "lançar (pendente)", "hour_entries", r.id, null, { employeeId, data, tipo, minutos });
  } catch (e) { redirect(go(back, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(back, "ok", "Lançamento registrado."));
}

export async function decidirHoras(fd: FormData) {
  const s = await requireSession(); const back = voltar(fd, "/banco-de-horas"); const id = Number(fd.get("id")); const decisao = str(fd, "decisao");
  try {
    const cfg = await getSettings();
    assert(can.aprovar(s, cfg.alcadas.banco), "Seu perfil não aprova lançamentos do banco de horas.");
    const [r] = await db.select().from(schema.hourEntries).where(eq(schema.hourEntries.id, id));
    if (!r) throw new Error("Lançamento não encontrado.");
    const [e] = await db.select().from(schema.employees).where(eq(schema.employees.id, r.employeeId));
    if (e) assertScope(s, e.unitId);
    assert(r.status === "PENDENTE", "Lançamento já decidido.");
    await db.update(schema.hourEntries).set({ status: decisao, aprovadoPor: s.id }).where(eq(schema.hourEntries.id, id));
    await audit(s, decisao === "APROVADO" ? "aprovar" : "rejeitar", "hour_entries", id, { status: r.status }, { status: decisao });
  } catch (e) { redirect(go(back, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(back, "ok", decisao === "APROVADO" ? "Lançamento aprovado." : "Lançamento rejeitado."));
}

export async function excluirHoras(fd: FormData) {
  const s = await requireSession(); const back = voltar(fd, "/banco-de-horas"); const id = Number(fd.get("id"));
  try {
    assert(can.editar(s));
    const [r] = await db.select().from(schema.hourEntries).where(eq(schema.hourEntries.id, id));
    if (!r) throw new Error("Lançamento não encontrado.");
    await db.delete(schema.hourEntries).where(eq(schema.hourEntries.id, id));
    await audit(s, "excluir", "hour_entries", id, r, null);
  } catch (e) { redirect(go(back, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(back, "ok", "Lançamento excluído."));
}

// ---- Importação de saldos (CSV colado): nome;saldo[;data][;unidade]  — saldo em minutos (-4215) ou hh:mm com sinal (-70:15)
export async function importarSaldos(fd: FormData) {
  const s = await requireSession(); let resumo = "";
  try {
    assert(can.editar(s));
    const texto = str(fd, "csv"); if (!texto) throw new Error("Cole o conteúdo do CSV.");
    const dataPadrao = str(fd, "data") || hoje();
    const linhas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const sep = linhas[0].includes(";") ? ";" : linhas[0].includes("\t") ? "\t" : ",";
    const head = linhas[0].split(sep).map(h => h.trim().toLowerCase());
    const idx = (k: string) => head.indexOf(k);
    if (idx("nome") < 0 || idx("saldo") < 0) throw new Error("Cabeçalho precisa ter: nome; saldo (e opcionalmente data; unidade).");
    const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
    const ativos = await sql<{ id: number; nome: string; unidade: string; codigo: string }[]>`SELECT e.id, e.nome, u.nome AS unidade, u.codigo FROM employees e JOIN units u ON u.id=e.unit_id WHERE e.situacao <> 'DESLIGADO'`;
    const parseSaldo = (v: string) => {
      const t = v.replace(/\s/g, "").replace("−", "-");
      const m = t.match(/^([+-]?)(\d+):(\d{1,2})$/); if (m) return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
      const n = Number(t.replace(",", ".")); if (Number.isFinite(n)) return Math.round(n);
      throw new Error(`saldo "${v}" inválido (use minutos, ex.: -4215, ou hh:mm, ex.: -70:15)`);
    };
    let ok = 0, pulados = 0; const erros: string[] = [];
    for (const [i, l] of linhas.slice(1).entries()) {
      const c = l.split(sep).map(x => x.trim()); const g = (k: string) => (idx(k) >= 0 ? c[idx(k)] ?? "" : "");
      try {
        let cands = ativos.filter(a => norm(a.nome) === norm(g("nome")));
        if (cands.length === 0) cands = ativos.filter(a => norm(a.nome).startsWith(norm(g("nome"))));
        if (g("unidade")) cands = cands.filter(a => norm(a.unidade) === norm(g("unidade")) || norm(a.codigo) === norm(g("unidade")));
        if (cands.length === 0) throw new Error(`"${g("nome")}" não encontrado`);
        if (cands.length > 1) throw new Error(`"${g("nome")}" é ambíguo (${cands.map(x => `${x.nome} · ${x.unidade}`).join(" / ")}) — informe a coluna unidade`);
        const minutos = parseSaldo(g("saldo"));
        const data = g("data") ? (g("data").includes("/") ? g("data").split("/").reverse().join("-") : g("data")) : dataPadrao;
        const [ja] = await sql<{ id: number }[]>`SELECT id FROM hour_entries WHERE employee_id=${cands[0].id} AND tipo='AJUSTE' AND data=${data} AND descricao='Saldo importado da planilha'`;
        if (ja) { pulados++; continue; }
        if (minutos === 0) { pulados++; continue; }
        await db.insert(schema.hourEntries).values({ employeeId: cands[0].id, data, tipo: "AJUSTE", minutos, descricao: "Saldo importado da planilha", status: "APROVADO", lancadoPor: s.id, aprovadoPor: s.id });
        ok++;
      } catch (e) { erros.push(`Linha ${i + 2}: ${e instanceof Error ? e.message : e}`); }
    }
    await audit(s, "importar saldos", "hour_entries", null, null, { importados: ok, pulados, erros: erros.length });
    resumo = `${ok} saldo(s) importado(s), ${pulados} pulado(s) (zero ou já importado).` + (erros.length ? ` ${erros.length} linha(s) com erro: ${erros.slice(0, 6).join(" · ")}${erros.length > 6 ? " …" : ""}` : "");
  } catch (e) { redirect(`/banco-de-horas/importar?erro=${encodeURIComponent(e instanceof Error ? e.message : "Erro")}`); }
  redirect(`/banco-de-horas?ok=${encodeURIComponent(resumo)}`);
}
