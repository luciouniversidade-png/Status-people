"use server";
// v30 · relatório semestral de transparência salarial (Lei 14.611/2023): onde foi publicado e o plano de ação
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, can, assert } from "@/lib/auth";
import { audit, str, strOrNull, num, int } from "@/lib/utils";
import { comMensagem } from "@/lib/redirecionar";

export async function salvarTransparencia(fd: FormData) {
  const s = await requireSession(); const b = "/analytics/igualdade";
  try {
    assert(can.verSalario(s), "Só RH e Direção registram o relatório de transparência.");
    const companyId = int(fd, "companyId"); const ano = int(fd, "ano"); const semestre = int(fd, "semestre");
    if (!companyId || !ano || ![1, 2].includes(semestre ?? 0)) throw new Error("Escolha a empresa, o ano e o semestre.");
    const publicadoEm = strOrNull(fd, "publicadoEm"); const onde = strOrNull(fd, "onde"); const link = strOrNull(fd, "link");
    if (publicadoEm && !onde) throw new Error("Diga onde o relatório foi publicado (site, redes sociais, mural…).");
    if (link && !/^https?:\/\//i.test(link)) throw new Error("O link precisa começar com http:// ou https://.");
    const dif = num(fd, "diferencaPct"); const plano = strOrNull(fd, "planoAcao");
    if (dif !== null && Math.abs(dif) > 0 && dif > 0 && !plano) throw new Error("Com diferença salarial apontada no relatório, registre o plano de ação (Lei 14.611/2023, art. 5º, §2º).");
    const [{ empregados }] = await sql<{ empregados: number }[]>`SELECT count(*)::int AS empregados FROM employees WHERE company_id=${companyId} AND situacao NOT IN ('DESLIGADO','EM_ADMISSAO') AND vinculo IN ('CLT','HORISTA','TEMPORARIO')`;
    await sql`INSERT INTO pay_transparency_reports (company_id, ano, semestre, empregados, publicado_em, onde, link, diferenca_pct, plano_acao, plano_prazo, obs, registrado_por, registrado_por_nome)
      VALUES (${companyId}, ${ano}, ${semestre}, ${empregados}, ${publicadoEm}, ${onde}, ${link}, ${dif}, ${plano}, ${strOrNull(fd, "planoPrazo")}, ${strOrNull(fd, "obs")}, ${s.id}, ${s.nome})
      ON CONFLICT (company_id, ano, semestre) DO UPDATE SET empregados=EXCLUDED.empregados, publicado_em=EXCLUDED.publicado_em, onde=EXCLUDED.onde, link=EXCLUDED.link, diferenca_pct=EXCLUDED.diferenca_pct, plano_acao=EXCLUDED.plano_acao, plano_prazo=EXCLUDED.plano_prazo, obs=EXCLUDED.obs, registrado_por=EXCLUDED.registrado_por, registrado_por_nome=EXCLUDED.registrado_por_nome`;
    await audit(s, "relatório de transparência salarial", "pay_transparency_reports", companyId, null, { ano, semestre, publicadoEm, onde, diferencaPct: dif, plano: !!plano });
  } catch (e) { redirect(comMensagem(b, "erro", e instanceof Error ? e.message : "Erro", "#transparencia")); }
  redirect(comMensagem(b, "ok", "Relatório registrado.", "#transparencia"));
}
