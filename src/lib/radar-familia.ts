import { sql } from "@/db";
import { hoje, getSettings } from "./utils";
import { riscoFamilias, ABERTOS, type Fator } from "./atendimento";
import { etapasJornada, segmentoFamilia, diasEntre, type EtapaCfg, type Segmento } from "./gestao-calc";

export const CONTATO_TIPO: Record<string, string> = { LIGACAO: "Ligação", MENSAGEM: "Mensagem", REUNIAO: "Reunião", VISITA: "Visita à escola", EVENTO: "Evento", OUTRO: "Outro" };
export const PERCEPCAO: Record<string, string> = { POSITIVA: "Positiva", NEUTRA: "Neutra", NEGATIVA: "Negativa" };

export type Familia = {
  studentId: number; nome: string; unidade: string | null; unitId: number | null; serie: string | null; responsavel: string | null; telefone: string | null;
  carteiraUserId: number | null; carteira: string | null; segmento: Segmento; pontos: number; nivel: "ALTO" | "MEDIO" | "BAIXO" | null; fatores: Fator[];
  ultimoContato: string | null; diasSemContato: number | null; passoVencido: { texto: string | null; em: string } | null; slaVencido: number; saidaAberta: boolean;
  jornadaAtrasadas: { chave: string; nome: string; prazo: string | null }[]; jornadaProxima: { nome: string; prazo: string | null } | null; jornadaConcluidas: number;
  rematriculaOk: boolean; indicacoes: number; motivosHoje: string[]; prioridadeHoje: number;
};

/**
 * Radar da família: uma linha por aluno atual no escopo, com segmento por regras explícitas,
 * motivos de atenção de hoje e obrigações da escola (jornada) — que não rebaixam a família.
 */
export async function radarFamilias(unitId: number | null, filtros: { carteira?: number | "SEM" | null } = {}) {
  const cfg = await getSettings(); const h = hoje(); const ano = Number(h.slice(0, 4)); const anoLetivo = cfg.matriculas.anoLetivo; const etapas = cfg.atendimento.jornada as EtapaCfg[];
  const rows = await sql<{ id: number; nome: string; unidade: string | null; unit_id: number | null; serie: string | null; responsavel: string | null; telefone: string | null; carteira_user_id: number | null; carteira: string | null;
    ultimo_contato: string | null; ult_proximo_em: string | null; ult_proximo_passo: string | null; sla_vencido: number; saida_aberta: boolean; rematricula_ok: boolean; indicacoes: number; etapas: string[] | null }[]>`
    SELECT st.id, st.nome, u.nome AS unidade, st.unit_atual_id AS unit_id, g.nome AS serie, st.responsavel, st.telefone, st.carteira_user_id, cu.nome AS carteira,
      (SELECT max(fc.data)::text FROM family_contacts fc WHERE fc.student_id=st.id) AS ultimo_contato,
      ult.proximo_em::text AS ult_proximo_em, ult.proximo_passo AS ult_proximo_passo,
      (SELECT count(*) FROM cases c WHERE c.student_id=st.id AND c.status = ANY(${ABERTOS}) AND c.sla_ate < now())::int AS sla_vencido,
      EXISTS (SELECT 1 FROM cases c WHERE c.student_id=st.id AND c.tipo='SAIDA' AND c.status = ANY(${ABERTOS})) AS saida_aberta,
      EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id=st.id AND e.ano=${anoLetivo} AND e.modalidade='REGULAR' AND (e.status='CONFIRMADA' OR (e.status='RESERVADA' AND e.reserva_ate >= ${h}))) AS rematricula_ok,
      (SELECT count(*) FROM students x WHERE x.indicado_por_id=st.id)::int AS indicacoes,
      (SELECT array_agg(j.etapa) FROM family_journey j WHERE j.student_id=st.id AND j.ano=${ano}) AS etapas
    FROM students st LEFT JOIN units u ON u.id=st.unit_atual_id LEFT JOIN grades g ON g.id=st.serie_atual_id LEFT JOIN users cu ON cu.id=st.carteira_user_id
      LEFT JOIN LATERAL (SELECT fc.proximo_em, fc.proximo_passo FROM family_contacts fc WHERE fc.student_id=st.id ORDER BY fc.data DESC, fc.id DESC LIMIT 1) ult ON true
    WHERE st.aluno_atual ${unitId === null ? sql`` : sql`AND st.unit_atual_id=${unitId}`}
      ${filtros.carteira === "SEM" ? sql`AND st.carteira_user_id IS NULL` : typeof filtros.carteira === "number" ? sql`AND st.carteira_user_id=${filtros.carteira}` : sql``}
    ORDER BY st.nome`;
  const risco = new Map((await riscoFamilias(unitId)).map(r => [r.studentId, r]));
  const familias: Familia[] = rows.map(r => {
    const rk = risco.get(r.id); const nivel = rk?.nivel ?? null;
    const passoVencido = r.ult_proximo_em && r.ult_proximo_em < h ? { texto: r.ult_proximo_passo, em: r.ult_proximo_em } : null;
    const js = etapasJornada(etapas, ano, new Set(r.etapas ?? []), h, cfg.atendimento.avisoEtapaDias);
    const segmento = segmentoFamilia({ nivelRisco: nivel, saidaAberta: r.saida_aberta, slaVencido: r.sla_vencido > 0, passoVencido: !!passoVencido });
    const motivos: string[] = []; let prio = 9;
    if (r.saida_aberta) { motivos.push("pedido de saída em aberto"); prio = Math.min(prio, 1); }
    if (nivel === "ALTO") { motivos.push(`risco alto (${rk!.pontos} pontos)`); prio = Math.min(prio, 2); }
    if (r.sla_vencido) { motivos.push(`${r.sla_vencido} caso(s) com prazo vencido`); prio = Math.min(prio, 3); }
    if (passoVencido) { motivos.push(`próximo passo vencido em ${passoVencido.em.split("-").reverse().join("/")}${passoVencido.texto ? `: ${passoVencido.texto}` : ""}`); prio = Math.min(prio, 4); }
    const proxima = js.find(e => e.status === "PROXIMA") ?? null;
    return { studentId: r.id, nome: r.nome, unidade: r.unidade, unitId: r.unit_id, serie: r.serie, responsavel: r.responsavel, telefone: r.telefone, carteiraUserId: r.carteira_user_id, carteira: r.carteira, segmento, pontos: rk?.pontos ?? 0, nivel, fatores: rk?.fatores ?? [],
      ultimoContato: r.ultimo_contato, diasSemContato: r.ultimo_contato ? diasEntre(r.ultimo_contato, h) : null, passoVencido, slaVencido: r.sla_vencido, saidaAberta: r.saida_aberta,
      jornadaAtrasadas: js.filter(e => e.status === "ATRASADA").map(e => ({ chave: e.chave, nome: e.nome, prazo: e.prazo })), jornadaProxima: proxima ? { nome: proxima.nome, prazo: proxima.prazo } : null, jornadaConcluidas: js.filter(e => e.status === "CONCLUIDA").length,
      rematriculaOk: r.rematricula_ok, indicacoes: r.indicacoes, motivosHoje: motivos, prioridadeHoje: prio };
  });
  const sem = cfg.atendimento.semContatoDias;
  const semContato = familias.filter(f => f.diasSemContato === null || f.diasSemContato > sem);
  const atencaoHoje = familias.filter(f => f.motivosHoje.length).sort((a, b) => a.prioridadeHoje - b.prioridadeHoje || b.pontos - a.pontos);
  const jornadaAtrasada = familias.filter(f => f.jornadaAtrasadas.length);
  const carteiras = [...new Map(familias.map(f => [f.carteiraUserId ?? 0, f.carteira ?? "Sem responsável"])).entries()].map(([id, nome]) => {
    const xs = familias.filter(f => (f.carteiraUserId ?? 0) === id);
    return { id, nome, familias: xs.length, risco: xs.filter(f => f.segmento === "RISCO").length, atencao: xs.filter(f => f.segmento === "ATENCAO").length, hoje: xs.filter(f => f.motivosHoje.length).length, semContato: xs.filter(f => f.diasSemContato === null || f.diasSemContato > sem).length, jornadaAtrasada: xs.filter(f => f.jornadaAtrasadas.length).length, rematriculaOk: xs.filter(f => f.rematriculaOk).length };
  }).sort((a, b) => (a.id === 0 ? 1 : 0) - (b.id === 0 ? 1 : 0) || a.nome.localeCompare(b.nome));
  const [nps] = await sql<{ n: number; nps: number | null }[]>`SELECT count(*)::int AS n, CASE WHEN count(*) > 0 THEN round(100.0*(count(*) FILTER (WHERE s.nota >= 9) - count(*) FILTER (WHERE s.nota <= 6))/count(*)) ELSE NULL END::int AS nps FROM surveys s WHERE s.tipo='NPS' AND s.data >= ${h}::date - 180 ${unitId === null ? sql`` : sql`AND s.unit_id=${unitId}`}`;
  const [ind] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM students x JOIN students p ON p.id=x.indicado_por_id WHERE x.created_at >= ${`${ano}-01-01`}::date ${unitId === null ? sql`` : sql`AND p.unit_atual_id=${unitId}`}`;
  const voz = await sql<{ nome: string; student_id: number; tipo: string; nota: number; data: string; comentario: string }[]>`SELECT st.nome, s.student_id, s.tipo, s.nota, s.data::text, s.comentario FROM surveys s JOIN students st ON st.id=s.student_id WHERE NOT s.anonimo AND coalesce(trim(s.comentario),'') <> '' AND s.data >= ${h}::date - 180 ${unitId === null ? sql`` : sql`AND st.unit_atual_id=${unitId}`} ORDER BY s.data DESC LIMIT 8`;
  return {
    familias, atencaoHoje, jornadaAtrasada, semContato, carteiras, voz, ano, anoLetivo, semContatoDias: sem,
    resumo: { ativas: familias.length, saudaveis: familias.filter(f => f.segmento === "SAUDAVEL").length, atencao: familias.filter(f => f.segmento === "ATENCAO").length, risco: familias.filter(f => f.segmento === "RISCO").length, saidas: familias.filter(f => f.saidaAberta).length, rematriculaPendente: familias.filter(f => !f.rematriculaOk).length, semContato: semContato.length, indicacoesAno: ind.n, nps: nps.nps, npsRespostas: nps.n },
  };
}

/** Relacionamento de uma família (ficha do aluno): carteira, sinais para o segmento, jornada do ano, interações e indicações. */
export async function relacionamento(studentId: number) {
  const cfg = await getSettings(); const h = hoje(); const ano = Number(h.slice(0, 4));
  const [contatos, jornada, indicados, [info]] = await Promise.all([
    sql<{ id: number; data: string; canal: string | null; tipo: string; etapa: string | null; resumo: string; percepcao: string | null; proximo_passo: string | null; proximo_em: string | null; user_nome: string | null }[]>`SELECT id, data::text, canal, tipo, etapa, resumo, percepcao, proximo_passo, proximo_em::text, user_nome FROM family_contacts WHERE student_id=${studentId} ORDER BY data DESC, id DESC LIMIT 20`,
    sql<{ etapa: string; concluida_em: string; usuario: string | null; obs: string | null }[]>`SELECT j.etapa, j.concluida_em::text, u.nome AS usuario, j.obs FROM family_journey j LEFT JOIN users u ON u.id=j.user_id WHERE j.student_id=${studentId} AND j.ano=${ano}`,
    sql<{ id: number; nome: string; aluno_atual: boolean; created_at: Date }[]>`SELECT id, nome, aluno_atual, created_at FROM students WHERE indicado_por_id=${studentId} ORDER BY id DESC`,
    sql<{ carteira_user_id: number | null; carteira: string | null; saida_aberta: boolean; sla_vencido: number; indicado_por_id: number | null; indicado_por: string | null }[]>`SELECT st.carteira_user_id, cu.nome AS carteira,
        EXISTS (SELECT 1 FROM cases c WHERE c.student_id=st.id AND c.tipo='SAIDA' AND c.status = ANY(${ABERTOS})) AS saida_aberta,
        (SELECT count(*) FROM cases c WHERE c.student_id=st.id AND c.status = ANY(${ABERTOS}) AND c.sla_ate < now())::int AS sla_vencido,
        st.indicado_por_id, ip.nome AS indicado_por
      FROM students st LEFT JOIN users cu ON cu.id=st.carteira_user_id LEFT JOIN students ip ON ip.id=st.indicado_por_id WHERE st.id=${studentId}`,
  ]);
  const feitas = new Map(jornada.map(j => [j.etapa, j]));
  const etapas = etapasJornada(cfg.atendimento.jornada as EtapaCfg[], ano, new Set(feitas.keys()), h, cfg.atendimento.avisoEtapaDias).map(e => ({ ...e, registro: feitas.get(e.chave) ?? null }));
  const ult = contatos[0]; const passoVencido = ult?.proximo_em && ult.proximo_em < h ? { texto: ult.proximo_passo, em: ult.proximo_em } : null;
  return { ano, contatos, etapas, indicados, carteiraUserId: info?.carteira_user_id ?? null, carteira: info?.carteira ?? null, saidaAberta: info?.saida_aberta ?? false, slaVencido: info?.sla_vencido ?? 0, passoVencido,
    indicadoPorId: info?.indicado_por_id ?? null, indicadoPor: info?.indicado_por ?? null, ultimoContato: ult?.data ?? null, diasSemContato: ult ? diasEntre(ult.data, h) : null, semContatoDias: cfg.atendimento.semContatoDias as number };
}
