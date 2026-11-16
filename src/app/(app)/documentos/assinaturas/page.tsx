import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { requireSession, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Flash, Badge, Btn, Field, Input, Select, Textarea, Stat, Table, Td } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { fmtData, fmtDataHora, hoje, addDays, getSettings } from "@/lib/utils";
import * as A from "@/lib/assinaturas";
import { enviarParaAssinatura } from "./actions";

export const dynamic = "force-dynamic";

/** v34 · Assinatura eletrônica: documentos enviados, andamento de cada um e o envio de um documento novo. */
export default async function Assinaturas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams;
  if (!A.veAssinaturas(s)) redirect("/sem-acesso?t=%2Fdocumentos%2Fassinaturas");
  const u = scopeUnit(s); const cfg = await getSettings(); const tipo = sp.tipo && A.TIPO_ASSINATURA[sp.tipo] ? sp.tipo : null; const status = sp.status && A.DOC_STATUS[sp.status] ? sp.status : null; const mes = sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : null;
  const [docs, [tot], units, cargos, pessoas] = await Promise.all([
    sql<{ id: number; titulo: string; tipo: string; status: string; prazo: string | null; created_at: string; criado_nome: string; unidade: string | null; competencia: string | null; total: number; assinados: number; pendentes: number; recusas: number; abertas: number }[]>`
      SELECT d.id, d.titulo, d.tipo, d.status, d.prazo::text, d.created_at::text, d.criado_nome, un.nome AS unidade, d.competencia,
        count(r.id)::int AS total, count(r.id) FILTER (WHERE r.status='ASSINADO')::int AS assinados, count(r.id) FILTER (WHERE r.status='PENDENTE')::int AS pendentes,
        count(r.id) FILTER (WHERE r.status IN ('RECUSADO','CONTESTADO'))::int AS recusas, count(r.id) FILTER (WHERE r.status IN ('RECUSADO','CONTESTADO') AND r.resolvido_em IS NULL)::int AS abertas
      FROM sign_documents d LEFT JOIN sign_requests r ON r.document_id=d.id LEFT JOIN units un ON un.id=d.unit_id
      WHERE true ${u === null ? sql`` : sql`AND d.unit_id=${u}`} ${tipo ? sql`AND d.tipo=${tipo}` : sql``} ${status ? sql`AND d.status=${status}` : sql``} ${mes ? sql`AND d.competencia=${mes}` : sql``}
      GROUP BY d.id, un.nome ORDER BY (d.status='ABERTO') DESC, d.created_at DESC LIMIT 300`,
    sql<{ abertos: number; pendentes: number; vencidos: number; contest: number; assinados30: number }[]>`SELECT count(DISTINCT d.id) FILTER (WHERE d.status='ABERTO')::int AS abertos, count(r.id) FILTER (WHERE r.status='PENDENTE' AND d.status='ABERTO')::int AS pendentes,
      count(r.id) FILTER (WHERE r.status='PENDENTE' AND d.status='ABERTO' AND d.prazo < ${hoje()})::int AS vencidos, count(r.id) FILTER (WHERE r.status IN ('RECUSADO','CONTESTADO') AND r.resolvido_em IS NULL)::int AS contest,
      count(r.id) FILTER (WHERE r.status='ASSINADO' AND r.assinado_em > now() - interval '30 days')::int AS assinados30 FROM sign_documents d JOIN sign_requests r ON r.document_id=d.id WHERE true ${u === null ? sql`` : sql`AND d.unit_id=${u}`}`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ${u === null ? sql`` : sql`WHERE id=${u}`} ORDER BY nome`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM positions ORDER BY ordem, nome`,
    sql<{ id: number; nome: string; unidade: string; conta: boolean }[]>`SELECT e.id, e.nome, un.nome AS unidade, EXISTS (SELECT 1 FROM users x WHERE x.employee_id=e.id AND x.ativo) AS conta FROM employees e JOIN units un ON un.id=e.unit_id WHERE e.situacao <> 'DESLIGADO' ${u === null ? sql`` : sql`AND e.unit_id=${u}`} ORDER BY e.nome`,
  ]);
  const semConta = pessoas.filter(p => !p.conta).length;
  // o espelho é um documento por pessoa: no painel, os de cada mês e unidade viram uma linha (o filtro "Espelho do ponto" abre um a um)
  type Linha = (typeof docs)[number] & { pessoas?: number };
  const linhas: Linha[] = []; const grupos = new Map<string, Linha>();
  for (const d of docs) {
    if (tipo === "ESPELHO" || d.tipo !== "ESPELHO" || !d.competencia) { linhas.push(d); continue; }
    const k = `${d.competencia}|${d.unidade ?? ""}`; const g = grupos.get(k);
    if (!g) { const novo: Linha = { ...d, pessoas: 1 }; grupos.set(k, novo); linhas.push(novo); continue; }
    g.pessoas = (g.pessoas ?? 1) + 1; g.total += d.total; g.assinados += d.assinados; g.pendentes += d.pendentes; g.recusas += d.recusas; g.abertas += d.abertas;
    if (d.status === "ABERTO") g.status = "ABERTO"; else if (g.status === "CANCELADO" && d.status === "CONCLUIDO") g.status = "CONCLUIDO";
    if (d.prazo && (!g.prazo || d.prazo > g.prazo)) g.prazo = d.prazo; if (d.created_at < g.created_at) g.created_at = d.created_at;
  }
  const filtro = (k: string, v: string | null, r: string) => { const q = new URLSearchParams(); const atual: Record<string, string | null> = { tipo, status, mes, [k]: v }; for (const [a, b] of Object.entries(atual)) if (b) q.set(a, b); return <Link key={`${k}${v}`} href={`/documentos/assinaturas${q.size ? `?${q}` : ""}`} className={`rounded-full border px-2.5 py-1 text-xs ${(k === "tipo" ? tipo : k === "status" ? status : mes) === v ? "border-acao bg-sky-50 text-acao" : "border-line text-slate-600"}`}>{r}</Link>; };
  return (
    <Page title="Assinatura eletrônica" sub="Documentos para ler e assinar no Meu espaço: políticas, contratos e aditivos, termos de EPI e o espelho do ponto do mês. Cada assinatura guarda data e hora, IP, dispositivo e o hash do arquivo."
      actions={A.podeEnviarAssinatura(s) ? <Modal label="Enviar documento" title="Enviar documento para assinatura" kind="primary" small={false}>
        <form action={enviarParaAssinatura} className="space-y-2">
          <Field label="Título (como a pessoa vai ver)"><Input name="titulo" required maxLength={160} placeholder="ex.: Política de uso do celular em sala — 2027" /></Field>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Field label="Tipo"><Select name="tipo" defaultValue="POLITICA">{A.TIPOS_ENVIO.map(t => <option key={t} value={t}>{A.TIPO_ASSINATURA[t]}</option>)}</Select></Field><Field label="Prazo para assinar"><Input type="date" name="prazo" defaultValue={addDays(hoje(), Number(cfg.assinaturas.prazoDias))} min={hoje()} /></Field></div>
          <Field label="Arquivo (PDF — o que for enviado é exatamente o que será assinado)"><Input type="file" name="arquivo" accept="application/pdf" required /></Field>
          <Field label="Mensagem para quem vai assinar (opcional)"><Textarea name="descricao" className="min-h-[56px]" maxLength={600} /></Field>
          <fieldset className="space-y-2 rounded-md border border-line p-2"><legend className="px-1 text-xs font-medium text-navy">Quem assina</legend>
            <div className="flex flex-wrap gap-3 text-xs">{[["PESSOAS", "Pessoas escolhidas"], ["UNIDADE", "Uma unidade"], ["CARGO", "Um cargo"], ["TODOS", u === null ? "Toda a equipe" : "Toda a unidade"]].map(([k, r]) => <label key={k} className="flex items-center gap-1"><input type="radio" name="modo" value={k} defaultChecked={k === "PESSOAS"} /> {r}</label>)}</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Field label="Unidade"><Select name="unitId" defaultValue=""><option value="">—</option>{units.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field><Field label="Cargo"><Select name="positionId" defaultValue=""><option value="">—</option>{cargos.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field></div>
            <Field label="Pessoas (segure Ctrl ou toque para marcar várias)"><select name="pessoas" multiple size={8} className="w-full rounded-md border border-line px-2 py-1 text-sm">{pessoas.map(p => <option key={p.id} value={p.id}>{p.nome} · {p.unidade}{p.conta ? "" : " (sem conta)"}</option>)}</select></Field>
          </fieldset>
          <p className="text-[11px] text-slate-500">A pessoa assina com a própria senha (e o código 2FA, se ativo). {semConta ? `${semConta} pessoa(s) do seu alcance ainda não têm conta no ONE: crie a conta na ficha para que possam assinar.` : ""}</p>
          <Btn small>Enviar para assinatura</Btn>
        </form></Modal> : null}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Documentos em assinatura" value={tot?.abertos ?? 0} />
        <Stat label="Assinaturas aguardando" value={tot?.pendentes ?? 0} hint={tot?.vencidos ? `${tot.vencidos} com prazo vencido` : "dentro do prazo"} />
        <Stat label="Recusas e contestações" value={<span className={tot?.contest ? "text-erro" : ""}>{tot?.contest ?? 0}</span>} hint="sem resposta do RH" />
        <Stat label="Assinadas em 30 dias" value={tot?.assinados30 ?? 0} />
        <Stat label="Sem conta no ONE" value={<span className={semConta ? "text-aviso" : ""}>{semConta}</span>} hint="não conseguem assinar" />
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">{filtro("tipo", null, "Todos os tipos")}{Object.entries(A.TIPO_ASSINATURA).map(([k, r]) => filtro("tipo", k, r))}<span className="mx-1 text-slate-300">|</span>{filtro("status", null, "Qualquer situação")}{Object.entries(A.DOC_STATUS).map(([k, r]) => filtro("status", k, r))}</div>
      <Card title={`Documentos (${docs.length})`}>
        <Table head={["Documento", "Tipo", "Enviado", "Prazo", "Andamento", "Situação"]} empty="Nenhum documento enviado para assinatura.">
          {linhas.map(d => { const pct = d.total ? Math.round(100 * d.assinados / d.total) : 0; const grupo = (d.pessoas ?? 0) > 1; return <tr key={grupo ? `g${d.competencia}${d.unidade}` : d.id}>
            <Td>{grupo ? <Link className="font-medium text-acao [overflow-wrap:anywhere]" href={`/documentos/assinaturas?tipo=ESPELHO&mes=${d.competencia}`}>Espelhos do ponto — {A.mesTxt(d.competencia!)}</Link> : <Link className="font-medium text-acao [overflow-wrap:anywhere]" href={`/documentos/assinaturas/${d.id}`}>{d.titulo}</Link>}<span className="block text-[11px] text-slate-500">{[d.unidade, grupo ? `um por pessoa · ${d.pessoas} pessoas — abrir um a um` : null].filter(Boolean).join(" · ")}</span></Td>
            <Td className="text-xs">{A.TIPO_ASSINATURA[d.tipo] ?? d.tipo}</Td><Td className="whitespace-nowrap text-xs">{fmtData(d.created_at.slice(0, 10))}<span className="block text-[11px] text-slate-500">{d.criado_nome}</span></Td>
            <Td className={`whitespace-nowrap text-xs ${d.status === "ABERTO" && d.prazo && d.prazo < hoje() ? "text-erro" : ""}`}>{d.prazo ? fmtData(d.prazo) : "—"}</Td>
            <Td><div className="min-w-[8rem]"><div className="h-1.5 w-full overflow-hidden rounded bg-slate-100"><div className="h-1.5 bg-ok" style={{ width: `${pct}%` }} /></div><span className="text-[11px] text-slate-600">{d.assinados}/{d.total} assinados{d.pendentes ? ` · ${d.pendentes} aguardando` : ""}{d.recusas ? ` · ${d.recusas} ${d.tipo === "ESPELHO" ? "contestação(ões)" : "recusa(s)"}${d.abertas ? ` (${d.abertas} sem resposta)` : ""}` : ""}</span></div></Td>
            <Td><Badge v={d.status === "ABERTO" ? "ABERTO" : d.status === "CONCLUIDO" ? "CONCLUIDO" : "CANCELADO"} label={A.DOC_STATUS[d.status]} /></Td>
          </tr>; })}
        </Table>
      </Card>
      <p className="mt-3 text-xs text-slate-500">Espelhos do ponto: feche o mês da unidade em <Link className="text-acao underline" href="/ponto#fechamento">Ponto e jornada</Link> e use “Liberar espelhos para assinatura”. Termos de EPI: na entrega, em <Link className="text-acao underline" href="/sst/conformidade#epi">Treinamentos NR, brigada e EPI</Link>, escolha “assinar no ONE”. Última atualização {fmtDataHora(new Date())}.</p>
    </Page>
  );
}
