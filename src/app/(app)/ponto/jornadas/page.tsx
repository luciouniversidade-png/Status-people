import Link from "next/link";
import { requireStaff, scopeUnit, can } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Flash, Field, Btn, Input, Select } from "@/components/ui";
import { fmtData, fmtMin, hoje } from "@/lib/utils";
import { salvarJornada, excluirJornada } from "../actions";

export const dynamic = "force-dynamic";
const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

export default async function Jornadas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const sp = await searchParams; const u = scopeUnit(s); const q = (sp.q ?? "").trim(); const sel = sp.colaborador ? Number(sp.colaborador) : null;
  const emps = await sql<{ id: number; nome: string; unidade: string; regime: string; jornada_min_dia: number | null; vig: string | null; semana: number | null }[]>`
    SELECT e.id, e.nome, u.nome AS unidade, e.regime, e.jornada_min_dia, j.vigencia_inicio::text AS vig, (j.seg+j.ter+j.qua+j.qui+j.sex+j.sab+j.dom) AS semana
    FROM employees e JOIN units u ON u.id=e.unit_id LEFT JOIN LATERAL (SELECT * FROM schedules sc WHERE sc.employee_id=e.id AND sc.vigencia_inicio <= ${hoje()} AND (sc.vigencia_fim IS NULL OR sc.vigencia_fim >= ${hoje()}) ORDER BY vigencia_inicio DESC LIMIT 1) j ON true
    WHERE e.situacao <> 'DESLIGADO' ${u === null ? sql`` : sql`AND e.unit_id=${u}`} ${q ? sql`AND e.nome ILIKE ${"%" + q + "%"}` : sql``} ORDER BY e.nome LIMIT 400`;
  const hist = sel ? await sql<{ id: number; vigencia_inicio: string; vigencia_fim: string | null; seg: number; ter: number; qua: number; qui: number; sex: number; sab: number; dom: number; horarios: string | null; obs: string | null }[]>`SELECT id, vigencia_inicio::text, vigencia_fim::text, seg, ter, qua, qui, sex, sab, dom, horarios, obs FROM schedules WHERE employee_id=${sel} ORDER BY vigencia_inicio DESC` : [];
  const selEmp = emps.find(e => e.id === sel); const podeEditar = can.editar(s) || s.role === "DIRETOR_UNIDADE";
  const voltar = `/ponto/jornadas?colaborador=${sel ?? ""}&q=${encodeURIComponent(q)}`;
  return (
    <Page title="Jornadas de trabalho" sub="Carga esperada por dia da semana, com vigência. Professores: soma dos minutos de aula de cada dia; administrativos: 8:48 (528 min) ou 4:24 (264 min).">
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div>
          <form className="mb-3 flex items-end gap-2"><Field label="Buscar"><Input name="q" defaultValue={q} placeholder="Nome" /></Field><Btn kind="ghost">Filtrar</Btn></form>
          <Table head={["Colaborador", "Unidade", "Regime", "Jornada vigente", "Semanal", ""]} empty="Nenhum colaborador.">
            {emps.map(e => <tr key={e.id} className={e.id === sel ? "bg-sky-50" : ""}><Td><Link className="text-acao" href={`/ponto/jornadas?colaborador=${e.id}&q=${encodeURIComponent(q)}`}>{e.nome}</Link></Td><Td>{e.unidade}</Td><Td className="text-xs">{e.regime === "DOCENTE" ? "Docente" : "Adm."}</Td>
              <Td>{e.vig ? `desde ${fmtData(e.vig)}` : e.jornada_min_dia ? <span className="text-xs text-slate-600">fixa {hm(e.jornada_min_dia)}/dia</span> : <span className="text-xs text-aviso">não definida</span>}</Td><Td className="tabular-nums">{e.semana !== null ? hm(e.semana) : e.jornada_min_dia ? hm(e.jornada_min_dia * 5) : "—"}</Td><Td><Link className="text-xs text-acao" href={`/ponto/${e.id}`}>folha</Link></Td></tr>)}
          </Table>
        </div>
        <div className="space-y-4">
          {selEmp ? <>
            <Card title={`Jornadas de ${selEmp.nome}`}>
              {hist.length === 0 ? <p className="text-sm text-slate-600">Sem jornada cadastrada — o sistema usa a carga diária fixa da ficha ({selEmp.jornada_min_dia ? hm(selEmp.jornada_min_dia) : "não informada"}), de segunda a sexta.</p> :
                hist.map(j => <div key={j.id} className="mb-2 rounded border border-line p-2 text-xs"><div className="font-medium text-navy">{fmtData(j.vigencia_inicio)} → {j.vigencia_fim ? fmtData(j.vigencia_fim) : "vigente"}</div>
                  <div className="mt-1 grid grid-cols-7 gap-1 text-center tabular-nums">{(["seg", "ter", "qua", "qui", "sex", "sab", "dom"] as const).map(d => <div key={d}><div className="text-slate-500">{d}</div><div>{hm(j[d])}</div></div>)}</div>
                  {j.horarios && <div className="mt-1 text-slate-600">{j.horarios}</div>}
                  {can.editar(s) && <form action={excluirJornada} className="mt-1"><input type="hidden" name="id" value={j.id} /><input type="hidden" name="voltar" value={voltar} /><button className="text-erro underline">excluir</button></form>}</div>)}
            </Card>
            {podeEditar && <Card title="Nova jornada (vigência)">
              <form action={salvarJornada} className="space-y-2"><input type="hidden" name="employeeId" value={selEmp.id} /><input type="hidden" name="voltar" value={voltar} />
                <div className="grid grid-cols-2 gap-2"><Field label="Vale a partir de"><Input name="vigenciaInicio" type="date" defaultValue={hoje()} required /></Field><Field label="Até (opcional)"><Input name="vigenciaFim" type="date" /></Field></div>
                <div className="grid grid-cols-4 gap-1 sm:grid-cols-7">{(["seg", "ter", "qua", "qui", "sex", "sab", "dom"] as const).map(d => <Field key={d} label={d}><Input name={d} defaultValue={d === "sab" || d === "dom" ? "0:00" : selEmp.jornada_min_dia ? hm(selEmp.jornada_min_dia) : "8:48"} className="!px-1 text-center" /></Field>)}</div>
                <p className="text-xs text-slate-500">Formato h:mm ou minutos. Dia sem aula/expediente = 0:00.</p>
                <Field label="Horários (texto livre)"><Input name="horarios" placeholder="Seg 07:00–12:00 · Ter 13:00–17:48 …" /></Field>
                <Field label="Observação"><Input name="obs" /></Field>
                <Btn small>Salvar jornada</Btn>
              </form>
            </Card>}
          </> : <Card title="Como funciona"><ul className="space-y-2 text-sm text-slate-700"><li>Clique no nome para ver e cadastrar a jornada.</li><li>Nova jornada encerra a anterior no dia anterior à vigência — as grades de março, maio e julho viram períodos.</li><li>A folha de ponto usa a jornada do dia; sem jornada, usa a carga fixa da ficha de segunda a sexta.</li><li>Sábado e domingo com 0:00 entram como descanso semanal.</li></ul></Card>}
        </div>
      </div>
    </Page>
  );
}
