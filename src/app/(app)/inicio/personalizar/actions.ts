"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert } from "@/lib/auth";
import { audit, str } from "@/lib/utils";
import { BLOCOS, ATALHOS, MAX_ATALHOS, MAX_KPIS_INICIO, PERFIS_MODULO, type ChaveBloco } from "@/lib/inicio";
import { kpisVisiveis, vePainelExecutivo } from "@/lib/kpi";

const go = (k: "ok" | "erro", msg: string) => `/inicio/personalizar?${k}=${encodeURIComponent(msg)}`;

/** Grava as escolhas do Início: blocos (com a ordem), atalhos, indicadores e a página inicial. Só o que o perfil pode ver é aceito. */
export async function salvarInicio(fd: FormData) {
  const s = await requireSession();
  try {
    const blocos = BLOCOS.filter(b => b.pode(s) && fd.get(`bloco_${b.chave}`) === "1")
      .map(b => ({ chave: b.chave as ChaveBloco, ordem: Number(str(fd, `ordem_${b.chave}`)) || 99 }))
      .sort((a, b) => a.ordem - b.ordem || BLOCOS.findIndex(x => x.chave === a.chave) - BLOCOS.findIndex(x => x.chave === b.chave)).map(b => b.chave);
    const atalhos = ATALHOS.filter(a => a.pode(s) && fd.getAll("atalho").map(String).includes(a.chave)).map(a => a.chave);
    assert(atalhos.length <= MAX_ATALHOS, `Escolha até ${MAX_ATALHOS} atalhos.`);
    let kpis: string[] | undefined;
    if (vePainelExecutivo(s)) { const ok = new Set((await kpisVisiveis(s)).map(k => k.chave)); kpis = fd.getAll("kpi").map(String).filter(k => ok.has(k)); assert(kpis.length <= MAX_KPIS_INICIO, `Escolha até ${MAX_KPIS_INICIO} indicadores.`); }
    const paginaInicial = (PERFIS_MODULO[s.role] || s.role === "COLABORADOR") && str(fd, "paginaInicial") === "inicio" ? "inicio" : "modulo";
    const inicio = { blocos, kpis: kpis ?? [], paginaInicial };
    await sql`INSERT INTO user_prefs (user_id, inicio, atalhos) VALUES (${s.id}, ${JSON.stringify(inicio)}::jsonb, ${JSON.stringify(atalhos)}::jsonb) ON CONFLICT (user_id) DO UPDATE SET inicio=EXCLUDED.inicio, atalhos=EXCLUDED.atalhos, updated_at=now()`;
    await audit(s, "início personalizado", "user_prefs", s.id, null, { blocos: blocos.length, atalhos: atalhos.length, kpis: kpis?.length ?? 0, paginaInicial });
  } catch (e) { redirect(go("erro", e instanceof Error ? e.message : "Erro inesperado.")); }
  redirect(go("ok", "Início atualizado."));
}

export async function restaurarInicio() {
  const s = await requireSession();
  await sql`DELETE FROM user_prefs WHERE user_id=${s.id}`; await audit(s, "início restaurado ao padrão", "user_prefs", s.id, null, null);
  redirect(go("ok", "Início de volta ao padrão do seu perfil."));
}
