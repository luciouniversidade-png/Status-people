"use server";
// v34 · pedidos de ajuste de ponto feitos no Meu espaço: aprovação (gestor direto, direção da unidade, RH) e lançamento pelo RH.
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, type Session } from "@/lib/auth";
import { audit, str, int } from "@/lib/utils";
import { comMensagem } from "@/lib/redirecionar";
import { podeAprovarAjuste, lerMarcacoes, TIPO_AJUSTE } from "@/lib/autoatendimento";
import { montarMes, salvarDias } from "@/lib/ponto";
import { notificar } from "@/lib/comunicacao";
import { usuariosDasFichas } from "@/lib/assinaturas";

const go = (b: string, k: "ok" | "erro", m: string) => comMensagem(b, k, m);
const msgErro = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado.");
const BASE = "/ponto/ajustes";
type Pedido = { id: number; employee_id: number; data: string; tipo: string; marcacoes: string; status: string; aprovado_nome: string | null };
async function pedido(id: number) { const [p] = await sql<Pedido[]>`SELECT id, employee_id, data::text, tipo, marcacoes, status, aprovado_nome FROM timesheet_adjust_requests WHERE id=${id}`; assert(!!p, "Pedido não encontrado."); return p!; }

/** Grava o dia no espelho do ONE (marcações e horas trabalhadas) e o lançamento no banco de horas, como qualquer ajuste do RH. */
async function lancar(s: Session, p: Pedido) {
  const m = lerMarcacoes(p.marcacoes); const { dias } = await montarMes(p.employee_id, p.data.slice(0, 7)); const d = dias.find(x => x.data === p.data);
  const esperado = d?.esperado ?? 0;
  await salvarDias(s, p.employee_id, [{ data: p.data, esperado, trabalhado: m.minutos, status: "NORMAL", marcacoes: m.texto, obs: `Ajuste pedido no Meu espaço (${TIPO_AJUSTE[p.tipo] ?? p.tipo})${p.aprovado_nome ? `, aprovado por ${p.aprovado_nome}` : ""}`, origem: "AJUSTE" }]);
  await sql`UPDATE timesheet_adjust_requests SET status='AJUSTADO', ajustado_por=${s.id}, ajustado_nome=${s.nome}, ajustado_em=now() WHERE id=${p.id}`;
}

export async function decidirAjuste(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const decisao = str(fd, "decisao"); let msg = "";
  try {
    const p = await pedido(id); assert(p.status === "PENDENTE", "Pedido já decidido."); assert(await podeAprovarAjuste(s, p.employee_id), "Você não aprova o ponto desta pessoa.");
    const resposta = str(fd, "resposta").slice(0, 500) || null;
    if (decisao === "RECUSAR") {
      assert(!!resposta && resposta.length >= 5, "Escreva o motivo da recusa (a pessoa vê).");
      await sql`UPDATE timesheet_adjust_requests SET status='RECUSADO', aprovado_por=${s.id}, aprovado_nome=${s.nome}, aprovado_em=now(), resposta=${resposta} WHERE id=${id}`; msg = "Pedido recusado.";
    } else {
      await sql`UPDATE timesheet_adjust_requests SET status='APROVADO', aprovado_por=${s.id}, aprovado_nome=${s.nome}, aprovado_em=now(), resposta=${resposta} WHERE id=${id}`;
      if (["RH", "DIRECAO"].includes(s.role) && str(fd, "lancar") === "1") { await lancar(s, { ...p, aprovado_nome: s.nome }); msg = "Aprovado e lançado no espelho do ONE. Se o ponto vem do relógio, ajuste lá também antes da próxima importação."; }
      else msg = "Aprovado. O RH lança o ajuste no ponto.";
    }
    await notificar(await usuariosDasFichas([p.employee_id]), "Seu pedido de ajuste de ponto foi analisado", "Veja a resposta no Meu espaço.", "/eu#ajuste", "INFO");
    await audit(s, decisao === "RECUSAR" ? "recusar ajuste de ponto" : "aprovar ajuste de ponto", "employees", p.employee_id, null, { data: p.data, pedido: id });
  } catch (e) { redirect(go(BASE, "erro", msgErro(e))); }
  redirect(go(BASE, "ok", msg));
}

export async function lancarAjuste(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const modo = str(fd, "modo"); let msg = "";
  try {
    assert(["RH", "DIRECAO"].includes(s.role), "Só o RH lança o ajuste."); const p = await pedido(id); assert(p.status === "APROVADO", "Só pedidos aprovados.");
    if (modo === "RELOGIO") { await sql`UPDATE timesheet_adjust_requests SET status='AJUSTADO', ajustado_por=${s.id}, ajustado_nome=${s.nome}, ajustado_em=now() WHERE id=${id}`; msg = "Marcado como ajustado no relógio: entra no ONE na próxima importação do ponto."; }
    else { await lancar(s, p); msg = "Lançado no espelho do ONE. Se o ponto vem do relógio, ajuste lá também antes da próxima importação."; }
    await notificar(await usuariosDasFichas([p.employee_id]), "Seu ajuste de ponto foi feito", "O dia já está corrigido.", "/eu#ajuste", "INFO");
    await audit(s, "lançar ajuste de ponto", "employees", p.employee_id, null, { data: p.data, pedido: id, modo: modo || "ONE" });
  } catch (e) { redirect(go(`${BASE}?aba=lancar`, "erro", msgErro(e))); }
  redirect(go(`${BASE}?aba=lancar`, "ok", msg));
}
