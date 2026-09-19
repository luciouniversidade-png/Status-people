import { Modal } from "@/components/Modal";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db";
import { requireStaff, scopeUnit, can } from "@/lib/auth";
import { Page, Card, Badge, Btn, Flash, Field, Input, Select, Textarea, Table, Td } from "@/components/ui";
import { fmtData, fmtDataHora, getSettings, hoje } from "@/lib/utils";
import { REQ_STATUS, REQ_TIPO, ETAPA_LABEL, ORIGEM_CAND, fmtBRL } from "@/lib/talento";
import { decidirRequisicao, salvarCandidato, inscrever, moverEtapa } from "../../../talento/actions";

export const dynamic = "force-dynamic";

export default async function Vaga({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireStaff(); const { id } = await params; const sp = await searchParams; const rid = Number(id); const cfg = await getSettings();
  const [r] = await db.select().from(schema.requisitions).where(eq(schema.requisitions.id, rid)); if (!r) notFound(); const u = scopeUnit(s); if (u !== null && u !== r.unitId) notFound();
  const [[unit], [pos], apps, banco, users] = await Promise.all([
    db.select().from(schema.units).where(eq(schema.units.id, r.unitId)), r.positionId ? db.select().from(schema.positions).where(eq(schema.positions.id, r.positionId)) : Promise.resolve([undefined]),
    sql<{ id: number; nome: string; candidate_id: number; etapa: string; scorecard: Record<string, number> | null; notas: string | null; proposta_valor: number | null; motivo: string | null; employee_id: number | null; origem: string | null; telefone: string | null; curriculo: string | null; updated_at: Date }[]>`SELECT a.id, c.nome, a.candidate_id, a.etapa, a.scorecard, a.notas, a.proposta_valor::float, a.motivo_reprovacao AS motivo, a.employee_id, c.origem, c.telefone, c.curriculo_link AS curriculo, a.updated_at FROM applications a JOIN candidates c ON c.id=a.candidate_id WHERE a.requisition_id=${rid} ORDER BY a.updated_at DESC`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM candidates WHERE id NOT IN (SELECT candidate_id FROM applications WHERE requisition_id=${rid}) ORDER BY nome LIMIT 300`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM users WHERE ativo AND role IN ('RH','DIRECAO','DIRETOR_UNIDADE','GESTOR') ORDER BY nome`,
  ]);
  const gestao = ["RH", "DIRECAO", "DIRETOR_UNIDADE", "GESTOR"].includes(s.role); const podeAprovar = can.aprovar(s, cfg.alcadas.vagas); const aberta = r.status === "ABERTA";
  const etapas = [...cfg.recrutamento.etapas]; const media = (sc: Record<string, number> | null) => { const v = Object.values(sc ?? {}); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : null; };
  const eventos = await sql<{ id: number; applicationId: number; at: Date; userNome: string | null; texto: string }[]>`SELECT id, application_id AS "applicationId", at, user_nome AS "userNome", texto FROM application_events WHERE application_id IN (SELECT id FROM applications WHERE requisition_id=${rid}) ORDER BY at DESC LIMIT 15`;
  return (
    <Page title={r.titulo} sub={<span className="flex flex-wrap items-center gap-2"><Badge v={r.status === "ABERTA" ? "EM_ADMISSAO" : r.status === "SOLICITADA" ? "PENDENTE" : r.status === "PREENCHIDA" ? "APROVADA" : "CANCELADA"} label={REQ_STATUS[r.status]} />{pos?.nome ?? "cargo a definir"} · {unit?.nome} · {r.quantidade} vaga(s) · {REQ_TIPO[r.tipo]} · {r.regime}{r.faixa ? ` · ${r.faixa}` : ""}{r.prazo ? ` · prazo ${fmtData(r.prazo)}` : ""} · <Link className="text-acao" href="/recrutamento">vagas</Link></span>}
      actions={<>{r.status === "SOLICITADA" && podeAprovar && <form action={decidirRequisicao} className="flex items-end gap-1"><input type="hidden" name="id" value={rid} /><Select name="responsavelUserId" defaultValue={r.responsavelUserId ?? ""} className="!w-44 !py-1.5 !text-xs">{users.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select><Btn name="decisao" value="ABERTA">Aprovar e abrir</Btn><Btn kind="ghost" danger name="decisao" value="CANCELADA">Recusar</Btn></form>}{aberta && can.editar(s) && <form action={decidirRequisicao}><input type="hidden" name="id" value={rid} /><Btn kind="ghost" name="decisao" value="PREENCHIDA">Marcar preenchida</Btn></form>}{aberta && (podeAprovar || r.solicitanteUserId === s.id) && <form action={decidirRequisicao}><input type="hidden" name="id" value={rid} /><Btn kind="ghost" danger name="decisao" value="CANCELADA">Cancelar vaga</Btn></form>}</>}>
      <Flash ok={sp.ok} erro={sp.erro} />
      {(r.justificativa || r.requisitos) && <Card className="mb-4"><dl className="grid gap-3 text-sm sm:grid-cols-2">{r.justificativa && <div><dt className="text-xs font-medium text-slate-500">Justificativa</dt><dd>{r.justificativa}</dd></div>}{r.requisitos && <div><dt className="text-xs font-medium text-slate-500">Requisitos</dt><dd>{r.requisitos}</dd></div>}</dl></Card>}
      <div className="grid gap-4 lg:grid-cols-[1fr_340px] lg:items-start">
        <div className="space-y-4">
          <Card title={`Pipeline (${apps.filter(a => !["REPROVADO", "DESISTIU"].includes(a.etapa)).length} em processo)`}>
            <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
              {etapas.map(et => <div key={et} className="rounded-md border border-line bg-mist p-2"><div className="mb-1 text-xs font-semibold text-navy">{ETAPA_LABEL[et]} <span className="text-slate-500">({apps.filter(a => a.etapa === et).length})</span></div>
                {apps.filter(a => a.etapa === et).map(a => <div key={a.id} className="mb-1 rounded border border-line bg-white p-2 text-xs"><Link className="font-medium text-acao" href={`/recrutamento/candidatos/${a.candidate_id}`}>{a.nome}</Link>{a.origem && <div className="text-slate-500">{ORIGEM_CAND[a.origem] ?? a.origem}</div>}{media(a.scorecard) && <div>scorecard {media(a.scorecard)}</div>}{a.proposta_valor && <div>{fmtBRL(a.proposta_valor)}</div>}{a.employee_id && <Link className="text-ok" href={`/colaboradores/${a.employee_id}`}>ficha criada</Link>}
                  {aberta && gestao && et !== "CONTRATADO" && <Modal label={"mover / avaliar"} kind="link"><form action={moverEtapa} className="space-y-1"><input type="hidden" name="id" value={a.id} />
                    <Select name="etapa" defaultValue={etapas[etapas.indexOf(et) + 1] ?? et} className="!py-1 !text-xs">{etapas.map(x => <option key={x} value={x}>{ETAPA_LABEL[x]}</option>)}<option value="REPROVADO">Reprovado</option><option value="DESISTIU">Desistiu</option></Select>
                    {cfg.recrutamento.criterios.map((c, i) => <div key={c} className="flex items-center justify-between gap-1"><span className="truncate">{c}</span><Select name={`sc_${i}`} defaultValue={a.scorecard?.[c] ?? ""} className="!w-14 !py-0.5 !text-xs"><option value="">—</option>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}</Select></div>)}
                    <Input name="notas" placeholder="Anotação" className="!py-1 !text-xs" /><Input name="propostaValor" type="number" step="0.01" placeholder="Proposta (R$)" className="!py-1 !text-xs" defaultValue={a.proposta_valor ?? ""} /><Input name="admissao" type="date" className="!py-1 !text-xs" defaultValue={hoje()} title="Data de admissão (se contratado)" /><Input name="motivo" placeholder="Motivo (se reprovado)" className="!py-1 !text-xs" /><Btn small>Aplicar</Btn></form></Modal>}</div>)}</div>)}
            </div>
            {apps.some(a => ["REPROVADO", "DESISTIU"].includes(a.etapa)) && <details className="mt-3 text-xs"><summary className="cursor-pointer text-slate-600">Reprovados e desistências ({apps.filter(a => ["REPROVADO", "DESISTIU"].includes(a.etapa)).length})</summary><ul className="mt-1 space-y-0.5">{apps.filter(a => ["REPROVADO", "DESISTIU"].includes(a.etapa)).map(a => <li key={a.id}><Link className="text-acao" href={`/recrutamento/candidatos/${a.candidate_id}`}>{a.nome}</Link> · {ETAPA_LABEL[a.etapa]}{a.motivo ? ` · ${a.motivo}` : ""}</li>)}</ul></details>}
          </Card>
          <Card title="Linha do tempo da vaga"><ul className="space-y-1 text-sm">{eventos.map(ev => { const a = apps.find(x => x.id === ev.applicationId); return <li key={ev.id}><span className="text-xs text-slate-500">{fmtDataHora(ev.at)}</span> · <b>{a?.nome}</b> — {ev.texto} <span className="text-xs text-slate-500">({ev.userNome})</span></li>; })}{eventos.length === 0 && <li className="text-sm text-slate-500">Sem movimentações.</li>}</ul></Card>
        </div>
        {aberta && gestao && <div className="space-y-4">
          <Card title="Novo candidato nesta vaga"><form action={salvarCandidato} className="space-y-2"><input type="hidden" name="requisitionId" value={rid} />
            <Field label="Nome"><Input name="nome" required /></Field><div className="grid grid-cols-2 gap-2"><Field label="Telefone"><Input name="telefone" /></Field><Field label="E-mail"><Input name="email" type="email" /></Field></div>
            <div className="grid grid-cols-2 gap-2"><Field label="Origem"><Select name="origem" defaultValue="SITE">{cfg.recrutamento.origens.map(o => <option key={o} value={o}>{ORIGEM_CAND[o] ?? o}</option>)}</Select></Field><Field label="Cidade"><Input name="cidade" defaultValue="Campo Grande" /></Field></div>
            <Field label="Currículo (link)"><Input name="curriculoLink" /></Field><Field label="Formação"><Input name="formacao" /></Field><Field label="Observações"><Textarea name="obs" className="min-h-[40px]" /></Field>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="consentimentoLgpd" value="1" defaultChecked /> Candidato autorizou guardar seus dados (LGPD)</label><Btn small>Incluir na triagem</Btn></form></Card>
          {banco.length > 0 && <Card title="Do banco de talentos"><form action={inscrever} className="flex items-end gap-2"><input type="hidden" name="requisitionId" value={rid} /><Field label="Candidato" className="flex-1"><Select name="candidateId" required><option value="">Escolha</option>{banco.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select></Field><Btn small kind="ghost">Incluir</Btn></form></Card>}
        </div>}
      </div>
    </Page>
  );
}
