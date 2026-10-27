"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, can, assert } from "@/lib/auth";
import { audit, str, erroMsg, getSettings } from "@/lib/utils";

const ok = (msg: string, tab: string) => `/configuracoes?ok=${encodeURIComponent(msg)}#${tab}`;
const erro = (e: unknown, tab: string) => `/configuracoes?erro=${erroMsg(e)}#${tab}`;
const linhas = (t: string) => t.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
const num = (fd: FormData, k: string, min: number, max: number, rotulo: string) => { let t = str(fd, k).replace(/\s/g, ""); if (t.includes(",")) t = t.replace(/\./g, "").replace(",", "."); else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ""); const v = Number(t); if (t === "" || !Number.isFinite(v) || v < min || v > max) throw new Error(`${rotulo}: use um número entre ${min} e ${max}.`); return v; };

/** Parâmetros da v28 (plano de contas, não despesa e orçamento pelo histórico). Controle financeiro: só a Direção altera. */
export async function salvarParametrosV28(fd: FormData) {
  const s = await requireSession(); const secao = str(fd, "secao"); const tab = `v28-${secao}`; let msg = "Parâmetros salvos.";
  try {
    assert(can.configurar(s), "Só Direção e RH configuram."); assert(s.role === "DIRECAO", "Plano de contas e orçamento: só a Direção altera.");
    const cfg = await getSettings(); const grava: [string, unknown][] = [];
    if (secao === "plano") {
      const nd = [...new Set(linhas(str(fd, "naoDespesa")).map(x => x.slice(0, 80)))]; const internas = cfg.dre.internas as string[];
      assert(!nd.some(x => ["Pessoal", "Encargos e benefícios", "Mensalidades"].includes(x)), "Pessoal, encargos e mensalidades não podem ficar fora da DRE.");
      grava.push(["planoContas", { ...cfg.planoContas, exigirContaContasPagar: str(fd, "exigirConta") === "1", exigirCentroCusto: str(fd, "exigirCentro") === "1", metaGenericaPct: num(fd, "metaGenerica", 0, 50, "Meta da conta genérica (%)"), janelaClassificacaoDias: Math.round(num(fd, "janela", 7, 730, "Fila de classificação (dias)")) }]);
      grava.push(["dre", { ...cfg.dre, naoDespesa: nd.filter(x => !internas.includes(x)) }]);
      msg = "Regras do plano de contas salvas.";
    } else if (secao === "orcamento") {
      const ferias = [...new Set(fd.getAll("mesesFerias").map(Number).filter(m => m >= 1 && m <= 12))].sort((a, b) => a - b);
      grava.push(["orcamentoHistorico", { ...cfg.orcamentoHistorico, ipcaPct: num(fd, "ipca", -5, 50, "IPCA (%)"), dissidioPct: num(fd, "dissidio", -5, 50, "Dissídio (%)"), reajusteMensalidadePct: num(fd, "mensalidade", -20, 50, "Reajuste da mensalidade (%)"),
        mesDissidio: Math.round(num(fd, "mesDissidio", 1, 12, "Mês do dissídio")), mesReajusteMensalidade: Math.round(num(fd, "mesMensalidade", 1, 12, "Mês do reajuste")), fatorFerias: num(fd, "ferias", 0, 1.5, "Consumo nas férias"),
        outlierFator: num(fd, "outlier", 1.5, 20, "Pico (× a mediana)"), outlierMinimo: num(fd, "outlierMin", 0, 10_000_000, "Pico mínimo (R$)"), eventoMinimo: num(fd, "evento", 0, 100_000_000, "Evento a confirmar (R$)"), mesesFerias: ferias, usarContratos: str(fd, "contratos") === "1" }]);
      msg = "Valores iniciais do orçamento pelo histórico salvos (valem para os anos ainda sem parâmetros próprios).";
    } else throw new Error("Seção desconhecida.");
    await sql.begin(async tx => { for (const [key, value] of grava) await tx`INSERT INTO settings (key, value) VALUES (${key}, ${JSON.stringify(value)}::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`; });
    await audit(s, "editar", "settings", null, Object.fromEntries(grava.map(([k]) => [k, (cfg as Record<string, unknown>)[k]])), Object.fromEntries(grava));
  } catch (e) { redirect(erro(e, tab)); }
  redirect(ok(msg, tab));
}
