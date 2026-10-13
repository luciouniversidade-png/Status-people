import Link from "@/components/Link";
import { Modal } from "@/components/Modal";
import { notFound } from "next/navigation";
import { requireGestao, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge, Flash, Field, Input, Select, Textarea, Btn } from "@/components/ui";
import { fmtData, getSettings, hoje } from "@/lib/utils";
import { resumoRituais } from "@/lib/metricas-extra";
import { pautaAutomatica } from "@/lib/gestao-estrategica";
import { RITUAL_TIPO, aderenciaRitual } from "@/lib/gestao-calc";
import { registrarReuniao } from "../../gestao-actions";
import { SubNav, corFaixa } from "../../_ui";
import { FormRitual, opcoesRitual } from "../_form";

export const dynamic = "force-dynamic";

export default async function Ritual({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireGestao(); const { id } = await params; const sp = await searchParams; const rid = Number(id); if (!Number.isInteger(rid)) notFound();
  const u = scopeUnit(s); const cfg = await getSettings(); const h = hoje(); const faixas = cfg.estrategia.faixasSaude as [number, number];
  const r = (await resumoRituais(u)).lista.find(x => x.id === rid); if (!r) notFound();
  const ESTR = ["DIRECAO", "RH"].includes(s.role); const podeGerir = ESTR || r.dono_user_id === s.id || (s.role === "DIRETOR_UNIDADE" && r.unit_id !== null && r.unit_id === s.unitId);
  const podeRegistrar = podeGerir || (r.participantes ?? []).includes(s.id);
  const [pauta, reunioes, users, opcoes] = await Promise.all([pautaAutomatica(r, u),
    sql<{ id: number; data: string; status: string; presentes: number[] | null; ata: boolean; cancel_motivo: string | null; decisoes: number; encaminhamentos: number; abertos: number }[]>`SELECT m.id, m.data::text, m.status, m.presentes, coalesce(trim(m.ata),'') <> '' AS ata, m.cancel_motivo, (SELECT count(*) FROM decisions d WHERE d.ritual_meeting_id=m.id)::int AS decisoes, (SELECT count(*) FROM action_plans a WHERE a.ritual_meeting_id=m.id)::int AS encaminhamentos, (SELECT count(*) FROM action_plans a WHERE a.ritual_meeting_id=m.id AND a.status IN ('A_FAZER','EM_ANDAMENTO','BLOQUEADA'))::int AS abertos FROM ritual_meetings m WHERE m.ritual_id=${rid} ORDER BY m.data DESC, m.id DESC LIMIT 40`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM users WHERE ativo AND role NOT IN ('LEITURA','COLABORADOR') ORDER BY nome`,
    podeGerir ? opcoesRitual(s) : null]);
  const nome = new Map(users.map(x => [x.id, x.nome])); const participantes = [...new Set([...(r.dono_user_id ? [r.dono_user_id] : []), ...(r.participantes ?? [])])];
  const ad = aderenciaRitual(r.realizadas_janela, r.tipo, r.criado_dias); const dataPadrao = r.proxima_data && r.proxima_data <= h ? r.proxima_data : h;
  const enc = (k: number) => <div key={k} className="grid grid-cols-2 gap-1.5 sm:grid-cols-[minmax(0,1fr)_9rem_8.5rem]"><Input name={`enc_titulo_${k}`} placeholder={`Encaminhamento ${k + 1}`} aria-label={`Encaminhamento ${k + 1}`} className="col-span-2 sm:col-span-1" /><Select name={`enc_resp_${k}`} aria-label="Responsável" defaultValue=""><option value="">responsável</option>{users.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select><Input name={`enc_prazo_${k}`} type="date" aria-label="Prazo" /></div>;
  return (
    <Page title={r.nome} sub={<span className="flex flex-wrap items-center gap-2">{RITUAL_TIPO[r.tipo]} · {r.unidade ?? "rede"} · dono: {r.dono ?? "—"}{r.duracao_min ? ` · ${r.duracao_min} min` : ""} · próxima: <b>{fmtData(r.proxima_data) || "—"}</b> {r.ativo ? (r.situacao === "ATRASADO" ? <Badge v="REJEITADA" label="atrasado" /> : <Badge v="APROVADA" label="em dia" />) : <Badge v="CANCELADA" label="inativo" />}</span>}
      actions={<>{podeGerir && opcoes && <Modal label="Editar ritual" small={false} title="Editar ritual"><FormRitual o={opcoes} r={r} donoPadrao={s.id} /></Modal>}<Btn kind="ghost" href="/estrategia/rituais">Rituais</Btn></>}>
      <SubNav atual="rituais" />
      <Flash ok={sp.ok} erro={sp.erro} />
      {r.finalidade && <p className="mb-3 text-sm text-slate-700">{r.finalidade}</p>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-4">
          <Card title="Pauta automática da próxima reunião" actions={<span className="text-xs text-slate-500">gerada agora</span>}>
            {pauta.itens.length === 0 ? <p className="text-sm text-slate-500">Sem itens: defina a pauta padrão, os indicadores e os objetivos revisados no ritual.</p> :
              <div className="space-y-3">{pauta.itens.map((it, k) => <div key={k}><div className="text-sm font-semibold text-navy">{it.titulo}</div><ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-sm text-slate-700">{it.linhas.map((l, j) => <li key={j} className={/VENCIDA|Fora do alvo|medição atrasada/.test(l) ? "text-erro" : ""}>{l}</li>)}</ul></div>)}</div>}
            <p className="mt-3 text-xs text-slate-500">Encaminhamentos em aberto das reuniões anteriores, indicadores e objetivos revisados pelo ritual, decisões com revisão nos próximos 30 dias e a pauta padrão.</p>
          </Card>
          <Card title="Participação e aderência"><div className="grid grid-cols-3 gap-3 text-center"><div><div className={`text-2xl font-semibold tabular-nums ${corFaixa(ad.pct, faixas)}`}>{ad.pct === null ? "—" : `${ad.pct}%`}</div><div className="text-[11px] text-slate-500">aderência ({r.realizadas_janela} de {ad.esperadas} esperada(s))</div></div><div><div className="text-2xl font-semibold tabular-nums text-navy">{fmtData(r.ultima) || "—"}</div><div className="text-[11px] text-slate-500">última realizada</div></div><div><div className={`text-2xl font-semibold tabular-nums ${r.ata_pendente ? "text-aviso" : "text-navy"}`}>{r.ata_pendente}</div><div className="text-[11px] text-slate-500">ata(s) pendente(s)</div></div></div>
            <div className="mt-3 text-xs text-slate-600"><b>Participantes:</b> {participantes.map(p => nome.get(p) ?? `#${p}`).join(", ") || "—"}</div>
            <p className="mt-1 text-[11px] text-slate-500">Aderência = reuniões realizadas ÷ esperadas pela cadência nos últimos 90 dias (ou desde a criação do ritual). Sem reunião esperada ainda: sem base.</p></Card>
          <Card title="Histórico de reuniões"><Table head={["Data", "Situação", "Presentes", "Ata", "Decisões", "Encaminhamentos"]} empty="Nenhuma reunião registrada.">{reunioes.map(m => <tr key={m.id}><Td className="whitespace-nowrap"><Link className="text-acao" href={`/estrategia/reunioes/${m.id}`}>{fmtData(m.data)}</Link></Td><Td>{m.status === "REALIZADA" ? <Badge v="APROVADA" label="Realizada" /> : <><Badge v="CANCELADA" label="Cancelada" /><div className="text-[11px] text-slate-500">{m.cancel_motivo}</div></>}</Td><Td className="text-xs">{m.status === "REALIZADA" ? (m.presentes ?? []).length : "—"}</Td><Td className={`text-xs ${m.status === "REALIZADA" && !m.ata ? "text-aviso" : ""}`}>{m.status !== "REALIZADA" ? "—" : m.ata ? "registrada" : "pendente"}</Td><Td className="text-xs">{m.decisoes || "—"}</Td><Td className="text-xs">{m.encaminhamentos ? `${m.encaminhamentos}${m.abertos ? ` (${m.abertos} aberto(s))` : ""}` : "—"}</Td></tr>)}</Table></Card>
        </div>
        {podeRegistrar && r.ativo && <Card title="Registrar reunião"><form action={registrarReuniao} className="space-y-2"><input type="hidden" name="ritualId" value={rid} />
          <div className="grid grid-cols-2 gap-2"><Field label="Data"><Input name="data" type="date" required defaultValue={dataPadrao} /></Field><Field label="Situação"><Select name="status" defaultValue="REALIZADA"><option value="REALIZADA">Realizada</option><option value="CANCELADA">Cancelada (não aconteceu)</option></Select></Field></div>
          <Field label="Motivo do cancelamento" hint="Só para reunião cancelada."><Input name="cancelMotivo" /></Field>
          <div><div className="mb-1 text-sm font-medium text-slate-700">Presentes</div><div className="max-h-36 space-y-0.5 overflow-y-auto rounded-md border border-line p-2 text-xs">{participantes.map(p => <label key={p} className="flex items-center gap-1.5"><input type="checkbox" name="presentes" value={p} defaultChecked /> {nome.get(p) ?? `#${p}`}</label>)}</div></div>
          <Field label="Pauta" hint="Já vem com a pauta automática — ajuste o que for tratado."><Textarea name="pauta" defaultValue={pauta.texto} className="min-h-[140px] text-xs" /></Field>
          <Field label="Ata" hint="O que foi discutido. Pode ser registrada depois, na página da reunião."><Textarea name="ata" className="min-h-[90px]" /></Field>
          <Field label="Decisões" hint="Uma por linha — cada uma vai para o Decision Log."><Textarea name="decisoes" className="min-h-[60px]" /></Field>
          <Field label="Área das decisões"><Select name="areaDecisao" defaultValue="Direção e Governança">{(cfg.governanca.areas as string[]).map(a => <option key={a}>{a}</option>)}</Select></Field>
          <div><div className="mb-1 text-sm font-medium text-slate-700">Encaminhamentos <span className="font-normal text-slate-500">(entram no plano de ação, com responsável e prazo)</span></div>
            <div className="space-y-1.5">{[0, 1, 2].map(enc)}</div>
            <details className="mt-1.5"><summary className="cursor-pointer text-xs text-acao">mais encaminhamentos</summary><div className="mt-1.5 space-y-1.5">{[3, 4, 5].map(enc)}</div></details></div>
          <Btn pendingText="Registrando…">Registrar reunião</Btn>
          <p className="text-xs text-slate-500">Ao registrar, a próxima data é calculada pela cadência ({RITUAL_TIPO[r.tipo].toLowerCase()}) e os indicadores revisados ficam fotografados na reunião.</p>
        </form></Card>}
      </div>
    </Page>
  );
}
