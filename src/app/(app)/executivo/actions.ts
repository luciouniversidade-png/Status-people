"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit } from "@/lib/auth";
import { audit, str, strOrNull, int, caminhoSeguro } from "@/lib/utils";
import { KPI, garantirKpis, kpisVisiveis, podeEditarMeta, podeComentar, podeRecalcular, vePainelExecutivo } from "@/lib/kpi";
import { validarConfigIndicador, validoPeriodo } from "@/lib/gestao-calc";
import { DIRECAO_DO_SENTIDO } from "@/lib/kpi-catalogo";

const go = (b: string, k: "ok" | "erro", msg: string) => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}`;
const msg = (e: unknown) => e instanceof Error ? e.message : "Erro inesperado.";
/** Número digitado no padrão brasileiro: "2.500.000", "4,5", "R$ 1.200,50", "85%". */
function numeroBr(fd: FormData, k: string): number | null {
  let t = str(fd, k).replace(/[R$%\s]/g, ""); if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", "."); else if ((t.match(/\./g) ?? []).length > 1) t = t.replace(/\./g, "");
  const v = Number(t); return Number.isFinite(v) ? v : NaN;
}

async function unidadeValida(id: number) { if (id === 0) return true; const [u] = await sql`SELECT 1 FROM units WHERE id=${id}`; return !!u; }

/** Meta de um indicador para um ano e uma unidade (0 = rede). */
export async function salvarMeta(fd: FormData) {
  const s = await requireSession(); const volta = caminhoSeguro(str(fd, "voltar"), "/executivo/metas");
  try {
    const k = KPI[str(fd, "chave")]; assert(!!k, "Indicador inválido."); assert(podeEditarMeta(s, k), "Sem permissão para definir metas deste indicador.");
    assert((await kpisVisiveis(s)).some(x => x.chave === k.chave), "Sem acesso a este indicador.");
    assert(k.sentido !== "NEUTRO", "Este indicador é de acompanhamento: não tem melhor ou pior, então não recebe meta.");
    const ano = int(fd, "ano"); assert(!!ano && ano >= 2020 && ano <= 2100, "Ano inválido.");
    const unitId = int(fd, "unidade") ?? 0; assert(await unidadeValida(unitId), "Unidade inválida."); assert(scopeUnit(s) === null, "Metas são definidas pela rede.");
    const meta = numeroBr(fd, "meta"); assert(meta !== null && Number.isFinite(meta), "Informe a meta (número).");
    const alerta = numeroBr(fd, "alerta"); assert(alerta === null || Number.isFinite(alerta), "Limite de atenção inválido.");
    const periodicidade = k.agregacao === "SOMA" && str(fd, "periodicidade") === "ANUAL" ? "ANUAL" : "MENSAL";
    const probs = validarConfigIndicador({ direcao: DIRECAO_DO_SENTIDO[k.sentido]!, meta: meta!, alerta, faixaMin: null, faixaMax: null }); assert(!probs.length, probs.join(" "));
    if (k.unidade === "%") assert(meta! >= 0 && meta! <= 100 && (alerta === null || (alerta >= 0 && alerta <= 100)), "Percentuais vão de 0 a 100.");
    const [antes] = await sql`SELECT meta::float, alerta::float, periodicidade FROM kpi_targets WHERE chave=${k.chave} AND ano=${ano} AND unit_id=${unitId}`;
    await sql`INSERT INTO kpi_targets (chave, ano, unit_id, meta, alerta, periodicidade, obs, user_id, user_nome) VALUES (${k.chave}, ${ano}, ${unitId}, ${meta}, ${alerta}, ${periodicidade}, ${strOrNull(fd, "obs")}, ${s.id}, ${s.nome})
      ON CONFLICT (chave, ano, unit_id) DO UPDATE SET meta=EXCLUDED.meta, alerta=EXCLUDED.alerta, periodicidade=EXCLUDED.periodicidade, obs=EXCLUDED.obs, user_id=EXCLUDED.user_id, user_nome=EXCLUDED.user_nome, updated_at=now()`;
    await audit(s, "meta de indicador", "kpi_targets", null, antes ?? null, { chave: k.chave, ano, unidade: unitId, meta, alerta, periodicidade });
  } catch (e) { redirect(go(volta, "erro", msg(e))); }
  redirect(go(volta, "ok", "Meta salva."));
}

export async function removerMeta(fd: FormData) {
  const s = await requireSession(); const volta = caminhoSeguro(str(fd, "voltar"), "/executivo/metas");
  try {
    const k = KPI[str(fd, "chave")]; assert(!!k && podeEditarMeta(s, k), "Sem permissão."); assert(scopeUnit(s) === null, "Sem permissão.");
    const ano = int(fd, "ano") ?? 0; const unitId = int(fd, "unidade") ?? 0;
    const r = await sql`DELETE FROM kpi_targets WHERE chave=${k.chave} AND ano=${ano} AND unit_id=${unitId} RETURNING meta::float, alerta::float`;
    assert(r.length > 0, "Meta não encontrada."); await audit(s, "meta de indicador removida", "kpi_targets", null, r[0], { chave: k.chave, ano, unidade: unitId });
  } catch (e) { redirect(go(volta, "erro", msg(e))); }
  redirect(go(volta, "ok", "Meta removida: vale a meta padrão (quando existe) ou nenhuma."));
}

/** Comentário da gestão sobre um mês do indicador (aparece no gráfico e no histórico). */
export async function comentarKpi(fd: FormData) {
  const s = await requireSession(); const volta = caminhoSeguro(str(fd, "voltar"), "/executivo");
  try {
    assert(podeComentar(s), "Seu perfil não registra comentários.");
    const k = KPI[str(fd, "chave")]; assert(!!k && (await kpisVisiveis(s)).some(x => x.chave === k.chave), "Sem acesso a este indicador.");
    const periodo = str(fd, "periodo"); assert(validoPeriodo(periodo), "Período inválido.");
    const escopo = scopeUnit(s); const unitId = escopo ?? (int(fd, "unidade") ?? 0); assert(await unidadeValida(unitId), "Unidade inválida.");
    const texto = str(fd, "texto"); assert(texto.length >= 3, "Escreva o comentário."); assert(texto.length <= 1000, "Comentário longo demais (até 1.000 caracteres).");
    const [r] = await sql<{ id: number }[]>`INSERT INTO kpi_comments (chave, periodo, unit_id, texto, user_id, user_nome) VALUES (${k.chave}, ${periodo}, ${unitId}, ${texto}, ${s.id}, ${s.nome}) RETURNING id`;
    await audit(s, "comentário em indicador", "kpi_comments", r.id, null, { chave: k.chave, periodo, unidade: unitId });
  } catch (e) { redirect(go(volta, "erro", msg(e))); }
  redirect(go(volta, "ok", "Comentário registrado."));
}

export async function removerComentarioKpi(fd: FormData) {
  const s = await requireSession(); const volta = caminhoSeguro(str(fd, "voltar"), "/executivo");
  try {
    const id = int(fd, "id") ?? 0; const [c] = await sql<{ user_id: number | null; chave: string; unit_id: number }[]>`SELECT user_id, chave, unit_id FROM kpi_comments WHERE id=${id}`; assert(!!c, "Comentário não encontrado.");
    assert(c.user_id === s.id || s.role === "DIRECAO", "Só quem escreveu (ou a Direção) remove o comentário.");
    const escopo = scopeUnit(s); assert(escopo === null || c.unit_id === escopo, "Sem acesso a esta unidade.");
    await sql`DELETE FROM kpi_comments WHERE id=${id}`; await audit(s, "comentário em indicador removido", "kpi_comments", id, { chave: c.chave }, null);
  } catch (e) { redirect(go(volta, "erro", msg(e))); }
  redirect(go(volta, "ok", "Comentário removido."));
}

/** Assina (ou cancela) o resumo executivo semanal: chega toda segunda-feira em Notificações, no celular e por e-mail (quando configurado). */
export async function assinarResumo(fd: FormData) {
  const s = await requireSession(); const volta = caminhoSeguro(str(fd, "voltar"), "/executivo"); let texto = "";
  try {
    assert(vePainelExecutivo(s), "Seu perfil não tem acesso ao Painel Executivo.");
    const ativo = str(fd, "ativo") === "1"; const escopo = scopeUnit(s); const u = escopo ?? (int(fd, "unidade") || null);
    if (u !== null) assert(await unidadeValida(u), "Unidade inválida.");
    await sql`INSERT INTO kpi_subscriptions (user_id, unit_id, ativo, email) VALUES (${s.id}, ${u}, ${ativo}, ${str(fd, "email") !== "0"}) ON CONFLICT (user_id) DO UPDATE SET unit_id=EXCLUDED.unit_id, ativo=EXCLUDED.ativo, email=EXCLUDED.email`;
    await audit(s, ativo ? "assinatura do resumo executivo" : "assinatura do resumo executivo cancelada", "kpi_subscriptions", s.id, null, { unidade: u });
    texto = ativo ? "Pronto: o resumo executivo chega toda segunda-feira." : "Assinatura do resumo semanal cancelada.";
  } catch (e) { redirect(go(volta, "erro", msg(e))); }
  redirect(go(volta, "ok", texto));
}

/** Recalcula a base inteira (24 meses) — útil depois de importar dados antigos. */
export async function recalcularBase(fd: FormData) {
  const s = await requireSession(); const volta = caminhoSeguro(str(fd, "voltar"), "/executivo");
  let texto = "";
  try {
    assert(podeRecalcular(s), "Só Direção e RH recalculam a base.");
    const r = await garantirKpis("todos");
    if ("ocupado" in r && r.ocupado) throw new Error("A base já está sendo recalculada agora. Tente de novo em alguns segundos.");
    const falhas = "falhas" in r ? (r.falhas as string[]) : [];
    await audit(s, "base de indicadores recalculada", "kpi_series", null, null, { falhas: falhas.length });
    texto = falhas.length ? `Base recalculada com ${falhas.length} pendência(s): ${falhas.slice(0, 2).join(" · ")}` : "Base de indicadores recalculada (24 meses).";
  } catch (e) { redirect(go(volta, "erro", msg(e))); }
  redirect(go(volta, "ok", texto));
}
