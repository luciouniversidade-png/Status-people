"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, can, assert } from "@/lib/auth";
import { audit, str, erroMsg, getSettings } from "@/lib/utils";
import { TIPOS_DOC } from "@/lib/folha-calc";

const ok = (msg: string, tab: string) => `/configuracoes?ok=${encodeURIComponent(msg)}#${tab}`;
const erro = (e: unknown, tab: string) => `/configuracoes?erro=${erroMsg(e)}#${tab}`;
const linhas = (t: string) => t.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
const num = (fd: FormData, k: string, min: number, max: number, rotulo: string) => { const v = Number(str(fd, k).replace(",", ".")); if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${rotulo}: use um número entre ${min} e ${max}.`); return v; };
const PERFIS = ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "COMERCIAL", "FINANCEIRO", "OPERACOES", "LEITURA"];

/** Parâmetros da Nova Arquitetura (v24), uma seção por vez — validação por seção e trilha na auditoria. Pesos/limites que mudam regra: só a Direção. */
export async function salvarParametrosV24(fd: FormData) {
  const s = await requireSession(); const secao = str(fd, "secao"); const tab = `v24-${secao}`; let msg = "Parâmetros salvos.";
  try {
    assert(can.configurar(s), "Só Direção e RH configuram."); const cfg = await getSettings(); const grava: [string, unknown][] = [];
    if (secao === "alertas") {
      const donos: Record<string, string[]> = {}; for (const m of Object.keys(cfg.alertas.donos as Record<string, string[]>)) { const v = str(fd, `donos_${m}`).split(/[,;\s]+/).map(x => x.trim().toUpperCase()).filter(Boolean); assert(v.every(x => PERFIS.includes(x)), `Atuação desconhecida em ${m}.`); donos[m] = v; }
      const donoUsuario: Record<string, number> = {}; for (const m of Object.keys(donos)) { const u = Number(str(fd, `fixo_${m}`)); if (u) donoUsuario[m] = u; }
      grava.push(["alertas", { ...cfg.alertas, slaHoras: { ALTO: num(fd, "slaAlto", 1, 720, "SLA crítico (h)"), MEDIO: num(fd, "slaMedio", 1, 2160, "SLA atenção (h)") }, reabrirTratadoDias: Math.round(num(fd, "reabrir", 1, 90, "Reabrir tratado (dias)")), donos, donoUsuario }]);
    } else if (secao === "aprovacoes") {
      assert(s.role === "DIRECAO", "Limites de aprovação em lote: só a Direção altera.");
      grava.push(["aprovacoes", { ...cfg.aprovacoes, limiteHeMensalMin: Math.round(num(fd, "limiteHeH", 0, 100, "Limite de HE no mês (h)") * 60), maxLancamentoMin: Math.round(num(fd, "maxLancH", 0.5, 24, "Maior lançamento no lote (h)") * 60), feriasMinimoPresentesPct: Math.round(num(fd, "minPres", 0, 100, "Mínimo de presentes (%)")) }]);
      grava.push(["quadro", { ...cfg.quadro, jornadaPlenaMin: Math.round(num(fd, "jornadaPlena", 60, 720, "Jornada plena (min)")) }]);
      grava.push(["ponto", { ...cfg.ponto, inicioPadrao: /^\d{2}:\d{2}$/.test(str(fd, "inicioPadrao")) ? str(fd, "inicioPadrao") : "07:00", toleranciaNoShowMin: Math.round(num(fd, "tolerancia", 0, 120, "Tolerância do no-show (min)")) }]);
    } else if (secao === "folha") {
      assert(s.role === "DIRECAO" || s.role === "RH", "Folha: Direção ou RH.");
      const docs = fd.getAll("docs").map(String).filter(d => !!(TIPOS_DOC as Record<string, string>)[d]);
      grava.push(["folha", { ...cfg.folha, variacaoMaxPct: num(fd, "variacao", 0, 50, "Variação máxima (%)"), amostraHolerites: Math.round(num(fd, "amostra", 0, 50, "Amostra de holerites")), docsObrigatorios: docs, exigirLockTodas: str(fd, "lock") === "1" }]);
    } else if (secao === "obrigacoes") {
      const modelos = linhas(str(fd, "modelos")).map(l => { const [tipo, dia] = l.split("|").map(x => x.trim()); assert(!!tipo, "Cada linha: tipo | dia do vencimento (ou vazio)."); const d = dia ? Number(dia) : null; assert(d === null || (d >= 1 && d <= 31), `Dia inválido em ${tipo}.`); return { tipo, dia: d }; });
      const avisos = str(fd, "avisos").split(/[,;\s]+/).map(Number).filter(n => Number.isFinite(n) && n >= 0 && n <= 60);
      grava.push(["obrigacoes", { ...cfg.obrigacoes, modelos, avisosDias: avisos.length ? [...new Set(avisos)].sort((a, b) => b - a) : [7, 3, 0] }]);
    } else if (secao === "sst") {
      grava.push(["sst", { ...cfg.sst, asoMesesPadrao: Math.round(num(fd, "aso", 1, 60, "Periodicidade do ASO (meses)")), exigirAsoAdmissional: str(fd, "admissional") === "1", areasCursos: linhas(str(fd, "areas")), investigacaoDias: Math.round(num(fd, "investigacao", 1, 90, "Prazo da investigação (dias)")), afastamentoRetornoDias: Math.round(num(fd, "retorno", 1, 365, "ASO de retorno (dias)")), dispensaDemissionalDias: Math.round(num(fd, "dispensa", 0, 365, "Dispensa do demissional (dias)")) }]);
    } else if (secao === "financeiro") {
      assert(["DIRECAO", "FINANCEIRO"].includes(s.role) || s.role === "RH", "Financeiro: Direção ou Financeiro.");
      const min = num(fd, "faixaMin", 0, 100, "Banda mínima (%)"), max = num(fd, "faixaMax", 100, 200, "Banda máxima (%)");
      const donosCategoria: Record<string, number> = {}; for (const c of cfg.financeiro.categoriasSaida as string[]) { const u = Number(str(fd, `dono_${c}`)); if (u) donosCategoria[c] = u; }
      const doBanco = await sql<{ c: string }[]>`SELECT DISTINCT categoria AS c FROM cash_entries WHERE categoria IS NOT NULL`;
      const d0 = cfg.dre as Record<string, string[]>; const cats = new Set([...(cfg.financeiro.categoriasSaida as string[]), ...(cfg.financeiro.categoriasEntrada as string[]), ...d0.deducoes, ...d0.pessoal, ...d0.financeiras, ...d0.internas, ...doBanco.map(x => x.c)]);
      const lista = (k: string) => fd.getAll(k).map(String).filter(x => cats.has(x));
      grava.push(["orcamento", { ...cfg.orcamento, faixaMinPct: min, faixaMaxPct: max, donosCategoria }]);
      grava.push(["dre", { ...cfg.dre, deducoes: lista("deducoes"), pessoal: lista("pessoal"), financeiras: lista("financeiras"), internas: lista("internas") }]);
      const pc = num(fd, "pConf", 0, 1, "Peso matrícula"), pr = num(fd, "pRes", 0, 1, "Peso reserva"), pf = num(fd, "pFila", 0, 1, "Peso fila");
      grava.push(["board", { ...cfg.board, pesosFunil: { CONFIRMADA: pc, RESERVADA: pr, FILA: pf } }]);
    } else if (secao === "acao") {
      const docs = linhas(str(fd, "documentos")).map(l => { const [tipo, meses] = l.split("|").map(x => x.trim()); assert(!!tipo, "Cada linha: documento | validade em meses (ou vazio)."); const m = meses ? Number(meses) : null; assert(m === null || (m >= 1 && m <= 120), `Validade inválida em ${tipo}.`); return { tipo, validadeMeses: m }; });
      assert(docs.length > 0, "Informe ao menos um documento.");
      grava.push(["acaoRequerida", { ...cfg.acaoRequerida, documentos: docs, vencendoDias: Math.round(num(fd, "vencendo", 1, 180, "Janela de vencimento (dias)")), reservaHoras: Math.round(num(fd, "reservaH", 1, 240, "Reservas vencendo (h)")) }]);
    } else if (secao === "onboarding") {
      const modelo = linhas(str(fd, "modelo")).map(l => { const [m, titulo, tipo, resp] = l.split("|").map(x => x.trim()); const marco = Number(m); assert([7, 30, 60, 90].includes(marco), `Marco ${m}: use 7, 30, 60 ou 90.`); assert(!!titulo, "Cada linha: marco | título | tipo | responsável."); return { marco, titulo, tipo: ["TAREFA", "TRILHA", "CHECKIN", "PESQUISA"].includes((tipo ?? "").toUpperCase()) ? tipo.toUpperCase() : "TAREFA", responsavel: ["RH", "GESTOR", "BUDDY", "NOVATO"].includes((resp ?? "").toUpperCase()) ? resp.toUpperCase() : "GESTOR" }; });
      assert(modelo.length > 0, "Informe ao menos um item."); grava.push(["onboarding", { ...cfg.onboarding, modelo }]); msg = "Modelo de onboarding salvo (vale para os próximos planos).";
    } else throw new Error("Seção desconhecida.");
    await sql.begin(async tx => { for (const [key, value] of grava) await tx`INSERT INTO settings (key, value) VALUES (${key}, ${JSON.stringify(value)}::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`; });
    await audit(s, "editar", "settings", null, Object.fromEntries(grava.map(([k]) => [k, (cfg as Record<string, unknown>)[k]])), Object.fromEntries(grava));
  } catch (e) { redirect(erro(e, tab)); }
  redirect(ok(msg, tab));
}
