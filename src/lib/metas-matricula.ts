import { sql } from "@/db";
import { getSettings, hoje, addDays } from "./utils";
import { painelRematricula } from "./rematricula";
import { KPI, metasDoAno, metaDe } from "./kpi";
import { projetarCampanha } from "./kpi-catalogo";

/**
 * Metas e previsão da campanha de matrícula (v23): matrícula e rematrícula por unidade contra a meta, o que já é compromisso
 * (confirmadas), o provável (reservas válidas) e o potencial (lista de espera e rematrícula em andamento); ritmo semanal e
 * projeção até o fim da campanha com faixa provável; e o ranking das carteiras da rematrícula.
 * Tudo agregado — nenhum lead individual (não é CRM).
 */
export function fimDaCampanha(cfg: { matriculas: { anoLetivo: number; fimCampanha?: string } }) {
  const f = cfg.matriculas.fimCampanha; return f && /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : `${cfg.matriculas.anoLetivo}-01-31`;
}

/** Segunda-feira da semana de uma data (ISO). */
export function segundaDe(iso: string) { const d = new Date(`${iso}T12:00:00Z`); return addDays(iso, -((d.getUTCDay() + 6) % 7)); }

export async function metasMatricula(unitId: number | null) {
  const cfg = await getSettings(); const h = hoje(); const ano = cfg.matriculas.anoLetivo as number; const fim = fimDaCampanha(cfg as never);
  const units = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ${unitId === null ? sql`` : sql`WHERE id=${unitId}`} ORDER BY nome`;
  const [cap, fila, painel, metas] = await Promise.all([
    sql<{ unit_id: number; vagas: number; confirmadas: number; reservas: number }[]>`SELECT c.unit_id, sum(c.vagas)::int AS vagas,
        (SELECT count(*) FROM enrollments e JOIN classes c2 ON c2.id=e.class_id WHERE c2.unit_id=c.unit_id AND c2.ano=${ano} AND c2.modalidade='REGULAR' AND e.status='CONFIRMADA')::int AS confirmadas,
        (SELECT count(*) FROM enrollments e JOIN classes c2 ON c2.id=e.class_id WHERE c2.unit_id=c.unit_id AND c2.ano=${ano} AND c2.modalidade='REGULAR' AND e.status='RESERVADA' AND e.reserva_ate >= ${h})::int AS reservas
      FROM classes c WHERE c.ano=${ano} AND c.modalidade='REGULAR' ${unitId === null ? sql`` : sql`AND c.unit_id=${unitId}`} GROUP BY c.unit_id`,
    sql<{ unit_id: number; n: number }[]>`SELECT unit_id, count(*)::int AS n FROM waitlist WHERE ano=${ano} AND modalidade='REGULAR' AND status IN ('AGUARDANDO','OFERTADA') ${unitId === null ? sql`` : sql`AND unit_id=${unitId}`} GROUP BY 1`,
    painelRematricula(ano, unitId), metasDoAno(Number(h.slice(0, 4))),
  ]);
  const periodo = h.slice(0, 7); const kOc = KPI["matriculas.ocupacao"], kRe = KPI["matriculas.rematricula"];
  const pendentes = new Set(["SEM_LINK", "GERADO", "ENVIADO", "ABERTO", "EXPIRADO"]);
  const porUnidade = units.map(u => {
    const c = cap.find(x => x.unit_id === u.id); const vagas = c?.vagas ?? 0; const conf = c?.confirmadas ?? 0, res = c?.reservas ?? 0; const espera = fila.find(x => x.unit_id === u.id)?.n ?? 0;
    const rem = painel.filter(r => r.unit_id === u.id && r.situacao !== "CONCLUINTE"); const remFeitas = rem.filter(r => r.situacao === "MATRICULADA" || r.situacao === "RESERVADA").length; const remPend = rem.filter(r => pendentes.has(r.situacao)).length;
    const mOc = metaDe(kOc, metas, u.id, cfg, null, periodo); const mRe = metaDe(kRe, metas, u.id, cfg, null, periodo);
    const metaMat = mOc && vagas ? Math.round((vagas * mOc.meta) / 100) : null;
    return { id: u.id, nome: u.nome, vagas, confirmadas: conf, reservas: res, espera, remBase: rem.length, remFeitas, remPend, remRecusas: rem.filter(r => r.situacao === "RECUSOU").length,
      metaOcupacaoPct: mOc?.meta ?? null, metaMatriculas: metaMat, metaRematriculaPct: mRe?.meta ?? null,
      potencial: Math.min(vagas || Infinity, conf + res + espera + remPend), ocupacaoPct: vagas ? (100 * (conf + res)) / vagas : null, rematriculaPct: rem.length ? (100 * remFeitas) / rem.length : null };
  });
  const soma = (k: "vagas" | "confirmadas" | "reservas" | "espera" | "remBase" | "remFeitas" | "remPend" | "remRecusas" | "potencial") => porUnidade.reduce((a, x) => a + (Number.isFinite(x[k]) ? x[k] : 0), 0);
  const metaRede = porUnidade.every(x => x.metaMatriculas !== null) && porUnidade.length ? porUnidade.reduce((a, x) => a + (x.metaMatriculas ?? 0), 0) : null;
  const mReRede = metaDe(kRe, metas, unitId ?? 0, cfg, null, periodo);
  const rede = { vagas: soma("vagas"), confirmadas: soma("confirmadas"), reservas: soma("reservas"), espera: soma("espera"), remBase: soma("remBase"), remFeitas: soma("remFeitas"), remPend: soma("remPend"), remRecusas: soma("remRecusas"), potencial: soma("potencial"), metaMatriculas: metaRede, metaRematriculaPct: mReRede?.meta ?? null };
  // carteiras da rematrícula (quem cuida das famílias)
  const cart = new Map<string, { nome: string; userId: number | null; base: number; feitas: number; pendentes: number; recusas: number }>();
  for (const r of painel) { if (r.situacao === "CONCLUINTE") continue; const k = String(r.carteira_user_id ?? 0); const x = cart.get(k) ?? { nome: r.carteira ?? "Sem carteira", userId: r.carteira_user_id, base: 0, feitas: 0, pendentes: 0, recusas: 0 }; x.base++; if (r.situacao === "MATRICULADA" || r.situacao === "RESERVADA") x.feitas++; else if (pendentes.has(r.situacao)) x.pendentes++; else if (r.situacao === "RECUSOU") x.recusas++; cart.set(k, x); }
  const carteiras = [...cart.values()].map(x => ({ ...x, pct: x.base ? (100 * x.feitas) / x.base : null })).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.base - a.base);
  return { ano, fim, hoje: h, porUnidade, rede, carteiras };
}

/**
 * Ritmo semanal da campanha: matrículas ativas (confirmadas + reservas válidas no fim de cada semana) e rematrícula (% dos alunos
 * atuais com matrícula), por semana desde o início da campanha; projeção até o fim com faixa (ritmo mínimo e máximo das últimas semanas).
 * Matrícula cancelada sai do histórico inteiro (a data do cancelamento não é guardada).
 */
export async function ritmoCampanha(unitId: number | null, capacidade: number | null) {
  const cfg = await getSettings(); const h = hoje(); const ano = cfg.matriculas.anoLetivo as number; const fim = fimDaCampanha(cfg as never); const amanha = addDays(h, 1);
  const [ini] = await sql<{ d: string | null }[]>`SELECT min(e.created_at)::date::text AS d FROM enrollments e JOIN classes c ON c.id=e.class_id WHERE c.ano=${ano} ${unitId === null ? sql`` : sql`AND c.unit_id=${unitId}`}`;
  if (!ini?.d) return null;
  const inicio = segundaDe(ini.d < addDays(h, -52 * 7) ? addDays(h, -52 * 7) : ini.d);
  const semanas = await sql<{ semana: string; ativas: number; rem: number }[]>`WITH w AS (SELECT d::date AS ini, least((d + interval '7 days')::date, ${amanha}::date) AS corte FROM generate_series(${inicio}::date, ${segundaDe(h)}::date, interval '7 days') d)
    SELECT w.ini::text AS semana,
      (SELECT count(*) FROM enrollments e JOIN classes c ON c.id=e.class_id WHERE c.ano=${ano} AND c.modalidade='REGULAR' ${unitId === null ? sql`` : sql`AND c.unit_id=${unitId}`} AND e.created_at < w.corte AND e.status IN ('CONFIRMADA','RESERVADA','EXPIRADA') AND ((e.status='CONFIRMADA' AND e.confirmada_em < w.corte) OR (e.reserva_ate >= w.corte - 1 AND (e.confirmada_em IS NULL OR e.confirmada_em >= w.corte))))::int AS ativas,
      (SELECT count(DISTINCT st.id) FROM students st JOIN enrollments e ON e.student_id=st.id JOIN classes c ON c.id=e.class_id WHERE st.aluno_atual ${unitId === null ? sql`` : sql`AND st.unit_atual_id=${unitId}`} AND c.ano=${ano} AND c.modalidade='REGULAR' AND e.created_at < w.corte AND e.status IN ('CONFIRMADA','RESERVADA','EXPIRADA') AND ((e.status='CONFIRMADA' AND e.confirmada_em < w.corte) OR (e.reserva_ate >= w.corte - 1 AND (e.confirmada_em IS NULL OR e.confirmada_em >= w.corte))))::int AS rem
    FROM w ORDER BY w.ini`;
  const [base] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM students st WHERE st.aluno_atual ${unitId === null ? sql`` : sql`AND st.unit_atual_id=${unitId}`}`;
  const restantes = Math.max(0, Math.ceil((Date.parse(`${fim}T12:00:00Z`) - Date.parse(`${segundaDe(h)}T12:00:00Z`)) / (7 * 86400000)));
  const projMat = projetarCampanha(semanas.map(w => w.ativas), restantes, capacidade);
  const projRem = projetarCampanha(semanas.map(w => w.rem), restantes, base.n || null);
  return { semanas, baseRem: base.n, restantes, fim, projMat, projRem };
}
