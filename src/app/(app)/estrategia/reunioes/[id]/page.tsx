import Link from "@/components/Link";
import { Modal } from "@/components/Modal";
import { PrintButton } from "@/components/PrintButton";
import { notFound } from "next/navigation";
import { requireGestao, scopeUnit } from "@/lib/auth";
import { sql } from "@/db";
import { Page, Card, Table, Td, Badge, Flash, Field, Input, Select, Textarea, Btn } from "@/components/ui";
import { fmtData, getSettings, hoje } from "@/lib/utils";
import { listarAcoes, fmtValor } from "@/lib/gestao-estrategica";
import { diasEntre, nomePeriodo, type Farol } from "@/lib/gestao-calc";
import { salvarAta, decisaoDaReuniao } from "../../gestao-actions";
import { SubNav, FarolBadge } from "../../_ui";
import { FormAcao, opcoesAcao, SituacaoAcao, MoverAcao, podeMexerAcao } from "../../acoes/_form";

export const dynamic = "force-dynamic";
type Snap = { id: number; nome: string; unit_id?: number | null; periodo: string | null; valor: number | null; unidade: string | null; farol: Farol };

export default async function Reuniao({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireGestao(); const { id } = await params; const sp = await searchParams; const mid = Number(id); if (!Number.isInteger(mid)) notFound();
  const u = scopeUnit(s); const cfg = await getSettings();
  const [m] = await sql<{ id: number; data: string; status: string; presentes: number[] | null; pauta: string | null; ata: string | null; indicadores_snapshot: Snap[] | null; cancel_motivo: string | null; ritual_id: number; ritual: string; unit_id: number | null; unidade: string | null; dono_user_id: number | null; participantes: number[] | null; criador: string | null }[]>`
    SELECT m.id, m.data::text, m.status, m.presentes, m.pauta, m.ata, m.indicadores_snapshot, m.cancel_motivo, r.id AS ritual_id, r.nome AS ritual, r.unit_id, un.nome AS unidade, r.dono_user_id, r.participantes, uc.nome AS criador
    FROM ritual_meetings m JOIN rituals r ON r.id=m.ritual_id LEFT JOIN units un ON un.id=r.unit_id LEFT JOIN users uc ON uc.id=m.created_by WHERE m.id=${mid}`;
  if (!m || (u !== null && m.unit_id !== null && m.unit_id !== u)) notFound();
  const ESTR = ["DIRECAO", "RH"].includes(s.role); const podeRegistrar = ESTR || m.dono_user_id === s.id || (s.role === "DIRETOR_UNIDADE" && m.unit_id !== null && m.unit_id === s.unitId) || (m.participantes ?? []).includes(s.id);
  const realizada = m.status === "REALIZADA"; const gestao = ["DIRECAO", "RH", "DIRETOR_UNIDADE", "GESTOR", "FINANCEIRO", "OPERACOES", "COMERCIAL"].includes(s.role);
  const [decisoes, encs, users, opAcao] = await Promise.all([
    sql<{ id: number; titulo: string; decisao: string; area: string; responsavel: string | null; revisar_em: string | null; status: string }[]>`SELECT d.id, d.titulo, d.decisao, d.area, u.nome AS responsavel, d.revisar_em::text, d.status FROM decisions d LEFT JOIN users u ON u.id=d.responsavel_user_id WHERE d.ritual_meeting_id=${mid} ORDER BY d.id`,
    listarAcoes(u, { meetingId: mid, situacao: "TODAS" }),
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM users WHERE ativo AND role NOT IN ('LEITURA','COLABORADOR') ORDER BY nome`,
    realizada && podeRegistrar && gestao ? opcoesAcao(s) : null]);
  const nome = new Map(users.map(x => [x.id, x.nome])); const ataPendente = realizada && !m.ata?.trim() && diasEntre(m.data, hoje()) > cfg.estrategia.ataPendenteDias;
  const snap = (m.indicadores_snapshot ?? []).filter(i => u === null || i.unit_id === null || i.unit_id === undefined || i.unit_id === u); // foto filtrada pelo escopo de quem vê
  return (
    <Page title={`${m.ritual} · ${fmtData(m.data)}`} sub={<span className="flex flex-wrap items-center gap-2">{realizada ? <Badge v="APROVADA" label="Realizada" /> : <Badge v="CANCELADA" label="Cancelada" />} {m.unidade ?? "rede"} · registrada por {m.criador ?? "—"}</span>}
      actions={<><PrintButton /><Btn kind="ghost" href={`/estrategia/rituais/${m.ritual_id}`}>Voltar ao ritual</Btn></>}>
      <SubNav atual="rituais" />
      <Flash ok={sp.ok} erro={sp.erro} />
      {!realizada && <Card className="mb-4"><p className="text-sm">Reunião cancelada. Motivo: <b>{m.cancel_motivo ?? "—"}</b></p></Card>}
      {realizada && <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-4">
          <Card title="Presentes"><p className="text-sm">{(m.presentes ?? []).map(p => nome.get(p) ?? `#${p}`).join(", ") || "—"}</p>{(m.participantes ?? []).filter(p => !(m.presentes ?? []).includes(p)).length > 0 && <p className="mt-1 text-xs text-slate-500">Ausentes: {(m.participantes ?? []).filter(p => !(m.presentes ?? []).includes(p)).map(p => nome.get(p) ?? `#${p}`).join(", ")}</p>}</Card>
          <Card title="Pauta"><pre className="whitespace-pre-wrap font-sans text-sm text-slate-700">{m.pauta || "—"}</pre></Card>
          <Card title="Ata" actions={ataPendente ? <Badge v="PENDENTE" label="ata pendente" /> : undefined}>
            {podeRegistrar ? <form action={salvarAta} className="space-y-2 print:hidden"><input type="hidden" name="id" value={mid} /><Textarea name="ata" defaultValue={m.ata ?? ""} className="min-h-[180px]" placeholder="O que foi discutido, com quem e o que ficou combinado" /><Btn small>{m.ata ? "Salvar correção da ata" : "Registrar ata"}</Btn></form> : null}
            <div className={podeRegistrar ? "hidden print:block" : ""}><pre className="whitespace-pre-wrap font-sans text-sm text-slate-700">{m.ata || "Ata ainda não registrada."}</pre></div>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title={`Decisões (${decisoes.length})`} actions={podeRegistrar ? <Modal label="Registrar decisão" title="Decisão da reunião"><form action={decisaoDaReuniao} className="space-y-2"><input type="hidden" name="meetingId" value={mid} />
              <Field label="Título"><Input name="titulo" required /></Field><Field label="Decisão"><Textarea name="decisao" required /></Field><Field label="Contexto"><Textarea name="contexto" className="min-h-[50px]" /></Field><Field label="Alternativas consideradas"><Textarea name="alternativas" className="min-h-[50px]" /></Field>
              <div className="grid grid-cols-2 gap-2"><Field label="Área"><Select name="area" defaultValue="Direção e Governança">{(cfg.governanca.areas as string[]).map(a => <option key={a}>{a}</option>)}</Select></Field><Field label="Revisar em"><Input name="revisarEm" type="date" /></Field></div>
              <Field label="Responsável"><Select name="responsavelUserId" defaultValue={m.dono_user_id ?? ""}><option value="">—</option>{users.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field><Btn small>Registrar no Decision Log</Btn></form></Modal> : undefined}>
            {decisoes.length === 0 ? <p className="text-sm text-slate-500">Nenhuma decisão registrada nesta reunião.</p> : <ul className="space-y-2 text-sm">{decisoes.map(d => <li key={d.id}><Link className="font-medium text-acao" href={`/governanca/decisoes`}>{d.titulo}</Link>{d.decisao !== d.titulo && <div className="text-slate-700">{d.decisao}</div>}<div className="text-xs text-slate-500">{d.area}{d.responsavel ? ` · ${d.responsavel}` : ""}{d.revisar_em ? ` · revisar em ${fmtData(d.revisar_em)}` : ""}{d.status !== "VIGENTE" ? ` · ${d.status.toLowerCase()}` : ""}</div></li>)}</ul>}
          </Card>
          <Card title={`Encaminhamentos (${encs.length})`} actions={opAcao ? <Modal label="Novo encaminhamento" title="Encaminhamento da reunião"><FormAcao o={opAcao} padrao={{ ritualMeetingId: mid, unitId: m.unit_id, origem: `Ritual: ${m.ritual}`, voltar: `/estrategia/reunioes/${mid}` }} /></Modal> : undefined}>
            <Table head={["O quê", "Quem", "Prazo", "Situação", ""]} empty="Nenhum encaminhamento.">{encs.map(a => <tr key={a.id}><Td><Link className="text-acao" href={`/estrategia/acoes/${a.id}`}>{a.titulo}</Link></Td><Td className="text-xs">{a.responsavel ?? "—"}</Td><Td className={`whitespace-nowrap text-xs ${a.vencida ? "text-erro" : ""}`}>{fmtData(a.prazo)}</Td><Td><SituacaoAcao a={a} /></Td><Td>{podeMexerAcao(s, a) ? <MoverAcao a={a} voltar={`/estrategia/reunioes/${mid}`} /> : null}</Td></tr>)}</Table>
          </Card>
          <Card title="Indicadores na data da reunião">{snap.length === 0 ? <p className="text-sm text-slate-500">O ritual não tinha indicadores revisados quando a reunião foi registrada.</p> : <Table head={["Indicador", "Valor", "Período", "Farol"]}>{snap.map(i => <tr key={i.id}><Td><Link className="text-acao" href={`/estrategia/indicadores/${i.id}`}>{i.nome}</Link></Td><Td className="whitespace-nowrap tabular-nums">{fmtValor(i.valor, i.unidade)}</Td><Td className="text-xs">{i.periodo ? nomePeriodo(i.periodo) : "—"}</Td><Td><FarolBadge f={i.farol} /></Td></tr>)}</Table>}<p className="mt-2 text-xs text-slate-500">Fotografia tirada no registro: mostra o que a reunião viu, mesmo que o valor seja corrigido depois.</p></Card>
        </div>
      </div>}
    </Page>
  );
}
