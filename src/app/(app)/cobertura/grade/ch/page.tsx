import { notFound } from "next/navigation";
import { sql } from "@/db";
import { scopeUnit } from "@/lib/auth";
import { Page, Card, Table, Td, Flash, Btn, Badge } from "@/components/ui";
import { versao as lerVersao, propostaCh, periodoTxt, situacao } from "@/lib/grade";
import { fmtData, hoje } from "@/lib/utils";
import { aplicarChGrade, recalcularDiasGrade } from "../../grade-actions";
import { requireCobertura, SubNavCobertura } from "../../_ui";

export const dynamic = "force-dynamic";
const hm = (m: number) => m ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}` : "—";
const DOW = ["seg", "ter", "qua", "qui", "sex", "sab"] as const;

/** CH a partir da vigência (CRQ-TMP-V3-01): proposta da grade × jornada vigente; o RH marca quem recebe e o sistema aplica desde o início da vigência. */
export default async function ChDaGrade({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireCobertura(); const sp = await searchParams;
  if (!["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role)) notFound();
  const v = await lerVersao(Number(sp.versao)); if (!v || v.status !== "ATIVA") notFound(); const u = scopeUnit(s); if (u !== null && v.unit_id !== u) notFound();
  const [un] = await sql<{ nome: string }[]>`SELECT nome FROM units WHERE id=${v.unit_id}`;
  const prop = await propostaCh(v.id); const st = situacao(v); const h = hoje();
  const [fechado] = await sql<{ mes: string }[]>`SELECT mes FROM timesheet_locks WHERE unit_id=${v.unit_id} AND status='FECHADO' AND mes >= ${v.vigencia_inicio.slice(0, 7)} AND mes <= ${h.slice(0, 7)} ORDER BY mes LIMIT 1`;
  const diferentes = prop.filter(p => !p.igual);
  return (
    <Page title="CH dos professores pela grade" sub={`${un?.nome ?? ""} · “${v.nome}” (${periodoTxt(v)}). A CH da grade só vira jornada para quem você marcar, a partir de ${fmtData(v.vigencia_inicio)}; meses fechados ficam intactos.`} actions={<Btn kind="ghost" href={`/cobertura/grade?unidade=${v.unit_id}&versao=${v.id}`}>Voltar à grade</Btn>}>
      <SubNavCobertura ativo="/cobertura/grade" s={s} />
      <Flash ok={sp.ok} erro={sp.erro} />
      {st === "ENCERRADA" && <p className="mb-3 rounded-md border border-line bg-mist px-3 py-2 text-xs">Vigência encerrada: a CH do que passou não muda.</p>}
      {fechado && <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-erro">O ponto de {fechado.mes.split("-").reverse().join("/")} está fechado na unidade: a CH não pode mudar a partir de {fmtData(v.vigencia_inicio)}. Reabra o mês com justificativa (Ponto → Fechamento) ou aplique numa vigência posterior.</p>}
      <form action={aplicarChGrade}><input type="hidden" name="versaoId" value={v.id} />
        <Table head={["Aplicar", "Professor(a)", "Jornada atual (seg–sáb)", "CH pela grade (seg–sáb)", "Semana", "Horários pela grade"]} empty="Nenhum professor nesta vigência.">
          {prop.map(p => <tr key={p.employeeId} className={p.igual ? "" : "bg-amber-50/40"}>
            <Td><input type="checkbox" name="emp" value={p.employeeId} defaultChecked={!p.igual && p.regime === "DOCENTE"} aria-label={`Aplicar a CH a ${p.nome}`} /></Td>
            <Td className="font-medium">{p.nome}{p.regime !== "DOCENTE" && <div className="text-[11px] font-normal text-aviso">sem regime docente — confira o contrato</div>}{p.outrasUnidades && <div className="text-[11px] font-normal text-slate-500">inclui aulas em outra unidade</div>}</Td>
            <Td className="whitespace-nowrap text-xs tabular-nums">{p.jornada ? DOW.map(k => hm(p.jornada![k])).join(" · ") : <Badge v="PENDENTE" label="sem jornada" />}{p.jornada?.obs ? <div className="text-[11px] text-slate-500">{p.jornada.obs}</div> : null}</Td>
            <Td className="whitespace-nowrap text-xs tabular-nums">{DOW.map(k => hm(p.ch[k])).join(" · ")}</Td>
            <Td className="whitespace-nowrap tabular-nums">{hm(p.ch.total)}{p.igual ? <div className="text-[11px] text-ok">igual à jornada</div> : null}</Td>
            <Td className="text-xs">{p.ch.horarios}</Td></tr>)}
        </Table>
        {st !== "ENCERRADA" && !fechado && <div className="mt-3 flex flex-wrap items-center gap-2"><Btn>Aplicar a CH a partir de {fmtData(v.vigencia_inicio)}</Btn><span className="text-xs text-slate-500">{diferentes.length} professor(es) com CH diferente da jornada. A grade informa a carga de aulas — confira o contrato antes de marcar.</span></div>}
      </form>
      <Card title="Dias já lançados" className="mt-4">
        <p className="text-sm text-slate-600">Se o ponto de dias desde {fmtData(v.vigencia_inicio)} já foi lançado com a CH antiga, recalcule a CH desses dias (só de quem recebeu a CH desta vigência e só em meses abertos). O banco de horas desses dias é refeito.</p>
        <form action={recalcularDiasGrade} className="mt-2"><input type="hidden" name="versaoId" value={v.id} /><Btn small kind="ghost">Recalcular CH dos dias lançados</Btn></form>
      </Card>
    </Page>
  );
}
