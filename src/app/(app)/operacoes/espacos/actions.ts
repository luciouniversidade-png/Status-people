"use server";
import { redirect } from "next/navigation";
import { randomBytes } from "crypto";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit, can, type Session } from "@/lib/auth";
import { audit, str, strOrNull, int, num, hoje, addDays, fmtData, caminhoSeguro } from "@/lib/utils";
import { TIPO_ESPACO, choqueEspaco } from "@/lib/espacos";
import { minutos } from "@/lib/cobertura";

const go = (b: string, k: "ok" | "erro", msg: string) => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}`;
const back = (fd: FormData, fb: string) => caminhoSeguro(str(fd, "voltar"), fb);
/** Quem cuida dos espaços: operações e gestão (com escopo da unidade). */
const cuida = (s: Session) => can.operacoes(s);
const naUnidade = (s: Session, unitId: number) => { const u = scopeUnit(s); if (u !== null && u !== unitId) throw new Error("Sem acesso a esta unidade."); };

export async function salvarEspaco(fd: FormData) {
  const s = await requireSession(); const b = back(fd, "/operacoes/espacos/cadastro");
  try {
    assert(cuida(s), "Só operações e gestão cadastram espaços.");
    const id = int(fd, "id"); const unitId = int(fd, "unitId") ?? 0; naUnidade(s, unitId);
    const [u] = await sql`SELECT 1 FROM units WHERE id=${unitId}`; if (!u) throw new Error("Escolha a unidade.");
    const nome = str(fd, "nome"); const tipo = str(fd, "tipo"); if (!nome) throw new Error("Informe o nome do espaço."); if (!TIPO_ESPACO[tipo]) throw new Error("Tipo inválido.");
    const cap = int(fd, "capacidade"); const area = num(fd, "areaM2");
    if (cap !== null && (Number.isNaN(cap) || cap < 1 || cap > 2000)) throw new Error("Capacidade: número entre 1 e 2000.");
    if (area !== null && (Number.isNaN(area) || area <= 0 || area > 100000)) throw new Error("Área inválida.");
    const [dup] = await sql<{ id: number }[]>`SELECT id FROM spaces WHERE unit_id=${unitId} AND lower(nome)=lower(${nome}) ${id ? sql`AND id <> ${id}` : sql``}`; if (dup) throw new Error("Já existe um espaço com este nome na unidade.");
    const d = { unitId, nome, tipo, capacidade: cap, area: area === null ? null : String(area), reservavel: str(fd, "reservavel") === "1", ativo: str(fd, "ativo") !== "0", obs: strOrNull(fd, "obs") };
    if (id) {
      const [old] = await sql<{ unit_id: number }[]>`SELECT unit_id FROM spaces WHERE id=${id}`; if (!old) throw new Error("Espaço não encontrado."); naUnidade(s, old.unit_id);
      if (old.unit_id !== unitId) { const [uso] = await sql`SELECT 1 FROM classes WHERE space_id=${id} UNION ALL SELECT 1 FROM teacher_slots WHERE space_id=${id} AND ativo LIMIT 1`; if (uso) throw new Error("Espaço em uso por turmas ou aulas: não muda de unidade."); }
      await sql`UPDATE spaces SET unit_id=${unitId}, nome=${nome}, tipo=${tipo}, capacidade=${cap}, area_m2=${d.area}, reservavel=${d.reservavel}, ativo=${d.ativo}, obs=${d.obs} WHERE id=${id}`;
    } else await sql`INSERT INTO spaces (unit_id, nome, tipo, capacidade, area_m2, reservavel, ativo, obs) VALUES (${unitId}, ${nome}, ${tipo}, ${cap}, ${d.area}, ${d.reservavel}, ${d.ativo}, ${d.obs})`;
    await audit(s, id ? "editar espaço" : "cadastrar espaço", "spaces", id, null, d);
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", "Espaço salvo."));
}

/** Liga a turma do ano a uma sala, sem deixar duas turmas na mesma sala e turno. */
export async function atribuirSala(fd: FormData) {
  const s = await requireSession(); const b = back(fd, "/operacoes/espacos"); let msg = "";
  try {
    assert(cuida(s) || can.gradeTurmas(s), "Sem permissão para distribuir salas.");
    const [c] = await sql<{ id: number; nome: string; unit_id: number; turno: string; ano: number; space_id: number | null }[]>`SELECT id, nome, unit_id, turno, ano, space_id FROM classes WHERE id=${int(fd, "classId") ?? 0}`; if (!c) throw new Error("Turma não encontrada."); naUnidade(s, c.unit_id);
    const spaceId = int(fd, "spaceId");
    if (spaceId) {
      const [sp] = await sql<{ unit_id: number; nome: string; ativo: boolean; tipo: string }[]>`SELECT unit_id, nome, ativo, tipo FROM spaces WHERE id=${spaceId}`;
      if (!sp || sp.unit_id !== c.unit_id) throw new Error("A sala precisa ser da mesma unidade da turma."); if (!sp.ativo) throw new Error("Sala inativa."); if (sp.tipo === "EQUIPAMENTO") throw new Error("Equipamento não é sala.");
      const [ocup] = await sql<{ nome: string }[]>`SELECT nome FROM classes WHERE space_id=${spaceId} AND ano=${c.ano} AND turno=${c.turno} AND id <> ${c.id}`;
      if (ocup) throw new Error(`${sp.nome} já está com a turma ${ocup.nome} no turno ${c.turno.toLowerCase()}.`);
      msg = `${c.nome} → ${sp.nome}.`;
    } else msg = `${c.nome} sem sala.`;
    await sql`UPDATE classes SET space_id=${spaceId} WHERE id=${c.id}`; await audit(s, "atribuir sala", "classes", c.id, { space_id: c.space_id }, { space_id: spaceId });
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}

/** Reserva (opcionalmente semanal) sem conflito com outras reservas nem com as aulas fixas da grade. Tudo ou nada; trava por espaço contra reservas simultâneas. */
export async function reservarEspaco(fd: FormData) {
  const s = await requireSession(); const b = back(fd, "/operacoes/espacos/reservas"); let msg = "";
  try {
    assert(s.role !== "LEITURA", "Perfil somente leitura não reserva.");
    const [sp] = await sql<{ id: number; unit_id: number; nome: string; ativo: boolean; reservavel: boolean }[]>`SELECT id, unit_id, nome, ativo, reservavel FROM spaces WHERE id=${int(fd, "spaceId") ?? 0}`;
    if (!sp) throw new Error("Escolha o espaço."); naUnidade(s, sp.unit_id); if (!sp.ativo || !sp.reservavel) throw new Error(`${sp.nome} não está disponível para reservas.`);
    const data = str(fd, "data"); const inicio = str(fd, "inicio"); const fim = str(fd, "fim"); const titulo = str(fd, "titulo");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error("Informe a data."); if (data < hoje()) throw new Error("Não dá para reservar no passado.");
    if (minutos(inicio) === null || minutos(fim) === null || (minutos(fim) ?? 0) <= (minutos(inicio) ?? 0)) throw new Error("Horário inválido: HH:MM, com o fim depois do início.");
    if (!titulo) throw new Error("Diga para que é a reserva.");
    const semanas = int(fd, "repetirSemanas") ?? 0; if (Number.isNaN(semanas) || semanas < 0 || semanas > 20) throw new Error("Repetição: de 0 a 20 semanas.");
    const datas = Array.from({ length: semanas + 1 }, (_, k) => addDays(data, 7 * k)); const grupo = semanas ? randomBytes(6).toString("hex") : null;
    await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(91000000 + ${sp.id})`;
      const choques: string[] = [];
      // conferência na própria conexão da transação (com a trava, ninguém grava neste espaço até o fim)
      for (const d of datas) { const c = await choqueEspaco(sp.id, d, inicio, fim, undefined, tx as unknown as typeof sql); if (c) choques.push(`${fmtData(d)}: ${c}`); }
      if (choques.length) throw new Error(`Conflito — nada foi reservado. ${choques.slice(0, 4).join(" · ")}${choques.length > 4 ? ` · +${choques.length - 4}` : ""}`);
      for (const d of datas) await tx`INSERT INTO space_bookings (space_id, unit_id, data, inicio, fim, titulo, turma, grupo, solicitante_user_id, solicitante_nome) VALUES (${sp.id}, ${sp.unit_id}, ${d}, ${inicio}, ${fim}, ${titulo}, ${strOrNull(fd, "turma")}, ${grupo}, ${s.id}, ${s.nome})`;
    });
    await audit(s, "reservar espaço", "space_bookings", null, null, { espaco: sp.nome, data, inicio, fim, semanas, titulo });
    msg = `${sp.nome} reservado: ${fmtData(data)}, ${inicio}–${fim}${semanas ? ` e mais ${semanas} semana(s)` : ""}.`;
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}

export async function cancelarReserva(fd: FormData) {
  const s = await requireSession(); const b = back(fd, "/operacoes/espacos/reservas"); let msg = "";
  try {
    const [r] = await sql<{ id: number; unit_id: number; solicitante_user_id: number | null; status: string; grupo: string | null; data: string }[]>`SELECT id, unit_id, solicitante_user_id, status, grupo, data::text FROM space_bookings WHERE id=${int(fd, "id") ?? 0}`;
    if (!r || r.status !== "CONFIRMADA") throw new Error("Reserva não encontrada."); naUnidade(s, r.unit_id);
    assert(r.solicitante_user_id === s.id || cuida(s), "Só quem reservou, operações ou a gestão cancelam.");
    const serie = str(fd, "serie") === "1" && r.grupo;
    const n = serie ? await sql`UPDATE space_bookings SET status='CANCELADA', cancel_motivo=${strOrNull(fd, "motivo")} WHERE grupo=${r.grupo} AND status='CONFIRMADA' AND data >= ${r.data} RETURNING id` : await sql`UPDATE space_bookings SET status='CANCELADA', cancel_motivo=${strOrNull(fd, "motivo")} WHERE id=${r.id} RETURNING id`;
    await audit(s, "cancelar reserva de espaço", "space_bookings", r.id, null, { serie: !!serie, canceladas: n.length }); msg = `${n.length} reserva(s) cancelada(s).`;
  } catch (e) { redirect(go(b, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(b, "ok", msg));
}
