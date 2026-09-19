import { Modal } from "@/components/Modal";
import Link from "next/link";
import { requireMatriculas, scopeUnit, can } from "@/lib/auth";
import { db, schema } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Table, Td, Badge, Flash, Select, Field, Btn, Input } from "@/components/ui";
import { getSettings } from "@/lib/utils";
import { ocupacao } from "@/lib/matriculas";
import { salvarTurma, excluirTurma } from "../actions";

export const dynamic = "force-dynamic";
const TURNOS = ["Matutino", "Vespertino", "Integral"];

export default async function Turmas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireMatriculas(); const sp = await searchParams; const cfg = await getSettings();
  const scope = scopeUnit(s); const unitId = scope ?? (sp.unidade ? Number(sp.unidade) : null); const ano = sp.ano ? Number(sp.ano) : cfg.matriculas.anoLetivo;
  const [rows, units, grades] = await Promise.all([ocupacao(ano, unitId), db.select().from(schema.units).orderBy(asc(schema.units.nome)), db.select().from(schema.grades).orderBy(asc(schema.grades.ordem))]);
  const editar = can.gradeTurmas(s);
  const Form = ({ t }: { t?: typeof rows[number] }) => (
    <form action={salvarTurma} className="grid gap-2 sm:grid-cols-2">
      {t && <input type="hidden" name="id" value={t.class_id} />}<input type="hidden" name="ano" value={ano} />
      <Field label="Unidade"><Select name="unitId" defaultValue={t?.unit_id ?? scope ?? ""} required>{units.filter(u => !scope || u.id === scope).map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>
      <Field label="Modalidade"><Select name="modalidade" defaultValue={t?.modalidade ?? "REGULAR"}><option value="REGULAR">Regular</option><option value="INTEGRAL">Integral</option></Select></Field>
      <Field label="Série (Regular)"><Select name="gradeId" defaultValue={t?.grade_id ?? ""}><option value="">—</option>{grades.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}</Select></Field>
      <Field label="Séries do grupo (Integral)"><Input name="seriesTexto" defaultValue={t?.series_texto ?? ""} placeholder="Ex.: 2º + 3º ano" /></Field>
      <Field label="Turno"><Select name="turno" defaultValue={t?.turno ?? "Matutino"}>{TURNOS.map(x => <option key={x}>{x}</option>)}</Select></Field>
      <Field label="Nome da turma"><Input name="nome" defaultValue={t?.nome ?? ""} required placeholder="Ex.: 5º ano A" /></Field>
      <Field label="Vagas"><Input name="vagas" type="number" min={0} defaultValue={t?.vagas ?? 20} required /></Field>
      <Field label="Situação"><Select name="status" defaultValue={t?.status ?? "ABERTA"}><option value="ABERTA">Aberta</option><option value="FECHADA">Fechada</option></Select></Field>
      <div className="sm:col-span-2"><Btn small>{t ? "Salvar" : "Adicionar turma"}</Btn></div>
    </form>
  );
  return (
    <Page title={`Turmas ${ano}`} sub="Grade de oferta: unidade × série × turno × vagas. Reservas e matrículas acontecem dentro de cada turma."
      actions={<><Btn kind="ghost" href={`/api/export/ocupacao?ano=${ano}`}>Exportar CSV</Btn></>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-4 flex flex-wrap items-end gap-2 rounded-md border border-line bg-white p-3">
        {!scope && <Field label="Unidade"><Select name="unidade" defaultValue={unitId ?? ""}><option value="">Todas</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
        <Field label="Ano"><Input name="ano" type="number" defaultValue={ano} className="w-28" /></Field>
        <Btn kind="ghost">Filtrar</Btn>
      </form>
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Table head={["Turma", "Unidade", "Modalidade", "Série", "Turno", "Vagas", "Ocupação", "Situação", ""]} empty={`Nenhuma turma em ${ano}.`}>
          {rows.map(t => <tr key={t.class_id}>
            <Td><Link className="font-medium text-acao" href={`/matriculas/turmas/${t.class_id}`}>{t.nome}</Link></Td><Td>{t.unidade}</Td><Td>{t.modalidade === "REGULAR" ? "Regular" : "Integral"}</Td><Td>{t.serie ?? t.series_texto ?? "—"}</Td><Td>{t.turno}</Td><Td>{t.vagas}</Td>
            <Td className="whitespace-nowrap"><span className="text-ok">{t.confirmadas}</span> + <span className="text-aviso">{t.reservadas}</span> = {t.confirmadas + t.reservadas}</Td><Td><Badge v={t.status === "ABERTA" ? "ATIVO" : "DESLIGADO"} label={t.status === "ABERTA" ? "Aberta" : "Fechada"} /></Td>
            <Td>{editar && <Modal label={"Editar"} kind="link"><div className=""><Form t={t} /><form action={excluirTurma} className="mt-2"><input type="hidden" name="id" value={t.class_id} /><Btn small danger>Excluir</Btn></form></div></Modal>}</Td>
          </tr>)}
        </Table>
        {editar && <Card title="Nova turma"><Form /></Card>}
      </div>
    </Page>
  );
}
