"use server";
// v30 · relatório sob medida: salvar (só a definição — cada pessoa vê o resultado com o próprio acesso), compartilhar e excluir
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, can } from "@/lib/auth";
import { audit, str, int } from "@/lib/utils";
import { comMensagem } from "@/lib/redirecionar";
import { podeRelatoriosRh } from "@/lib/relatorios-rh";
import { lerDefinicao, paraQuery } from "@/lib/relatorio-montar";

const msgErro = (e: unknown) => (e instanceof Error ? e.message : "Erro");

export async function salvarRelatorio(fd: FormData) {
  const s = await requireSession(); let destino = "/relatorios/montar";
  try {
    assert(podeRelatoriosRh(s) && s.role !== "LEITURA", "Seu acesso não salva relatórios.");
    const nome = str(fd, "nome").slice(0, 80); if (nome.length < 3) throw new Error("Dê um nome ao relatório (3+ letras).");
    const d = lerDefinicao(s, new URLSearchParams(str(fd, "qs"))); if ("erro" in d) throw new Error(d.erro);
    const qs = paraQuery(d); const compartilhado = str(fd, "compartilhado") === "1"; const id = int(fd, "id");
    if (id) {
      const [r] = await sql<{ dono_user_id: number }[]>`SELECT dono_user_id FROM custom_reports WHERE id=${id}`; if (!r) throw new Error("Relatório não encontrado."); assert(r.dono_user_id === s.id, "Só quem criou altera o relatório (salve uma cópia com outro nome).");
      await sql`UPDATE custom_reports SET nome=${nome}, definicao=${JSON.stringify({ qs, fonte: d.fonte })}::jsonb, compartilhado=${compartilhado}, updated_at=now() WHERE id=${id}`;
      await audit(s, "alterar relatório sob medida", "custom_reports", id, null, { nome, fonte: d.fonte, compartilhado });
    } else {
      const [n] = await sql<{ id: number }[]>`INSERT INTO custom_reports (nome, definicao, dono_user_id, compartilhado) VALUES (${nome}, ${JSON.stringify({ qs, fonte: d.fonte })}::jsonb, ${s.id}, ${compartilhado}) RETURNING id`;
      await audit(s, "salvar relatório sob medida", "custom_reports", n.id, null, { nome, fonte: d.fonte, compartilhado });
    }
    destino = `/relatorios/montar?${qs}`;
  } catch (e) { redirect(comMensagem(destino, "erro", msgErro(e))); }
  redirect(comMensagem(destino, "ok", "Relatório salvo — está em “Relatórios salvos”."));
}
export async function excluirRelatorio(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id"));
  try {
    const [r] = await sql<{ dono_user_id: number; nome: string }[]>`SELECT dono_user_id, nome FROM custom_reports WHERE id=${id}`; if (!r) throw new Error("Relatório não encontrado.");
    assert(r.dono_user_id === s.id || can.editar(s), "Só quem criou (ou o RH) exclui o relatório.");
    await sql`DELETE FROM custom_reports WHERE id=${id}`; await audit(s, "excluir relatório sob medida", "custom_reports", id, { nome: r.nome }, null);
  } catch (e) { redirect(comMensagem("/relatorios/montar", "erro", msgErro(e))); }
  redirect(comMensagem("/relatorios/montar", "ok", "Relatório excluído."));
}
