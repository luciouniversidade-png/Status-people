import { sql } from "@/db";
import { hoje, getSettings } from "./utils";
import { peopleHealth } from "./talentos-analytics";
import { estatisticasGov } from "./governanca";
import { ocupacao } from "./matriculas";
import { estatisticas as estatAtend, riscoFamilias } from "./atendimento";
import { inadimplencia, caixaMes, orcamentoAno } from "./financeiro";
import { mesRef } from "./relatorio";

export type Fator = { peso: number; texto: string };
export type Dominio = { chave: string; nome: string; score: number; fatores: Fator[]; kpis: { label: string; valor: string; hint?: string }[]; href: string };
export type Alerta = { nivel: "ALTO" | "MEDIO"; texto: string; href: string };

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export async function healthGeral(unitId: number | null) {
  const cfg = await getSettings(); const h = hoje(); const m = mesRef(h.slice(0, 7)); const ano = cfg.matriculas.anoLetivo;
  const [ph, gov, oc, at, risco, inad, cx, orc] = await Promise.all([peopleHealth(unitId), estatisticasGov(unitId), ocupacao(ano, unitId, "REGULAR"), estatAtend(unitId, m.ini, m.fim), riscoFamilias(unitId), inadimplencia(unitId), caixaMes(h.slice(0, 7), unitId), orcamentoAno(Number(h.slice(0, 4)), unitId)]);
  const alertas: Alerta[] = [];
  // ---- Pessoas
  const pessoas: Dominio = { chave: "pessoas", nome: "Pessoas", score: ph.score, fatores: ph.fatores, href: "/analytics", kpis: [{ label: "Ativos", valor: String(ph.hc.ativos) }, { label: "Turnover 12m", valor: ph.turnover === null ? "—" : `${ph.turnover}%` }, { label: "Absenteísmo", valor: ph.absenteismo === null ? "—" : `${ph.absenteismo}%` }, { label: "eNPS", valor: ph.enps === null ? "—" : String(ph.enps) }] };
  ph.fatores.forEach(f => alertas.push({ nivel: Math.abs(f.peso) >= 10 ? "ALTO" : "MEDIO", texto: `Pessoas: ${f.texto}`, href: "/analytics" }));
  // ---- Processos
  const processos: Dominio = { chave: "processos", nome: "Processos", score: gov.score, fatores: gov.fatores, href: "/governanca", kpis: [{ label: "POPs vigentes", valor: `${gov.pops.vigentes}/${gov.pops.total}` }, { label: "Exceções aguardando", valor: String(gov.exc.pendentes) }, { label: "Controles atrasados", valor: String(gov.ctl.atrasados) }, { label: "NCs abertas", valor: String(gov.nc.abertas) }] };
  gov.fatores.forEach(f => alertas.push({ nivel: Math.abs(f.peso) >= 10 ? "ALTO" : "MEDIO", texto: `Processos: ${f.texto}`, href: "/governanca" }));
  // ---- Matrículas
  const vagas = oc.reduce((a, r) => a + r.vagas, 0), conf = oc.reduce((a, r) => a + r.confirmadas, 0), res = oc.reduce((a, r) => a + r.reservadas, 0), fila = oc.reduce((a, r) => a + r.fila, 0);
  const ocup = vagas ? Math.round(1000 * (conf + res) / vagas) / 10 : null; const fm: Fator[] = [];
  let sm = 100;
  if (ocup !== null) { const meta = cfg.commandCenter.metaOcupacaoPct; if (ocup < meta) { const d = Math.round((meta - ocup) / meta * 70); sm -= d; fm.push({ peso: -d, texto: `ocupação ${ocup}% das vagas ${ano} (meta ${meta}%)` }); } }
  const [venc] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM enrollments e JOIN classes c ON c.id=e.class_id WHERE e.status='RESERVADA' AND e.reserva_ate <= ${h} AND c.ano=${ano} ${unitId === null ? sql`` : sql`AND c.unit_id=${unitId}`}`;
  if (venc.n) { const d = Math.min(15, venc.n * 3); sm -= d; fm.push({ peso: -d, texto: `${venc.n} reserva(s) vencendo hoje` }); }
  const filaComVaga = oc.filter(r => r.fila > 0 && r.livres > 0).length; if (filaComVaga) { const d = Math.min(15, filaComVaga * 5); sm -= d; fm.push({ peso: -d, texto: `${filaComVaga} turma(s) com fila e vaga livre (ofertar)` }); }
  const matriculas: Dominio = { chave: "matriculas", nome: "Matrículas", score: clamp(sm), fatores: fm, href: "/matriculas", kpis: [{ label: `Ocupação ${ano}`, valor: ocup === null ? "—" : `${ocup}%` }, { label: "Matriculados", valor: String(conf) }, { label: "Reservas ativas", valor: String(res) }, { label: "Lista de espera", valor: String(fila) }] };
  fm.forEach(f => alertas.push({ nivel: Math.abs(f.peso) >= 10 ? "ALTO" : "MEDIO", texto: `Matrículas: ${f.texto}`, href: "/matriculas" }));
  // ---- Atendimento
  const fa: Fator[] = []; let sa = 100; const altos = risco.filter(r => r.nivel === "ALTO").length;
  if (at.cas.atrasados) { const d = Math.min(40, at.cas.atrasados * 5); sa -= d; fa.push({ peso: -d, texto: `${at.cas.atrasados} caso(s) com SLA vencido` }); }
  if (at.nps.nps !== null && at.nps.nps < 30) { const d = Math.round(Math.min(30, (30 - at.nps.nps) / 50 * 30)); sa -= d; fa.push({ peso: -d, texto: `NPS das famílias ${at.nps.nps} (meta ≥ 30)` }); }
  if (altos) { const d = Math.min(30, altos * 3); sa -= d; fa.push({ peso: -d, texto: `${altos} família(s) em risco alto de saída` }); }
  if (at.ret.abertos) { const d = Math.min(10, at.ret.abertos * 2); sa -= d; fa.push({ peso: -d, texto: `${at.ret.abertos} pedido(s) de saída em andamento` }); }
  const taxa = at.ret.retidos + at.ret.perdidos ? Math.round(100 * at.ret.retidos / (at.ret.retidos + at.ret.perdidos)) : null;
  const atendimento: Dominio = { chave: "atendimento", nome: "Atendimento e retenção", score: clamp(sa), fatores: fa, href: "/atendimento", kpis: [{ label: "Casos abertos", valor: String(at.cas.abertos) }, { label: "SLA vencido", valor: String(at.cas.atrasados) }, { label: "NPS famílias", valor: at.nps.nps === null ? "—" : String(at.nps.nps) }, { label: "Retenção no mês", valor: taxa === null ? "—" : `${taxa}%` }] };
  fa.forEach(f => alertas.push({ nivel: Math.abs(f.peso) >= 10 ? "ALTO" : "MEDIO", texto: `Atendimento: ${f.texto}`, href: "/atendimento" }));
  // ---- Financeiro
  const ff: Fator[] = []; let sf = 100;
  if (inad.taxa90 !== null && inad.taxa90 > cfg.commandCenter.inadimplenciaAlertaPct) { const d = Math.round(Math.min(40, (inad.taxa90 - cfg.commandCenter.inadimplenciaAlertaPct) * 4)); sf -= d; ff.push({ peso: -d, texto: `inadimplência ${inad.taxa90}% nos últimos 90 dias (meta ≤ ${cfg.commandCenter.inadimplenciaAlertaPct}%)` }); }
  if (inad.acoesPendentes) { const d = Math.min(20, inad.acoesPendentes * 2); sf -= d; ff.push({ peso: -d, texto: `${inad.acoesPendentes} título(s) sem a ação da régua` }); }
  if (cx.saldoFinal !== null && cx.saldoFinal < 0) { sf -= 20; ff.push({ peso: -20, texto: "caixa projetado negativo no mês" }); }
  const estouros = orc.cats.filter(c => c.tipo === "SAIDA" && c.variacao !== null && c.variacao > 10); if (estouros.length) { const d = Math.min(20, estouros.length * 5); sf -= d; ff.push({ peso: -d, texto: `${estouros.length} categoria(s) acima do orçamento: ${estouros.map(c => c.categoria).join(", ")}` }); }
  const financeiro: Dominio = { chave: "financeiro", nome: "Financeiro", score: clamp(sf), fatores: ff, href: "/financeiro", kpis: [{ label: "Inadimplência 90d", valor: inad.taxa90 === null ? "—" : `${inad.taxa90}%` }, { label: "Em aberto vencido", valor: brl(inad.total) }, { label: "Saldo de caixa", valor: cx.saldoFinal === null ? "—" : brl(cx.saldoFinal) }, { label: "Resultado no ano", valor: brl(orc.resultado) }] };
  ff.forEach(f => alertas.push({ nivel: Math.abs(f.peso) >= 10 ? "ALTO" : "MEDIO", texto: `Financeiro: ${f.texto}`, href: "/financeiro" }));
  // ---- Geral
  const dom = [pessoas, processos, matriculas, atendimento, financeiro]; const pesos = cfg.commandCenter.pesos as Record<string, number>;
  const totalPeso = dom.reduce((a, d) => a + (pesos[d.chave] ?? 0), 0);
  const geral = totalPeso ? Math.round(dom.reduce((a, d) => a + d.score * (pesos[d.chave] ?? 0), 0) / totalPeso) : 0;
  alertas.sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === "ALTO" ? -1 : 1));
  return { geral, dominios: dom, alertas, pesos };
}

const brl = (v: number | null) => v === null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** Guarda um retrato diário do Health (para tendência). Idempotente por dia. */
export async function registrarSnapshot(unitId: number | null, geral: number, scores: Record<string, number>) {
  await sql`INSERT INTO health_snapshots (data, unit_id, geral, scores) VALUES (${hoje()}, ${unitId}, ${geral}, ${JSON.stringify(scores)}::jsonb) ON CONFLICT (data, coalesce(unit_id, 0)) DO UPDATE SET geral=EXCLUDED.geral, scores=EXCLUDED.scores`;
}
export async function tendencia(unitId: number | null, dias = 60) {
  return sql<{ data: string; geral: number; scores: Record<string, number> }[]>`SELECT data::text, geral, scores FROM health_snapshots WHERE data >= (${hoje()}::date - ${dias}::int) AND unit_id IS NOT DISTINCT FROM ${unitId} ORDER BY data`;
}
