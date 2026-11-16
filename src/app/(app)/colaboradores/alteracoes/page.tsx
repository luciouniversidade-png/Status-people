import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Flash, Badge, Stat, Table, Td } from "@/components/ui";
import { fmtDataHora } from "@/lib/utils";
import * as C from "@/lib/cadastro";

export const dynamic = "force-dynamic";

/** v34 · Fila de alterações cadastrais: pedidos do Meu espaço (com comprovante), dependentes e fichas de admissão enviadas pelo link. */
export default async function Alteracoes({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!C.podeRevisarCadastro(s)) redirect("/sem-acesso?t=%2Fcolaboradores%2Falteracoes"); const sp = await searchParams;
  const ver = sp.ver === "todos" ? "todos" : "pendentes";
  const [lista, [tot], convites] = await Promise.all([
    sql<{ id: number; protocolo: string; tipo: string; origem: string; status: string; nome: string; unidade: string; employee_id: number; ncampos: number; ndeps: number; ndocs: number; created_at: string; decidido_nome: string | null; decidido_em: string | null }[]>`
      SELECT r.id, r.protocolo, r.tipo, r.origem, r.status, e.nome, u.nome AS unidade, r.employee_id, jsonb_array_length(r.campos)::int AS ncampos, jsonb_array_length(r.dependentes)::int AS ndeps, jsonb_array_length(r.documentos)::int AS ndocs, r.created_at::text, r.decidido_nome, r.decidido_em::text
      FROM employee_change_requests r JOIN employees e ON e.id=r.employee_id JOIN units u ON u.id=e.unit_id WHERE ${ver === "pendentes" ? sql`r.status='PENDENTE'` : sql`true`} ORDER BY (r.status='PENDENTE') DESC, r.created_at ${ver === "pendentes" ? sql`ASC` : sql`DESC`} LIMIT 300`,
    sql<{ pend: number; adm: number; antigos: number; mes: number }[]>`SELECT count(*) FILTER (WHERE status='PENDENTE')::int AS pend, count(*) FILTER (WHERE status='PENDENTE' AND tipo='ADMISSAO')::int AS adm, count(*) FILTER (WHERE status='PENDENTE' AND created_at < now() - interval '3 days')::int AS antigos, count(*) FILTER (WHERE decidido_em > now() - interval '30 days' AND status IN ('APROVADO','PARCIAL','RECUSADO'))::int AS mes FROM employee_change_requests`,
    sql<{ employee_id: number; nome: string; expira_em: string; aberto_em: string | null; envios: number; criado_nome: string | null }[]>`SELECT i.employee_id, e.nome, i.expira_em::text, i.aberto_em::text, i.envios, i.criado_nome FROM admission_invites i JOIN employees e ON e.id=i.employee_id WHERE i.estado='ATIVO' ORDER BY i.expira_em`,
  ]);
  return (
    <Page title="Alterações cadastrais" sub="O que os colaboradores pediram pelo Meu espaço e o que chegou pela ficha de admissão (link). Nada muda na ficha sem a sua revisão campo a campo.">
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Aguardando revisão" value={tot?.pend ?? 0} />
        <Stat label="Fichas de admissão" value={tot?.adm ?? 0} hint="aguardando" />
        <Stat label="Há mais de 3 dias" value={<span className={tot?.antigos ? "text-aviso" : ""}>{tot?.antigos ?? 0}</span>} />
        <Stat label="Decididos em 30 dias" value={tot?.mes ?? 0} />
      </div>
      <div className="mb-3 flex gap-2 text-xs">{[["pendentes", "Aguardando"], ["todos", "Todos"]].map(([k, r]) => <Link key={k} href={`/colaboradores/alteracoes${k === "todos" ? "?ver=todos" : ""}`} className={`rounded-full border px-2.5 py-1 ${ver === k ? "border-acao bg-sky-50 text-acao" : "border-line text-slate-600"}`}>{r}</Link>)}</div>
      <Card title={ver === "pendentes" ? `Aguardando (${lista.length})` : `Pedidos (${lista.length})`} className="mb-4">
        <Table head={["Protocolo", "Pessoa", "O quê", "Origem", "Enviado", "Situação"]} empty={ver === "pendentes" ? "Nada aguardando revisão." : "Nenhum pedido."}>
          {lista.map(r => <tr key={r.id}>
            <Td><Link className="font-medium text-acao" href={`/colaboradores/alteracoes/${r.id}`}>{r.protocolo}</Link></Td>
            <Td><Link className="text-acao" href={`/colaboradores/${r.employee_id}`}>{r.nome}</Link><span className="block text-[11px] text-slate-500">{r.unidade}</span></Td>
            <Td className="text-xs">{C.TIPO_PEDIDO[r.tipo] ?? r.tipo}<span className="block text-[11px] text-slate-500">{[r.ncampos ? `${r.ncampos} campo(s)` : null, r.ndeps ? `${r.ndeps} dependente(s)` : null, r.ndocs ? `${r.ndocs} arquivo(s)` : "sem arquivo"].filter(Boolean).join(" · ")}</span></Td>
            <Td className="text-xs">{C.ORIGEM[r.origem] ?? r.origem}</Td>
            <Td className="whitespace-nowrap text-xs">{fmtDataHora(r.created_at)}</Td>
            <Td><Badge v={C.TOM_PEDIDO[r.status] ?? "PENDENTE"} label={C.STATUS_PEDIDO[r.status] ?? r.status} />{r.decidido_nome ? <span className="block text-[11px] text-slate-500">{r.decidido_nome}</span> : null}</Td>
          </tr>)}
        </Table>
      </Card>
      <Card title={`Links da ficha cadastral ativos (${convites.length})`}>
        {convites.length === 0 ? <p className="text-sm text-slate-500">Nenhum link ativo. Gere na ficha da pessoa (Colaboradores → ficha → “Ficha cadastral pelo link”).</p> :
          <ul className="divide-y divide-line text-sm">{convites.map(c => <li key={c.employee_id} className="flex flex-wrap items-center justify-between gap-2 py-1.5"><Link className="text-acao" href={`/colaboradores/${c.employee_id}#admissao`}>{c.nome}</Link><span className="text-xs text-slate-500">{c.aberto_em ? `aberto em ${fmtDataHora(c.aberto_em)}` : "ainda não aberto"} · {c.envios} envio(s) · vale até {c.expira_em.split("-").reverse().join("/")}{c.criado_nome ? ` · por ${c.criado_nome}` : ""}</span></li>)}</ul>}
      </Card>
    </Page>
  );
}
