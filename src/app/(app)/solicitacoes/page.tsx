import Link from "@/components/Link";
import { requireSession, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Badge, Flash, Btn, Field, Input } from "@/components/ui";
import { fmtData, fmtDataHora, hoje } from "@/lib/utils";
import { SOL_STATUS, SOL_TOM, vePainel, fmtValorBr, type EtapaSnap } from "@/lib/solicitacoes";
import { decidirSolicitacao, aprovarLote } from "./actions";
import { excecoesDespesa, EXCECAO_ROTULO } from "@/lib/despesas";
import { SubNavSol } from "./_ui";

export const dynamic = "force-dynamic";
type Linha = { id: number; numero: string; titulo: string; tipo: string; status: string; etapa_atual: number; etapas: EtapaSnap[]; valor: string | null; solicitante_nome: string | null; solicitante_user_id: number; unidade: string | null; prazo_etapa: string | null; created_at: string; anexos: number; pago_em: string | null; pagamento_previsto: string | null };

export default async function Solicitacoes({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams; const h = hoje(); const painel = vePainel(s); const escopo = scopeUnit(s);
  const base = (filtro: ReturnType<typeof sql>) => sql<Linha[]>`SELECT r.id, r.numero, r.titulo, t.nome AS tipo, r.status, r.etapa_atual, r.etapas, r.valor::text, r.solicitante_nome, r.solicitante_user_id, u.nome AS unidade, r.prazo_etapa::text, r.created_at::text, (SELECT count(*) FROM attachments a WHERE a.entidade='request' AND a.entidade_id=r.id)::int AS anexos, r.pago_em::text, r.pagamento_previsto::text FROM requests r JOIN request_types t ON t.id=r.type_id LEFT JOIN units u ON u.id=r.unit_id WHERE ${filtro} ORDER BY (r.status IN ('EM_APROVACAO','DEVOLVIDA')) DESC, r.created_at DESC LIMIT 300`;
  const aprovar = await base(sql`r.status='EM_APROVACAO' AND (r.etapas->r.etapa_atual->'aprovadores') @> to_jsonb(${s.id}::int)`);
  const aba = sp.aba ?? (aprovar.length ? "aprovar" : "minhas");
  const busca = (sp.q ?? "").trim();
  const pagar = ["FINANCEIRO", "DIRECAO"].includes(s.role);
  const aPagar = pagar ? await base(sql`r.status='APROVADA' AND r.valor > 0 AND r.pago_em IS NULL`) : [];
  const exc = await excecoesDespesa(aprovar.map(r => r.id)); const normais = aprovar.filter(r => !(exc.get(r.id) ?? []).length);
  const lista = aba === "pagar" && pagar ? aPagar : aba === "aprovar" ? aprovar : aba === "todas" && painel ? await base(sql`${s.role === "DIRETOR_UNIDADE" ? sql`r.unit_id=${escopo}` : sql`true`} ${busca ? sql`AND (r.titulo ILIKE ${"%" + busca + "%"} OR r.numero ILIKE ${"%" + busca + "%"} OR r.solicitante_nome ILIKE ${"%" + busca + "%"})` : sql``}`) : await base(sql`r.solicitante_user_id=${s.id}`);
  return (
    <Page title="Solicitações" sub="Reembolso, compra, passeio, declaração, material e outros pedidos com aprovação por etapas e alçada por valor — aprova pelo celular. Despesa aprovada só vira paga com o débito conciliado no extrato." actions={<Btn href="/solicitacoes/nova">Nova solicitação</Btn>}>
      <SubNavSol ativo={`/solicitacoes?aba=${aba}`} painel={painel} config={["DIRECAO", "RH"].includes(s.role)} pendentes={aprovar.length} pagar={pagar} aPagar={aPagar.length} />
      <Flash ok={sp.ok} erro={sp.erro} />
      {aba === "todas" && painel && <form className="mb-3 flex flex-wrap items-end gap-2"><input type="hidden" name="aba" value="todas" /><Field label="Buscar"><Input name="q" defaultValue={busca} placeholder="número, título ou solicitante" /></Field><Btn kind="ghost">Buscar</Btn></form>}
      {aba === "aprovar" && aprovar.length > 0 && <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm">
        <span className="text-slate-600">{normais.length ? <>Marque as normais e aprove de uma vez. <b>{aprovar.length - normais.length}</b> exceção(ões) da política pedem decisão item a item.</> : "Todas as pendentes são exceções da política: abra cada uma e decida item a item."}</span>
        {normais.length > 0 && <form id="lote" action={aprovarLote}><Btn small>Aprovar marcadas em lote</Btn></form>}</div>}
      {lista.length === 0 ? <Card><p className="text-sm text-slate-500">{aba === "aprovar" ? "Nada aguardando sua aprovação." : aba === "pagar" ? "Nenhuma despesa aprovada aguardando pagamento." : "Nenhuma solicitação."}</p></Card> :
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{lista.map(r => { const e = r.etapas[r.etapa_atual]; const atraso = r.status === "EM_APROVACAO" && r.prazo_etapa && r.prazo_etapa < h;
          return <Card key={r.id} className={atraso ? "border-amber-300" : ""}>
            <div className="flex flex-wrap items-start justify-between gap-2"><div className="flex min-w-0 items-start gap-2">{aba === "aprovar" && !(exc.get(r.id) ?? []).length ? <input type="checkbox" name="ids" value={r.id} form="lote" defaultChecked aria-label={`Incluir ${r.numero} no lote`} className="mt-1" /> : null}<div className="min-w-0"><Link className="font-medium text-acao" href={`/solicitacoes/${r.id}`}>{r.titulo}</Link><div className="text-xs text-slate-500">{r.numero} · {r.tipo} · {r.solicitante_nome}{r.unidade ? ` · ${r.unidade}` : ""} · {fmtDataHora(r.created_at)}</div></div></div><span className="flex flex-wrap gap-1"><Badge v={SOL_TOM[r.status]} label={SOL_STATUS[r.status]} />{r.status === "APROVADA" && r.valor !== null && Number(r.valor) > 0 ? (r.pago_em ? <Badge v="APROVADA" label="paga" /> : <Badge v="PENDENTE" label="a pagar" />) : null}</span></div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm"><span>{r.valor !== null ? <b>{fmtValorBr(r.valor)}</b> : null}{r.status === "EM_APROVACAO" && e ? <span className="text-xs text-slate-600">{r.valor !== null ? " · " : ""}etapa {r.etapa_atual + 1}/{r.etapas.length}: {e.nome}{r.prazo_etapa ? ` · até ${fmtData(r.prazo_etapa)}` : ""}</span> : null}{r.anexos ? <span className="text-xs text-slate-500"> · {r.anexos} anexo(s)</span> : null}</span>
              {aba === "aprovar" && ((exc.get(r.id) ?? []).length ? <Btn small kind="ghost" href={`/solicitacoes/${r.id}`}>Abrir e decidir</Btn> : <span className="flex gap-1"><form action={decidirSolicitacao}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decisao" value="APROVAR" /><input type="hidden" name="rapido" value="1" /><input type="hidden" name="voltar" value="/solicitacoes?aba=aprovar" /><Btn small>Aprovar</Btn></form><Btn small kind="ghost" href={`/solicitacoes/${r.id}`}>Ver / recusar</Btn></span>)}</div>
            {aba === "aprovar" && (exc.get(r.id) ?? []).length > 0 && <ul className="mt-2 space-y-0.5 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-aviso">{(exc.get(r.id) ?? []).map(e => <li key={e.codigo}><b>{EXCECAO_ROTULO[e.codigo]}:</b> {e.texto}</li>)}</ul>}
            {aba === "pagar" && <p className="mt-1 text-xs text-slate-500">{r.pagamento_previsto ? `Pagamento programado para ${fmtData(r.pagamento_previsto)}` : "Sem data programada (entra amanhã na projeção de caixa)"}</p>}
          </Card>; })}</div>}
    </Page>
  );
}
