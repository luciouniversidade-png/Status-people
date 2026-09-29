import { db, schema } from "@/db";
import { asc } from "drizzle-orm";
import { Field, Input, Select, Textarea, Btn } from "@/components/ui";
import { CANAL, preencher } from "@/lib/comunicacao";
import { registrarMensagem } from "@/app/(app)/comunicacao/actions";

/** Formulário de mensagem (WhatsApp/e-mail) pré-preenchido com um modelo e as variáveis do contexto. */
export async function EnviarMensagem({ nome, contato, vars = {}, categoria, entidade, entidadeId, studentId, employeeId, unitId, voltar, canal = "WHATSAPP", modeloPadrao }: { nome: string; contato?: string | null; vars?: Record<string, string | number | null | undefined>; categoria?: string; entidade?: string; entidadeId?: number; studentId?: number | null; employeeId?: number | null; unitId?: number | null; voltar: string; canal?: string; modeloPadrao?: string }) {
  const modelos = (await db.select().from(schema.messageTemplates).orderBy(asc(schema.messageTemplates.categoria), asc(schema.messageTemplates.codigo))).filter(m => m.ativo && (!categoria || m.categoria === categoria || m.categoria === "GERAL"));
  const padrao = (modeloPadrao && modelos.find(m => m.codigo === modeloPadrao)) || modelos.find(m => m.categoria === categoria) || modelos[0]; const texto = padrao ? preencher(padrao.texto, { nome, responsavel: nome, ...vars }) : "";
  return (
    <form action={registrarMensagem} className="space-y-2"><input type="hidden" name="voltar" value={voltar} /><input type="hidden" name="vars" value={JSON.stringify(vars)} />{entidade && <input type="hidden" name="entidade" value={entidade} />}{entidadeId && <input type="hidden" name="entidadeId" value={entidadeId} />}{studentId && <input type="hidden" name="studentId" value={studentId} />}{employeeId && <input type="hidden" name="employeeId" value={employeeId} />}{unitId && <input type="hidden" name="unitId" value={unitId} />}
      <div className="grid grid-cols-2 gap-2"><Field label="Para"><Input name="destinatarioNome" defaultValue={nome} required /></Field><Field label="Telefone / e-mail"><Input name="destinatarioContato" defaultValue={contato ?? ""} placeholder="67 99999-0000" /></Field></div>
      <div className="grid grid-cols-2 gap-2"><Field label="Canal"><Select name="canal" defaultValue={canal}>{Object.entries(CANAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Modelo (referência)"><Select name="templateId" defaultValue={padrao?.id ?? ""}><option value="">—</option>{modelos.map(m => <option key={m.id} value={m.id}>{m.codigo} · {m.titulo}</option>)}</Select></Field></div>
      <Field label="Mensagem" hint="Ajuste o texto; {variáveis} não preenchidas ficam entre chaves para você completar."><Textarea name="texto" className="min-h-[120px]" defaultValue={texto} required /></Field>
      <div className="flex flex-wrap gap-2"><Btn small name="enviar" value="1">Enviar</Btn><Btn small kind="ghost" name="enviar" value="0">Só registrar</Btn></div>
      <p className="text-xs text-slate-500">WhatsApp sem API configurada: a mensagem fica registrada e aparece um link para abrir o WhatsApp do celular já com o texto.</p>
    </form>
  );
}
