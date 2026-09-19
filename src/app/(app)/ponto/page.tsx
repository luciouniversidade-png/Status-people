import Link from "next/link";
import { requireStaff, scopeUnit, can } from "@/lib/auth";
import { Page, Table, Td, Badge, Flash, Field, Btn, Input, Stat } from "@/components/ui";
import { fmtMin } from "@/lib/utils";
import { resumoMes, mesAtual } from "@/lib/ponto";

export const dynamic = "force-dynamic";

export default async function Ponto({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const sp = await searchParams; const u = scopeUnit(s);
  const mes = sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : mesAtual();
  const rows = await resumoMes(u, mes);
  const semJornada = rows.filter(r => !r.tem_jornada && !r.jornada_min_dia).length; const semFolha = rows.filter(r => r.dias_salvos === 0).length;
  const saldo = rows.reduce((a, r) => a + r.saldo_mes, 0);
  return (
    <Page title="Ponto e jornada" sub="Folha mensal por colaborador: dia a dia com carga esperada, trabalhada e situação. Cada dia salvo vira lançamento no banco de horas."
      actions={<><Btn kind="ghost" href="/ponto/jornadas">Jornadas</Btn><Btn kind="ghost" href="/ponto/calendario">Calendário</Btn>{can.editar(s) && <Btn kind="ghost" href="/ponto/importar">Importar planilhas</Btn>}</>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-4 flex items-end gap-2"><Field label="Mês"><Input type="month" name="mes" defaultValue={mes} /></Field><Btn kind="ghost">Ver</Btn></form>
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Colaboradores" value={rows.length} />
        <Stat label="Sem folha no mês" value={<span className={semFolha ? "text-aviso" : ""}>{semFolha}</span>} />
        <Stat label="Sem jornada definida" value={<span className={semJornada ? "text-aviso" : ""}>{semJornada}</span>} hint="defina em Jornadas" />
        <Stat label="Saldo gerado no mês" value={<span className={saldo < 0 ? "text-erro" : "text-ok"}>{fmtMin(saldo)}</span>} />
      </div>
      <Table head={["Colaborador", "Unidade", "Regime", "Jornada", "Dias salvos", "Esperado", "Trabalhado", "Faltas", "Atestados", "Saldo do mês"]} empty="Nenhum colaborador ativo.">
        {rows.map(r => <tr key={r.id} className="hover:bg-mist/60">
          <Td><Link className="font-medium text-acao" href={`/ponto/${r.id}?mes=${mes}`}>{r.nome}</Link></Td><Td>{r.unidade}</Td><Td className="text-xs">{r.regime === "DOCENTE" ? "Docente" : "Administrativo"}</Td>
          <Td>{r.tem_jornada ? <Badge v="ATIVO" label="definida" /> : r.jornada_min_dia ? <span className="text-xs text-slate-600">{fmtMin(r.jornada_min_dia).slice(1)}/dia</span> : <Badge v="PENDENTE" label="sem jornada" />}</Td>
          <Td>{r.dias_salvos || <span className="text-slate-400">—</span>}</Td><Td className="tabular-nums">{r.dias_salvos ? fmtMin(r.esperado).slice(1) : "—"}</Td><Td className="tabular-nums">{r.dias_salvos ? fmtMin(r.trabalhado).slice(1) : "—"}</Td><Td>{r.faltas || "—"}</Td><Td>{r.atestados || "—"}</Td>
          <Td className={`font-medium tabular-nums ${r.saldo_mes < 0 ? "text-erro" : r.saldo_mes > 0 ? "text-ok" : ""}`}>{r.dias_salvos ? fmtMin(r.saldo_mes) : "—"}</Td>
        </tr>)}
      </Table>
    </Page>
  );
}
