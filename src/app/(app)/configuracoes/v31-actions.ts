"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, can, assert } from "@/lib/auth";
import { audit, str, erroMsg, getSettings } from "@/lib/utils";

const linhas = (t: string) => t.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
const num = (fd: FormData, k: string, min: number, max: number, rotulo: string) => { const v = Number(str(fd, k).replace(",", ".")); if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${rotulo}: use um número entre ${min} e ${max}.`); return Math.round(v); };

/** Parâmetros da v31 (RH e Direção): temas e duração da 1:1, limites do feedback, sugestão de pares do 360° e alvo de adesão ao PDI. */
export async function salvarParametrosV31(fd: FormData) {
  const s = await requireSession(); let msg = "Parâmetros de conversas e desenvolvimento salvos.";
  try {
    assert(can.configurar(s), "Só Direção e RH configuram."); const cfg = await getSettings();
    const temas = [...new Set(linhas(str(fd, "temas")).map(t => t.slice(0, 40)))]; assert(temas.length >= 3 && temas.length <= 20, "Use de 3 a 20 temas para a 1:1.");
    const conversas = { ...cfg.conversas, temas, duracaoMin: num(fd, "duracao", 15, 180, "Duração da 1:1"), feedbackLimiteDia: num(fd, "limite", 1, 100, "Feedbacks por dia"), pedidoPrazoDias: num(fd, "prazo", 1, 60, "Prazo do pedido"), pedidoMaxPessoas: num(fd, "pessoas", 1, 20, "Pessoas por pedido") };
    const pares = num(fd, "pares", 3, 10, "Pares sugeridos"); const teto = num(fd, "teto", 2, 30, "Teto de convites"); assert(teto >= 2, "Teto de convites muito baixo.");
    const desempenho = { ...cfg.desempenho, paresSugeridos: pares, maxConvitesPorAvaliador: teto, pdiAdesaoAlvo: num(fd, "adesao", 10, 100, "Adesão ao PDI") };
    await sql.begin(async tx => { for (const [key, value] of [["conversas", conversas], ["desempenho", desempenho]] as const) await tx`INSERT INTO settings (key, value) VALUES (${key}, ${JSON.stringify(value)}::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`; });
    await audit(s, "editar", "settings", null, { conversas: cfg.conversas }, { conversas, desempenho: { paresSugeridos: pares, maxConvitesPorAvaliador: teto, pdiAdesaoAlvo: desempenho.pdiAdesaoAlvo } });
  } catch (e) { redirect(`/configuracoes?erro=${erroMsg(e)}#v31`); }
  redirect(`/configuracoes?ok=${encodeURIComponent(msg)}#v31`);
}
