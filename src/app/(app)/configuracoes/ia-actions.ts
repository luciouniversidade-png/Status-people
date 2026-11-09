"use server";
import { redirect } from "next/navigation";
import { requireSession, can, assert } from "@/lib/auth";
import { audit, erroMsg } from "@/lib/utils";
import { chamarAnthropic, configIA } from "@/lib/ia";

/** v32 · Teste de conexão da IA (Direção e RH): só a frase de teste vai ao provedor — nenhum dado da escola. A chave nunca é registrada. */
export async function testarIA() {
  const s = await requireSession(); let msg = "";
  try {
    assert(can.configurar(s), "Só Direção e RH testam a IA.");
    const c = configIA();
    if (!c.ligada) throw new Error("IA desligada: cadastre AI_API_KEY nas variáveis do servidor e publique de novo (veja os passos ao lado). Nada foi enviado.");
    try {
      const r = await chamarAnthropic({ sistema: "Você está respondendo a um teste de conexão. Responda apenas com a palavra OK.", usuario: "Teste de conexão do STATUS ONE.", maxTokens: 5 });
      await audit(s, "teste da IA", "settings", null, null, { ok: true, modelo: r.modelo, ms: r.ms });
      msg = `IA ligada e respondendo: modelo ${r.modelo}, em ${(r.ms / 1000).toFixed(1).replace(".", ",")} s. Só a frase de teste foi enviada.`;
    } catch (e) {
      await audit(s, "teste da IA", "settings", null, null, { ok: false, modelo: c.modelo, erro: e instanceof Error ? e.message.slice(0, 300) : "erro" });
      throw e;
    }
  } catch (e) { redirect(`/configuracoes?erro=${erroMsg(e)}#ia`); }
  redirect(`/configuracoes?ok=${encodeURIComponent(msg)}#ia`);
}
