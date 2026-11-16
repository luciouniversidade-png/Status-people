import Link from "@/components/Link";
import { sql } from "@/db";
import type { Session } from "@/lib/auth";
import { Card, Badge, Btn, Field, Input } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { fmtData, fmtDataHora } from "@/lib/utils";
import * as C from "@/lib/cadastro";
import { cpfMascarado } from "@/lib/rematricula";
import { appUrl } from "@/lib/url";
import { CamposDependente } from "@/components/CadastroCampos";
import { STATUS_ASSINATURA, TOM_ASSINATURA, TIPO_ASSINATURA } from "@/lib/assinaturas";
import { gerarConviteAdmissao, cancelarConviteAdmissao, salvarDependenteRh } from "../alteracoes/actions";

/** v34 · Na ficha (RH e Direção): cadastro completo, dependentes, link da ficha cadastral, pedidos de alteração e assinaturas da pessoa. */
export async function FichaV34({ s, emp, convite }: { s: Session; emp: { id: number; situacao: string }; convite?: string }) {
  if (!C.podeRevisarCadastro(s)) return null;
  const id = emp.id;
  const [atual, deps, pedidos, [link], assin] = await Promise.all([
    C.valoresAtuais(id),
    sql<{ id: number; nome: string; parentesco: string; data_nascimento: string | null; cpf: string | null; irrf: boolean; salario_familia: boolean; plano_saude: boolean; ativo: boolean; fim: string | null; motivo_fim: string | null }[]>`SELECT id, nome, parentesco, data_nascimento::text, cpf, irrf, salario_familia, plano_saude, ativo, fim::text, motivo_fim FROM employee_dependents WHERE employee_id=${id} ORDER BY ativo DESC, data_nascimento NULLS LAST`,
    sql<{ id: number; protocolo: string; tipo: string; origem: string; status: string; created_at: string; ndocs: number }[]>`SELECT id, protocolo, tipo, origem, status, created_at::text, jsonb_array_length(documentos)::int AS ndocs FROM employee_change_requests WHERE employee_id=${id} ORDER BY created_at DESC LIMIT 10`,
    sql<{ expira_em: string; aberto_em: string | null; envios: number; criado_nome: string | null; email: string | null }[]>`SELECT expira_em::text, aberto_em::text, envios, criado_nome, email FROM admission_invites WHERE employee_id=${id} AND estado='ATIVO'`,
    sql<{ id: number; document_id: number; titulo: string; tipo: string; status: string; assinado_em: string | null }[]>`SELECT r.id, r.document_id, d.titulo, d.tipo, r.status, r.assinado_em::text FROM sign_requests r JOIN sign_documents d ON d.id=r.document_id WHERE r.employee_id=${id} ORDER BY r.created_at DESC LIMIT 8`,
  ]);
  const par = (k: string) => C.PARENTESCO.find(x => x[0] === k)?.[1] ?? k;
  const preenchidos = C.CAMPOS.filter(c => atual[c.k]).length; const url = convite ? `${await appUrl()}/admissao/${convite}` : null;
  return <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
    <Card title={`Cadastro completo (${preenchidos}/${C.CAMPOS.length} campos)`}>
      <details><summary className="cursor-pointer text-sm text-acao">Ver os dados (bancários, RG, PIS e raça/cor ficam mascarados)</summary>
        <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">{C.CAMPOS.map(c => <div key={c.k} className="flex justify-between gap-2 border-b border-dashed border-line py-0.5"><dt className="text-slate-500">{c.rotulo.replace(/ \(.*\)$/, "")}</dt><dd className="text-right [overflow-wrap:anywhere]">{c.sensivel ? C.mascaraValor(c.k, atual[c.k]) : C.exibirValor(c.k, atual[c.k])}</dd></div>)}</dl>
      </details>
      <div id="admissao" className="mt-3 border-t border-line pt-3">
        <p className="text-xs font-medium text-navy">Ficha cadastral pelo link (admissão ou recadastramento)</p>
        {url ? <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs"><p className="font-medium text-ok">Copie agora — o link não aparece de novo:</p><code className="mt-1 block select-all break-all rounded bg-white px-2 py-1 text-[11px]">{url}</code><p className="mt-1 text-slate-600">Envie por WhatsApp ou e-mail. A pessoa preenche no celular, sem login; nada vale antes da sua revisão.</p></div> : null}
        {link ? <p className="mt-1 text-xs text-slate-600">Link ativo até {fmtData(link.expira_em)}{link.aberto_em ? ` · aberto em ${fmtDataHora(link.aberto_em)}` : " · ainda não aberto"} · {link.envios} envio(s){link.criado_nome ? ` · gerado por ${link.criado_nome}` : ""}.</p> : <p className="mt-1 text-xs text-slate-500">Nenhum link ativo.</p>}
        {emp.situacao !== "DESLIGADO" ? <div className="mt-2 flex flex-wrap gap-2"><form action={gerarConviteAdmissao} className="flex flex-wrap items-end gap-2"><input type="hidden" name="employeeId" value={id} /><Field label="E-mail (só anotação)"><Input name="email" type="email" placeholder="opcional" className="!py-1 !text-xs" /></Field><Btn small kind="ghost">{link ? "Gerar novo link" : "Gerar link"}</Btn></form>{link ? <form action={cancelarConviteAdmissao} className="flex items-end"><input type="hidden" name="employeeId" value={id} /><Btn small kind="ghost" danger>Cancelar link</Btn></form> : null}</div> : null}
      </div>
      {pedidos.length ? <div className="mt-3 border-t border-line pt-3"><p className="mb-1 text-xs font-medium text-navy">Pedidos de alteração</p><ul className="space-y-1 text-sm">{pedidos.map(p => <li key={p.id} className="flex flex-wrap items-center justify-between gap-2"><Link className="text-acao" href={`/colaboradores/alteracoes/${p.id}`}>{p.protocolo} · {C.TIPO_PEDIDO[p.tipo]}</Link><span className="flex items-center gap-1.5 text-xs text-slate-500">{fmtData(p.created_at.slice(0, 10))} · {p.ndocs} arq.<Badge v={C.TOM_PEDIDO[p.status] ?? "PENDENTE"} label={C.STATUS_PEDIDO[p.status] ?? p.status} /></span></li>)}</ul></div> : null}
    </Card>
    <div className="space-y-4">
      <Card title={`Dependentes (${deps.filter(d => d.ativo).length})`} actions={<Modal label="Incluir" title="Incluir dependente (documento conferido pelo RH)"><form action={salvarDependenteRh} className="space-y-2"><input type="hidden" name="employeeId" value={id} /><CamposDependente /><Btn small>Incluir</Btn></form></Modal>}>
        <div id="dependentes" />
        {deps.length === 0 ? <p className="text-sm text-slate-500">Nenhum dependente. A pessoa pode pedir a inclusão pelo Meu espaço, com a certidão.</p> :
          <ul className="divide-y divide-line text-sm">{deps.map(d => <li key={d.id} className={`flex flex-wrap items-center justify-between gap-2 py-1.5 ${d.ativo ? "" : "text-slate-400"}`}><span className="min-w-0">{d.nome}<span className="block text-[11px] text-slate-500">{par(d.parentesco)}{d.data_nascimento ? ` · nasc. ${fmtData(d.data_nascimento)}` : ""}{d.cpf ? ` · CPF ${cpfMascarado(d.cpf)}` : " · sem CPF"}{[d.irrf && "IR", d.salario_familia && "salário-família", d.plano_saude && "plano"].filter(Boolean).length ? ` · ${[d.irrf && "IR", d.salario_familia && "salário-família", d.plano_saude && "plano"].filter(Boolean).join(", ")}` : ""}{d.ativo ? "" : ` · encerrado em ${fmtData(d.fim)}${d.motivo_fim ? ` (${d.motivo_fim})` : ""}`}</span></span>
            {d.ativo ? <Modal label="encerrar" kind="link" title={`Encerrar ${d.nome}`}><form action={salvarDependenteRh} className="space-y-2"><input type="hidden" name="employeeId" value={id} /><input type="hidden" name="dependentId" value={d.id} /><input type="hidden" name="acao" value="ENCERRAR" /><Field label="Motivo"><Input name="motivo" required placeholder="maioridade, divórcio, óbito…" /></Field><Btn small>Encerrar</Btn></form></Modal> : null}</li>)}</ul>}
      </Card>
      <Card title="Documentos para assinatura" actions={<Link className="text-xs text-acao underline" href="/documentos/assinaturas">todos</Link>}>
        {assin.length === 0 ? <p className="text-sm text-slate-500">Nenhum documento enviado para esta pessoa assinar.</p> : <ul className="space-y-1 text-sm">{assin.map(a => <li key={a.id} className="flex flex-wrap items-center justify-between gap-2"><Link className="min-w-0 text-acao [overflow-wrap:anywhere]" href={`/documentos/assinaturas/${a.document_id}`}>{a.titulo}</Link><span className="flex items-center gap-1.5 text-xs text-slate-500">{TIPO_ASSINATURA[a.tipo] ?? a.tipo}<Badge v={TOM_ASSINATURA[a.status] ?? "PENDENTE"} label={STATUS_ASSINATURA[a.status] ?? a.status} /></span></li>)}</ul>}
      </Card>
    </div>
  </div>;
}
