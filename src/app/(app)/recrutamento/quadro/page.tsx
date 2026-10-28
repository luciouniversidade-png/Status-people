import Link from "@/components/Link";
import { requireStaff, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Select, Btn, Input } from "@/components/ui";
import { Quadro, type ColunaQuadro, type CartaoQuadro, type TomCartao } from "@/components/Quadro";
import { getSettings } from "@/lib/utils";
import { ETAPA_LABEL, ORIGEM_CAND } from "@/lib/talento";
import { corSerie } from "@/components/graficos";
import { diasDesde } from "@/lib/recrutamento-v30";
import { rankingVaga } from "@/lib/recrutamento-ranking";

export const dynamic = "force-dynamic";

/**
 * v30 · Quadro de candidatos de todas as vagas abertas (no estilo dos pipelines de ATS): cada coluna é uma etapa; o cartão diz há quantos
 * dias a pessoa está ali, a entrevista marcada, as notas dos avaliadores (enviadas × convidadas), documentos a conferir e a proposta.
 * Etiqueta “precisa de decisão” quando todos os avaliadores da etapa já enviaram. Mover de etapa continua na vaga (com a regra da shortlist).
 */
export default async function QuadroCandidatos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const sp = await searchParams; const cfg = await getSettings(); const u = scopeUnit(s);
  const minhas = sp.minhas === "1"; const comPausadas = sp.pausadas === "1"; const rid = sp.vaga ? Number(sp.vaga) : null; const busca = (sp.q ?? "").trim().toLowerCase();
  const [vagas, apps] = await Promise.all([
    sql<{ id: number; titulo: string; unidade: string; status: string }[]>`SELECT r.id, r.titulo, un.nome AS unidade, r.status FROM requisitions r JOIN units un ON un.id=r.unit_id WHERE r.status IN ('ABERTA','PAUSADA') ${u === null ? sql`` : sql`AND r.unit_id=${u}`} ORDER BY r.titulo`,
    sql<{ id: number; candidate_id: number; nome: string; origem: string | null; etapa: string; desde: string; vaga: string; requisition_id: number; unidade: string; status: string; responsavel: string | null; entrevista: string | null; docs: number; convidados: number; enviados: number; proposta: string | null; score: number | null; sugerido?: boolean }[]>`
      SELECT a.id, c.id AS candidate_id, c.nome, c.origem, a.etapa, coalesce(a.etapa_desde, (SELECT max(e.at) FROM application_events e WHERE e.application_id=a.id), a.created_at)::text AS desde,
        r.titulo AS vaga, r.id AS requisition_id, un.nome AS unidade, r.status, us.nome AS responsavel,
        (SELECT to_char(min(x.inicio), 'DD/MM HH24:MI') FROM interview_slots x WHERE x.application_id=a.id AND x.status='ESCOLHIDO' AND x.inicio >= now() - interval '2 hours') AS entrevista,
        (SELECT count(*) FROM candidate_doc_requests d WHERE d.application_id=a.id AND d.status='ENVIADO')::int AS docs,
        (SELECT count(*) FROM interview_feedback f WHERE f.application_id=a.id AND f.etapa=a.etapa AND f.cancelado_em IS NULL)::int AS convidados,
        (SELECT count(*) FROM interview_feedback f WHERE f.application_id=a.id AND f.etapa=a.etapa AND f.cancelado_em IS NULL AND f.enviado_em IS NOT NULL)::int AS enviados,
        a.proposta_enviada_em::text AS proposta, fit.score
      FROM applications a JOIN candidates c ON c.id=a.candidate_id JOIN requisitions r ON r.id=a.requisition_id JOIN units un ON un.id=r.unit_id LEFT JOIN users us ON us.id=r.responsavel_user_id LEFT JOIN application_fit fit ON fit.application_id=a.id
      WHERE ${comPausadas ? sql`r.status IN ('ABERTA','PAUSADA')` : sql`r.status='ABERTA'`} AND a.etapa NOT IN ('REPROVADO','DESISTIU','CONTRATADO') AND a.retirada_em IS NULL
        ${u === null ? sql`` : sql`AND r.unit_id=${u}`} ${rid ? sql`AND r.id=${rid}` : sql``} ${minhas ? sql`AND (r.responsavel_user_id=${s.id} OR r.solicitante_user_id=${s.id})` : sql``}
      ORDER BY a.etapa_desde NULLS FIRST, a.id`,
  ]);
  // shortlist sugerida: a mesma regra da vaga (obrigatórios comprovados, aderência mínima, até o tamanho da shortlist)
  const rids = [...new Set(apps.map(a => a.requisition_id))]; const sug = new Set((await Promise.all(rids.map(x => rankingVaga(x, cfg.recrutamento.fit)))).flat().filter(x => x.sugerido).map(x => x.application_id));
  for (const a of apps) a.sugerido = sug.has(a.id);
  const lista = busca ? apps.filter(a => a.nome.toLowerCase().includes(busca) || a.vaga.toLowerCase().includes(busca)) : apps;
  const limite = (etapa: string) => (etapa === "TRIAGEM" ? Number(cfg.recrutamento.indicadores.slaTriagemDias) || 3 : 7);
  const etapas = cfg.recrutamento.etapas.filter(e => e !== "CONTRATADO");
  const colunas: ColunaQuadro[] = etapas.map((et, i) => {
    const xs = lista.filter(a => a.etapa === et).map(a => ({ a, dias: diasDesde(a.desde) })).sort((x, y) => y.dias - x.dias);
    const media = xs.length ? xs.reduce((n, x) => n + x.dias, 0) / xs.length : null;
    const itens: CartaoQuadro[] = xs.map(({ a, dias }) => {
      const selos: { texto: string; tom: TomCartao }[] = []; const parado = dias > limite(et);
      if (a.status === "PAUSADA") selos.push({ texto: "vaga pausada", tom: "neutro" });
      if (parado) selos.push({ texto: `parado há ${dias} d`, tom: "ruim" });
      if (a.convidados > 0) selos.push(a.enviados === a.convidados ? { texto: "precisa de decisão", tom: "atencao" } : { texto: `notas ${a.enviados}/${a.convidados}`, tom: "neutro" });
      if (a.entrevista) selos.push({ texto: `entrevista ${a.entrevista}`, tom: "bom" });
      if (a.docs > 0) selos.push({ texto: `${a.docs} doc. a conferir`, tom: "atencao" });
      if (et === "PROPOSTA" && a.proposta) { const d = diasDesde(a.proposta); selos.push({ texto: `proposta há ${d} d`, tom: d > 5 ? "atencao" : "neutro" }); }
      if (a.score !== null) selos.push({ texto: `aderência ${a.score}%${a.sugerido ? " · sugerido" : ""}`, tom: a.sugerido ? "bom" : "neutro" });
      return { chave: String(a.id), titulo: a.nome, href: `/recrutamento/vagas/${a.requisition_id}`, linhas: [a.vaga.includes(a.unidade) ? a.vaga : `${a.vaga} · ${a.unidade}`, `${ORIGEM_CAND[a.origem ?? ""] ?? a.origem ?? "origem não informada"} · ${dias === 0 ? "entrou hoje na etapa" : `${dias} d na etapa`}`], selos, responsavel: a.responsavel, destaque: parado ? "ruim" : a.convidados > 0 && a.enviados === a.convidados ? "atencao" : null };
    });
    return { chave: et, titulo: ETAPA_LABEL[et] ?? et, cor: corSerie(i), total: media === null ? null : `média ${media.toFixed(1).replace(".", ",")} d na etapa`, descricao: et === "TRIAGEM" ? `prazo ${limite(et)} d` : undefined, itens };
  });
  const parados = colunas.reduce((n, c) => n + c.itens.filter(i => i.destaque === "ruim").length, 0); const decidir = lista.filter(a => etapas.includes(a.etapa) && a.convidados > 0 && a.enviados === a.convidados).length;
  return (
    <Page title="Quadro de candidatos" sub={<>Todas as vagas abertas por etapa — {lista.length} candidatura(s) em processo · {parados} parada(s) além do prazo · {decidir} precisando de decisão. Mover de etapa é na vaga (com a regra da shortlist). <Link className="text-acao" href="/recrutamento">Vagas</Link> · <Link className="text-acao" href="/recrutamento/indicadores">Indicadores</Link></>}>
      <form className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto_auto]">
        <Input name="q" defaultValue={sp.q ?? ""} placeholder="Buscar candidato ou vaga" aria-label="Buscar" />
        <Select name="vaga" defaultValue={rid ?? ""} aria-label="Vaga"><option value="">Todas as vagas</option>{vagas.map(v => <option key={v.id} value={v.id}>{v.titulo} · {v.unidade}{v.status === "PAUSADA" ? " (pausada)" : ""}</option>)}</Select>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="minhas" value="1" defaultChecked={minhas} /> Só as minhas vagas</label>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="pausadas" value="1" defaultChecked={comPausadas} /> Incluir pausadas</label>
        <Btn kind="ghost">Filtrar</Btn>
      </form>
      <Quadro rotulo="Candidaturas por etapa" colunas={colunas} />
      <p className="mt-3 text-[11px] text-slate-500">Parado = mais de {limite("TRIAGEM")} dias na triagem ou 7 dias nas demais etapas. “Notas 1/3” = avaliadores que já enviaram as notas independentes, do total convidado para a etapa.</p>
    </Page>
  );
}
