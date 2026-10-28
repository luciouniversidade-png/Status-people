"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, can, assert } from "@/lib/auth";
import { audit, str, erroMsg, getSettings } from "@/lib/utils";
import { FAMILIAS } from "@/lib/avaliacao";

const ok = (msg: string, tab: string) => `/configuracoes?ok=${encodeURIComponent(msg)}#${tab}`;
const erro = (e: unknown, tab: string) => `/configuracoes?erro=${erroMsg(e)}#${tab}`;
const linhas = (t: string) => t.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
// "0,5" e "0.5" valem meio; com vírgula, o ponto é separador de milhar ("1.234,5")
const num = (fd: FormData, k: string, min: number, max: number, rotulo: string) => { const t = str(fd, k).trim(); const v = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t); if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${rotulo}: use um número entre ${min} e ${max}.`); return v; };

/** Parâmetros da v30 (RH e Direção). A página pública de vagas só liga pela Direção (decisão do GO). */
export async function salvarParametrosV30(fd: FormData) {
  const s = await requireSession(); const secao = str(fd, "secao"); const tab = `v30-${secao}`; let msg = "Parâmetros salvos.";
  try {
    assert(can.configurar(s), "Só Direção e RH configuram."); const cfg = await getSettings(); const grava: [string, unknown][] = [];
    if (secao === "recrutamento") {
      const pag = cfg.recrutamento.paginaPublica as { ativa?: boolean }; const ativa = str(fd, "paginaAtiva") === "1";
      if (ativa !== !!pag?.ativa) assert(s.role === "DIRECAO", "Ligar ou desligar a página pública de vagas é decisão da Direção (depois do GO).");
      const motivos = [...new Set(linhas(str(fd, "motivosRecusa")).map(m => m.slice(0, 60)))]; assert(motivos.length > 0, "Informe ao menos um motivo de recusa.");
      grava.push(["recrutamento", { ...cfg.recrutamento, paginaPublica: { ativa, titulo: str(fd, "paginaTitulo").slice(0, 80) || "Trabalhe conosco", texto: str(fd, "paginaTexto").slice(0, 600), limitePorHora: Math.round(num(fd, "paginaLimite", 1, 50, "Candidaturas por hora")) },
        avaliacaoPrazoDias: Math.round(num(fd, "avaliacaoPrazo", 1, 30, "Prazo do avaliador")), satisfacaoGestorDias: Math.round(num(fd, "satisfacaoDias", 30, 365, "Dias para o gestor avaliar a contratação")),
        minimoExperiencia: Math.round(num(fd, "minExp", 3, 50, "Mínimo de respostas da experiência")), candidatosPorVaga: Math.round(num(fd, "candPorVaga", 1, 20, "Candidaturas por posição")), motivosRecusa: motivos }]);
      msg = ativa && !pag?.ativa ? "Página pública de vagas ligada." : "Parâmetros do recrutamento salvos.";
    } else if (secao === "igualdade") {
      const familias = fd.getAll("familias").map(String).filter(f => f in FAMILIAS);
      grava.push(["igualdade", { ...cfg.igualdade, grupoMinimo: Math.round(num(fd, "grupoMinimo", 2, 20, "Mínimo por grupo")), limiteDiferencaPct: num(fd, "limite", 0, 50, "Diferença que pede explicação"), empregadosObrigatorio: Math.round(num(fd, "empregados", 1, 10000, "Empregados para o relatório")), familiasLideranca: familias }]);
      msg = "Parâmetros de igualdade salarial salvos.";
    } else if (secao === "calibracao") {
      const a = num(fd, "refDestaque", 0, 100, "Destaque"), b = num(fd, "refConsistente", 0, 100, "Consistente"), c = num(fd, "refPrioritario", 0, 100, "Prioritário"); assert(Math.round(a + b + c) === 100, "A referência soma 100%.");
      grava.push(["desempenho", { ...cfg.desempenho, referencia: { DESTAQUE: a, CONSISTENTE: b, PRIORITARIO: c }, consistenciaMinAvaliados: Math.round(num(fd, "consMin", 2, 50, "Mínimo de avaliados")), consistenciaDelta: num(fd, "consDelta", 0.1, 3, "Diferença da média"), metaSemAtualizacaoDias: Math.round(num(fd, "metaDias", 7, 180, "Meta sem atualização")) }]);
      msg = "Referência da calibração salva (não é cota).";
    } else if (secao === "lideranca") {
      const dims = linhas(str(fd, "liDimensoes")).map(l => { const [d, t] = l.split("|").map(x => x.trim()); assert(!!d && !!t && t.length >= 10, `Dimensão “${l}”: use “Dimensão | afirmação”.`); return [d.slice(0, 40), t.slice(0, 200)] as [string, string]; }); assert(dims.length >= 3 && dims.length <= 12, "Use de 3 a 12 dimensões.");
      grava.push(["clima", { ...cfg.clima, lideranca: { ...cfg.clima.lideranca, minimo: Math.round(num(fd, "liMin", 3, 20, "Mínimo de respostas")), favoravelAlvo: num(fd, "liAlvo", 0, 100, "Índice esperado"), atencaoAbaixo: num(fd, "liAtencao", 0, 100, "Ponto de atenção"), dimensoes: dims } }]);
      msg = "Pesquisa de liderança configurada (vale para as próximas pesquisas).";
    } else if (secao === "academy") {
      grava.push(["academy", { ...cfg.academy, reacaoMinima: Math.round(num(fd, "reacaoMin", 1, 20, "Avaliações para mostrar a nota")) }]);
      grava.push(["beneficios", { ...cfg.beneficios, vtDescontoMaxPct: num(fd, "vtPct", 0, 6, "Desconto máximo do VT"), fgtsPct: num(fd, "fgtsPct", 0, 20, "FGTS") }]);
      msg = "Parâmetros da Academy e dos benefícios salvos.";
    } else throw new Error("Seção desconhecida.");
    await sql.begin(async tx => { for (const [key, value] of grava) await tx`INSERT INTO settings (key, value) VALUES (${key}, ${JSON.stringify(value)}::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`; });
    await audit(s, "editar", "settings", null, Object.fromEntries(grava.map(([k]) => [k, (cfg as Record<string, unknown>)[k]])), Object.fromEntries(grava));
  } catch (e) { redirect(erro(e, tab)); }
  redirect(ok(msg, tab));
}
