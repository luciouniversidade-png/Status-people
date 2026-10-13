import { Field, Input, Select, Textarea } from "@/components/ui";
import { FAMILIAS } from "@/lib/avaliacao";

/** Campos do perfil de expectativas (criar/editar rascunho). */
export function CamposPerfil({ p, positions }: { p?: Record<string, unknown>; positions: { id: number; nome: string }[] }) {
  const j = (k: string) => ((p?.[k] as string[] | null) ?? []).join("\n");
  const comp = ((p?.competencias as { nome: string; nivel: number; descricao: string | null }[] | null) ?? []).map(c => `${c.nome} | ${c.nivel}${c.descricao ? ` | ${c.descricao}` : ""}`).join("\n");
  return (<>
    <Field label="Título"><Input name="titulo" required defaultValue={(p?.titulo as string) ?? ""} placeholder="Ex.: Professor(a) — Fundamental I" /></Field>
    <div className="grid grid-cols-3 gap-2"><Field label="Cargo específico"><Select name="positionId" defaultValue={(p?.positionId as number) ?? ""}><option value="">— (vale para a família)</option>{positions.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field><Field label="Família"><Select name="familia" defaultValue={(p?.familia as string) ?? ""}><option value="">—</option>{Object.entries(FAMILIAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Nível de responsabilidade"><Input name="nivel" defaultValue={(p?.nivel as string) ?? ""} placeholder="I, II, sênior…" /></Field></div>
    <Field label="Finalidade do cargo"><Textarea name="finalidade" className="min-h-[46px]" defaultValue={(p?.finalidade as string) ?? ""} /></Field>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Field label="Responsabilidades principais (uma por linha)"><Textarea name="responsabilidades" className="min-h-[80px]" defaultValue={j("responsabilidades")} /></Field><Field label="Entregas esperadas (uma por linha)"><Textarea name="entregas" className="min-h-[80px]" defaultValue={j("entregas")} /></Field></div>
    <Field label="Competências técnicas e nível requerido (Nome | nível 1–5 | descrição)"><Textarea name="competencias" className="min-h-[70px] font-mono text-xs" defaultValue={comp} /></Field>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><Field label="Comportamentos observáveis"><Textarea name="comportamentos" className="min-h-[70px]" defaultValue={j("comportamentos")} /></Field><Field label="Evidências adequadas"><Textarea name="evidencias" className="min-h-[70px]" defaultValue={j("evidencias")} /></Field><Field label="Condições necessárias"><Textarea name="condicoes" className="min-h-[70px]" defaultValue={j("condicoes")} /></Field></div>
    <div className="grid grid-cols-2 gap-2"><Field label="Vigência — início"><Input name="vigenciaInicio" type="date" defaultValue={(p?.vigenciaInicio as string) ?? ""} /></Field><Field label="Vigência — fim"><Input name="vigenciaFim" type="date" defaultValue={(p?.vigenciaFim as string) ?? ""} /></Field></div>
    <p className="text-[11px] text-slate-500">Valores institucionais entram como práticas observáveis nos comportamentos, sem repetir o mesmo comportamento em vários itens. Nível exigido do cargo é diferente do desempenho no ciclo.</p>
  </>);
}

