"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert } from "@/lib/auth";
import { audit, str, int, hoje, caminhoSeguro } from "@/lib/utils";
import { REL, podeRelatoriosRh } from "@/lib/relatorios-rh";
import { comMensagem } from "@/lib/redirecionar";

const go = (b: string, k: "ok" | "erro", m: string) => comMensagem(b, k, m);
const msg = (e: unknown) => e instanceof Error ? e.message : "Erro inesperado.";

export async function favoritarRelatorio(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), "/relatorios/biblioteca");
  try {
    const s = await requireSession(); const chave = str(fd, "chave"); assert(!!REL[chave], "Relatório desconhecido.");
    const [p] = await sql<{ favoritos: string[] | null }[]>`SELECT favoritos FROM user_prefs WHERE user_id=${s.id}`; const atuais = Array.isArray(p?.favoritos) ? p!.favoritos : [];
    const k = `rel:${chave}`; const novos = atuais.includes(k) ? atuais.filter(x => x !== k) : [...atuais, k];
    await sql`INSERT INTO user_prefs (user_id, favoritos, updated_at) VALUES (${s.id}, ${JSON.stringify(novos)}::jsonb, now()) ON CONFLICT (user_id) DO UPDATE SET favoritos=EXCLUDED.favoritos, updated_at=now()`;
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(voltar);
}

/** Agendamento mensal: no dia escolhido, o relatório do mês anterior chega como notificação (e por e-mail, se configurado). */
export async function agendarRelatorio(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), "/relatorios/biblioteca"); let txt = "";
  try {
    const s = await requireSession(); assert(podeRelatoriosRh(s) && s.role !== "LEITURA", "Seu acesso não agenda relatórios."); const chave = str(fd, "chave"); assert(!!REL[chave], "Relatório desconhecido.");
    if (str(fd, "acao") === "cancelar") { await sql`UPDATE report_schedules SET ativo=false WHERE user_id=${s.id} AND relatorio=${chave}`; txt = "Agendamento cancelado."; }
    else { const dia = int(fd, "dia") ?? 1; assert(dia >= 1 && dia <= 28, "Dia do mês entre 1 e 28."); const unitId = int(fd, "unitId");
      await sql`INSERT INTO report_schedules (user_id, relatorio, params, dia, ativo) VALUES (${s.id}, ${chave}, ${JSON.stringify({ unitId })}::jsonb, ${dia}, true) ON CONFLICT (user_id, relatorio) DO UPDATE SET params=EXCLUDED.params, dia=EXCLUDED.dia, ativo=true`;
      txt = `Agendado: todo dia ${dia}, o relatório do mês anterior chega para você.`; }
    await audit(s, "agendar relatório", "report_schedules", null, null, { chave, txt });
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(voltar, "ok", txt));
}

/** Pedido de relatório novo vira item de produto (fila de decisões da Direção), não planilha paralela. */
export async function pedirRelatorio(fd: FormData) {
  const voltar = caminhoSeguro(str(fd, "voltar"), "/relatorios/biblioteca");
  try {
    const s = await requireSession(); const titulo = str(fd, "titulo"); const desc = str(fd, "descricao"); assert(titulo.length >= 5 && desc.length >= 10, "Diga o nome do relatório e para que ele serve.");
    await sql`INSERT INTO exec_pending (titulo, area, descricao, prazo, status, responsavel_user_id) VALUES (${`Relatório novo: ${titulo}`}, 'Sistema (produto)', ${`Pedido por ${s.nome} em ${hoje().split("-").reverse().join("/")}: ${desc}`}, NULL, 'ABERTA', NULL)`;
    await audit(s, "pedir relatório novo", "exec_pending", null, null, { titulo });
  } catch (e) { redirect(go(voltar, "erro", msg(e))); }
  redirect(go(voltar, "ok", "Pedido registrado como item de produto na fila de decisões da Direção."));
}
