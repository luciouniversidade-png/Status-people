import { redirect } from "next/navigation";
import { requireMatriculas, can } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge, Flash, Field, Btn, Input, Textarea } from "@/components/ui";
import { fmtDataHora, getSettings } from "@/lib/utils";
import { MARCA_RASCUNHO_CONTRATO } from "@/db/setup";
import { salvarContrato, publicarContrato, novaVersaoContrato } from "../actions";

export const dynamic = "force-dynamic";
const ST: Record<string, [string, string]> = { RASCUNHO: ["PENDENTE", "Rascunho"], VIGENTE: ["APROVADA", "Vigente"], ARQUIVADO: ["CANCELADA", "Arquivada"] };

export default async function ContratoAno({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireMatriculas(); if (!can.editar(s)) redirect("/matriculas/rematricula"); const sp = await searchParams; const cfg = await getSettings(); const ano = cfg.matriculas.anoLetivo as number;
  const versoes = await sql<{ id: number; titulo: string; versao: number; status: string; texto: string; publicado_em: string | null; publicador: string | null; aceites: number; created_at: string }[]>`SELECT c.id, c.titulo, c.versao, c.status, c.texto, c.publicado_em::text, u.nome AS publicador, (SELECT count(*) FROM rematricula_links l WHERE l.contrato_id=c.id AND l.status='CONCLUIDA')::int AS aceites, c.created_at::text FROM contract_templates c LEFT JOIN users u ON u.id=c.publicado_por WHERE c.ano=${ano} ORDER BY c.versao DESC`;
  const rasc = versoes.find(v => v.status === "RASCUNHO"); const vig = versoes.find(v => v.status === "VIGENTE");
  return (
    <Page title={`Contrato ${ano}`} sub="Versões do contrato de prestação de serviços educacionais aceito pelo link de rematrícula. Versão publicada não muda: cada aceite guarda a versão, o texto exato e o hash." actions={<Btn kind="ghost" href="/matriculas/rematricula">Voltar à rematrícula</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <Card title={rasc ? `Rascunho — versão ${rasc.versao}` : "Nova versão"}>
          {rasc?.texto.includes(MARCA_RASCUNHO_CONTRATO) && <p className="mb-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-aviso">O texto ainda é o modelo de rascunho. Cole o contrato oficial revisado pela assessoria jurídica e apague o aviso entre colchetes para poder publicar.</p>}
          {rasc || !vig ? <form action={salvarContrato} className="space-y-2">{rasc && <input type="hidden" name="id" value={rasc.id} />}<input type="hidden" name="ano" value={ano} />
            <Field label="Título"><Input name="titulo" required defaultValue={rasc?.titulo ?? `Contrato de prestação de serviços educacionais ${ano}`} /></Field>
            <Field label="Texto do contrato" hint="Variáveis: {aluno} {responsavel} {serie} {turma} {turno} {unidade} {ano} {integral} {data}. O CPF não aparece no texto: é conferido no aceite."><Textarea name="texto" required defaultValue={rasc?.texto ?? ""} className="min-h-[360px] font-mono text-xs" /></Field>
            <div className="flex flex-wrap gap-2"><Btn small>Salvar rascunho</Btn></div>
          </form> : <form action={novaVersaoContrato}><input type="hidden" name="id" value={vig.id} /><p className="mb-2 text-sm text-slate-600">A versão {vig.versao} está vigente. Para mudar o texto, crie uma nova versão (rascunho) a partir dela.</p><Btn small kind="ghost">Criar nova versão a partir da vigente</Btn></form>}
          {rasc && <form action={publicarContrato} className="mt-3 border-t border-line pt-3"><input type="hidden" name="id" value={rasc.id} /><Btn small>Publicar versão {rasc.versao}</Btn><p className="mt-1 text-xs text-slate-500">A versão vigente anterior é arquivada. Famílias que ainda não aceitaram passam a ver a nova versão.</p></form>}
        </Card>
        <Card title="Versões">
          <Table head={["Versão", "Situação", "Aceites"]} empty="Nenhuma versão.">{versoes.map(v => <tr key={v.id}><Td>v{v.versao}<div className="text-[11px] text-slate-500">{v.publicado_em ? `${fmtDataHora(v.publicado_em)}${v.publicador ? ` · ${v.publicador}` : ""}` : "não publicada"}</div></Td><Td><Badge v={ST[v.status][0]} label={ST[v.status][1]} /></Td><Td>{v.aceites}</Td></tr>)}</Table>
          {vig && <details className="mt-3"><summary className="cursor-pointer text-xs text-acao">Ler a versão vigente</summary><div className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap rounded bg-mist p-2 text-[11px]">{vig.texto}</div></details>}
        </Card>
      </div>
    </Page>
  );
}
