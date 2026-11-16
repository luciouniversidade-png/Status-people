import Link from "@/components/Link";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Flash, Btn, Field, Input, Textarea } from "@/components/ui";
import { fmtData, fmtDataHora } from "@/lib/utils";
import { TIPO_ASSINATURA, STATUS_ASSINATURA, totaisDoMes } from "@/lib/assinaturas";
import { montarMes } from "@/lib/ponto";
import { fmtMin } from "@/lib/utils";
import { assinarDocumento, recusarDocumento } from "../actions";

export const dynamic = "force-dynamic";

/** v34 · Ler e assinar um documento (ou conferir e assinar o espelho do ponto). A pessoa só vê os próprios pedidos. */
export default async function Assinar({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!s.employeeId) redirect("/conta"); const sp = await searchParams; const id = Number((await params).id);
  const [r] = await sql<{ id: number; document_id: number; employee_id: number; status: string; titulo: string; tipo: string; descricao: string | null; prazo: string | null; doc_status: string; competencia: string | null; paginas: number | null; hash: string; criado_nome: string; assinado_em: string | null }[]>`
    SELECT r.id, r.document_id, r.employee_id, r.status, d.titulo, d.tipo, d.descricao, d.prazo::text, d.status AS doc_status, d.competencia, d.paginas, d.hash, d.criado_nome, r.assinado_em::text FROM sign_requests r JOIN sign_documents d ON d.id=r.document_id WHERE r.id=${id}`;
  if (!r || r.employee_id !== s.employeeId) notFound();
  const [u] = await sql<{ totp_ativo: boolean }[]>`SELECT totp_ativo FROM users WHERE id=${s.id}`;
  const aberto = r.status === "PENDENTE" && r.doc_status === "ABERTO"; const espelho = r.tipo === "ESPELHO";
  const t = espelho && r.competencia ? totaisDoMes((await montarMes(s.employeeId, r.competencia)).dias.filter(d => d.salvo)) : null;
  const url = `/api/assinaturas/${r.document_id}`;
  return (
    <Page title={r.titulo} sub={`${TIPO_ASSINATURA[r.tipo] ?? r.tipo} · enviado por ${r.criado_nome}${r.prazo ? ` · assinar até ${fmtData(r.prazo)}` : ""}`}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {!aberto ? <p className="mb-3 rounded-md border border-line bg-white p-3 text-sm">Situação: <b>{STATUS_ASSINATURA[r.status] ?? r.status}</b>{r.assinado_em ? ` em ${fmtDataHora(r.assinado_em)}` : ""}{r.doc_status === "CANCELADO" ? " — o documento foi cancelado pelo RH." : ""} <Link className="text-acao underline" href="/eu/assinaturas">voltar</Link></p> : null}
      {r.descricao ? <p className="mb-3 rounded-md border border-line bg-white p-3 text-sm text-slate-700">{r.descricao}</p> : null}
      {t ? <div className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {[["Esperado", fmtMin(t.esperado).replace("+", "")], ["Trabalhado", fmtMin(t.trabalhado).replace("+", "")], ["Saldo do mês", fmtMin(t.saldo)], ["Horas a mais", fmtMin(t.extras).replace("+", "")], ["Atrasos e saídas", fmtMin(t.atrasos).replace("+", "")], ["Faltas", `${t.diasFalta} dia(s)`], ["Atestados", `${t.atestados} dia(s)`]].map(([k, v]) => <div key={k} className="rounded-md border border-line bg-white px-3 py-2"><span className="block text-[11px] text-slate-500">{k}</span><b className="tabular-nums">{v}</b></div>)}
      </div> : null}
      <Card title="Documento" className="mb-4" actions={<a className="text-xs text-acao underline" href={`${url}?baixar=1`}>baixar PDF</a>}>
        <object data={url} type="application/pdf" className="hidden h-[70vh] w-full rounded border border-line sm:block" aria-label="Documento em PDF"><p className="text-sm">Seu navegador não mostra PDF aqui. <a className="text-acao underline" href={url} target="_blank" rel="noopener">Abrir o documento</a>.</p></object>
        <a className="block rounded-md border border-line bg-sky-50 px-3 py-3 text-center text-sm font-medium text-acao sm:hidden" href={url} target="_blank" rel="noopener">Abrir o documento ({r.paginas ?? "?"} pág.)</a>
      </Card>
      {aberto ? <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={espelho ? "Está tudo certo? Assine" : "Assinar"}>
          <form action={assinarDocumento} className="space-y-2"><input type="hidden" name="requestId" value={r.id} />
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="li" value="1" required className="mt-1" /> {espelho ? "Conferi o espelho do ponto do mês e as marcações estão corretas." : "Li o documento e concordo com o conteúdo."}</label>
            <Field label="Sua senha do ONE (confirma que é você)"><Input type="password" name="senha" required autoComplete="current-password" /></Field>
            {u?.totp_ativo ? <Field label="Código do aplicativo autenticador (6 dígitos)"><Input name="codigo" inputMode="numeric" pattern="[0-9 ]{6,7}" required autoComplete="one-time-code" /></Field> : null}
            <p className="text-[11px] text-slate-500">Ficam registrados: data e hora, o endereço IP, o dispositivo e o hash do arquivo (a “impressão digital” do PDF), que prova que o documento assinado é exatamente este.</p>
            <Btn>Assinar</Btn>
          </form>
        </Card>
        <Card title={espelho ? "Algo não confere? Conteste" : "Não concorda? Recuse com o motivo"}>
          <form action={recusarDocumento} className="space-y-2"><input type="hidden" name="requestId" value={r.id} />
            <Field label={espelho ? "O que está diferente (dia, horário e o correto)" : "Motivo"}><Textarea name="motivo" required minLength={10} maxLength={1200} className="min-h-[90px]" placeholder={espelho ? "ex.: Dia 12/03 saí às 17:30, não às 16:30. Dia 20/03 estava de atestado (enviado ao RH)." : ""} /></Field>
            <p className="text-[11px] text-slate-500">{espelho ? "O RH confere no relógio, corrige e responde aqui; se precisar, manda o espelho revisado para você assinar de novo." : "O RH recebe o seu motivo e responde aqui no Meu espaço."}</p>
            <Btn kind="ghost">{espelho ? "Contestar" : "Recusar"}</Btn>
          </form>
          {espelho ? <p className="mt-3 text-xs text-slate-600">Esqueceu de bater o ponto num dia? Use <Link className="text-acao underline" href="/eu#ajuste">Pedir ajuste de ponto</Link> no Meu espaço.</p> : null}
        </Card>
      </div> : null}
    </Page>
  );
}
