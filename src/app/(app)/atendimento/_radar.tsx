import { Field, Input, Select, Textarea, Btn, Badge } from "@/components/ui";
import { CANAIS, CANAL_LABEL } from "@/lib/atendimento";
import { CONTATO_TIPO, PERCEPCAO } from "@/lib/radar-familia";
import { SEGMENTO_LABEL, type EtapaCfg, type Segmento } from "@/lib/gestao-calc";
import { hoje } from "@/lib/utils";
import { registrarInteracao } from "./radar-actions";

export const SEG_TOM: Record<Segmento, string> = { RISCO: "REJEITADA", ATENCAO: "PENDENTE", SAUDAVEL: "APROVADA" };
export const SegBadge = ({ s, pontos }: { s: Segmento; pontos?: number }) => <Badge v={SEG_TOM[s]} label={`${SEGMENTO_LABEL[s]}${pontos ? ` · ${pontos} pts` : ""}`} />;

/** Registro de interação com a família (ligação, mensagem, reunião…), com percepção, próximo passo e etapa da jornada. */
export function FormInteracao({ studentId, voltar, etapas, etapaSugerida }: { studentId: number; voltar: string; etapas: EtapaCfg[]; etapaSugerida?: string | null }) {
  return (
    <form action={registrarInteracao} className="space-y-2">
      <input type="hidden" name="studentId" value={studentId} /><input type="hidden" name="voltar" value={voltar} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Field label="Data"><Input name="data" type="date" defaultValue={hoje()} max={hoje()} /></Field>
        <Field label="Tipo"><Select name="tipo" defaultValue="LIGACAO">{Object.entries(CONTATO_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Canal"><Select name="canal" defaultValue="WHATSAPP"><option value="">—</option>{CANAIS.map(c => <option key={c} value={c}>{CANAL_LABEL[c]}</option>)}</Select></Field>
      </div>
      <Field label="Resumo da conversa"><Textarea name="resumo" required className="min-h-[70px]" placeholder="O que a família trouxe, o que foi combinado" /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Percepção da família"><Select name="percepcao" defaultValue=""><option value="">não avaliada</option>{Object.entries(PERCEPCAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Etapa da jornada cumprida"><Select name="etapa" defaultValue={etapaSugerida ?? ""}><option value="">nenhuma</option>{etapas.map(e => <option key={e.chave} value={e.chave}>{e.nome}</option>)}</Select></Field>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_9.5rem] gap-2"><Field label="Próximo passo combinado"><Input name="proximoPasso" placeholder="Ex.: retornar sobre a troca de turma" /></Field><Field label="Até"><Input name="proximoEm" type="date" min={hoje()} /></Field></div>
      <Btn small>Registrar interação</Btn>
    </form>
  );
}
