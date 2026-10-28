import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { requireSession, scopeUnit, can } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Input, Select, Btn, Badge } from "@/components/ui";
import { KpiCard, Colunas, BarrasH, Cascata, corSerie, COR } from "@/components/graficos";
import { hoje, fmtData, VINCULO_LABEL } from "@/lib/utils";
import { rotuloMes } from "@/lib/formato";
import { composicao, quadroNaData, CONTINGENTE, type Indicador } from "@/lib/composicao";
import { QUALIF_TIPO } from "@/lib/pessoas-v30";

export const dynamic = "force-dynamic";
const fmtInd = (i: Indicador) => i.valor === null ? "—" : i.formato === "pct" ? `${i.valor.toFixed(1).replace(".", ",")}%` : i.formato === "anos" ? `${i.valor.toFixed(1).replace(".", ",")} anos` : i.formato === "x" ? `${i.valor.toFixed(1).replace(".", ",")}` : String(Math.round(i.valor));

/** v30 · Composição da equipe: quem somos, como o quadro mudou e para onde as pessoas se movem — reconstruído pelo histórico funcional. */
export default async function Composicao({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); if (!["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role)) redirect("/");
  const sp = await searchParams; const h = hoje(); const escopo = scopeUnit(s);
  const units = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ORDER BY nome`;
  const unitId = escopo ?? (sp.u ? Number(sp.u) : null);
  const em = sp.em && /^\d{4}-\d{2}-\d{2}$/.test(sp.em) && sp.em <= h ? sp.em : null;
  const [c, qd, pendentes] = await Promise.all([
    composicao(unitId, h), em ? quadroNaData(unitId, em) : Promise.resolve(null),
    can.editar(s) ? sql<{ id: number; employee_id: number; nome: string; tipo: string; curso: string; created_at: string }[]>`SELECT q.id, q.employee_id, e.nome, q.tipo, q.curso, q.created_at::date::text FROM employee_qualifications q JOIN employees e ON e.id=q.employee_id WHERE q.status='PENDENTE' ORDER BY q.created_at LIMIT 30` : Promise.resolve([]),
  ]);
  const unidadeNome = unitId === null ? "Rede" : units.find(u => u.id === unitId)?.nome ?? "Unidade";
  const tot = c.ponte.reduce((a, p) => ({ inicio: a.inicio + p.inicio, admissoes: a.admissoes + p.admissoes, desligamentos: a.desligamentos + p.desligamentos, entradas: a.entradas + p.entradas, saidas: a.saidas + p.saidas, fim: a.fim + p.fim }), { inicio: 0, admissoes: 0, desligamentos: 0, entradas: 0, saidas: 0, fim: 0 });
  const vinculos = [...new Set(qd?.porUnidade.flatMap(u => Object.keys(u.porVinculo)) ?? [])];
  return (
    <Page title="Composição da equipe" sub={<>Quem somos e como o quadro mudou nos últimos 12 meses — {unidadeNome}. Reconstruído pelo histórico funcional (cargo, unidade, vínculo e gestor de cada data). <Link className="text-acao" href="/analytics">People Analytics</Link> · <Link className="text-acao" href="/analytics/retencao">Movimentação e retenção</Link></>}>
      <form className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-[220px_200px_auto]">
        {escopo === null ? <Select name="u" defaultValue={unitId ?? ""} aria-label="Unidade"><option value="">Rede inteira</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select> : <input type="hidden" name="u" value={escopo} />}
        <Input name="em" type="date" max={h} defaultValue={em ?? ""} aria-label="Quadro numa data" title="Quadro numa data" />
        <Btn kind="ghost">Aplicar</Btn>
      </form>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {c.indicadores.map(i => <KpiCard key={i.chave} titulo={i.titulo} valor={fmtInd(i)} serie={i.serie.length ? i.serie : undefined} sub={i.ajuda} />)}
      </div>

      {qd && em && <Card className="mb-4" title={`Quadro em ${fmtData(em)} — ${qd.total} pessoa(s)`}>
        <Table head={["Unidade", ...vinculos.map(v => VINCULO_LABEL[v] ?? v), "Total"]}>{qd.porUnidade.map(u => <tr key={u.unidade}><Td className="font-medium">{u.unidade}</Td>{vinculos.map(v => <Td key={v} className="tabular-nums">{u.porVinculo[v] ?? 0}</Td>)}<Td className="font-semibold tabular-nums">{u.total}</Td></tr>)}</Table>
        <div className="mt-3 text-xs text-slate-600">Cargos com mais pessoas na data: {qd.cargos.slice(0, 8).map(x => `${x.cargo} (${x.n})`).join(" · ") || "—"}</div>
      </Card>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
        <Card title="Quadro por vínculo — 12 meses">
          <Colunas rotulo="Quadro por vínculo no fim de cada mês" empilhado categorias={c.meses.map(m => rotuloMes(m, false))} series={c.vinculoMensal.map((v, i) => ({ nome: VINCULO_LABEL[v.nome] ?? v.nome, valores: v.valores, cor: CONTINGENTE.has(v.nome) ? ["#e9a23b", "#d1495b", "#8e5bb5"][i % 3] : corSerie(i) }))} formato={v => String(Math.round(v))} />
        </Card>
        <Card title={`Movimentações — últimos 12 meses${c.taxaPromocao !== null ? ` · promoção interna ${c.taxaPromocao.toFixed(1).replace(".", ",")}% do quadro` : ""}`}>
          <BarrasH rotulo="Movimentações por tipo" formato={v => String(v)} itens={c.porTipo.filter(x => x.n > 0 || ["ADMISSAO", "DESLIGAMENTO", "PROMOCAO", "TRANSFERENCIA"].includes(x.tipo)).map(x => ({ rotulo: x.rotulo, valor: x.n, cor: x.tipo === "DESLIGAMENTO" ? COR.erro : x.tipo === "ADMISSAO" ? COR.ok : x.tipo === "PROMOCAO" ? "#8e5bb5" : COR.acao }))} />
          <p className="mt-2 text-[11px] text-slate-500">Promoções, mudanças de cargo, transferências e efetivações vêm do histórico funcional (a edição da ficha registra sozinha, com a data de vigência).</p>
        </Card>
        <Card title="Entradas, saídas e movimentações internas — mês a mês">
          <Colunas rotulo="Admissões, desligamentos e movimentações internas por mês" categorias={c.mensal.map(m => rotuloMes(m.mes, false))} series={[{ nome: "Admissões", valores: c.mensal.map(m => m.admissoes), cor: COR.ok }, { nome: "Desligamentos", valores: c.mensal.map(m => m.desligamentos), cor: COR.erro }, { nome: "Promoção, cargo, transferência ou efetivação", valores: c.mensal.map(m => m.internas), cor: "#8e5bb5" }]} formato={v => String(Math.round(v))} />
        </Card>
        <Card title="Ponte do quadro — 12 meses">
          <Cascata rotulo="Do quadro de 12 meses atrás ao de hoje" formato={v => String(Math.round(v))} passos={[{ rotulo: "Há 12 meses", valor: tot.inicio, tipo: "total" }, { rotulo: "Admissões", valor: tot.admissoes, tipo: "delta" }, { rotulo: "Desligamentos", valor: -tot.desligamentos, tipo: "delta" }, ...(unitId !== null ? [{ rotulo: "Transferidos para cá", valor: tot.entradas, tipo: "delta" as const }, { rotulo: "Transferidos daqui", valor: -tot.saidas, tipo: "delta" as const }] : []), { rotulo: "Hoje", valor: tot.fim, tipo: "total" }]} />
          <Table head={["Unidade", "Há 12 meses", "+ Admissões", "− Deslig.", "+ Vieram", "− Foram", "= Hoje"]} denso>{c.ponte.map(p => <tr key={p.unitId}><Td className="font-medium">{p.unidade}</Td><Td className="tabular-nums">{p.inicio}</Td><Td className="tabular-nums text-ok">{p.admissoes}</Td><Td className="tabular-nums text-erro">{p.desligamentos}</Td><Td className="tabular-nums">{p.entradas}</Td><Td className="tabular-nums">{p.saidas}</Td><Td className="font-semibold tabular-nums">{p.fim}{p.ajuste ? <span className="ml-1 text-[11px] font-normal text-slate-400" title="diferença de cadastro (ex.: admissão em andamento ou data corrigida)">({p.ajuste > 0 ? "+" : ""}{p.ajuste})</span> : null}</Td></tr>)}</Table>
          <p className="mt-1 text-[11px] text-slate-500">Vieram = transferidos de outra unidade para esta · Foram = transferidos desta para outra unidade. Entre parênteses, a diferença de cadastro.</p>
        </Card>
        <Card title={`Titulação do corpo docente — ${c.docentes} professor(es)`}>
          <BarrasH rotulo="Docentes pela maior titulação concluída" formato={v => String(v)} itens={c.titulacao.map((t, i) => ({ rotulo: t.faixa, valor: t.n, cor: t.faixa === "Sem formação registrada" ? COR.neutro : corSerie(i) }))} />
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm"><div className="rounded border border-line px-2 py-1.5"><div className="text-[11px] text-slate-500">Com licenciatura</div><div className="font-semibold">{c.docentes ? `${Math.round((100 * c.licenciados) / c.docentes)}%` : "—"} <span className="text-xs font-normal text-slate-500">({c.licenciados})</span></div></div><div className="rounded border border-line px-2 py-1.5"><div className="text-[11px] text-slate-500">Com pós-graduação</div><div className="font-semibold">{c.docentes ? `${Math.round((100 * c.comPos) / c.docentes)}%` : "—"} <span className="text-xs font-normal text-slate-500">({c.comPos})</span></div></div></div>
          <p className="mt-2 text-[11px] text-slate-500">Pela formação validada na ficha (o colaborador informa no Meu espaço; o RH valida com o comprovante). A LDB (art. 62) pede licenciatura para a docência na educação básica.</p>
        </Card>
        <Card title="Por família de cargos e onde está a liderança">
          <BarrasH rotulo="Pessoas por família de cargos" formato={v => String(v)} itens={c.porFamilia.map((f, i) => ({ rotulo: f.familia, valor: f.n, cor: corSerie(i) }))} />
          <Table head={["Unidade", "Gestores", "Liderados", "Amplitude"]} denso>{c.gestoresPorUnidade.map(g => <tr key={g.unidade}><Td>{g.unidade}</Td><Td className="tabular-nums">{g.gestores}</Td><Td className="tabular-nums">{g.liderados}</Td><Td className="tabular-nums">{g.gestores ? (g.liderados / g.gestores).toFixed(1).replace(".", ",") : "—"}</Td></tr>)}</Table>
        </Card>
      </div>

      {can.editar(s) && <Card className="mt-4" title={`Formações aguardando validação (${pendentes.length})`}>
        <div id="formacao" />
        <Table head={["Colaborador", "Formação", "Enviada em", ""]} empty="Nada aguardando validação.">{pendentes.map(p => <tr key={p.id}><Td>{p.nome}</Td><Td className="text-xs">{QUALIF_TIPO[p.tipo] ?? p.tipo} · {p.curso}</Td><Td className="text-xs">{fmtData(p.created_at)}</Td><Td><Link className="text-xs text-acao" href={`/colaboradores/${p.employee_id}#formacao`}>validar na ficha</Link> <Badge v="PENDENTE" label="pendente" /></Td></tr>)}</Table>
      </Card>}
    </Page>
  );
}
