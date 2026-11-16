import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Flash, Badge } from "@/components/ui";
import { fmtData, fmtDataHora, hoje } from "@/lib/utils";
import { pedidosDoColaborador, TIPO_ASSINATURA, STATUS_ASSINATURA, TOM_ASSINATURA } from "@/lib/assinaturas";

export const dynamic = "force-dynamic";

/** v34 · Meu espaço → Documentos para assinar: o que falta assinar (ou contestar, no espelho do ponto) e o histórico com os comprovantes. */
export default async function MinhasAssinaturas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!s.employeeId) redirect("/conta"); const sp = await searchParams;
  const todos = await pedidosDoColaborador(s.employeeId, true);
  const respostas = await sql<{ id: number; resolucao: string | null; resolvido_nome: string | null; resolvido_em: string | null }[]>`SELECT id, resolucao, resolvido_nome, resolvido_em::text FROM sign_requests WHERE employee_id=${s.employeeId} AND resolvido_em IS NOT NULL`;
  const resp = new Map(respostas.map(r => [r.id, r]));
  const pend = todos.filter(p => p.status === "PENDENTE"); const hist = todos.filter(p => p.status !== "PENDENTE" && p.status !== "CANCELADO");
  return (
    <Page title="Documentos para assinar" sub="Leia e assine com a sua senha. Espelho do ponto: confira o mês e assine — se algo não confere, conteste e escreva o que está diferente.">
      <Flash ok={sp.ok} erro={sp.erro} />
      <Card title={pend.length ? `Aguardando você (${pend.length})` : "Aguardando você"} className="mb-4">
        {pend.length === 0 ? <p className="text-sm text-ok">Nada para assinar agora.</p> :
          <ul className="divide-y divide-line">{pend.map(p => { const vencido = !!p.prazo && p.prazo < hoje(); return <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="min-w-0"><Link className="font-medium text-acao [overflow-wrap:anywhere]" href={`/eu/assinaturas/${p.id}`}>{p.titulo}</Link><span className="block text-xs text-slate-500">{TIPO_ASSINATURA[p.tipo] ?? p.tipo} · recebido em {fmtData(p.created_at.slice(0, 10))}{p.prazo ? <> · prazo <span className={vencido ? "font-medium text-erro" : ""}>{fmtData(p.prazo)}</span></> : null}</span></div>
            <Link className="rounded-md bg-acao px-3 py-1.5 text-xs font-medium text-white" href={`/eu/assinaturas/${p.id}`}>{p.tipo === "ESPELHO" ? "Conferir e assinar" : "Ler e assinar"}</Link>
          </li>; })}</ul>}
      </Card>
      <Card title="Histórico">
        {hist.length === 0 ? <p className="text-sm text-slate-500">Os documentos que você assinar ficam aqui, com o comprovante.</p> :
          <ul className="divide-y divide-line">{hist.map(p => { const r = resp.get(p.id); return <li key={p.id} className="py-2">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 text-sm [overflow-wrap:anywhere]">{p.titulo}<span className="block text-xs text-slate-500">{TIPO_ASSINATURA[p.tipo] ?? p.tipo}{p.assinado_em ? ` · assinado em ${fmtDataHora(p.assinado_em)}` : ""}</span></span>
              <span className="flex items-center gap-2"><Badge v={TOM_ASSINATURA[p.status] ?? "PENDENTE"} label={STATUS_ASSINATURA[p.status] ?? p.status} />{p.status === "ASSINADO" ? <a className="text-xs text-acao underline" href={`/api/assinaturas/${p.document_id}?modo=comprovante`}>comprovante</a> : null}<a className="text-xs text-acao underline" href={`/api/assinaturas/${p.document_id}`} target="_blank" rel="noopener">documento</a></span></div>
            {p.motivo ? <p className="mt-1 text-xs text-slate-600 [overflow-wrap:anywhere]">Seu motivo: “{p.motivo}”</p> : null}
            {r ? <p className="mt-1 rounded bg-sky-50 px-2 py-1 text-xs text-slate-700 [overflow-wrap:anywhere]">Resposta do RH ({r.resolvido_nome}, {fmtDataHora(r.resolvido_em)}): {r.resolucao}</p> : null}
          </li>; })}</ul>}
      </Card>
    </Page>
  );
}
