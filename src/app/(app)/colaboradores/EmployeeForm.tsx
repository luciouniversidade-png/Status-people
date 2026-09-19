import { db, schema } from "@/db";
import { asc } from "drizzle-orm";
import { Field, Input, Select, Textarea, Btn, Card } from "@/components/ui";
import { VINCULOS, VINCULO_LABEL, NIVEIS, TURNOS } from "@/lib/utils";
import type { Session } from "@/lib/auth";
import { can, scopeUnit } from "@/lib/auth";

type Emp = typeof schema.employees.$inferSelect;

export async function EmployeeForm({ s, emp, action, novo }: { s: Session; emp?: Emp; action: (fd: FormData) => Promise<void>; novo?: boolean }) {
  const [units, companies, positions, gestores] = await Promise.all([
    db.select().from(schema.units).orderBy(asc(schema.units.nome)),
    db.select().from(schema.companies).orderBy(asc(schema.companies.nome)),
    db.select().from(schema.positions).orderBy(asc(schema.positions.ordem)),
    db.select({ id: schema.employees.id, nome: schema.employees.nome }).from(schema.employees).orderBy(asc(schema.employees.nome)),
  ]);
  const scope = scopeUnit(s);
  return (
    <form action={action} className="space-y-4">
      {emp && <input type="hidden" name="id" value={emp.id} />}
      <Card title="Identificação">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
          <Field label="Nome completo" className="sm:col-span-2"><Input name="nome" required defaultValue={emp?.nome} /></Field>
          <Field label="CPF" hint="Visível apenas para RH e Direção"><Input name="cpf" defaultValue={emp?.cpf ?? ""} placeholder="000.000.000-00" /></Field>
          <Field label="Data de nascimento"><Input name="dataNascimento" type="date" defaultValue={emp?.dataNascimento ?? ""} /></Field>
          <Field label="E-mail"><Input name="email" type="email" defaultValue={emp?.email ?? ""} /></Field>
          <Field label="Telefone"><Input name="telefone" defaultValue={emp?.telefone ?? ""} /></Field>
          <Field label="Endereço" className="sm:col-span-2"><Input name="endereco" defaultValue={emp?.endereco ?? ""} /></Field>
        </div>
      </Card>
      <Card title="Vínculo e posição">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
          <Field label="Unidade"><Select name="unitId" required defaultValue={emp?.unitId ?? scope ?? ""}><option value="">Escolha</option>{units.filter(u => !scope || u.id === scope).map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>
          <Field label="Empresa (CNPJ empregador)"><Select name="companyId" defaultValue={emp?.companyId ?? ""}><option value="">—</option>{companies.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select></Field>
          <Field label="Cargo"><Select name="positionId" defaultValue={emp?.positionId ?? ""}><option value="">—</option>{positions.map(p => <option key={p.id} value={p.id}>{p.nome} · {p.area}</option>)}</Select></Field>
          <Field label="Nível"><Select name="nivel" defaultValue={emp?.nivel ?? ""}><option value="">—</option>{NIVEIS.map(n => <option key={n}>{n}</option>)}</Select></Field>
          <Field label="Gestor direto"><Select name="gestorId" defaultValue={emp?.gestorId ?? ""}><option value="">—</option>{gestores.filter(g => g.id !== emp?.id).map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}</Select></Field>
          <Field label="Tipo de vínculo"><Select name="vinculo" defaultValue={emp?.vinculo ?? "CLT"}>{VINCULOS.map(v => <option key={v} value={v}>{VINCULO_LABEL[v]}</option>)}</Select></Field>
          <Field label="Data de admissão"><Input name="admissao" type="date" required defaultValue={emp?.admissao ?? ""} /></Field>
          <Field label="Carga horária diária (minutos)" hint="Ex.: 528 = 8h48 · 264 = 4h24 · professores: soma das aulas do dia"><Input name="jornadaMinDia" type="number" min={0} defaultValue={emp?.jornadaMinDia ?? ""} /></Field>
          <Field label="Turno"><Select name="turno" defaultValue={emp?.turno ?? ""}><option value="">—</option>{TURNOS.map(t => <option key={t}>{t}</option>)}</Select></Field>
          <Field label="Regime de calendário" hint="Docentes seguem férias coletivas, dias não letivos e recesso; administrativos, feriados e dispensas."><Select name="regime" defaultValue={emp?.regime ?? "ADMINISTRATIVO"}><option value="ADMINISTRATIVO">Administrativo</option><option value="DOCENTE">Docente</option></Select></Field>
          {can.verSalario(s) && <Field label="Salário base (R$)" hint="Campo restrito a RH e Direção"><Input name="salario" type="number" step="0.01" min={0} defaultValue={emp?.salario ?? ""} /></Field>}
          <Field label="Observações" className="sm:col-span-2"><Textarea name="obs" defaultValue={emp?.obs ?? ""} /></Field>
        </div>
      </Card>
      {novo && (
        <label className="flex items-start gap-2 rounded-md border border-line bg-white px-4 py-3 text-sm">
          <input type="checkbox" name="abrirAdmissao" value="1" defaultChecked className="mt-1" />
          <span><span className="font-medium">Abrir processo de admissão com checklist</span><br /><span className="text-slate-600">O colaborador fica “Em admissão” até o checklist ser concluído.</span></span>
        </label>
      )}
      <div className="flex gap-2"><Btn>{novo ? "Cadastrar" : "Salvar alterações"}</Btn><Btn kind="ghost" href={emp ? `/colaboradores/${emp.id}` : "/colaboradores"}>Cancelar</Btn></div>
    </form>
  );
}
