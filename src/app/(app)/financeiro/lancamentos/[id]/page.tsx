import { notFound } from "next/navigation";
import Link from "@/components/Link";
import { requireFinanceiro, assertScope } from "@/lib/auth";
import { Page, Card, Flash, Field, Select, Input, Btn, Badge } from "@/components/ui";
import { reclassificarLancamento } from "../../actions";
import { getSettings } from "@/lib/utils";
import { LINHA_STATUS } from "@/lib/conciliacao";
import { Anexos } from "@/components/Anexos";
import { sql } from "@/db";
import { fmtReais } from "@/lib/formato";
import { fmtData, fmtDataHora } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Lançamento de caixa com o documento-fonte anexado (terceiro clique do drill da DRE). */
export default async function Lancamento({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireFinanceiro(); const { id } = await params; const sp = await searchParams;
  const [l] = await sql<{ id: number; unit_id: number; unidade: string; data: string; tipo: string; categoria: string; forma: string | null; descricao: string | null; contraparte: string | null; valor: number; importado_em: string }[]>`SELECT c.id, c.unit_id, u.nome AS unidade, c.data::text, c.tipo, c.categoria, c.forma, c.descricao, c.contraparte, c.valor::float, c.importado_em::text FROM cash_entries c JOIN units u ON u.id=c.unit_id WHERE c.id=${Number(id)}`;
  if (!l) notFound(); try { assertScope(s, l.unit_id); } catch { notFound(); }
  const cfg = await getSettings(); const opera = ["DIRECAO", "FINANCEIRO"].includes(s.role);
  const [x] = await sql<{ conta: string | null; line_id: number | null; status: string | null; reclassificado_em: string | null }[]>`SELECT a.apelido AS conta, c.bank_line_id AS line_id, bl.status, c.reclassificado_em::text FROM cash_entries c LEFT JOIN bank_accounts a ON a.id=c.bank_account_id LEFT JOIN bank_lines bl ON bl.id=c.bank_line_id WHERE c.id=${l.id}`;
  const cats = l.tipo === "ENTRADA" ? cfg.financeiro.categoriasEntrada as string[] : l.tipo === "SAIDA" ? cfg.financeiro.categoriasSaida as string[] : ["Transferências internas", "Transferência entre unidades"];
  return (
    <Page title={`${l.tipo === "ENTRADA" ? "Entrada" : l.tipo === "SAIDA" ? "Saída" : "Transferência"} · ${fmtReais(l.valor)}`} sub={`${l.categoria} · ${l.unidade} · ${fmtData(l.data)}`}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <Card title="Lançamento"><dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2"><div><dt className="text-xs text-slate-500">Descrição</dt><dd>{l.descricao ?? "—"}</dd></div><div><dt className="text-xs text-slate-500">Contraparte</dt><dd>{l.contraparte ?? "—"}</dd></div><div><dt className="text-xs text-slate-500">Forma</dt><dd>{l.forma ?? "—"}</dd></div><div><dt className="text-xs text-slate-500">Registrado em</dt><dd>{fmtDataHora(l.importado_em)}</dd></div></dl>
        <p className="mt-3 text-xs"><Link href={`/financeiro/dre?ctx_p=${l.data.slice(0, 7)}&ctx_u=${l.unit_id}`} className="text-acao">Ver na DRE do mês →</Link></p></Card>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Origem e conciliação"><dl className="space-y-1 text-sm"><div><dt className="text-xs text-slate-500">Conta bancária</dt><dd>{x?.conta ?? "— (lançado sem conta)"}</dd></div>
          <div><dt className="text-xs text-slate-500">Linha do extrato</dt><dd>{x?.line_id ? <>#{x.line_id} · <Badge v={LINHA_STATUS[x.status ?? ""]?.tom ?? "PENDENTE"} label={LINHA_STATUS[x.status ?? ""]?.rotulo ?? x.status ?? ""} /></> : "—"}</dd></div>
          {x?.reclassificado_em && <div><dt className="text-xs text-slate-500">Reclassificado</dt><dd>{fmtDataHora(x.reclassificado_em)} (antes e depois na auditoria)</dd></div>}</dl></Card>
        {opera && <Card title="Reclassificar"><form action={reclassificarLancamento} className="space-y-2"><input type="hidden" name="id" value={l.id} />
          <Field label="Nova categoria"><Select name="categoria" defaultValue={l.categoria}>{cats.map(c => <option key={c}>{c}</option>)}</Select></Field>
          <Field label="Motivo (fica na trilha)"><Input name="motivo" required minLength={5} placeholder="Ex.: PIX era repasse da cantina, não mensalidade" /></Field><Btn small>Reclassificar</Btn>
          <p className="text-[11px] text-slate-500">Competência fechada não aceita reclassificação — a Direção reabre com justificativa.</p></form></Card>}
      </div>
      <Anexos entidade="cash_entry" id={l.id} voltar={`/financeiro/lancamentos/${l.id}`} podeEnviar={["DIRECAO", "FINANCEIRO"].includes(s.role)} titulo="Documento-fonte (nota, recibo, boleto)" />
    </Page>
  );
}
