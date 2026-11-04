// v31 · formulário “Marcar 1:1” — na página de 1:1, em Minha equipe e no painel do colaborador.
import { requireSession } from "@/lib/auth";
import { Field, Input, Select, Btn } from "@/components/ui";
import { getSettings, hoje, addDays } from "@/lib/utils";
import { colegasConversa, rotuloColega, RECORRENCIA } from "@/lib/conversas";
import { marcarUmAUm } from "./actions";

const somaMin = (h: string, min: number) => { const [a, b] = h.split(":").map(Number); const t = Math.min(23 * 60 + 59, a * 60 + b + min); return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };

/** Formulário “Marcar 1:1” (também usado em Minha equipe e no painel do colaborador). */
export async function FormMarcar({ convidado, voltar }: { convidado?: number | null; voltar: string }) {
  const s = await requireSession(); const cfg = await getSettings(); const colegas = await colegasConversa(s); const temas = cfg.conversas.temas as string[]; const h = hoje();
  const inicio = "10:00"; const fim = somaMin(inicio, Number(cfg.conversas.duracaoMin) || 60);
  return <form action={marcarUmAUm} className="space-y-3"><input type="hidden" name="voltar" value={voltar} />
    <Field label="Convidado *"><Select name="employeeId" required defaultValue={convidado ? String(convidado) : ""}><option value="" disabled>Nome do convidado…</option>{colegas.map(c => <option key={c.id} value={c.id}>{rotuloColega(c)}</option>)}</Select></Field>
    <div className="grid grid-cols-3 gap-2"><Field label="Data *"><Input name="data" type="date" required min={h} defaultValue={addDays(h, 1)} /></Field><Field label="Início *"><Input name="inicio" type="time" required defaultValue={inicio} /></Field><Field label="Término *"><Input name="fim" type="time" required defaultValue={fim} /></Field></div>
    <Field label="Título *"><Input name="titulo" required placeholder="Ex.: 1:1 quinzenal" /></Field>
    <fieldset><legend className="text-xs font-medium text-slate-700">Tema(s) da 1:1</legend><p className="mb-1.5 text-[11px] text-slate-500">Escolha o(s) tema(s) para compor sua 1:1.</p>
      <div className="flex flex-wrap gap-1.5">{temas.map(t => <label key={t} className="cursor-pointer"><input type="checkbox" name="temas" value={t} className="peer sr-only" /><span className="inline-block rounded-full border border-line bg-white px-2.5 py-1 text-xs text-navy peer-checked:border-acao peer-checked:bg-sky-50 peer-checked:font-semibold peer-checked:text-acao peer-focus-visible:ring-2 peer-focus-visible:ring-acao/50">{t}</span></label>)}</div></fieldset>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Field label="Repetição"><Select name="recorrencia" defaultValue="NENHUMA">{Object.entries(RECORRENCIA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Primeiro ponto de pauta (opcional)"><Input name="pauta" placeholder="Ex.: rever o plano do 4º bimestre" /></Field></div>
    <div className="flex flex-wrap items-center gap-2"><Btn>Marcar</Btn><span className="text-[11px] text-slate-500">O convidado é avisado (sem nomes na notificação) e pode incluir pontos na pauta.</span></div>
  </form>;
}

