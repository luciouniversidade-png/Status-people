import Link from "@/components/Link";
import { requireSession, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Flash, Btn, Field, Input, Select } from "@/components/ui";
import { vePainel, type Campo, type Etapa } from "@/lib/solicitacoes";
import { abrirSolicitacao } from "../actions";
import { SubNavSol, CamposForm } from "../_ui";

export const dynamic = "force-dynamic";

export default async function NovaSolicitacao({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams;
  const tipos = (await sql<{ id: number; nome: string; descricao: string | null; campos: Campo[]; etapas: Etapa[]; perfis: string[] | null }[]>`SELECT id, nome, descricao, campos, etapas, perfis FROM request_types WHERE ativo ORDER BY ordem, nome`).filter(t => !t.perfis?.length || t.perfis.includes(s.role));
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM requests WHERE status='EM_APROVACAO' AND (etapas->etapa_atual->'aprovadores') @> to_jsonb(${s.id}::int)`;
  const t = tipos.find(x => x.id === Number(sp.tipo));
  const precisaUnidade = scopeUnit(s) === null && !s.employeeId; const units = precisaUnidade ? await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome` : [];
  return (
    <Page title={t ? t.nome : "Nova solicitação"} sub={t?.descricao ?? "Escolha o tipo de pedido."}>
      <SubNavSol ativo="/solicitacoes/nova" painel={vePainel(s)} config={["DIRECAO", "RH"].includes(s.role)} pendentes={n} />
      <Flash ok={sp.ok} erro={sp.erro} />
      {!t ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{tipos.map(x => <Link key={x.id} href={`/solicitacoes/nova?tipo=${x.id}`} className="rounded-md border border-line bg-white p-4 hover:border-acao"><div className="font-medium text-navy">{x.nome}</div><div className="mt-1 text-xs text-slate-600">{x.descricao}</div><div className="mt-2 text-[11px] text-slate-500">{x.etapas.length} etapa(s): {x.etapas.map(e => e.nome).join(" → ")}</div></Link>)}{tipos.length === 0 && <Card><p className="text-sm text-slate-500">Nenhum tipo disponível para o seu perfil.</p></Card>}</div> :
        <Card className="max-w-2xl"><form action={abrirSolicitacao} className="space-y-3"><input type="hidden" name="typeId" value={t.id} />
          <Field label="Título (opcional)" hint="Se vazio, usamos o tipo e a primeira informação."><Input name="titulo" /></Field>
          {precisaUnidade && <Field label="Unidade"><Select name="unitId" required><option value="">Escolha</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
          <CamposForm campos={t.campos} />
          <p className="text-xs text-slate-500">Aprovação: {t.etapas.map(e => `${e.nome}${e.acimaDe ? ` (acima de R$ ${e.acimaDe.toLocaleString("pt-BR")})` : ""}`).join(" → ")}. Comprovantes e orçamentos: anexe depois de enviar.</p>
          <Btn>Enviar para aprovação</Btn></form></Card>}
    </Page>
  );
}
