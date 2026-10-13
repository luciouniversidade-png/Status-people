import { sql } from "@/db";
import { scopeUnit, type Session } from "@/lib/auth";
import { Field, Input, Select, Textarea, Btn, Badge } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { getSettings, hoje, fmtData } from "@/lib/utils";
import { ACAO_STATUS, type AcaoRow } from "@/lib/gestao-estrategica";
import { salvarAcao, moverAcao } from "../gestao-actions";

export type OpcoesAcao = { units: { id: number; nome: string }[]; users: { id: number; nome: string }[]; objetivos: { id: number; titulo: string }[]; indicadores: { id: number; nome: string }[]; projetos: { id: number; nome: string }[]; podeRede: boolean };
export async function opcoesAcao(s: Session): Promise<OpcoesAcao> {
  const cfg = await getSettings(); const u = scopeUnit(s);
  const [units, users, objetivos, indicadores, projetos] = await Promise.all([
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ${u === null ? sql`` : sql`WHERE id=${u}`} ORDER BY nome`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM users WHERE ativo AND role NOT IN ('LEITURA','COLABORADOR') ORDER BY nome`,
    sql<{ id: number; titulo: string }[]>`SELECT id, titulo FROM objectives WHERE status='ATIVO' AND ciclo=${cfg.estrategia.cicloAtual} ${u === null ? sql`` : sql`AND (unit_id IS NULL OR unit_id=${u})`} ORDER BY ordem, id`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM indicators WHERE ativo ${u === null ? sql`` : sql`AND (unit_id IS NULL OR unit_id=${u})`} ORDER BY nome`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM projects WHERE status IN ('IDEIA','PLANEJADO','EM_ANDAMENTO','PAUSADO') ${u === null ? sql`` : sql`AND (unit_id IS NULL OR unit_id=${u})`} ORDER BY nome`]);
  return { units, users, objetivos, indicadores, projetos, podeRede: u === null };
}

/** Plano de ação 5W2H: o quê, por quê, onde, quando, quem, como e quanto. */
export function FormAcao({ o, a, padrao = {} }: { o: OpcoesAcao; a?: AcaoRow; padrao?: { indicatorId?: number; objectiveId?: number; projectId?: number; unitId?: number | null; origem?: string; voltar?: string; ritualMeetingId?: number; responsavelUserId?: number } }) {
  const unit = a ? a.unit_id : padrao.unitId ?? (o.podeRede ? null : o.units[0]?.id ?? null);
  return (
    <form action={salvarAcao} className="space-y-2">
      {a && <input type="hidden" name="id" value={a.id} />}
      {padrao.voltar && <input type="hidden" name="voltar" value={padrao.voltar} />}
      {padrao.ritualMeetingId && <input type="hidden" name="ritualMeetingId" value={padrao.ritualMeetingId} />}
      <Field label="O quê — a ação"><Input name="titulo" required defaultValue={a?.titulo ?? ""} placeholder="Verbo + resultado: Ligar para as 12 famílias com rematrícula pendente" /></Field>
      <Field label="Por quê — o problema ou a meta que ela atende"><Textarea name="porque" defaultValue={a?.porque ?? ""} className="min-h-[46px]" /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Quem — responsável"><Select name="responsavelUserId" required defaultValue={a?.responsavel_user_id ?? padrao.responsavelUserId ?? ""}><option value="">—</option>{o.users.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field>
        <Field label="Onde — abrangência"><Select name="unitId" defaultValue={unit ?? ""}>{(o.podeRede || (a && a.unit_id === null)) && <option value="">Rede</option>}{o.units.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field>
        <Field label="Início"><Input name="inicio" type="date" defaultValue={a?.inicio ?? ""} /></Field>
        <Field label="Quando — prazo"><Input name="prazo" type="date" required defaultValue={a?.prazo ?? ""} min={a ? undefined : hoje()} /></Field>
      </div>
      <Field label="Local (opcional)"><Input name="local" defaultValue={a?.local ?? ""} placeholder="sala, setor, canal" /></Field>
      <Field label="Como — passos principais"><Textarea name="como" defaultValue={a?.como ?? ""} className="min-h-[50px]" /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Quanto — custo previsto (R$)"><Input name="custoPrevisto" type="number" step="0.01" min="0" defaultValue={a?.custo_previsto ?? ""} /></Field>
        <Field label="Origem"><Input name="origem" defaultValue={a?.origem ?? padrao.origem ?? ""} placeholder="reunião, auditoria, pesquisa…" /></Field>
      </div>
      <details className="rounded-md border border-line p-2" open={!!(a?.objective_id || a?.indicator_id || a?.project_id || padrao.indicatorId || padrao.objectiveId || padrao.projectId)}><summary className="cursor-pointer text-xs font-medium text-slate-600">Ligar a objetivo, indicador ou projeto</summary>
        <div className="mt-2 space-y-2">
          <Field label="Objetivo"><Select name="objectiveId" defaultValue={a?.objective_id ?? padrao.objectiveId ?? ""}><option value="">—</option>{o.objetivos.map(x => <option key={x.id} value={x.id}>{x.titulo}</option>)}</Select></Field>
          <Field label="Indicador"><Select name="indicatorId" defaultValue={a?.indicator_id ?? padrao.indicatorId ?? ""}><option value="">—</option>{o.indicadores.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field>
          <Field label="Projeto"><Select name="projectId" defaultValue={a?.project_id ?? padrao.projectId ?? ""}><option value="">—</option>{o.projetos.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field>
        </div>
      </details>
      <Btn small>{a ? "Salvar ação" : "Criar ação"}</Btn>
    </form>
  );
}

/** Quem altera uma ação: Direção/RH, o responsável, quem criou e o diretor da unidade da ação (mesma regra da action). */
export const podeMexerAcao = (s: Session, a: { responsavel_user_id: number | null; created_by: number | null; unit_id: number | null }) => ["DIRECAO", "RH"].includes(s.role) || a.responsavel_user_id === s.id || a.created_by === s.id || (s.role === "DIRETOR_UNIDADE" && a.unit_id !== null && a.unit_id === s.unitId);

export function SituacaoAcao({ a }: { a: AcaoRow }) {
  if (a.vencida) return <><Badge v="REJEITADA" label={`Vencida há ${a.dias_atraso} dia(s)`} /><div className="text-[11px] text-slate-500">{ACAO_STATUS[a.status]}</div></>;
  if (a.status === "BLOQUEADA") return <><Badge v="PENDENTE" label="Bloqueada" /><div className="max-w-[16rem] text-[11px] text-slate-600">{a.bloqueio}{a.bloqueio_desde ? ` · desde ${fmtData(a.bloqueio_desde)}` : ""}</div></>;
  if (a.status === "CONCLUIDA") return <><Badge v="APROVADA" label={`Concluída ${fmtData(a.concluida_em)}`} />{a.evidencia && <div className="max-w-[16rem] text-[11px] text-slate-600">{a.evidencia}</div>}</>;
  if (a.status === "CANCELADA") return <><Badge v="CANCELADA" label="Cancelada" />{a.cancel_justificativa && <div className="max-w-[16rem] text-[11px] text-slate-600">{a.cancel_justificativa}</div>}</>;
  return <Badge v={a.status === "EM_ANDAMENTO" ? "EM_ADMISSAO" : "NEUTRO"} label={ACAO_STATUS[a.status]} />;
}

/** Botões de transição da ação (iniciar, concluir com evidência, bloquear com motivo, retomar, cancelar com justificativa). */
export function MoverAcao({ a, voltar }: { a: AcaoRow; voltar: string }) {
  const h = (para: string) => <><input type="hidden" name="id" value={a.id} /><input type="hidden" name="para" value={para} /><input type="hidden" name="voltar" value={voltar} /></>;
  const exec = ["A_FAZER", "EM_ANDAMENTO"].includes(a.status);
  return (
    <div className="flex flex-wrap gap-1">
      {a.status === "A_FAZER" && <form action={moverAcao}>{h("EM_ANDAMENTO")}<Btn small kind="ghost">Iniciar</Btn></form>}
      {exec && <Modal label="Concluir" title={`Concluir: ${a.titulo}`}><form action={moverAcao} className="space-y-2">{h("CONCLUIR")}<Field label="Evidência do que foi feito"><Textarea name="evidencia" required placeholder="O que foi entregue, onde está, quem confirmou" /></Field><Field label="Custo real (R$)"><Input name="custoReal" type="number" step="0.01" min="0" defaultValue={a.custo_previsto ?? ""} /></Field><Btn small>Concluir ação</Btn><p className="text-xs text-slate-500">Concluir a ação não comprova, por si, o resultado — acompanhe o indicador ou o objetivo ligado.</p></form></Modal>}
      {exec && <Modal label="Bloquear" title={`Bloquear: ${a.titulo}`}><form action={moverAcao} className="space-y-2">{h("BLOQUEADA")}<Field label="O que falta e de quem depende"><Textarea name="bloqueio" required placeholder="Ex.: aguardando aprovação de orçamento pela Direção" /></Field><Btn small>Registrar bloqueio</Btn><p className="text-xs text-slate-500">Bloqueio é institucional: a ação sai da conta de atraso do responsável e aparece para quem pode destravar.</p></form></Modal>}
      {a.status === "BLOQUEADA" && <form action={moverAcao}>{h("DESBLOQUEAR")}<Btn small kind="ghost">Retomar</Btn></form>}
      {(exec || a.status === "BLOQUEADA") && <Modal label="Cancelar" kind="danger" title={`Cancelar: ${a.titulo}`}><form action={moverAcao} className="space-y-2">{h("CANCELAR")}<Field label="Justificativa"><Textarea name="justificativa" required /></Field><Btn small danger>Cancelar ação</Btn><p className="text-xs text-slate-500">A ação sai das contas de execução; o histórico fica preservado.</p></form></Modal>}
    </div>
  );
}
