import type { Contexto } from "@/lib/contexto";
import { trocarContexto } from "@/app/(app)/contexto/actions";
import { SelectAuto, InputAuto } from "./EnvioAuto";

const chip = "h-9 min-w-0 max-w-full rounded-full border border-line bg-white px-3 text-sm text-ink focus:border-acao focus:outline-none focus:ring-1 focus:ring-acao disabled:bg-mist disabled:text-slate-500";
const ORIGEM: Record<Contexto["origem"], string> = { url: "do link", sessao: "escolhido nesta sessão", salvo: "seu padrão salvo", papel: "padrão do seu perfil" };

/**
 * Chips de contexto no topo das telas de cockpit (T-100): entidade (Consolidado), unidade e período.
 * A escolha gruda entre telas e sessões; "Salvar como padrão" guarda entidade e unidade; o escopo do papel nunca é ultrapassado.
 */
export function BarraContexto({ ctx, voltar, periodo = true, notaPeriodo }: { ctx: Contexto; voltar: string; periodo?: boolean; notaPeriodo?: string }) {
  const unidades = ctx.entidadeId === null ? ctx.units : ctx.units.filter(u => u.company_id === ctx.entidadeId || u.id === ctx.unitId);
  return (
    <form action={trocarContexto} className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-line bg-white px-3 py-2 print:hidden" aria-label="Contexto da tela">
      <input type="hidden" name="voltar" value={voltar} />
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contexto</span>
      <label className="sr-only" htmlFor="ctx-e">Entidade</label>
      <SelectAuto id="ctx-e" name="e" defaultValue={ctx.entidadeId ?? ""} disabled={ctx.travado} className={chip}>
        <option value="">Consolidado (todas as entidades)</option>
        {ctx.entidades.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
      </SelectAuto>
      <label className="sr-only" htmlFor="ctx-u">Unidade</label>
      <SelectAuto id="ctx-u" name="u" defaultValue={ctx.unitId ?? ""} disabled={ctx.travado} className={chip}>
        <option value="">{ctx.entidadeId === null ? "Rede (todas as unidades)" : "Todas as unidades da entidade"}</option>
        {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
      </SelectAuto>
      {ctx.travado && <><input type="hidden" name="u" value={ctx.unitId ?? ""} /><input type="hidden" name="e" value={ctx.entidadeId ?? ""} /></>}
      {periodo && <><label className="sr-only" htmlFor="ctx-p">Período</label><InputAuto id="ctx-p" type="month" name="p" defaultValue={ctx.periodo} className={`${chip} w-[10.5rem]`} /></>}
      {!periodo && <input type="hidden" name="p" value={ctx.periodo} />}
      <button name="acao" value="aplicar" className="h-9 rounded-full bg-navy px-3 text-xs font-medium text-white">Aplicar</button>
      <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
        <span>{ctx.travado ? "seu perfil vê só a sua unidade" : ORIGEM[ctx.origem]}{notaPeriodo ? ` · ${notaPeriodo}` : ""}</span>
        {!ctx.travado && <button name="acao" value="salvar" className="text-acao underline-offset-2 hover:underline">Salvar como padrão</button>}
        {!ctx.travado && ctx.origem !== "papel" && <button name="acao" value="padrao" className="text-acao underline-offset-2 hover:underline">Padrão do papel</button>}
      </span>
      {ctx.semVinculo && <p className="w-full text-xs text-aviso">Nenhuma unidade está vinculada a esta entidade. Vincule em Configurações → Unidades para os números por unidade entrarem no recorte.</p>}
    </form>
  );
}

/** Carimbo do contexto para impressão e retratos ("Consolidado · Rede · out/26"). */
export function CarimboContexto({ ctx, extra }: { ctx: Contexto; extra?: string }) {
  return <p className="mb-2 hidden text-xs text-slate-600 print:block">Contexto: {ctx.carimbo}{extra ? ` · ${extra}` : ""}</p>;
}
