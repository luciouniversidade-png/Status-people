"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, can, assert } from "@/lib/auth";
import { audit, str, erroMsg, getSettings } from "@/lib/utils";

const ok = (msg: string, tab: string) => `/configuracoes?ok=${encodeURIComponent(msg)}#${tab}`;
const erro = (e: unknown, tab: string) => `/configuracoes?erro=${erroMsg(e)}#${tab}`;
const linhas = (t: string) => t.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
const num = (fd: FormData, k: string, min: number, max: number, rotulo: string) => { const v = Number(str(fd, k).replace(",", ".")); if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${rotulo}: use um número entre ${min} e ${max}.`); return v; };
const CATS_CARTAO = ["Débito", "Crédito à vista", "Crédito parcelado 2–6x", "Crédito parcelado 7–12x"];
const CHAVES_PALAVRAS = ["transferencia", "tarifa", "cartao", "pix", "boleto", "ted", "deposito"];

/** Parâmetros da v25 (conciliação e política de despesas): só a Direção altera regra de controle; RH consulta. Trilha na auditoria. */
export async function salvarParametrosV25(fd: FormData) {
  const s = await requireSession(); const secao = str(fd, "secao"); const tab = `v25-${secao}`; let msg = "Parâmetros salvos.";
  try {
    assert(can.configurar(s), "Só Direção e RH configuram."); assert(s.role === "DIRECAO" || secao === "ponto", "Regras de conciliação e de despesas: só a Direção altera.");
    const cfg = await getSettings(); const grava: [string, unknown][] = [];
    if (secao === "conciliacao") {
      const g = Math.round(num(fd, "escGestor", 1, 90, "Escala ao gestor (dias)")), dd = Math.round(num(fd, "escDirecao", 2, 180, "Escala à Direção (dias)")); assert(dd > g, "A escala à Direção vem depois da escala ao gestor.");
      const taxas = linhas(str(fd, "taxas")).map(l => { const [b, c, t] = l.split("|").map(x => x.trim()); assert(!!b && !!c && !!t, "Taxas: cada linha é bandeira (ou *) | categoria | taxa %."); assert(CATS_CARTAO.includes(c), `Categoria “${c}”: use ${CATS_CARTAO.join(", ")}.`); const v = Number(t.replace(",", ".").replace("%", "")); assert(Number.isFinite(v) && v >= 0 && v <= 15, `Taxa inválida em ${b} | ${c}.`); return { bandeira: b.toUpperCase() === "*" ? "*" : b.toUpperCase(), categoria: c, taxa: v }; });
      assert(taxas.some(t => t.bandeira === "*"), "Informe ao menos as taxas padrão (bandeira *).");
      const palavras: Record<string, string[]> = { ...(cfg.conciliacao.palavras as Record<string, string[]>) };
      for (const l of linhas(str(fd, "palavras"))) { const i = l.indexOf(":"); assert(i > 0, "Palavras: cada linha é forma: palavra, palavra."); const k = l.slice(0, i).trim().toLowerCase(); assert(CHAVES_PALAVRAS.includes(k), `Forma “${k}”: use ${CHAVES_PALAVRAS.join(", ")}.`); palavras[k] = l.slice(i + 1).split(",").map(x => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/^\s+/, "")).filter(x => x.trim()); }
      grava.push(["conciliacao", { ...cfg.conciliacao, limiarAuto: Math.round(num(fd, "limiar", 60, 100, "Confiança para confirmar sozinho (%)")), janelaDias: Math.round(num(fd, "janela", 0, 15, "Janela PIX/TED/depósito (dias)")), janelaCartaoDias: Math.round(num(fd, "janelaCartao", 0, 10, "Janela do cartão (dias)")),
        toleranciaCentavos: num(fd, "centavos", 0, 1, "Tolerância de centavos (R$)"), centavosMinOcorrencias: Math.round(num(fd, "centavosMin", 1, 50, "Ocorrências para o achado de centavos")), toleranciaTaxaPp: num(fd, "tolTaxa", 0, 2, "Tolerância da taxa (p.p.)"),
        metaConciliadoPct: num(fd, "meta", 50, 100, "Meta do KPI-09 para fechar (%)"), diaLimiteFechamento: Math.round(num(fd, "diaLimite", 1, 28, "Dia-limite do fechamento")), escalonamentoDias: [g, dd], perdaAlcadaFinanceiro: num(fd, "alcadaPerda", 0, 100000, "Perda assumida pelo Financeiro até (R$)"), taxasCartao: taxas, palavras }]);
      msg = "Regras da conciliação salvas (valem a partir do próximo processamento).";
    } else if (secao === "despesas") {
      const tipos = await sql<{ codigo: string }[]>`SELECT codigo FROM request_types`; const cats = cfg.financeiro.categoriasSaida as string[];
      const categoriaPorTipo: Record<string, string> = {}; for (const t of tipos) { const c = str(fd, `cat_${t.codigo}`); if (c) { assert(cats.includes(c), `Categoria desconhecida para ${t.codigo}.`); categoriaPorTipo[t.codigo] = c; } }
      grava.push(["despesas", { ...cfg.despesas, loteAte: num(fd, "loteAte", 0, 1000000, "Lote até (R$)"), exigirDocumento: str(fd, "doc") === "1", excecaoOrcamento: str(fd, "orc") === "1", categoriasBloqueadas: fd.getAll("bloq").map(String).filter(c => cats.includes(c)), alertaPagamentoDias: Math.round(num(fd, "alerta", 1, 60, "Alerta de pagamento (dias)")), categoriaPorTipo }]);
      msg = "Política de despesas salva.";
    } else if (secao === "massa") {
      const hm = (k: string) => { const v = str(fd, k); assert(/^([01]\d|2[0-3]):[0-5]\d$/.test(v), "Horário: use HH:MM."); return v; };
      const ini = hm("inicio"), fim = hm("fim"); assert(ini < fim, "O fim do horário comercial vem depois do início.");
      const dias = fd.getAll("dias").map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6); assert(dias.length > 0, "Marque ao menos um dia de disparo.");
      const aprov = fd.getAll("aprovadores").map(String).filter(r => ["DIRECAO", "RH"].includes(r)); assert(aprov.length > 0, "Marque quem aprova (Direção e/ou RH).");
      grava.push(["comunicacao", { ...cfg.comunicacao, massaMinDestinatarios: Math.round(num(fd, "minimo", 2, 5000, "Comunicação em massa a partir de (pessoas)")), aprovadoresMassa: aprov, horarioComercial: { inicio: ini, fim, dias: [...new Set(dias)].sort() } }]);
      msg = "Regras da comunicação em massa salvas.";
    } else if (secao === "ponto") {
      const dur = str(fd, "duracoes").split(/[,;\s]+/).map(Number).filter(n => Number.isInteger(n) && n >= 20 && n <= 120); assert(dur.length > 0, "Durações de aula: informe ao menos uma (ex.: 45, 50, 60).");
      grava.push(["auditoriaPonto", { ...cfg.auditoriaPonto, toleranciaDiaMin: Math.round(num(fd, "tolerancia", 0, 60, "Tolerância do dia (min)")), heMinimaMin: Math.round(num(fd, "heMinima", 0, 240, "Hora extra mínima (min)")), exigirAnexoAtestado: str(fd, "atestado") === "1" }]);
      grava.push(["grade", { ...cfg.grade, duracoesAula: [...new Set(dur)].sort((x, y) => x - y), rotulosPlantao: linhas(str(fd, "plantao")).map(x => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()) }]);
      msg = "Regras da auditoria do ponto e da grade salvas.";
    } else throw new Error("Seção desconhecida.");
    await sql.begin(async tx => { for (const [key, value] of grava) await tx`INSERT INTO settings (key, value) VALUES (${key}, ${JSON.stringify(value)}::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`; });
    await audit(s, "editar", "settings", null, Object.fromEntries(grava.map(([k]) => [k, (cfg as Record<string, unknown>)[k]])), Object.fromEntries(grava));
  } catch (e) { redirect(erro(e, tab)); }
  redirect(ok(msg, tab));
}
