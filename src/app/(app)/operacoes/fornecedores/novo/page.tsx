import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { Page, Card, Flash, Field, Btn, Input, Select } from "@/components/ui";
import * as F from "@/lib/fornecedores";
import { criarFornecedor } from "../actions";

export const dynamic = "force-dynamic";

/** v33 · Novo fornecedor — etapa 1 do assistente (identificação), com a verificação de duplicidade antes de criar o rascunho. */
export default async function NovoFornecedor({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!F.podeCadastrar(s)) redirect("/operacoes/fornecedores"); const sp = await searchParams; const cfg = await F.cfgForn();
  const etapas = ["Identificação", "Contatos e endereço", "Capacidade e cobertura", "Financeiro e tributos", "Documentos", "Revisão e envio"];
  return (
    <Page title="Novo fornecedor" sub="Etapa 1 de 6 — identificação. O rascunho fica salvo e pode ser retomado; ele não autoriza compras: isso só acontece depois da homologação." actions={<Btn kind="ghost" href="/operacoes/fornecedores?aba=lista">Fornecedores</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <ol className="mb-4 flex flex-wrap gap-2 text-xs">{etapas.map((e, i) => <li key={e} className={`rounded-full border px-2.5 py-1 ${i === 0 ? "border-acao bg-sky-50 font-medium text-navy" : "border-line bg-white text-slate-500"}`}>{i + 1}. {e}</li>)}</ol>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <Card title="Identificação">
          <form action={criarFornecedor} className="space-y-3">
            <fieldset><legend className="mb-1 text-sm font-medium text-navy">Tipo</legend><div className="flex flex-wrap gap-3 text-sm">{Object.entries(F.TIPOS_FORN).map(([k, v], i) => <label key={k} className="flex items-center gap-1.5"><input type="radio" name="tipo" value={k} defaultChecked={i === 0} /> {v}</label>)}</div></fieldset>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field label="CNPJ, CPF ou documento estrangeiro" hint="O dígito verificador é conferido. CNPJ e CPF não são a chave do cadastro: o fornecedor tem número próprio."><Input name="documento" required inputMode="numeric" placeholder="00.000.000/0000-00" /></Field>
              <Field label="Categoria" hint="Define a criticidade proposta e os documentos exigidos."><Select name="categoria" required defaultValue=""><option value="">— escolha —</option>{cfg.categorias.map(([c, k]) => <option key={c} value={c}>{c} · criticidade {F.CRITICIDADE[k].toLowerCase()}</option>)}</Select></Field>
              <Field label="Razão social (ou nome completo, na pessoa física)"><Input name="razaoSocial" required maxLength={160} /></Field>
              <Field label="Nome fantasia (como a escola chama)"><Input name="nomeFantasia" maxLength={120} /></Field>
            </div>
            <div className="space-y-1 rounded-md border border-line bg-mist/60 p-3 text-xs text-slate-700">
              <p className="font-medium text-navy">Antes de criar, o sistema procura duplicidades</p>
              <p>O mesmo documento já cadastrado <b>bloqueia</b>. O mesmo CNPJ raiz (matriz e filiais) e nomes muito parecidos <b>pedem confirmação</b>: se o aviso aparecer e for mesmo outro fornecedor, marque abaixo e envie de novo.</p>
              <label className="flex items-center gap-1.5"><input type="checkbox" name="outroFornecedor" value="1" /> É outro fornecedor, apesar do mesmo CNPJ raiz</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" name="naoDuplicado" value="1" /> Não é duplicado, apesar do nome parecido</label>
            </div>
            <Btn>Criar rascunho e continuar</Btn>
          </form>
        </Card>
        <Card title="Como funciona">
          <ul className="list-disc space-y-1.5 pl-4 text-[13px] text-slate-700">
            <li><b>Cadastro não é homologação.</b> O rascunho guarda os dados; compras, contratos e contas só usam o fornecedor depois de homologado — ou com exceção registrada, com motivo.</li>
            <li><b>Homologação pelo risco.</b> Criticidade baixa: conferência documental. Média: documental e financeira. Alta (alimentação, transporte, segurança, dados pessoais): documental, financeira e técnica, com plano de contingência.</li>
            <li><b>Ninguém se aprova.</b> Quem cadastra ou envia não dá parecer nem decide; a conta bancária precisa de conferência por canal conhecido e da aprovação de outra pessoa.</li>
            <li><b>Pelo portal</b>, o próprio fornecedor atualiza contatos, documentos e conta — e tudo passa pela revisão daqui.</li>
          </ul>
        </Card>
      </div>
    </Page>
  );
}
