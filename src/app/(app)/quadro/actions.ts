"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit } from "@/lib/auth";
import { audit, str, strOrNull, int, caminhoSeguro, getSettings } from "@/lib/utils";
import { sincronizarQuadro } from "@/lib/quadro";
import { comMensagem } from "@/lib/redirecionar";

const go = (b: string, k: "ok" | "erro", msg: string) => comMensagem(b, k, msg);
const erro = (e: unknown) => e instanceof Error ? e.message : "Erro inesperado.";
const podeQuadro = (role: string) => ["RH", "DIRECAO"].includes(role);

export async function sincronizar(fd: FormData) {
  const s = await requireSession(); const voltar = caminhoSeguro(str(fd, "voltar"), "/quadro"); let msg = "";
  try { assert(podeQuadro(s.role), "Sincroniza o quadro: RH ou Direção."); const r = await sincronizarQuadro(s, scopeUnit(s)); msg = `${r.vinculadas} pessoa(s) vinculada(s) a posições livres e ${r.criadas} posição(ões) criada(s)${s.role === "DIRECAO" ? " já autorizadas" : " aguardando a autorização da Direção"}${r.semCargo ? `; ${r.semCargo} pessoa(s) sem cargo ficaram de fora` : ""}.`; }
  catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", msg));
}

/** Autoriza o quadro (Direção): as posições aguardando passam a contar no quadro autorizado. */
export async function autorizarPosicoes(fd: FormData) {
  const s = await requireSession(); const voltar = caminhoSeguro(str(fd, "voltar"), "/quadro"); let n = 0;
  try { assert(s.role === "DIRECAO", "Autorizar o quadro é decisão da Direção."); const ids = fd.getAll("ids").map(Number).filter(x => x > 0); const todas = str(fd, "todas") === "1";
    const r = todas ? await sql<{ id: number }[]>`UPDATE position_slots SET autorizada=true, autorizada_por=${s.id}, autorizada_em=now(), updated_at=now() WHERE ativa AND NOT autorizada RETURNING id` : await sql<{ id: number }[]>`UPDATE position_slots SET autorizada=true, autorizada_por=${s.id}, autorizada_em=now(), updated_at=now() WHERE ativa AND NOT autorizada AND id = ANY(${ids}) RETURNING id`;
    n = r.length; await audit(s, "autorizar posições do quadro", "position_slots", null, null, { ids: r.map(x => x.id) }); }
  catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", `${n} posição(ões) autorizada(s).`));
}

/** Cria posições (aumento de quadro): Direção cria autorizadas; RH cria aguardando autorização. */
export async function criarPosicoes(fd: FormData) {
  const s = await requireSession(); const voltar = caminhoSeguro(str(fd, "voltar"), "/quadro");
  try { assert(podeQuadro(s.role), "Cria posições: RH ou Direção."); const cfg = await getSettings(); const positionId = int(fd, "positionId") ?? 0; const unitId = int(fd, "unitId") ?? 0; const qtd = Math.min(20, Math.max(1, int(fd, "quantidade") ?? 1)); const jornada = int(fd, "jornada") ?? Number(cfg.quadro.jornadaPlenaMin);
    assert(jornada >= 60 && jornada <= 720, "Jornada diária entre 60 e 720 minutos."); const motivo = str(fd, "motivo"); assert(motivo.length >= 5, "Explique o motivo do aumento de quadro.");
    const [p] = await sql<{ id: number }[]>`SELECT id FROM positions WHERE id=${positionId}`; assert(!!p, "Cargo não encontrado.");
    for (let i = 0; i < qtd; i++) await sql`INSERT INTO position_slots (position_id, unit_id, jornada_min_dia, autorizada, autorizada_por, autorizada_em, motivo, obs, created_by) VALUES (${positionId}, ${unitId}, ${jornada}, ${s.role === "DIRECAO"}, ${s.role === "DIRECAO" ? s.id : null}, CASE WHEN ${s.role === "DIRECAO"}::boolean THEN now() END, ${motivo}, ${strOrNull(fd, "obs")}, ${s.id})`;
    await audit(s, "criar posições no quadro", "position_slots", null, null, { positionId, unitId, qtd, jornada, motivo }); }
  catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", s.role === "DIRECAO" ? "Posições criadas e autorizadas." : "Posições criadas — aguardam a autorização da Direção."));
}

export async function editarPosicao(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const voltar = caminhoSeguro(str(fd, "voltar"), "/quadro");
  try { assert(podeQuadro(s.role), "Sem permissão."); const acao = str(fd, "acao");
    const [p] = await sql<{ employee_id: number | null; situacao: string | null }[]>`SELECT s.employee_id, e.situacao FROM position_slots s LEFT JOIN employees e ON e.id=s.employee_id WHERE s.id=${id} AND s.ativa`; assert(!!p, "Posição não encontrada.");
    if (acao === "extinguir") { assert(!p.employee_id || p.situacao === "DESLIGADO", "Só extingue posição vaga."); const [v] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM requisitions WHERE slot_id=${id} AND status IN ('SOLICITADA','ABERTA','PAUSADA')`; assert(!v.n, "Há vaga aberta para esta posição: cancele a vaga antes."); await sql`UPDATE position_slots SET ativa=false, employee_id=NULL, updated_at=now() WHERE id=${id}`; }
    else if (acao === "liberar") await sql`UPDATE position_slots SET employee_id=NULL, updated_at=now() WHERE id=${id}`;
    else if (acao === "ocupar") { const emp = int(fd, "employeeId") ?? 0; await sql`UPDATE position_slots SET employee_id=NULL WHERE employee_id=${emp} AND ativa AND id <> ${id}`; await sql`UPDATE position_slots SET employee_id=${emp}, updated_at=now() WHERE id=${id}`; }
    else if (acao === "jornada") { const j = int(fd, "jornada") ?? 0; assert(j >= 60 && j <= 720, "Jornada diária entre 60 e 720 minutos."); await sql`UPDATE position_slots SET jornada_min_dia=${j}, updated_at=now() WHERE id=${id}`; }
    else throw new Error("Ação inválida.");
    await audit(s, `posição: ${acao}`, "position_slots", id, null, Object.fromEntries(fd.entries() as Iterable<[string, string]>)); }
  catch (e) { redirect(go(voltar, "erro", erro(e))); }
  redirect(go(voltar, "ok", "Posição atualizada."));
}
