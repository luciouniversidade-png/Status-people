import { notFound, redirect } from "next/navigation";
import Link from "@/components/Link";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Badge, Flash, Field, Btn, Select, Textarea } from "@/components/ui";
import { fmtData, fmtDataHora, hoje } from "@/lib/utils";
import { podePrivacidade, PEDIDO_TIPO, TITULAR_TIPO, PEDIDO_STATUS, PEDIDO_ABERTO, EXIGE_IDENTIDADE } from "@/lib/privacidade";
import { atualizarPedido } from "../../actions";
import { Anexos } from "@/components/Anexos";

export const dynamic = "force-dynamic";

export default async function Pedido({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!(await podePrivacidade(s))) redirect("/governanca/privacidade");
  const { id } = await params; const sp = await searchParams;
  const [p] = await sql<{ id: number; protocolo: string; tipo: string; titular_nome: string; titular_tipo: string | null; aluno_nome: string | null; contato_email: string | null; contato_telefone: string | null; descricao: string | null; canal: string; status: string; prazo: string; identidade_verificada: boolean; responsavel_user_id: number | null; resposta: string | null; respondida_em: string | null; historico: { em: string; por: string; texto: string }[] | null; created_at: string; student_id: number | null }[]>`SELECT id, protocolo, tipo, titular_nome, titular_tipo, aluno_nome, contato_email, contato_telefone, descricao, canal, status, prazo::text, identidade_verificada, responsavel_user_id, resposta, respondida_em::text, historico, created_at::text, student_id FROM privacy_requests WHERE id=${Number(id)}`;
  if (!p) notFound();
  const users = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM users WHERE ativo AND role <> 'COLABORADOR' ORDER BY nome`;
  const aberto = PEDIDO_ABERTO.includes(p.status); const atraso = aberto && p.prazo < hoje();
  return (
    <Page title={`Pedido ${p.protocolo}`} sub={`${PEDIDO_TIPO[p.tipo]} · recebido ${fmtDataHora(p.created_at)} pelo canal ${p.canal.toLowerCase()}`} actions={<Btn kind="ghost" href="/governanca/privacidade">Privacidade</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="space-y-4">
          <Card title="Pedido">
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2"><div><dt className="text-xs text-slate-500">Titular</dt><dd>{p.titular_nome} · {TITULAR_TIPO[p.titular_tipo ?? ""] ?? "—"}</dd></div><div><dt className="text-xs text-slate-500">Aluno relacionado</dt><dd>{p.student_id ? <Link className="text-acao" href={`/matriculas/alunos/${p.student_id}`}>{p.aluno_nome ?? "ver ficha"}</Link> : p.aluno_nome ?? "—"}</dd></div><div><dt className="text-xs text-slate-500">Contato</dt><dd>{[p.contato_email, p.contato_telefone].filter(Boolean).join(" · ") || "—"}</dd></div><div><dt className="text-xs text-slate-500">Prazo</dt><dd className={atraso ? "font-medium text-erro" : ""}>{fmtData(p.prazo)}{atraso ? " (vencido)" : ""}</dd></div></dl>
            {p.descricao && <p className="mt-3 whitespace-pre-wrap rounded bg-mist p-3 text-sm">{p.descricao}</p>}
            <div className="mt-3 flex flex-wrap gap-2"><Badge v={aberto ? "PENDENTE" : p.status === "RESPONDIDA" ? "APROVADA" : "CANCELADA"} label={PEDIDO_STATUS[p.status]} />{p.identidade_verificada ? <Badge v="APROVADA" label="identidade conferida" /> : EXIGE_IDENTIDADE.includes(p.tipo) ? <Badge v="PENDENTE" label="conferir identidade antes de responder" /> : null}</div>
            {p.resposta && <div className="mt-3 rounded border border-line p-3 text-sm"><div className="text-xs text-slate-500">Resposta ao titular{p.respondida_em ? ` · ${fmtDataHora(p.respondida_em)}` : ""}</div><p className="whitespace-pre-wrap">{p.resposta}</p></div>}
          </Card>
          <Card title="Histórico"><ul className="space-y-1 text-sm">{(p.historico ?? []).map((h, i) => <li key={i}><span className="text-xs text-slate-500">{fmtDataHora(h.em)} · {h.por}</span> — {h.texto}</li>)}</ul></Card>
          <Anexos entidade="privacy_request" id={p.id} voltar={`/governanca/privacidade/pedidos/${p.id}`} titulo="Documentos do pedido" />
        </div>
        {aberto && <Card title="Tratar">
          <form action={atualizarPedido} className="space-y-2"><input type="hidden" name="id" value={p.id} />
            <Field label="Situação"><Select name="status" defaultValue={p.status}>{Object.entries(PEDIDO_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Responsável"><Select name="responsavelUserId" defaultValue={p.responsavel_user_id ?? ""}><option value="">—</option>{users.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>
            {!p.identidade_verificada && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="identidade" value="1" /> Identidade do titular conferida</label>}
            <Field label="Resposta ao titular (para responder ou recusar)"><Textarea name="resposta" defaultValue={p.resposta ?? ""} /></Field>
            <Field label="Nota interna"><Textarea name="nota" className="min-h-[50px]" /></Field>
            <Btn small>Salvar</Btn>
            {p.tipo === "REVOGACAO_CONSENTIMENTO" && p.student_id && <p className="text-xs text-slate-500">Registre a revogação na <Link className="text-acao" href={`/matriculas/alunos/${p.student_id}#autorizacoes`}>ficha do aluno</Link> (marketing é avisado).</p>}
          </form></Card>}
      </div>
    </Page>
  );
}
