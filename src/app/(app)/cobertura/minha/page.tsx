import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge, Flash, Field, Btn, Input, Select } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { fmtData, hoje, addDays } from "@/lib/utils";
import { aulas, DIAS, DIAS_CURTO, COB_STATUS, COB_TOM, MOTIVO_AUS } from "@/lib/cobertura";
import { responderConvite, avisarAusencia, cancelarAusencia } from "../actions";
import { SubNavCobertura } from "../_ui";

export const dynamic = "force-dynamic";

export default async function MinhasSubstituicoes({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams; const h = hoje();
  if (!s.employeeId) return <Page title="Minhas substituições"><Card><p className="text-sm text-slate-600">Seu acesso não está ligado a uma ficha de colaborador. Peça ao RH para fazer a ligação.</p></Card></Page>;
  const [convites, proximas, feitas, grade, minhasAus] = await Promise.all([
    aulas(addDays(h, -1), addDays(h, 60), null, { coberturaDe: s.employeeId, status: ["CONVIDADO"] }),
    aulas(h, addDays(h, 60), null, { coberturaDe: s.employeeId, status: ["CONFIRMADA"] }),
    aulas(addDays(h, -90), h, null, { coberturaDe: s.employeeId, status: ["REALIZADA"] }),
    sql<{ id: number; dia_semana: number; inicio: string; fim: string; turma: string; disciplina: string | null; unidade: string; sala: string | null }[]>`SELECT t.id, t.dia_semana, t.inicio, t.fim, t.turma, t.disciplina, u.nome AS unidade, sp.nome AS sala FROM teacher_slots t JOIN units u ON u.id=t.unit_id LEFT JOIN spaces sp ON sp.id=t.space_id WHERE t.employee_id=${s.employeeId} AND t.ativo AND slot_vigente(t.version_id, current_date) ORDER BY t.dia_semana, t.inicio`,
    sql<{ id: number; data: string; motivo: string; origem: string; inicio: string | null; fim: string | null; aulas: number; cobertas: number }[]>`SELECT ab.id, ab.data::text, ab.motivo, ab.origem, ab.inicio, ab.fim, (SELECT count(*) FROM cover_assignments ca WHERE ca.absence_id=ab.id AND ca.status <> 'CANCELADA')::int AS aulas, (SELECT count(*) FROM cover_assignments ca WHERE ca.absence_id=ab.id AND ca.status IN ('CONFIRMADA','REALIZADA'))::int AS cobertas FROM cover_absences ab WHERE ab.employee_id=${s.employeeId} AND ab.status='ATIVA' AND ab.data >= ${h} ORDER BY ab.data`]);
  const minutos = feitas.reduce((a, x) => a + x.minutos, 0);
  return (
    <Page title="Minhas substituições" sub="Convites para cobrir aulas, coberturas combinadas, sua grade e o aviso de ausência para a coordenação.">
      <SubNavCobertura ativo="/cobertura/minha" s={s} />
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="space-y-4">
          <Card title={`Convites para responder (${convites.length})`} className={convites.length ? "border-amber-300" : ""}>
            {convites.length === 0 ? <p className="text-sm text-slate-500">Nenhum convite pendente.</p> : <ul className="space-y-3">{convites.map(a => <li key={a.id} className="rounded-md border border-line p-3">
              <div className="font-medium text-navy">{a.turma}{a.disciplina ? ` · ${a.disciplina}` : ""}</div><div className="text-sm">{DIAS[new Date(a.data + "T12:00:00Z").getUTCDay()]}, {fmtData(a.data)} · {a.inicio}–{a.fim} · {a.unidade}{a.sala ? ` · ${a.sala}` : ""}</div><div className="text-xs text-slate-500">no lugar de {a.ausente}</div>
              <div className="mt-2 flex flex-wrap gap-2"><form action={responderConvite}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="resposta" value="ACEITAR" /><Btn>Aceitar</Btn></form>
                <Modal label="Não posso" small={false} title="Recusar convite"><form action={responderConvite} className="space-y-2"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="resposta" value="RECUSAR" /><Field label="Motivo (opcional)"><Input name="motivo" /></Field><Btn small danger>Recusar</Btn></form></Modal></div>
            </li>)}</ul>}
          </Card>
          <Card title="Coberturas combinadas">
            <Table head={["Quando", "Turma", "No lugar de"]} empty="Nenhuma cobertura combinada.">{proximas.map(a => <tr key={a.id}><Td className="whitespace-nowrap">{fmtData(a.data)} · {a.inicio}–{a.fim}</Td><Td>{a.turma}<div className="text-[11px] text-slate-500">{a.disciplina ?? ""} · {a.unidade}{a.sala ? ` · ${a.sala}` : ""}</div></Td><Td>{a.ausente}</Td></tr>)}</Table>
          </Card>
          <Card title="Minha grade horária">
            <Table head={["Dia", "Horário", "Turma", "Disciplina", "Unidade"]} empty="Sua grade ainda não foi cadastrada pela coordenação.">{grade.map(g => <tr key={g.id}><Td>{DIAS_CURTO[g.dia_semana]}</Td><Td className="whitespace-nowrap">{g.inicio}–{g.fim}</Td><Td>{g.turma}</Td><Td>{g.disciplina ?? "—"}</Td><Td>{g.unidade}{g.sala ? ` · ${g.sala}` : ""}</Td></tr>)}</Table>
          </Card>
          <Card title={`Coberturas realizadas (90 dias): ${feitas.length}`}>
            <p className="text-sm text-slate-600">{feitas.length ? `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, "0")} de cobertura — lançadas no seu banco de horas conforme a regra da escola.` : "Nenhuma cobertura realizada no período."}</p>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Avisar ausência">
            <form action={avisarAusencia} className="space-y-2">
              <div className="grid grid-cols-2 gap-2"><Field label="De"><Input name="de" type="date" required min={h} defaultValue={h} /></Field><Field label="Até (opcional)"><Input name="ate" type="date" min={h} /></Field>
                <Field label="Só a partir de" hint="Vazio = dia todo"><Input name="inicio" placeholder="HH:MM" /></Field><Field label="Até"><Input name="fim" placeholder="HH:MM" /></Field></div>
              <Field label="Motivo"><Select name="motivo" required>{["FALTA", "ATESTADO", "FORMACAO", "OUTRO"].map(k => <option key={k} value={k}>{MOTIVO_AUS[k]}</option>)}</Select></Field>
              <Field label="Recado para a coordenação"><Input name="obs" placeholder="Ex.: atividade da turma no armário da sala" /></Field>
              <Btn small>Avisar a coordenação</Btn>
              <p className="text-xs text-slate-500">Atestado: entregue o documento ao RH como de costume. O aviso aqui só organiza quem cobre suas aulas.</p>
            </form>
          </Card>
          {minhasAus.length > 0 && <Card title="Meus avisos de ausência"><ul className="space-y-2 text-sm">{minhasAus.map(x => <li key={x.id} className="flex flex-wrap items-center justify-between gap-2"><span>{fmtData(x.data)} · {MOTIVO_AUS[x.motivo]}<span className="block text-xs text-slate-500">{x.cobertas}/{x.aulas} aula(s) cobertas</span></span>{x.origem === "PROFESSOR" && <form action={cancelarAusencia}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="voltar" value="/cobertura/minha" /><Btn small kind="ghost">Cancelar aviso</Btn></form>}</li>)}</ul></Card>}
          <Card title="Situações"><ul className="space-y-1 text-xs">{Object.entries(COB_STATUS).filter(([k]) => k !== "CANCELADA").map(([k, v]) => <li key={k}><Badge v={COB_TOM[k]} label={v} /></li>)}</ul></Card>
        </div>
      </div>
    </Page>
  );
}
