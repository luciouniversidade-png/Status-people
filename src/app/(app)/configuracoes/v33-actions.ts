"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, can, assert } from "@/lib/auth";
import { audit, str, erroMsg, getSettings } from "@/lib/utils";

const linhas = (t: string) => t.split(/\r?\n/).map(x => x.replace(/\s+/g, " ").trim()).filter(Boolean);
const num = (fd: FormData, k: string, min: number, max: number, rotulo: string) => { const v = Number(str(fd, k).replace(",", ".")); if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${rotulo}: use um número entre ${min} e ${max}.`); return Math.round(v); };
const CRIT = ["ALTA", "MEDIA", "BAIXA"];
const critDe = (t: string) => { const x = t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim(); return CRIT.includes(x) ? x : null; };

/** Parâmetros da v33 (Fornecedores): categorias e criticidade, documentos por criticidade e por categoria, prazos, pesos do scorecard e regras. */
export async function salvarParametrosV33(fd: FormData) {
  const s = await requireSession(); let msg = "Política de fornecedores salva. Vale para os próximos cadastros, envios e avaliações.";
  try {
    assert(can.configurar(s), "Só Direção e RH configuram."); const cfg = await getSettings(); const atual = cfg.fornecedores as Record<string, unknown>;
    const categorias = linhas(str(fd, "categorias")).map(l => { const [n, c] = l.split("|").map(x => x.trim()); const k = critDe(c ?? ""); if (!n || !k) throw new Error(`Categoria “${l}”: use “Nome | alta”, “Nome | média” ou “Nome | baixa”.`); return [n.slice(0, 60), k] as [string, string]; });
    assert(categorias.length >= 3 && categorias.length <= 40, "Use de 3 a 40 categorias."); assert(new Set(categorias.map(c => c[0].toLowerCase())).size === categorias.length, "Há categoria repetida.");
    const documentos: Record<string, string[]> = {};
    for (const k of ["BAIXA", "MEDIA", "ALTA", "PF"]) { const d = [...new Set(linhas(str(fd, `doc${k}`)).map(x => x.slice(0, 120)))]; assert(d.length >= 1 && d.length <= 20, `Documentos (${k === "PF" ? "pessoa física" : k.toLowerCase()}): de 1 a 20.`); documentos[k] = d; }
    const nomes = new Set(categorias.map(c => c[0]));
    const extras = linhas(str(fd, "extras")).map(l => { const [c, d] = l.split("|").map(x => x.trim()); if (!c || !d) throw new Error(`Documento extra “${l}”: use “Categoria | Documento”.`); if (!nomes.has(c)) throw new Error(`Documento extra: a categoria “${c}” não está na lista de categorias.`); return [c, d.slice(0, 120)] as [string, string]; });
    assert(extras.length <= 60, "Até 60 documentos extras.");
    const revalidacaoMeses = { ALTA: num(fd, "revALTA", 1, 36, "Revalidação (alta)"), MEDIA: num(fd, "revMEDIA", 1, 48, "Revalidação (média)"), BAIXA: num(fd, "revBAIXA", 1, 60, "Revalidação (baixa)") };
    assert(revalidacaoMeses.ALTA <= revalidacaoMeses.MEDIA && revalidacaoMeses.MEDIA <= revalidacaoMeses.BAIXA, "Revalidação: a criticidade alta revalida no mesmo prazo ou antes da média, e a média antes da baixa.");
    const pesos = { qualidade: num(fd, "pQualidade", 0, 100, "Peso qualidade"), pontualidade: num(fd, "pPontualidade", 0, 100, "Peso pontualidade"), atendimento: num(fd, "pAtendimento", 0, 100, "Peso atendimento"), custo: num(fd, "pCusto", 0, 100, "Peso custo"), conformidade: num(fd, "pConformidade", 0, 100, "Peso conformidade") };
    const soma = Object.values(pesos).reduce((a, b) => a + b, 0); assert(soma === 100, `Os pesos do scorecard somam ${soma}: precisam somar 100.`);
    const legadoAte = str(fd, "legadoAte"); assert(!legadoAte || /^\d{4}-\d{2}-\d{2}$/.test(legadoAte), "Data de transição inválida.");
    const novo = { ...atual, categorias, documentos, extras, revalidacaoMeses, pesos, alertaDocumentosDias: num(fd, "alerta", 5, 120, "Aviso antes do vencimento"), conviteDias: num(fd, "convite", 1, 30, "Validade do convite"),
      concentracaoAlertaPct: num(fd, "concentracao", 5, 100, "Concentração"), vencidoBloqueiaAlta: str(fd, "vencidoBloqueiaAlta") === "1", excecaoExigeAprovacao: str(fd, "excecaoExigeAprovacao") === "1", legadoAte };
    await sql`INSERT INTO settings (key, value) VALUES ('fornecedores', ${JSON.stringify(novo)}::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`;
    await audit(s, "editar política de fornecedores", "settings", null, { pesos: atual.pesos, revalidacaoMeses: atual.revalidacaoMeses, legadoAte: atual.legadoAte, excecaoExigeAprovacao: atual.excecaoExigeAprovacao }, { categorias: categorias.length, pesos, revalidacaoMeses, legadoAte, vencidoBloqueiaAlta: novo.vencidoBloqueiaAlta, excecaoExigeAprovacao: novo.excecaoExigeAprovacao });
    if (!novo.excecaoExigeAprovacao) msg += " Atenção: exceção de fornecedor deixou de exigir a aprovação de outra pessoa.";
  } catch (e) { redirect(`/configuracoes?erro=${erroMsg(e)}#v33`); }
  redirect(`/configuracoes?ok=${encodeURIComponent(msg)}#v33`);
}
