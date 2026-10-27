"use server";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireSession, assert } from "@/lib/auth";
import { audit, str, int, getSettings } from "@/lib/utils";
import { editaPlano, aprovaRateio } from "@/lib/plano-contas";
import { BASES, ROTULO_BASE, type BaseRateio } from "@/lib/rateio-calc";
import { notificar } from "@/lib/comunicacao";

const BASE_URL = "/financeiro/rateio";
const go = (k: "ok" | "erro", m: string) => `${BASE_URL}?${k}=${encodeURIComponent(m)}#regras`;
const msg = (e: unknown) => e instanceof Error ? e.message : "Erro inesperado.";

/** Nova regra de rateio (rascunho): Financeiro ou Direção propõem; só a Direção aprova. */
export async function criarRegraRateio(fd: FormData) {
  let m = "";
  try {
    const s = await requireSession(); const cfg = await getSettings(); assert(editaPlano(cfg, s), "Regras de rateio são propostas pelo Financeiro ou pela Direção.");
    const nome = str(fd, "nome").replace(/\s+/g, " "); assert(nome.length >= 3 && nome.length <= 120, "Dê um nome à regra (3 a 120 caracteres).");
    const base = str(fd, "base") as BaseRateio; assert(BASES.includes(base), "Escolha a base do rateio.");
    const desde = str(fd, "desde"); assert(/^\d{4}-\d{2}$/.test(desde), "Informe o mês de início (AAAA-MM).");
    const motivo = str(fd, "motivo"); assert(motivo.length >= 10, "Explique o critério (mín. 10 caracteres) — fica na aprovação e na auditoria.");
    let percentuais: Record<string, number> | null = null;
    if (base === "PERCENTUAL") {
      const units = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`; percentuais = {};
      for (const u of units) { const v = Number(str(fd, `pct_${u.id}`).replace(",", ".") || "0"); assert(Number.isFinite(v) && v >= 0 && v <= 100, `Percentual inválido para ${u.nome}.`); percentuais[String(u.id)] = Math.round(v * 100) / 100; }
      const soma = Object.values(percentuais).reduce((a, b) => a + b, 0); assert(Math.abs(soma - 100) < 0.01, `Os percentuais somam ${soma.toLocaleString("pt-BR")}% — precisam somar 100%.`);
    }
    const [r] = await sql<{ id: number }[]>`INSERT INTO allocation_rules (nome, base, percentuais, desde, motivo, criado_por) VALUES (${nome}, ${base}, ${percentuais ? JSON.stringify(percentuais) : null}::jsonb, ${desde}, ${motivo}, ${s.id}) RETURNING id`;
    await audit(s, "propor regra de rateio", "allocation_rules", r.id, null, { nome, base, desde, percentuais });
    const diretoria = await sql<{ id: number }[]>`SELECT id FROM users WHERE ativo AND role='DIRECAO' AND id <> ${s.id}`;
    if (diretoria.length) await notificar(diretoria.map(d => d.id), "Regra de rateio para aprovar", `${nome} · base: ${ROTULO_BASE[base]} · desde ${desde.split("-").reverse().join("/")}`, BASE_URL + "#regras", "ACAO", `rateio:${r.id}`);
    m = `Regra “${nome}” enviada para a aprovação da Direção.`;
  } catch (e) { redirect(go("erro", msg(e))); }
  redirect(go("ok", m));
}

/** Direção aprova (passa a valer a partir do mês “desde”) ou rejeita (com motivo). Quem propôs não aprova a própria regra. */
export async function decidirRegraRateio(fd: FormData) {
  let m = "";
  try {
    const s = await requireSession(); assert(aprovaRateio(s), "Só a Direção aprova critérios de rateio.");
    const id = int(fd, "id") ?? 0; const decisao = str(fd, "decisao"); assert(["APROVAR", "REJEITAR"].includes(decisao), "Decisão inválida.");
    const [r] = await sql<{ nome: string; status: string; criado_por: number | null }[]>`SELECT nome, status, criado_por FROM allocation_rules WHERE id=${id}`; assert(!!r, "Regra não encontrada."); assert(r.status === "RASCUNHO", "Esta regra já foi decidida.");
    assert(r.criado_por !== s.id, "Quem propôs a regra não a aprova: outra pessoa da Direção decide.");
    const motivo = str(fd, "motivo"); if (decisao === "REJEITAR") assert(motivo.length >= 5, "Diga por que a regra foi rejeitada.");
    if (decisao === "APROVAR") await sql`UPDATE allocation_rules SET status='APROVADA', aprovado_por=${s.id}, aprovado_em=now(), decisao_motivo=${motivo || null} WHERE id=${id}`;
    else await sql`UPDATE allocation_rules SET status='REJEITADA', aprovado_por=${s.id}, aprovado_em=now(), decisao_motivo=${motivo} WHERE id=${id}`;
    await audit(s, decisao === "APROVAR" ? "aprovar regra de rateio" : "rejeitar regra de rateio", "allocation_rules", id, { status: "RASCUNHO" }, { status: decisao === "APROVAR" ? "APROVADA" : "REJEITADA", motivo });
    if (r.criado_por) await notificar([r.criado_por], decisao === "APROVAR" ? "Regra de rateio aprovada" : "Regra de rateio rejeitada", r.nome, BASE_URL + "#regras", "INFO", `rateio-dec:${id}`);
    m = decisao === "APROVAR" ? `Regra “${r.nome}” aprovada — o resultado por unidade já usa este critério.` : `Regra “${r.nome}” rejeitada.`;
  } catch (e) { redirect(go("erro", msg(e))); }
  redirect(go("ok", m));
}
