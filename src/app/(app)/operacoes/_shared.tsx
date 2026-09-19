import { db, schema, sql } from "@/db";
import { asc } from "drizzle-orm";
import { Field, Input, Select, Textarea, Btn } from "@/components/ui";
import type { Session } from "@/lib/auth";
import { scopeUnit, can } from "@/lib/auth";
import { OS_TIPO, OS_PRIO } from "@/lib/operacoes";
import { abrirChamado } from "./actions";

export const usuariosOps = () => sql<{ id: number; nome: string }[]>`SELECT id, nome FROM users WHERE ativo AND role IN ('DIRECAO','RH','DIRETOR_UNIDADE','GESTOR','OPERACOES') ORDER BY nome`;

export async function NovoChamadoForm({ s, voltar, cfg }: { s: Session; voltar: string; cfg: { ambientesPadrao: string[] } }) {
  const scope = scopeUnit(s); const unitId = scope ?? s.unitId ?? null;
  const [units, ativos, users] = await Promise.all([db.select().from(schema.units).orderBy(asc(schema.units.nome)), sql<{ id: number; nome: string; unidade: string }[]>`SELECT a.id, a.nome, u.nome AS unidade FROM assets a JOIN units u ON u.id=a.unit_id WHERE a.status <> 'BAIXADO' ${unitId === null ? sql`` : sql`AND a.unit_id=${unitId}`} ORDER BY a.nome`, can.operacoes(s) ? usuariosOps() : Promise.resolve([])]);
  return (
    <form action={abrirChamado} className="space-y-2 rounded-md border border-line bg-mist p-3"><div className="text-sm font-semibold text-navy">Abrir chamado</div><input type="hidden" name="voltar" value={voltar} />
      <Field label="O que precisa ser feito"><Input name="titulo" required placeholder="Ex.: Ar-condicionado da sala 5 não gela" /></Field>
      <div className="grid grid-cols-2 gap-2"><Field label="Tipo"><Select name="tipo" defaultValue="CORRETIVA">{Object.entries(OS_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Prioridade"><Select name="prioridade" defaultValue="NORMAL">{Object.entries(OS_PRIO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field></div>
      <div className="grid grid-cols-2 gap-2"><Field label="Unidade"><Select name="unitId" defaultValue={unitId ?? ""} required>{units.filter(u => unitId === null || u.id === unitId || can.editar(s) || s.role === "OPERACOES").map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field><Field label="Ambiente"><Input name="ambiente" list="ambientes" placeholder="Sala 5, pátio…" /><datalist id="ambientes">{cfg.ambientesPadrao.map(a => <option key={a} value={a} />)}</datalist></Field></div>
      <Field label="Ativo relacionado (opcional)"><Select name="assetId" defaultValue=""><option value="">—</option>{ativos.map(a => <option key={a.id} value={a.id}>{a.nome} · {a.unidade}</option>)}</Select></Field>
      <Field label="Descrição"><Textarea name="descricao" className="min-h-[60px]" /></Field>
      {users.length > 0 && <Field label="Responsável"><Select name="responsavelUserId" defaultValue=""><option value="">— a definir —</option>{users.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>}
      <Btn small>Abrir chamado</Btn>
    </form>
  );
}
