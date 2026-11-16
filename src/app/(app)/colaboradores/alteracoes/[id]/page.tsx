import Link from "@/components/Link";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Flash, Badge, Btn, Field, Textarea } from "@/components/ui";
import { fmtData, fmtDataHora } from "@/lib/utils";
import * as C from "@/lib/cadastro";
import { cpfMascarado } from "@/lib/rematricula";
import { decidirPedido } from "../actions";

export const dynamic = "force-dynamic";

/** v34 · Revisão de um pedido: antes × depois de cada campo, os comprovantes e a decisão campo a campo. */
export default async function Revisar({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!C.podeRevisarCadastro(s)) redirect("/sem-acesso?t=%2Fcolaboradores%2Falteracoes"); const sp = await searchParams; const id = Number((await params).id);
  const [p] = await sql<{ id: number; protocolo: string; tipo: string; origem: string; status: string; employee_id: number; nome: string; unidade: string; cargo: string | null; campos: C.MudancaCampo[]; dependentes: (C.DependentePedido & { cpfDigitos?: string | null })[]; documentos: C.Documento[]; motivo: string | null; created_at: string; decidido_nome: string | null; decidido_em: string | null }[]>`
    SELECT r.id, r.protocolo, r.tipo, r.origem, r.status, r.employee_id, e.nome, u.nome AS unidade, po.nome AS cargo, r.campos, r.dependentes, r.documentos, r.motivo, r.created_at::text, r.decidido_nome, r.decidido_em::text
    FROM employee_change_requests r JOIN employees e ON e.id=r.employee_id JOIN units u ON u.id=e.unit_id LEFT JOIN positions po ON po.id=e.position_id WHERE r.id=${id}`;
  if (!p) notFound();
  const aberto = p.status === "PENDENTE"; const par = (k: string) => C.PARENTESCO.find(x => x[0] === k)?.[1] ?? k;
  const grupos = [...new Set(p.campos.map(c => C.CAMPO.get(c.campo)?.grupo ?? "Outros"))];
  return (
    <Page title={`${p.protocolo} · ${C.TIPO_PEDIDO[p.tipo] ?? p.tipo}`} sub={<><Link className="text-acao" href={`/colaboradores/${p.employee_id}`}>{p.nome}</Link> · {p.cargo ?? "—"} · {p.unidade} · {C.ORIGEM[p.origem] ?? p.origem} · enviado em {fmtDataHora(p.created_at)}</>}
      actions={<Btn kind="ghost" href="/colaboradores/alteracoes">Voltar à fila</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {!aberto ? <p className="mb-3 rounded-md border border-line bg-white p-3 text-sm"><Badge v={C.TOM_PEDIDO[p.status] ?? "PENDENTE"} label={C.STATUS_PEDIDO[p.status] ?? p.status} /> {p.decidido_nome ? `por ${p.decidido_nome} em ${fmtDataHora(p.decidido_em)}` : ""}{p.motivo ? ` — ${p.motivo}` : ""}</p> : null}
      <form action={decidirPedido} className="space-y-4"><input type="hidden" name="id" value={p.id} />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] xl:items-start">
          <div className="min-w-0 space-y-4">
            {grupos.map(g => <Card key={g} title={g}>
              <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th className="py-1 pr-2">Campo</th><th className="py-1 pr-2">Hoje na ficha</th><th className="py-1 pr-2">Pedido</th><th className="py-1">Decisão</th></tr></thead>
                <tbody>{p.campos.filter(c => (C.CAMPO.get(c.campo)?.grupo ?? "Outros") === g).map(c => { const sens = !!C.CAMPO.get(c.campo)?.sensivel; return <tr key={c.campo} className="border-t border-line align-top">
                  <td className="py-1.5 pr-2 text-xs text-slate-600">{c.rotulo}</td>
                  <td className="py-1.5 pr-2 text-slate-500 [overflow-wrap:anywhere]">{C.exibirValor(c.campo, c.antes)}</td>
                  <td className="py-1.5 pr-2 font-medium [overflow-wrap:anywhere]">{C.exibirValor(c.campo, c.depois)}{sens ? <span className="block text-[10px] font-normal text-slate-400">dado sensível: não vai para a trilha</span> : null}</td>
                  <td className="py-1.5">{aberto ? <select name={`c_${c.campo}`} defaultValue="APROVADO" className="rounded border border-line px-1 py-0.5 text-xs" aria-label={`Decisão: ${c.rotulo}`}><option value="APROVADO">aprovar</option><option value="RECUSADO">recusar</option></select> : <b className={c.decisao === "APROVADO" ? "text-xs text-ok" : "text-xs text-erro"}>{c.decisao === "APROVADO" ? "aplicado" : "recusado"}</b>}</td>
                </tr>; })}</tbody></table></div>
            </Card>)}
            {p.dependentes.length ? <Card title="Dependentes">
              <ul className="divide-y divide-line text-sm">{p.dependentes.map((d, i) => <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-1.5"><span className="min-w-0"><b>{d.acao === "INCLUIR" ? "Incluir" : "Excluir"}</b> {d.nome} · {par(d.parentesco)}<span className="block text-xs text-slate-500">{d.dataNascimento ? `nasc. ${fmtData(d.dataNascimento)}` : "sem data de nascimento"}{d.cpfDigitos ? ` · CPF ${cpfMascarado(d.cpfDigitos)}` : ""}{[d.irrf && "IR", d.salarioFamilia && "salário-família", d.planoSaude && "plano"].filter(Boolean).length ? ` · ${[d.irrf && "IR", d.salarioFamilia && "salário-família", d.planoSaude && "plano"].filter(Boolean).join(", ")}` : ""}{d.motivo ? ` · motivo: ${d.motivo}` : ""}</span></span>
                {aberto ? <select name={`d_${i}`} defaultValue="APROVADO" className="rounded border border-line px-1 py-0.5 text-xs" aria-label={`Decisão: ${d.nome}`}><option value="APROVADO">aprovar</option><option value="RECUSADO">recusar</option></select> : <b className={d.decisao === "APROVADO" ? "text-xs text-ok" : "text-xs text-erro"}>{d.decisao === "APROVADO" ? "feito" : "recusado"}</b>}</li>)}</ul>
            </Card> : null}
          </div>
          <div className="min-w-0 space-y-4">
            <Card title={`Comprovantes (${p.documentos.length})`}>
              {p.documentos.length === 0 ? <p className="text-sm text-slate-500">Nenhum arquivo enviado.</p> : <ul className="space-y-1 text-sm">{p.documentos.map(d => <li key={d.attachmentId}><a className="text-acao underline [overflow-wrap:anywhere]" href={`/api/anexos/${d.attachmentId}`} target="_blank" rel="noopener">{d.tipo}</a><span className="block text-[11px] text-slate-500 [overflow-wrap:anywhere]">{d.nome}</span></li>)}</ul>}
              <p className="mt-2 text-[11px] text-slate-500">Arquivos restritos ao RH e à Direção (e à própria pessoa). Confira nome, data e titularidade antes de aprovar — conta salário precisa estar no nome da pessoa.</p>
            </Card>
            {p.motivo && aberto ? <Card title="Observação de quem pediu"><p className="text-sm [overflow-wrap:anywhere]">{p.motivo}</p></Card> : null}
            {aberto ? <Card title="Decidir">
              <Field label="Motivo do que for recusado (a pessoa vê)"><Textarea name="motivo" maxLength={800} className="min-h-[70px]" placeholder="ex.: Comprovante de residência com mais de 90 dias; envie um recente." /></Field>
              <p className="my-2 text-[11px] text-slate-500">Aplicar grava na ficha só o que estiver “aprovar”. Endereço aprovado atualiza também o endereço completo da ficha. Dependente aprovado entra na lista de dependentes da pessoa.</p>
              <Btn>Aplicar decisão</Btn>
            </Card> : null}
          </div>
        </div>
      </form>
    </Page>
  );
}
