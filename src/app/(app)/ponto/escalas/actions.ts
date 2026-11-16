"use server";
// v34 · escalas: turnos, equipes, a grade da semana, padrões, cópia, publicação (avisa a equipe) e mudanças depois de publicada.
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, type Session } from "@/lib/auth";
import { audit, str, int, addDays } from "@/lib/utils";
import { comMensagem } from "@/lib/redirecionar";
import * as E from "@/lib/escalas";
import { notificar } from "@/lib/comunicacao";
import { usuariosDasFichas } from "@/lib/assinaturas";

const go = (b: string, k: "ok" | "erro", m: string) => comMensagem(b, k, m);
const msgErro = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado.");
const url = (team: number, seg: string) => `/ponto/escalas?equipe=${team}&semana=${seg}`;
const hhmm = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

async function equipe(s: Session, id: number) {
  const [t] = await sql<{ id: number; nome: string; unit_id: number; responsavel_user_id: number | null }[]>`SELECT id, nome, unit_id, responsavel_user_id FROM shift_teams WHERE id=${id} AND ativo`;
  assert(!!t, "Equipe não encontrada."); assert(E.podeEditarEquipe(s, t!), "Você não monta a escala desta equipe."); return t!;
}

export async function salvarTurno(fd: FormData) {
  const s = await requireSession(); const volta = str(fd, "voltar") || "/ponto/escalas?aba=turnos";
  try {
    assert(E.podeTurnos(s), "Turnos: RH, Direção ou Operações.");
    const nome = str(fd, "nome").slice(0, 60); assert(nome.length >= 2, "Dê um nome ao turno."); const inicio = str(fd, "inicio"), fim = str(fd, "fim");
    assert(hhmm(inicio) && hhmm(fim) && inicio !== fim, "Início e fim no formato 07:00."); const intervalo = Math.max(0, Math.min(240, int(fd, "intervalo") ?? 60));
    const cor = E.CORES[str(fd, "cor")] ? str(fd, "cor") : "sky"; const sigla = str(fd, "sigla").slice(0, 4).toUpperCase() || null; const id = int(fd, "id");
    if (id) await sql`UPDATE shift_types SET nome=${nome}, sigla=${sigla}, inicio=${inicio}, fim=${fim}, intervalo_min=${intervalo}, cor=${cor}, ativo=${str(fd, "ativo") !== "0"} WHERE id=${id}`;
    else await sql`INSERT INTO shift_types (nome, sigla, inicio, fim, intervalo_min, cor) VALUES (${nome}, ${sigla}, ${inicio}, ${fim}, ${intervalo}, ${cor})`;
    await audit(s, id ? "editar turno" : "criar turno", "shift_types", id ?? null, null, { nome, inicio, fim, intervalo });
  } catch (e) { redirect(go(volta, "erro", msgErro(e))); }
  redirect(go(volta, "ok", "Turno salvo."));
}

export async function salvarEquipe(fd: FormData) {
  const s = await requireSession(); let id = int(fd, "id") ?? 0;
  try {
    const nome = str(fd, "nome").slice(0, 80); assert(nome.length >= 3, "Dê um nome à equipe (ex.: Portaria Carandá).");
    const unitId = int(fd, "unitId") ?? 0; assert(unitId > 0, "Escolha a unidade.");
    assert(E.podeEditarEquipe(s, { unit_id: unitId, responsavel_user_id: null }), "Você não cria equipes nesta unidade.");
    const resp = int(fd, "responsavelUserId") || null;
    const cobertura = fd.getAll("cobTurno").map((t, i) => ({ turnoId: Number(t), minimo: Number(fd.getAll("cobMin")[i] ?? 0) })).filter(c => c.turnoId > 0 && c.minimo > 0 && c.minimo <= 20);
    const coberturaDias = ["TODOS", "SEG_SAB", "SEG_SEX"].includes(String(fd.get("coberturaDias"))) ? String(fd.get("coberturaDias")) : "TODOS";
    const membros = fd.getAll("membros").map(Number).filter(n => n > 0);
    await sql.begin(async tx => {
      if (id) { await equipe(s, id); await tx`UPDATE shift_teams SET nome=${nome}, unit_id=${unitId}, responsavel_user_id=${resp}, cobertura=${JSON.stringify(cobertura)}::jsonb, cobertura_dias=${coberturaDias} WHERE id=${id}`; }
      else { const [r] = await tx<{ id: number }[]>`INSERT INTO shift_teams (nome, unit_id, responsavel_user_id, cobertura, cobertura_dias) VALUES (${nome}, ${unitId}, ${resp}, ${JSON.stringify(cobertura)}::jsonb, ${coberturaDias}) RETURNING id`; id = r.id; }
      await tx`DELETE FROM shift_team_members WHERE team_id=${id} AND NOT (employee_id = ANY(${membros}))`;
      for (const m of membros) await tx`INSERT INTO shift_team_members (team_id, employee_id) VALUES (${id}, ${m}) ON CONFLICT DO NOTHING`;
    });
    await audit(s, "salvar equipe de escala", "shift_teams", id, null, { nome, membros: membros.length, cobertura, coberturaDias });
  } catch (e) { redirect(go("/ponto/escalas?aba=equipes", "erro", msgErro(e))); }
  redirect(go(url(id, E.segunda(new Date().toISOString().slice(0, 10))), "ok", "Equipe salva."));
}

/** Grava a grade da semana (células c_<pessoa>_<data> = id do turno, F = folga, vazio = sem escala). Semana publicada: registra a mudança e avisa. */
export async function salvarGrade(fd: FormData) {
  const s = await requireSession(); const teamId = int(fd, "teamId") ?? 0; const seg = E.segunda(str(fd, "semana")); let msg = "";
  try {
    const t = await equipe(s, teamId); const dias = E.diasDaSemana(seg);
    const membros = (await sql<{ employee_id: number }[]>`SELECT employee_id FROM shift_team_members WHERE team_id=${teamId}`).map(r => r.employee_id);
    const turnos = new Set((await sql<{ id: number }[]>`SELECT id FROM shift_types WHERE ativo`).map(r => r.id));
    const atuais = await sql<{ employee_id: number; data: string; shift_type_id: number | null; folga: boolean }[]>`SELECT employee_id, data::text, shift_type_id, folga FROM shift_assignments WHERE team_id=${teamId} AND data BETWEEN ${seg} AND ${dias[6]}`;
    const [pub] = await sql`SELECT 1 FROM shift_publications WHERE team_id=${teamId} AND semana=${seg}`;
    const motivo = str(fd, "motivo").slice(0, 300) || null; let mud = 0; const afetados = new Set<number>();
    const rot = (c: { shift_type_id: number | null; folga: boolean } | undefined) => !c ? "—" : c.folga ? "folga" : c.shift_type_id ? `turno ${c.shift_type_id}` : "—";
    await sql.begin(async tx => {
      for (const e of membros) for (const d of dias) {
        const v = str(fd, `c_${e}_${d}`); const atual = atuais.find(a => a.employee_id === e && a.data === d);
        const novo = v === "F" ? { shift_type_id: null, folga: true } : v && turnos.has(Number(v)) ? { shift_type_id: Number(v), folga: false } : null;
        if ((novo?.shift_type_id ?? null) === (atual?.shift_type_id ?? null) && (novo?.folga ?? false) === (atual?.folga ?? false)) continue;
        if (novo) await tx`INSERT INTO shift_assignments (team_id, employee_id, data, shift_type_id, folga, updated_by, updated_nome) VALUES (${teamId}, ${e}, ${d}, ${novo.shift_type_id}, ${novo.folga}, ${s.id}, ${s.nome}) ON CONFLICT (team_id, employee_id, data) DO UPDATE SET shift_type_id=EXCLUDED.shift_type_id, folga=EXCLUDED.folga, updated_by=EXCLUDED.updated_by, updated_nome=EXCLUDED.updated_nome, updated_at=now()`;
        else await tx`DELETE FROM shift_assignments WHERE team_id=${teamId} AND employee_id=${e} AND data=${d}`;
        mud++;
        if (pub) { afetados.add(e); await tx`INSERT INTO shift_changes (team_id, employee_id, data, antes, depois, motivo, user_id, user_nome) VALUES (${teamId}, ${e}, ${d}, ${rot(atual)}, ${rot(novo ?? undefined)}, ${motivo}, ${s.id}, ${s.nome})`; }
      }
    });
    if (pub && afetados.size) await notificar(await usuariosDasFichas([...afetados]), "Sua escala mudou", `A escala da equipe ${t.nome} na semana de ${seg.slice(8)}/${seg.slice(5, 7)} foi alterada. Confira no Meu espaço.`, "/eu#escala", "ACAO");
    await audit(s, "salvar escala da semana", "shift_teams", teamId, null, { semana: seg, mudancas: mud, publicada: !!pub });
    msg = mud ? `Escala salva (${mud} mudança(s))${pub ? `; ${afetados.size} pessoa(s) avisada(s) da mudança` : ""}.` : "Nada mudou.";
  } catch (e) { redirect(go(url(teamId, seg), "erro", msgErro(e))); }
  redirect(go(url(teamId, seg), "ok", msg));
}

/** Copia a semana anterior (só onde a semana atual está vazia). */
export async function copiarSemana(fd: FormData) {
  const s = await requireSession(); const teamId = int(fd, "teamId") ?? 0; const seg = E.segunda(str(fd, "semana")); let n = 0;
  try {
    await equipe(s, teamId); const ant = addDays(seg, -7);
    const r = await sql`INSERT INTO shift_assignments (team_id, employee_id, data, shift_type_id, folga, updated_by, updated_nome)
      SELECT a.team_id, a.employee_id, (a.data + 7), a.shift_type_id, a.folga, ${s.id}, ${s.nome} FROM shift_assignments a JOIN shift_team_members m ON m.team_id=a.team_id AND m.employee_id=a.employee_id
      WHERE a.team_id=${teamId} AND a.data BETWEEN ${ant} AND ${addDays(ant, 6)} ON CONFLICT (team_id, employee_id, data) DO NOTHING`;
    n = r.count; await audit(s, "copiar semana da escala", "shift_teams", teamId, null, { semana: seg, copiadas: n });
  } catch (e) { redirect(go(url(teamId, seg), "erro", msgErro(e))); }
  redirect(go(url(teamId, seg), "ok", n ? `${n} dia(s) copiado(s) da semana anterior (onde estava vazio).` : "Nada copiado: a semana anterior está vazia ou esta já estava preenchida."));
}

/** Padrões: 5x2 (seg a sex), 6x1 (folga no dia escolhido), 12x36 (dia sim, dia não) — para uma pessoa ou toda a equipe. */
export async function aplicarPadrao(fd: FormData) {
  const s = await requireSession(); const teamId = int(fd, "teamId") ?? 0; const seg = E.segunda(str(fd, "semana")); let n = 0;
  try {
    await equipe(s, teamId); const padrao = str(fd, "padrao"); const turno = int(fd, "turnoId") ?? 0; assert(turno > 0, "Escolha o turno.");
    const quem = int(fd, "employeeId"); const membros = (await sql<{ employee_id: number }[]>`SELECT employee_id FROM shift_team_members WHERE team_id=${teamId}`).map(r => r.employee_id).filter(e => !quem || e === quem);
    assert(membros.length > 0, "Ninguém na equipe."); const folgaDow = int(fd, "folgaDow") ?? 0; const comeca = str(fd, "comeca") !== "0";
    const dias = E.diasDaSemana(seg);
    await sql.begin(async tx => {
      for (const e of membros) for (const [i, d] of dias.entries()) {
        const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
        const trabalha = padrao === "5x2" ? dow >= 1 && dow <= 5 : padrao === "6x1" ? dow !== folgaDow : padrao === "12x36" ? (i % 2 === 0) === comeca : false;
        await tx`INSERT INTO shift_assignments (team_id, employee_id, data, shift_type_id, folga, updated_by, updated_nome) VALUES (${teamId}, ${e}, ${d}, ${trabalha ? turno : null}, ${!trabalha}, ${s.id}, ${s.nome}) ON CONFLICT (team_id, employee_id, data) DO UPDATE SET shift_type_id=EXCLUDED.shift_type_id, folga=EXCLUDED.folga, updated_by=EXCLUDED.updated_by, updated_nome=EXCLUDED.updated_nome, updated_at=now()`; n++;
      }
    });
    await audit(s, "aplicar padrão de escala", "shift_teams", teamId, null, { semana: seg, padrao, pessoas: membros.length });
  } catch (e) { redirect(go(url(teamId, seg), "erro", msgErro(e))); }
  redirect(go(url(teamId, seg), "ok", `Padrão aplicado (${n} dia(s)). Revise e publique.`));
}

export async function publicarSemana(fd: FormData) {
  const s = await requireSession(); const teamId = int(fd, "teamId") ?? 0; const seg = E.segunda(str(fd, "semana")); let msg = "";
  try {
    const t = await equipe(s, teamId);
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM shift_assignments WHERE team_id=${teamId} AND data BETWEEN ${seg} AND ${addDays(seg, 6)}`; assert(n > 0, "A semana está vazia.");
    const r = await sql`INSERT INTO shift_publications (team_id, semana, publicado_por, publicado_nome) VALUES (${teamId}, ${seg}, ${s.id}, ${s.nome}) ON CONFLICT (team_id, semana) DO NOTHING`; assert(r.count === 1, "Semana já publicada (mudanças agora avisam a equipe).");
    const membros = (await sql<{ employee_id: number }[]>`SELECT employee_id FROM shift_team_members WHERE team_id=${teamId}`).map(x => x.employee_id);
    const users = await usuariosDasFichas(membros);
    await notificar(users, "Escala publicada", `Sua escala da semana de ${seg.slice(8)}/${seg.slice(5, 7)} (${t.nome}) está no Meu espaço.`, "/eu#escala", "INFO", `escala:${teamId}:${seg}`);
    await audit(s, "publicar escala", "shift_teams", teamId, null, { semana: seg }); msg = `Semana publicada; ${users.length} pessoa(s) avisada(s). A jornada esperada no ponto passa a seguir a escala.`;
  } catch (e) { redirect(go(url(teamId, seg), "erro", msgErro(e))); }
  redirect(go(url(teamId, seg), "ok", msg));
}
