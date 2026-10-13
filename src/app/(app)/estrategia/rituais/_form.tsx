import { sql } from "@/db";
import { scopeUnit, type Session } from "@/lib/auth";
import { Field, Input, Select, Textarea, Btn } from "@/components/ui";
import { getSettings, hoje } from "@/lib/utils";
import { RITUAL_TIPO } from "@/lib/gestao-calc";
import type { RitualResumo } from "@/lib/metricas-extra";
import { salvarRitual } from "../gestao-actions";

export type OpcoesRitual = { units: { id: number; nome: string }[]; users: { id: number; nome: string }[]; indicadores: { id: number; nome: string }[]; objetivos: { id: number; titulo: string }[]; podeRede: boolean };
export async function opcoesRitual(s: Session): Promise<OpcoesRitual> {
  const cfg = await getSettings(); const u = scopeUnit(s);
  const [units, users, indicadores, objetivos] = await Promise.all([
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ${u === null ? sql`` : sql`WHERE id=${u}`} ORDER BY nome`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM users WHERE ativo AND role NOT IN ('LEITURA','COLABORADOR') ORDER BY nome`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM indicators WHERE ativo ${u === null ? sql`` : sql`AND (unit_id IS NULL OR unit_id=${u})`} ORDER BY perspectiva NULLS LAST, nome`,
    sql<{ id: number; titulo: string }[]>`SELECT id, titulo FROM objectives WHERE status='ATIVO' AND ciclo=${cfg.estrategia.cicloAtual} ${u === null ? sql`` : sql`AND (unit_id IS NULL OR unit_id=${u})`} ORDER BY ordem, id`]);
  return { units, users, indicadores, objetivos, podeRede: ["DIRECAO", "RH"].includes(s.role) };
}

const Marcar = ({ nome, itens, marcados }: { nome: string; itens: { id: number; rotulo: string }[]; marcados: number[] }) => (
  <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-line p-2 text-xs">{itens.length === 0 ? <span className="text-slate-400">nenhum disponível</span> : itens.map(i => <label key={i.id} className="flex items-center gap-1.5"><input type="checkbox" name={nome} value={i.id} defaultChecked={marcados.includes(i.id)} /> {i.rotulo}</label>)}</div>
);

/** Ritual de gestão: cadência, dono, participantes, pauta padrão e o que é revisado (indicadores e objetivos). */
export function FormRitual({ o, r, donoPadrao }: { o: OpcoesRitual; r?: RitualResumo; donoPadrao: number }) {
  return (
    <form action={salvarRitual} className="space-y-2">
      {r && <input type="hidden" name="id" value={r.id} />}
      <Field label="Nome"><Input name="nome" required defaultValue={r?.nome ?? ""} placeholder="Ex.: Reunião semanal de coordenação — Carandá" /></Field>
      <Field label="Finalidade"><Textarea name="finalidade" defaultValue={r?.finalidade ?? ""} className="min-h-[44px]" /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Cadência"><Select name="tipo" defaultValue={r?.tipo ?? "SEMANAL"}>{Object.entries(RITUAL_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Duração (min)"><Input name="duracaoMin" type="number" min="5" step="5" defaultValue={r?.duracao_min ?? 60} /></Field>
        <Field label="Abrangência"><Select name="unitId" defaultValue={r ? (r.unit_id ?? "") : o.podeRede ? "" : o.units[0]?.id}>{(o.podeRede || (r && r.unit_id === null)) && <option value="">Rede</option>}{o.units.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field>
        <Field label="Próxima reunião"><Input name="proximaData" type="date" required defaultValue={r?.proxima_data ?? hoje()} /></Field>
      </div>
      <Field label="Dono (facilitador)"><Select name="donoUserId" required defaultValue={r?.dono_user_id ?? donoPadrao}>{o.users.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field>
      <div><div className="mb-1 text-sm font-medium text-slate-700">Participantes</div><Marcar nome="participantes" itens={o.users.map(x => ({ id: x.id, rotulo: x.nome }))} marcados={r?.participantes ?? [donoPadrao]} /></div>
      <Field label="Pauta padrão" hint="Um item por linha — entra na pauta automática de toda reunião."><Textarea name="pautaPadrao" defaultValue={r?.pauta_padrao ?? ""} className="min-h-[70px]" /></Field>
      <div><div className="mb-1 text-sm font-medium text-slate-700">Indicadores revisados</div><Marcar nome="indicadores" itens={o.indicadores.map(x => ({ id: x.id, rotulo: x.nome }))} marcados={r?.indicadores ?? []} /></div>
      <div><div className="mb-1 text-sm font-medium text-slate-700">Objetivos revisados</div><Marcar nome="objetivos" itens={o.objetivos.map(x => ({ id: x.id, rotulo: x.titulo }))} marcados={r?.objetivos ?? []} /></div>
      {r && <Field label="Situação"><Select name="ativo" defaultValue={r.ativo ? "1" : "0"}><option value="1">Ativo</option><option value="0">Inativo (sai das contas e dos alertas)</option></Select></Field>}
      <Btn small>{r ? "Salvar ritual" : "Criar ritual"}</Btn>
    </form>
  );
}
