"use server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireSession, assert, scopeUnit, type Session } from "@/lib/auth";
import { audit, str, strOrNull, int, num, hoje, getSettings } from "@/lib/utils";
import { notificar } from "@/lib/comunicacao";
import { textoImportacao } from "@/lib/importacao";
import { validarConfigIndicador, validoPeriodo, periodoDe, proximaData, type Direcao, type TipoRitual, RITUAL_TIPO, FREQ_MESES, DIRECAO_IND } from "@/lib/gestao-calc";
import { listarIndicadores, atualizarIndicadoresSistema } from "@/lib/gestao-estrategica";
import { FONTES } from "@/lib/estrategia";
import { ORIGENS_FUNIL } from "@/lib/metricas-extra";
import { ORIGEM_LABEL } from "@/lib/utils";
import { chamarIA, validarRespostaIA } from "@/lib/ia-desempenho";
import { TAREFAS_ESTRATEGIA, CONFIG_IA_ESTRATEGIA, montarPromptEstrategia, fatosEstrategicos } from "@/lib/ia-estrategia";

const go = (b: string, k: "ok" | "erro", m: string) => `${b}${b.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(m)}`;
const erro = (e: unknown) => e instanceof Error ? e.message : "Erro";
const ESTRATEGIA = ["DIRECAO", "RH"];
const GESTAO = ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "FINANCEIRO", "OPERACOES", "COMERCIAL"];
const linhas = (t: string) => t.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
/** Número do formulário: vazio → null; texto que não é número → erro (nunca grava NaN). */
const numero = (fd: FormData, k: string, rotulo: string) => { const v = num(fd, k); if (v !== null && !Number.isFinite(v)) throw new Error(`${rotulo}: número inválido.`); return v; };
const idsDe = (fd: FormData, k: string) => [...new Set(fd.getAll(k).map(Number).filter(n => Number.isInteger(n) && n > 0))];
/** Pessoas que recebem responsabilidade: ativas, da equipe de gestão (não leitura nem autoatendimento); perfil de unidade só em registro da própria unidade ou da rede. */
async function validarUsuarios(ids: (number | null | undefined)[], unitId: number | null, rotulo: string) {
  const xs = [...new Set(ids.filter((x): x is number => !!x))]; if (!xs.length) return;
  const us = await sql<{ id: number; nome: string; role: string; unit_id: number | null }[]>`SELECT id, nome, role, unit_id FROM users WHERE id = ANY(${xs}) AND ativo`;
  for (const id of xs) { const u = us.find(x => x.id === id); if (!u || ["LEITURA", "COLABORADOR"].includes(u.role)) throw new Error(`${rotulo}: escolha uma pessoa ativa da equipe.`);
    if (["DIRETOR_UNIDADE", "GESTOR"].includes(u.role) && unitId !== null && u.unit_id !== unitId) throw new Error(`${rotulo}: ${u.nome} atua em outra unidade.`); }
}
/** Registro ligado (objetivo, indicador, projeto) precisa existir e ser da rede ou da mesma unidade do registro que o cita. */
async function validarRef(tabela: "objectives" | "indicators" | "projects", id: number | null, unitId: number | null, rotulo: string) {
  if (!id) return; const [r] = await sql<{ unit_id: number | null }[]>`SELECT unit_id FROM ${sql(tabela)} WHERE id=${id}`; if (!r) throw new Error(`${rotulo} não encontrado.`);
  if (r.unit_id !== null && r.unit_id !== unitId) throw new Error(`${rotulo} é de outra unidade: ligue a um da rede ou da mesma unidade.`);
}
/** Unidade permitida para criar/editar: quem tem escopo de unidade só atua nela; registros da rede (null) só Direção/RH. */
function unidadePermitida(s: Session, unitId: number | null) {
  const u = scopeUnit(s);
  if (u !== null && unitId !== u) throw new Error("Seu perfil atua apenas na sua unidade.");
  if (unitId === null && !ESTRATEGIA.includes(s.role)) throw new Error("Itens da rede inteira são definidos pela Direção/RH.");
}

// ======================= Identidade institucional =======================
function lerValores(fd: FormData) {
  return linhas(str(fd, "valores")).map(l => { const [nome, ...resto] = l.split("|"); return { nome: nome.trim(), pratica: resto.join("|").trim() }; }).filter(v => v.nome);
}
export async function salvarIdentidade(fd: FormData) {
  const s = await requireSession(); const b = "/estrategia/identidade";
  try { assert(ESTRATEGIA.includes(s.role), "A identidade institucional é mantida pela Direção/RH.");
    const [r] = await sql<{ id: number }[]>`SELECT id FROM strategy_identity WHERE status='RASCUNHO' ORDER BY versao DESC LIMIT 1`; if (!r) throw new Error("Não há rascunho em edição: crie uma nova versão.");
    const valores = lerValores(fd); if (!valores.length) throw new Error("Informe ao menos um valor (um por linha: Valor | prática observável).");
    await db.update(schema.strategyIdentity).set({ missao: strOrNull(fd, "missao"), visao: strOrNull(fd, "visao"), proposito: strOrNull(fd, "proposito"), valores, propostaValor: strOrNull(fd, "propostaValor"), posicionamento: strOrNull(fd, "posicionamento"), horizonte: strOrNull(fd, "horizonte") }).where(eq(schema.strategyIdentity.id, r.id));
    await audit(s, "editar identidade institucional (rascunho)", "strategy_identity", r.id, null, { valores: valores.length });
  } catch (e) { redirect(go(b, "erro", erro(e))); }
  redirect(go(b, "ok", "Rascunho salvo. Publique quando estiver aprovado."));
}
export async function publicarIdentidade() {
  const s = await requireSession(); const b = "/estrategia/identidade";
  try { assert(ESTRATEGIA.includes(s.role), "Publicar a identidade é da Direção/RH.");
    const [r] = await sql<{ id: number; versao: number; missao: string | null; visao: string | null; valores: unknown }[]>`SELECT id, versao, missao, visao, valores FROM strategy_identity WHERE status='RASCUNHO' ORDER BY versao DESC LIMIT 1`; if (!r) throw new Error("Não há rascunho para publicar.");
    if (!r.missao || !r.visao) throw new Error("Preencha missão e visão antes de publicar.");
    const vs = (r.valores as { nome: string; pratica: string }[] | null) ?? []; const semPratica = vs.filter(v => !v.pratica).map(v => v.nome);
    if (semPratica.length) throw new Error(`Descreva a prática observável de cada valor antes de publicar (faltam: ${semPratica.join(", ")}).`);
    await sql`UPDATE strategy_identity SET status='ARQUIVADO' WHERE status='VIGENTE'`;
    await sql`UPDATE strategy_identity SET status='VIGENTE', aprovado_por=${s.id}, aprovado_em=now(), vigencia_inicio=${hoje()} WHERE id=${r.id}`;
    await audit(s, "publicar identidade institucional", "strategy_identity", r.id, null, { versao: r.versao });
  } catch (e) { redirect(go(b, "erro", erro(e))); }
  redirect(go(b, "ok", "Identidade publicada como vigente; a versão anterior foi arquivada."));
}
export async function novaVersaoIdentidade() {
  const s = await requireSession(); const b = "/estrategia/identidade";
  try { assert(ESTRATEGIA.includes(s.role));
    const [rasc] = await sql`SELECT id FROM strategy_identity WHERE status='RASCUNHO'`; if (rasc) throw new Error("Já existe um rascunho em edição.");
    const [v] = await sql<{ versao: number; missao: string | null; visao: string | null; proposito: string | null; valores: unknown; proposta_valor: string | null; posicionamento: string | null; horizonte: string | null }[]>`SELECT versao, missao, visao, proposito, valores, proposta_valor, posicionamento, horizonte FROM strategy_identity ORDER BY versao DESC LIMIT 1`;
    const [n] = await sql<{ id: number }[]>`INSERT INTO strategy_identity (versao, status, missao, visao, proposito, valores, proposta_valor, posicionamento, horizonte, created_by) VALUES (${(v?.versao ?? 0) + 1}, 'RASCUNHO', ${v?.missao ?? null}, ${v?.visao ?? null}, ${v?.proposito ?? null}, ${JSON.stringify(v?.valores ?? [])}::jsonb, ${v?.proposta_valor ?? null}, ${v?.posicionamento ?? null}, ${v?.horizonte ?? null}, ${s.id}) RETURNING id`;
    await audit(s, "nova versão da identidade institucional", "strategy_identity", n.id, null, { versao: (v?.versao ?? 0) + 1 });
  } catch (e) { redirect(go(b, "erro", erro(e))); }
  redirect(go(b, "ok", "Nova versão criada como rascunho; a vigente continua valendo até a publicação."));
}

// ======================= Mapa estratégico =======================
export async function definirPerspectiva(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("objectiveId")); const b = str(fd, "voltar") || "/estrategia/mapa";
  try { const [o] = await db.select().from(schema.objectives).where(eq(schema.objectives.id, id)); if (!o) throw new Error("Objetivo não encontrado.");
    assert(ESTRATEGIA.includes(s.role) || (s.role === "DIRETOR_UNIDADE" && o.unitId !== null && o.unitId === s.unitId), "Só Direção/RH (ou o diretor, nos objetivos da própria unidade) posicionam objetivos no mapa.");
    const cfg = await getSettings(); const p = strOrNull(fd, "perspectiva"); if (p && !(cfg.estrategia.perspectivas as { chave: string }[]).some(x => x.chave === p)) throw new Error("Perspectiva inválida.");
    await db.update(schema.objectives).set({ perspectiva: p }).where(eq(schema.objectives.id, id)); await audit(s, "perspectiva do objetivo", "objectives", id, { perspectiva: o.perspectiva }, { perspectiva: p });
  } catch (e) { redirect(go(b, "erro", erro(e))); }
  redirect(go(b, "ok", "Objetivo posicionado no mapa."));
}
export async function ligarObjetivos(fd: FormData) {
  const s = await requireSession(); const de = Number(fd.get("deObjectiveId")); const para = Number(fd.get("paraObjectiveId")); const b = str(fd, "voltar") || "/estrategia/mapa";
  try { assert(ESTRATEGIA.includes(s.role), "Relações de causa e efeito são definidas pela Direção/RH."); if (!de || !para || de === para) throw new Error("Escolha dois objetivos diferentes.");
    const [ciclos] = await sql<{ n: number }[]>`SELECT count(DISTINCT ciclo)::int AS n FROM objectives WHERE id IN (${de}, ${para})`; if (ciclos.n !== 1) throw new Error("Ligue objetivos do mesmo ciclo.");
    const [inv] = await sql`SELECT 1 FROM objective_links WHERE de_objective_id=${para} AND para_objective_id=${de}`; if (inv) throw new Error("A relação inversa já existe: um objetivo não pode contribuir para quem contribui para ele.");
    // Ciclo indireto (A → B → C → A): parte de "para" seguindo as relações existentes; se chegar em "de", recusa.
    const arestas = await sql<{ de: number; para: number }[]>`SELECT de_objective_id AS de, para_objective_id AS para FROM objective_links`; const fila = [para]; const vistos = new Set<number>([para]);
    while (fila.length) { const x = fila.shift()!; for (const a of arestas.filter(a => a.de === x)) { if (a.para === de) throw new Error("Essa relação criaria um ciclo de causa e efeito: o segundo objetivo já contribui, indiretamente, para o primeiro."); if (!vistos.has(a.para)) { vistos.add(a.para); fila.push(a.para); } } }
    await sql`INSERT INTO objective_links (de_objective_id, para_objective_id) VALUES (${de}, ${para}) ON CONFLICT DO NOTHING`; await audit(s, "ligar objetivos no mapa", "objective_links", null, null, { de, para });
  } catch (e) { redirect(go(b, "erro", erro(e))); }
  redirect(go(b, "ok", "Relação de causa e efeito registrada."));
}
export async function desligarObjetivos(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const b = str(fd, "voltar") || "/estrategia/mapa";
  try { assert(ESTRATEGIA.includes(s.role)); await sql`DELETE FROM objective_links WHERE id=${id}`; await audit(s, "remover relação do mapa", "objective_links", id, null, null); }
  catch (e) { redirect(go(b, "erro", erro(e))); }
  redirect(go(b, "ok", "Relação removida."));
}

// ======================= Indicadores =======================
async function podeEditarIndicador(s: Session, unitId: number | null) {
  if (ESTRATEGIA.includes(s.role)) return;
  if (s.role === "DIRETOR_UNIDADE" && unitId !== null && unitId === s.unitId) return;
  throw new Error("Indicadores são definidos pela Direção/RH (o diretor define os da própria unidade).");
}
export async function salvarIndicador(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id"); let iid = id ?? 0;
  try {
    const cfg = await getSettings(); const unitId = int(fd, "unitId"); await podeEditarIndicador(s, unitId);
    const nome = str(fd, "nome"); if (!nome) throw new Error("Informe o nome do indicador.");
    const direcao = (str(fd, "direcao") || "MAIOR_MELHOR") as Direcao; if (!DIRECAO_IND[direcao]) throw new Error("Direção inválida.");
    const tipo = str(fd, "tipo") || "MANUAL"; if (!["MANUAL", "SISTEMA", "CALCULADO"].includes(tipo)) throw new Error("Tipo inválido.");
    const frequencia = str(fd, "frequencia") || "MENSAL"; if (!FREQ_MESES[frequencia]) throw new Error("Frequência inválida.");
    const perspectiva = strOrNull(fd, "perspectiva"); if (perspectiva && !(cfg.estrategia.perspectivas as { chave: string }[]).some(p => p.chave === perspectiva)) throw new Error("Perspectiva inválida.");
    const conf = { direcao, meta: numero(fd, "meta", "Meta"), alerta: numero(fd, "alerta", "Limite de atenção"), faixaMin: numero(fd, "faixaMin", "Mínimo da faixa"), faixaMax: numero(fd, "faixaMax", "Máximo da faixa") };
    const problemas = validarConfigIndicador(conf); if (problemas.length) throw new Error(problemas.join(" "));
    const fonte = tipo === "SISTEMA" ? str(fd, "fonte") : null; if (tipo === "SISTEMA" && (!fonte || !FONTES[fonte])) throw new Error("Escolha a métrica do sistema que alimenta o indicador.");
    let numeradorId: number | null = null, denominadorId: number | null = null; const fator = numero(fd, "fator", "Fator");
    if (tipo === "CALCULADO") { numeradorId = int(fd, "numeradorId"); denominadorId = int(fd, "denominadorId"); if (!numeradorId || !denominadorId || numeradorId === denominadorId) throw new Error("Indicador calculado precisa de numerador e denominador diferentes.");
      if (id && (numeradorId === id || denominadorId === id)) throw new Error("Um indicador calculado não pode usar a si mesmo.");
      const refs = await sql<{ id: number; tipo: string; unit_id: number | null }[]>`SELECT id, tipo, unit_id FROM indicators WHERE id IN (${numeradorId}, ${denominadorId})`; if (refs.length !== 2) throw new Error("Numerador ou denominador não encontrado."); if (refs.some(r => r.tipo === "CALCULADO")) throw new Error("Use indicadores medidos (manuais ou do sistema) como numerador e denominador.");
      if (refs.some(r => r.unit_id !== null && r.unit_id !== unitId)) throw new Error("Numerador e denominador precisam ser indicadores da rede ou da mesma unidade do indicador calculado."); }
    const funil = str(fd, "funil") === "INVESTIMENTO" ? "INVESTIMENTO" : null; const canal = strOrNull(fd, "canal"); if (canal && !ORIGENS_FUNIL.includes(canal)) throw new Error("Canal inválido.");
    await validarUsuarios([int(fd, "responsavelUserId")], unitId, "Responsável pela medição"); await validarRef("objectives", int(fd, "objectiveId"), unitId, "Objetivo ligado");
    const n = (v: number | null) => v === null ? null : String(v);
    const d = { codigo: strOrNull(fd, "codigo"), nome, descricao: strOrNull(fd, "descricao"), perspectiva, area: strOrNull(fd, "area"), unitId, unidadeMedida: strOrNull(fd, "unidadeMedida"), direcao, meta: n(conf.meta), alerta: n(conf.alerta), faixaMin: n(conf.faixaMin), faixaMax: n(conf.faixaMax), tipo, fonte, numeradorId, denominadorId, fator: n(fator), frequencia, funil, canal, objectiveId: int(fd, "objectiveId"), responsavelUserId: int(fd, "responsavelUserId"), ordem: int(fd, "ordem") ?? 0 };
    if (id) { const [a] = await db.select().from(schema.indicators).where(eq(schema.indicators.id, id)); if (!a) throw new Error("Indicador não encontrado."); await podeEditarIndicador(s, a.unitId);
      await db.update(schema.indicators).set(d).where(eq(schema.indicators.id, id)); await audit(s, "editar indicador", "indicators", id, { meta: a.meta, alerta: a.alerta, direcao: a.direcao, tipo: a.tipo }, { meta: d.meta, alerta: d.alerta, direcao, tipo }); }
    else { const [r] = await db.insert(schema.indicators).values({ ...d, createdBy: s.id }).returning({ id: schema.indicators.id }); iid = r.id; await audit(s, "criar indicador", "indicators", iid, null, { nome, tipo }); }
    if (tipo === "SISTEMA") await atualizarIndicadoresSistema(unitId, true);
  } catch (e) { redirect(go(id ? `/estrategia/indicadores/${id}` : "/estrategia/indicadores", "erro", erro(e))); }
  redirect(go(`/estrategia/indicadores/${iid}`, "ok", "Indicador salvo."));
}
export async function ativarIndicador(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const b = `/estrategia/indicadores/${id}`; const ativo = str(fd, "ativo") === "1";
  try { const [a] = await db.select().from(schema.indicators).where(eq(schema.indicators.id, id)); if (!a) throw new Error("Indicador não encontrado."); await podeEditarIndicador(s, a.unitId);
    await db.update(schema.indicators).set({ ativo }).where(eq(schema.indicators.id, id)); await audit(s, ativo ? "reativar indicador" : "desativar indicador", "indicators", id, null, null); }
  catch (e) { redirect(go(b, "erro", erro(e))); }
  redirect(go(b, "ok", ativo ? "Indicador reativado." : "Indicador desativado (medições preservadas)."));
}
async function checarMedicao(s: Session, indicatorId: number, periodo: string, valor: number | null) {
  const [i] = await db.select().from(schema.indicators).where(eq(schema.indicators.id, indicatorId)); if (!i) throw new Error("Indicador não encontrado.");
  const u = scopeUnit(s); if (u !== null && i.unitId !== null && i.unitId !== u) throw new Error("Indicador fora do seu escopo.");
  const pode = ESTRATEGIA.includes(s.role) || i.responsavelUserId === s.id || (s.role === "DIRETOR_UNIDADE" && i.unitId === s.unitId) || (i.funil === "INVESTIMENTO" && s.role === "COMERCIAL");
  if (!pode) throw new Error(`Só o responsável pelo indicador “${i.nome}” ou a Direção/RH registram medições.`);
  if (i.tipo !== "MANUAL") throw new Error(`“${i.nome}” é ${i.tipo === "SISTEMA" ? "lido do sistema" : "calculado"}: não recebe medição manual.`);
  if (valor !== null && !Number.isFinite(valor)) throw new Error("Valor inválido.");
  if (!validoPeriodo(periodo)) throw new Error("Período inválido (use AAAA-MM)."); if (periodo > periodoDe(hoje())) throw new Error("Não é possível registrar medição de mês futuro.");
  return i;
}
async function gravarMedicao(s: Session, indicatorId: number, periodo: string, valor: number | null, obs: string | null, origem: "MANUAL" | "IMPORTACAO") {
  const i = await checarMedicao(s, indicatorId, periodo, valor);
  const [ant] = await sql<{ valor: number | null }[]>`SELECT valor::float FROM indicator_values WHERE indicator_id=${indicatorId} AND periodo=${periodo}`;
  await sql`INSERT INTO indicator_values (indicator_id, periodo, valor, origem, obs, user_id, user_nome) VALUES (${indicatorId}, ${periodo}, ${valor}, ${origem}, ${obs}, ${s.id}, ${s.nome}) ON CONFLICT (indicator_id, periodo) DO UPDATE SET valor=EXCLUDED.valor, origem=EXCLUDED.origem, obs=EXCLUDED.obs, user_id=EXCLUDED.user_id, user_nome=EXCLUDED.user_nome, updated_at=now()`;
  await audit(s, ant ? "corrigir medição de indicador" : "registrar medição de indicador", "indicators", indicatorId, ant ? { periodo, valor: ant.valor } : null, { periodo, valor });
  return { nome: i.nome, corrigida: !!ant };
}
export async function registrarMedicao(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("indicatorId")); const b = str(fd, "voltar") || `/estrategia/indicadores/${id}`; let msg = "";
  try { const valor = numero(fd, "valor", "Valor"); if (valor === null) throw new Error("Informe o valor medido."); const r = await gravarMedicao(s, id, str(fd, "periodo"), valor, strOrNull(fd, "obs"), "MANUAL"); msg = r.corrigida ? "Medição corrigida (valor anterior registrado na auditoria)." : "Medição registrada."; }
  catch (e) { redirect(go(b, "erro", erro(e))); }
  redirect(go(b, "ok", msg));
}
/** Número como vem do Excel em português: 1.500 e R$ 1.500,00 = mil e quinhentos; 4,8 = quatro vírgula oito; 1.5 = um e meio. */
const numeroBr = (t: string) => { const x = t.trim().replace(/\s/g, "").replace(/^R\$/, ""); if (!x) return null; const v = Number(/,\d{1,4}$/.test(x) ? x.replace(/\./g, "").replace(",", ".") : /^-?\d{1,3}(\.\d{3})+$/.test(x) ? x.replace(/\./g, "") : x.replace(/,/g, "")); return Number.isFinite(v) ? v : null; };
/** Período em AAAA-MM, MM/AAAA ou data DD/MM/AAAA (célula de mês formatada como data no Excel) → AAAA-MM. */
const periodoBr = (t: string) => { const x = t.trim(); let m = x.match(/^(\d{4})-(\d{1,2})(-\d{1,2})?$/); if (m) return `${m[1]}-${m[2].padStart(2, "0")}`; m = x.match(/^(\d{1,2})\/(\d{4})$/); if (m) return `${m[2]}-${m[1].padStart(2, "0")}`; m = x.match(/^\d{1,2}\/(\d{1,2})\/(\d{4})$/); if (m) return `${m[2]}-${m[1].padStart(2, "0")}`; return x; };
/** Importa medições coladas do Excel ou de arquivo: indicador (código ou nome) ; período (AAAA-MM ou MM/AAAA) ; valor. */
export async function importarMedicoes(fd: FormData) {
  const s = await requireSession(); const b = "/estrategia/indicadores"; let msg = "";
  try {
    const texto = await textoImportacao(fd); const rows = texto.split(/\r?\n/).filter(l => l.trim()); if (!rows.length) throw new Error("Cole as medições ou escolha um arquivo.");
    const sep = rows[0].includes("\t") ? "\t" : rows[0].includes(";") ? ";" : ",";
    const u = scopeUnit(s); const inds = await sql<{ id: number; codigo: string | null; nome: string }[]>`SELECT id, codigo, nome FROM indicators WHERE ativo AND tipo='MANUAL' ${u === null ? sql`` : sql`AND (unit_id IS NULL OR unit_id=${u})`}`;
    const achar = (k: string) => { const t = k.trim().toLowerCase(); const porCod = inds.filter(i => i.codigo && i.codigo.toLowerCase() === t); if (porCod.length === 1) return porCod[0]; const porNome = inds.filter(i => i.nome.toLowerCase() === t); return porNome.length === 1 ? porNome[0] : null; };
    let ok = 0; const erros: string[] = [];
    for (const [k, l] of rows.entries()) {
      const c = l.split(sep); if (k === 0 && /indicador|codigo|código/i.test(c[0] ?? "")) continue;
      try { const ind = achar(c[0] ?? ""); if (!ind) throw new Error(`indicador “${(c[0] ?? "").trim()}” não encontrado (use o código ou o nome exato de um indicador manual)`); const v = numeroBr(c[2] ?? ""); if (v === null) throw new Error("valor inválido");
        await gravarMedicao(s, ind.id, periodoBr(c[1] ?? ""), v, "importado de planilha", "IMPORTACAO"); ok++; } catch (e) { erros.push(`Linha ${k + 1}: ${erro(e)}`); }
    }
    msg = `${ok} medição(ões) importada(s).${erros.length ? ` ${erros.length} linha(s) com erro: ${erros.slice(0, 5).join(" · ")}` : ""}`;
  } catch (e) { redirect(go(b, "erro", erro(e))); }
  redirect(go(b, "ok", msg));
}
export async function atualizarSistemaAgora() {
  const s = await requireSession(); let n = 0;
  try { assert(GESTAO.includes(s.role), "Sem permissão."); n = await atualizarIndicadoresSistema(scopeUnit(s), true); }
  catch (e) { redirect(go("/estrategia/indicadores", "erro", erro(e))); }
  redirect(go("/estrategia/indicadores", "ok", `${n} leitura(s) do sistema gravada(s).`));
}
/** Cria um indicador manual de investimento por canal de captação (mesmas origens do cadastro de Matrículas). */
export async function criarInvestimentosMarketing(fd: FormData) {
  const s = await requireSession(); let n = 0; const b = "/estrategia/marketing";
  try { assert(ESTRATEGIA.includes(s.role), "Indicadores de marketing são criados pela Direção/RH."); const resp = int(fd, "responsavelUserId"); await validarUsuarios([resp], null, "Responsável");
    for (const canal of ORIGENS_FUNIL) {
      const [ja] = await sql`SELECT 1 FROM indicators WHERE funil='INVESTIMENTO' AND canal=${canal} AND unit_id IS NULL`; if (ja) continue;
      await db.insert(schema.indicators).values({ codigo: `MKT-INV-${canal}`, nome: `Investimento em captação — ${ORIGEM_LABEL[canal] ?? canal}`, perspectiva: "FINANCEIRA", area: "Matrículas e marketing", unidadeMedida: "R$", direcao: "MENOR_MELHOR", tipo: "MANUAL", frequencia: "MENSAL", funil: "INVESTIMENTO", canal, responsavelUserId: resp, createdBy: s.id }); n++;
    }
    await audit(s, "criar indicadores de investimento em captação", "indicators", null, null, { criados: n });
  } catch (e) { redirect(go(b, "erro", erro(e))); }
  redirect(go(b, "ok", n ? `${n} indicador(es) de investimento criados (um por canal). Registre os valores mensais.` : "Os indicadores de investimento por canal já existiam."));
}

/** Investimento do mês em todos os canais de uma vez. Campo vazio não é gravado (não vira zero); zero só quando digitado. */
export async function registrarInvestimentosMes(fd: FormData) {
  const s = await requireSession(); const periodo = str(fd, "periodo"); const b = `/estrategia/marketing?mes=${encodeURIComponent(periodo)}`; let n = 0;
  try {
    if (!validoPeriodo(periodo)) throw new Error("Escolha o mês (AAAA-MM)."); if (periodo > periodoDe(hoje())) throw new Error("Não é possível registrar investimento de mês futuro.");
    const inds = await sql<{ id: number }[]>`SELECT id FROM indicators WHERE ativo AND funil='INVESTIMENTO' AND tipo='MANUAL' ORDER BY id`;
    const preenchidos: { id: number; v: number }[] = [];
    for (const i of inds) { const v = numero(fd, `inv_${i.id}`, "Investimento"); if (v === null) continue; if (v < 0) throw new Error("Investimento não pode ser negativo."); preenchidos.push({ id: i.id, v }); }
    if (!preenchidos.length) throw new Error("Preencha o investimento de ao menos um canal (campo vazio não é gravado como zero).");
    for (const p of preenchidos) await checarMedicao(s, p.id, periodo, p.v); // tudo ou nada: nenhum canal é gravado se algum não puder ser
    for (const p of preenchidos) { await gravarMedicao(s, p.id, periodo, p.v, strOrNull(fd, "obs"), "MANUAL"); n++; }
  } catch (e) { redirect(go(b, "erro", erro(e))); }
  redirect(go(b, "ok", `${n} investimento(s) registrado(s) para ${periodo.split("-").reverse().join("/")}.`));
}

// ======================= Plano de ação (5W2H) =======================
async function podeMexerAcao(s: Session, a: { responsavelUserId: number | null; createdBy: number | null; unitId: number | null }) {
  if (ESTRATEGIA.includes(s.role) || a.responsavelUserId === s.id || a.createdBy === s.id) return;
  if (s.role === "DIRETOR_UNIDADE" && a.unitId !== null && a.unitId === s.unitId) return;
  throw new Error("Só o responsável, quem criou, o diretor da unidade ou a Direção/RH alteram esta ação.");
}
export async function salvarAcao(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id"); const b = str(fd, "voltar") || "/estrategia/acoes"; let msg = "";
  try { assert(GESTAO.includes(s.role), "Seu perfil não cria ações do plano.");
    const titulo = str(fd, "titulo"); if (!titulo) throw new Error("Descreva o que será feito (o quê).");
    const resp = int(fd, "responsavelUserId"); if (!resp) throw new Error("Defina quem é o responsável (quem)."); const prazo = strOrNull(fd, "prazo"); if (!prazo) throw new Error("Defina o prazo (quando).");
    const inicio = strOrNull(fd, "inicio"); if (inicio && inicio > prazo) throw new Error("O início não pode ser depois do prazo.");
    let unitId = int(fd, "unitId"); const u = scopeUnit(s);
    const [a] = id ? await db.select().from(schema.actionPlans).where(eq(schema.actionPlans.id, id)) : [];
    if (id) { if (!a) throw new Error("Ação não encontrada."); await podeMexerAcao(s, a); if (["CONCLUIDA", "CANCELADA"].includes(a.status)) throw new Error("Ação encerrada não é editada."); }
    // Perfil de unidade: cria e move ações só na própria unidade; editar uma ação da rede (da qual é responsável) mantém a ação na rede.
    if (u !== null && !(a && a.unitId === null && unitId === null)) { unitId = unitId ?? u; if (unitId !== u) throw new Error("Seu perfil cria ações apenas na sua unidade."); }
    const custo = numero(fd, "custoPrevisto", "Custo previsto"); if (custo !== null && custo < 0) throw new Error("Custo não pode ser negativo.");
    const meetingId = id ? null : int(fd, "ritualMeetingId");
    await validarUsuarios([resp], unitId, "Responsável");
    await validarRef("objectives", int(fd, "objectiveId"), unitId, "Objetivo"); await validarRef("indicators", int(fd, "indicatorId"), unitId, "Indicador"); await validarRef("projects", int(fd, "projectId"), unitId, "Projeto");
    if (meetingId) { const [m] = await sql<{ ritual_id: number }[]>`SELECT ritual_id FROM ritual_meetings WHERE id=${meetingId}`; if (!m) throw new Error("Reunião não encontrada.");
      const [rt] = await db.select().from(schema.rituals).where(eq(schema.rituals.id, m.ritual_id)); await podeGerirRitual(s, rt!, true); if (rt!.unitId !== null && rt!.unitId !== unitId) throw new Error("O encaminhamento precisa ser da unidade do ritual."); }
    const d = { titulo, porque: strOrNull(fd, "porque"), unitId, local: strOrNull(fd, "local"), inicio, prazo, responsavelUserId: resp, como: strOrNull(fd, "como"), custoPrevisto: custo === null ? null : String(custo), objectiveId: int(fd, "objectiveId"), indicatorId: int(fd, "indicatorId"), projectId: int(fd, "projectId"), origem: strOrNull(fd, "origem"), updatedAt: new Date() };
    if (id && a) {
      await db.update(schema.actionPlans).set(d).where(eq(schema.actionPlans.id, id)); await audit(s, "editar ação do plano", "action_plans", id, { prazo: a.prazo, responsavel: a.responsavelUserId }, { prazo, responsavel: resp }); msg = "Ação atualizada."; }
    else { const [r] = await db.insert(schema.actionPlans).values({ ...d, ritualMeetingId: meetingId, createdBy: s.id }).returning({ id: schema.actionPlans.id }); await audit(s, "criar ação do plano", "action_plans", r.id, null, { titulo, prazo });
      if (resp !== s.id) await notificar([resp], "Ação sob sua responsabilidade", `${titulo} — prazo ${prazo.split("-").reverse().join("/")}`, "/estrategia/acoes?minhas=1", "ACAO", `acao:${r.id}`); msg = "Ação criada."; }
  } catch (e) { redirect(go(b, "erro", erro(e))); }
  redirect(go(b, "ok", msg));
}
export async function moverAcao(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const para = str(fd, "para"); const b = str(fd, "voltar") || "/estrategia/acoes"; let msg = "";
  try { const [a] = await db.select().from(schema.actionPlans).where(eq(schema.actionPlans.id, id)); if (!a) throw new Error("Ação não encontrada."); await podeMexerAcao(s, a);
    const upd: Partial<typeof schema.actionPlans.$inferInsert> = { updatedAt: new Date() };
    switch (para) {
      case "EM_ANDAMENTO": if (a.status !== "A_FAZER") throw new Error("Só ações a fazer podem ser iniciadas."); upd.status = "EM_ANDAMENTO"; msg = "Ação iniciada."; break;
      case "BLOQUEADA": { if (!["A_FAZER", "EM_ANDAMENTO"].includes(a.status)) throw new Error("A ação não está em execução."); const bq = str(fd, "bloqueio"); if (!bq) throw new Error("Descreva o que falta e de quem depende."); upd.status = "BLOQUEADA"; upd.bloqueio = bq; upd.bloqueioDesde = hoje(); msg = "Ação bloqueada: aparece como bloqueio institucional, não como atraso do responsável."; break; }
      case "DESBLOQUEAR": if (a.status !== "BLOQUEADA") throw new Error("A ação não está bloqueada."); upd.status = "EM_ANDAMENTO"; upd.bloqueio = null; upd.bloqueioDesde = null; msg = "Ação retomada (o bloqueio fica na auditoria)."; break;
      case "CONCLUIR": { if (!["A_FAZER", "EM_ANDAMENTO"].includes(a.status)) throw new Error("A ação não está em execução."); const ev = str(fd, "evidencia"); if (!ev) throw new Error("Concluir exige a evidência do que foi feito."); const cr = numero(fd, "custoReal", "Custo real"); if (cr !== null && cr < 0) throw new Error("Custo não pode ser negativo.");
        upd.status = "CONCLUIDA"; upd.evidencia = ev; upd.concluidaEm = hoje(); if (cr !== null) upd.custoReal = String(cr); msg = "Ação concluída. Concluir a ação não comprova, por si, o resultado esperado — acompanhe no indicador ou objetivo ligado."; break; }
      case "CANCELAR": { if (!["A_FAZER", "EM_ANDAMENTO", "BLOQUEADA"].includes(a.status)) throw new Error("A ação já está encerrada."); const j = str(fd, "justificativa"); if (!j) throw new Error("Cancelar exige justificativa."); upd.status = "CANCELADA"; upd.cancelJustificativa = j; msg = "Ação cancelada (sai das contas de execução; o histórico fica preservado)."; break; }
      default: throw new Error("Transição inválida.");
    }
    await db.update(schema.actionPlans).set(upd).where(eq(schema.actionPlans.id, id)); await audit(s, "situação da ação do plano", "action_plans", id, { status: a.status }, { status: upd.status, bloqueio: upd.bloqueio ?? null });
    if (para === "BLOQUEADA" && a.createdBy && a.createdBy !== s.id) await notificar([a.createdBy], "Ação do plano bloqueada", `${a.titulo}: ${upd.bloqueio}`, "/estrategia/acoes?situacao=BLOQUEADA", "ACAO", `acaobq:${id}:${hoje()}`);
  } catch (e) { redirect(go(b, "erro", erro(e))); }
  redirect(go(b, "ok", msg));
}

// ======================= Rituais de gestão =======================
async function podeGerirRitual(s: Session, r: { donoUserId: number | null; unitId: number | null; participantes: unknown }, registrar = false) {
  if (ESTRATEGIA.includes(s.role) || r.donoUserId === s.id) return;
  if (s.role === "DIRETOR_UNIDADE" && r.unitId !== null && r.unitId === s.unitId) return;
  if (registrar && ((r.participantes as number[] | null) ?? []).includes(s.id)) return;
  throw new Error(registrar ? "Só o dono, os participantes, o diretor da unidade ou a Direção/RH registram reuniões deste ritual." : "Só o dono do ritual, o diretor da unidade ou a Direção/RH alteram o ritual.");
}
function lerRitual(fd: FormData) {
  const tipo = (str(fd, "tipo") || "MENSAL") as TipoRitual; if (!RITUAL_TIPO[tipo]) throw new Error("Cadência inválida.");
  const nome = str(fd, "nome"); if (!nome) throw new Error("Dê um nome ao ritual.");
  return { nome, tipo, finalidade: strOrNull(fd, "finalidade"), unitId: int(fd, "unitId"), donoUserId: int(fd, "donoUserId"), participantes: idsDe(fd, "participantes"), pautaPadrao: strOrNull(fd, "pautaPadrao"), indicadores: idsDe(fd, "indicadores"), objetivos: idsDe(fd, "objetivos"), duracaoMin: int(fd, "duracaoMin"), proximaData: strOrNull(fd, "proximaData") };
}
export async function salvarRitual(fd: FormData) {
  const s = await requireSession(); const id = int(fd, "id"); let rid = id ?? 0;
  try { assert(GESTAO.includes(s.role), "Seu perfil não cria rituais de gestão."); const d = lerRitual(fd); if (!d.donoUserId) throw new Error("Defina o dono (facilitador) do ritual."); if (!d.proximaData) throw new Error("Defina a data da próxima reunião.");
    await validarUsuarios([d.donoUserId, ...d.participantes], d.unitId, "Participantes");
    // Ritual de unidade revisa o que é da rede ou da unidade; perfil de unidade só escolhe o que enxerga
    const lim = d.unitId ?? scopeUnit(s);
    if (lim !== null) for (const [tab, xs, rot] of [["indicators", d.indicadores, "Indicadores"], ["objectives", d.objetivos, "Objetivos"]] as const) { if (!xs.length) continue; const [c] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ${sql(tab)} WHERE id = ANY(${xs}) AND (unit_id IS NULL OR unit_id=${lim})`; if (c.n !== xs.length) throw new Error(`${rot} do ritual precisam ser da rede ou da unidade.`); }
    if (id) { const [a] = await db.select().from(schema.rituals).where(eq(schema.rituals.id, id)); if (!a) throw new Error("Ritual não encontrado."); await podeGerirRitual(s, a); if (d.unitId !== a.unitId) unidadePermitida(s, d.unitId);
      await db.update(schema.rituals).set({ ...d, ativo: str(fd, "ativo") !== "0" }).where(eq(schema.rituals.id, id)); await audit(s, "editar ritual de gestão", "rituals", id, { tipo: a.tipo, dono: a.donoUserId, proxima: a.proximaData }, { tipo: d.tipo, dono: d.donoUserId, proxima: d.proximaData }); }
    else { unidadePermitida(s, d.unitId); const [r] = await db.insert(schema.rituals).values({ ...d, createdBy: s.id }).returning({ id: schema.rituals.id }); rid = r.id; await audit(s, "criar ritual de gestão", "rituals", rid, null, { nome: d.nome, tipo: d.tipo });
      await notificar(d.participantes.filter(p => p !== s.id), `Você participa do ritual “${d.nome}”`, `${RITUAL_TIPO[d.tipo]} · próxima reunião em ${d.proximaData.split("-").reverse().join("/")}`, `/estrategia/rituais/${rid}`, "INFO", `ritual:${rid}`); }
  } catch (e) { redirect(go(id ? `/estrategia/rituais/${id}` : "/estrategia/rituais", "erro", erro(e))); }
  redirect(go(`/estrategia/rituais/${rid}`, "ok", "Ritual salvo."));
}
export async function criarRitualDeModelo(fd: FormData) {
  const s = await requireSession(); let rid = 0;
  try { assert(GESTAO.includes(s.role), "Seu perfil não cria rituais de gestão."); const cfg = await getSettings();
    const m = (cfg.estrategia.modelosRituais as { chave: string; nome: string; tipo: TipoRitual; duracaoMin: number; finalidade: string; pauta: string }[]).find(x => x.chave === str(fd, "modelo")); if (!m) throw new Error("Escolha um modelo.");
    const unitId = int(fd, "unitId") ?? scopeUnit(s); unidadePermitida(s, unitId); const proxima = str(fd, "proximaData") || hoje();
    const [r] = await db.insert(schema.rituals).values({ nome: m.nome, tipo: m.tipo, finalidade: m.finalidade, pautaPadrao: m.pauta, duracaoMin: m.duracaoMin, unitId, donoUserId: s.id, participantes: [s.id], indicadores: [], objetivos: [], proximaData: proxima, createdBy: s.id }).returning({ id: schema.rituals.id }); rid = r.id;
    await audit(s, "criar ritual de gestão (modelo)", "rituals", rid, null, { modelo: m.chave });
  } catch (e) { redirect(go("/estrategia/rituais", "erro", erro(e))); }
  redirect(go(`/estrategia/rituais/${rid}`, "ok", "Ritual criado a partir do modelo. Defina participantes e indicadores revisados."));
}
export async function registrarReuniao(fd: FormData) {
  const s = await requireSession(); const rid = Number(fd.get("ritualId")); let mid = 0; let msg = "";
  try { const [r] = await db.select().from(schema.rituals).where(eq(schema.rituals.id, rid)); if (!r) throw new Error("Ritual não encontrado."); await podeGerirRitual(s, r, true);
    const data = str(fd, "data"); if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error("Informe a data da reunião.");
    const status = str(fd, "status") === "CANCELADA" ? "CANCELADA" : "REALIZADA";
    if (status === "REALIZADA" && data > hoje()) throw new Error("Reunião realizada não pode ter data futura.");
    const motivo = strOrNull(fd, "cancelMotivo"); if (status === "CANCELADA" && !motivo) throw new Error("Informe o motivo do cancelamento.");
    const [dup] = await sql`SELECT 1 FROM ritual_meetings WHERE ritual_id=${rid} AND data=${data} AND status=${status}`; if (dup) throw new Error("Já existe um registro deste ritual nesta data.");
    // Encaminhamentos validados antes de gravar qualquer coisa (nada fica pela metade se faltar responsável ou prazo)
    const encs: { titulo: string; resp: number; prazo: string }[] = [];
    if (status === "REALIZADA") for (let k = 0; k < 6; k++) {
      const t = str(fd, `enc_titulo_${k}`); if (!t) continue; const resp = int(fd, `enc_resp_${k}`); const pz = strOrNull(fd, `enc_prazo_${k}`);
      if (!resp || !pz) throw new Error(`Encaminhamento “${t}”: defina responsável e prazo.`); if (pz < data) throw new Error(`Encaminhamento “${t}”: o prazo não pode ser antes da reunião.`);
      encs.push({ titulo: t, resp, prazo: pz });
    }
    const lista = new Set([...((r.participantes as number[] | null) ?? []), ...(r.donoUserId ? [r.donoUserId] : [])]); const presentes = idsDe(fd, "presentes");
    if (presentes.some(p => !lista.has(p))) throw new Error("Marque como presentes só o dono e os participantes do ritual (inclua a pessoa no ritual antes).");
    await validarUsuarios(encs.map(e => e.resp), r.unitId, "Responsável do encaminhamento");
    let snapshot: unknown[] = [];
    if (status === "REALIZADA" && ((r.indicadores as number[] | null) ?? []).length) snapshot = (await listarIndicadores(r.unitId, { ids: r.indicadores as number[] })).map(i => ({ id: i.id, nome: i.nome, unit_id: i.unit_id, periodo: i.ultimoPeriodo, valor: i.ultimoValor, unidade: i.unidade_medida, farol: i.farol }));
    // Próxima data pela cadência, sem voltar no tempo ao registrar uma reunião antiga esquecida
    const calc = proximaData(data, r.tipo as TipoRitual); const prox = r.proximaData && r.proximaData > calc ? r.proximaData : calc;
    const decisoes = status === "REALIZADA" ? linhas(str(fd, "decisoes")) : []; const area = str(fd, "areaDecisao") || "Direção e Governança"; const brData = data.split("-").reverse().join("/");
    const acoes: { id: number; e: { titulo: string; resp: number; prazo: string } }[] = [];
    await sql.begin(async tx => { // tudo ou nada: reunião, próxima data, decisões e encaminhamentos
      const [m] = await tx<{ id: number }[]>`INSERT INTO ritual_meetings (ritual_id, data, status, presentes, pauta, ata, indicadores_snapshot, cancel_motivo, created_by) VALUES (${rid}, ${data}, ${status}, ${JSON.stringify(presentes)}::jsonb, ${strOrNull(fd, "pauta")}, ${strOrNull(fd, "ata")}, ${JSON.stringify(snapshot)}::jsonb, ${motivo}, ${s.id}) RETURNING id`; mid = m.id;
      await tx`UPDATE rituals SET proxima_data=${prox} WHERE id=${rid}`;
      for (const t of decisoes) await tx`INSERT INTO decisions (data, titulo, area, unit_id, contexto, decisao, responsavel_user_id, status, ritual_meeting_id) VALUES (${data}, ${t.slice(0, 200)}, ${area}, ${r.unitId}, ${`Decidido no ritual “${r.nome}” em ${brData}`}, ${t}, ${r.donoUserId}, 'VIGENTE', ${mid})`;
      for (const e of encs) { const [a] = await tx<{ id: number }[]>`INSERT INTO action_plans (titulo, porque, unit_id, prazo, responsavel_user_id, ritual_meeting_id, origem, created_by) VALUES (${e.titulo}, ${`Encaminhamento do ritual “${r.nome}” (${brData})`}, ${r.unitId}, ${e.prazo}, ${e.resp}, ${mid}, ${`Ritual: ${r.nome}`}, ${s.id}) RETURNING id`; acoes.push({ id: a.id, e }); }
    });
    const nDec = decisoes.length, nEnc = acoes.length;
    for (const { id: aid, e } of acoes) if (e.resp !== s.id) await notificar([e.resp], "Encaminhamento de reunião sob sua responsabilidade", `${e.titulo} — prazo ${e.prazo.split("-").reverse().join("/")}`, "/estrategia/acoes?minhas=1", "ACAO", `acao:${aid}`);
    await audit(s, status === "REALIZADA" ? "registrar reunião de ritual" : "registrar cancelamento de reunião", "ritual_meetings", mid, null, { ritual: rid, data, decisoes: nDec, encaminhamentos: nEnc, proxima: prox });
    msg = status === "REALIZADA" ? `Reunião registrada${nDec ? ` · ${nDec} decisão(ões) no Decision Log` : ""}${nEnc ? ` · ${nEnc} encaminhamento(s) no plano de ação` : ""}. Próxima: ${prox.split("-").reverse().join("/")}.` : `Cancelamento registrado. Próxima: ${prox.split("-").reverse().join("/")}.`;
  } catch (e) { redirect(go(`/estrategia/rituais/${rid}`, "erro", erro(e))); }
  redirect(go(`/estrategia/reunioes/${mid}`, "ok", msg));
}
export async function salvarAta(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const b = `/estrategia/reunioes/${id}`;
  try { const [m] = await db.select().from(schema.ritualMeetings).where(eq(schema.ritualMeetings.id, id)); if (!m) throw new Error("Reunião não encontrada."); const [r] = await db.select().from(schema.rituals).where(eq(schema.rituals.id, m.ritualId)); await podeGerirRitual(s, r!, true);
    if (m.status !== "REALIZADA") throw new Error("Reunião cancelada não tem ata."); const ata = str(fd, "ata"); if (!ata) throw new Error("Escreva a ata.");
    await db.update(schema.ritualMeetings).set({ ata, updatedAt: new Date() }).where(eq(schema.ritualMeetings.id, id)); await audit(s, m.ata ? "corrigir ata de reunião" : "registrar ata de reunião", "ritual_meetings", id, m.ata ? { caracteres: m.ata.length } : null, { caracteres: ata.length });
  } catch (e) { redirect(go(b, "erro", erro(e))); }
  redirect(go(b, "ok", "Ata registrada."));
}
export async function decisaoDaReuniao(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("meetingId")); const b = `/estrategia/reunioes/${id}`;
  try { const [m] = await db.select().from(schema.ritualMeetings).where(eq(schema.ritualMeetings.id, id)); if (!m) throw new Error("Reunião não encontrada."); const [r] = await db.select().from(schema.rituals).where(eq(schema.rituals.id, m.ritualId)); await podeGerirRitual(s, r!, true);
    if (m.status !== "REALIZADA") throw new Error("Reunião cancelada não registra decisões."); const titulo = str(fd, "titulo"), decisao = str(fd, "decisao"); if (!titulo || !decisao) throw new Error("Informe o título e a decisão.");
    await validarUsuarios([int(fd, "responsavelUserId")], r!.unitId, "Responsável");
    const [d] = await sql<{ id: number }[]>`INSERT INTO decisions (data, titulo, area, unit_id, contexto, decisao, alternativas, responsavel_user_id, status, revisar_em, ritual_meeting_id) VALUES (${m.data}, ${titulo}, ${str(fd, "area") || "Direção e Governança"}, ${r!.unitId}, ${strOrNull(fd, "contexto") ?? `Decidido no ritual “${r!.nome}”`}, ${decisao}, ${strOrNull(fd, "alternativas")}, ${int(fd, "responsavelUserId") ?? r!.donoUserId}, 'VIGENTE', ${strOrNull(fd, "revisarEm")}, ${id}) RETURNING id`;
    await audit(s, "registrar decisão de reunião", "decisions", d.id, null, { meeting: id, titulo });
  } catch (e) { redirect(go(b, "erro", erro(e))); }
  redirect(go(b, "ok", "Decisão registrada no Decision Log."));
}

// ======================= Parâmetros (Configurações) =======================
/** Ciclo, pilares, perspectivas, pesos e faixas da saúde estratégica, tolerâncias dos rituais e áreas de indicador. */
export async function salvarParamEstrategia(fd: FormData) {
  const s = await requireSession(); const b = "/configuracoes";
  try { assert(ESTRATEGIA.includes(s.role), "Parâmetros da estratégia são da Direção/RH."); const cfg = await getSettings(); const e = cfg.estrategia;
    const lista = (k: string, fb: string[]) => { const v = linhas(str(fd, k)); return v.length ? v : fb; };
    const inteiro = (k: string, fb: number, min: number, max: number, rotulo: string) => { const v = int(fd, k) ?? fb; if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${rotulo}: entre ${min} e ${max}.`); return v; };
    const pilares = lista("pilares", e.pilares as string[]);
    const perspectivas = (e.perspectivas as { chave: string; nome: string; descricao: string }[]).map(p => ({ chave: p.chave, nome: str(fd, `persp_nome_${p.chave}`) || p.nome, descricao: str(fd, `persp_desc_${p.chave}`) || p.descricao }));
    const chaves = new Set(perspectivas.map(p => p.chave)); const mapa: Record<string, string> = {};
    for (let i = 0; i < 40; i++) { const pilar = str(fd, `mapaPilar_${i}`); if (!pilar) continue; const ch = str(fd, `mapa_${i}`); if (ch && chaves.has(ch) && pilares.includes(pilar)) mapa[pilar] = ch; }
    const pesos: Record<string, number> = {}; for (const k of ["okrs", "indicadores", "projetos", "acoes", "rituais"]) pesos[k] = inteiro(`peso_${k}`, (e.pesosSaude as Record<string, number>)[k] ?? 0, 0, 100, `Peso de ${k}`);
    if (!Object.values(pesos).some(v => v > 0)) throw new Error("Ao menos um componente da saúde estratégica precisa de peso.");
    const fa = inteiro("faixaAtencao", (e.faixasSaude as number[])[0], 1, 99, "Início da faixa de atenção"), fb = inteiro("faixaBoa", (e.faixasSaude as number[])[1], 2, 100, "Início da faixa boa"); if (fa >= fb) throw new Error("A faixa boa precisa começar acima da faixa de atenção.");
    const novo = { ...e, cicloAtual: str(fd, "cicloAtual") || e.cicloAtual, pilares, atualizacaoProjetoDias: inteiro("atualizacaoProjetoDias", e.atualizacaoProjetoDias, 1, 120, "Status report de projeto"), perspectivas, perspectivaDoPilar: mapa, pesosSaude: pesos, faixasSaude: [fa, fb],
      toleranciaRitualDias: inteiro("toleranciaRitualDias", e.toleranciaRitualDias, 0, 30, "Tolerância do ritual"), ataPendenteDias: inteiro("ataPendenteDias", e.ataPendenteDias, 0, 30, "Ata pendente"), areasIndicador: lista("areasIndicador", e.areasIndicador as string[]) };
    await sql`INSERT INTO settings (key, value) VALUES ('estrategia', ${JSON.stringify(novo)}::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`;
    await audit(s, "editar", "settings", null, { pesosSaude: e.pesosSaude, faixasSaude: e.faixasSaude, cicloAtual: e.cicloAtual }, { pesosSaude: pesos, faixasSaude: [fa, fb], cicloAtual: novo.cicloAtual });
  } catch (e) { redirect(go(b, "erro", erro(e)) + "#estrategia"); }
  redirect(go(b, "ok", "Parâmetros da estratégia salvos.") + "#estrategia");
}

// ======================= Assistente estratégico (IA como apoio) =======================
const PODE_ASSISTENTE = ["DIRECAO", "RH", "DIRETOR_UNIDADE"];
/** Gera um rascunho a partir dos fatos do painel. Sem AI_API_KEY nada é gerado nem simulado. Revisão humana obrigatória. */
export async function gerarAssistente(fd: FormData) {
  const s = await requireSession(); const b = "/estrategia/assistente"; let msg = "";
  try { assert(PODE_ASSISTENTE.includes(s.role), "O assistente estratégico é da Direção/RH e dos diretores de unidade.");
    const tarefa = str(fd, "tarefa"); if (!TAREFAS_ESTRATEGIA[tarefa]) throw new Error("Escolha o que o assistente deve preparar.");
    const u = scopeUnit(s); const [un] = u === null ? [] : await sql<{ nome: string }[]>`SELECT nome FROM units WHERE id=${u}`;
    const fatos = await fatosEstrategicos(u); const p = montarPromptEstrategia(tarefa, un?.nome ?? "rede inteira", fatos);
    if (p.semDados) throw new Error("Sem fatos no painel: a IA não foi acionada.");
    const r = await chamarIA(p.sistema, p.usuario); const v = validarRespostaIA(r.texto, fatos.map(f => f.id));
    const [d] = await db.insert(schema.strategyAiDrafts).values({ tarefa, unitId: u, modelo: r.modelo, configVersao: CONFIG_IA_ESTRATEGIA, fontes: fatos, texto: v.texto, alertas: v.alertas, createdBy: s.id }).returning({ id: schema.strategyAiDrafts.id });
    await audit(s, "rascunho do assistente estratégico", "strategy_ai_drafts", d.id, null, { tarefa, fatos: fatos.length, alertas: v.alertas.length, modelo: r.modelo });
    msg = `Rascunho gerado com ${fatos.length} fato(s) citáveis — revisão humana obrigatória; nada foi alterado.`;
  } catch (e) { redirect(go(b, "erro", erro(e))); }
  redirect(go(b, "ok", msg));
}
export async function decidirAssistente(fd: FormData) {
  const s = await requireSession(); const id = Number(fd.get("id")); const b = "/estrategia/assistente";
  try { const [d] = await db.select().from(schema.strategyAiDrafts).where(eq(schema.strategyAiDrafts.id, id)); if (!d) throw new Error("Rascunho não encontrado.");
    const u = scopeUnit(s); if (u !== null && d.unitId !== u) throw new Error("Rascunho de outro escopo.");
    assert(ESTRATEGIA.includes(s.role) || d.createdBy === s.id, "Só quem gerou ou a Direção/RH decidem o rascunho."); if (d.status !== "RASCUNHO") throw new Error("Rascunho já decidido.");
    const aprovar = str(fd, "decisao") === "APROVAR";
    await db.update(schema.strategyAiDrafts).set(aprovar ? { status: "APROVADO", texto: str(fd, "texto") || d.texto, aprovadoPor: s.id, aprovadoEm: new Date() } : { status: "DESCARTADO" }).where(eq(schema.strategyAiDrafts.id, id));
    await audit(s, aprovar ? "aprovar rascunho do assistente (versão revisada)" : "descartar rascunho do assistente", "strategy_ai_drafts", id, null, null);
  } catch (e) { redirect(go(b, "erro", erro(e))); }
  redirect(go(b, "ok", "Decisão registrada. O texto aprovado é referência para a Direção; não altera nenhum dado."));
}
