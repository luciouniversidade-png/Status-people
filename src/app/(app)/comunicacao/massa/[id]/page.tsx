import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Flash, Field, Textarea, Btn, Badge } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { getSettings, fmtDataHora } from "@/lib/utils";
import { foneWa, linkWa } from "@/lib/comunicacao";
import { PUBLICO_CAMPANHA, CAMPANHA_STATUS, AUTORES_MASSA_LISTA } from "@/lib/massa";
import { decidirCampanha, cancelarCampanha } from "../../massa-actions";
import { marcarEnviada } from "../../actions";

export const dynamic = "force-dynamic";

export default async function Campanha({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const { id } = await params; const sp = await searchParams; const cfg = await getSettings();
  const aprova = (cfg.comunicacao.aprovadoresMassa as string[]).includes(s.role); if (!AUTORES_MASSA_LISTA.includes(s.role) && !aprova) notFound();
  const [c] = await sql<{ id: number; titulo: string; canal: string; publico: string; filtro: Record<string, unknown>; total: number; status: string; autor_user_id: number; autor_nome: string | null; aprovador: string | null; aprovado_em: string | null; motivo_rejeicao: string | null; disparo_em: string | null; disparado_em: string | null; enviadas: number; registradas: number; falhas: number; created_at: string; modelo: string; texto: string }[]>`SELECT c.id, c.titulo, c.canal, c.publico, c.filtro, c.total, c.status, c.autor_user_id, c.autor_nome, u.nome AS aprovador, c.aprovado_em::text, c.motivo_rejeicao, to_char((c.disparo_em AT TIME ZONE 'UTC') AT TIME ZONE 'America/Campo_Grande', 'DD/MM HH24:MI') AS disparo_em, c.disparado_em::text, c.enviadas, c.registradas, c.falhas, c.created_at::text, t.titulo AS modelo, t.texto
    FROM message_campaigns c JOIN message_templates t ON t.id=c.template_id LEFT JOIN users u ON u.id=c.aprovado_por WHERE c.id=${Number(id)}`;
  if (!c) notFound();
  const msgs = await sql<{ id: number; destinatario_nome: string; destinatario_contato: string | null; status: string; texto: string; erro: string | null }[]>`SELECT id, destinatario_nome, destinatario_contato, status, texto, erro FROM messages WHERE campaign_id=${c.id} ORDER BY id LIMIT 300`;
  const [tom, rot] = CAMPANHA_STATUS[c.status] ?? ["NEUTRO", c.status];
  return (
    <Page title={c.titulo} sub={`${c.canal === "EMAIL" ? "E-mail" : "WhatsApp"} · ${PUBLICO_CAMPANHA[c.publico]} · ${c.total} destinatário(s) · modelo “${c.modelo}” · criado por ${c.autor_nome} em ${fmtDataHora(c.created_at)}`} actions={<Btn kind="ghost" href="/comunicacao/massa">Envios em massa</Btn>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      <Card title="Situação" className="mb-4" actions={<Badge v={tom} label={rot} />}>
        <ul className="space-y-1 text-sm">
          <li>Aprovação: {c.aprovador ? `${c.aprovador} em ${fmtDataHora(c.aprovado_em)}` : "aguardando um segundo responsável (Direção ou RH) — nunca o autor"}{c.motivo_rejeicao ? ` · motivo: ${c.motivo_rejeicao}` : ""}</li>
          {c.status === "AGENDADA" && <li>Fora do horário comercial na aprovação: dispara {c.disparo_em}.</li>}
          {c.disparado_em && <li>Disparado em {fmtDataHora(c.disparado_em)}: {c.enviadas} enviada(s) pela API, {c.registradas} no histórico para envio pelo link, {c.falhas} falha(s).</li>}
        </ul>
        {aprova && c.status === "AGUARDANDO_APROVACAO" && c.autor_user_id !== s.id && <div className="mt-3 flex flex-wrap gap-2"><form action={decidirCampanha}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="decisao" value="APROVAR" /><Btn small>Aprovar envio para {c.total}</Btn></form>
          <Modal label="Rejeitar" title="Rejeitar envio em massa"><form action={decidirCampanha} className="space-y-2"><input type="hidden" name="id" value={c.id} /><input type="hidden" name="decisao" value="REJEITAR" /><Field label="Motivo"><Textarea name="motivo" required /></Field><Btn small danger>Rejeitar</Btn></form></Modal></div>}
        {c.status === "AGUARDANDO_APROVACAO" && c.autor_user_id === s.id && <p className="mt-2 text-xs text-slate-500">Você criou este envio: a aprovação é de outra pessoa.</p>}
        {["AGUARDANDO_APROVACAO", "AGENDADA"].includes(c.status) && (c.autor_user_id === s.id || aprova) && <form action={cancelarCampanha} className="mt-2"><input type="hidden" name="id" value={c.id} /><Btn small kind="ghost">Cancelar envio</Btn></form>}
      </Card>
      <Card title="Modelo" className="mb-4"><p className="whitespace-pre-wrap text-sm">{c.texto}</p></Card>
      {msgs.length > 0 && <Card title={`Mensagens (${msgs.length})`}>
        <Table head={["Destinatário", "Situação", "Ação"]}>
          {msgs.map(m => { const fone = c.canal === "WHATSAPP" ? foneWa(m.destinatario_contato) : null; return <tr key={m.id}><Td>{m.destinatario_nome}<div className="text-[11px] text-slate-500">{m.destinatario_contato}</div></Td><Td><Badge v={m.status === "ENVIADA" ? "APROVADA" : m.status === "FALHOU" ? "REJEITADA" : "PENDENTE"} label={m.status === "REGISTRADA" ? "a enviar pelo link" : m.status.toLowerCase()} />{m.erro && <div className="text-[11px] text-slate-500">{m.erro}</div>}</Td>
            <Td>{m.status === "REGISTRADA" && fone && <span className="flex flex-wrap gap-2"><a className="text-xs text-acao underline" href={linkWa(fone, m.texto) ?? "#"} target="_blank" rel="noreferrer">abrir WhatsApp</a><form action={marcarEnviada}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="voltar" value={`/comunicacao/massa/${c.id}`} /><button className="text-xs text-acao underline">marcar enviada</button></form></span>}</Td></tr>; })}
        </Table>
      </Card>}
    </Page>
  );
}
