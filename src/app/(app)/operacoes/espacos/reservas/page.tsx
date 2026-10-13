import { requireSession, scopeUnit, can } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Flash, Field, Btn, Input, Select } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { fmtData, hoje, addDays } from "@/lib/utils";
import { TIPO_ESPACO, ocupacaoEspaco } from "@/lib/espacos";
import { DIAS_CURTO, diaSemana } from "@/lib/cobertura";
import { reservarEspaco, cancelarReserva } from "../actions";
import { SubNavEspacos } from "../_ui";

export const dynamic = "force-dynamic";
const segunda = (iso: string) => { const d = diaSemana(iso); return addDays(iso, d === 0 ? -6 : 1 - d); };

export default async function Reservas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const sp = await searchParams; const h = hoje(); const escopo = scopeUnit(s);
  const units = await sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ${escopo === null ? sql`` : sql`WHERE id=${escopo}`} ORDER BY nome`;
  const unidade = escopo ?? (sp.unidade ? Number(sp.unidade) : units[0]?.id ?? 0);
  const ini = segunda(sp.semana && /^\d{4}-\d{2}-\d{2}$/.test(sp.semana) ? sp.semana : h); const dias = Array.from({ length: 6 }, (_, k) => addDays(ini, k));
  const espacos = await sql<{ id: number; nome: string; tipo: string; capacidade: number | null }[]>`SELECT id, nome, tipo, capacidade FROM spaces WHERE unit_id=${unidade} AND ativo AND reservavel ORDER BY tipo, nome`;
  const espaco = sp.espaco ? espacos.find(e => e.id === Number(sp.espaco)) : espacos[0];
  const agenda = espaco ? await Promise.all(dias.map(async d => ({ d, itens: await ocupacaoEspaco(espaco.id, d) }))) : [];
  const minhas = await sql<{ id: number; espaco: string; data: string; inicio: string; fim: string; titulo: string; grupo: string | null }[]>`SELECT b.id, sp.nome AS espaco, b.data::text, b.inicio, b.fim, b.titulo, b.grupo FROM space_bookings b JOIN spaces sp ON sp.id=b.space_id WHERE b.solicitante_user_id=${s.id} AND b.status='CONFIRMADA' AND b.data >= ${h} ORDER BY b.data, b.inicio LIMIT 50`;
  const gestao = s.role !== "COLABORADOR" && can.operacoes(s); const voltar = `/operacoes/espacos/reservas?unidade=${unidade}&semana=${ini}${espaco ? `&espaco=${espaco.id}` : ""}`;
  return (
    <Page title="Reservas de espaços" sub="Quadra, laboratório, auditório, biblioteca e equipamentos — sem conflito com outras reservas nem com as aulas fixas da grade.">
      <SubNavEspacos ativo="/operacoes/espacos/reservas" gestao={s.role !== "COLABORADOR"} />
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-4 grid grid-cols-2 items-end gap-2 rounded-md border border-line bg-white p-3 sm:flex sm:flex-wrap">
        {!escopo && <Field label="Unidade"><Select name="unidade" defaultValue={unidade}>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
        <Field label="Espaço"><Select name="espaco" defaultValue={espaco?.id ?? ""}>{espacos.map(e => <option key={e.id} value={e.id}>{e.nome} · {TIPO_ESPACO[e.tipo]}</option>)}</Select></Field>
        <Field label="Semana de"><Input name="semana" type="date" defaultValue={ini} /></Field><Btn kind="ghost">Ver</Btn>
      </form>
      {espacos.length === 0 ? <Card><p className="text-sm text-slate-600">Nenhum espaço desta unidade aceita reservas.{gestao ? " Marque “Aceita reservas” no cadastro de espaços." : ""}</p></Card> : <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <Card title={`${espaco?.nome} · semana de ${fmtData(ini)}`} actions={<span className="flex gap-2 text-xs"><a className="text-acao" href={`?unidade=${unidade}&espaco=${espaco?.id}&semana=${addDays(ini, -7)}`}>← anterior</a><a className="text-acao" href={`?unidade=${unidade}&espaco=${espaco?.id}&semana=${addDays(ini, 7)}`}>próxima →</a></span>}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">{agenda.map(({ d, itens }) => <div key={d} className={`rounded-md border p-2 ${d === h ? "border-acao" : "border-line"}`}>
            <div className="mb-1 text-xs font-semibold text-navy">{DIAS_CURTO[diaSemana(d)]} {fmtData(d).slice(0, 5)}</div>
            {itens.length === 0 ? <p className="text-xs text-slate-400">livre</p> : <ul className="space-y-1">{itens.map(o => <li key={`${o.origem}${o.id}`} className={`rounded px-1.5 py-1 text-xs ${o.origem === "AULA" ? "bg-slate-100 text-slate-700" : "bg-sky-50 text-navy"}`}><b>{o.inicio}–{o.fim}</b> {o.titulo}<span className="block text-[10px] text-slate-500">{o.origem === "AULA" ? `aula fixa · ${o.quem}` : o.quem}</span></li>)}</ul>}
          </div>)}</div>
        </Card>
        <div className="space-y-4">
          {s.role !== "LEITURA" && <Card title="Reservar">
            <form action={reservarEspaco} className="space-y-2"><input type="hidden" name="voltar" value={voltar} />
              <Field label="Espaço"><Select name="spaceId" required defaultValue={espaco?.id ?? ""}>{espacos.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</Select></Field>
              <div className="grid grid-cols-3 gap-2"><Field label="Data"><Input name="data" type="date" required min={h} defaultValue={dias.find(d => d >= h) ?? h} /></Field><Field label="Início"><Input name="inicio" required placeholder="09:00" /></Field><Field label="Fim"><Input name="fim" required placeholder="10:40" /></Field></div>
              <Field label="Para quê"><Input name="titulo" required placeholder="Aula prática, ensaio, reunião de pais" /></Field>
              <div className="grid grid-cols-2 gap-2"><Field label="Turma (opcional)"><Input name="turma" /></Field><Field label="Repetir (semanas)"><Input name="repetirSemanas" type="number" min={0} max={20} defaultValue={0} /></Field></div>
              <Btn small>Reservar</Btn>
            </form></Card>}
          <Card title={`Minhas próximas reservas (${minhas.length})`}>
            {minhas.length === 0 ? <p className="text-sm text-slate-500">Nenhuma.</p> : <Table head={["Quando", "Espaço", ""]}>{minhas.map(r => <tr key={r.id}><Td className="whitespace-nowrap text-xs">{fmtData(r.data)}<div>{r.inicio}–{r.fim}</div></Td><Td className="text-xs">{r.espaco}<div className="text-slate-500">{r.titulo}</div></Td>
              <Td><Modal label="Cancelar" title={`Cancelar ${r.espaco} em ${fmtData(r.data)}`}><form action={cancelarReserva} className="space-y-2"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="voltar" value={voltar} /><Field label="Motivo (opcional)"><Input name="motivo" /></Field>{r.grupo && <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="serie" value="1" /> Cancelar também as próximas da série semanal</label>}<Btn small danger>Cancelar reserva</Btn></form></Modal></Td></tr>)}</Table>}
          </Card>
        </div>
      </div>}
    </Page>
  );
}
