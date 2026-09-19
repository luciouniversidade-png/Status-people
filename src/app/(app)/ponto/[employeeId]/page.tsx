import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession, canSeeEmployee } from "@/lib/auth";
import { Page, Card, Flash, Btn, Input, Field, Stat } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { fmtMin, fmtData } from "@/lib/utils";
import { montarMes, diffDia, mesAtual, PONTO_STATUS, PONTO_LABEL } from "@/lib/ponto";
import { salvarMes, gerarMesPadrao } from "../actions";

export const dynamic = "force-dynamic";
const DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const hm = (m: number) => `${Math.floor(Math.abs(m) / 60)}:${String(Math.abs(m) % 60).padStart(2, "0")}`;

export default async function Folha({ params, searchParams }: { params: Promise<{ employeeId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const { employeeId } = await params; const sp = await searchParams; const eid = Number(employeeId);
  const mes = sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : mesAtual();
  let r; try { r = await montarMes(eid, mes); } catch { notFound(); }
  if (!canSeeEmployee(s, { id: r.emp.id, unitId: r.emp.unit_id })) notFound();
  const editar = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role);
  const tot = r.dias.reduce((a, d) => ({ esp: a.esp + d.esperado, trab: a.trab + d.trabalhado, diff: a.diff + diffDia(d), salvos: a.salvos + (d.salvo ? 1 : 0) }), { esp: 0, trab: 0, diff: 0, salvos: 0 });
  const [y, m] = mes.split("-").map(Number); const rotulo = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <Page title={`Folha de ponto — ${r.emp.nome}`} sub={<span>{rotulo.charAt(0).toUpperCase() + rotulo.slice(1)} · {r.emp.regime === "DOCENTE" ? "docente" : "administrativo"} · <Link className="text-acao" href={`/colaboradores/${eid}`}>ficha</Link> · <Link className="text-acao" href={`/ponto?mes=${mes}`}>todos</Link></span>}
      actions={<><form className="flex items-end gap-2 print:hidden"><Field label="Mês"><Input type="month" name="mes" defaultValue={mes} /></Field><Btn kind="ghost">Ver</Btn></form><PrintButton /></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Esperado no mês" value={fmtMin(tot.esp).slice(1)} /><Stat label="Trabalhado" value={fmtMin(tot.trab).slice(1)} />
        <Stat label="Saldo do mês" value={<span className={tot.diff < 0 ? "text-erro" : tot.diff > 0 ? "text-ok" : ""}>{fmtMin(tot.diff)}</span>} hint={tot.salvos < r.dias.length ? `${tot.salvos} de ${r.dias.length} dias salvos` : "mês completo"} />
        <Stat label="Situações" value={<span className="text-base">{["FALTA", "ATESTADO", "FOLGA_BANCO", "FERIAS", "AFASTADO"].map(k => [k, r.dias.filter(d => d.status === k).length] as const).filter(([, n]) => n).map(([k, n]) => `${n} ${PONTO_LABEL[k].toLowerCase()}`).join(" · ") || "—"}</span>} />
      </div>
      {editar && tot.salvos === 0 && <form action={gerarMesPadrao} className="mb-3 print:hidden"><input type="hidden" name="employeeId" value={eid} /><input type="hidden" name="mes" value={mes} /><Btn kind="ghost">Preencher o mês com a jornada e o calendário</Btn><span className="ml-2 text-xs text-slate-500">Cada dia fecha em zero (trabalhado = esperado); depois ajuste só as exceções.</span></form>}
      <form action={salvarMes}>
        <input type="hidden" name="employeeId" value={eid} /><input type="hidden" name="mes" value={mes} />
        <Card title="Dia a dia">
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-mist text-xs text-slate-600"><tr><th className="px-2 py-2 text-left">Dia</th><th className="px-2 py-2 text-left">Esperado</th><th className="px-2 py-2 text-left">Trabalhado (h:mm)</th><th className="px-2 py-2 text-left">Situação</th><th className="px-2 py-2 text-left">Saldo</th><th className="px-2 py-2 text-left">Marcações</th><th className="px-2 py-2 text-left">Observação</th></tr></thead>
            <tbody className="divide-y divide-line">
              {r.dias.map(d => { const k = d.data.replace(/-/g, ""); const diff = diffDia(d); const fds = d.dow === 0 || d.dow === 6; return (
                <tr key={d.data} className={fds ? "bg-slate-50/60" : ""}>
                  <td className="whitespace-nowrap px-2 py-1"><span className="tabular-nums">{fmtData(d.data).slice(0, 5)}</span> <span className="text-xs text-slate-500">{DOW[d.dow]}</span>{d.calendario && <div className="text-[11px] text-acao">{d.calendario}</div>}{!d.salvo && <span className="ml-1 text-[10px] text-slate-400">auto</span>}</td>
                  <td className="px-2 py-1 tabular-nums">{hm(d.esperado)}<input type="hidden" name={`e_${k}`} value={d.esperado} /></td>
                  <td className="px-2 py-1">{editar ? <input name={`t_${k}`} defaultValue={hm(d.trabalhado)} className="w-20 rounded border border-line px-1.5 py-1 text-sm tabular-nums" /> : hm(d.trabalhado)}</td>
                  <td className="px-2 py-1">{editar ? <select name={`s_${k}`} defaultValue={d.status} className="rounded border border-line px-1 py-1 text-sm">{PONTO_STATUS.map(x => <option key={x} value={x}>{PONTO_LABEL[x]}</option>)}</select> : PONTO_LABEL[d.status]}</td>
                  <td className={`px-2 py-1 tabular-nums ${diff < 0 ? "text-erro" : diff > 0 ? "text-ok" : "text-slate-400"}`}>{diff ? fmtMin(diff) : "0"}</td>
                  <td className="px-2 py-1">{editar ? <input name={`m_${k}`} defaultValue={d.marcacoes ?? ""} placeholder="07:00 12:00 13:00 17:48" className="w-40 rounded border border-line px-1.5 py-1 text-xs" /> : d.marcacoes ?? ""}</td>
                  <td className="px-2 py-1">{editar ? <input name={`o_${k}`} defaultValue={d.obs ?? ""} className="w-40 rounded border border-line px-1.5 py-1 text-xs" /> : d.obs ?? ""}</td>
                </tr>); })}
            </tbody>
          </table></div>
          {editar && <div className="mt-3 flex items-center gap-3 print:hidden"><Btn>Salvar folha do mês</Btn><span className="text-xs text-slate-500">Salvar regrava os {r.dias.length} dias e recalcula os lançamentos do banco de horas deste mês. Falta e folga descontam a carga do dia; atestado, férias, feriado e dispensa não descontam; recesso desconta se não trabalhado.</span></div>}
          <div className="mt-6 hidden grid-cols-2 gap-12 text-xs text-slate-600 print:grid"><div className="border-t border-slate-400 pt-1">Assinatura do colaborador</div><div className="border-t border-slate-400 pt-1">Assinatura do gestor / RH</div></div>
        </Card>
      </form>
    </Page>
  );
}
