import { sql } from "@/db";
import { getSettings, hoje, addDays } from "./utils";
import { alertasContratosLicencas } from "./contratos";
import { situacaoBrigada, semSimulado } from "./seguranca";
import { pendenciasPrivacidade } from "./privacidade";
import type { Alerta } from "./command-center";

/**
 * Alertas dos módulos v22 para o Command Center (e a TV, sem os sensíveis). Privacidade e canal de ética só aparecem para Direção/RH
 * e só como contagem — nunca conteúdo. Cada consulta é isolada: uma tabela ausente (banco desatualizado) não derruba o painel.
 */
export async function alertasV22(unitId: number | null, sensiveis = false, licencas = true): Promise<Alerta[]> {
  const a: Alerta[] = []; const h = hoje(); const uf = (col = "unit_id") => unitId === null ? sql`` : sql`AND ${sql(col)} = ${unitId}`;
  const tenta = async (f: () => Promise<void>) => { try { await f(); } catch { /* módulo indisponível */ } };
  await tenta(async () => {
    const [e] = await sql<{ id: number; tipo: string; unidade: string }[]>`SELECT e.id, e.tipo, u.nome AS unidade FROM emergency_events e JOIN units u ON u.id=e.unit_id WHERE e.status='EM_ANDAMENTO' AND e.tipo='REAL' ${uf("e.unit_id")} ORDER BY e.inicio DESC LIMIT 1`;
    if (e) a.push({ nivel: "ALTO", texto: `Segurança: emergência em andamento — ${e.unidade} (chamada até a entrega às famílias)`, href: `/operacoes/seguranca/emergencias/${e.id}` });
  });
  await tenta(async () => {
    const [c] = await sql<{ hoje: number; amanha: number }[]>`SELECT count(*) FILTER (WHERE data=${h})::int AS hoje, count(*) FILTER (WHERE data=${addDays(h, 1)})::int AS amanha FROM cover_assignments WHERE status IN ('ABERTA','CONVIDADO') AND data BETWEEN ${h} AND ${addDays(h, 1)} ${uf()}`;
    if (c.hoje) a.push({ nivel: "ALTO", texto: `Pessoas: ${c.hoje} aula(s) sem professor hoje`, href: `/cobertura?data=${h}` });
    if (c.amanha) a.push({ nivel: "MEDIO", texto: `Pessoas: ${c.amanha} aula(s) sem professor amanhã`, href: `/cobertura?data=${addDays(h, 1)}` });
  });
  await tenta(async () => {
    const { contratos, licencas: lics } = await alertasContratosLicencas(unitId); const vis = licencas ? lics : [];
    const lv = vis.filter(l => l.situacao === "VENCIDA").length, le = vis.length - lv;
    if (lv) a.push({ nivel: "ALTO", texto: `Operações: ${lv} licença(s)/alvará(s) vencido(s)`, href: "/operacoes/licencas" });
    if (le) a.push({ nivel: "MEDIO", texto: `Operações: ${le} licença(s)/alvará(s) vencendo`, href: "/operacoes/licencas" });
    const cv = contratos.filter(c => c.sit.chave === "VENCIDO").length, ca = contratos.filter(c => c.sit.chave !== "VENCIDO" && c.sit.alertas.some(x => x.nivel === "ALTO")).length, cm = contratos.length - cv - ca;
    if (cv) a.push({ nivel: "ALTO", texto: `Operações: ${cv} contrato(s) de fornecedor vencido(s) sem renovação registrada`, href: "/operacoes/contratos" });
    if (ca) a.push({ nivel: "ALTO", texto: `Operações: ${ca} contrato(s) com prazo de aviso ou vencimento próximo`, href: "/operacoes/contratos" });
    if (cm) a.push({ nivel: "MEDIO", texto: `Operações: ${cm} contrato(s) com vencimento ou reajuste a acompanhar`, href: "/operacoes/contratos" });
  });
  await tenta(async () => {
    const b = await situacaoBrigada(unitId); const abaixo = b.porUnidade.filter(u => u.abaixo); const venc = b.membros.filter(m => m.situacao === "VENCIDO").length;
    if (abaixo.length) a.push({ nivel: "ALTO", texto: `Segurança: brigada abaixo do mínimo em ${abaixo.map(u => u.nome).join(", ")}`, href: "/operacoes/seguranca/brigada" });
    if (venc) a.push({ nivel: "MEDIO", texto: `Segurança: ${venc} brigadista(s) com treinamento vencido`, href: "/operacoes/seguranca/brigada" });
    const ss = await semSimulado(unitId); const cfg = await getSettings();
    if (ss.length) a.push({ nivel: "MEDIO", texto: `Segurança: sem simulado de abandono há mais de ${cfg.portaria.simuladoMeses} meses em ${ss.map(u => u.nome).join(", ")}`, href: "/operacoes/seguranca/emergencias" });
  });
  await tenta(async () => {
    const cfg = await getSettings(); const n = cfg.rematricula.lembreteAbertoDias as number;
    const [r] = await sql<{ abertos: number; expirados: number }[]>`SELECT count(*) FILTER (WHERE l.status='PENDENTE' AND l.aberto_em IS NOT NULL AND l.aberto_em::date <= ${addDays(h, -n)}::date)::int AS abertos,
      count(*) FILTER (WHERE l.status='EXPIRADA' AND l.expira_em >= ${addDays(h, -30)} AND NOT EXISTS (SELECT 1 FROM rematricula_links x WHERE x.student_id=l.student_id AND x.ano=l.ano AND x.status IN ('PENDENTE','CONCLUIDA','RECUSADA')))::int AS expirados
      FROM rematricula_links l JOIN students st ON st.id=l.student_id WHERE true ${unitId === null ? sql`` : sql`AND coalesce(l.unit_id, st.unit_atual_id)=${unitId}`}`;
    if (r.abertos) a.push({ nivel: "MEDIO", texto: `Matrículas: ${r.abertos} família(s) abriram a rematrícula e não concluíram`, href: "/matriculas/rematricula" });
    if (r.expirados) a.push({ nivel: "MEDIO", texto: `Matrículas: ${r.expirados} link(s) de rematrícula expiraram sem resposta (gere um novo)`, href: "/matriculas/rematricula" });
  });
  await tenta(async () => {
    const [s] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM requests WHERE status='EM_APROVACAO' AND prazo_etapa < ${h} ${uf()}`;
    if (s.n) a.push({ nivel: s.n >= 5 ? "ALTO" : "MEDIO", texto: `Processos: ${s.n} solicitação(ões) com aprovação atrasada`, href: "/solicitacoes?aba=todas" });
  });
  if (sensiveis) {
    await tenta(async () => {
      const p = await pendenciasPrivacidade();
      if (p.incidentes.vencidos) a.push({ nivel: "ALTO", texto: `Privacidade: ${p.incidentes.vencidos} incidente(s) com prazo de comunicação à ANPD vencido`, href: "/governanca/privacidade" });
      else if (p.incidentes.pendentes) a.push({ nivel: "ALTO", texto: `Privacidade: ${p.incidentes.pendentes} incidente(s) aguardando decisão sobre comunicar a ANPD`, href: "/governanca/privacidade" });
      if (p.pedidos.vencidos) a.push({ nivel: "ALTO", texto: `Privacidade: ${p.pedidos.vencidos} pedido(s) de titular com prazo vencido`, href: "/governanca/privacidade" });
      if (p.pedidos.vencendo) a.push({ nivel: "MEDIO", texto: `Privacidade: ${p.pedidos.vencendo} pedido(s) de titular vencendo em até 3 dias`, href: "/governanca/privacidade" });
    });
    await tenta(async () => {
      const [e] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ethics_reports WHERE (status='RECEBIDA' AND prazo_triagem < ${h}) OR (status IN ('RECEBIDA','EM_APURACAO') AND prazo_conclusao < ${h})`;
      if (e.n) a.push({ nivel: "ALTO", texto: `Canal de ética: ${e.n} relato(s) com prazo vencido`, href: "/governanca/etica" });
    });
  }
  return a;
}
