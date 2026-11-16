"use server";
// v34 · atestados enviados pelo Meu espaço: o RH confere o arquivo, aceita (abona os dias no ponto) ou recusa com o motivo.
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert } from "@/lib/auth";
import { audit, str, int, diasEntre } from "@/lib/utils";
import { comMensagem } from "@/lib/redirecionar";
import { podeAtestados, diasAtestado60 } from "@/lib/autoatendimento";
import { montarMes, salvarDias } from "@/lib/ponto";
import { mesFechado } from "@/lib/folha";
import { notificar } from "@/lib/comunicacao";
import { usuariosDasFichas } from "@/lib/assinaturas";

const go = (b: string, k: "ok" | "erro", m: string) => comMensagem(b, k, m);
const msgErro = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado.");
const BASE = "/ponto/atestados";

export async function decidirAtestado(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id") ?? 0; const decisao = str(fd, "decisao"); let msg = "";
  try {
    assert(podeAtestados(s), "Só RH e Direção tratam atestados.");
    const [m] = await sql<{ id: number; employee_id: number; tipo: string; inicio: string; fim: string; dias: number | null; status: string; unit_id: number }[]>`SELECT m.id, m.employee_id, m.tipo, m.inicio::text, m.fim::text, m.dias, m.status, e.unit_id FROM medical_certificates m JOIN employees e ON e.id=m.employee_id WHERE m.id=${id}`;
    assert(!!m, "Atestado não encontrado."); assert(m!.status === "ENVIADO", "Atestado já decidido.");
    const resposta = str(fd, "resposta").slice(0, 500) || null;
    if (decisao === "RECUSAR") {
      assert(!!resposta && resposta.length >= 5, "Escreva o motivo (ex.: ilegível, sem assinatura ou CRM, data rasurada).");
      await sql`UPDATE medical_certificates SET status='RECUSADO', decidido_por=${s.id}, decidido_nome=${s.nome}, decidido_em=now(), resposta=${resposta} WHERE id=${id}`;
      msg = "Atestado recusado; a pessoa vê o motivo no Meu espaço.";
    } else {
      let leaveId: number | null = null; let abonados = 0; const fechados: string[] = [];
      if (m!.tipo === "DIAS") {
        // afastamento por saúde aprovado: os dias saem da expectativa do ponto (dias ainda não importados)
        const [conf] = await sql<{ id: number }[]>`SELECT id FROM leave_requests WHERE employee_id=${m!.employee_id} AND status IN ('SOLICITADA','APROVADA') AND inicio <= ${m!.fim} AND fim >= ${m!.inicio}`;
        if (!conf) { const [l] = await sql<{ id: number }[]>`INSERT INTO leave_requests (employee_id, tipo, inicio, fim, dias, justificativa, status, solicitado_por, aprovado_por, decidido_em) VALUES (${m!.employee_id}, 'AFASTAMENTO_SAUDE', ${m!.inicio}, ${m!.fim}, ${diasEntre(m!.inicio, m!.fim)}, 'Atestado enviado pelo Meu espaço', 'APROVADA', ${s.id}, ${s.id}, now()) RETURNING id`; leaveId = l.id; }
      }
      // dias já importados do relógio como falta ou com horas a menos: passam a “Atestado (abonado)” — se o mês estiver aberto
      if (str(fd, "abonar") === "1") {
        for (const mes of [...new Set([m!.inicio.slice(0, 7), m!.fim.slice(0, 7)])]) {
          if (await mesFechado(m!.unit_id, `${mes}-01`)) { fechados.push(mes); continue; }
          const { dias } = await montarMes(m!.employee_id, mes);
          const alvo = dias.filter(d => d.salvo && d.data >= m!.inicio && d.data <= m!.fim && (d.status === "FALTA" || (d.status === "NORMAL" && d.trabalhado < d.esperado)));
          if (alvo.length) { await salvarDias(s, m!.employee_id, alvo.map(d => ({ data: d.data, esperado: d.esperado, trabalhado: d.trabalhado, status: "ATESTADO", marcacoes: d.marcacoes, obs: "Atestado aceito pelo RH", origem: "AJUSTE" }))); abonados += alvo.length; }
        }
      }
      await sql`UPDATE medical_certificates SET status='ACEITO', decidido_por=${s.id}, decidido_nome=${s.nome}, decidido_em=now(), resposta=${resposta}, leave_request_id=${leaveId} WHERE id=${id}`;
      const soma = await diasAtestado60(m!.employee_id, m!.fim);
      msg = `Atestado aceito.${leaveId ? " Afastamento registrado em Férias e afastamentos." : ""}${abonados ? ` ${abonados} dia(s) do espelho abonado(s).` : ""}${fechados.length ? ` Mês fechado (${fechados.join(", ")}): acerte na folha seguinte.` : ""}${soma > 15 ? ` Atenção: ${soma} dias de atestado nos últimos 60 dias — se for a mesma doença, a partir do 16º dia o afastamento é do INSS (perícia).` : ""}`;
    }
    await notificar(await usuariosDasFichas([m!.employee_id]), "Seu atestado foi analisado", "Veja no Meu espaço.", "/eu#atestado", "INFO");
    await audit(s, decisao === "RECUSAR" ? "recusar atestado" : "aceitar atestado", "employees", m!.employee_id, null, { atestado: id, tipo: m!.tipo, inicio: m!.inicio, fim: m!.fim });
  } catch (e) { redirect(go(BASE, "erro", msgErro(e))); }
  redirect(go(BASE, "ok", msg));
}
