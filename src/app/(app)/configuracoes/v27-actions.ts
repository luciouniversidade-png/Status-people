"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, can, assert } from "@/lib/auth";
import { audit, str, erroMsg, getSettings } from "@/lib/utils";

const ok = (msg: string, tab: string) => `/configuracoes?ok=${encodeURIComponent(msg)}#${tab}`;
const erro = (e: unknown, tab: string) => `/configuracoes?erro=${erroMsg(e)}#${tab}`;
const linhas = (t: string) => t.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
const num = (fd: FormData, k: string, min: number, max: number, rotulo: string) => { const v = Number(str(fd, k).replace(/\./g, "").replace(",", ".")); if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${rotulo}: use um número entre ${min} e ${max}.`); return v; };

/** Parâmetros da v27: contas a pagar (alçada, dupla checagem, segregação, dia útil, baixa) e contratos com prazo (experiência, estágio, temporário). Regra de controle: só a Direção altera. */
export async function salvarParametrosV27(fd: FormData) {
  const s = await requireSession(); const secao = str(fd, "secao"); const tab = `v27-${secao}`; let msg = "Parâmetros salvos.";
  try {
    assert(can.configurar(s), "Só Direção e RH configuram."); assert(s.role === "DIRECAO" || secao === "prazos", "Regras de contas a pagar: só a Direção altera.");
    const cfg = await getSettings(); const grava: [string, unknown][] = [];
    if (secao === "contas") {
      const tipos = linhas(str(fd, "tipos")).map(t => t.slice(0, 40)); assert(tipos.length > 0, "Informe ao menos um tipo de documento.");
      const feriados = linhas(str(fd, "feriados")).map(l => { const m = l.match(/^(\d{1,2})\/(\d{1,2})/); assert(!!m, `Feriado “${l}”: use DD/MM (ex.: 13/06).`); const d = Number(m![1]), mm = Number(m![2]); assert(d >= 1 && d <= 31 && mm >= 1 && mm <= 12, `Feriado “${l}”: data inválida.`); return `${String(mm).padStart(2, "0")}-${String(d).padStart(2, "0")}`; });
      const aprovadores = fd.getAll("aprovadores").map(String).filter(r => ["DIRECAO", "FINANCEIRO"].includes(r)); assert(aprovadores.length > 0, "Marque quem aprova contas a pagar.");
      const manual = fd.getAll("manual").map(String).filter(r => ["DIRECAO", "FINANCEIRO"].includes(r));
      const alcada = num(fd, "alcada", 0, 10_000_000, "Alçada (R$)"); const dupla = num(fd, "dupla", 0, 100_000_000, "Dupla checagem a partir de (R$)");
      assert(dupla === 0 || dupla >= alcada, "A dupla checagem começa num valor igual ou acima da alçada (ou 0 para desligar).");
      grava.push(["contasPagar", { ...cfg.contasPagar, alcadaValor: alcada, alcadaDuplaValor: dupla, exigirOrcamento: str(fd, "orcamento") === "1", segregarAprovarPagar: str(fd, "segregar") === "1", baixaManualPerfis: manual, naturezaSempreAprova: [...new Set(fd.getAll("naturezas").map(String).filter(x => ["INVESTIMENTO", "EXTRAORDINARIA"].includes(x)))],
        tiposDocumento: [...new Set(tipos)], ajustarDiaUtil: str(fd, "diaUtil") === "1", carnavalSemBanco: str(fd, "carnaval") === "1", corpusChristiSemBanco: str(fd, "corpus") === "1", feriadosLocais: [...new Set(feriados)].sort(),
        alertaDias: Math.round(num(fd, "alerta", 0, 30, "Aviso de vencimento (dias)")), janelaExtratoDias: Math.round(num(fd, "janela", 0, 30, "Janela do extrato (dias)")) }]);
      grava.push(["alcadas", { ...cfg.alcadas, contasPagar: aprovadores }]);
      msg = "Regras de contas a pagar salvas (valem para os próximos lançamentos e baixas).";
    } else if (secao === "prazos") {
      const p1 = Math.round(num(fd, "exp1", 1, 89, "1º período da experiência (dias)")), tot = Math.round(num(fd, "expTotal", 2, 90, "Experiência total (dias)")); assert(tot > p1, "O total da experiência é maior que o 1º período.");
      grava.push(["contratosPrazo", { ...cfg.contratosPrazo, experienciaPrimeiroDias: p1, experienciaTotalDias: tot, avisoDias: Math.round(num(fd, "aviso", 1, 60, "Aviso antes do vencimento (dias)")),
        estagioMaxMeses: Math.round(num(fd, "estagio", 1, 24, "Estágio: limite (meses)")), temporarioDias: Math.round(num(fd, "temp", 1, 180, "Temporário: prazo (dias)")), temporarioProrrogacaoDias: Math.round(num(fd, "tempProrr", 0, 90, "Temporário: prorrogação (dias)")) }]);
      msg = "Regras de contratos com prazo salvas.";
    } else throw new Error("Seção desconhecida.");
    await sql.begin(async tx => { for (const [key, value] of grava) await tx`INSERT INTO settings (key, value) VALUES (${key}, ${JSON.stringify(value)}::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`; });
    await audit(s, "editar", "settings", null, Object.fromEntries(grava.map(([k]) => [k, (cfg as Record<string, unknown>)[k]])), Object.fromEntries(grava));
  } catch (e) { redirect(erro(e, tab)); }
  redirect(ok(msg, tab));
}
