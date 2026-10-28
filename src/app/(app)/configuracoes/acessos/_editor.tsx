import type { Role } from "@/lib/auth";
import { ALCADAS, ATUACAO, ATUACOES, telasDaAtuacao, type Tela } from "@/lib/acesso";
import { MarcarGrupo, ContadorTelas, SeguePadrao } from "@/components/AcessoEditorCliente";

/** Telas da atuação agrupadas como no menu. */
export function gruposDeTelas(role: Role): [string, Tela[]][] {
  const m = new Map<string, Tela[]>(); for (const t of telasDaAtuacao(role)) m.set(t.grupo, [...(m.get(t.grupo) ?? []), t]);
  return [...m.entries()];
}

/** Escolha da atuação (formulário GET: trocar a atuação recarrega o catálogo de telas e as aprovações padrão dela). */
export function EscolhaAtuacao({ atual, base, extra }: { atual: Role; base: string; extra?: Record<string, string> }) {
  return (
    <form method="get" action={base} className="space-y-2">
      {Object.entries(extra ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
        {ATUACOES.map(r => (
          <label key={r} className={`flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-sm ${r === atual ? "border-acao bg-sky-50" : "border-line hover:bg-mist"}`}>
            <input type="radio" name="atuacao" value={r} defaultChecked={r === atual} className="mt-0.5" />
            <span><b className="text-navy">{ATUACAO[r].rotulo}</b><span className="block text-xs text-slate-600">{ATUACAO[r].descricao}</span><span className="block text-[11px] text-slate-500">Alcance: {ATUACAO[r].alcance === "UNIDADE" ? "a unidade da pessoa" : "a rede toda"} · {telasDaAtuacao(r).length} telas possíveis</span></span>
          </label>
        ))}
      </div>
      <button className="rounded-md border border-line bg-white px-3 py-1.5 text-xs font-medium text-navy hover:bg-mist">Mostrar as telas desta atuação</button>
    </form>
  );
}

/** Caixas das telas (por grupo do menu) e das aprovações — usado no cargo, na exceção individual e na conta sem ficha. */
export function CamposAcesso({ atuacao, telas, aprova, padraoAprova, seguePadrao, descontoPct = null, descontoPadrao = 0, estreito = false }: { atuacao: Role; telas: string[] | null; aprova: string[]; padraoAprova: string[]; seguePadrao: boolean; descontoPct?: number | null; descontoPadrao?: number; /** coluna lateral estreita (exceção, conta sem ficha): uma caixa por linha */ estreito?: boolean }) {
  const grupos = gruposDeTelas(atuacao); const total = telasDaAtuacao(atuacao).length;
  const marcada = (k: string) => telas === null || telas.includes(k);
  const areas = [...new Set(ALCADAS.map(a => a.area))];
  const grade = estreito ? "grid grid-cols-1 gap-3" : "grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3";
  return (
    <>
      <input type="hidden" name="atuacao" value={atuacao} />
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-semibold text-navy">Telas que vê</h3><ContadorTelas total={total} /></div>
      <p className="mb-3 text-xs text-slate-600">Desmarque o que este acesso não deve ver: a tela some do menu e o endereço dela deixa de abrir. As pessoais (Início, Minha conta, Notificações, Meu espaço, Minha ficha, Minhas pendências) ficam sempre. Telas novas de versões futuras entram marcadas só enquanto todas estiverem marcadas aqui.</p>
      <div className={grade}>
        {grupos.map(([g, ts]) => (
          <fieldset key={g} className="rounded-md border border-line p-3">
            <legend className="px-1 text-sm font-medium text-navy">{g}<MarcarGrupo /></legend>
            {ts.map(t => t.fixa
              ? <label key={t.chave} className="flex items-start gap-2 py-0.5 text-sm text-slate-500"><input type="checkbox" checked disabled data-fixa="1" className="mt-0.5" /><span>{t.rotulo} <span className="text-[11px]">(sempre)</span></span></label>
              : <label key={t.chave} className="flex items-start gap-2 py-0.5 text-sm"><input type="checkbox" name="telas" value={t.chave} defaultChecked={marcada(t.chave)} className="mt-0.5" /><span>{t.rotulo}</span></label>)}
          </fieldset>
        ))}
      </div>
      <h3 className="mb-2 mt-5 text-sm font-semibold text-navy">O que aprova</h3>
      <SeguePadrao marcado={seguePadrao}>
        <div className={grade}>
          {areas.map(a => (
            <div key={a} className="rounded-md border border-line p-3"><div className="mb-1 text-sm font-medium text-navy">{a}</div>
              {ALCADAS.filter(x => x.area === a).map(x => <label key={x.chave} className="flex items-start gap-2 py-0.5 text-sm"><input type="checkbox" name="aprova" value={x.chave} defaultChecked={aprova.includes(x.chave)} className="mt-0.5" /><span>{x.rotulo}{padraoAprova.includes(x.chave) && <span className="ml-1 rounded bg-mist px-1 text-[10px] text-slate-600">padrão da atuação</span>}</span></label>)}
            </div>
          ))}
        </div>
      </SeguePadrao>
      <label className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-line p-3 text-sm"><span className="font-medium text-navy">Descontos e bolsas:</span> aprova até <input type="number" name="descontoPct" min={0} max={100} step="0.5" defaultValue={descontoPct ?? ""} placeholder={String(descontoPadrao)} className="w-20 rounded-md border border-line px-2 py-1 text-sm" aria-label="Alçada de desconto (%)" />% <span className="text-xs text-slate-500">vazio = padrão da atuação ({String(descontoPadrao).replace(".", ",")}%). Acima disso o pedido vai para quem tem alçada maior.</span></label>
      <p className="mt-2 text-xs text-slate-500">Dentro de cada tela, o que a pessoa pode alterar segue a atuação ({ATUACAO[atuacao].rotulo}); as aprovações acima valem cargo a cargo. Quem solicita nunca aprova a própria solicitação (exceto RH/Direção, como sempre).</p>
    </>
  );
}
