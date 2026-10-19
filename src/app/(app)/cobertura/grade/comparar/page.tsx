import { notFound } from "next/navigation";
import { scopeUnit } from "@/lib/auth";
import { Page, Card, Table, Td, Btn, Badge } from "@/components/ui";
import { DIAS_CURTO } from "@/lib/cobertura";
import { compararVersoes, periodoTxt } from "@/lib/grade";
import { requireCobertura, SubNavCobertura } from "../../_ui";

export const dynamic = "force-dynamic";
const hm = (m: number) => m ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}` : "—";
const DOW = ["seg", "ter", "qua", "qui", "sex", "sab"] as const;

/** Comparador entre vigências da grade: o que entrou, saiu ou mudou, e a CH por dia antes × depois. */
export default async function Comparar({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireCobertura(); const sp = await searchParams;
  const c = await compararVersoes(Number(sp.a), Number(sp.b)).catch(() => null); if (!c) notFound();
  const u = scopeUnit(s); if (u !== null && (c.a.unit_id !== u || c.b.unit_id !== u)) notFound();
  const aula = (x: { dia_semana: number; inicio: string; fim: string; turma: string; disciplina: string | null }) => `${DIAS_CURTO[x.dia_semana]} ${x.inicio}–${x.fim} ${x.turma}${x.disciplina ? ` (${x.disciplina})` : ""}`;
  const mud = c.linhas.filter(l => !l.igual);
  return (
    <Page title="Comparar vigências da grade" sub={`“${c.a.nome}” (${periodoTxt(c.a)}) × “${c.b.nome}” (${periodoTxt(c.b)}) · ${c.mudaram} professor(es) com mudança.`} actions={<Btn kind="ghost" href={`/cobertura/grade?unidade=${c.b.unit_id}&versao=${c.b.id}`}>Voltar à grade</Btn>}>
      <SubNavCobertura ativo="/cobertura/grade" s={s} />
      <Card title="CH por dia pela grade — antes → depois" className="mb-4">
        <Table head={["Professor(a)", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Semana"]} empty="Nenhuma mudança de CH.">
          {mud.map(l => <tr key={l.employeeId}><Td className="font-medium">{l.nome}</Td>{DOW.map(k => <Td key={k} className={`whitespace-nowrap tabular-nums ${l.chAntes[k] !== l.chDepois[k] ? "font-semibold text-acao" : "text-slate-500"}`}>{l.chAntes[k] !== l.chDepois[k] ? `${hm(l.chAntes[k])} → ${hm(l.chDepois[k])}` : hm(l.chDepois[k])}</Td>)}
            <Td className="whitespace-nowrap tabular-nums">{hm(l.chAntes.total)} → <b>{hm(l.chDepois.total)}</b></Td></tr>)}
        </Table>
        <p className="mt-2 text-[11px] text-slate-500">CH pela grade: por turno, do início da primeira aula ao fim da última (janela conta, almoço não; plantão conta). Ela só vira jornada quando o RH aplica a CH da vigência.</p>
      </Card>
      <Card title="Aulas que mudaram">
        {mud.length === 0 ? <p className="text-sm text-slate-500">As duas vigências têm as mesmas aulas.</p> :
          <ul className="space-y-3 text-sm">{mud.map(l => <li key={l.employeeId}><div className="font-medium text-navy">{l.nome}</div>
            <ul className="mt-1 space-y-0.5 text-xs">{l.entrou.map(x => <li key={`e${x.id}`}><Badge v="APROVADA" label="entrou" /> {aula(x)}</li>)}{l.saiu.map(x => <li key={`s${x.id}`}><Badge v="REJEITADA" label="saiu" /> {aula(x)}</li>)}{l.mudou.map(x => <li key={`m${x.id}`}><Badge v="PENDENTE" label="mudou" /> {aula(x)}</li>)}</ul></li>)}</ul>}
      </Card>
    </Page>
  );
}
