import { scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Flash, Field, Btn, Input, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { DIAS, DIAS_CURTO } from "@/lib/cobertura";
import { salvarAula, removerAula, importarGrade } from "../actions";
import { requireCobertura, SubNavCobertura, professoresDoEscopo, COORDENA } from "../_ui";

export const dynamic = "force-dynamic";

export default async function GradeHoraria({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireCobertura(); const sp = await searchParams; const escopo = scopeUnit(s); const unidade = escopo ?? (sp.unidade ? Number(sp.unidade) : null); const prof = sp.professor ? Number(sp.professor) : null;
  const pode = COORDENA.includes(s.role);
  const [slots, units, profs, salas] = await Promise.all([
    sql<{ id: number; employee_id: number; professor: string; unit_id: number; unidade: string; dia_semana: number; inicio: string; fim: string; turno: string; turma: string; disciplina: string | null; space_id: number | null; sala: string | null }[]>`SELECT t.id, t.employee_id, e.nome AS professor, t.unit_id, u.nome AS unidade, t.dia_semana, t.inicio, t.fim, t.turno, t.turma, t.disciplina, t.space_id, sp.nome AS sala FROM teacher_slots t JOIN employees e ON e.id=t.employee_id JOIN units u ON u.id=t.unit_id LEFT JOIN spaces sp ON sp.id=t.space_id
      WHERE t.ativo ${unidade === null ? sql`` : sql`AND t.unit_id=${unidade}`} ${prof ? sql`AND t.employee_id=${prof}` : sql``} ORDER BY e.nome, t.dia_semana, t.inicio LIMIT 2000`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ${escopo === null ? sql`` : sql`WHERE id=${escopo}`} ORDER BY nome`, professoresDoEscopo(s),
    sql<{ id: number; nome: string; unidade: string }[]>`SELECT sp.id, sp.nome, u.nome AS unidade FROM spaces sp JOIN units u ON u.id=sp.unit_id WHERE sp.ativo ${escopo === null ? sql`` : sql`AND sp.unit_id=${escopo}`} ORDER BY u.nome, sp.nome`]);
  const voltar = `/cobertura/grade?${new URLSearchParams(Object.entries({ unidade: sp.unidade ?? "", professor: sp.professor ?? "" }).filter(([, v]) => v)).toString()}`;
  const profsComAula = new Set(slots.map(x => x.employee_id)).size;
  const Form = ({ t }: { t?: typeof slots[number] }) => <form action={salvarAula} className="space-y-2">{t && <input type="hidden" name="id" value={t.id} />}<input type="hidden" name="voltar" value={voltar} />
    <Field label="Professor(a)"><Select name="employeeId" required defaultValue={t?.employee_id ?? prof ?? ""}><option value="">Escolha</option>{profs.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</Select></Field>
    <div className="grid grid-cols-2 gap-2"><Field label="Unidade"><Select name="unitId" required defaultValue={t?.unit_id ?? unidade ?? ""}>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Field label="Dia"><Select name="dia" required defaultValue={t?.dia_semana ?? 1}>{[1, 2, 3, 4, 5, 6].map(d => <option key={d} value={d}>{DIAS[d]}</option>)}</Select></Field>
      <Field label="Início"><Input name="inicio" required placeholder="07:00" defaultValue={t?.inicio ?? ""} /></Field><Field label="Fim"><Input name="fim" required placeholder="07:50" defaultValue={t?.fim ?? ""} /></Field>
      <Field label="Turma"><Input name="turma" required placeholder="5º ano A" defaultValue={t?.turma ?? ""} /></Field><Field label="Disciplina"><Input name="disciplina" placeholder="Matemática" defaultValue={t?.disciplina ?? ""} /></Field></div>
    <Field label="Sala (opcional)"><Select name="spaceId" defaultValue={t?.space_id ?? ""}><option value="">—</option>{salas.map(x => <option key={x.id} value={x.id}>{x.unidade} · {x.nome}</option>)}</Select></Field>
    <Btn small>{t ? "Salvar aula" : "Incluir aula"}</Btn></form>;
  return (
    <Page title="Grade horária dos professores" sub={`${slots.length} aula(s) semanais de ${profsComAula} professor(es). É a base para listar as aulas a cobrir e saber quem está livre em cada horário.`}>
      <SubNavCobertura ativo="/cobertura/grade" s={s} />
      <Flash ok={sp.ok} erro={sp.erro} />
      <form className="mb-4 grid grid-cols-2 items-end gap-2 rounded-md border border-line bg-white p-3 sm:flex sm:flex-wrap">
        {!escopo && <Field label="Unidade"><Select name="unidade" defaultValue={unidade ?? ""}><option value="">Todas</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
        <Field label="Professor(a)"><Select name="professor" defaultValue={prof ?? ""}><option value="">Todos</option>{profs.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</Select></Field>
        <Btn kind="ghost">Filtrar</Btn>
      </form>
      <div className={`grid grid-cols-1 gap-4 ${pode ? "lg:grid-cols-[minmax(0,1fr)_340px]" : ""} lg:items-start`}>
        <Table head={["Professor(a)", "Dia", "Horário", "Turma", "Disciplina", "Sala", ""]} empty="Nenhuma aula cadastrada. Inclua ao lado ou importe a planilha da grade.">
          {slots.map(t => <tr key={t.id}><Td className="font-medium">{t.professor}{!escopo && <div className="text-[11px] font-normal text-slate-500">{t.unidade}</div>}</Td><Td>{DIAS_CURTO[t.dia_semana]}</Td><Td className="whitespace-nowrap">{t.inicio}–{t.fim}<div className="text-[11px] text-slate-500">{t.turno}</div></Td><Td>{t.turma}</Td><Td>{t.disciplina ?? "—"}</Td><Td>{t.sala ?? "—"}</Td>
            <Td>{pode && <div className="flex gap-1"><Modal label="Editar" title={`Aula de ${t.professor}`}><Form t={t} /></Modal><form action={removerAula}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="voltar" value={voltar} /><Btn small kind="ghost">Remover</Btn></form></div>}</Td></tr>)}
        </Table>
        {pode && <div className="space-y-4">
          <Card title="Incluir aula"><Form /></Card>
          <Card title="Importar planilha">
            <form action={importarGrade} className="space-y-2">
              <Field label="Arquivo (.xlsx ou .csv)"><input type="file" name="arquivo" accept=".xlsx,.xls,.csv,.txt" className="block w-full rounded-md border border-line bg-white px-2 py-1.5 text-xs" /></Field>
              <Field label="…ou cole as linhas" hint="Colunas: professor (nome, e-mail ou CPF), unidade, dia, inicio, fim, turma, disciplina, sala"><Textarea name="csv" className="min-h-[90px] font-mono text-xs" placeholder={"professor;unidade;dia;inicio;fim;turma;disciplina;sala\nAna Paula Lima;Carandá;Segunda;07:00;07:50;5º ano A;Matemática;Sala 5"} /></Field>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="substituir" value="1" /> Substituir a grade atual das unidades do arquivo (início de semestre)</label>
              <Btn small>Importar</Btn>
              <p className="text-xs text-slate-500">Tudo ou nada: qualquer linha com erro (professor não encontrado, horário inválido, choque) impede a importação e aparece na mensagem.</p>
            </form>
          </Card>
        </div>}
      </div>
    </Page>
  );
}
