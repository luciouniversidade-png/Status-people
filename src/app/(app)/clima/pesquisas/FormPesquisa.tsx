import { Field, Input, Select, Textarea, Btn } from "@/components/ui";
import { salvarPesquisa } from "./actions";

type V = { id?: number; titulo?: string; descricao?: string | null; perguntas: string; inicio: string; fim: string; minimo: number; publico: string; unitId?: number | null; positionId?: number | null; identificada: boolean };

/** v34 · formulário da pesquisa interna (novo e edição do rascunho). */
export function FormPesquisa({ units, cargos, valores: v }: { units: { id: number; nome: string }[]; cargos: { id: number; nome: string }[]; valores: V }) {
  return (
    <form action={salvarPesquisa} className="space-y-2">{v.id ? <input type="hidden" name="id" value={v.id} /> : null}
      <Field label="Título"><Input name="titulo" defaultValue={v.titulo ?? ""} required maxLength={160} placeholder="ex.: Formação continuada 2027 — o que você precisa?" /></Field>
      <Field label="Apresentação (aparece antes das perguntas)"><Textarea name="descricao" defaultValue={v.descricao ?? ""} maxLength={800} className="min-h-[50px]" /></Field>
      <Field label="Perguntas — uma por linha: TIPO | pergunta | opções separadas por ;" hint="Tipos: ESCALA (1 a 5), UNICA (uma opção), MULTIPLA (várias), TEXTO. Termine a pergunta com * para torná-la opcional (TEXTO já é opcional).">
        <Textarea name="perguntas" defaultValue={v.perguntas} required className="min-h-[160px] font-mono text-xs" /></Field>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Field label="Início"><Input type="date" name="inicio" defaultValue={v.inicio} /></Field><Field label="Fim"><Input type="date" name="fim" defaultValue={v.fim} required /></Field>
        <Field label="Mínimo para mostrar (anônima)"><Input type="number" name="minimo" min={3} max={30} defaultValue={v.minimo} /></Field>
        <Field label="Público"><Select name="publico" defaultValue={v.publico}><option value="TODOS">Toda a equipe</option><option value="UNIDADE">Uma unidade</option><option value="CARGO">Um cargo</option></Select></Field></div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Field label="Unidade (se o público for uma unidade)"><Select name="unitId" defaultValue={v.unitId ? String(v.unitId) : ""}><option value="">—</option>{units.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></Field>
        <Field label="Cargo (se o público for um cargo)"><Select name="positionId" defaultValue={v.positionId ? String(v.positionId) : ""}><option value="">—</option>{cargos.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select></Field></div>
      <label className="flex items-start gap-1.5 text-xs"><input type="checkbox" name="identificada" value="1" defaultChecked={v.identificada} className="mt-0.5" /> Identificada (o RH vê quem respondeu o quê e pode exportar). A pessoa é avisada antes de responder. Para clima e opinião sobre a liderança, prefira anônima.</label>
      <Btn small>Salvar rascunho</Btn>
    </form>
  );
}
