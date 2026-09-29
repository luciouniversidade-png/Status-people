import { requireStaff, can } from "@/lib/auth";
import { db, schema } from "@/db";
import { asc } from "drizzle-orm";
import { Page, Card, Table, Td, Badge, Flash, Field, Input, Select, Textarea, Btn } from "@/components/ui";
import { getSettings } from "@/lib/utils";
import { CANAL } from "@/lib/comunicacao";
import { Modal } from "@/components/Modal";
import { salvarModelo } from "../actions";

export const dynamic = "force-dynamic";

export default async function Modelos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const sp = await searchParams; const cfg = await getSettings(); const rows = await db.select().from(schema.messageTemplates).orderBy(asc(schema.messageTemplates.categoria), asc(schema.messageTemplates.codigo));
  const Form = ({ m }: { m?: typeof rows[number] }) => <form action={salvarModelo} className="space-y-2">{m && <input type="hidden" name="id" value={m.id} />}<div className="grid grid-cols-[120px_1fr] gap-2"><Field label="Código"><Input name="codigo" defaultValue={m?.codigo ?? ""} required placeholder="COB-LEMBRETE" /></Field><Field label="Título"><Input name="titulo" defaultValue={m?.titulo ?? ""} required /></Field></div><div className="grid grid-cols-2 gap-2"><Field label="Categoria"><Select name="categoria" defaultValue={m?.categoria ?? "GERAL"}>{cfg.comunicacao.categoriasTemplate.map(c => <option key={c}>{c}</option>)}</Select></Field><Field label="Canal"><Select name="canal" defaultValue={m?.canal ?? "WHATSAPP"}>{Object.entries(CANAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field></div><Field label="Texto" hint="Variáveis: {nome} {responsavel} {aluno} {unidade} {valor} {data} {competencia} {turma} {parcelas} {protocolo} {texto}"><Textarea name="texto" className="min-h-[120px]" defaultValue={m?.texto ?? ""} required /></Field>{m && <Field label="Situação"><Select name="ativo" defaultValue={m.ativo ? "1" : "0"}><option value="1">Ativo</option><option value="0">Inativo</option></Select></Field>}<Btn small>{m ? "Salvar" : "Criar modelo"}</Btn></form>;
  return (
    <Page title="Modelos de mensagem" sub="Textos padrão para WhatsApp e e-mail — cobrança, matrícula, atendimento, pedagógico, RH. As variáveis são preenchidas na hora do envio." actions={<Btn kind="ghost" href="/comunicacao/mensagens">Mensagens</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <div className={`grid gap-4 ${can.editar(s) ? "lg:grid-cols-[1fr_380px]" : ""} lg:items-start`}>
        <Table head={["Código", "Título", "Categoria", "Canal", "Texto", "Situação", ""]}>{rows.map(m => <tr key={m.id} className={!m.ativo ? "opacity-50" : ""}><Td className="font-medium">{m.codigo}</Td><Td>{m.titulo}</Td><Td className="text-xs">{m.categoria}</Td><Td className="text-xs">{CANAL[m.canal]}</Td><Td className="max-w-[420px] text-xs text-slate-600">{m.texto}</Td><Td><Badge v={m.ativo ? "ATIVO" : "CANCELADA"} label={m.ativo ? "Ativo" : "Inativo"} /></Td><Td>{can.editar(s) && <Modal label="Editar" kind="link"><Form m={m} /></Modal>}</Td></tr>)}</Table>
        {can.editar(s) && <Card title="Novo modelo"><Form /></Card>}
      </div>
    </Page>
  );
}
