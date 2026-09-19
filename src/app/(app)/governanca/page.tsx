import Link from "next/link";
import { scopeUnit } from "@/lib/auth";
import { Page, Card, Stat, Table, Td, Flash, Btn } from "@/components/ui";
import { fmtData } from "@/lib/utils";
import { estatisticasGov, expirarExcecoes } from "@/lib/governanca";
import { requireGestao } from "./_shared";

export const dynamic = "force-dynamic";

export default async function Painel({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireGestao(); const sp = await searchParams; await expirarExcecoes();
  const u = scopeUnit(s); const g = await estatisticasGov(u);
  return (
    <Page title="Governança e processos" sub="POPs vigentes, exceções, controles, não conformidades e decisões — o que está em dia e o que precisa de dono."
      actions={<><Btn kind="ghost" href="/governanca/pops">POPs</Btn><Btn kind="ghost" href="/governanca/excecoes">Exceções</Btn><Btn kind="ghost" href="/governanca/controles">Controles</Btn><Btn kind="ghost" href="/governanca/decisoes">Decisões</Btn></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Process Health" value={<span className={g.score >= 80 ? "text-ok" : g.score >= 60 ? "text-aviso" : "text-erro"}>{g.score}</span>} hint={g.fatores.length ? "clique nos motivos abaixo" : "sem pendências"} />
        <Stat label="POPs vigentes" value={`${g.pops.vigentes}/${g.pops.total}`} hint={`${g.pops.rascunho} rascunho · ${g.pops.revisao} em revisão`} href="/governanca/pops" />
        <Stat label="Exceções aguardando" value={<span className={g.exc.pendentes ? "text-aviso" : ""}>{g.exc.pendentes}</span>} hint={`${g.exc.vigentes} vigentes · ${g.exc.expirando} expiram em 30 dias`} href="/governanca/excecoes" />
        <Stat label="Controles atrasados" value={<span className={g.ctl.atrasados ? "text-erro" : ""}>{g.ctl.atrasados}</span>} hint={`${g.ctl.ativos} ativos · ${g.ctl.nao_conformes_30} não conformes em 30 dias`} href="/governanca/controles" />
        <Stat label="Não conformidades abertas" value={<span className={g.nc.graves ? "text-erro" : ""}>{g.nc.abertas}</span>} hint={`${g.nc.atrasadas} fora do prazo · ${g.nc.graves} graves`} href="/governanca/controles#ncs" />
        <Stat label="Decisões a revisar" value={g.dec.revisar} hint={`${g.dec.vigentes} vigentes`} href="/governanca/decisoes" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Card title="Por que este Process Health?">{g.fatores.length === 0 ? <p className="text-sm text-slate-600">Nenhum desconto: POPs vigentes, controles em dia, exceções revisadas.</p> : <ul className="space-y-1 text-sm">{g.fatores.map((f, i) => <li key={i}><span className="inline-block w-10 tabular-nums text-erro">{f.peso}</span>{f.texto}</li>)}</ul>}<p className="mt-2 text-xs text-slate-500">Parte de 100; cada pendência desconta. Fórmula na tela, sem caixa-preta.</p></Card>
        <Card title="Exceções recorrentes (90 dias) — candidatas a virar regra ou não conformidade"><Table head={["Regra / POP", "Motivo", "Vezes"]} empty="Nenhuma regra com 3 ou mais exceções em 90 dias.">{g.recorrentes.map((r, i) => <tr key={i}><Td>{r.regra}</Td><Td>{r.motivo}</Td><Td className="font-medium">{r.n}</Td></tr>)}</Table></Card>
        <Card title="POPs com revisão vencida"><Table head={["Código", "Título", "Revisar em"]} empty="Nenhum POP com revisão vencida.">{g.popsVencidos.map(p => <tr key={p.id}><Td>{p.codigo}</Td><Td><Link className="text-acao" href={`/governanca/pops/${p.id}`}>{p.titulo}</Link></Td><Td className="text-erro">{fmtData(p.revisar_em)}</Td></tr>)}</Table></Card>
        <Card title="Como funciona"><ul className="space-y-1 text-sm text-slate-700"><li><b>POP</b>: um dono, passos numerados, RACI, indicadores; publicado vira versão e pede ciência da equipe.</li><li><b>Exceção</b>: pedida com motivo padronizado, aprovada por alçada, sempre expira e é revisada — se repete, vira revisão do POP.</li><li><b>Controle</b>: verificação periódica com evidência; não conformidade abre tratamento com causa raiz, ação corretiva e verificação de eficácia.</li><li><b>Decisão</b>: contexto, alternativas, consequências, responsável e data de revisão.</li></ul></Card>
      </div>
    </Page>
  );
}
