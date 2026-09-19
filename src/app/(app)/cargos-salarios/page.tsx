import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff, can, scopeUnit } from "@/lib/auth";
import { Page, Card, Table, Td, Badge, Flash, Btn, Stat } from "@/components/ui";
import { tabelaCargos, fmtBRL } from "@/lib/talento";

export const dynamic = "force-dynamic";

export default async function Cargos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); if (!can.verSalario(s)) redirect("/"); const sp = await searchParams;
  const { rows, alertas, cfg } = await tabelaCargos(scopeUnit(s));
  const semFaixa = rows.filter(r => !r.grade_id && r.ocupantes > 0).length; const fora = rows.reduce((a, r) => a + r.abaixo + r.acima, 0);
  return (
    <Page title="Cargos e salários" sub="Cargos avaliados por pontos, faixas salariais, ocupação e equidade interna (Art. 461 CLT). Visível só para RH e Direção."
      actions={<><Btn kind="ghost" href="/api/export/tabela-salarial">Exportar CSV</Btn><Btn kind="ghost" href="/cargos-salarios/faixas">Faixas salariais</Btn></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Cargos" value={rows.length} hint={`${rows.filter(r => r.grade_id).length} com faixa`} />
        <Stat label="Cargos ocupados sem faixa" value={<span className={semFaixa ? "text-aviso" : ""}>{semFaixa}</span>} hint="defina a faixa na página do cargo" />
        <Stat label="Salários fora da faixa" value={<span className={fora ? "text-erro" : ""}>{fora}</span>} hint="abaixo do mínimo ou acima do máximo" />
        <Stat label="Alertas de equidade" value={<span className={alertas.length ? "text-erro" : ""}>{alertas.length}</span>} hint={`dispersão > ${cfg.remuneracao.dispersaoAlertaPct}% no mesmo cargo e nível`} />
      </div>
      {alertas.length > 0 && <Card title="Equidade interna — mesmo cargo e nível com dispersão acima do limite" className="mb-4 border-red-200">
        <Table head={["Cargo", "Nível", "Pessoas", "Dispersão"]}>{alertas.map((a, i) => { const p = rows.find(r => r.id === a.positionId); return <tr key={i}><Td><Link className="text-acao" href={`/cargos-salarios/${a.positionId}`}>{p?.nome}</Link></Td><Td>{a.nivel}</Td><Td>{a.n}</Td><Td className="font-medium text-erro">{a.pct}%</Td></tr>; })}</Table>
        <p className="mt-2 text-xs text-slate-500">Diferenças no mesmo cargo devem estar justificadas por nível (Júnior/Pleno/Sênior), tempo ou avaliação formal — registre na ficha do colaborador.</p>
      </Card>}
      <Table head={["Cargo", "Área", "Pontos", "Faixa", "Mín. · Médio · Máx.", "Ocupantes", "Salário médio", "Compa-ratio", "Fora da faixa"]} empty="Nenhum cargo.">
        {rows.map(r => <tr key={r.id} className="hover:bg-mist/60"><Td><Link className="font-medium text-acao" href={`/cargos-salarios/${r.id}`}>{r.nome}</Link></Td><Td className="text-xs">{r.area}</Td><Td>{r.pontos ?? "—"}</Td><Td>{r.grade ? <Badge v="ATIVO" label={r.grade} /> : <span className="text-xs text-aviso">sem faixa</span>}</Td>
          <Td className="whitespace-nowrap text-xs tabular-nums">{r.minimo !== null ? `${fmtBRL(r.minimo)} · ${fmtBRL(r.medio)} · ${fmtBRL(r.maximo)}` : "—"}</Td><Td>{r.ocupantes}</Td><Td className="tabular-nums">{fmtBRL(r.sal_medio)}</Td>
          <Td className={`tabular-nums ${r.compa === null ? "" : r.compa < 90 ? "text-aviso" : r.compa > 110 ? "text-erro" : "text-ok"}`}>{r.compa === null ? "—" : `${r.compa}%`}</Td><Td className={r.abaixo + r.acima ? "text-erro" : ""}>{r.abaixo + r.acima ? `${r.abaixo} abaixo · ${r.acima} acima` : "—"}</Td></tr>)}
      </Table>
      <p className="mt-2 text-xs text-slate-500">Compa-ratio = salário médio dos ocupantes ÷ ponto médio da faixa. 90–110% é a zona esperada.</p>
    </Page>
  );
}
