import { hoje } from "./utils";
import { rotinaConciliacao } from "./conciliacao";
import { rotinaMassa } from "./massa";
import { rotinaRevisaoPop } from "./governanca";

/** Rotina da v25: conciliação (mês corrente e anterior, escalonamento 15/30 dias), disparo de comunicação em massa agendada e revisão de POP por exceção repetida. */
export async function rotinaV25(h = hoje()) {
  const out: Record<string, unknown> = {}; const falhas: string[] = [];
  const bloco = async (nome: string, f: () => Promise<unknown>) => { try { out[nome] = await f(); } catch (e) { falhas.push(`${nome}: ${e instanceof Error ? e.message : String(e)}`); } };
  await bloco("conciliacao", () => rotinaConciliacao(h));
  await bloco("comunicacaoMassa", () => rotinaMassa()); // CRQ-COM-V3-01: dispara o aprovado quando a janela comercial abre
  await bloco("revisaoPop", () => rotinaRevisaoPop()); // CRQ-PRJ-V3-03
  return { ...out, falhas };
}
