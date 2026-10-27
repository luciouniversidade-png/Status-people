"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit } from "@/lib/auth";
import { audit, str, int, getSettings } from "@/lib/utils";
import { editaPlano, aprovaRateio } from "@/lib/plano-contas";
import { notificar, usuariosPorPerfil } from "@/lib/comunicacao";
import { orcamentoPeloHistorico, lerPlano, paramsDoAno, type ResumoAplicado } from "@/lib/orcamento-historico";
import { porCategoria, VERSOES, ROTULO_VERSAO, DECISOES, type Decisao, type Versao } from "@/lib/orcamento-historico-calc";

const BASE = "/financeiro/orcamento/historico";
const go = (q: string, k: "ok" | "erro", m: string, ancora = "") => `${BASE}?${q}${q ? "&" : ""}${k}=${encodeURIComponent(m)}${ancora}`;
const msg = (e: unknown) => e instanceof Error ? e.message : "Erro inesperado.";
const qs = (fd: FormData, etapa: string) => { const q = new URLSearchParams({ ano: String(int(fd, "ano") ?? ""), etapa }); for (const k of ["sinal", "unidade", "versao", "situacao"]) { const v = str(fd, k); if (v) q.set(k, v); } return q.toString(); };
/** Número digitado no padrão brasileiro ("4,5", "1.250", "-2"). */
function numero(fd: FormData, k: string, min: number, max: number, rotulo: string): number {
  let t = str(fd, k).replace(/[%\sR$]/g, ""); if (t.includes(",")) t = t.replace(/\./g, "").replace(",", "."); else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t); assert(t !== "" && Number.isFinite(n) && n >= min && n <= max, `${rotulo}: informe um número entre ${min.toLocaleString("pt-BR")} e ${max.toLocaleString("pt-BR")}.`); return n;
}
async function podeEditar() { const s = await requireSession(); const cfg = await getSettings(); assert(editaPlano(cfg, s), "Só Direção e Financeiro preparam o orçamento pelo histórico."); return s; }

/** Decisão sobre um ou vários sinais da higienização (manter, tirar da base, normalizar pela mediana ou voltar à sugestão). */
export async function decidirSinais(fd: FormData) {
  const q = qs(fd, "higienizar"); let m = "";
  try {
    const s = await podeEditar(); const decisao = str(fd, "decisao"); const limpar = decisao === "SUGESTAO";
    assert(limpar || DECISOES.includes(decisao as Decisao), "Escolha a decisão.");
    const ids = fd.getAll("id").map(x => Number(x)).filter(x => Number.isInteger(x) && x > 0); assert(ids.length > 0, "Marque ao menos um lançamento.");
    assert(ids.length <= 500, "No máximo 500 lançamentos por vez.");
    const motivo = str(fd, "motivo").slice(0, 300) || null; const escopo = scopeUnit(s);
    const ok = await sql<{ id: number }[]>`SELECT id FROM cash_entries WHERE id = ANY(${ids}::int[]) ${escopo === null ? sql`` : sql`AND unit_id=${escopo}`}`; assert(ok.length === ids.length, "Lançamento fora do seu acesso.");
    const sinais = new Map<number, string>(); for (const id of ids) sinais.set(id, str(fd, `sinal_${id}`) || str(fd, "sinalPadrao") || "");
    if (decisao === "NORMALIZAR") assert([...sinais.values()].every(x => x === "FORA_DO_PADRAO"), "Normalizar pela mediana vale só para lançamentos fora do padrão.");
    await sql.begin(async tx => {
      for (const id of ids) {
        if (limpar) await tx`DELETE FROM budget_hygiene WHERE cash_entry_id=${id}`;
        else await tx`INSERT INTO budget_hygiene (cash_entry_id, decisao, sinal, motivo, user_id, user_nome) VALUES (${id}, ${decisao}, ${sinais.get(id) || null}, ${motivo}, ${s.id}, ${s.nome})
          ON CONFLICT (cash_entry_id) DO UPDATE SET decisao=EXCLUDED.decisao, sinal=EXCLUDED.sinal, motivo=EXCLUDED.motivo, user_id=EXCLUDED.user_id, user_nome=EXCLUDED.user_nome, decidido_em=now()`;
      }
    });
    await audit(s, limpar ? "orçamento pelo histórico: decisões desfeitas" : "orçamento pelo histórico: higienização decidida", "budget_hygiene", null, null, { decisao, lancamentos: ids.length, motivo });
    m = limpar ? `${ids.length} lançamento(s) de volta à sugestão do sistema.` : `${ids.length} lançamento(s): ${decisao === "FORA" ? "fora da base" : decisao === "NORMALIZAR" ? "normalizados pela mediana" : "mantidos na base"}.`;
  } catch (e) { redirect(go(q, "erro", msg(e), "#sinais")); }
  redirect(go(q, "ok", m, "#sinais"));
}

/** Aceita a sugestão do sistema para todos os sinais ainda sem decisão (todos, ou só de um tipo). */
export async function aceitarSugestoes(fd: FormData) {
  const q = qs(fd, "higienizar"); let m = "";
  try {
    const s = await podeEditar(); const ano = int(fd, "ano") ?? 0; assert(ano >= 2020 && ano <= 2100, "Ano inválido."); const filtro = str(fd, "sinal");
    const escopo = scopeUnit(s); const r = await orcamentoPeloHistorico(ano, escopo === null ? null : [escopo]); const un = escopo ?? int(fd, "unidade");
    const pend = r.sinais.filter(x => !x.decisao && (!filtro || x.sinal === filtro) && (!un || x.mov.unit_id === un)); assert(pend.length > 0, "Nenhum sinal pendente de decisão.");
    await sql.begin(async tx => {
      for (const x of pend) await tx`INSERT INTO budget_hygiene (cash_entry_id, decisao, sinal, motivo, user_id, user_nome) VALUES (${x.id}, ${x.sugestao}, ${x.sinal}, ${"sugestão do sistema aceita"}, ${s.id}, ${s.nome}) ON CONFLICT (cash_entry_id) DO NOTHING`;
    });
    await audit(s, "orçamento pelo histórico: sugestões aceitas", "budget_hygiene", null, null, { ano, sinal: filtro || "todos", lancamentos: pend.length });
    m = `${pend.length} sugestão(ões) aceita(s).`;
  } catch (e) { redirect(go(q, "erro", msg(e), "#sinais")); }
  redirect(go(q, "ok", m, "#sinais"));
}

/** Parâmetros do ano (reajustes, nivelamento, calendário, alunos por unidade e versões). */
export async function salvarParametros(fd: FormData) {
  const q = qs(fd, str(fd, "etapa") || "projetar"); let m = "";
  try {
    const s = await podeEditar(); const ano = int(fd, "ano") ?? 0; assert(ano >= 2020 && ano <= 2100, "Ano inválido.");
    const fimBase = str(fd, "fimBase"); assert(/^\d{4}-\d{2}$/.test(fimBase), "Informe o último mês da base (AAAA-MM).");
    assert(fimBase <= `${ano - 1}-12`, `A base precisa terminar antes de ${ano} começar.`);
    const atual = await lerPlano(ano); const ant = await paramsDoAno(ano, atual);
    const units = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`; const escopo = scopeUnit(s);
    const alunosAlvo: Record<string, number> = { ...ant.alunosAlvo };
    for (const u of units) { if (escopo !== null && u.id !== escopo) continue; const t = str(fd, `alunos_${u.id}`); if (t === "") { delete alunosAlvo[String(u.id)]; continue; } alunosAlvo[String(u.id)] = Math.round(numero(fd, `alunos_${u.id}`, 0, 100000, `Alunos de ${u.nome}`)); }
    const ferias = fd.getAll("mesesFerias").map(Number).filter(x => x >= 1 && x <= 12);
    const dv = (pfx: string) => ({ alunosPct: numero(fd, `${pfx}_alunosPct`, -50, 50, `${pfx}: alunos`), ipcaPp: numero(fd, `${pfx}_ipcaPp`, -20, 20, `${pfx}: IPCA`), dissidioPp: numero(fd, `${pfx}_dissidioPp`, -20, 20, `${pfx}: dissídio`), mensalidadePp: numero(fd, `${pfx}_mensalidadePp`, -20, 20, `${pfx}: mensalidade`) });
    const params = {
      fimBase, ipcaPct: numero(fd, "ipcaPct", -5, 50, "IPCA"), dissidioPct: numero(fd, "dissidioPct", -5, 50, "Dissídio"), reajusteMensalidadePct: numero(fd, "reajusteMensalidadePct", -20, 50, "Reajuste da mensalidade"),
      mesDissidio: numero(fd, "mesDissidio", 1, 12, "Mês do dissídio"), mesReajusteMensalidade: numero(fd, "mesReajusteMensalidade", 1, 12, "Mês do reajuste da mensalidade"),
      nivelIpcaPct: numero(fd, "nivelIpcaPct", -5, 50, "IPCA dentro da base"), nivelDissidioPct: numero(fd, "nivelDissidioPct", -5, 50, "Dissídio dentro da base"), nivelMensalidadePct: numero(fd, "nivelMensalidadePct", -20, 50, "Mensalidade dentro da base"),
      fatorFerias: numero(fd, "fatorFerias", 0, 1.5, "Consumo nas férias"), mesesFerias: ferias, outlierFator: numero(fd, "outlierFator", 1.5, 20, "Pico (× a mediana)"), outlierMinimo: numero(fd, "outlierMinimo", 0, 1e7, "Pico mínimo (R$)"), eventoMinimo: numero(fd, "eventoMinimo", 0, 1e8, "Evento a confirmar (R$)"),
      usarContratos: str(fd, "usarContratos") === "1", alunosAlvo, otimista: dv("otimista"), estresse: dv("estresse"),
    };
    await sql`INSERT INTO budget_plans (ano, params, updated_by) VALUES (${ano}, ${JSON.stringify(params)}::jsonb, ${s.id}) ON CONFLICT (ano) DO UPDATE SET params=EXCLUDED.params, updated_by=EXCLUDED.updated_by, updated_at=now()`;
    await audit(s, "orçamento pelo histórico: parâmetros", "budget_plans", ano, { params: atual?.params ?? null }, { params });
    m = `Parâmetros de ${ano} salvos — as três versões foram recalculadas.`;
  } catch (e) { redirect(go(q, "erro", msg(e), "#parametros")); }
  redirect(go(q, "ok", m, "#parametros"));
}

/** Direção aplica uma versão ao orçamento oficial do ano (mês a mês, por unidade e categoria). */
export async function aplicarVersao(fd: FormData) {
  const q = qs(fd, "governar"); let m = "";
  try {
    const s = await requireSession(); assert(aprovaRateio(s), "Só a Direção aplica o orçamento do ano.");
    const ano = int(fd, "ano") ?? 0; assert(ano >= 2020 && ano <= 2100, "Ano inválido."); const versao = str(fd, "versao") as Versao; assert(VERSOES.includes(versao), "Escolha a versão.");
    const motivo = str(fd, "motivo"); assert(motivo.length >= 10, "Registre o critério da escolha (mín. 10 caracteres) — fica na aprovação e na auditoria.");
    const r = await orcamentoPeloHistorico(ano, null); const ver = r.versoes[versao]; const cels = porCategoria(ver.linhas); assert(cels.length > 0, "Nada para aplicar: a base está vazia.");
    const substituir = str(fd, "substituir") === "1"; assert(!r.temOrcamentoMensal || substituir, `Já existe orçamento mês a mês em ${ano}. Marque “substituir” para trocar pelo desta versão.`);
    const unidades = [...new Set(cels.map(c => c.unit_id))]; let n = 0;
    await sql.begin(async tx => {
      if (substituir) await tx`DELETE FROM budget_months WHERE ano=${ano} AND unit_id = ANY(${unidades}::int[])`;
      for (const c of cels) for (let i = 0; i < 12; i++) { if (c.meses[i] <= 0) continue;
        await tx`INSERT INTO budget_months (ano, unit_id, tipo, categoria, mes, valor, user_id) VALUES (${ano}, ${c.unit_id}, ${c.tipo}, ${c.categoria}, ${i + 1}, ${c.meses[i]}, ${s.id}) ON CONFLICT (ano, unit_id, tipo, categoria, mes) DO UPDATE SET valor=EXCLUDED.valor, user_id=EXCLUDED.user_id, updated_at=now()`; n++; }
      const resumo: ResumoAplicado = { versao, fimBase: r.params.fimBase, aplicadoEm: new Date().toISOString(), celulas: n, params: r.params,
        totais: Object.fromEntries(VERSOES.map(v => [v, { receita: r.versoes[v].tot.rede.receita, despesa: r.versoes[v].tot.rede.despesa, resultado: r.versoes[v].tot.rede.resultado }])) as ResumoAplicado["totais"],
        porUnidade: r.unidades.map(u => { const t = ver.tot.porUnidade.get(u.id)!; return { unit_id: u.id, nome: u.nome, receita: t.receita, despesa: t.despesa, resultado: t.resultado, alunos: t.alunos }; }) };
      await tx`INSERT INTO budget_plans (ano, params, status, versao_aplicada, resumo, aplicado_por, aplicado_em, updated_by) VALUES (${ano}, ${JSON.stringify(r.plano?.params ?? {})}::jsonb, 'APLICADO', ${versao}, ${JSON.stringify(resumo)}::jsonb, ${s.id}, now(), ${s.id})
        ON CONFLICT (ano) DO UPDATE SET status='APLICADO', versao_aplicada=EXCLUDED.versao_aplicada, resumo=EXCLUDED.resumo, aplicado_por=EXCLUDED.aplicado_por, aplicado_em=now()`;
    });
    await audit(s, "orçamento pelo histórico: versão aplicada", "budget_plans", ano, null, { versao, motivo, celulas: n, receita: ver.tot.rede.receita, despesa: ver.tot.rede.despesa, substituiu: substituir });
    const dest = (await usuariosPorPerfil(["FINANCEIRO", "DIRETOR_UNIDADE", "DIRECAO"])).filter(id => id !== s.id);
    if (dest.length) await notificar(dest, `Orçamento ${ano} aprovado`, `Versão ${ROTULO_VERSAO[versao].toLowerCase()} aplicada: ${n} valores mês a mês nas unidades. Acompanhe no orçado × realizado.`, `/financeiro/orcamento?ano=${ano}`, "INFO", `orc-hist:${ano}:${Date.now()}`);
    m = `Versão ${ROTULO_VERSAO[versao].toLowerCase()} aplicada ao orçamento de ${ano}: ${n} valores mês a mês. O orçado × realizado já usa estes números.`;
  } catch (e) { redirect(go(q, "erro", msg(e), "#aplicar")); }
  redirect(go(q, "ok", m, "#aplicar"));
}
