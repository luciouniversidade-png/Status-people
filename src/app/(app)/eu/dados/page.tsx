import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Flash, Badge, Btn, Field, Input, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { fmtData, fmtDataHora } from "@/lib/utils";
import * as C from "@/lib/cadastro";
import { cpfMascarado } from "@/lib/rematricula";
import { Arquivos, CamposDependente } from "@/components/CadastroCampos";
import { pedirAlteracaoCadastral, pedirInclusaoDependente, pedirExclusaoDependente, cancelarPedidoCadastral } from "./actions";

export const dynamic = "force-dynamic";
/** v34 · Meu espaço → Meus dados: ver o cadastro, pedir alteração com comprovante e cuidar dos dependentes. */
export default async function MeusDados({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!s.employeeId) redirect("/conta"); const sp = await searchParams; const eid = s.employeeId;
  const [[e], atual, deps, pedidos] = await Promise.all([
    sql<{ nome: string; cpf: string | null; cargo: string | null; unidade: string; admissao: string; empresa: string | null }[]>`SELECT e.nome, e.cpf, p.nome AS cargo, u.nome AS unidade, e.admissao::text, c.nome AS empresa FROM employees e JOIN units u ON u.id=e.unit_id LEFT JOIN positions p ON p.id=e.position_id LEFT JOIN companies c ON c.id=e.company_id WHERE e.id=${eid}`,
    C.valoresAtuais(eid),
    sql<{ id: number; nome: string; parentesco: string; data_nascimento: string | null; irrf: boolean; salario_familia: boolean; plano_saude: boolean; cpf: string | null }[]>`SELECT id, nome, parentesco, data_nascimento::text, irrf, salario_familia, plano_saude, cpf FROM employee_dependents WHERE employee_id=${eid} AND ativo ORDER BY data_nascimento NULLS LAST, nome`,
    sql<{ id: number; protocolo: string; tipo: string; status: string; campos: C.MudancaCampo[]; dependentes: C.DependentePedido[]; motivo: string | null; decidido_nome: string | null; decidido_em: string | null; created_at: string }[]>`SELECT id, protocolo, tipo, status, campos, dependentes, motivo, decidido_nome, decidido_em::text, created_at::text FROM employee_change_requests WHERE employee_id=${eid} ORDER BY created_at DESC LIMIT 20`,
  ]);
  if (!e) redirect("/conta");
  const editaveis = C.CAMPOS.filter(c => c.meuEspaco); const grupos = [...new Set(editaveis.map(c => c.grupo))];
  const par = (k: string) => C.PARENTESCO.find(p => p[0] === k)?.[1] ?? k;
  return (
    <Page title="Meus dados" sub="Seu cadastro no Colégio Status. Para mudar endereço, nome social, estado civil, escolaridade ou a conta salário, peça aqui com o comprovante: o RH confere e atualiza a ficha.">
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] xl:items-start">
        <div className="min-w-0 space-y-4">
          <Card title="Cadastro" actions={<Modal label="Pedir alteração" title="Pedir alteração cadastral" kind="primary">
            <form action={pedirAlteracaoCadastral} className="space-y-3">
              <p className="text-[11px] text-slate-500">Mude só o que precisa. Campos da conta salário ficam em branco por segurança: preencha só se for trocar de conta.</p>
              {grupos.map(g => <fieldset key={g} className="rounded-md border border-line p-2"><legend className="px-1 text-xs font-medium text-navy">{g}</legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{editaveis.filter(c => c.grupo === g).map(c => { const sens = c.grupo === "Conta salário"; const v = sens ? "" : atual[c.k] ?? ""; return <Field key={c.k} label={c.rotulo} hint={c.dica}>
                  {c.tipo === "select" ? <Select name={c.k} defaultValue={v}><option value="">{sens && atual[c.k] ? `manter (${C.exibirValor(c.k, atual[c.k])})` : "—"}</option>{c.opcoes!.map(([k, r]) => <option key={k} value={k}>{r}</option>)}</Select>
                    : <Input name={c.k} defaultValue={v} maxLength={c.max} placeholder={sens && atual[c.k] ? `atual: ${C.mascaraValor(c.k, atual[c.k])}` : undefined} inputMode={["cep", "banco_agencia", "banco_conta"].includes(c.k) ? "numeric" : undefined} />}</Field>; })}</div></fieldset>)}
              <Field label="Comprovantes (residência, certidão, conta ou diploma)"><Arquivos tipos={["Comprovante de residência", "Certidão (estado civil)", "Comprovante da conta", "Comprovante de escolaridade", "Outro"]} /></Field>
              <Field label="Observação para o RH (opcional)"><Textarea name="obs" maxLength={500} className="min-h-[50px]" /></Field>
              <Btn small>Enviar ao RH</Btn>
            </form></Modal>}>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
              {[["Nome civil", e.nome], ["CPF", cpfMascarado(e.cpf)], ["Cargo", e.cargo ?? "—"], ["Unidade", e.unidade], ["Empresa", e.empresa ?? "—"], ["Admissão", fmtData(e.admissao)]].map(([k, v]) => <div key={k} className="flex justify-between gap-2 border-b border-dashed border-line py-0.5"><dt className="text-slate-500">{k}</dt><dd className="text-right [overflow-wrap:anywhere]">{v}</dd></div>)}
              {C.CAMPOS.filter(c => !["vt_obs"].includes(c.k)).map(c => <div key={c.k} className="flex justify-between gap-2 border-b border-dashed border-line py-0.5"><dt className="text-slate-500">{c.rotulo.replace(/ \(.*\)$/, "")}</dt><dd className="text-right [overflow-wrap:anywhere]">{c.sensivel ? C.mascaraValor(c.k, atual[c.k]) : C.exibirValor(c.k, atual[c.k])}</dd></div>)}
            </dl>
            <p className="mt-2 text-[11px] text-slate-500">Nome civil, CPF, cargo e salário só o RH altera. Telefone e contato de emergência você muda direto no <Link className="text-acao underline" href="/eu#contato">Meu espaço</Link>.</p>
          </Card>
        </div>
        <div className="min-w-0 space-y-4">
          <Card title={`Dependentes (${deps.length})`} actions={<Modal label="Pedir inclusão" title="Pedir inclusão de dependente"><form action={pedirInclusaoDependente} className="space-y-2"><CamposDependente /><Field label="Documento do dependente"><Arquivos tipos={C.DOCS_DEPENDENTE} n={2} /></Field><Field label="Observação (opcional)"><Textarea name="obs" maxLength={500} className="min-h-[50px]" /></Field><Btn small>Enviar ao RH</Btn></form></Modal>}>
            <div id="dependentes" />
            {deps.length === 0 ? <p className="text-sm text-slate-500">Nenhum dependente cadastrado.</p> :
              <ul className="divide-y divide-line text-sm">{deps.map(d => <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5"><span className="min-w-0">{d.nome}<span className="block text-xs text-slate-500">{par(d.parentesco)}{d.data_nascimento ? ` · nasc. ${fmtData(d.data_nascimento)}` : ""}{d.cpf ? ` · CPF ${cpfMascarado(d.cpf)}` : ""}{[d.irrf && "IR", d.salario_familia && "salário-família", d.plano_saude && "plano"].filter(Boolean).length ? ` · ${[d.irrf && "IR", d.salario_familia && "salário-família", d.plano_saude && "plano"].filter(Boolean).join(", ")}` : ""}</span></span>
                <Modal label="Pedir exclusão" title={`Excluir ${d.nome}`} kind="link"><form action={pedirExclusaoDependente} className="space-y-2"><input type="hidden" name="dependentId" value={d.id} /><Field label="Motivo"><Input name="motivo" required placeholder="ex.: maioridade, divórcio, óbito" /></Field><Field label="Documento (se houver)"><Arquivos tipos={C.DOCS_DEPENDENTE} n={1} /></Field><Btn small>Enviar ao RH</Btn></form></Modal></li>)}</ul>}
          </Card>
          <Card title="Meus pedidos">
            {pedidos.length === 0 ? <p className="text-sm text-slate-500">Nenhum pedido de alteração.</p> :
              <ul className="space-y-2">{pedidos.map(p => <li key={p.id} className="rounded-md border border-line p-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{p.protocolo} · {C.TIPO_PEDIDO[p.tipo] ?? p.tipo}</span><Badge v={C.TOM_PEDIDO[p.status] ?? "PENDENTE"} label={C.STATUS_PEDIDO[p.status] ?? p.status} /></div>
                <ul className="mt-1 text-xs text-slate-600">{p.campos.map(c => <li key={c.campo} className="[overflow-wrap:anywhere]">{c.rotulo}: {C.CAMPO.get(c.campo)?.sensivel ? C.mascaraValor(c.campo, c.depois) : C.exibirValor(c.campo, c.depois)}{c.decisao ? <b className={c.decisao === "APROVADO" ? "text-ok" : "text-erro"}> · {c.decisao === "APROVADO" ? "aplicado" : "recusado"}</b> : null}</li>)}
                  {p.dependentes.map((d, i) => <li key={i}>{d.acao === "INCLUIR" ? "Incluir" : "Excluir"} {d.nome} ({par(d.parentesco)}){d.decisao ? <b className={d.decisao === "APROVADO" ? "text-ok" : "text-erro"}> · {d.decisao === "APROVADO" ? "feito" : "recusado"}</b> : null}</li>)}</ul>
                <p className="mt-1 text-[11px] text-slate-500">Enviado em {fmtDataHora(p.created_at)}{p.decidido_em ? ` · analisado por ${p.decidido_nome} em ${fmtDataHora(p.decidido_em)}` : ""}</p>
                {p.motivo && p.status !== "PENDENTE" ? <p className="mt-1 rounded bg-sky-50 px-2 py-1 text-xs text-slate-700">RH: {p.motivo}</p> : null}
                {p.status === "PENDENTE" ? <form action={cancelarPedidoCadastral} className="mt-1"><input type="hidden" name="id" value={p.id} /><Btn small kind="ghost">Cancelar pedido</Btn></form> : null}
              </li>)}</ul>}
          </Card>
        </div>
      </div>
    </Page>
  );
}
