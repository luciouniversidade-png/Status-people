import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Field, Input, Select, Textarea, Btn } from "@/components/ui";
import type { Session } from "@/lib/auth";
import { scopeUnit } from "@/lib/auth";
import { CASE_TIPOS, CASE_TIPO_LABEL, CANAIS, CANAL_LABEL, CASE_PRIO } from "@/lib/atendimento";
import { abrirCaso } from "./actions";

export const alunosDaRede = (unitId: number | null) => sql<{ id: number; nome: string; unidade: string | null }[]>`SELECT st.id, st.nome, u.nome AS unidade FROM students st LEFT JOIN units u ON u.id=st.unit_atual_id WHERE 1=1 ${unitId === null ? sql`` : sql`AND (st.unit_atual_id=${unitId} OR st.unit_atual_id IS NULL)`} ORDER BY st.nome`;
export const usuariosAtivos = () => sql<{ id: number; nome: string; role: string; unitId: number | null }[]>`SELECT id, nome, role, unit_id AS "unitId" FROM users WHERE ativo AND role IN ('RH','DIRECAO','DIRETOR_UNIDADE','GESTOR','COMERCIAL') ORDER BY nome`;

export async function NovoCasoForm({ s, categorias, voltar, studentId, compacto }: { s: Session; categorias: string[]; voltar: string; studentId?: number; compacto?: boolean }) {
  const scope = scopeUnit(s);
  const [alunos, units, users] = await Promise.all([studentId ? Promise.resolve([]) : alunosDaRede(scope), db.select().from(schema.units).orderBy(asc(schema.units.nome)), usuariosAtivos()]);
  return (
    <form action={abrirCaso} className="space-y-2 rounded-md border border-line bg-mist p-3">
      <div className="text-sm font-semibold text-navy">Novo atendimento</div>
      <input type="hidden" name="voltar" value={voltar} />
      {studentId ? <input type="hidden" name="studentId" value={studentId} /> : <Field label="Aluno / família" hint="Deixe em branco para contato avulso."><Select name="studentId"><option value="">—</option>{alunos.map(a => <option key={a.id} value={a.id}>{a.nome}{a.unidade ? ` · ${a.unidade}` : ""}</option>)}</Select></Field>}
      {!studentId && <div className="grid grid-cols-2 gap-2"><Field label="Contato (se avulso)"><Input name="contatoNome" /></Field><Field label="Telefone"><Input name="contatoTelefone" /></Field></div>}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Tipo"><Select name="tipo" defaultValue="SOLICITACAO">{CASE_TIPOS.map(t => <option key={t} value={t}>{CASE_TIPO_LABEL[t]}</option>)}</Select></Field>
        <Field label="Canal"><Select name="canal" defaultValue="WHATSAPP">{CANAIS.map(c => <option key={c} value={c}>{CANAL_LABEL[c]}</option>)}</Select></Field>
      </div>
      <Field label="Assunto"><Input name="assunto" required /></Field>
      {!compacto && <Field label="Relato"><Textarea name="descricao" className="min-h-[70px]" /></Field>}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Prioridade" hint="Saída = alta; reclamação grave = urgente"><Select name="prioridade" defaultValue=""><option value="">automática</option>{Object.entries(CASE_PRIO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Unidade"><Select name="unitId" defaultValue={scope ?? ""}><option value="">a do aluno</option>{units.filter(u => !scope || u.id === scope).map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>
      </div>
      <details><summary className="cursor-pointer text-xs text-acao">Reclamação: categoria e gravidade · responsável</summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Field label="Categoria"><Select name="categoria" defaultValue=""><option value="">—</option>{categorias.map(c => <option key={c}>{c}</option>)}</Select></Field>
          <Field label="Gravidade"><Select name="gravidade" defaultValue=""><option value="">—</option><option value="1">1 · leve</option><option value="2">2 · moderada</option><option value="3">3 · grave</option></Select></Field>
          <Field label="Responsável" className="col-span-2"><Select name="responsavelUserId" defaultValue={s.id}>{users.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>
        </div></details>
      <Btn small>Registrar</Btn>
    </form>
  );
}
