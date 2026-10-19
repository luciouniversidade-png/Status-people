import { cookies } from "next/headers";
import { sql } from "@/db";
import type { Session } from "@/lib/auth";
import { scopeUnit } from "@/lib/auth";
import { Card, Badge, Btn, Field, Input, Textarea } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { Copiar } from "@/components/Copiar";
import { fmtData, getSettings } from "@/lib/utils";
import { appUrl } from "@/lib/url";
import { ETAPA_LABEL } from "@/lib/talento";
import { DOC_STATUS, SLOT_STATUS } from "@/lib/portal-candidato";
import { gerarLinkCandidato, revogarLinkCandidato, pedirDocumentosCandidato, conferirDocumentoCandidato, oferecerHorarios, cancelarHorario, responderCandidato } from "../../portal-actions";

/** T-106 · lado do RH: link pessoal, documentos pedidos e conferidos, horários oferecidos e a conversa registrada com o candidato. */
export async function PortalCandidato({ s, cid, apps }: { s: Session; cid: number; apps: { id: number; vaga: string; etapa: string; requisition_id: number }[] }) {
  const conduz = ["RH", "DIRECAO", "DIRETOR_UNIDADE"].includes(s.role); if (!apps.length) return null;
  const u = scopeUnit(s); const cfg = await getSettings(); const base = await appUrl();
  const ck = (await cookies()).get("portal_cand")?.value ?? ""; const [ckApp, ckToken] = ck.split("|");
  const ids = apps.map(a => a.id);
  const [links, docs, slots, msgs, unidades] = await Promise.all([
    sql<{ application_id: number; status: string; expira_em: string; ultimo_acesso: string | null; criado_em: string }[]>`SELECT DISTINCT ON (application_id) application_id, status, expira_em::text, ultimo_acesso::text, criado_em::text FROM candidate_portal_links WHERE application_id = ANY(${ids}) ORDER BY application_id, id DESC`,
    sql<{ id: number; application_id: number; tipo: string; status: string; motivo_recusa: string | null; anexo: number | null }[]>`SELECT d.id, d.application_id, d.tipo, d.status, d.motivo_recusa, (SELECT max(x.id) FROM attachments x WHERE x.entidade='candidate_doc' AND x.entidade_id=d.id) AS anexo FROM candidate_doc_requests d WHERE d.application_id = ANY(${ids}) ORDER BY d.id`,
    sql<{ id: number; application_id: number; etapa: string; quando: string; duracao_min: number; local: string | null; status: string }[]>`SELECT id, application_id, etapa, to_char(inicio, 'DD/MM/YYYY HH24:MI') AS quando, duracao_min, local, status FROM interview_slots WHERE application_id = ANY(${ids}) AND status <> 'DESCARTADO' ORDER BY inicio`,
    sql<{ application_id: number; quando: string; texto: string; origem: string; user_nome: string | null }[]>`SELECT application_id, to_char(at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Campo_Grande', 'DD/MM HH24:MI') AS quando, texto, origem, user_nome FROM application_events WHERE application_id = ANY(${ids}) AND origem IN ('CANDIDATO','RH_PARA_CANDIDATO') ORDER BY at DESC LIMIT 60`,
    sql<{ id: number; unit_id: number }[]>`SELECT a.id, r.unit_id FROM applications a JOIN requisitions r ON r.id=a.requisition_id WHERE a.id = ANY(${ids})`,
  ]);
  const voltar = `/recrutamento/candidatos/${cid}`;
  return (
    <div id="portal" className="mt-4 space-y-4">
      {apps.map(a => { const l = links.find(x => x.application_id === a.id); const ativo = l?.status === "ATIVO" && l.expira_em >= new Date().toISOString().slice(0, 10);
        const encerrada = ["REPROVADO", "DESISTIU", "CONTRATADO"].includes(a.etapa); const podeAqui = conduz && (u === null || unidades.find(x => x.id === a.id)?.unit_id === u);
        const ds = docs.filter(d => d.application_id === a.id), ss = slots.filter(x => x.application_id === a.id), ms = msgs.filter(m => m.application_id === a.id);
        return (
          <Card key={a.id} title={`Portal do candidato — ${a.vaga}`} actions={<Badge v={ativo ? "APROVADA" : "CANCELADA"} label={ativo ? `link ativo até ${fmtData(l!.expira_em)}` : l ? "link encerrado" : "sem link"} />}>
            {ckApp === String(a.id) && ckToken && <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 p-2 text-xs"><p className="font-medium text-ok">Link pessoal gerado — copie agora e envie ao candidato:</p><p className="mt-1 break-all font-mono">{`${base}/candidatura/${ckToken}`}</p><Copiar texto={`${base}/candidatura/${ckToken}`} /></div>}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="space-y-2 text-sm"><h4 className="text-xs font-semibold text-slate-600">Link pessoal</h4>
                <p className="text-xs text-slate-600">{l ? <>Criado em {fmtData(l.criado_em.slice(0, 10))}{l.ultimo_acesso ? ` · último acesso ${fmtData(l.ultimo_acesso.slice(0, 10))}` : " · ainda não aberto"}</> : "O candidato acompanha a candidatura, envia documentos e escolhe o horário da entrevista."}</p>
                {podeAqui && !encerrada && <form action={gerarLinkCandidato} className="flex flex-wrap items-end gap-2"><input type="hidden" name="applicationId" value={a.id} /><input type="hidden" name="voltar" value={voltar} /><Field label="Validade (dias)"><Input name="dias" type="number" min={1} max={120} defaultValue={cfg.recrutamento.portal?.validadeDias ?? 30} className="!w-20" /></Field><Btn small>{l ? "Gerar novo link" : "Gerar link"}</Btn></form>}
                {podeAqui && ativo && <form action={revogarLinkCandidato}><input type="hidden" name="applicationId" value={a.id} /><input type="hidden" name="voltar" value={voltar} /><Btn small kind="ghost">Revogar link</Btn></form>}
              </div>
              <div className="space-y-2 text-sm"><h4 className="text-xs font-semibold text-slate-600">Documentos</h4>
                {ds.length === 0 ? <p className="text-xs text-slate-500">Nenhum documento pedido.</p> : <ul className="space-y-1">{ds.map(d => <li key={d.id} className="flex flex-wrap items-center justify-between gap-1 text-xs"><span>{d.tipo}{d.motivo_recusa && d.status === "RECUSADO" ? <span className="block text-aviso">{d.motivo_recusa}</span> : null}</span><span className="flex items-center gap-1">{d.anexo && <a className="text-acao underline" href={`/api/anexos/${d.anexo}`} target="_blank" rel="noreferrer">abrir</a>}<Badge v={DOC_STATUS[d.status]?.[0] ?? "NEUTRO"} label={DOC_STATUS[d.status]?.[1] ?? d.status} />
                  {podeAqui && d.status === "ENVIADO" && <Modal label="Conferir" title={`Conferir: ${d.tipo}`}><form action={conferirDocumentoCandidato} className="space-y-2"><input type="hidden" name="docId" value={d.id} /><input type="hidden" name="voltar" value={voltar} /><Field label="Se recusar: o que mudar (o candidato vê)"><Textarea name="motivo" className="min-h-[50px]" /></Field><div className="flex gap-2"><Btn small name="decisao" value="ACEITO">Aceitar</Btn><Btn small kind="ghost" name="decisao" value="RECUSADO">Pedir outro arquivo</Btn></div></form></Modal>}</span></li>)}</ul>}
                {podeAqui && !encerrada && <Modal label="Pedir documentos" title="Pedir documentos pelo portal"><form action={pedirDocumentosCandidato} className="space-y-2"><input type="hidden" name="applicationId" value={a.id} /><input type="hidden" name="voltar" value={voltar} />
                  {(cfg.recrutamento.portal?.documentos as string[] ?? []).map(t => <label key={t} className="flex items-center gap-2 text-xs"><input type="checkbox" name="tipos" value={t} /> {t}</label>)}
                  <Field label="Outro documento"><Input name="outro" placeholder="Ex.: Registro no conselho profissional" /></Field><p className="text-[11px] text-slate-500">Peça só o necessário para a etapa (LGPD). Os arquivos ficam restritos ao RH.</p><Btn small>Pedir</Btn></form></Modal>}
              </div>
              <div className="space-y-2 text-sm"><h4 className="text-xs font-semibold text-slate-600">Entrevista</h4>
                {ss.length === 0 ? <p className="text-xs text-slate-500">Nenhum horário oferecido.</p> : <ul className="space-y-1">{ss.map(x => <li key={x.id} className="flex flex-wrap items-center justify-between gap-1 text-xs"><span>{x.quando} · {x.duracao_min} min{x.local ? ` · ${x.local}` : ""}<span className="block text-slate-500">{ETAPA_LABEL[x.etapa] ?? x.etapa}</span></span><span className="flex items-center gap-1"><Badge v={SLOT_STATUS[x.status]?.[0] ?? "NEUTRO"} label={SLOT_STATUS[x.status]?.[1] ?? x.status} />{podeAqui && ["OFERECIDO", "ESCOLHIDO"].includes(x.status) && <form action={cancelarHorario}><input type="hidden" name="slotId" value={x.id} /><input type="hidden" name="voltar" value={voltar} /><button className="text-erro underline">cancelar</button></form>}</span></li>)}</ul>}
                {podeAqui && !encerrada && <Modal label="Oferecer horários" title={`Horários para ${ETAPA_LABEL[a.etapa] ?? a.etapa}`}><form action={oferecerHorarios} className="space-y-2"><input type="hidden" name="applicationId" value={a.id} /><input type="hidden" name="voltar" value={voltar} />
                  {[0, 1, 2, 3].map(i => <Field key={i} label={`Opção ${i + 1}`}><Input type="datetime-local" name="inicio" required={i === 0} /></Field>)}
                  <div className="grid grid-cols-2 gap-2"><Field label="Duração (min)"><Input name="duracao" type="number" defaultValue={45} /></Field><Field label="Local ou link"><Input name="local" placeholder="Unidade Carandá, sala da coordenação" /></Field></div><Btn small>Oferecer</Btn></form></Modal>}
              </div>
            </div>
            <div className="mt-4 border-t border-line pt-3"><h4 className="text-xs font-semibold text-slate-600">Conversa registrada com o candidato</h4>
              {ms.length === 0 ? <p className="mt-1 text-xs text-slate-500">Nenhuma mensagem.</p> : <ul className="mt-2 space-y-1 text-xs">{ms.slice(0, 12).map((m, i) => <li key={i} className={`rounded px-2 py-1 ${m.origem === "CANDIDATO" ? "bg-mist" : "border border-sky-200 bg-sky-50"}`}><span className="text-slate-500">{m.quando} · {m.origem === "CANDIDATO" ? "candidato" : `RH (${m.user_nome ?? ""})`}</span> — <span className="[overflow-wrap:anywhere]">{m.texto.replace(/^Mensagem( do RH)?: /, "")}</span></li>)}</ul>}
              {podeAqui && !encerrada && <form action={responderCandidato} className="mt-2 flex flex-wrap items-end gap-2"><input type="hidden" name="applicationId" value={a.id} /><input type="hidden" name="voltar" value={voltar} /><Field label="Mensagem ao candidato" className="min-w-0 flex-1"><Input name="texto" required minLength={5} maxLength={1000} /></Field><Btn small kind="ghost">Enviar</Btn></form>}
            </div>
          </Card>); })}
    </div>
  );
}
