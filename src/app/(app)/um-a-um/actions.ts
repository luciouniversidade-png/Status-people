"use server";
// v31 · 1:1 marcadas: marcar, remarcar, cancelar, pauta compartilhada e registro como realizada (vira acompanhamento do painel).
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { sql } from "@/db";
import { requireSession, assert } from "@/lib/auth";
import { audit, str, strOrNull, getSettings, hoje, fmtData, caminhoSeguro } from "@/lib/utils";
import { notificar } from "@/lib/comunicacao";
import { comMensagem } from "@/lib/redirecionar";
import { colegasConversa, umAUm, participa, proximaData, RECORRENCIA, type ItemPauta } from "@/lib/conversas";

const go = (b: string, k: "ok" | "erro", m: string) => comMensagem(b, k, m);
const erro = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado.");
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const dm = (d: string) => fmtData(d).slice(0, 5);

function lerHorario(fd: FormData) {
  const data = str(fd, "data"), inicio = str(fd, "inicio"), fim = str(fd, "fim");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(data), "Informe a data da 1:1."); assert(HORA.test(inicio) && HORA.test(fim), "Informe o início e o término (hh:mm).");
  assert(fim > inicio, "O término vem depois do início."); return { data, inicio, fim };
}
async function temasValidos(fd: FormData) {
  const cfg = await getSettings(); const lista = cfg.conversas.temas as string[]; const temas = [...new Set(fd.getAll("temas").map(String))].filter(t => lista.includes(t));
  return temas;
}
/** Aviso para a outra pessoa da 1:1 — sem nomes no texto (aparece na tela de bloqueio do celular). */
async function avisar(o: { id: number; organizador_user_id: number; convidado_user_id: number | null }, eu: number, titulo: string, chave: string) {
  const outro = o.organizador_user_id === eu ? o.convidado_user_id : o.organizador_user_id;
  if (outro) await notificar([outro], titulo, null, `/um-a-um/${o.id}`, "ACAO", chave);
}

export async function marcarUmAUm(fd: FormData) {
  const s = await requireSession(); const volta = caminhoSeguro(str(fd, "voltar"), "/um-a-um"); let id = 0;
  try {
    assert(s.role !== "LEITURA", "O acesso de consulta não marca 1:1.");
    const emp = Number(str(fd, "employeeId")); const colega = (await colegasConversa(s)).find(c => c.id === emp); assert(!!colega, "Escolha o convidado na lista.");
    const { data, inicio, fim } = lerHorario(fd); assert(data >= hoje(), "A data já passou — para uma conversa que já aconteceu, use “Registrar acompanhamento” no painel da pessoa.");
    const titulo = str(fd, "titulo").slice(0, 80); assert(titulo.length >= 3, "Dê um título à 1:1 (ex.: 1:1 quinzenal).");
    const temas = await temasValidos(fd); const recorrencia = RECORRENCIA[str(fd, "recorrencia")] ? str(fd, "recorrencia") : "NENHUMA";
    const [conflito] = await sql<{ id: number }[]>`SELECT id FROM one_on_ones WHERE status='MARCADA' AND data=${data} AND inicio < ${fim} AND fim > ${inicio} AND (employee_id=${emp} OR organizador_user_id=${s.id})`;
    assert(!conflito, "Já há uma 1:1 marcada nesse horário para você ou para o convidado.");
    const pauta: ItemPauta[] = str(fd, "pauta") ? [{ id: randomUUID().slice(0, 8), texto: str(fd, "pauta").slice(0, 300), autor: s.nome, autorId: s.id, em: new Date().toISOString(), feito: false }] : [];
    const [r] = await sql<{ id: number }[]>`INSERT INTO one_on_ones (organizador_user_id, organizador_nome, organizador_employee_id, employee_id, data, inicio, fim, titulo, temas, recorrencia, pauta)
      VALUES (${s.id}, ${s.nome}, ${s.employeeId ?? null}, ${emp}, ${data}, ${inicio}, ${fim}, ${titulo}, ${JSON.stringify(temas)}::jsonb, ${recorrencia}, ${JSON.stringify(pauta)}::jsonb) RETURNING id`;
    id = r.id; await audit(s, "marcar 1:1", "one_on_ones", id, null, { employeeId: emp, data, inicio, fim, temas, recorrencia });
    if (colega!.user_id) await notificar([colega!.user_id], `Nova 1:1 marcada para ${dm(data)} às ${inicio}`, "Abra para ver a pauta e incluir os seus pontos.", `/um-a-um/${id}`, "ACAO", `1a1:${id}`);
  } catch (e) { redirect(go(volta, "erro", erro(e))); }
  redirect(`/um-a-um?marcada=${id}`);
}

export async function remarcarUmAUm(fd: FormData) {
  const s = await requireSession(); const id = Number(str(fd, "id")); const volta = `/um-a-um/${id}`;
  try {
    const o = await umAUm(id); assert(!!o && participa(s, o), "1:1 não encontrada."); assert(o!.status === "MARCADA", "Só uma 1:1 marcada pode ser remarcada.");
    const { data, inicio, fim } = lerHorario(fd); assert(data >= hoje(), "Escolha uma data a partir de hoje.");
    await sql`UPDATE one_on_ones SET data=${data}, inicio=${inicio}, fim=${fim}, updated_at=now() WHERE id=${id}`;
    await audit(s, "remarcar 1:1", "one_on_ones", id, { data: o!.data, inicio: o!.inicio }, { data, inicio, fim });
    await avisar(o!, s.id, `1:1 remarcada para ${dm(data)} às ${inicio}`, `1a1-rem:${id}:${data}${inicio}`);
  } catch (e) { redirect(go(volta, "erro", erro(e))); }
  redirect(go(volta, "ok", "1:1 remarcada. A outra pessoa foi avisada."));
}

export async function cancelarUmAUm(fd: FormData) {
  const s = await requireSession(); const id = Number(str(fd, "id")); const volta = `/um-a-um/${id}`;
  try {
    const o = await umAUm(id); assert(!!o && participa(s, o), "1:1 não encontrada."); assert(o!.status === "MARCADA", "Esta 1:1 não está marcada.");
    const motivo = str(fd, "motivo"); assert(motivo.length >= 5, "Conte em poucas palavras por que a 1:1 foi cancelada.");
    await sql`UPDATE one_on_ones SET status='CANCELADA', motivo_cancelamento=${motivo.slice(0, 300)}, updated_at=now() WHERE id=${id}`;
    await audit(s, "cancelar 1:1", "one_on_ones", id, null, { motivo }); await avisar(o!, s.id, `1:1 de ${dm(o!.data)} cancelada`, `1a1-can:${id}`);
  } catch (e) { redirect(go(volta, "erro", erro(e))); }
  redirect(go(volta, "ok", "1:1 cancelada."));
}

export async function adicionarPauta(fd: FormData) {
  const s = await requireSession(); const id = Number(str(fd, "id")); const volta = `/um-a-um/${id}#pauta`;
  try {
    const o = await umAUm(id); assert(!!o && participa(s, o), "1:1 não encontrada."); assert(o!.status === "MARCADA", "A pauta fecha quando a 1:1 é registrada ou cancelada.");
    const texto = str(fd, "texto").slice(0, 300); assert(texto.length >= 3, "Escreva o ponto de pauta."); assert(o!.pauta.length < 30, "Pauta com 30 pontos — priorize.");
    const item: ItemPauta = { id: randomUUID().slice(0, 8), texto, autor: s.nome, autorId: s.id, em: new Date().toISOString(), feito: false };
    await sql`UPDATE one_on_ones SET pauta = pauta || ${JSON.stringify([item])}::jsonb, updated_at=now() WHERE id=${id}`;
    await audit(s, "ponto de pauta da 1:1", "one_on_ones", id, null, { pontos: o!.pauta.length + 1 });
    await avisar(o!, s.id, "Novo ponto na pauta da sua 1:1", `1a1-pauta:${id}:${hoje()}`);
  } catch (e) { redirect(go(volta, "erro", erro(e))); }
  redirect(volta);
}
export async function marcarPauta(fd: FormData) {
  const s = await requireSession(); const id = Number(str(fd, "id")); const item = str(fd, "item"); const volta = `/um-a-um/${id}#pauta`;
  try {
    const o = await umAUm(id); assert(!!o && participa(s, o), "1:1 não encontrada."); assert(o!.status === "MARCADA", "A pauta já foi fechada.");
    const pauta = o!.pauta.map(p => (p.id === item ? { ...p, feito: !p.feito } : p)); if (str(fd, "remover") === "1") { const alvo = o!.pauta.find(p => p.id === item); assert(!!alvo && (alvo.autorId ?? -1) === s.id, "Só quem escreveu remove o ponto."); }
    const final = str(fd, "remover") === "1" ? o!.pauta.filter(p => p.id !== item) : pauta;
    await sql`UPDATE one_on_ones SET pauta=${JSON.stringify(final)}::jsonb, updated_at=now() WHERE id=${id}`;
  } catch (e) { redirect(go(volta, "erro", erro(e))); }
  redirect(volta);
}

/** Realizada: vira um acompanhamento (perf_checkins tipo REUNIÃO) com combinados e compromissos; opcionalmente já marca a próxima da série. */
export async function registrarUmAUm(fd: FormData) {
  const s = await requireSession(); const id = Number(str(fd, "id")); const volta = `/um-a-um/${id}`; let prox = 0;
  try {
    const o = await umAUm(id); assert(!!o && participa(s, o), "1:1 não encontrada."); assert(o!.status === "MARCADA", "Esta 1:1 já foi registrada ou cancelada.");
    assert(o!.data <= hoje(), "Registre depois que a conversa acontecer."); const v = (k: string) => strOrNull(fd, k)?.slice(0, 1000) ?? null;
    const combinados = v("combinados"); assert(!!combinados && combinados.length >= 5, "Registre o que foi combinado (mesmo que seja “seguir como está”).");
    // a pauta fica só com as duas pessoas; vai para o acompanhamento do painel (que a gestão vê) apenas se quem registra marcar
    const levarPauta = str(fd, "levarPauta") === "1"; const pautaTxt = levarPauta ? o!.pauta.map(p => `${p.feito ? "✓" : "·"} ${p.texto}`).join("\n") : "";
    const [c] = await sql<{ id: number }[]>`INSERT INTO perf_checkins (employee_id, data, user_id, temas, combinados, tipo, avancou, bloqueio, apoio, proximo_compromisso, compromisso_gestor, compromisso_colaborador, compromisso_prazo, pauta_colaborador)
      VALUES (${o!.employee_id}, ${o!.data}, ${s.id}, ${[o!.titulo, o!.temas.join(", ")].filter(Boolean).join(" · ")}, ${combinados}, 'REUNIAO', ${combinados}, ${v("bloqueio")}, ${v("apoio")}, ${v("proximoCompromisso")}, ${v("compromissoGestor")}, ${v("compromissoColaborador")}, ${strOrNull(fd, "compromissoPrazo")}, ${pautaTxt || null}) RETURNING id`;
    await sql`UPDATE one_on_ones SET status='REALIZADA', checkin_id=${c.id}, realizada_em=now(), updated_at=now() WHERE id=${id}`;
    await audit(s, "registrar 1:1 realizada", "one_on_ones", id, null, { checkin: c.id, compromissos: !!(v("compromissoGestor") || v("compromissoColaborador")), pautaNoPainel: levarPauta });
    await avisar(o!, s.id, "Os combinados da sua 1:1 foram registrados", `1a1-reg:${id}`);
    const proxData = str(fd, "proximaData") || (str(fd, "marcarProxima") === "1" ? proximaData(o!.data, o!.recorrencia) ?? "" : "");
    if (str(fd, "marcarProxima") === "1" && proxData) {
      assert(proxData > hoje(), "A próxima 1:1 precisa de uma data futura.");
      const [r] = await sql<{ id: number }[]>`INSERT INTO one_on_ones (organizador_user_id, organizador_nome, organizador_employee_id, employee_id, data, inicio, fim, titulo, temas, recorrencia, anterior_id)
        VALUES (${o!.organizador_user_id}, ${o!.organizador_nome}, ${o!.organizador_employee_id}, ${o!.employee_id}, ${proxData}, ${o!.inicio}, ${o!.fim}, ${o!.titulo}, ${JSON.stringify(o!.temas)}::jsonb, ${o!.recorrencia}, ${id}) RETURNING id`;
      prox = r.id; await audit(s, "marcar 1:1", "one_on_ones", prox, null, { employeeId: o!.employee_id, data: proxData, serie: id });
      await avisar({ ...o!, id: prox }, s.id, `Nova 1:1 marcada para ${dm(proxData)} às ${o!.inicio}`, `1a1:${prox}`);
    }
  } catch (e) { redirect(go(volta, "erro", erro(e))); }
  redirect(go(prox ? `/um-a-um/${prox}` : volta, "ok", prox ? "1:1 registrada no acompanhamento e a próxima já está marcada." : "1:1 registrada — os combinados entraram no acompanhamento do painel."));
}
