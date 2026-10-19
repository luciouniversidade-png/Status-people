import type { Metadata } from "next";
import { sql } from "@/db";
import { fmtData, getSettings } from "@/lib/utils";
import { textoErro } from "@/lib/aviso";
import { ETAPA_LABEL } from "@/lib/talento";
import { contextoPortal, DOC_STATUS } from "@/lib/portal-candidato";
import { enviarDocumentoCandidato, escolherHorarioCandidato, mensagemCandidato, retirarCandidatura, pedirExclusaoCandidato } from "../actions";
import { Btn } from "@/components/Btn";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Minha candidatura · Colégio Status", robots: { index: false, follow: false } };
const inp = "w-full rounded-md border border-line bg-white px-3 py-2.5 text-base text-ink focus:border-acao focus:outline-none focus:ring-1 focus:ring-acao sm:text-sm";
const OK: Record<string, string> = { doc: "Documento enviado. O RH confere e avisa por aqui se precisar de outro arquivo.", horario: "Horário confirmado. Até lá!", msg: "Mensagem enviada ao RH.", retirada: "Candidatura retirada. Obrigado pelo interesse no Colégio Status.", exclusao: "Pedido de exclusão registrado." };

/** T-106 · Portal do candidato (externo): acompanhar a própria candidatura, enviar documentos, escolher horário, conversar com o RH. */
export default async function MinhaCandidatura({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await params; const sp = await searchParams;
  const Shell = ({ children }: { children: React.ReactNode }) => <main className="min-h-screen bg-mist px-3 py-6 sm:px-4 sm:py-8"><div className="mx-auto max-w-2xl rounded-lg border border-line bg-white p-4 shadow-sm sm:p-6"><div className="mb-4 border-b border-line pb-3 text-xs font-semibold uppercase tracking-wide text-navy">Colégio Status · Trabalhe conosco</div>{children}</div></main>;
  let c; try { c = await contextoPortal(token); } catch (e) { return <Shell><h1 className="text-xl font-semibold text-navy">Link indisponível</h1><p className="mt-2 text-sm text-slate-600">{e instanceof Error ? e.message : "Link inválido."}</p></Shell>; }
  const cfg = await getSettings(); const etapas = [...cfg.recrutamento.etapas] as string[];
  const [docs, slots, msgs] = await Promise.all([
    sql<{ id: number; tipo: string; status: string; motivo_recusa: string | null; enviado_em: string | null }[]>`SELECT id, tipo, status, motivo_recusa, enviado_em::text FROM candidate_doc_requests WHERE application_id=${c.applicationId} ORDER BY id`,
    sql<{ id: number; etapa: string; inicio: string; quando: string; duracao_min: number; local: string | null; status: string }[]>`SELECT id, etapa, inicio::text, to_char(inicio, 'DD/MM/YYYY "às" HH24:MI') AS quando, duracao_min, local, status FROM interview_slots WHERE application_id=${c.applicationId} AND status IN ('OFERECIDO','ESCOLHIDO') AND (status='ESCOLHIDO' OR (inicio AT TIME ZONE 'America/Campo_Grande') > now()) ORDER BY inicio`,
    sql<{ at: string; quando: string; texto: string; origem: string }[]>`SELECT at::text, to_char(at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Campo_Grande', 'DD/MM HH24:MI') AS quando, texto, origem FROM application_events WHERE application_id=${c.applicationId} AND origem IN ('CANDIDATO','RH_PARA_CANDIDATO') ORDER BY at DESC LIMIT 30`,
  ]);
  const pos = etapas.indexOf(c.etapa); const encerrada = c.retirada || ["REPROVADO", "DESISTIU", "CONTRATADO"].includes(c.etapa);
  const erro = textoErro(sp);
  return (
    <Shell>
      <h1 className="text-xl font-semibold text-navy">Olá, {c.nome.split(" ")[0]}</h1>
      <p className="mt-1 text-sm text-slate-600">Sua candidatura para <b>{c.vaga}</b> · {c.unidade}. Link pessoal válido até {fmtData(c.expira_em)} — não compartilhe.</p>
      {sp.ok && OK[sp.ok] && <p role="status" className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-ok">{OK[sp.ok]}{sp.ok === "exclusao" && sp.protocolo ? ` Protocolo: ${sp.protocolo}. A resposta chega pelo seu contato em até ${cfg.privacidade.prazoPedidoDias} dias.` : ""}</p>}
      {erro && <p role="alert" className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-erro">{erro}</p>}
      <section className="mt-5"><h2 className="text-sm font-semibold text-navy">Onde está sua candidatura</h2>
        {c.retirada || c.etapa === "DESISTIU" ? <p className="mt-2 text-sm">Candidatura retirada.</p> : c.etapa === "REPROVADO" ? <p className="mt-2 text-sm">O processo para esta vaga foi encerrado para você. Agradecemos a participação — seus dados podem ser considerados para próximas vagas, se você autorizou.</p> :
          <ol className="mt-2 grid grid-cols-2 gap-1.5 text-xs sm:grid-cols-3">{etapas.map((et, i) => <li key={et} className={`rounded border px-2 py-1.5 ${i < pos ? "border-emerald-200 bg-emerald-50 text-ok" : i === pos ? "border-acao bg-sky-50 font-semibold text-navy" : "border-line text-slate-500"}`}>{i < pos ? "✓ " : i === pos ? "● " : ""}{ETAPA_LABEL[et] ?? et}</li>)}</ol>}
      </section>
      {!encerrada && docs.length > 0 && <section className="mt-6"><h2 className="text-sm font-semibold text-navy">Documentos pedidos</h2>
        <ul className="mt-2 space-y-2">{docs.map(d => <li key={d.id} className="rounded border border-line p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{d.tipo}</span><span className="text-xs text-slate-600">{DOC_STATUS[d.status]?.[1] ?? d.status}</span></div>
          {d.status === "RECUSADO" && d.motivo_recusa && <p className="mt-1 text-xs text-aviso">O RH pediu outro arquivo: {d.motivo_recusa}</p>}
          {["PENDENTE", "RECUSADO"].includes(d.status) && <form action={enviarDocumentoCandidato} className="mt-2 flex flex-wrap items-center gap-2"><input type="hidden" name="token" value={token} /><input type="hidden" name="docId" value={d.id} /><input type="file" name="arquivo" required accept=".pdf,.jpg,.jpeg,.png" className="block min-w-0 flex-1 text-xs" aria-label={`Arquivo: ${d.tipo}`} /><Btn small>Enviar</Btn></form>}</li>)}</ul>
        <p className="mt-1 text-[11px] text-slate-500">PDF, JPG ou PNG, até {cfg.plataforma.anexoMaxMb} MB. Os arquivos ficam restritos ao RH da escola.</p></section>}
      {!encerrada && slots.length > 0 && <section className="mt-6"><h2 className="text-sm font-semibold text-navy">Entrevista</h2>
        {slots.some(x => x.status === "ESCOLHIDO") ? <ul className="mt-2 space-y-1 text-sm">{slots.filter(x => x.status === "ESCOLHIDO").map(x => <li key={x.id} className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2">Confirmada: <b>{x.quando}</b> ({x.duracao_min} min){x.local ? ` · ${x.local}` : ""} — {ETAPA_LABEL[x.etapa] ?? x.etapa}</li>)}</ul> :
          <form action={escolherHorarioCandidato} className="mt-2 space-y-2"><input type="hidden" name="token" value={token} /><p className="text-xs text-slate-600">Escolha um dos horários oferecidos:</p>
            {slots.map((x, i) => <label key={x.id} className="flex items-start gap-2 rounded border border-line px-3 py-2 text-sm"><input type="radio" name="slotId" value={x.id} defaultChecked={i === 0} className="mt-1" /><span>{x.quando} ({x.duracao_min} min){x.local ? <span className="block text-xs text-slate-500">{x.local}</span> : null}</span></label>)}
            <Btn small>Confirmar horário</Btn></form>}
      </section>}
      <section className="mt-6"><h2 className="text-sm font-semibold text-navy">Mensagens com o RH</h2>
        {!encerrada && <form action={mensagemCandidato} className="mt-2 space-y-2"><input type="hidden" name="token" value={token} /><textarea name="texto" required minLength={5} maxLength={1000} className={`${inp} min-h-[80px]`} placeholder="Dúvida, pedido de remarcação, aviso…" aria-label="Mensagem" /><Btn small>Enviar mensagem</Btn></form>}
        {msgs.length > 0 ? <ul className="mt-3 space-y-1.5 text-sm">{msgs.map((m, i) => <li key={i} className={`rounded px-3 py-2 ${m.origem === "CANDIDATO" ? "bg-mist" : "border border-sky-200 bg-sky-50"}`}><span className="text-[11px] text-slate-500">{m.quando} · {m.origem === "CANDIDATO" ? "você" : "RH do Colégio Status"}</span><div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.texto.replace(/^Mensagem( do RH)?: /, "")}</div></li>)}</ul> : <p className="mt-2 text-xs text-slate-500">Nenhuma mensagem ainda.</p>}
      </section>
      {!encerrada && <details className="mt-6 rounded border border-line p-3 text-sm"><summary className="cursor-pointer font-medium text-navy">Retirar minha candidatura</summary>
        <form action={retirarCandidatura} className="mt-2 space-y-2"><input type="hidden" name="token" value={token} /><input name="motivo" maxLength={300} className={inp} placeholder="Motivo (opcional)" aria-label="Motivo" /><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="confirmo" value="1" /> Quero retirar minha candidatura para esta vaga</label><Btn small>Retirar</Btn></form></details>}
      <section className="mt-6 rounded border border-line bg-mist p-3 text-xs text-slate-600"><h2 className="font-semibold text-navy">Seus dados (LGPD)</h2>
        <p className="mt-1">Usamos seus dados só para este processo seletivo{cfg.recrutamento.portal?.retencaoMeses ? ` e os guardamos por até ${cfg.recrutamento.portal.retencaoMeses} meses se você não for contratado(a)` : ""}. Você pode pedir a exclusão a qualquer momento.</p>
        {c.exclusao ? <p className="mt-2 font-medium">Pedido de exclusão registrado em {fmtData(c.exclusao.slice(0, 10))}.</p> : <form action={pedirExclusaoCandidato} className="mt-2"><input type="hidden" name="token" value={token} /><button className="text-acao underline">Pedir a exclusão dos meus dados</button></form>}
      </section>
    </Shell>
  );
}
