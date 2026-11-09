// IA como apoio (opcional) — uma única porta de saída para o provedor (Claude API), usada por todo o sistema:
// assistente estratégico, People AI, apoio de IA no desempenho e aderência de candidatos.
// Variáveis do servidor: AI_API_KEY (obrigatória para ligar), AI_MODEL (padrão abaixo), AI_WORKSPACE_ID (só para chave
// sem workspace) e AI_BASE_URL (só para testes ou proxy). Sem AI_API_KEY nada é enviado, gerado nem simulado.
// Os erros do provedor viram mensagens que dizem o que fazer (chave, créditos, workspace, modelo, limite, instabilidade).

export const MODELO_PADRAO = "claude-sonnet-5-5";
const VERSAO_API = "2023-06-01";
const TEMPO_MAXIMO_MS = 60_000;
const FIM = " Nada foi gerado nem simulado.";

export type ConfigIA = { ligada: boolean; modelo: string; modeloPadrao: boolean; workspace: string | null; endereco: string; enderecoPadrao: boolean };

/** O que está configurado no servidor — nunca devolve a chave. */
export function configIA(): ConfigIA {
  const base = (process.env.AI_BASE_URL || "https://api.anthropic.com").trim().replace(/\/+$/, "");
  const modelo = (process.env.AI_MODEL || "").trim();
  return { ligada: !!(process.env.AI_API_KEY || "").trim(), modelo: modelo || MODELO_PADRAO, modeloPadrao: !modelo, workspace: (process.env.AI_WORKSPACE_ID || "").trim() || null, endereco: base, enderecoPadrao: base === "https://api.anthropic.com" };
}

/** Erro do provedor → mensagem em português com o caminho da correção. */
export function traduzirErroIA(status: number, corpo: string, modelo: string): string {
  let tipo = "", msg = "";
  try { const j = JSON.parse(corpo) as { error?: { type?: string; message?: string } }; tipo = String(j?.error?.type ?? ""); msg = String(j?.error?.message ?? ""); } catch { msg = (corpo || "").slice(0, 200); }
  const m = msg.toLowerCase();
  if (m.includes("credit balance") || status === 402 || tipo === "billing_error")
    return "Sem créditos na conta da API: compre créditos em platform.claude.com → Billing (ou vincule os créditos mensais do seu plano do Claude em claude.ai → Settings → Billing → API credits)." + FIM;
  if (m.includes("not scoped to a workspace") || m.includes("anthropic-workspace-id header must"))
    return "A chave não está presa a um workspace: crie a chave escolhendo um workspace (por exemplo, o Default) ou cadastre a variável AI_WORKSPACE_ID com o ID do workspace (platform.claude.com → Workspaces)." + FIM;
  if (status === 401 || tipo === "authentication_error")
    return "A chave de IA foi recusada (AI_API_KEY inválida, apagada ou vencida): crie outra em platform.claude.com → API keys (expiração Never) e troque a variável no servidor." + FIM;
  if (status === 404 && m.includes("workspace"))
    return "O workspace de AI_WORKSPACE_ID não existe ou a chave não tem acesso a ele: confira o ID em platform.claude.com → Workspaces." + FIM;
  if (status === 404)
    return `O modelo configurado (${modelo}) não existe ou não está liberado para esta chave: use AI_MODEL=${MODELO_PADRAO}.` + FIM;
  if (status === 403 || tipo === "permission_error")
    return "A chave não tem permissão para usar a API nesta organização ou neste workspace: confira o papel da conta e o workspace da chave no Console." + FIM;
  if (status === 429 || tipo === "rate_limit_error")
    return "Limite de uso da API atingido agora (ou limite de gasto do workspace): tente de novo em 1 minuto ou revise os limites no Console." + FIM;
  if (status === 413 || tipo === "request_too_large")
    return "O pedido ficou grande demais para o provedor de IA." + FIM;
  if (status >= 500 || tipo === "overloaded_error" || tipo === "api_error")
    return "O provedor de IA está sobrecarregado ou instável agora: tente de novo em alguns minutos." + FIM;
  return `O provedor de IA recusou o pedido (${status}${msg ? `: ${msg.slice(0, 160)}` : ""}).` + FIM;
}

export type RespostaIA = { texto: string; modelo: string; tokensEntrada: number; tokensSaida: number; ms: number };

/** Chama o provedor. Sem chave: erro (nada é enviado). Falha do provedor: erro com o caminho da correção. */
export async function chamarAnthropic({ sistema, usuario, maxTokens, semChave }: { sistema: string; usuario: string; maxTokens: number; semChave?: string }): Promise<RespostaIA> {
  const key = (process.env.AI_API_KEY || "").trim(); const c = configIA();
  if (!key) throw new Error(semChave ?? "Recurso de IA indisponível: AI_API_KEY não configurada." + FIM);
  const headers: Record<string, string> = { "x-api-key": key, "anthropic-version": VERSAO_API, "content-type": "application/json" };
  if (c.workspace) headers["anthropic-workspace-id"] = c.workspace;
  const t0 = Date.now(); let r: Response;
  try {
    r = await fetch(`${c.endereco}/v1/messages`, { method: "POST", headers, body: JSON.stringify({ model: c.modelo, max_tokens: maxTokens, system: sistema, messages: [{ role: "user", content: usuario }] }), signal: AbortSignal.timeout(TEMPO_MAXIMO_MS), cache: "no-store" });
  } catch {
    throw new Error("Não foi possível falar com o provedor de IA (rede fora do ar ou tempo esgotado): tente de novo em alguns minutos." + FIM);
  }
  if (!r.ok) throw new Error(traduzirErroIA(r.status, await r.text().catch(() => ""), c.modelo));
  const j = await r.json().catch(() => null) as { content?: { type: string; text?: string }[]; model?: string; usage?: { input_tokens?: number; output_tokens?: number } } | null;
  const texto = (j?.content ?? []).filter(x => x.type === "text").map(x => x.text ?? "").join("\n").trim();
  if (!texto) throw new Error("O provedor de IA respondeu sem texto." + FIM);
  return { texto, modelo: j?.model ?? c.modelo, tokensEntrada: j?.usage?.input_tokens ?? 0, tokensSaida: j?.usage?.output_tokens ?? 0, ms: Date.now() - t0 };
}
