import { sql } from "@/db";
import { getSettings } from "./utils";
import { scopeUnit, type Session, type Role } from "./auth";
import { notificar } from "./comunicacao";
import { enviarEmail } from "./notify";
import { garantirKpis, kpisVisiveis, visoes, periodoPadrao } from "./kpi";
import { leituraDoMes, type VisaoKpi } from "./kpi-catalogo";
import { fmtKpi, variacao, rotuloMes } from "./formato";
import { somaDias } from "./gestao-calc";

/** Semana ISO ("2026-W42") da data. */
export function semanaIso(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`); const dia = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dia + 3);
  const primeiraQuinta = new Date(Date.UTC(d.getUTCFullYear(), 0, 4)); const sem = 1 + Math.round(((d.getTime() - primeiraQuinta.getTime()) / 86400000 - 3 + ((primeiraQuinta.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(sem).padStart(2, "0")}`;
}

/** Indicadores de estado (retrato ou janela móvel): comparáveis de uma semana para outra mesmo na virada do mês. */
const ESTADO = new Set(["pessoas.turnover", "financeiro.inadimplencia", "matriculas.ocupacao", "matriculas.rematricula", "estrategia.acoes_em_dia", "estrategia.okrs"]);
const ehEstado = (v: VisaoKpi) => v.def.agregacao === "ESTOQUE" || ESTADO.has(v.def.chave);

/**
 * Texto do resumo executivo semanal (puro, testável): o que mudou na semana nos indicadores de estado, o que entrou no mês nos fluxos,
 * o que está fora do alvo e a leitura do último mês fechado. Só números agregados — nenhum nome de pessoa ou família.
 */
export function textoResumo(o: { unidade: string; semana: string; atuais: VisaoKpi[]; anteriores: Map<string, number | null>; mesmoMes: boolean; fechado: VisaoKpi[] }) {
  const linhas: string[] = [`${o.unidade} · semana ${o.semana.slice(-2)}`];
  const mov: { peso: number; texto: string }[] = [];
  for (const v of o.atuais) {
    if (v.valor === null) continue; const ant = o.anteriores.get(v.def.chave) ?? null; const f = (x: number | null) => fmtKpi(x, v.def.unidade, true);
    if (ehEstado(v)) { const d = ant !== null ? variacao(v.valor, ant, v.def.unidade) : null; if (d && d.sentido !== 0) mov.push({ peso: (v.def.destaque ? 10 : 0) + Math.min(9, Math.abs(d.rel ?? d.abs) * 20), texto: `${v.nome}: ${f(v.valor)} (${d.texto} na semana)` }); }
    else if (v.def.agregacao === "SOMA" && v.def.destaque) mov.push({ peso: 8, texto: o.mesmoMes && ant !== null && v.valor - ant > 0 ? `${v.nome}: ${f(v.valor)} no mês (${f(v.valor - ant)} na semana)` : `${v.nome}: ${f(v.valor)} no mês` });
    else if (v.def.agregacao === "SOMA" && ["matriculas.novas", "familias.reclamacoes", "familias.saidas", "operacoes.chamados"].includes(v.def.chave) && o.mesmoMes && ant !== null && v.valor - ant > 0) mov.push({ peso: 5, texto: `${v.nome}: +${f(v.valor - ant)} na semana (${f(v.valor)} no mês)` });
  }
  mov.sort((a, b) => b.peso - a.peso); for (const m of mov.slice(0, 7)) linhas.push(`• ${m.texto}`);
  const fora = o.atuais.filter(v => v.farol === "VERMELHO"); if (fora.length) linhas.push(`Fora do alvo: ${fora.slice(0, 6).map(v => `${v.nome} (${fmtKpi(v.valor, v.def.unidade, true)})`).join("; ")}.`);
  const frases = leituraDoMes(o.fechado, 3); if (frases.length) { linhas.push(`${rotuloMes(o.fechado[0]?.periodo ?? "")} (mês fechado):`); for (const f of frases) linhas.push(`• ${f.texto}`); }
  if (linhas.length === 1) linhas.push("Semana sem movimentos relevantes nos indicadores.");
  return linhas.join("\n");
}

/** Rotina diária do Insights: mantém a base em dia (fotos do dia) e, às segundas-feiras, envia o resumo executivo para quem assinou. */
export async function rotinaInsights(h: string) {
  const r = { base: "" as string, resumos: 0, falhas: [] as string[] };
  try { const b = await garantirKpis(); r.base = b.calculou ? "atualizada" : "em dia"; } catch (e) { r.falhas.push(`base: ${e instanceof Error ? e.message : String(e)}`); }
  const cfg = await getSettings();
  if (new Date(`${h}T12:00:00Z`).getUTCDay() !== 1 || cfg.insights?.resumoSemanal === false) return { insights: r };
  const semana = semanaIso(h); const semanaAnt = semanaIso(somaDias(h, -7)); const periodo = h.slice(0, 7); const fechado = periodoPadrao(h);
  // foto da semana (mês corrente) para a comparação da próxima segunda
  await sql`INSERT INTO kpi_weekly (semana, chave, unit_id, valor) SELECT ${semana}, chave, unit_id, valor FROM kpi_series WHERE periodo=${periodo} ON CONFLICT (semana, chave, unit_id) DO UPDATE SET valor=EXCLUDED.valor`;
  const antRows = await sql<{ chave: string; unit_id: number; valor: number | null; periodo: string | null }[]>`SELECT w.chave, w.unit_id, w.valor::float, to_char(w.created_at, 'YYYY-MM') AS periodo FROM kpi_weekly w WHERE w.semana=${semanaAnt}`;
  const mesmoMes = antRows.length > 0 && antRows.every(x => x.periodo === periodo);
  const subs = await sql<{ user_id: number; unit_id: number | null; email: boolean; nome: string; user_email: string; role: Role; user_unit: number | null; employee_id: number | null }[]>`SELECT k.user_id, k.unit_id, k.email, u.nome, u.email AS user_email, u.role, u.unit_id AS user_unit, u.employee_id FROM kpi_subscriptions k JOIN users u ON u.id=k.user_id WHERE k.ativo AND u.ativo AND (k.ultimo_envio IS NULL OR k.ultimo_envio < ${h})`;
  const units = new Map((await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units`).map(u => [u.id, u.nome]));
  for (const sub of subs) {
    try {
      const sess: Session = { id: sub.user_id, nome: sub.nome, email: sub.user_email, role: sub.role, unitId: sub.user_unit, employeeId: sub.employee_id };
      const defs = await kpisVisiveis(sess); if (!defs.length) continue;
      const unitId = scopeUnit(sess) ?? sub.unit_id ?? 0;
      const [atuais, fech] = await Promise.all([visoes(defs, periodo, unitId), visoes(defs, fechado, unitId)]);
      const anteriores = new Map(antRows.filter(x => x.unit_id === unitId).map(x => [x.chave, x.valor]));
      const texto = textoResumo({ unidade: unitId ? units.get(unitId) ?? "Unidade" : "Rede", semana, atuais, anteriores, mesmoMes, fechado: fech });
      await notificar([sub.user_id], "Resumo executivo da semana", texto.slice(0, 1500), "/executivo", "INFO", `resumoexec:${sub.user_id}:${semana}`);
      if (sub.email) await enviarEmail([sub.user_email], `Resumo executivo — ${semana}`, `${texto}\n\nPainel Executivo: ${(process.env.APP_URL ?? "").replace(/\/$/, "")}/executivo`);
      await sql`UPDATE kpi_subscriptions SET ultimo_envio=${h} WHERE user_id=${sub.user_id}`; r.resumos++;
    } catch (e) { r.falhas.push(`resumo ${sub.user_id}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return { insights: r };
}
