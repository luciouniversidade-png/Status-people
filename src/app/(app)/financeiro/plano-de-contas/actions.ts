"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert, scopeUnit, type Session } from "@/lib/auth";
import { audit, str, int, getSettings, hoje, addDays, caminhoSeguro } from "@/lib/utils";
import { listarContas, editaPlano, classificarLancamentos, contextoSugestao, filaClassificacao, garantirCentrosPadrao } from "@/lib/plano-contas";
import { ehAnalitica, proximoCodigo, normalizar, sugerir } from "@/lib/plano-contas-calc";

const BASE = "/financeiro/plano-de-contas";
const go = (b: string, k: "ok" | "erro", m: string) => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(m)}`;
const msg = (e: unknown) => e instanceof Error ? e.message : "Erro inesperado.";
const ECON = ["OPEX", "CAPEX", "DIVIDA", "TRANSFERENCIA", "ADIANTAMENTO", "RECEITA"], COMP = ["FIXO", "VARIAVEL"], REC = ["RECORRENTE", "EVENTUAL"], CUSTO = ["DIRETO", "INDIRETO"], IND = ["IPCA", "DISSIDIO", "MENSALIDADE", "NENHUM"], DRV = ["ALUNOS", "RECEITA", "NENHUM"], CTR = ["UNIDADE", "CORPORATIVO"];
async function editor() { const s = await requireSession(); const cfg = await getSettings(); assert(editaPlano(cfg, s), "O plano de contas é mantido pela Direção e pelo Financeiro."); return { s, cfg }; }
const opcao = (fd: FormData, k: string, lista: string[], padrao: string) => { const v = str(fd, k) || padrao; assert(lista.includes(v), `Valor inválido em ${k}.`); return v; };

/** Criar (debaixo de um pai) ou editar uma conta. Código, nível e tipo não mudam depois de criados; a categoria-ponte só existe nas analíticas. */
export async function salvarConta(fd: FormData) {
  const id = int(fd, "id") ?? 0; const paiId = int(fd, "paiId") ?? 0; let volta = `${BASE}?aba=plano`; let m = "";
  try {
    const { s, cfg } = await editor(); const contas = await listarContas();
    const nome = str(fd, "nome").replace(/\s+/g, " "); assert(nome.length >= 2 && nome.length <= 120, "Nome da conta: de 2 a 120 caracteres.");
    const categorias = new Set([...(cfg.financeiro.categoriasSaida as string[]), ...(cfg.financeiro.categoriasEntrada as string[]), ...(cfg.dre.internas as string[]), ...((cfg.dre.naoDespesa ?? []) as string[])]);
    const palavras = str(fd, "palavras").split(",").map(x => x.trim()).filter(Boolean).slice(0, 30).join(", ").slice(0, 600) || null;
    const descricao = str(fd, "descricao").slice(0, 300) || null;
    if (id) {
      const c = contas.find(x => x.id === id); assert(!!c, "Conta não encontrada."); volta = `${BASE}?aba=plano&editar=${id}#editar`;
      const analitica = ehAnalitica(c!, contas);
      const ativo = str(fd, "ativo") === "1";
      if (!ativo && c!.ativo) { const filhosAtivos = contas.filter(x => x.pai_id === id && x.ativo).length; assert(filhosAtivos === 0, `Inative antes as ${filhosAtivos} conta(s) de baixo.`);
        const [abertos] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM payables WHERE conta_id=${id} AND status IN ('ATIVO','AGUARDANDO_APROVACAO')`; assert(abertos.n === 0, `Há ${abertos.n} título(s) em aberto nesta conta em contas a pagar: quite ou reclassifique antes de inativar.`); }
      const categoria = analitica ? str(fd, "categoria") : null; if (analitica) assert(!!categoria && categorias.has(categoria), "Escolha a categoria-ponte (caixa, DRE e orçamento).");
      const novo = { nome, categoria, tipo_economico: opcao(fd, "economico", ECON, c!.tipo_economico), comportamento: opcao(fd, "comportamento", COMP, c!.comportamento), recorrencia: opcao(fd, "recorrencia", REC, c!.recorrencia),
        controlavel: str(fd, "controlavel") === "1", custo: opcao(fd, "custo", CUSTO, c!.custo), indice: opcao(fd, "indice", IND, c!.indice), driver: opcao(fd, "driver", DRV, c!.driver), centro_padrao: opcao(fd, "centro", CTR, c!.centro_padrao),
        generica: str(fd, "generica") === "1", palavras, descricao, ativo };
      if (analitica && categoria !== c!.categoria) { const [u] = await sql<{ n: number }[]>`SELECT (SELECT count(*) FROM cash_entries WHERE conta_id=${id}) + (SELECT count(*) FROM payables WHERE conta_id=${id}) AS n`;
        assert(Number(u.n) === 0, "Esta conta já tem lançamentos: a categoria-ponte não muda (os relatórios antigos mudariam). Crie uma conta nova e inative esta."); }
      await sql`UPDATE chart_accounts SET nome=${novo.nome}, categoria=${novo.categoria}, tipo_economico=${novo.tipo_economico}, comportamento=${novo.comportamento}, recorrencia=${novo.recorrencia}, controlavel=${novo.controlavel}, custo=${novo.custo}, indice=${novo.indice}, driver=${novo.driver}, centro_padrao=${novo.centro_padrao}, generica=${novo.generica}, palavras=${novo.palavras}, descricao=${novo.descricao}, ativo=${novo.ativo}, updated_at=now() WHERE id=${id}`;
      await audit(s, "editar conta do plano de contas", "chart_accounts", id, { nome: c!.nome, categoria: c!.categoria, tipo_economico: c!.tipo_economico, comportamento: c!.comportamento, custo: c!.custo, indice: c!.indice, driver: c!.driver, centro: c!.centro_padrao, ativo: c!.ativo }, novo);
      m = `${c!.codigo} ${nome} salva.`;
    } else {
      const pai = contas.find(x => x.id === paiId); assert(!!pai, "Escolha onde a conta entra (grupo, subgrupo ou conta).");
      assert(pai!.ativo, "O grupo de cima está inativo."); assert(pai!.nivel <= 3, "O plano vai até a subconta (4º nível).");
      if (pai!.nivel === 3) { const [u] = await sql<{ n: number }[]>`SELECT (SELECT count(*) FROM cash_entries WHERE conta_id=${paiId}) + (SELECT count(*) FROM payables WHERE conta_id=${paiId}) + (SELECT count(*) FROM classification_rules WHERE conta_id=${paiId} AND ativo) AS n`;
        assert(Number(u.n) === 0, `${pai!.codigo} ${pai!.nome} já tem lançamentos ou regras: ela continua analítica. Crie uma conta irmã no subgrupo.`); }
      const nivel = pai!.nivel + 1; const codigo = proximoCodigo(pai!, contas.filter(x => x.pai_id === paiId));
      const analitica = nivel >= 3; const categoria = analitica ? (str(fd, "categoria") || pai!.categoria) : null;
      if (analitica) assert(!!categoria && categorias.has(categoria), "Escolha a categoria-ponte (caixa, DRE e orçamento).");
      const [n] = await sql<{ id: number }[]>`INSERT INTO chart_accounts (codigo, nome, nivel, pai_id, tipo, categoria, tipo_economico, comportamento, recorrencia, controlavel, custo, indice, driver, centro_padrao, generica, palavras, descricao, ordem, created_by)
        VALUES (${codigo}, ${nome}, ${nivel}, ${paiId}, ${pai!.tipo}, ${categoria}, ${opcao(fd, "economico", ECON, pai!.tipo === "ENTRADA" ? "RECEITA" : pai!.tipo_economico)}, ${opcao(fd, "comportamento", COMP, pai!.comportamento)}, ${opcao(fd, "recorrencia", REC, pai!.recorrencia)},
          ${str(fd, "controlavel") ? str(fd, "controlavel") === "1" : pai!.controlavel}, ${opcao(fd, "custo", CUSTO, pai!.custo)}, ${opcao(fd, "indice", IND, pai!.indice)}, ${opcao(fd, "driver", DRV, pai!.driver)}, ${opcao(fd, "centro", CTR, pai!.centro_padrao)},
          ${str(fd, "generica") === "1"}, ${palavras}, ${descricao}, 1000, ${s.id}) RETURNING id`;
      await audit(s, "criar conta no plano de contas", "chart_accounts", n.id, null, { codigo, nome, pai: `${pai!.codigo} ${pai!.nome}`, categoria });
      m = `${codigo} ${nome} criada${pai!.nivel === 3 ? ` — ${pai!.codigo} passou a grupo` : ""}.`; volta = `${BASE}?aba=plano&editar=${n.id}#editar`;
    }
  } catch (e) { redirect(go(volta, "erro", msg(e))); }
  redirect(go(volta, "ok", m));
}

/** Criar ou editar um centro de custo (área, projeto ou segmento). Os centros padrão (corporativo e geral da unidade) só mudam nome e responsável. */
export async function salvarCentro(fd: FormData) {
  const id = int(fd, "id") ?? 0; let volta = `${BASE}?aba=centros`; let m = "";
  try {
    const { s } = await editor(); await garantirCentrosPadrao();
    const nome = str(fd, "nome").replace(/\s+/g, " "); assert(nome.length >= 2 && nome.length <= 120, "Nome do centro: de 2 a 120 caracteres.");
    const resp = int(fd, "responsavelId") || null; if (resp) { const [u] = await sql`SELECT 1 FROM users WHERE id=${resp} AND ativo`; assert(!!u, "Responsável não encontrado."); }
    const inicio = /^\d{4}-\d{2}-\d{2}$/.test(str(fd, "inicio")) ? str(fd, "inicio") : null; const fim = /^\d{4}-\d{2}-\d{2}$/.test(str(fd, "fim")) ? str(fd, "fim") : null;
    if (inicio && fim) assert(fim >= inicio, "O fim do projeto vem depois do início.");
    const orcTxt = str(fd, "orcamento").replace(/[R$\s.]/g, "").replace(",", "."); const orcamento = orcTxt ? Number(orcTxt) : null; if (orcamento !== null) assert(Number.isFinite(orcamento) && orcamento >= 0, "Orçamento do projeto inválido.");
    const obs = str(fd, "obs").slice(0, 500) || null;
    if (id) {
      const [c] = await sql<{ id: number; codigo: string; tipo: string; nome: string; ativo: boolean; responsavel_user_id: number | null }[]>`SELECT id, codigo, tipo, nome, ativo, responsavel_user_id FROM cost_centers WHERE id=${id}`; assert(!!c, "Centro não encontrado.");
      const padrao = c.tipo === "CORPORATIVO" || c.tipo === "UNIDADE"; const ativo = padrao ? true : str(fd, "ativo") === "1";
      await sql`UPDATE cost_centers SET nome=${nome}, responsavel_user_id=${resp}, inicio=${inicio}, fim=${fim}, orcamento=${orcamento}, obs=${obs}, ativo=${ativo}, updated_at=now() WHERE id=${id}`;
      await audit(s, "editar centro de custo", "cost_centers", id, { nome: c.nome, ativo: c.ativo, responsavel: c.responsavel_user_id }, { nome, ativo, responsavel: resp, inicio, fim, orcamento });
      m = `Centro ${c.codigo} salvo.`; volta = `${BASE}?aba=centros&centro=${id}#editar`;
    } else {
      const tipo = str(fd, "tipo"); assert(["AREA", "PROJETO", "SEGMENTO"].includes(tipo), "Crie áreas, projetos ou segmentos (corporativo e unidades já existem).");
      const unitId = int(fd, "unitId") || null; const escopo = scopeUnit(s); if (escopo !== null) assert(unitId === escopo, "Crie centros só da sua unidade.");
      let codUnidade = "REDE"; if (unitId) { const [u] = await sql<{ codigo: string }[]>`SELECT codigo FROM units WHERE id=${unitId}`; assert(!!u, "Unidade não encontrada."); codUnidade = u.codigo; }
      const segmento = tipo === "SEGMENTO" ? str(fd, "segmento") : null; if (tipo === "SEGMENTO") { assert(!!unitId, "Segmento é de uma unidade."); assert(!!segmento && segmento.length >= 2, "Informe o segmento."); }
      const prefixo = tipo === "PROJETO" ? "PRJ-" : tipo === "AREA" ? `${codUnidade}.AR` : `${codUnidade}.SG`;
      const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int + 1 AS n FROM cost_centers WHERE codigo LIKE ${`${prefixo}%`}`;
      let codigo = `${prefixo}${String(n).padStart(tipo === "PROJETO" ? 3 : 2, "0")}`; for (let k = n + 1; (await sql`SELECT 1 FROM cost_centers WHERE codigo=${codigo}`).length; k++) codigo = `${prefixo}${String(k).padStart(tipo === "PROJETO" ? 3 : 2, "0")}`;
      const [c] = await sql<{ id: number }[]>`INSERT INTO cost_centers (codigo, nome, tipo, unit_id, segmento, responsavel_user_id, inicio, fim, orcamento, obs, created_by) VALUES (${codigo}, ${nome}, ${tipo}, ${unitId}, ${segmento}, ${resp}, ${inicio}, ${fim}, ${orcamento}, ${obs}, ${s.id}) RETURNING id`;
      await audit(s, "criar centro de custo", "cost_centers", c.id, null, { codigo, nome, tipo, unitId, orcamento });
      m = `Centro ${codigo} criado.`; volta = `${BASE}?aba=centros&centro=${c.id}#editar`;
    }
  } catch (e) { redirect(go(volta, "erro", msg(e))); }
  redirect(go(volta, "ok", m));
}

/** Classificar um lançamento (tela do lançamento): conta + centro, com motivo opcional e “lembrar para esta contraparte”. */
export async function classificarLancamento(fd: FormData) {
  const id = int(fd, "id") ?? 0; const volta = caminhoSeguro(str(fd, "voltar"), `/financeiro/lancamentos/${id}`); let m = "";
  try {
    const { s } = await editor(); const contaId = int(fd, "contaId") ?? 0; assert(contaId > 0, "Escolha a conta do plano.");
    const centroId = int(fd, "centroId") || null;
    const r = await classificarLancamentos(s, [{ id, contaId, centroId }], "MANUAL", str(fd, "motivo").slice(0, 300) || null);
    if (r.erros.length) throw new Error(r.erros[0].replace(/^#\d+: /, "")); if (r.travados) throw new Error("Competência fechada: trocar a categoria do lançamento exige reabrir o mês (detalhar a conta dentro da mesma categoria é permitido).");
    if (str(fd, "lembrar") === "1") { const [l] = await sql<{ contraparte: string | null; unit_id: number }[]>`SELECT contraparte, unit_id FROM cash_entries WHERE id=${id}`; if (l?.contraparte && normalizar(l.contraparte).length >= 3) await criarRegraInterna(s, l.contraparte, contaId, centroId, null); }
    m = r.mesmas ? "Já estava nesta conta e centro." : "Lançamento classificado — a DRE, o rateio e o orçamento já usam a conta.";
  } catch (e) { redirect(go(volta, "erro", msg(e))); }
  redirect(go(volta, "ok", m));
}

async function criarRegraInterna(s: Session, padrao: string, contaId: number, centroId: number | null, unitId: number | null) {
  const p = padrao.trim().slice(0, 120);
  const [ja] = await sql<{ id: number }[]>`SELECT id FROM classification_rules WHERE ativo AND lower(padrao)=lower(${p}) AND coalesce(unit_id, 0)=${unitId ?? 0}`;
  if (ja) { await sql`UPDATE classification_rules SET conta_id=${contaId}, cost_center_id=${centroId} WHERE id=${ja.id}`; return ja.id; }
  const [r] = await sql<{ id: number }[]>`INSERT INTO classification_rules (padrao, conta_id, cost_center_id, unit_id, created_by) VALUES (${p}, ${contaId}, ${centroId}, ${unitId}, ${s.id}) RETURNING id`;
  await audit(s, "criar regra de classificação", "classification_rules", r.id, null, { padrao: p, contaId, centroId, unitId });
  return r.id;
}

/** Fila: classificar as linhas marcadas com a sugestão de cada uma, ou todas com a mesma conta e centro. */
export async function classificarSelecionados(fd: FormData) {
  const volta = caminhoSeguro(str(fd, "voltar"), `${BASE}?aba=classificacao`); let m = "";
  try {
    const { s } = await editor(); const ids = fd.getAll("ids").map(x => Number(x)).filter(x => Number.isInteger(x) && x > 0).slice(0, 500);
    assert(ids.length > 0, "Marque ao menos um lançamento."); const modo = str(fd, "modo");
    let itens: { id: number; contaId: number; centroId: number | null }[] = [];
    if (modo === "CONTA") {
      const contaId = int(fd, "contaId") ?? 0; assert(contaId > 0, "Escolha a conta para as linhas marcadas."); const centroId = int(fd, "centroId") || null;
      itens = ids.map(id => ({ id, contaId, centroId }));
    } else {
      const ctx = await contextoSugestao();
      const rows = await sql<{ id: number; unit_id: number; tipo: string; categoria: string; contraparte: string | null; descricao: string | null; conta_id: number | null }[]>`SELECT id, unit_id, tipo, categoria, contraparte, descricao, conta_id FROM cash_entries WHERE id = ANY(${ids}::int[]) AND (conta_id IS NULL OR conta_id IN (SELECT id FROM chart_accounts WHERE generica))`;
      for (const r of rows) { const sg = sugerir(r, ctx); if (sg && sg.contaId !== r.conta_id) itens.push({ id: r.id, contaId: sg.contaId, centroId: sg.centroId }); }
      assert(itens.length > 0, "Nenhuma das linhas marcadas tem sugestão: escolha a conta.");
    }
    const r = await classificarLancamentos(s, itens, modo === "CONTA" ? "MANUAL" : "SUGESTAO", null);
    let regras = 0;
    if (str(fd, "lembrar") === "1" && modo === "CONTA") {
      const cps = await sql<{ contraparte: string }[]>`SELECT DISTINCT contraparte FROM cash_entries WHERE id = ANY(${ids}::int[]) AND contraparte IS NOT NULL`;
      for (const c of cps) if (normalizar(c.contraparte).length >= 3) { await criarRegraInterna(s, c.contraparte, itens[0].contaId, itens[0].centroId, null); regras++; }
    }
    m = `${r.ok} lançamento(s) classificado(s)${r.mesmas ? `, ${r.mesmas} já estavam assim` : ""}${r.travados ? `, ${r.travados} em competência fechada (a categoria mudaria — reabra o mês)` : ""}${r.erros.length ? `, ${r.erros.length} com erro (${r.erros[0].replace(/^#\d+: /, "")})` : ""}${regras ? `; ${regras} regra(s) criada(s) para as próximas` : ""}.`;
  } catch (e) { redirect(go(volta, "erro", msg(e))); }
  redirect(go(volta, "ok", m));
}

/** Aplica, de uma vez, as sugestões de confiança alta (regra ou histórico da contraparte) do filtro atual. */
export async function aplicarAltaConfianca(fd: FormData) {
  const volta = caminhoSeguro(str(fd, "voltar"), `${BASE}?aba=classificacao`); let m = "";
  try {
    const { s, cfg } = await editor(); const escopo = scopeUnit(s);
    const de = /^\d{4}-\d{2}-\d{2}$/.test(str(fd, "de")) ? str(fd, "de") : addDays(hoje(), -Number(cfg.planoContas?.janelaClassificacaoDias ?? 120)); const ate = /^\d{4}-\d{2}-\d{2}$/.test(str(fd, "ate")) ? str(fd, "ate") : hoje();
    const pedida = int(fd, "unitId") || null; const unitIds = escopo !== null ? [escopo] : pedida ? [pedida] : null;
    const f = await filaClassificacao({ unitIds, de, ate, tipo: str(fd, "tipo") || null, categoria: str(fd, "categoria") || null, q: str(fd, "q") || null, limite: 2000, generica: str(fd, "generica") === "1" });
    const itens = f.itens.filter(i => i.sugestao?.confianca === "ALTA").map(i => ({ id: i.id, contaId: i.sugestao!.contaId, centroId: i.sugestao!.centroId }));
    assert(itens.length > 0, "Nenhuma sugestão de confiança alta neste filtro (crie regras ou classifique as primeiras de cada contraparte).");
    const r = await classificarLancamentos(s, itens, "SUGESTAO", "sugestões de confiança alta (regra ou histórico da contraparte)");
    m = `${r.ok} lançamento(s) classificado(s) pelas sugestões de confiança alta${r.travados ? `; ${r.travados} em competência fechada ficaram de fora` : ""}${r.erros.length ? `; ${r.erros.length} com erro` : ""}.`;
  } catch (e) { redirect(go(volta, "erro", msg(e))); }
  redirect(go(volta, "ok", m));
}

/** Regra de classificação: contraparte ou descrição que contém o padrão → conta (e centro). Vale para a fila e para as próximas importações. */
export async function salvarRegra(fd: FormData) {
  const volta = `${BASE}?aba=regras`; let m = "";
  try {
    const { s } = await editor(); const padrao = str(fd, "padrao").replace(/\s+/g, " "); assert(normalizar(padrao).length >= 3, "O padrão precisa de ao menos 3 letras (ex.: ENERGISA).");
    const contaId = int(fd, "contaId") ?? 0; const contas = await listarContas(); const c = contas.find(x => x.id === contaId);
    assert(!!c && c.ativo && ehAnalitica(c, contas), "Escolha uma conta analítica ativa.");
    const centroId = int(fd, "centroId") || null; if (centroId) { const [cc] = await sql`SELECT 1 FROM cost_centers WHERE id=${centroId} AND ativo`; assert(!!cc, "Centro de custo inválido."); }
    const unitId = int(fd, "unitId") || null; const escopo = scopeUnit(s); if (escopo !== null) assert(unitId === escopo, "Crie regras só da sua unidade.");
    const [ja] = await sql`SELECT 1 FROM classification_rules WHERE ativo AND lower(padrao)=lower(${padrao}) AND coalesce(unit_id, 0)=${unitId ?? 0}`; assert(!ja, "Já existe uma regra ativa com este padrão.");
    await criarRegraInterna(s, padrao, contaId, centroId, unitId);
    m = `Regra criada: “${padrao}” → ${c!.codigo} ${c!.nome}.`;
  } catch (e) { redirect(go(volta, "erro", msg(e))); }
  redirect(go(volta, "ok", m));
}

export async function desativarRegra(fd: FormData) {
  const volta = `${BASE}?aba=regras`; let m = "";
  try {
    const { s } = await editor(); const id = int(fd, "id") ?? 0; const [r] = await sql<{ padrao: string }[]>`UPDATE classification_rules SET ativo=false WHERE id=${id} AND ativo RETURNING padrao`; assert(!!r, "Regra não encontrada.");
    await audit(s, "desativar regra de classificação", "classification_rules", id, { ativo: true }, { ativo: false }); m = `Regra “${r.padrao}” desativada.`;
  } catch (e) { redirect(go(volta, "erro", msg(e))); }
  redirect(go(volta, "ok", m));
}

/** Roda as regras sobre os lançamentos sem conta da janela (as que casam viram classificação com origem “regra”). */
export async function aplicarRegras(fd: FormData) {
  const volta = `${BASE}?aba=regras`; let m = "";
  try {
    const { s, cfg } = await editor(); const escopo = scopeUnit(s);
    const de = addDays(hoje(), -Math.max(Number(cfg.planoContas?.janelaClassificacaoDias ?? 120), Number(str(fd, "dias")) || 0));
    const f = await filaClassificacao({ unitIds: escopo !== null ? [escopo] : null, de, ate: hoje(), limite: 5000 });
    const itens = f.itens.filter(i => i.sugestao?.fonte === "REGRA").map(i => ({ id: i.id, contaId: i.sugestao!.contaId, centroId: i.sugestao!.centroId }));
    const r = await classificarLancamentos(s, itens, "REGRA", "regras de classificação");
    if (r.ok) for (const rg of f.ctx.regras) { const n = f.itens.filter(i => i.sugestao?.fonte === "REGRA" && i.sugestao.motivo.includes(`“${rg.padrao}”`)).length; if (n) await sql`UPDATE classification_rules SET usos = usos + ${n} WHERE id=${rg.id}`; }
    m = itens.length ? `${r.ok} lançamento(s) classificado(s) pelas regras${r.travados ? `; ${r.travados} em competência fechada ficaram de fora` : ""}.` : "Nenhum lançamento sem conta casa com as regras ativas.";
  } catch (e) { redirect(go(volta, "erro", msg(e))); }
  redirect(go(volta, "ok", m));
}
