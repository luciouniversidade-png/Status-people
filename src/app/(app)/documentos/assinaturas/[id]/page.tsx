import Link from "@/components/Link";
import { notFound, redirect } from "next/navigation";
import { requireSession, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Flash, Badge, Btn, Field, Textarea, Select, Stat, Table, Td } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { fmtData, fmtDataHora, hoje } from "@/lib/utils";
import * as A from "@/lib/assinaturas";
import { cancelarDocumento, lembrarPendentes, resolverContestacao } from "../actions";

export const dynamic = "force-dynamic";

/** v34 · Um documento enviado para assinatura: quem assinou (com as evidências), quem falta, recusas e contestações para responder. */
export default async function Documento({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams; const id = Number((await params).id);
  if (!A.veAssinaturas(s)) redirect("/sem-acesso?t=%2Fdocumentos%2Fassinaturas");
  const [d] = await sql<{ id: number; titulo: string; tipo: string; descricao: string | null; status: string; prazo: string | null; created_at: string; criado_nome: string; unit_id: number | null; unidade: string | null; competencia: string | null; hash: string; paginas: number | null; cancelado_em: string | null; cancelado_nome: string | null; motivo_cancelamento: string | null; arquivo: string; tamanho: number }[]>`
    SELECT d.id, d.titulo, d.tipo, d.descricao, d.status, d.prazo::text, d.created_at::text, d.criado_nome, d.unit_id, un.nome AS unidade, d.competencia, d.hash, d.paginas, d.cancelado_em::text, d.cancelado_nome, d.motivo_cancelamento, a.nome AS arquivo, a.tamanho
    FROM sign_documents d JOIN attachments a ON a.id=d.attachment_id LEFT JOIN units un ON un.id=d.unit_id WHERE d.id=${id}`;
  if (!d) notFound();
  const u = scopeUnit(s); if (u !== null && d.unit_id !== u) redirect("/sem-acesso?t=%2Fdocumentos%2Fassinaturas");
  const rs = await sql<{ id: number; employee_id: number; nome: string; cargo: string | null; unidade: string; status: string; assinado_em: string | null; recusado_em: string | null; motivo: string | null; metodo: string | null; ip: string | null; user_agent: string | null; hash_conferido: string | null; lembrado_em: string | null; resolvido_em: string | null; resolvido_nome: string | null; resolucao: string | null; conta: boolean }[]>`
    SELECT r.id, r.employee_id, e.nome, p.nome AS cargo, un.nome AS unidade, r.status, r.assinado_em::text, r.recusado_em::text, r.motivo, r.metodo, r.ip, r.user_agent, r.hash_conferido, r.lembrado_em::text, r.resolvido_em::text, r.resolvido_nome, r.resolucao,
      EXISTS (SELECT 1 FROM users x WHERE x.employee_id=e.id AND x.ativo) AS conta
    FROM sign_requests r JOIN employees e ON e.id=r.employee_id JOIN units un ON un.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id WHERE r.document_id=${id} ORDER BY (r.status='PENDENTE'), (r.status IN ('RECUSADO','CONTESTADO') AND r.resolvido_em IS NULL) DESC, coalesce(r.assinado_em, r.recusado_em) DESC NULLS LAST, e.nome`;
  const n = (st: string) => rs.filter(r => r.status === st).length;
  const abertas = rs.filter(r => ["RECUSADO", "CONTESTADO"].includes(r.status) && !r.resolvido_em);
  const semConta = rs.filter(r => r.status === "PENDENTE" && !r.conta).length;
  const respostas = rs.filter(r => r.status !== "PENDENTE"); const aguardando = rs.filter(r => r.status === "PENDENTE");
  const rh = A.podeEnviarAssinatura(s); const vencido = d.status === "ABERTO" && !!d.prazo && d.prazo < hoje();
  return (
    <Page title={d.titulo} sub={<>{A.TIPO_ASSINATURA[d.tipo] ?? d.tipo}{d.unidade ? ` · ${d.unidade}` : ""} · enviado por {d.criado_nome} em {fmtDataHora(d.created_at)}{d.prazo ? <> · prazo <span className={vencido ? "font-medium text-erro" : ""}>{fmtData(d.prazo)}</span></> : null}</>}
      actions={<div className="flex flex-wrap gap-2">
        <a className="inline-flex items-center rounded-md border border-line bg-white px-3 py-2 text-sm text-navy hover:bg-slate-50" href={`/api/assinaturas/${d.id}`} target="_blank" rel="noopener">Ver o documento</a>
        <a className="inline-flex items-center rounded-md border border-line bg-white px-3 py-2 text-sm text-navy hover:bg-slate-50" href={`/api/assinaturas/${d.id}?modo=comprovante`}>Comprovante (PDF)</a>
        {d.status === "ABERTO" && n("PENDENTE") ? <form action={lembrarPendentes}><input type="hidden" name="id" value={d.id} /><Btn kind="ghost">Lembrar quem falta</Btn></form> : null}
        {rh && d.status === "ABERTO" ? <Modal label="Cancelar" title="Cancelar o documento" kind="danger" small={false}><form action={cancelarDocumento} className="space-y-2"><input type="hidden" name="id" value={d.id} />
          <p className="text-xs text-slate-600">Quem ainda não assinou deixa de ver o documento. As assinaturas já feitas continuam registradas no comprovante, com o motivo do cancelamento.</p>
          <Field label="Motivo"><Textarea name="motivo" required minLength={10} className="min-h-[60px]" /></Field><Btn small danger>Cancelar documento</Btn></form></Modal> : null}
      </div>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {d.status === "CANCELADO" ? <p className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">Cancelado por {d.cancelado_nome} em {fmtDataHora(d.cancelado_em)}: {d.motivo_cancelamento}</p> : null}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Assinaram" value={`${n("ASSINADO")}/${rs.length}`} />
        <Stat label="Aguardando" value={<span className={vencido && n("PENDENTE") ? "text-erro" : ""}>{n("PENDENTE")}</span>} hint={vencido ? "prazo vencido" : undefined} />
        <Stat label={d.tipo === "ESPELHO" ? "Contestações" : "Recusas"} value={<span className={abertas.length ? "text-erro" : ""}>{n("RECUSADO") + n("CONTESTADO")}</span>} hint={abertas.length ? `${abertas.length} sem resposta` : undefined} />
        <Stat label="Sem conta no ONE" value={<span className={semConta ? "text-aviso" : ""}>{semConta}</span>} hint="aguardando e sem como assinar" />
        <Stat label="Arquivo" value={<span className="text-sm">{d.paginas ?? "?"} pág. · {Math.max(1, Math.round(d.tamanho / 1024))} KB</span>} />
      </div>
      {d.descricao ? <p className="mb-3 rounded-md border border-line bg-white p-3 text-sm text-slate-700">{d.descricao}</p> : null}
      {abertas.length && rh ? <Card title={`${d.tipo === "ESPELHO" ? "Contestações" : "Recusas"} para responder (${abertas.length})`} className="mb-4">
        <div className="space-y-3">{abertas.map(r => <div key={r.id} className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm"><b>{r.nome}</b> · {r.unidade} · {fmtDataHora(r.recusado_em)}</p>
          <p className="mt-1 whitespace-pre-line text-sm text-slate-800 [overflow-wrap:anywhere]">“{r.motivo}”</p>
          <form action={resolverContestacao} className="mt-2 space-y-2"><input type="hidden" name="requestId" value={r.id} />
            <Field label="Resposta do RH (a pessoa vê no Meu espaço)"><Textarea name="resolucao" required minLength={10} className="min-h-[56px]" placeholder={d.tipo === "ESPELHO" ? "ex.: Conferido no relógio: a saída do dia 12 foi corrigida para 17:30 e o espelho revisado foi reenviado." : "ex.: Esclarecido com a pessoa; a versão corrigida segue em novo envio."} /></Field>
            <div className="flex flex-wrap items-end gap-2"><Field label="E agora?" className="min-w-[16rem]"><Select name="acao" defaultValue={d.tipo === "ESPELHO" ? "REENVIAR" : "MANTER"}><option value="MANTER">Só responder</option>{d.tipo === "ESPELHO" ? <option value="REENVIAR">Responder e reenviar o espelho revisado</option> : null}</Select></Field><Btn small>Responder</Btn></div>
            {d.tipo === "ESPELHO" ? <p className="text-[11px] text-slate-500">Reenviar gera o espelho de novo com o ponto que está no ONE agora — corrija no relógio e reimporte antes.</p> : null}
          </form></div>)}</div>
      </Card> : null}
      {aguardando.length ? <Card title={`Aguardando (${aguardando.length})`} className="mb-4">
        <div className="flex flex-wrap gap-1.5">{aguardando.map(r => <Link key={r.id} href={`/colaboradores/${r.employee_id}`} title={`${r.cargo ?? "—"} · ${r.unidade}`} className={`rounded-full border px-2.5 py-1 text-xs ${r.conta ? "border-line bg-white text-navy hover:bg-slate-50" : "border-amber-200 bg-amber-50 text-amber-900"}`}>{r.nome}{!r.conta ? " · sem conta" : r.lembrado_em ? <span className="text-slate-500"> · lembrado {fmtData(r.lembrado_em.slice(0, 10))}</span> : null}</Link>)}</div>
        <p className="mt-2 text-[11px] text-slate-500">{semConta ? `Em amarelo, quem não tem conta no ONE: crie o acesso em Configurações ou colete a assinatura em papel. ` : ""}{d.status === "ABERTO" ? "“Lembrar quem falta” manda um novo aviso a quem tem conta; a rotina também lembra antes do prazo." : ""}</p>
      </Card> : null}
      <Card title={`Quem respondeu (${respostas.length} de ${rs.length})`}>
        <Table head={["Pessoa", "Situação", "Quando", "Evidência", ""]} empty="Ninguém respondeu ainda.">
          {respostas.map(r => <tr key={r.id}>
            <Td><Link className="font-medium text-acao" href={`/colaboradores/${r.employee_id}`}>{r.nome}</Link><span className="block text-[11px] text-slate-500">{r.cargo ?? "—"} · {r.unidade}</span></Td>
            <Td><Badge v={A.TOM_ASSINATURA[r.status] ?? "PENDENTE"} label={A.STATUS_ASSINATURA[r.status] ?? r.status} />{r.resolvido_em ? <span className="mt-1 block text-[11px] text-slate-500">respondido por {r.resolvido_nome}</span> : null}</Td>
            <Td className="whitespace-nowrap text-xs">{r.assinado_em ? fmtDataHora(r.assinado_em) : r.recusado_em ? fmtDataHora(r.recusado_em) : "—"}</Td>
            <Td className="text-[11px] text-slate-600">{r.metodo ? <><span className="block">{r.metodo === "SENHA+2FA" ? "senha + código 2FA" : "senha"} · IP {r.ip ?? "—"}</span><span className="block" title={r.user_agent ?? ""}>{A.dispositivo(r.user_agent)}</span><span className={`block ${r.hash_conferido === d.hash ? "text-ok" : "text-erro"}`}>{r.hash_conferido === d.hash ? "hash do arquivo confere" : "hash diferente"}</span></> : r.motivo ? <span className="block whitespace-pre-line [overflow-wrap:anywhere]">“{r.motivo}”{r.resolvido_em ? <> → {r.resolucao}</> : null}</span> : "—"}</Td>
            <Td>{r.status === "ASSINADO" ? <a className="text-xs text-acao underline" href={`/api/assinaturas/${d.id}?modo=comprovante&pedido=${r.id}`}>comprovante</a> : null}</Td>
          </tr>)}
        </Table>
      </Card>
      <p className="mt-3 text-[11px] text-slate-500 [overflow-wrap:anywhere]">Hash SHA-256 do arquivo enviado: <code>{d.hash}</code>. Cada assinatura recalcula o hash do arquivo guardado e só vale se for igual a este.</p>
    </Page>
  );
}
