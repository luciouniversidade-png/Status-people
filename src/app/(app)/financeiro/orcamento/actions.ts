"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit, can } from "@/lib/auth";
import { audit, str, int, getSettings, caminhoSeguro } from "@/lib/utils";
import { gerarPedidosExplicacao, fecharPedido } from "@/lib/orcamento-v24";

const go = (b: string, k: "ok" | "erro", msg: string) => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(msg)}`;
const msg = (e: unknown) => e instanceof Error ? e.message : "Erro inesperado.";
/** Valor em reais digitado no padrão brasileiro ("12.500,00", "12500", "12500.5"). Vazio = sem orçamento no mês. */
function reais(v: FormDataEntryValue | null): number | null {
  let t = String(v ?? "").replace(/[R$\s]/g, ""); if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", "."); else if ((t.match(/\./g) ?? []).length > 1) t = t.replace(/\./g, "");
  const n = Number(t); if (!Number.isFinite(n) || n < 0) throw new Error(`Valor inválido: "${String(v)}".`); return Math.round(n * 100) / 100;
}
async function podeOrcar() { const s = await requireSession(); const cfg = await getSettings(); assert(can.aprovar(s, cfg.alcadas.financeiro as string[]), "Só Direção e Financeiro editam o orçamento."); return s; }
async function unidadeOk(id: number | null) { if (!id) return false; const [u] = await sql`SELECT 1 FROM units WHERE id=${id}`; return !!u; }

/** Planilha mês a mês de uma unidade: grava tudo ou nada. Célula vazia volta a usar o valor mensal fixo (ou nenhum). */
export async function salvarPlanilha(fd: FormData) {
  const ano = int(fd, "ano") ?? 0; const unitId = int(fd, "unitId"); const volta = `/financeiro/orcamento/planilha?ano=${ano}&unidade=${unitId ?? ""}`;
  let n = 0;
  try {
    const s = await podeOrcar(); assert(ano >= 2020 && ano <= 2100, "Ano inválido."); assert(await unidadeOk(unitId), "Escolha a unidade."); assert(scopeUnit(s) === null || scopeUnit(s) === unitId, "Sem acesso a esta unidade.");
    const cfg = await getSettings(); const validas = new Set([...(cfg.financeiro.categoriasEntrada as string[]).map(c => `ENTRADA|${c}`), ...(cfg.financeiro.categoriasSaida as string[]).map(c => `SAIDA|${c}`)]);
    const cels: { tipo: string; categoria: string; mes: number; valor: number | null }[] = [];
    for (const [k, v] of fd.entries()) {
      const m = String(k).match(/^v_(ENTRADA|SAIDA)_(\d+)_(\d{1,2})$/); if (!m) continue;
      const categoria = String(fd.get(`c_${m[1]}_${m[2]}`) ?? ""); const mes = Number(m[3]);
      assert(validas.has(`${m[1]}|${categoria}`), `Categoria fora da lista: ${categoria}.`); assert(mes >= 1 && mes <= 12, "Mês inválido.");
      cels.push({ tipo: m[1], categoria, mes, valor: reais(v) });
    }
    assert(cels.length > 0, "Nada para salvar.");
    await sql.begin(async tx => {
      for (const c of cels) {
        if (c.valor === null) await tx`DELETE FROM budget_months WHERE ano=${ano} AND unit_id=${unitId} AND tipo=${c.tipo} AND categoria=${c.categoria} AND mes=${c.mes}`;
        else { await tx`INSERT INTO budget_months (ano, unit_id, tipo, categoria, mes, valor, user_id) VALUES (${ano}, ${unitId}, ${c.tipo}, ${c.categoria}, ${c.mes}, ${c.valor}, ${s.id}) ON CONFLICT (ano, unit_id, tipo, categoria, mes) DO UPDATE SET valor=EXCLUDED.valor, user_id=EXCLUDED.user_id, updated_at=now()`; n++; }
      }
    });
    await audit(s, "orçamento mês a mês", "budget_months", null, null, { ano, unitId, celulas: n });
  } catch (e) { redirect(go(volta, "erro", msg(e))); }
  redirect(go(volta, "ok", `Orçamento salvo: ${n} mês(es) com valor.`));
}

/** Cria o orçamento do ano a partir do ano anterior (orçado ou realizado) com reajuste — mantém a sazonalidade mês a mês. */
export async function copiarOrcamento(fd: FormData) {
  const ano = int(fd, "ano") ?? 0; const unitId = int(fd, "unitId"); const volta = `/financeiro/orcamento/planilha?ano=${ano}&unidade=${unitId ?? ""}`;
  let n = 0;
  try {
    const s = await podeOrcar(); assert(ano >= 2020 && ano <= 2100, "Ano inválido."); assert(await unidadeOk(unitId), "Escolha a unidade."); assert(scopeUnit(s) === null || scopeUnit(s) === unitId, "Sem acesso a esta unidade.");
    const fonte =str(fd, "fonte") === "REALIZADO" ? "REALIZADO" : "ORCADO"; const pct = Number(str(fd, "reajuste").replace(",", ".") || "0"); assert(Number.isFinite(pct) && pct > -50 && pct < 100, "Reajuste entre −50% e 100%.");
    const substituir = str(fd, "substituir") === "1"; const f = 1 + pct / 100;
    const base = fonte === "REALIZADO"
      ? await sql<{ tipo: string; categoria: string; mes: number; valor: number }[]>`SELECT tipo, categoria, extract(month FROM data)::int AS mes, sum(valor)::float AS valor FROM cash_entries WHERE unit_id=${unitId} AND tipo IN ('ENTRADA','SAIDA') AND data >= ${`${ano - 1}-01-01`}::date AND data < ${`${ano}-01-01`}::date GROUP BY 1, 2, 3`
      : await sql<{ tipo: string; categoria: string; mes: number; valor: number }[]>`WITH cats AS (SELECT DISTINCT tipo, categoria FROM budgets WHERE ano=${ano - 1} AND unit_id=${unitId} UNION SELECT DISTINCT tipo, categoria FROM budget_months WHERE ano=${ano - 1} AND unit_id=${unitId})
          SELECT c.tipo, c.categoria, ms.mes, coalesce(bm.valor, b.valor_mensal)::float AS valor FROM cats c CROSS JOIN generate_series(1, 12) AS ms(mes) LEFT JOIN budget_months bm ON bm.ano=${ano - 1} AND bm.unit_id=${unitId} AND bm.tipo=c.tipo AND bm.categoria=c.categoria AND bm.mes=ms.mes LEFT JOIN budgets b ON b.ano=${ano - 1} AND b.unit_id=${unitId} AND b.tipo=c.tipo AND b.categoria=c.categoria WHERE coalesce(bm.valor, b.valor_mensal) IS NOT NULL`;
    assert(base.length > 0, fonte === "REALIZADO" ? `Sem caixa lançado em ${ano - 1} nesta unidade.` : `Sem orçamento de ${ano - 1} nesta unidade.`);
    const [ja] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM budget_months WHERE ano=${ano} AND unit_id=${unitId}`;
    assert(substituir || ja.n === 0, `Já existe orçamento mês a mês em ${ano} nesta unidade. Marque "substituir" para sobrescrever.`);
    await sql.begin(async tx => {
      if (substituir) await tx`DELETE FROM budget_months WHERE ano=${ano} AND unit_id=${unitId}`;
      for (const b of base) { await tx`INSERT INTO budget_months (ano, unit_id, tipo, categoria, mes, valor, user_id) VALUES (${ano}, ${unitId}, ${b.tipo}, ${b.categoria}, ${b.mes}, ${Math.round(b.valor * f * 100) / 100}, ${s.id}) ON CONFLICT (ano, unit_id, tipo, categoria, mes) DO UPDATE SET valor=EXCLUDED.valor, user_id=EXCLUDED.user_id, updated_at=now()`; n++; }
    });
    await audit(s, "orçamento copiado do ano anterior", "budget_months", null, null, { ano, unitId, fonte, reajustePct: pct, celulas: n });
  } catch (e) { redirect(go(volta, "erro", msg(e))); }
  redirect(go(volta, "ok", `Orçamento ${ano} criado a partir de ${ano - 1}: ${n} mês(es).`));
}

/** Explicação de um desvio (categoria × mês), para o comitê e o histórico. */
export async function explicarDesvio(fd: FormData) {
  const volta = caminhoSeguro(str(fd, "voltar"), "/financeiro/orcamento");
  try {
    const s = await requireSession(); assert(["DIRECAO", "FINANCEIRO", "DIRETOR_UNIDADE"].includes(s.role), "Só Direção, Financeiro e direção da unidade explicam desvios.");
    const ano = int(fd, "ano") ?? 0; const mes = int(fd, "mes") ?? 0; assert(ano >= 2020 && mes >= 1 && mes <= 12, "Período inválido.");
    const tipo = str(fd, "tipo"); assert(tipo === "ENTRADA" || tipo === "SAIDA", "Tipo inválido."); const categoria = str(fd, "categoria"); assert(categoria.length > 0 && categoria.length <= 120, "Categoria inválida.");
    const escopo = scopeUnit(s); const pedido = int(fd, "unitId"); const unitId = escopo ?? (pedido && (await unidadeOk(pedido)) ? pedido : null);
    const texto = str(fd, "texto"); assert(texto.length >= 5 && texto.length <= 1000, "Explique em até 1.000 caracteres.");
    const [r] = await sql<{ id: number }[]>`INSERT INTO budget_comments (ano, mes, unit_id, tipo, categoria, texto, user_id, user_nome) VALUES (${ano}, ${mes}, ${unitId}, ${tipo}, ${categoria}, ${texto}, ${s.id}, ${s.nome}) RETURNING id`;
    await audit(s, "desvio do orçamento explicado", "budget_comments", r.id, null, { ano, mes, unitId, tipo, categoria });
    if (tipo === "SAIDA") await fecharPedido(ano, mes, unitId, categoria);
  } catch (e) { redirect(go(volta, "erro", msg(e))); }
  redirect(go(volta, "ok", "Explicação registrada."));
}

export async function removerExplicacao(fd: FormData) {
  const volta = caminhoSeguro(str(fd, "voltar"), "/financeiro/orcamento");
  try {
    const s = await requireSession(); const id = int(fd, "id") ?? 0;
    const [c] = await sql<{ user_id: number | null; unit_id: number | null }[]>`SELECT user_id, unit_id FROM budget_comments WHERE id=${id}`; assert(!!c, "Explicação não encontrada.");
    assert(c.user_id === s.id || s.role === "DIRECAO", "Só quem escreveu (ou a Direção) remove.");
    await sql`DELETE FROM budget_comments WHERE id=${id}`; await audit(s, "explicação de desvio removida", "budget_comments", id, null, null);
  } catch (e) { redirect(go(volta, "erro", msg(e))); }
  redirect(go(volta, "ok", "Explicação removida."));
}

/** T-025: gera agora os pedidos de explicação de um mês encerrado (a rotina diária faz o mesmo para o mês anterior). */
export async function gerarPedidos(fd: FormData) {
  const volta = caminhoSeguro(str(fd, "voltar"), "/financeiro/orcamento"); let r = { criados: 0, estouros: 0, aberto: false };
  try {
    const s = await podeOrcar(); const ano = int(fd, "ano") ?? 0; const mes = int(fd, "mes") ?? 0; assert(ano >= 2020 && mes >= 1 && mes <= 12, "Período inválido.");
    r = await gerarPedidosExplicacao(ano, mes); assert(!r.aberto, "O mês ainda não encerrou: os pedidos nascem quando o período fecha.");
    await audit(s, "pedidos de explicação gerados", "budget_explain_requests", null, null, { ano, mes, ...r });
  } catch (e) { redirect(go(volta, "erro", msg(e))); }
  redirect(go(volta, "ok", r.estouros ? `${r.estouros} estouro(s) acima da banda; ${r.criados} pedido(s) novo(s) enviados aos responsáveis.` : "Nenhuma categoria acima da banda no mês."));
}
