import Link from "next/link";
import { requireStaff, scopeUnit } from "@/lib/auth";
import { Page, Card, Table, Td, Badge, Flash, Btn, Stat } from "@/components/ui";
import { fmtData, getSettings } from "@/lib/utils";
import { okrs, portfolio, SAUDE, PROJ_STATUS, CONFIANCA } from "@/lib/estrategia";
import { brl } from "@/lib/operacoes";

export const dynamic = "force-dynamic";
const barra = (p: number | null) => <div className="h-2 w-full overflow-hidden rounded bg-mist"><div className={`h-2 ${p === null ? "" : p >= 70 ? "bg-ok" : p >= 40 ? "bg-aviso" : "bg-erro"}`} style={{ width: `${p ?? 0}%` }} /></div>;

export default async function Estrategia({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const sp = await searchParams; const cfg = await getSettings(); const u = scopeUnit(s); const ciclo = sp.ciclo ?? cfg.estrategia.cicloAtual;
  const [ok, pf] = await Promise.all([okrs(ciclo, u), portfolio(u)]);
  const ativos = ok.objetivos.filter(o => o.status === "ATIVO"); const proximos = pf.rows.filter(r => r.proximo_prazo && r.status === "EM_ANDAMENTO").sort((a, b) => (a.proximo_prazo! < b.proximo_prazo! ? -1 : 1)).slice(0, 8);
  return (
    <Page title={`Estratégia ${ciclo}`} sub="OKRs com resultados-chave lidos do próprio sistema, portfólio de projetos com marcos, riscos e status report. O que a escola decidiu fazer — e se está acontecendo." actions={<><Btn kind="ghost" href="/estrategia/okrs">OKRs</Btn><Btn kind="ghost" href="/estrategia/projetos">Projetos</Btn></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label={`Progresso dos OKRs ${ciclo}`} value={ok.progressoCiclo === null ? "—" : <span className={ok.progressoCiclo >= 70 ? "text-ok" : ok.progressoCiclo >= 40 ? "text-aviso" : "text-erro"}>{ok.progressoCiclo}%</span>} hint={`${ativos.length} objetivo(s) · ${ok.totalKRs} KRs · ${ok.krsSemMedicao} sem medição`} href="/estrategia/okrs" />
        <Stat label="KRs com confiança baixa" value={<span className={ok.krsBaixaConfianca ? "text-erro" : ""}>{ok.krsBaixaConfianca}</span>} />
        <Stat label="Projetos ativos" value={pf.ativos} hint={`${pf.vermelhos} em risco · ${pf.amarelos} atenção`} href="/estrategia/projetos" />
        <Stat label="Marcos atrasados" value={<span className={pf.marcosAtrasados ? "text-erro" : ""}>{pf.marcosAtrasados}</span>} />
        <Stat label="Sem status report" value={<span className={pf.semAtualizacao.length ? "text-aviso" : ""}>{pf.semAtualizacao.length}</span>} hint={`há mais de ${cfg.estrategia.atualizacaoProjetoDias} dias`} />
        <Stat label="Orçamento dos projetos" value={<span className="text-xl">{brl(pf.gasto)}</span>} hint={`de ${brl(pf.orcamento)} · ${pf.estourados} estourado(s)`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Card title={`Objetivos ${ciclo}`}>{ativos.length === 0 ? <p className="text-sm text-slate-500">Nenhum objetivo ativo neste ciclo.</p> : <div className="space-y-3">{ativos.map(o => <div key={o.id}><div className="flex items-center justify-between gap-2"><Link className="font-medium text-acao" href={`/estrategia/okrs/${o.id}`}>{o.titulo}</Link><span className={`text-sm font-semibold tabular-nums ${o.progresso === null ? "text-slate-400" : o.progresso >= 70 ? "text-ok" : o.progresso >= 40 ? "text-aviso" : "text-erro"}`}>{o.progresso === null ? "—" : `${o.progresso}%`}</span></div><div className="mb-1 text-xs text-slate-500">{o.pilar ?? "—"} · {o.owner ?? "sem dono"} · {o.krs.length} KR(s) · {o.projetos} projeto(s)</div>{barra(o.progresso)}<ul className="mt-1 space-y-0.5 text-xs text-slate-600">{o.krs.map(k => <li key={k.id} className="flex justify-between gap-2"><span>{k.titulo}</span><span className="whitespace-nowrap tabular-nums">{k.valor_atual === null ? "—" : k.valor_atual}{k.metrica ? ` ${k.metrica}` : ""} → {k.valor_meta}{k.metrica ? ` ${k.metrica}` : ""} · {k.progresso === null ? "—" : `${k.progresso}%`}{k.confianca ? ` · conf. ${CONFIANCA[k.confianca]}` : ""}</span></li>)}</ul></div>)}</div>}</Card>
        <div className="space-y-4">
          <Card title="Projetos que pedem atenção">{pf.rows.filter(r => ["VERMELHO", "AMARELO"].includes(r.saude) && ["EM_ANDAMENTO", "PAUSADO", "PLANEJADO"].includes(r.status)).length === 0 && pf.semAtualizacao.length === 0 ? <p className="text-sm text-slate-500">Nenhum projeto em risco ou sem atualização.</p> : <Table head={["Projeto", "Saúde", "Situação", "Próximo marco", "Última atualização"]}>{[...pf.rows.filter(r => ["VERMELHO", "AMARELO"].includes(r.saude) && ["EM_ANDAMENTO", "PAUSADO", "PLANEJADO"].includes(r.status)), ...pf.semAtualizacao.filter(r => !["VERMELHO", "AMARELO"].includes(r.saude))].map(r => <tr key={r.id}><Td><Link className="text-acao" href={`/estrategia/projetos/${r.id}`}>{r.nome}</Link><div className="text-xs text-slate-500">{r.owner ?? "—"} · {r.unidade ?? "rede"}</div></Td><Td><Badge v={r.saude === "VERDE" ? "APROVADA" : r.saude === "AMARELO" ? "PENDENTE" : "REJEITADA"} label={SAUDE[r.saude]} /></Td><Td className="text-xs">{PROJ_STATUS[r.status]}</Td><Td className={`text-xs ${r.marcos_atrasados ? "text-erro" : ""}`}>{r.proximo_marco ? `${r.proximo_marco} · ${fmtData(r.proximo_prazo)}` : "—"}{r.marcos_atrasados ? ` · ${r.marcos_atrasados} atrasado(s)` : ""}</Td><Td className={`text-xs ${!r.ultima_atualizacao ? "text-aviso" : ""}`}>{fmtData(r.ultima_atualizacao) || "nunca"}</Td></tr>)}</Table>}</Card>
          <Card title="Próximos marcos"><Table head={["Marco", "Projeto", "Prazo"]} empty="Nenhum marco pendente em projetos em andamento.">{proximos.map(r => <tr key={r.id}><Td>{r.proximo_marco}</Td><Td><Link className="text-acao" href={`/estrategia/projetos/${r.id}`}>{r.nome}</Link></Td><Td className={`text-xs ${r.marcos_atrasados ? "text-erro" : ""}`}>{fmtData(r.proximo_prazo)}</Td></tr>)}</Table></Card>
        </div>
      </div>
    </Page>
  );
}
