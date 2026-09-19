import Link from "next/link";
import { requireStaff, scopeUnit } from "@/lib/auth";
import { Page, Card, Table, Td, Btn, Input, Field, Stat } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { fmtData, fmtMin, LEAVE_LABEL, VINCULO_LABEL, SITUACAO_LABEL } from "@/lib/utils";
import { mesRef, relatorioMensal } from "@/lib/relatorio";

export const dynamic = "force-dynamic";

export default async function Relatorios({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const s = await requireStaff(); const { mes } = await searchParams; const u = scopeUnit(s);
  const m = mesRef(mes); const r = await relatorioMensal(u, m);
  const totalCred = r.banco.reduce((a, b) => a + b.creditos, 0), totalDeb = r.banco.reduce((a, b) => a + b.debitos, 0);
  return (
    <Page title={`Relatório mensal — ${m.rotulo}`} sub="Fechamento do mês para o contador/DP: movimentações, férias e afastamentos, banco de horas."
      actions={<><form className="flex items-end gap-2 print:hidden"><Field label="Mês"><Input type="month" name="mes" defaultValue={m.ini.slice(0, 7)} /></Field><Btn kind="ghost">Ver</Btn></form><Btn kind="ghost" href={`/api/export/banco-mensal?mes=${m.ini.slice(0, 7)}`}>Exportar banco (CSV)</Btn><PrintButton /></>}>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 print:grid-cols-4">
        <Stat label="Admissões" value={r.admissoes.length} /><Stat label="Desligamentos" value={r.desligamentos.length} />
        <Stat label="Férias/afastamentos no mês" value={r.afastamentos.length} />
        <Stat label="Banco de horas no mês" value={<span className="text-base">{fmtMin(totalCred)} <span className="text-slate-400">/</span> {fmtMin(totalDeb)}</span>} hint={r.pendentes ? `${r.pendentes} lançamento(s) ainda pendente(s) de aprovação` : "sem pendências de aprovação"} />
      </div>
      <Card title="Admissões" className="mb-4">
        <Table head={["Colaborador", "Unidade", "Empresa", "Cargo", "Vínculo", "Admissão", "Situação"]} empty="Nenhuma admissão no mês.">
          {r.admissoes.map(x => <tr key={x.id}><Td><Link className="text-acao" href={`/colaboradores/${x.id}`}>{x.nome}</Link></Td><Td>{x.unidade}</Td><Td>{x.empresa ?? "—"}</Td><Td>{x.cargo ?? "—"}</Td><Td>{VINCULO_LABEL[x.vinculo] ?? x.vinculo}</Td><Td>{fmtData(x.admissao)}</Td><Td>{SITUACAO_LABEL[x.situacao]}</Td></tr>)}
        </Table>
      </Card>
      <Card title="Desligamentos" className="mb-4">
        <Table head={["Colaborador", "Unidade", "Empresa", "Cargo", "Data", "Motivo", "Situação"]} empty="Nenhum desligamento no mês.">
          {r.desligamentos.map(x => <tr key={x.id}><Td><Link className="text-acao" href={`/colaboradores/${x.id}`}>{x.nome}</Link></Td><Td>{x.unidade}</Td><Td>{x.empresa ?? "—"}</Td><Td>{x.cargo ?? "—"}</Td><Td>{fmtData(x.desligamento)}</Td><Td>{x.motivo ?? "—"}</Td><Td>{x.situacao === "DESLIGADO" ? "Concluído" : "Em andamento"}</Td></tr>)}
        </Table>
      </Card>
      <Card title="Férias e afastamentos aprovados no mês" className="mb-4">
        <Table head={["Colaborador", "Unidade", "Tipo", "Período", "Dias no mês", "Total"]} empty="Nenhuma férias ou afastamento no mês.">
          {r.afastamentos.map((x, i) => <tr key={i}><Td><Link className="text-acao" href={`/colaboradores/${x.id}`}>{x.nome}</Link></Td><Td>{x.unidade}</Td><Td>{LEAVE_LABEL[x.tipo]}</Td><Td className="whitespace-nowrap">{fmtData(x.inicio)} – {fmtData(x.fim)}</Td><Td>{x.dias_no_mes}</Td><Td>{x.dias}</Td></tr>)}
        </Table>
      </Card>
      <Card title="Banco de horas — movimento do mês (lançamentos aprovados)">
        <Table head={["Colaborador", "Unidade", "Saldo inicial", "Créditos", "Débitos", "Saldo final"]} empty="Nenhum colaborador ativo.">
          {r.banco.map(x => <tr key={x.id}><Td><Link className="text-acao" href={`/colaboradores/${x.id}#banco`}>{x.nome}</Link></Td><Td>{x.unidade}</Td><Td className="tabular-nums">{fmtMin(x.saldo_inicial)}</Td><Td className="tabular-nums text-ok">{x.creditos ? fmtMin(x.creditos) : "—"}</Td><Td className="tabular-nums text-erro">{x.debitos ? fmtMin(x.debitos) : "—"}</Td><Td className={`font-medium tabular-nums ${x.saldo_final < 0 ? "text-erro" : x.saldo_final > 0 ? "text-ok" : ""}`}>{fmtMin(x.saldo_final)}</Td></tr>)}
        </Table>
        <p className="mt-2 text-xs text-slate-500">Gerado em {new Date().toLocaleString("pt-BR", { timeZone: "America/Campo_Grande" })} por {s.nome}. Lançamentos pendentes não entram no movimento.</p>
      </Card>
    </Page>
  );
}
