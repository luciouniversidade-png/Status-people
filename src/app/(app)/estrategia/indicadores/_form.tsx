import { Field, Input, Select, Textarea, Btn } from "@/components/ui";
import { DIRECAO_IND, FREQ_LABEL, type Perspectiva } from "@/lib/gestao-calc";
import { TIPO_IND, ORIGEM_FUNIL_LABEL, type IndRow } from "@/lib/gestao-estrategica";
import { ORIGENS_FUNIL } from "@/lib/metricas-extra";
import { FONTES } from "@/lib/estrategia";
import { salvarIndicador } from "../gestao-actions";
import { sql } from "@/db";
import { scopeUnit, type Session } from "@/lib/auth";
import { getSettings } from "@/lib/utils";

export type OpcoesIndicador = { perspectivas: Perspectiva[]; areas: string[]; units: { id: number; nome: string }[]; users: { id: number; nome: string }[]; objetivos: { id: number; titulo: string }[]; medidos: { id: number; nome: string }[]; podeRede: boolean };

/** Formulário único de indicador (novo e edição). O tipo decide o que vale: manual, lido do sistema ou calculado. */
export function FormIndicador({ o, i }: { o: OpcoesIndicador; i?: IndRow }) {
  const n = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  return (
    <form action={salvarIndicador} className="space-y-2">
      {i && <input type="hidden" name="id" value={i.id} />}
      <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2"><Field label="Código"><Input name="codigo" defaultValue={i?.codigo ?? ""} placeholder="FIN-01" /></Field><Field label="Nome do indicador"><Input name="nome" required defaultValue={i?.nome ?? ""} placeholder="Ex.: Inadimplência 90 dias" /></Field></div>
      <Field label="O que mede e como é apurado"><Textarea name="descricao" defaultValue={i?.descricao ?? ""} className="min-h-[50px]" placeholder="Fórmula, fonte, quem apura" /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Perspectiva"><Select name="perspectiva" defaultValue={i?.perspectiva ?? ""}><option value="">—</option>{o.perspectivas.map(p => <option key={p.chave} value={p.chave}>{p.nome}</option>)}</Select></Field>
        <Field label="Área"><Select name="area" defaultValue={i?.area ?? ""}><option value="">—</option>{[...new Set([...o.areas, ...(i?.area ? [i.area] : [])])].map(a => <option key={a}>{a}</option>)}</Select></Field>
        <Field label="Abrangência"><Select name="unitId" defaultValue={i ? (i.unit_id ?? "") : o.podeRede ? "" : o.units[0]?.id}>{o.podeRede && <option value="">Rede</option>}{o.units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>
        <Field label="Unidade de medida"><Input name="unidadeMedida" list="unidades-medida" defaultValue={i?.unidade_medida ?? ""} placeholder="%, R$, pontos, alunos" /></Field>
      </div>
      <datalist id="unidades-medida"><option value="%" /><option value="R$" /><option value="pontos" /><option value="alunos" /><option value="dias" /><option value="famílias" /><option value="horas" /></datalist>
      <fieldset className="rounded-md border border-line p-2"><legend className="px-1 text-xs font-medium text-slate-600">Meta e farol</legend>
        <Field label="Direção"><Select name="direcao" defaultValue={i?.direcao ?? "MAIOR_MELHOR"}>{Object.entries(DIRECAO_IND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <div className="mt-2 grid grid-cols-2 gap-2"><Field label="Meta (no alvo)"><Input name="meta" type="number" step="any" defaultValue={n(i?.meta)} /></Field><Field label="Limite de atenção" hint="maior é melhor: abaixo da meta; menor é melhor: acima; faixa: margem fora dela"><Input name="alerta" type="number" step="any" defaultValue={n(i?.alerta)} /></Field></div>
        <div className="mt-2 grid grid-cols-2 gap-2"><Field label="Faixa: mínimo"><Input name="faixaMin" type="number" step="any" defaultValue={n(i?.faixa_min)} /></Field><Field label="Faixa: máximo"><Input name="faixaMax" type="number" step="any" defaultValue={n(i?.faixa_max)} /></Field></div>
      </fieldset>
      <fieldset className="rounded-md border border-line p-2"><legend className="px-1 text-xs font-medium text-slate-600">Como o valor chega</legend>
        <div className="grid grid-cols-2 gap-2"><Field label="Tipo"><Select name="tipo" defaultValue={i?.tipo ?? "MANUAL"}>{Object.entries(TIPO_IND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Frequência"><Select name="frequencia" defaultValue={i?.frequencia ?? "MENSAL"}>{Object.entries(FREQ_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field></div>
        <Field label="Lido do sistema: métrica" className="mt-2"><Select name="fonte" defaultValue={i?.fonte ?? ""}><option value="">—</option>{Object.entries(FONTES).map(([k, v]) => <option key={k} value={k}>{v.nome} ({v.metrica})</option>)}</Select></Field>
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_80px] gap-2"><Field label="Calculado: numerador"><Select name="numeradorId" defaultValue={i?.numerador_id ?? ""}><option value="">—</option>{o.medidos.filter(m => m.id !== i?.id).map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}</Select></Field><Field label="÷ denominador"><Select name="denominadorId" defaultValue={i?.denominador_id ?? ""}><option value="">—</option>{o.medidos.filter(m => m.id !== i?.id).map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}</Select></Field><Field label="× fator"><Input name="fator" type="number" step="any" defaultValue={n(i?.fator ?? (i ? null : 1))} /></Field></div>
        <div className="mt-2 grid grid-cols-2 gap-2"><Field label="Funil de marketing"><Select name="funil" defaultValue={i?.funil ?? ""}><option value="">—</option><option value="INVESTIMENTO">Investimento em captação</option></Select></Field><Field label="Canal"><Select name="canal" defaultValue={i?.canal ?? ""}><option value="">—</option>{ORIGENS_FUNIL.map(c => <option key={c} value={c}>{ORIGEM_FUNIL_LABEL[c] ?? c}</option>)}</Select></Field></div>
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Responsável pela medição"><Select name="responsavelUserId" defaultValue={i?.responsavel_user_id ?? ""}><option value="">—</option>{o.users.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>
        <Field label="Objetivo ligado"><Select name="objectiveId" defaultValue={i?.objective_id ?? ""}><option value="">—</option>{o.objetivos.map(x => <option key={x.id} value={x.id}>{x.titulo}</option>)}</Select></Field>
      </div>
      <Field label="Ordem na lista"><Input name="ordem" type="number" defaultValue={i?.ordem ?? 0} className="max-w-[120px]" /></Field>
      <Btn small>{i ? "Salvar indicador" : "Criar indicador"}</Btn>
    </form>
  );
}

/** Opções do formulário no escopo de quem edita (unidades, pessoas, objetivos do ciclo, indicadores medidos). */
export async function opcoesIndicador(s: Session): Promise<OpcoesIndicador> {
  const cfg = await getSettings(); const u = scopeUnit(s);
  const [units, users, objetivos, medidos] = await Promise.all([
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM units ${u === null ? sql`` : sql`WHERE id=${u}`} ORDER BY nome`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM users WHERE ativo AND role NOT IN ('LEITURA','COLABORADOR') ORDER BY nome`,
    sql<{ id: number; titulo: string }[]>`SELECT id, titulo FROM objectives WHERE status='ATIVO' AND ciclo=${cfg.estrategia.cicloAtual} ${u === null ? sql`` : sql`AND (unit_id IS NULL OR unit_id=${u})`} ORDER BY ordem, id`,
    sql<{ id: number; nome: string }[]>`SELECT id, nome FROM indicators WHERE ativo AND tipo <> 'CALCULADO' ${u === null ? sql`` : sql`AND (unit_id IS NULL OR unit_id=${u})`} ORDER BY nome`]);
  return { perspectivas: cfg.estrategia.perspectivas as Perspectiva[], areas: cfg.estrategia.areasIndicador as string[], units, users, objetivos, medidos, podeRede: ["DIRECAO", "RH"].includes(s.role) };
}
