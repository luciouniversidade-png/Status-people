"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit } from "@/lib/auth";
import { audit, str, int, caminhoSeguro } from "@/lib/utils";
import { LINHAS_DRE } from "@/lib/dre-calc";
import { comMensagem } from "@/lib/redirecionar";

const go = (b: string, k: "ok" | "erro", msg: string) => comMensagem(b, k, msg);

/** Comentário por linha da DRE no fechamento do mês (fica junto do período, como as explicações do orçamento). */
export async function comentarDre(fd: FormData) {
  const s = await requireSession(); const voltar = caminhoSeguro(str(fd, "voltar"), "/financeiro/dre");
  try {
    assert(["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE"].includes(s.role), "Comentam a DRE: Direção, Financeiro e diretor(a) de unidade.");
    const ano = int(fd, "ano") ?? 0, mes = int(fd, "mes") ?? 0; const linha = str(fd, "linha"); const texto = str(fd, "texto");
    assert(ano > 2000 && mes >= 1 && mes <= 12, "Período inválido."); assert(LINHAS_DRE.some(l => l.codigo === linha), "Linha inválida."); assert(texto.length >= 5, "Escreva a explicação.");
    let unitId = int(fd, "unitId"); const u = scopeUnit(s); if (u !== null) unitId = u;
    const [r] = await sql<{ id: number }[]>`INSERT INTO budget_comments (ano, mes, unit_id, tipo, categoria, texto, user_id, user_nome) VALUES (${ano}, ${mes}, ${unitId}, 'DRE', ${linha}, ${texto.slice(0, 2000)}, ${s.id}, ${s.nome}) RETURNING id`;
    await audit(s, "comentar linha da DRE", "budget_comments", r.id, null, { ano, mes, linha });
  } catch (e) { redirect(go(voltar, "erro", e instanceof Error ? e.message : "Erro")); }
  redirect(go(voltar, "ok", "Comentário registrado no fechamento."));
}
