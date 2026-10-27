import { notFound } from "next/navigation";
import Link from "@/components/Link";
import { requireFinanceiro, assertScope } from "@/lib/auth";
import { Page, Card, Flash, Field, Select, Input, Btn, Badge } from "@/components/ui";
import { reclassificarLancamento } from "../../actions";
import { classificarLancamento } from "../../plano-de-contas/actions";
import { contextoSugestao, opcoesConta } from "@/lib/plano-contas";
import { sugerir, macrogrupo } from "@/lib/plano-contas-calc";
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
  const [l] = await sql<{ id: number; unit_id: number; unidade: string; data: string; tipo: string; categoria: string; forma: string | null; descricao: string | null; contraparte: string | null; valor: number; importado_em: string; conta_id: number | null; cost_center_id: number | null; classificado_em: string | null; classificacao_origem: string | null; classificador: string | null }[]>`SELECT c.id, c.unit_id, u.nome AS unidade, c.data::text, c.tipo, c.categoria, c.forma, c.descricao, c.contraparte, c.valor::float, c.importado_em::text,
    c.conta_id, c.cost_center_id, c.classificado_em::text, c.classificacao_origem, us.nome AS classificador FROM cash_entries c JOIN units u ON u.id=c.unit_id LEFT JOIN users us ON us.id=c.classificado_por WHERE c.id=${Number(id)}`;
  if (!l) notFound(); try { assertScope(s, l.unit_id); } catch { notFound(); }
  const cfg = await getSettings(); const opera = ["DIRECAO", "FINANCEIRO"].includes(s.role);
  const [x] = await sql<{ conta: string | null; line_id: number | null; status: string | null; reclassificado_em: string | null }[]>`SELECT a.apelido AS conta, c.bank_line_id AS line_id, bl.status, c.reclassificado_em::text FROM cash_entries c LEFT JOIN bank_accounts a ON a.id=c.bank_account_id LEFT JOIN bank_lines bl ON bl.id=c.bank_line_id WHERE c.id=${l.id}`;
  // v28 · conta do plano e centro de custo (com a sugestão quando ainda não tem conta)
  const ctxS = await contextoSugestao(); const contaPorId = new Map(ctxS.contas.map(c => [c.id, c])); const conta = l.conta_id ? contaPorId.get(l.conta_id) : undefined; const centro = l.cost_center_id ? ctxS.centros.find(c => c.id === l.cost_center_id) : undefined;
  const sug = !conta ? sugerir(l, ctxS) : null; const sugConta = sug ? contaPorId.get(sug.contaId) : undefined;
  const grupos = [...opcoesConta(ctxS.contas, "SAIDA"), ...opcoesConta(ctxS.contas, "ENTRADA")];
  const transf = ctxS.contas.filter(c => c.ativo && c.tipo_economico === "TRANSFERENCIA" && c.nivel >= 3);
  const centrosAtivos = ctxS.centros.filter(c => c.ativo && (c.unit_id === null || c.unit_id === l.unit_id || c.tipo !== "UNIDADE")).sort((a, b) => a.codigo.localeCompare(b.codigo));
  const ORIGEM: Record<string, string> = { MANUAL: "manual", REGRA: "por regra", SUGESTAO: "pela sugestão", CONTAS_A_PAGAR: "pela baixa em contas a pagar" };
  const cats = l.tipo === "ENTRADA" ? cfg.financeiro.categoriasEntrada as string[] : l.tipo === "SAIDA" ? cfg.financeiro.categoriasSaida as string[] : ["Transferências internas", "Transferência entre unidades"];
  return (
    <Page title={`${l.tipo === "ENTRADA" ? "Entrada" : l.tipo === "SAIDA" ? "Saída" : "Transferência"} · ${fmtReais(l.valor)}`} sub={`${l.categoria} · ${l.unidade} · ${fmtData(l.data)}`}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <Card title="Lançamento"><dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2"><div><dt className="text-xs text-slate-500">Descrição</dt><dd>{l.descricao ?? "—"}</dd></div><div><dt className="text-xs text-slate-500">Contraparte</dt><dd>{l.contraparte ?? "—"}</dd></div><div><dt className="text-xs text-slate-500">Forma</dt><dd>{l.forma ?? "—"}</dd></div><div><dt className="text-xs text-slate-500">Registrado em</dt><dd>{fmtDataHora(l.importado_em)}</dd></div>
        <div><dt className="text-xs text-slate-500">Conta do plano</dt><dd>{conta ? <><span className="font-mono text-xs text-slate-500">{conta.codigo}</span> {conta.nome}<span className="block text-[11px] text-slate-500">{macrogrupo(conta, contaPorId).nome}{l.classificado_em ? ` · classificado ${ORIGEM[l.classificacao_origem ?? ""] ?? ""} em ${fmtDataHora(l.classificado_em)}${l.classificador ? ` por ${l.classificador}` : ""}` : ""}</span></> : <span className="text-aviso">sem conta (só a categoria)</span>}</dd></div>
        <div><dt className="text-xs text-slate-500">Centro de custo</dt><dd>{centro ? `${centro.codigo} · ${centro.nome}` : <span className="text-slate-500">— (vale a unidade que pagou)</span>}</dd></div></dl>
        <p className="mt-3 text-xs"><Link href={`/financeiro/dre?ctx_p=${l.data.slice(0, 7)}&ctx_u=${l.unit_id}`} className="text-acao">Ver na DRE do mês →</Link></p></Card>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Origem e conciliação"><dl className="space-y-1 text-sm"><div><dt className="text-xs text-slate-500">Conta bancária</dt><dd>{x?.conta ?? "— (lançado sem conta)"}</dd></div>
          <div><dt className="text-xs text-slate-500">Linha do extrato</dt><dd>{x?.line_id ? <>#{x.line_id} · <Badge v={LINHA_STATUS[x.status ?? ""]?.tom ?? "PENDENTE"} label={LINHA_STATUS[x.status ?? ""]?.rotulo ?? x.status ?? ""} /></> : "—"}</dd></div>
          {x?.reclassificado_em && <div><dt className="text-xs text-slate-500">Reclassificado</dt><dd>{fmtDataHora(x.reclassificado_em)} (antes e depois na auditoria)</dd></div>}</dl></Card>
        {opera && <Card title="Conta do plano e centro de custo"><form action={classificarLancamento} className="space-y-2"><input type="hidden" name="id" value={l.id} />
          {sug && sugConta && <p className="rounded bg-mist p-2 text-xs">Sugestão: <b>{sugConta.codigo} {sugConta.nome}</b> — {sug.motivo}{sug.mudaCategoria ? <span className="text-aviso"> (muda a categoria para {sugConta.categoria})</span> : ""}</p>}
          <Field label="Conta (a categoria acompanha)"><Select name="contaId" defaultValue={conta?.id ?? sug?.contaId ?? ""} required><option value="">— escolha a conta —</option>{grupos.map(g => <optgroup key={g.grupo} label={g.grupo}>{g.contas.map(c => <option key={c.id} value={c.id}>{c.codigo} {c.nome}</option>)}</optgroup>)}{transf.length > 0 && <optgroup label="Transferências">{transf.map(c => <option key={c.id} value={c.id}>{c.codigo} {c.nome}</option>)}</optgroup>}</Select></Field>
          <Field label="Centro de custo"><Select name="centroId" defaultValue={centro?.id ?? sug?.centroId ?? ""}><option value="">— a unidade que pagou —</option>{centrosAtivos.map(c => <option key={c.id} value={c.id}>{c.codigo} · {c.nome}</option>)}</Select></Field>
          <Field label="Motivo (opcional, fica na trilha)"><Input name="motivo" maxLength={300} placeholder="Ex.: nota da Energisa de outubro" /></Field>
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="lembrar" value="1" /> lembrar para esta contraparte (cria regra)</label>
          <Btn small>Classificar</Btn><p className="text-[11px] text-slate-500">Detalhar a conta dentro da mesma categoria vale mesmo em competência fechada; trocar de categoria, não.</p></form></Card>}
        {opera && <Card title="Reclassificar"><form action={reclassificarLancamento} className="space-y-2"><input type="hidden" name="id" value={l.id} />
          <Field label="Nova categoria"><Select name="categoria" defaultValue={l.categoria}>{cats.map(c => <option key={c}>{c}</option>)}</Select></Field>
          <Field label="Motivo (fica na trilha)"><Input name="motivo" required minLength={5} placeholder="Ex.: PIX era repasse da cantina, não mensalidade" /></Field><Btn small>Reclassificar</Btn>
          <p className="text-[11px] text-slate-500">Competência fechada não aceita reclassificação — a Direção reabre com justificativa.</p></form></Card>}
      </div>
      <Anexos entidade="cash_entry" id={l.id} voltar={`/financeiro/lancamentos/${l.id}`} podeEnviar={["DIRECAO", "FINANCEIRO"].includes(s.role)} titulo="Documento-fonte (nota, recibo, boleto)" />
    </Page>
  );
}
