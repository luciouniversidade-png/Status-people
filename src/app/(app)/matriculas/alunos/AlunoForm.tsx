import { db, schema } from "@/db";
import { asc } from "drizzle-orm";
import { Field, Input, Select, Textarea, Btn } from "@/components/ui";
import { ORIGENS, ORIGEM_LABEL } from "@/lib/utils";
import { salvarAluno } from "../actions";

type St = typeof schema.students.$inferSelect;
export async function AlunoForm({ st }: { st?: St }) {
  const [units, grades] = await Promise.all([db.select().from(schema.units).orderBy(asc(schema.units.nome)), db.select().from(schema.grades).orderBy(asc(schema.grades.ordem))]);
  return (
    <form action={salvarAluno} className="grid grid-cols-2 gap-3 sm:grid-cols-2">
      {st && <input type="hidden" name="id" value={st.id} />}
      <Field label="Nome do aluno" className="sm:col-span-2"><Input name="nome" required defaultValue={st?.nome} /></Field>
      <Field label="Data de nascimento"><Input name="dataNascimento" type="date" defaultValue={st?.dataNascimento ?? ""} /></Field>
      <Field label="Origem"><Select name="origem" defaultValue={st?.origem ?? ""}><option value="">—</option>{ORIGENS.map(o => <option key={o} value={o}>{ORIGEM_LABEL[o]}</option>)}</Select></Field>
      <Field label="Responsável"><Input name="responsavel" defaultValue={st?.responsavel ?? ""} /></Field>
      <Field label="Telefone / WhatsApp"><Input name="telefone" defaultValue={st?.telefone ?? ""} /></Field>
      <Field label="E-mail do responsável"><Input name="email" type="email" defaultValue={st?.email ?? ""} /></Field>
      <Field label="CPF do responsável"><Input name="cpfResponsavel" defaultValue={st?.cpfResponsavel ?? ""} /></Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="alunoAtual" value="1" defaultChecked={st?.alunoAtual} /> Já é aluno da rede (rematrícula)</label>
      <Field label="Unidade atual"><Select name="unitAtualId" defaultValue={st?.unitAtualId ?? ""}><option value="">—</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>
      <Field label="Série atual"><Select name="serieAtualId" defaultValue={st?.serieAtualId ?? ""}><option value="">—</option>{grades.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}</Select></Field>
      <Field label="Observações" className="sm:col-span-2"><Textarea name="obs" defaultValue={st?.obs ?? ""} /></Field>
      <div className="sm:col-span-2"><Btn>{st ? "Salvar" : "Cadastrar"}</Btn></div>
    </form>
  );
}
