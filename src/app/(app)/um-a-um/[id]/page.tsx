// v31 · uma 1:1: pauta compartilhada, remarcar, cancelar, adicionar à agenda e registrar como realizada (combinados → acompanhamento).
import Link from "@/components/Link";
import { requireSession } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Badge, Flash, Field, Input, Textarea, Btn } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { hoje, fmtData, fmtDataHora } from "@/lib/utils";
import { umAUm, participa, proximaData, STATUS_1A1, TOM_1A1, RECORRENCIA } from "@/lib/conversas";
import { remarcarUmAUm, cancelarUmAUm, adicionarPauta, marcarPauta, registrarUmAUm } from "../actions";

export const dynamic = "force-dynamic";

export default async function DetalheUmAUm({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession(); const { id } = await params; const sp = await searchParams; const h = hoje();
  const o = await umAUm(Number(id));
  if (!o || !participa(s, o)) return <Page title="1:1"><Card><p className="text-sm text-slate-600">1:1 não encontrada. A pauta e os combinados de uma 1:1 ficam só com as duas pessoas da conversa.</p><p className="mt-2 text-sm"><Link className="text-acao" href="/um-a-um">Voltar para as minhas 1:1</Link></p></Card></Page>;
  const souOrg = o.organizador_user_id === s.id; const com = souOrg ? o.nome : o.organizador_nome ?? "—"; const aberta = o.status === "MARCADA";
  const serie = await sql<{ id: number; data: string; status: string }[]>`WITH RECURSIVE ant AS (SELECT id, anterior_id, data, status FROM one_on_ones WHERE id=${o.id} UNION ALL SELECT x.id, x.anterior_id, x.data, x.status FROM one_on_ones x JOIN ant ON x.id=ant.anterior_id) SELECT id, data::text, status FROM ant WHERE id<>${o.id} ORDER BY data DESC LIMIT 6`;
  const [ck] = o.checkin_id ? await sql<{ combinados: string | null; compromisso_gestor: string | null; compromisso_colaborador: string | null; compromisso_prazo: string | null; bloqueio: string | null }[]>`SELECT combinados, compromisso_gestor, compromisso_colaborador, compromisso_prazo::text, bloqueio FROM perf_checkins WHERE id=${o.checkin_id}` : [];
  const prox = proximaData(o.data, o.recorrencia);
  return (
    <Page title={o.titulo} sub={<span className="flex flex-wrap items-center gap-2"><Badge v={aberta && o.data < h ? "PENDENTE" : TOM_1A1[o.status]} label={aberta && o.data < h ? "falta registrar" : STATUS_1A1[o.status]} /> com <b>{com}</b> · {fmtData(o.data)} · {o.inicio} às {o.fim} · {RECORRENCIA[o.recorrencia]} · <Link className="text-acao" href="/um-a-um?aba=agenda">minhas 1:1</Link></span>}
      actions={<div className="flex flex-wrap gap-2"><a className="inline-flex items-center rounded-md border border-line bg-white px-3.5 py-2 text-sm font-medium text-navy hover:bg-mist" href={`/api/um-a-um/${o.id}/ics`}>Adicionar à agenda (.ics)</a>{aberta && <Modal label="Remarcar" title="Remarcar 1:1"><form action={remarcarUmAUm} className="space-y-2"><input type="hidden" name="id" value={o.id} /><div className="grid grid-cols-3 gap-2"><Field label="Data"><Input name="data" type="date" min={h} defaultValue={o.data >= h ? o.data : h} required /></Field><Field label="Início"><Input name="inicio" type="time" defaultValue={o.inicio} required /></Field><Field label="Término"><Input name="fim" type="time" defaultValue={o.fim} required /></Field></div><Btn small>Remarcar e avisar</Btn></form></Modal>}{aberta && <Modal label="Cancelar" kind="danger" title="Cancelar 1:1"><form action={cancelarUmAUm} className="space-y-2"><input type="hidden" name="id" value={o.id} /><Field label="Motivo (vai para o histórico)"><Input name="motivo" required minLength={5} /></Field><Btn small danger>Cancelar a 1:1</Btn></form></Modal>}</div>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {o.temas.length > 0 && <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Temas">{o.temas.map(t => <span key={t} className="rounded-full border border-acao bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-acao">{t}</span>)}</div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="space-y-4">
          <Card title={`Pauta (${o.pauta.length})`}><div id="pauta" />
            {o.pauta.length === 0 ? <p className="text-sm text-slate-500">Nenhum ponto ainda. Os dois podem incluir — vale chegar à conversa com a pauta pronta.</p> : <ul className="space-y-1.5">{o.pauta.map(p => <li key={p.id} className="flex items-start gap-2 rounded-md border border-line px-2 py-1.5 text-sm">
              {aberta ? <form action={marcarPauta}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="item" value={p.id} /><button aria-label={p.feito ? "Marcar como não conversado" : "Marcar como conversado"} className={`mt-0.5 grid h-5 w-5 place-items-center rounded border text-[11px] ${p.feito ? "border-ok bg-emerald-50 text-ok" : "border-line bg-white text-transparent hover:text-slate-400"}`}>✓</button></form> : <span className={`mt-0.5 grid h-5 w-5 place-items-center rounded border text-[11px] ${p.feito ? "border-ok bg-emerald-50 text-ok" : "border-line text-transparent"}`}>✓</span>}
              <div className="min-w-0 flex-1"><div className={p.feito ? "text-slate-500 line-through" : "text-ink"}>{p.texto}</div><div className="text-[11px] text-slate-500">{p.autor} · {fmtDataHora(p.em)}</div></div>
              {aberta && (p.autorId ?? -1) === s.id && <form action={marcarPauta}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="item" value={p.id} /><input type="hidden" name="remover" value="1" /><button className="text-[11px] text-slate-400 hover:text-erro" aria-label="Remover o ponto">remover</button></form>}
            </li>)}</ul>}
            {aberta && <form action={adicionarPauta} className="mt-3 flex flex-wrap items-end gap-2"><input type="hidden" name="id" value={o.id} /><Field label="Novo ponto de pauta" className="min-w-0 flex-1"><Input name="texto" required minLength={3} maxLength={300} placeholder="Ex.: preciso de apoio com a turma do 7º B" /></Field><Btn small>Incluir</Btn></form>}
          </Card>
          {o.status === "REALIZADA" && ck && <Card title="Combinados (registrados no acompanhamento)"><dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2"><div className="sm:col-span-2"><dt className="text-xs font-medium text-slate-500">Combinados</dt><dd className="whitespace-pre-wrap">{ck.combinados}</dd></div>{ck.compromisso_gestor && <div><dt className="text-xs font-medium text-slate-500">Compromisso do gestor</dt><dd>{ck.compromisso_gestor}</dd></div>}{ck.compromisso_colaborador && <div><dt className="text-xs font-medium text-slate-500">Compromisso do colaborador</dt><dd>{ck.compromisso_colaborador}</dd></div>}{ck.compromisso_prazo && <div><dt className="text-xs font-medium text-slate-500">Prazo</dt><dd>{fmtData(ck.compromisso_prazo)}</dd></div>}{ck.bloqueio && <div><dt className="text-xs font-medium text-slate-500">Bloqueio</dt><dd>{ck.bloqueio}</dd></div>}</dl><p className="mt-2 text-[11px] text-slate-500">Os combinados ficam também no painel do colaborador (aba Acompanhamento) — é o que conta para “acompanhamento em dia”.</p></Card>}
          {o.status === "CANCELADA" && <Card title="Cancelada"><p className="text-sm">{o.motivo_cancelamento}</p></Card>}
        </div>
        <div className="space-y-4">
          {aberta && <Card title="Registrar como realizada">{o.data > h ? <p className="text-sm text-slate-500">Disponível a partir do dia da conversa ({fmtData(o.data)}).</p> : <form action={registrarUmAUm} className="space-y-2"><input type="hidden" name="id" value={o.id} />
            <Field label="O que foi combinado *"><Textarea name="combinados" required minLength={5} className="min-h-[70px]" /></Field>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Field label="Compromisso do gestor"><Input name="compromissoGestor" /></Field><Field label="Compromisso do colaborador"><Input name="compromissoColaborador" /></Field></div>
            <div className="grid grid-cols-2 gap-2"><Field label="Prazo dos compromissos"><Input name="compromissoPrazo" type="date" /></Field><Field label="Bloqueio (se houver)"><Input name="bloqueio" /></Field></div>
            <div className="rounded-md bg-mist p-2"><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="marcarProxima" value="1" defaultChecked={o.recorrencia !== "NENHUMA"} /> Já marcar a próxima 1:1 (mesmo horário)</label><Field label="Data da próxima" className="mt-1"><Input name="proximaData" type="date" defaultValue={prox ?? ""} /></Field></div>
            {o.pauta.length > 0 && <label className="flex items-start gap-2 text-xs"><input type="checkbox" name="levarPauta" value="1" className="mt-0.5" /><span>Levar os pontos da pauta para o acompanhamento do painel (a gestão da pessoa vê). Sem marcar, a pauta fica só com vocês dois.</span></label>}
            <Btn>Registrar</Btn><p className="text-[11px] text-slate-500">Os combinados e os compromissos entram no acompanhamento do painel do colaborador (aba Acompanhamento) — é o que conta para “acompanhamento em dia”.</p></form>}</Card>}
          <Card title="Quem e quando"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-2"><dt className="text-slate-500">Marcada por</dt><dd>{o.organizador_nome ?? "—"}</dd></div><div className="flex justify-between gap-2"><dt className="text-slate-500">Convidado</dt><dd>{o.nome}</dd></div><div className="flex justify-between gap-2"><dt className="text-slate-500">Repetição</dt><dd>{RECORRENCIA[o.recorrencia]}</dd></div>{o.realizada_em && <div className="flex justify-between gap-2"><dt className="text-slate-500">Registrada em</dt><dd>{fmtDataHora(o.realizada_em)}</dd></div>}</dl>
            {serie.length > 0 && <><h3 className="mt-3 text-xs font-semibold text-slate-600">Conversas anteriores da série</h3><ul className="mt-1 space-y-0.5 text-xs">{serie.map(x => <li key={x.id}><Link className="text-acao" href={`/um-a-um/${x.id}`}>{fmtData(x.data)}</Link> · {STATUS_1A1[x.status]}</li>)}</ul></>}
            {!o.convidado_user_id && souOrg && <p className="mt-2 text-[11px] text-aviso">{o.nome} ainda não tem acesso ao ONE: a 1:1 fica na sua agenda; envie o convite (.ics) por e-mail ou combine pessoalmente.</p>}
          </Card>
        </div>
      </div>
    </Page>
  );
}
